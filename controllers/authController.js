const { users } = require('../utils/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../utils/logger');
const storageService = require('../services/storageService');
const auditService = require('../services/auditService');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtExpire
  });
};

// ============================================
// Register a new user
// ============================================
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Name must be a string with 2-100 characters'
      });
    }

    // Sanitize name
    const sanitizedName = name.replace(/[<>]/g, '');
    if (sanitizedName !== name) {
      return res.status(400).json({
        success: false,
        message: 'Invalid characters in name'
      });
    }

    if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Hash password
    const saltRounds = config.bcryptRounds;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Check if user exists
    let existingUser;
    try {
      existingUser = await users.findByEmail(email.toLowerCase());
    } catch (dbError) {
      logger.error('Database error:', { error: dbError.message });
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please check server configuration.'
      });
    }
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create user
    const userData = {
      name: sanitizedName,
      email: email.toLowerCase(),
      password_hash: hashedPassword,
      role: 'organizer',
      is_active: true
    };

    let user;
    try {
      user = await users.create(userData);
    } catch (dbError) {
      logger.error('Database error:', { error: dbError.message });
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please check server configuration.'
      });
    }

    // Generate session
    const sessionUtils = require('../utils/session');
    const { token, cookieOptions } = await sessionUtils.generateSecureSessionCookie(user.id);
    res.cookie('session_token', token, cookieOptions);

    logger.info('New user registered', { userId: user.id, email: user.email });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        preferences: user.preferences || {
          language: 'en',
          theme: 'light',
          notifications: true,
          timezone: 'UTC'
        }
      }
    });
  } catch (error) {
    logger.error('Registration error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// ============================================
// Login user
// ============================================
const login = async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
      // 🛡️ Log invalid login attempt
      await auditService.logLoginAttempt(
        email || 'invalid_email',
        clientIP,
        userAgent,
        false,
        'invalid_email_format'
      );
      
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      // 🛡️ Log invalid login attempt
      await auditService.logLoginAttempt(
        email,
        clientIP,
        userAgent,
        false,
        'invalid_password_format'
      );
      
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user
    let user;
    try {
      user = await users.findByEmail(email.toLowerCase());
    } catch (dbError) {
      logger.error('Database error:', { error: dbError.message });
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Database connection failed.'
      });
    }
    
    // Constant time comparison
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = await bcrypt.compare(password, user.password_hash);
    } else {
      // Fake hash for timing attack prevention
      await bcrypt.compare(password, '$2a$12$fake.hash.for.timing.XXXXXXXXXXXXXXXXXXXXX');
    }
    
    if (!user || !isPasswordValid) {
      // 🛡️ Log failed login attempt with proper reason
      const failureReason = !user ? 'user_not_found' : 'invalid_password';
      await auditService.logLoginAttempt(
        email.toLowerCase(),
        clientIP,
        userAgent,
        false,
        failureReason
      );
      
      // 🛡️ Log security event for authentication failure
      await auditService.logEvent({
        userId: user?.id || null,
        action: auditService.ACTIONS.LOGIN_FAILED,
        resourceType: auditService.RESOURCE_TYPES.USER,
        resourceId: user?.id || null,
        ipAddress: clientIP,
        userAgent,
        details: { 
          email: email.toLowerCase(), 
          reason: failureReason,
          timestamp: new Date().toISOString()
        },
        severity: auditService.SEVERITIES.WARNING,
        success: false,
        errorMessage: 'Invalid credentials'
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Clear existing session
    const existingToken = req.cookies?.session_token;
    if (existingToken) {
      res.clearCookie('session_token', { path: '/' });
      res.clearCookie('refresh_token', { path: '/' });
    }

    // Generate new session
    const sessionUtils = require('../utils/session');
    const { token, cookieOptions } = await sessionUtils.generateSecureSessionCookie(user.id);
    res.cookie('session_token', token, cookieOptions);

    // Generate refresh token (optional)
    try {
      const refreshTokenModule = require('../middleware/refreshToken');
      const refreshToken = await refreshTokenModule.generateRefreshToken(user.id);
      const isProduction = config.nodeEnv === 'production';
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });
    } catch (e) {
      // Continue without refresh token
    }

    // 🛡️ Log successful login attempt
    await auditService.logLoginAttempt(
      email.toLowerCase(),
      clientIP,
      userAgent,
      true,
      null
    );
    
    // 🛡️ Log successful authentication event
    await auditService.logEvent({
      userId: user.id,
      action: auditService.ACTIONS.LOGIN_SUCCESS,
      resourceType: auditService.RESOURCE_TYPES.USER,
      resourceId: user.id,
      ipAddress: clientIP,
      userAgent,
      sessionId: req.cookies?.session_token || 'new_session',
      details: { 
        email: user.email,
        loginMethod: 'password',
        timestamp: new Date().toISOString()
      },
      severity: auditService.SEVERITIES.INFO,
      success: true
    });

    logger.info('User logged in', { userId: user.id });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        preferences: user.preferences || {
          language: 'en',
          theme: 'light',
          notifications: true,
          timezone: 'UTC'
        }
      }
    });
  } catch (error) {
    logger.error('Login error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// ============================================
// Get current user profile
// ============================================
const getProfile = async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        avatar_url: req.user.avatar_url || null,
        preferences: req.user.preferences || {
          language: 'en',
          theme: 'light',
          notifications: true,
          timezone: 'UTC'
        }
      }
    });
  } catch (error) {
    logger.error('Get profile error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

// ============================================
// Logout user
// ============================================
const logout = async (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    const refreshToken = req.cookies.refresh_token;
    const isProduction = config.nodeEnv === 'production';

    res.clearCookie('session_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/'
    });

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/'
    });

    if (refreshToken) {
      try {
        const refreshTokenModule = require('../middleware/refreshToken');
        await refreshTokenModule.revokeRefreshTokenDirect(refreshToken);
      } catch (e) {
        // Ignore
      }
    }

    // 🛡️ Log successful logout
    await auditService.logEvent({
      userId: req.user?.id || null,
      action: auditService.ACTIONS.LOGOUT,
      resourceType: auditService.RESOURCE_TYPES.SESSION,
      ipAddress: clientIP,
      userAgent,
      sessionId: req.cookies?.session_token || 'expired_session',
      details: {
        logoutMethod: 'manual',
        refreshTokenRevoked: !!refreshToken,
        timestamp: new Date().toISOString()
      },
      severity: auditService.SEVERITIES.INFO,
      success: true
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

// ============================================
// Update user profile
// ============================================
const updateProfile = async (req, res) => {
  try {
    const { name, email, preferences, avatar_url } = req.body;

    // Validate
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > 100 || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be a string with 2-100 characters'
        });
      }
      const sanitizedName = name.replace(/[<>]/g, '');
      if (sanitizedName !== name) {
        return res.status(400).json({
          success: false,
          message: 'Invalid characters in name'
        });
      }
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid email address'
        });
      }
    }

    // Check email availability
    if (email && email !== req.user.email) {
      const existingUser = await users.findByEmail(email.toLowerCase());
      if (existingUser && existingUser.id !== req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another user'
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email.toLowerCase();
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    if (preferences !== undefined) {
      const currentUser = await users.findById(req.user.id);
      const currentPreferences = currentUser.preferences || {};
      updateData.preferences = { ...currentPreferences, ...preferences };
    }

    const updatedUser = await users.update(req.user.id, updateData);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar_url: updatedUser.avatar_url,
        preferences: updatedUser.preferences
      }
    });
  } catch (error) {
    logger.error('Update profile error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  logout
};
