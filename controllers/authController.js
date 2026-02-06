const { users } = require('../utils/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../utils/logger');
const storageService = require('../services/storageService');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: config.jwtExpire
  });
};

// Register a new user
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation des données d'entrée with enhanced security
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Name must be a string with 2-100 characters'
      });
    }

    // Sanitize name to prevent XSS
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

    // Check if user already exists
    const existingUser = await users.findByEmail(email.toLowerCase());
    if (existingUser) {
      logger.warn('Registration attempt with existing email', { email });
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user with default preferences
    const userData = {
      name: sanitizedName,
      email: email.toLowerCase(),
      password_hash: hashedPassword,
      role: 'organizer', // Default role
      is_active: true,
      preferences: {
        language: 'en',  // Default language
        theme: 'light',  // Default theme
        notifications: true, // Default notification setting
        timezone: 'UTC'  // Default timezone
      }
    };

    const user = await users.create(userData);

    // Generate secure session cookie with preferences
    const sessionUtils = require('../utils/session');
    const { token, cookieOptions } = await sessionUtils.generateSecureSessionCookie(user.id);

    // Set the cookie
    res.cookie('session_token', token, cookieOptions);

    logger.info('New user registered successfully', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        preferences: user.preferences
      }
    });
  } catch (error) {
    logger.error('Registration error:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation des données d'entrée with enhanced security
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

    // Find user by email
    const user = await users.findByEmail(email.toLowerCase());
    if (!user) {
      logger.warn('Login attempt with non-existent email', { email });
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      logger.warn('Login attempt with invalid password', { userId: user.id, email: user.email });
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      logger.warn('Login attempt with inactive account', { userId: user.id, email: user.email });
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Generate secure session cookie with preferences
    const sessionUtils = require('../utils/session');
    const { token, cookieOptions } = await sessionUtils.generateSecureSessionCookie(user.id);

    // Generate refresh token
    const refreshTokenModule = require('../middleware/refreshToken');
    const refreshToken = refreshTokenModule.generateRefreshToken(user.id);

    // Set the cookies
    res.cookie('session_token', token, cookieOptions);
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      domain: config.nodeEnv === 'production' ? '.qrevent.com' : undefined
    });

    logger.info('User logged in successfully', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

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
    logger.error('Login error:', {
      error: error.message,
      stack: error.stack,
      email: req.body.email,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// Get current user profile
const getProfile = async (req, res) => {
  try {
    // req.user should be populated by the authentication middleware
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
    console.error('Get profile error:', error);
    logger.error('Get profile error:', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    // Get refresh token before clearing cookies
    const refreshToken = req.cookies.refresh_token;

    // Clear the session cookies
    res.clearCookie('session_token', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/'
    });

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/'
    });

    // Revoke refresh token if present
    if (refreshToken) {
      const refreshTokenModule = require('../middleware/refreshToken');
      refreshTokenModule.revokeRefreshToken(req, res, () => {});
    }

    logger.info('User logged out successfully', {
      userId: req.user?.id,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    logger.error('Logout error:', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { name, email, preferences, avatar_url } = req.body;

    // Validate the incoming data with security considerations
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > 100 || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be a string with 2-100 characters'
        });
      }
      // Sanitize name to prevent XSS
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

    if (preferences !== undefined) {
      if (typeof preferences !== 'object' || Array.isArray(preferences)) {
        return res.status(400).json({
          success: false,
          message: 'Preferences must be an object'
        });
      }

      // Validate preferences structure to prevent deep nesting or malicious content
      const MAX_PREF_DEPTH = 3;
      const validateDepth = (obj, depth = 0) => {
        if (depth > MAX_PREF_DEPTH) {
          return false;
        }
        if (typeof obj === 'object' && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              if (!validateDepth(value, depth + 1)) {
                return false;
              }
            }
          }
        }
        return true;
      };

      if (!validateDepth(preferences)) {
        return res.status(400).json({
          success: false,
          message: 'Preferences object is too deeply nested'
        });
      }
    }

    // Check if email is already taken by another user
    if (email && email !== req.user.email) {
      try {
        const existingUser = await users.findByEmail(email.toLowerCase());
        if (existingUser && existingUser.id !== req.user.id) {
          return res.status(400).json({
            success: false,
            message: 'Email already in use by another user'
          });
        }
      } catch (error) {
        // If no user found with this email, continue
        if (!error.message.includes('Row not found')) {
          throw error;
        }
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email.toLowerCase(); // Store emails in lowercase
    
    // Handle avatar_url update - validate URL format and delete old avatar
    if (avatar_url !== undefined) {
      // avatar_url can be null (removing avatar) or a valid URL
      if (avatar_url !== null && avatar_url !== '') {
        try {
          new URL(avatar_url);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Invalid avatar URL format'
          });
        }
        
        // Delete old avatar from R2 if exists and different from new one
        const currentAvatarUrl = req.user.avatar_url;
        console.log('[Avatar Update] Checking old avatar:', {
          currentAvatarUrl,
          newAvatarUrl: avatar_url,
          shouldDelete: !!(currentAvatarUrl && currentAvatarUrl !== avatar_url)
        });
        
        if (currentAvatarUrl && currentAvatarUrl !== avatar_url) {
          try {
            console.log('[Avatar Update] Deleting old avatar from R2:', currentAvatarUrl);
            await storageService.deleteFile(currentAvatarUrl);
            logger.info('Old avatar deleted from R2', { 
              userId: req.user.id, 
              oldUrl: currentAvatarUrl 
            });
            console.log('[Avatar Update] Successfully deleted old avatar');
          } catch (deleteError) {
            // Log error but don't fail the update if delete fails
            console.error('[Avatar Update] Failed to delete old avatar:', deleteError.message);
            logger.warn('Failed to delete old avatar from R2', {
              userId: req.user.id,
              oldUrl: currentAvatarUrl,
              error: deleteError.message
            });
          }
        } else {
          console.log('[Avatar Update] No old avatar to delete or same URL');
        }
      }
      
      updateData.avatar_url = avatar_url;
    }

    // Handle preferences update
    if (preferences !== undefined) {
      // Merge new preferences with existing ones
      const sessionUtils = require('../utils/session');

      // Get current user data to preserve other fields
      const currentUser = await users.findById(req.user.id);
      const currentPreferences = currentUser.preferences || {};

      // Update preferences, ensuring we don't override sensitive fields
      const newPreferences = { ...currentPreferences, ...preferences };
      updateData.preferences = newPreferences;

      // Update session with new preferences
      await sessionUtils.updateSessionPreferences(res, req.user.id, newPreferences);
    }

    const updatedUser = await users.update(req.user.id, updateData);

    logger.info('User profile updated', {
      userId: req.user.id,
      updatedFields: Object.keys(updateData)
    });

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
    console.error('Update profile error:', error);
    logger.error('Update profile error:', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    // Check if the error is related to the Supabase update issue we fixed
    if (error.message.includes('Cannot coerce the result to a single JSON object')) {
      // This suggests the user might not exist anymore
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if avatar_url column is missing
    if (error.message.includes('avatar_url') || error.message.includes('column')) {
      logger.error('Database schema error - avatar_url column may be missing:', {
        error: error.message,
        hint: 'Run migration: backend/migrations/001_add_avatar_url.sql'
      });
      return res.status(500).json({
        success: false,
        message: 'Database configuration error. Please contact support.'
      });
    }

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