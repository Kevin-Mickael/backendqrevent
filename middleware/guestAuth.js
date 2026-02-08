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

    console.log('[GuestAuth] Token:', accessToken ? accessToken.substring(0, 20) + '...' : 'none');
    console.log('[GuestAuth] GameId:', gameId);

    if (!accessToken && !qrCode) {
      return res.status(401).json({
        success: false,
        message: 'Access token or QR code is required'
      });
    }

    let guestData = null;
    let accessType = null;
    const { supabaseService } = require('../config/supabase');

    // Vérifier si c'est un token d'accès
    if (accessToken) {
      // 1. Chercher dans game_guest_access
      const { data: guestAccess } = await supabaseService
        .from('game_guest_access')
        .select(`*, game:games(event_id)`)
        .eq('access_token', accessToken)
        .single();

      if (guestAccess) {
        console.log('[GuestAuth] Token trouvé dans game_guest_access');
        guestData = {
          ...guestAccess,
          event_id: guestAccess.game?.event_id
        };
        accessType = guestAccess.is_public ? 'public' : 'individual';
      } 
      // 2. Chercher dans game_family_access
      else {
        const { data: familyAccess } = await supabaseService
          .from('game_family_access')
          .select(`*, game:games(event_id)`)
          .eq('access_token', accessToken)
          .single();

        if (familyAccess) {
          console.log('[GuestAuth] Token trouvé dans game_family_access');
          guestData = {
            ...familyAccess,
            event_id: familyAccess.game?.event_id
          };
          accessType = 'family';
        }
        // 3. Token ancien format GAME-xxx ou token public non enregistré
        else if (gameId) {
          console.log('[GuestAuth] Token non trouvé, vérification dans les settings du jeu...');
          
          const { data: gameData } = await supabaseService
            .from('games')
            .select('id, event_id, settings')
            .eq('id', gameId)
            .single();
          
          if (gameData) {
            // Vérifier si c'est un ancien token GAME-xxx
            const settingsToken = gameData.settings?.accessCode;
            
            if (settingsToken === accessToken) {
              console.log('[GuestAuth] Token trouvé dans les settings du jeu (ancien format)');
              
              // Créer un accès public pour ce token
              const { data: newAccess, error: createError } = await supabaseService
                .from('game_guest_access')
                .insert([{
                  game_id: gameId,
                  guest_id: null,
                  access_token: accessToken,
                  is_public: true,
                  qr_code: `QR-OLD-${Date.now()}`
                }])
                .select()
                .single();
              
              if (newAccess) {
                guestData = {
                  ...newAccess,
                  event_id: gameData.event_id,
                  game: { event_id: gameData.event_id }
                };
                accessType = 'public';
                console.log('[GuestAuth] Accès créé automatiquement pour l\'ancien token');
              } else if (createError && createError.code === '23505') {
                // Token déjà existe (contrainte d'unicité), on le récupère
                const { data: existingAccess } = await supabaseService
                  .from('game_guest_access')
                  .select(`*, game:games(event_id)`)
                  .eq('access_token', accessToken)
                  .single();
                  
                if (existingAccess) {
                  guestData = {
                    ...existingAccess,
                    event_id: existingAccess.game?.event_id
                  };
                  accessType = 'public';
                }
              }
            } else {
              // Token inconnu mais format valide, créer un accès public temporaire
              console.log('[GuestAuth] Token inconnu, création accès temporaire...');
              
              const { data: tempAccess, error: tempError } = await supabaseService
                .from('game_guest_access')
                .insert([{
                  game_id: gameId,
                  guest_id: null,
                  access_token: accessToken,
                  is_public: true,
                  qr_code: `QR-TEMP-${Date.now()}`
                }])
                .select()
                .single();
                
              if (tempAccess) {
                guestData = {
                  ...tempAccess,
                  event_id: gameData.event_id,
                  game: { event_id: gameData.event_id }
                };
                accessType = 'public';
              } else if (tempError && tempError.code === '23505') {
                // Déjà existe
                const { data: existingAccess } = await supabaseService
                  .from('game_guest_access')
                  .select(`*, game:games(event_id)`)
                  .eq('access_token', accessToken)
                  .single();
                  
                if (existingAccess) {
                  guestData = {
                    ...existingAccess,
                    event_id: existingAccess.game?.event_id
                  };
                  accessType = 'public';
                }
              }
            }
          }
        }
      }
    }

    // Vérifier le QR code si pas de token
    if (!guestData && qrCode) {
      const qrData = await qrCodes.findByCode(qrCode);
      
      if (!qrData || !qrData.is_valid) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired QR code'
        });
      }

      if (qrData.family_id) {
        const family = await families.findById(qrData.family_id);
        if (family) {
          guestData = {
            family_id: family.id,
            qr_code: qrCode,
            game_id: gameId,
            event_id: qrData.event_id
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
            event_id: qrData.event_id
          };
          accessType = 'individual';
        }
      }
    }

    if (!guestData) {
      console.log('[GuestAuth] ❌ Aucune donnée invité trouvée');
      return res.status(403).json({
        success: false,
        message: 'Invalid access token or QR code'
      });
    }

    console.log('[GuestAuth] ✅ Accès trouvé, type:', accessType);

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
      } else {
        // Pour l'accès public, vérifier par access_token
        const { data: participation } = await supabaseService
          .from('game_participations')
          .select('*')
          .eq('game_id', gameId)
          .eq('access_token', accessToken)
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

    console.log('[GuestAuth] ✅ Authentification réussie');
    next();
  } catch (error) {
    console.error('[GuestAuth] ❌ Erreur:', error);
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

// Middleware optionnel
const optionalGuestAuth = async (req, res, next) => {
  try {
    const accessToken = req.query.token || req.headers['x-access-token'];
    const qrCode = req.query.qr;

    if (!accessToken && !qrCode) {
      req.guest = null;
      return next();
    }

    return authenticateGuest(req, res, next);
  } catch (error) {
    req.guest = null;
    next();
  }
};

module.exports = {
  authenticateGuest,
  generateGameAccessToken,
  optionalGuestAuth
};
