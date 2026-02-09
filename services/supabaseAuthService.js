/**
 * Supabase Auth Service
 * 
 * Handles all authentication operations using Supabase Auth.
 * Provides a clean interface for signup, login, logout, and password management.
 */

const { supabaseService } = require('../config/supabase');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Sign up a new user
 * Creates both auth.users and public.users records
 */
const signUp = async ({ email, password, name, role = 'organizer' }) => {
    try {
        // Create user in Supabase Auth with metadata
        // Use signUp instead of admin.createUser to respect Supabase email confirmation settings
        const { data, error } = await supabaseService.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name,
                    role
                }
            }
        });

        if (error) {
            logger.error('Supabase signup error:', { error: error.message, email });
            throw error;
        }

        // The trigger will create the public.users record
        // But we'll fetch it to return complete user data
        const { data: userProfile, error: profileError } = await supabaseService
            .from('users')
            .select('*')
            .eq('auth_id', data.user.id)
            .single();

        if (profileError) {
            logger.warn('Profile not found after signup, trigger may be slow:', { authId: data.user.id });
        }

        logger.info('User signed up successfully', { userId: data.user.id, email });

        return {
            user: userProfile || {
                auth_id: data.user.id,
                email: data.user.email,
                name,
                role
            },
            authUser: data.user,
            session: null // No session until email is confirmed
        };
    } catch (error) {
        logger.error('SignUp service error:', { error: error.message });
        throw error;
    }
};

/**
 * Sign in with email and password
 * Returns session tokens for cookie storage
 */
const signIn = async ({ email, password }) => {
    try {
        const { data, error } = await supabaseService.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            logger.warn('Sign in failed:', { email, error: error.message });
            throw error;
        }

        // Fetch user profile
        const { data: userProfile, error: profileError } = await supabaseService
            .from('users')
            .select('*')
            .eq('auth_id', data.user.id)
            .single();

        if (profileError || !userProfile) {
            logger.error('User profile not found after sign in:', { authId: data.user.id });
            throw new Error('User profile not found');
        }

        if (!userProfile.is_active) {
            throw new Error('Account is deactivated');
        }

        logger.info('User signed in successfully', { userId: userProfile.id, email });

        return {
            user: userProfile,
            session: data.session
        };
    } catch (error) {
        logger.error('SignIn service error:', { error: error.message });
        throw error;
    }
};

/**
 * Sign out the current user
 * Revokes refresh tokens on server side
 */
const signOut = async (accessToken) => {
    try {
        if (!accessToken) {
            return { success: true };
        }

        // Get user from token to log the action
        const { data: { user } } = await supabaseService.auth.getUser(accessToken);

        // Sign out using the admin API to invalidate all sessions
        if (user) {
            await supabaseService.auth.admin.signOut(accessToken);
            logger.info('User signed out successfully', { userId: user.id });
        }

        return { success: true };
    } catch (error) {
        logger.error('SignOut service error:', { error: error.message });
        // Don't throw - let user logout client-side even if server fails
        return { success: true };
    }
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (email) => {
    try {
        const redirectTo = `${config.frontendUrl}/reset-password`;

        const { error } = await supabaseService.auth.resetPasswordForEmail(email, {
            redirectTo
        });

        if (error) {
            logger.error('Password reset email failed:', { email, error: error.message });
            throw error;
        }

        logger.info('Password reset email sent', { email });
        return { success: true };
    } catch (error) {
        logger.error('Password reset service error:', { error: error.message });
        throw error;
    }
};

/**
 * Update user password (after reset)
 */
const updatePassword = async (accessToken, newPassword) => {
    try {
        const { data: { user }, error: userError } = await supabaseService.auth.getUser(accessToken);

        if (userError || !user) {
            throw new Error('Invalid session');
        }

        const { error } = await supabaseService.auth.admin.updateUserById(user.id, {
            password: newPassword
        });

        if (error) {
            logger.error('Password update failed:', { userId: user.id, error: error.message });
            throw error;
        }

        logger.info('Password updated successfully', { userId: user.id });
        return { success: true };
    } catch (error) {
        logger.error('UpdatePassword service error:', { error: error.message });
        throw error;
    }
};

/**
 * Resend email confirmation
 */
const resendConfirmationEmail = async (email) => {
    try {
        const { error } = await supabaseService.auth.resend({
            type: 'signup',
            email
        });

        if (error) {
            logger.error('Resend confirmation failed:', { email, error: error.message });
            throw error;
        }

        logger.info('Confirmation email resent', { email });
        return { success: true };
    } catch (error) {
        logger.error('ResendConfirmation service error:', { error: error.message });
        throw error;
    }
};

/**
 * Update user profile in public.users
 * Note: Email changes require verification through Supabase Auth
 */
const updateProfile = async (authId, updates) => {
    try {
        const allowedFields = ['name', 'avatar_url', 'preferences'];
        const safeUpdates = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                safeUpdates[field] = updates[field];
            }
        }

        if (Object.keys(safeUpdates).length === 0) {
            throw new Error('No valid fields to update');
        }

        const { data, error } = await supabaseService
            .from('users')
            .update(safeUpdates)
            .eq('auth_id', authId)
            .select()
            .single();

        if (error) {
            logger.error('Profile update failed:', { authId, error: error.message });
            throw error;
        }

        logger.info('Profile updated successfully', { userId: data.id });
        return data;
    } catch (error) {
        logger.error('UpdateProfile service error:', { error: error.message });
        throw error;
    }
};

/**
 * Get user profile by auth_id
 */
const getProfileByAuthId = async (authId) => {
    try {
        const { data, error } = await supabaseService
            .from('users')
            .select('*')
            .eq('auth_id', authId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null; // User not found
            }
            throw error;
        }

        return data;
    } catch (error) {
        logger.error('GetProfile service error:', { error: error.message });
        throw error;
    }
};

/**
 * Verify and refresh session
 */
const refreshSession = async (refreshToken) => {
    try {
        const { data, error } = await supabaseService.auth.refreshSession({
            refresh_token: refreshToken
        });

        if (error) {
            throw error;
        }

        return data;
    } catch (error) {
        logger.error('RefreshSession service error:', { error: error.message });
        throw error;
    }
};

module.exports = {
    signUp,
    signIn,
    signOut,
    sendPasswordResetEmail,
    updatePassword,
    resendConfirmationEmail,
    updateProfile,
    getProfileByAuthId,
    refreshSession
};
