const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateGuest, optionalGuestAuth } = require('../middleware/guestAuth');
const { authenticateToken } = require('../middleware/auth');
const { games } = require('../utils/database');
const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas - simplified to accept various formats
const playGameSchema = celebrate({
  [Segments.BODY]: Joi.object().keys({
    answers: Joi.alternatives().try(
      Joi.array().items(Joi.object({
        questionId: Joi.string().uuid().required(),
        answer: Joi.alternatives().try(Joi.string().allow(''), Joi.boolean()).required(),
        timeSpent: Joi.number().integer().min(0).optional()
      })),
      Joi.object().pattern(Joi.string(), Joi.object({
        questionId: Joi.string().uuid().required(),
        answer: Joi.alternatives().try(Joi.string().allow(''), Joi.boolean()).required(),
        timeSpent: Joi.number().integer().min(0).optional()
      }))
    ).required(),
    playerName: Joi.alternatives().try(Joi.string().max(100).allow(''), Joi.any()).optional(),
    accessToken: Joi.string().optional()
  }).unknown(true)
});

// ==================== ROUTES PUBLIQUES POUR INVITÉS ====================

// GET /api/games/public/:gameId - Récupérer un jeu public (sans les réponses)
router.get('/public/:gameId', authenticateGuest, async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await games.getGameWithQuestions(gameId);

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

    // 🛡️ SECURITY: Verify that the game belongs to the guest's event (IDOR protection)
    if (game.event_id !== req.guest.event_id) {
      console.warn('[IDOR Attempt] Guest tried to access game from different event:', {
        guestEventId: req.guest.event_id,
        gameEventId: game.event_id,
        gameId: gameId
      });
      return res.status(403).json({
        success: false,
        message: 'This game is not part of your event'
      });
    }

    // Masquer les réponses correctes
    const sanitizedQuestions = game.questions.map(q => ({
      id: q.id,
      question: q.question,
      question_type: q.question_type,
      options: q.options ? q.options.map(opt => ({
        text: opt.text,
        // Ne pas inclure isCorrect ici !
      })) : null,
      points: q.points,
      sort_order: q.sort_order,
      media_url: q.media_url,
      time_limit: q.time_limit
    }));

    res.json({
      success: true,
      data: {
        id: game.id,
        name: game.name,
        type: game.type,
        description: game.description,
        total_questions: game.total_questions,
        questions: sanitizedQuestions,
        guest: {
          accessType: req.guest.accessType,
          hasPlayed: req.guest.has_played || false
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching public game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching game'
    });
  }
});

// Helper to get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

// POST /api/games/public/:gameId/play - Jouer à un jeu
router.post('/public/:gameId/play', authenticateGuest, playGameSchema, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { answers, playerName } = req.body;
    
    // 🛡️ DEBUG: Log incoming request details
    console.log('[PlayGame] Request received:', {
      gameId,
      body: req.body,
      bodyType: typeof req.body,
      answersType: typeof answers,
      isArray: Array.isArray(answers),
      answersLength: answers ? (Array.isArray(answers) ? answers.length : Object.keys(answers).length) : 0,
      playerName,
      token: req.query.token || req.body.accessToken,
      guest: req.guest ? { 
        event_id: req.guest.event_id, 
        accessType: req.guest.accessType,
        guest_id: req.guest.guest_id,
        family_id: req.guest.family_id
      } : null
    });
    
    // 🛡️ SECURITY: Verify guest authentication
    if (!req.guest) {
      console.error('[PlayGame] ❌ No guest data in request');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // 🛡️ SECURITY: Get and check client IP
    const clientIP = getClientIP(req);
    console.log('[IP Check] Game:', gameId, 'IP:', clientIP);

    // Vérifier que le jeu existe et est actif
    const game = await games.getGameWithQuestions(gameId);
    if (!game || !game.is_active || game.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Game not found or not active'
      });
    }

    // 🛡️ SECURITY: Verify guest has event_id
    if (!req.guest.event_id) {
      console.error('[PlayGame] ❌ Guest has no event_id:', req.guest);
      return res.status(400).json({
        success: false,
        message: 'Invalid guest data: missing event_id'
      });
    }
    
    // 🛡️ SECURITY: Verify that the game belongs to the guest's event (IDOR protection)
    if (game.event_id !== req.guest.event_id) {
      console.warn('[IDOR Attempt] Guest tried to play game from different event:', {
        guestEventId: req.guest.event_id,
        gameEventId: game.event_id,
        gameId: gameId
      });
      return res.status(403).json({
        success: false,
        message: 'This game is not part of your event'
      });
    }

    // 🛡️ SECURITY: Check if this IP has already played this game
    const { data: existingIP, error: ipError } = await supabaseService
      .from('game_ip_tracking')
      .select('*')
      .eq('game_id', gameId)
      .eq('ip_address', clientIP)
      .single();
    
    if (ipError && ipError.code !== 'PGRST116') { // PGRST116 = not found, which is expected
      console.error('[IP Check] Error:', ipError);
    }
    
    if (existingIP) {
      console.warn('[IP Blocked] IP already played:', clientIP, 'Game:', gameId);
      return res.status(403).json({
        success: false,
        message: 'Vous avez déjà joué à ce jeu depuis cet appareil. Chaque participant ne peut jouer qu\'une seule fois.',
        code: 'ALREADY_PLAYED_IP'
      });
    }

    // Vérifier si déjà joué (par token/access)
    const { data: existingParticipation } = await supabaseService
      .from('game_participations')
      .select('*')
      .eq('game_id', gameId)
      .eq('access_token', req.query.token || req.body.accessToken)
      .eq('is_completed', true)
      .single();

    if (existingParticipation) {
      return res.status(403).json({
        success: false,
        message: 'Vous avez déjà terminé ce jeu',
        code: 'ALREADY_PLAYED',
        data: {
          score: existingParticipation.total_score,
          rank: existingParticipation.rank
        }
      });
    }

    // Normalize answers to array (handle both array and object with numeric keys)
    let answersArray = answers;
    if (!Array.isArray(answers) && typeof answers === 'object') {
      answersArray = Object.values(answers);
    }
    
    // 🛡️ SECURITY: Validate answers array
    if (!Array.isArray(answersArray) || answersArray.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid answers format'
      });
    }
    
    console.log('[Play] Processing', answersArray.length, 'answers');

    // Calculer le score
    let totalScore = 0;
    let correctAnswers = 0;
    const answerRecords = [];

    for (const userAnswer of answersArray) {
      const question = game.questions.find(q => q.id === userAnswer.questionId);
      if (!question) continue;

      let isCorrect = false;
      let pointsEarned = 0;

      switch (question.question_type) {
        case 'multiple_choice':
          const correctOption = question.options?.find(opt => opt.isCorrect);
          if (correctOption && correctOption.text === userAnswer.answer) {
            isCorrect = true;
            pointsEarned = question.points;
          }
          break;
        
        case 'text':
          if (question.correct_answer && 
              question.correct_answer.toLowerCase().trim() === userAnswer.answer.toLowerCase().trim()) {
            isCorrect = true;
            pointsEarned = question.points;
          }
          break;
        
        case 'boolean':
          if (question.correct_answer === userAnswer.answer) {
            isCorrect = true;
            pointsEarned = question.points;
          }
          break;
        
        default:
          // Pour les autres types, on enregistre sans score automatique
          pointsEarned = 0;
      }

      if (isCorrect) {
        totalScore += pointsEarned;
        correctAnswers++;
      }

      answerRecords.push({
        question_id: userAnswer.questionId,
        answer: userAnswer.answer,
        is_correct: isCorrect,
        points_earned: pointsEarned
      });
    }

    // Créer ou mettre à jour la participation
    const accessType = req.guest.accessType || 'public';
    
    // 🛡️ DEBUG: Log participation data before insert
    const participationData = {
      game_id: gameId,
      guest_id: accessType === 'individual' ? req.guest.guest_id : null,
      family_id: accessType === 'family' ? req.guest.family_id : null,
      qr_code: req.guest.qr_code,
      access_token: req.query.token || req.body.accessToken,
      player_name: playerName || (accessType === 'family' ? 'Famille' : 'Invité'),
      player_type: accessType,
      total_score: totalScore,
      correct_answers: correctAnswers,
      total_answers: answersArray.length,
      is_completed: true,
      completed_at: new Date().toISOString()
    };
    console.log('[PlayGame] Inserting participation:', participationData);
    
    const { data: participation, error: partError } = await supabaseService
      .from('game_participations')
      .insert([participationData])
      .select()
      .single();

    if (partError) {
      console.error('[PlayGame] ❌ Error inserting participation:', partError);
      throw partError;
    }
    
    console.log('[PlayGame] ✅ Participation inserted:', participation.id);

    // Enregistrer les réponses détaillées
    if (answerRecords.length > 0) {
      console.log('[PlayGame] Saving answers:', answerRecords.map(a => ({...a, participation_id: participation.id})));
      const { error: answersError } = await supabaseService
        .from('game_answers')
        .insert(answerRecords.map(a => ({
          ...a,
          participation_id: participation.id
        })));

      if (answersError) {
        console.error('[PlayGame] ❌ Error saving answers:', answersError);
        logger.error('Error saving answers:', { error: answersError.message });
      } else {
        console.log('[PlayGame] ✅ Answers saved successfully');
      }
    }

    // Mettre à jour le statut dans la table d'accès (si l'accès existe dans les tables)
    if (req.guest.accessType === 'family' && req.guest.id) {
      await supabaseService
        .from('game_family_access')
        .update({ 
          has_played: true, 
          played_at: new Date().toISOString(),
          score: totalScore 
        })
        .eq('id', req.guest.id);
    } else if (req.guest.accessType === 'individual' && req.guest.id) {
      await supabaseService
        .from('game_guest_access')
        .update({ 
          has_played: true, 
          played_at: new Date().toISOString(),
          score: totalScore 
        })
        .eq('id', req.guest.id);
    }
    // Pour l'accès public (pas d'ID dans game_guest_access), on ne met à jour aucune table d'accès
    // La participation est déjà enregistrée dans game_participations
    
    // 🛡️ SECURITY: Record IP address to prevent multiple plays
    try {
      await supabaseService
        .from('game_ip_tracking')
        .insert([{
          game_id: gameId,
          ip_address: clientIP,
          user_agent: req.headers['user-agent'] || null,
          score: totalScore,
          player_name: playerName || 'Anonyme'
        }]);
      console.log('[IP Recorded] IP:', clientIP, 'Game:', gameId);
    } catch (ipRecordError) {
      // Log but don't fail the request if IP recording fails
      console.error('[IP Record] Error:', ipRecordError.message);
    }

    // 🔧 CORRECTION: Calcul direct du rang depuis game_participations
    console.log('[PlayGame] Calculating player rank for game:', gameId);
    
    // Recalculer et mettre à jour le rang de ce joueur
    const { data: allParticipations, error: rankError } = await supabaseService
      .from('game_participations')
      .select('id, total_score, completed_at')
      .eq('game_id', gameId)
      .eq('is_completed', true)
      .order('total_score', { ascending: false })
      .order('completed_at', { ascending: true });

    let playerRank = null;
    let totalParticipants = 0;

    if (rankError) {
      console.error('[PlayGame] ❌ Error calculating rank:', rankError);
    } else {
      totalParticipants = allParticipations.length;
      
      // Calculer le rang du joueur actuel
      const playerIndex = allParticipations.findIndex(p => p.id === participation.id);
      playerRank = playerIndex >= 0 ? playerIndex + 1 : null;
      
      // Mettre à jour le rang dans la base de données pour tous les participants
      for (let i = 0; i < allParticipations.length; i++) {
        const currentParticipation = allParticipations[i];
        const currentRank = i + 1;
        
        await supabaseService
          .from('game_participations')
          .update({ rank: currentRank })
          .eq('id', currentParticipation.id);
      }
      
      console.log(`[PlayGame] ✅ Rank calculated: ${playerRank}/${totalParticipants}`);
    }

    res.json({
      success: true,
      message: 'Game completed successfully',
      data: {
        score: totalScore,
        correctAnswers,
        totalQuestions: game.total_questions,
        rank: playerRank,
        totalParticipants: totalParticipants
      }
    });
  } catch (error) {
    // 🛡️ SECURITY: Log detailed error for audit and debugging
    logger.error('Error playing game:', { 
      error: error.message,
      stack: error.stack,
      gameId: req.params.gameId,
      guestEventId: req.guest?.event_id,
      guestType: req.guest?.accessType,
      playerName: req.body?.playerName
    });
    
    // Return detailed error message in development, generic in production
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
      success: false,
      message: 'Server error while processing game',
      error: isDev ? error.message : undefined
    });
  }
});

// POST /api/games/public/:gameId/validate-answer - Valider une réponse individuelle
router.post('/public/:gameId/validate-answer', authenticateGuest, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { questionId, answer } = req.body;
    
    // 🛡️ SECURITY: Check if IP has already played
    const clientIP = getClientIP(req);
    const { data: existingIP } = await supabaseService
      .from('game_ip_tracking')
      .select('*')
      .eq('game_id', gameId)
      .eq('ip_address', clientIP)
      .single();
    
    if (existingIP) {
      return res.status(403).json({
        success: false,
        message: 'Vous avez déjà joué à ce jeu depuis cet appareil.',
        code: 'ALREADY_PLAYED_IP'
      });
    }

    // Récupérer le jeu avec les questions
    const game = await games.getGameWithQuestions(gameId);
    if (!game || !game.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Vérifier que le jeu appartient à l'événement de l'invité
    if (game.event_id !== req.guest.event_id) {
      return res.status(403).json({
        success: false,
        message: 'This game is not part of your event'
      });
    }

    // Trouver la question
    const question = game.questions.find(q => q.id === questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // Vérifier la réponse
    let isCorrect = false;
    let correctAnswer = null;

    console.log('[Validate] Question:', question.question);
    console.log('[Validate] Question type:', question.question_type);
    console.log('[Validate] User answer:', answer);
    console.log('[Validate] Options:', question.options);

    switch (question.question_type) {
      case 'multiple_choice':
        const correctOption = question.options?.find(opt => opt.isCorrect);
        correctAnswer = correctOption?.text || '';
        console.log('[Validate] Correct option:', correctOption);
        console.log('[Validate] Correct answer text:', correctAnswer);
        if (correctOption && correctOption.text === answer) {
          isCorrect = true;
        }
        break;
      
      case 'text':
        correctAnswer = question.correct_answer || '';
        if (question.correct_answer && 
            question.correct_answer.toLowerCase().trim() === answer.toLowerCase().trim()) {
          isCorrect = true;
        }
        break;
      
      case 'boolean':
        correctAnswer = question.correct_answer || '';
        if (question.correct_answer === answer) {
          isCorrect = true;
        }
        break;
      
      default:
        correctAnswer = question.correct_answer || '';
    }

    console.log('[Validate] Response:', { isCorrect, correctAnswer, userAnswer: answer });

    res.json({
      success: true,
      data: {
        isCorrect,
        correctAnswer,
        userAnswer: answer,
        points: isCorrect ? question.points : 0
      }
    });
  } catch (error) {
    logger.error('Error validating answer:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while validating answer'
    });
  }
});

// GET /api/games/public/:gameId/leaderboard - Classement public d'un jeu
router.get('/public/:gameId/leaderboard', optionalGuestAuth, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const game = await games.findById(gameId);
    if (!game || !game.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // 🔧 CORRECTION: Récupérer le classement avec calcul des rangs corrects
    const { data: participations, error } = await supabaseService
      .from('game_participations')
      .select(`
        id,
        total_score,
        correct_answers,
        total_answers,
        completed_at,
        player_name,
        player_type,
        family_id,
        guest_id,
        rank
      `)
      .eq('game_id', gameId)
      .eq('is_completed', true)
      .order('total_score', { ascending: false })
      .order('completed_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Recalculer les rangs si nécessaire (au cas où ils seraient manquants)
    if (participations && participations.length > 0) {
      const hasInvalidRanks = participations.some((p, index) => !p.rank || p.rank !== index + 1);
      
      if (hasInvalidRanks) {
        console.log(`[Leaderboard] Recalculating ranks for game ${gameId}...`);
        for (let i = 0; i < participations.length; i++) {
          const newRank = i + 1;
          await supabaseService
            .from('game_participations')
            .update({ rank: newRank })
            .eq('id', participations[i].id);
          
          participations[i].rank = newRank;
        }
        console.log(`[Leaderboard] ✅ Updated ${participations.length} ranks`);
      }
    }

    // Récupérer les noms des familles et invités si nécessaire
    const leaderboard = await Promise.all((participations || []).map(async (entry, index) => {
      let playerName = entry.player_name;
      
      // Si pas de player_name, essayer de récupérer le nom
      if (!playerName) {
        if (entry.family_id) {
          const { data: family } = await supabaseService
            .from('families')
            .select('name')
            .eq('id', entry.family_id)
            .single();
          playerName = family?.name || 'Une famille';
        } else if (entry.guest_id) {
          const { data: guest } = await supabaseService
            .from('guests')
            .select('first_name, last_name')
            .eq('id', entry.guest_id)
            .single();
          playerName = guest ? `${guest.first_name} ${guest.last_name}` : 'Un invité';
        } else {
          playerName = 'Anonyme';
        }
      }

      return {
        rank: entry.rank || index + 1,
        playerName: playerName,
        score: entry.total_score,
        correctAnswers: entry.correct_answers,
        totalAnswers: entry.total_answers,
        isTop3: (entry.rank || index + 1) <= 3
      };
    }));

    res.json({
      success: true,
      data: {
        gameName: game.name,
        gameStatus: game.status,
        totalParticipants: leaderboard.length,
        leaderboard: leaderboard
      }
    });
  } catch (error) {
    logger.error('Error fetching leaderboard:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching leaderboard'
    });
  }
});

// GET /api/games/public/:gameId/my-result - Résultat personnel (pour l'invité connecté)
router.get('/public/:gameId/my-result', authenticateGuest, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const { data: participation } = await supabaseService
      .from('game_participations')
      .select('*')
      .eq('game_id', gameId)
      .eq(req.guest.accessType === 'family' ? 'family_id' : 'guest_id',
           req.guest.accessType === 'family' ? req.guest.family_id : req.guest.guest_id)
      .eq('is_completed', true)
      .single();

    if (!participation) {
      return res.status(404).json({
        success: false,
        message: 'You have not played this game yet'
      });
    }

    // Récupérer les réponses détaillées
    const { data: answers } = await supabaseService
      .from('game_answers')
      .select(`
        *,
        question:game_questions(question, correct_answer, points)
      `)
      .eq('participation_id', participation.id);

    res.json({
      success: true,
      data: {
        score: participation.total_score,
        rank: participation.rank,
        correctAnswers: participation.correct_answers,
        totalAnswers: participation.total_answers,
        completedAt: participation.completed_at,
        answers: answers || []
      }
    });
  } catch (error) {
    logger.error('Error fetching my result:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching result'
    });
  }
});

// ==================== ROUTES PRIVÉES POUR ORGANISATEURS ====================

// POST /api/games/:gameId/generate-access - Générer des tokens d'accès pour tous les invités
router.post('/:gameId/generate-access', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { eventId } = req.body;

    // Vérifier que le jeu appartient à l'événement de l'organisateur
    const game = await games.findById(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Vérifier l'ownership de l'événement
    const { events, guests, families, qrCodes } = require('../utils/database');
    const event = await events.findById(game.event_id);
    
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Récupérer tous les invités avec QR codes
    const eventGuests = await guests.findByEvent(game.event_id);
    const { generateGameAccessToken } = require('../middleware/guestAuth');
    
    const tokens = [];
    const errors = [];

    for (const guest of eventGuests) {
      try {
        if (guest.qr_code) {
          const result = await generateGameAccessToken(gameId, null, guest.id, guest.qr_code);
          tokens.push({
            guestId: guest.id,
            guestName: `${guest.first_name} ${guest.last_name}`,
            token: result.token,
            type: 'individual'
          });
        }
      } catch (err) {
        errors.push({ guestId: guest.id, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Generated ${tokens.length} access tokens`,
      data: {
        tokens,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    logger.error('Error generating access tokens:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while generating access tokens'
    });
  }
});

// GET /api/games/:gameId/full-leaderboard - Classement complet avec détails (organisateur uniquement)
router.get('/:gameId/full-leaderboard', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const game = await games.findById(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Vérifier l'ownership
    const { events } = require('../utils/database');
    const event = await events.findById(game.event_id);
    
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Récupérer le classement depuis la table game_participations
    const { data: participations, error } = await supabaseService
      .from('game_participations')
      .select(`
        id,
        total_score,
        correct_answers,
        total_answers,
        completed_at,
        player_name,
        player_type,
        family_id,
        guest_id,
        rank
      `)
      .eq('game_id', gameId)
      .eq('is_completed', true)
      .order('total_score', { ascending: false })
      .order('completed_at', { ascending: true });

    if (error) throw error;

    // Enrichir les données avec les noms
    const leaderboard = await Promise.all((participations || []).map(async (entry) => {
      let playerName = entry.player_name;
      
      if (!playerName) {
        if (entry.family_id) {
          const { data: family } = await supabaseService
            .from('families')
            .select('name')
            .eq('id', entry.family_id)
            .single();
          playerName = family?.name || 'Une famille';
        } else if (entry.guest_id) {
          const { data: guest } = await supabaseService
            .from('guests')
            .select('first_name, last_name')
            .eq('id', entry.guest_id)
            .single();
          playerName = guest ? `${guest.first_name} ${guest.last_name}` : 'Un invité';
        } else {
          playerName = 'Anonyme';
        }
      }

      return {
        ...entry,
        player_display_name: playerName,
        total_score: entry.total_score,
        correct_answers: entry.correct_answers,
        total_answers: entry.total_answers
      };
    }));

    res.json({
      success: true,
      data: {
        gameName: game.name,
        totalParticipants: leaderboard?.length || 0,
        averageScore: leaderboard?.length > 0 
          ? leaderboard.reduce((sum, p) => sum + p.total_score, 0) / leaderboard.length 
          : 0,
        leaderboard: leaderboard || []
      }
    });
  } catch (error) {
    logger.error('Error fetching full leaderboard:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching leaderboard'
    });
  }
});

module.exports = router;
