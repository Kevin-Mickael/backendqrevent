const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { users } = require('../utils/database');
const logger = require('../utils/logger');

// In-memory store for refresh tokens (in production, use Redis or database)
const refreshTokensStore = new Map();

// Generate a refresh token
const generateRefreshToken = (userId) => {
  // Create a refresh token with longer expiry
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: '7d' } // 7 days expiry for refresh token
  );

  // Store the refresh token
  refreshTokensStore.set(refreshToken, userId);

  return refreshToken;
};

// Verify a refresh token
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    // Check if token exists in store
    if (!refreshTokensStore.has(token)) {
      throw new Error('Refresh token not found');
    }
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Clean up expired token
      refreshTokensStore.delete(token);
      throw new Error('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    } else {
      throw error;
    }
  }
};

// Middleware to handle token refresh
const handleTokenRefresh = async (req, res, next) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    // No refresh token, continue with normal flow
    return next();
  }

  try {
    // Verify the refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Check if user still exists and is active
    const user = await users.findById(decoded.userId);
    if (!user || !user.is_active) {
      // Invalid user, remove refresh token and continue
      refreshTokensStore.delete(refreshToken);
      return next();
    }

    // Generate new access token
    const sessionUtils = require('../utils/session');
    const { token: newAccessToken, cookieOptions } = await sessionUtils.generateSecureSessionCookie(decoded.userId);

    // Send new access token in response header
    res.setHeader('X-New-Access-Token', newAccessToken);

    // Update the access token in the request for downstream middleware
    const newDecodedToken = jwt.verify(newAccessToken, config.jwtSecret);
    req.user = await users.findById(newDecodedToken.userId);

    logger.info('Access token refreshed automatically', {
      userId: decoded.userId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    next();
  } catch (error) {
    logger.warn('Failed to refresh access token', {
      error: error.message,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Remove invalid refresh token
    refreshTokensStore.delete(refreshToken);
    
    // Continue with normal flow - authentication middleware will handle lack of valid access token
    next();
  }
};

// Endpoint to exchange refresh token for new access token
const refreshAccessToken = async (req, res) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: 'Refresh token required'
    });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    // Check if user still exists and is active
    const user = await users.findById(decoded.userId);
    if (!user || !user.is_active) {
      refreshTokensStore.delete(refreshToken);
      return res.status(401).json({
        success: false,
        message: 'Invalid user'
      });
    }

    // Generate new access token
    const sessionUtils = require('../utils/session');
    const { token: newAccessToken, cookieOptions } = await sessionUtils.generateSecureSessionCookie(decoded.userId);

    // Generate new refresh token to prevent reuse
    const newRefreshToken = generateRefreshToken(decoded.userId);
    
    // Set new refresh token as cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      domain: config.nodeEnv === 'production' ? '.qrevent.com' : undefined
    });

    logger.info('Access token refreshed via endpoint', {
      userId: decoded.userId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    logger.warn('Failed to refresh access token via endpoint', {
      error: error.message,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    refreshTokensStore.delete(refreshToken);
    
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
};

// Middleware to revoke refresh token (logout)
const revokeRefreshToken = (req, res, next) => {
  const refreshToken = req.cookies.refresh_token;
  
  if (refreshToken) {
    refreshTokensStore.delete(refreshToken);
  }
  
  next();
};

module.exports = {
  generateRefreshToken,
  verifyRefreshToken,
  handleTokenRefresh,
  refreshAccessToken,
  revokeRefreshToken
};