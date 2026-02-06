const jwt = require('jsonwebtoken');
const { families, guests, qrCodes, events, games } = require('../utils/database');
const config = require('../config/config');

// Middleware pour authentifier un invité via QR code ou token d'accès
const authenticateGuest = async (req, res, next) => {
  try {
    // Essayer de récupérer le token d'accès ou le QR code
    const accessToken = req.query.token || req.body.accessToken || req.headers['x-access-token'];
    const qrCode = req.query.qr || req.body.qrCode;
    const gameId = req.params.gameId || req.body.gameId;

    if (!accessToken && !qrCode) {
      return res.status(401).json({
        success: false,
        message: 'Access token or QR code is required'
      });
    }

    let guestData = null;
    let accessType = null; // 'family' ou 'individual'

    // Vérifier si c'est un token d'accès
    if (accessToken) {
      const { supabaseService } = require('../config/supabase');
      
      // Chercher dans game_family_access avec infos du jeu
      const { data: familyAccess, error: familyError } = await supabaseService
        .from('game_family_access')
        .select(`
          *,
          game:games(event_id)
        `)
        .eq('access_token', accessToken)
        .single();

      if (familyAccess) {
        guestData = {
          ...familyAccess,
          event_id: familyAccess.game?.event_id  // ← Important pour la vérification IDOR
        };
        accessType = 'family';
      } else {
        // Chercher dans game_guest_access avec infos du jeu
        const { data: guestAccess, error: guestError } = await supabaseService
          .from('game_guest_access')
          .select(`
            *,
            game:games(event_id)
          `)
          .eq('access_token', accessToken)
          .single();

        if (guestAccess) {
          guestData = {
            ...guestAccess,
            event_id: guestAccess.game?.event_id  // ← Important pour la vérification IDOR
          };
          accessType = 'individual';
        }
      }
    }

    // Sinon, vérifier le QR code
    if (!guestData && qrCode) {
      const qrData = await qrCodes.findByCode(qrCode);
      
      if (!qrData || !qrData.is_valid) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired QR code'
        });
      }

      // Vérifier si le QR code est lié à une famille ou un invité
      // 🛡️ SECURITY: Include event_id for later verification
      if (qrData.family_id) {
        const family = await families.findById(qrData.family_id);
        if (family) {
          guestData = {
            family_id: family.id,
            qr_code: qrCode,
            game_id: gameId,
            event_id: qrData.event_id  // ← Important pour la vérification IDOR
          };
          accessType = 'family';
        }
      } else if (qrData.guest_id) {
        const guest = await guests.findById(qrData.guest_id);
        if (guest) {
          guestData = {
            guest_id: guest.id,
            qr_code: qrCode,
            game_id: gameId,
            event_id: qrData.event_id  // ← Important pour la vérification IDOR
          };
          accessType = 'individual';
        }
      }
    }

    if (!guestData) {
      return res.status(403).json({
        success: false,
        message: 'Invalid access token or QR code'
      });
    }

    // Vérifier que le jeu existe et est actif
    if (gameId) {
      const game = await games.findById(gameId);
      if (!game || !game.is_active) {
        return res.status(404).json({
          success: false,
          message: 'Game not found or inactive'
        });
      }

      if (game.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: `Game is ${game.status}. Cannot play at this time.`
        });
      }

      // Vérifier si l'invité a déjà joué
      const { supabaseService } = require('../config/supabase');
      let hasPlayed = false;

      if (accessType === 'family' && guestData.family_id) {
        const { data: participation } = await supabaseService
          .from('game_participations')
          .select('*')
          .eq('game_id', gameId)
          .eq('family_id', guestData.family_id)
          .eq('is_completed', true)
          .single();
        hasPlayed = !!participation;
      } else if (accessType === 'individual' && guestData.guest_id) {
        const { data: participation } = await supabaseService
          .from('game_participations')
          .select('*')
          .eq('game_id', gameId)
          .eq('guest_id', guestData.guest_id)
          .eq('is_completed', true)
          .single();
        hasPlayed = !!participation;
      }

      if (hasPlayed) {
        return res.status(403).json({
          success: false,
          message: 'You have already played this game'
        });
      }
    }

    // Attacher les données de l'invité à la requête
    req.guest = {
      ...guestData,
      accessType,
      isGuest: true
    };

    next();
  } catch (error) {
    console.error('Guest authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during guest authentication'
    });
  }
};

// Générer un token d'accès pour un jeu
const generateGameAccessToken = async (gameId, familyId, guestId, qrCode) => {
  try {
    const { supabaseService } = require('../config/supabase');
    
    // Générer un token unique
    const crypto = require('crypto');
    const accessToken = crypto.randomBytes(32).toString('base64url');

    if (familyId) {
      const { data, error } = await supabaseService
        .from('game_family_access')
        .insert([{
          game_id: gameId,
          family_id: familyId,
          qr_code: qrCode,
          access_token: accessToken
        }])
        .select()
        .single();

      if (error) throw error;
      return { token: accessToken, type: 'family' };
    } else if (guestId) {
      const { data, error } = await supabaseService
        .from('game_guest_access')
        .insert([{
          game_id: gameId,
          guest_id: guestId,
          qr_code: qrCode,
          access_token: accessToken
        }])
        .select()
        .single();

      if (error) throw error;
      return { token: accessToken, type: 'individual' };
    }

    throw new Error('Either familyId or guestId is required');
  } catch (error) {
    console.error('Error generating access token:', error);
    throw error;
  }
};

// Middleware optionnel - vérifie si l'invité est authentifié mais ne bloque pas
const optionalGuestAuth = async (req, res, next) => {
  try {
    const accessToken = req.query.token || req.headers['x-access-token'];
    const qrCode = req.query.qr;

    if (!accessToken && !qrCode) {
      // Pas d'authentification, mais on continue
      req.guest = null;
      return next();
    }

    // Sinon, utiliser le middleware complet
    return authenticateGuest(req, res, next);
  } catch (error) {
    // En cas d'erreur, continuer sans auth
    req.guest = null;
    next();
  }
};

module.exports = {
  authenticateGuest,
  generateGameAccessToken,
  optionalGuestAuth
};
