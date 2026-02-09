/**
 * Auth Controller - Supabase Auth Version
 * 
 * Handles authentication endpoints using Supabase Auth.
 * Maintains backwards compatibility with existing API responses.
 */

const supabaseAuthService = require('../services/supabaseAuthService');
const { supabaseService } = require('../config/supabase');
const config = require('../config/config');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

// Cookie options helper
const getCookieOptions = (maxAge) => {
    const isProduction = config.nodeEnv === 'production';
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge,
        path: '/'
    };
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

        // Register with Supabase Auth
        const result = await supabaseAuthService.signUp({
            email: email.toLowerCase(),
            password,
            name: sanitizedName,
            role: 'organizer'
        });

        logger.info('New user registered via Supabase Auth', { email: email.toLowerCase() });

        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please check your email to confirm your account.',
            user: {
                id: result.user.id,
                name: result.user.name || sanitizedName,
                email: result.user.email || email.toLowerCase(),
                role: result.user.role || 'organizer',
                avatar_url: result.user.avatar_url,
                preferences: result.user.preferences || {
                    language: 'en',
                    theme: 'light',
                    notifications: true,
                    timezone: 'UTC'
                }
            },
            requiresEmailConfirmation: true
        });
    } catch (error) {
        logger.error('Registration error:', { error: error.message });

        // Handle specific Supabase errors
        if (error.message?.includes('already registered')) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email'
            });
        }

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
    const clientIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    const userAgent = req.get('User-Agent');

    try {
        const { email, password } = req.body;

        // Validation
        if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
            await auditService.logLoginAttempt(email || 'invalid_email', clientIP, userAgent, false, 'invalid_email_format');
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            await auditService.logLoginAttempt(email, clientIP, userAgent, false, 'invalid_password_format');
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Sign in with Supabase Auth
        const result = await supabaseAuthService.signIn({
            email: email.toLowerCase(),
            password
        });

        // Set session cookies
        res.cookie('sb-access-token', result.session.access_token, getCookieOptions(result.session.expires_in * 1000));
        res.cookie('sb-refresh-token', result.session.refresh_token, getCookieOptions(7 * 24 * 60 * 60 * 1000));

        // Also set legacy cookie name for backwards compatibility
        res.cookie('session_token', result.session.access_token, getCookieOptions(result.session.expires_in * 1000));

        // Log successful login
        await auditService.logLoginAttempt(email.toLowerCase(), clientIP, userAgent, true, null);
        await auditService.logEvent({
            userId: result.user.id,
            action: auditService.ACTIONS.LOGIN_SUCCESS,
            resourceType: auditService.RESOURCE_TYPES.USER,
            resourceId: result.user.id,
            ipAddress: clientIP,
            userAgent,
            details: { email: result.user.email, loginMethod: 'supabase_auth' },
            severity: auditService.SEVERITIES.INFO,
            success: true
        });

        logger.info('User logged in via Supabase Auth', { userId: result.user.id });

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: result.user.id,
                name: result.user.name,
                email: result.user.email,
                role: result.user.role,
                avatar_url: result.user.avatar_url,
                preferences: result.user.preferences || {
                    language: 'en',
                    theme: 'light',
                    notifications: true,
                    timezone: 'UTC'
                }
            }
        });
    } catch (error) {
        logger.error('Login error:', { error: error.message });

        // Log failed login
        await auditService.logLoginAttempt(req.body?.email || 'unknown', clientIP, userAgent, false, 'invalid_credentials');

        // Handle specific Supabase errors
        if (error.message?.includes('Invalid login credentials')) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Handle email not confirmed error
        if (error.message?.includes('Email not confirmed')) {
            return res.status(401).json({
                success: false,
                message: 'Please verify your email address before signing in. Check your inbox for a confirmation link.',
                code: 'EMAIL_NOT_CONFIRMED',
                email: req.body?.email
            });
        }

        if (error.message?.includes('Account is deactivated')) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated'
            });
        }

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
// Update user profile
// ============================================
const updateProfile = async (req, res) => {
    try {
        const { name, preferences, avatar_url } = req.body;
        const updates = {};

        // Validate name
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
            updates.name = sanitizedName;
        }

        if (avatar_url !== undefined) {
            updates.avatar_url = avatar_url;
        }

        if (preferences !== undefined) {
            updates.preferences = { ...req.user.preferences, ...preferences };
        }

        const updatedUser = await supabaseAuthService.updateProfile(req.supabaseUser.id, updates);

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

// ============================================
// Logout user
// ============================================
const logout = async (req, res) => {
    const clientIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    const userAgent = req.get('User-Agent');
    const isProduction = config.nodeEnv === 'production';

    try {
        const accessToken = req.cookies?.['sb-access-token'] || req.cookies?.session_token;

        // Sign out from Supabase
        await supabaseAuthService.signOut(accessToken);

        // Clear all auth cookies
        const clearCookieOptions = {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'strict' : 'lax',
            path: '/'
        };

        res.clearCookie('sb-access-token', clearCookieOptions);
        res.clearCookie('sb-refresh-token', clearCookieOptions);
        res.clearCookie('session_token', clearCookieOptions);
        res.clearCookie('refresh_token', clearCookieOptions);

        // Log logout
        await auditService.logEvent({
            userId: req.user?.id || null,
            action: auditService.ACTIONS.LOGOUT,
            resourceType: auditService.RESOURCE_TYPES.SESSION,
            ipAddress: clientIP,
            userAgent,
            details: { logoutMethod: 'manual' },
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
// Forgot password - send reset email
// ============================================
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        await supabaseAuthService.sendPasswordResetEmail(email.toLowerCase());

        // Always return success to prevent email enumeration
        res.json({
            success: true,
            message: 'If an account exists with this email, you will receive a password reset link'
        });
    } catch (error) {
        logger.error('Forgot password error:', { error: error.message });
        // Still return success to prevent email enumeration
        res.json({
            success: true,
            message: 'If an account exists with this email, you will receive a password reset link'
        });
    }
};

// ============================================
// Reset password with token
// ============================================
const resetPassword = async (req, res) => {
    try {
        const { password } = req.body;
        const accessToken = req.cookies?.['sb-access-token'] || req.headers.authorization?.replace('Bearer ', '');

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        await supabaseAuthService.updatePassword(accessToken, password);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });
    } catch (error) {
        logger.error('Reset password error:', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Server error during password reset'
        });
    }
};

// ============================================
// Resend email confirmation
// ============================================
const resendConfirmation = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string' || !/\S+@\S+\.\S+/.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        await supabaseAuthService.resendConfirmationEmail(email.toLowerCase());

        res.json({
            success: true,
            message: 'Confirmation email sent'
        });
    } catch (error) {
        logger.error('Resend confirmation error:', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Server error while sending confirmation email'
        });
    }
};

// ============================================
// Refresh session tokens
// ============================================
const refreshToken = async (req, res) => {
    try {
        const refreshTokenValue = req.cookies?.['sb-refresh-token'] || req.cookies?.refresh_token;

        if (!refreshTokenValue) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token required'
            });
        }

        const result = await supabaseAuthService.refreshSession(refreshTokenValue);

        if (!result.session) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        // Set new tokens
        res.cookie('sb-access-token', result.session.access_token, getCookieOptions(result.session.expires_in * 1000));
        res.cookie('sb-refresh-token', result.session.refresh_token, getCookieOptions(7 * 24 * 60 * 60 * 1000));
        res.cookie('session_token', result.session.access_token, getCookieOptions(result.session.expires_in * 1000));

        res.json({
            success: true,
            message: 'Session refreshed'
        });
    } catch (error) {
        logger.error('Refresh token error:', { error: error.message });
        res.status(401).json({
            success: false,
            message: 'Failed to refresh session'
        });
    }
};

module.exports = {
    register,
    login,
    getProfile,
    updateProfile,
    logout,
    forgotPassword,
    resetPassword,
    resendConfirmation,
    refreshToken
};
