const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { users } = require('./database');

// Fonction pour générer un cookie de session sécurisé
const generateSecureSessionCookie = async (userId, options = {}) => {
  // Récupérer les préférences de l'utilisateur
  let userPreferences = {};
  try {
    const user = await users.findById(userId);
    if (user && user.preferences) {
      userPreferences = user.preferences;
    }
  } catch (error) {
    console.error('Error fetching user preferences for session:', error);
  }

  const payload = {
    userId: userId,
    preferences: userPreferences,  // Inclure les préférences dans le token
    // Ajouter d'autres données de session si nécessaire
  };

  // Créer le token JWT
  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpire,
    ...options
  });

  // Options de cookie sécurisé - RENFORCÉ
  // Respecte rules.md: cookies HTTP-only et Secure en production
  const isProduction = config.nodeEnv === 'production';
  
  const cookieOptions = {
    httpOnly: true,      // Empêche l'accès via JavaScript côté client
    secure: isProduction, // Uniquement via HTTPS en production (OBLIGATOIRE)
    sameSite: isProduction ? 'strict' : 'lax',  // 'lax' suffit pour localhost cross-port
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
    path: '/',           // Valide pour tout le site
    domain: isProduction ? process.env.COOKIE_DOMAIN || undefined : undefined
  };

  return {
    token,
    cookieOptions
  };
};

// Fonction pour vérifier un token de session
const verifySessionToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expiré');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Token invalide');
    } else {
      throw new Error('Erreur de vérification du token');
    }
  }
};

// Fonction pour extraire le token du cookie
const extractTokenFromCookie = (cookieHeader, cookieName = 'session_token') => {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, value] = cookie.trim().split('=');
    acc[name] = value;
    return acc;
  }, {});

  return cookies[cookieName] || null;
};

// Fonction pour mettre à jour les préférences dans le token de session
const updateSessionPreferences = async (res, userId, newPreferences) => {
  // Mettre à jour les préférences dans la base de données
  try {
    await users.update(userId, { preferences: newPreferences });
  } catch (error) {
    console.error('Error updating user preferences in database:', error);
    throw error;
  }

  // Générer un nouveau token avec les nouvelles préférences
  const { token, cookieOptions } = await generateSecureSessionCookie(userId);

  // Remplacer le cookie de session avec le nouveau token
  res.cookie('session_token', token, cookieOptions);
};

module.exports = {
  generateSecureSessionCookie,
  verifySessionToken,
  extractTokenFromCookie,
  updateSessionPreferences
};