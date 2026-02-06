const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateGuest, optionalGuestAuth } = require('../middleware/guestAuth');
const { authenticateToken } = require('../middleware/auth');
const { games } = require('../utils/database');
const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const playGameSchema = celebrate({
  [Segments.BODY]: Joi.object().keys({
    answers: Joi.array().items(Joi.object({
      questionId: Joi.string().uuid().required(),
      answer: Joi.string().required(),
      timeSpent: Joi.number().integer().min(0).optional()
    })).required(),
    playerName: Joi.string().max(100).optional()
  })
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

// POST /api/games/public/:gameId/play - Jouer à un jeu
router.post('/public/:gameId/play', authenticateGuest, playGameSchema, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { answers, playerName } = req.body;

    // Vérifier que le jeu existe et est actif
    const game = await games.getGameWithQuestions(gameId);
    if (!game || !game.is_active || game.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Game not found or not active'
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

    // Vérifier si déjà joué
    const { data: existingParticipation } = await supabaseService
      .from('game_participations')
      .select('*')
      .eq('game_id', gameId)
      .eq(req.guest.accessType === 'family' ? 'family_id' : 'guest_id', 
           req.guest.accessType === 'family' ? req.guest.family_id : req.guest.guest_id)
      .eq('is_completed', true)
      .single();

    if (existingParticipation) {
      return res.status(403).json({
        success: false,
        message: 'You have already completed this game',
        data: {
          score: existingParticipation.total_score,
          rank: existingParticipation.rank
        }
      });
    }

    // Calculer le score
    let totalScore = 0;
    let correctAnswers = 0;
    const answerRecords = [];

    for (const userAnswer of answers) {
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
    const { data: participation, error: partError } = await supabaseService
      .from('game_participations')
      .insert([{
        game_id: gameId,
        guest_id: req.guest.accessType === 'individual' ? req.guest.guest_id : null,
        family_id: req.guest.accessType === 'family' ? req.guest.family_id : null,
        qr_code: req.guest.qr_code,
        access_token: req.query.token || req.body.accessToken,
        player_name: playerName || (req.guest.accessType === 'family' ? 'Famille' : 'Invité'),
        player_type: req.guest.accessType,
        total_score: totalScore,
        correct_answers: correctAnswers,
        total_answers: answers.length,
        is_completed: true,
        completed_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (partError) {
      throw partError;
    }

    // Enregistrer les réponses détaillées
    if (answerRecords.length > 0) {
      const { error: answersError } = await supabaseService
        .from('game_answers')
        .insert(answerRecords.map(a => ({
          ...a,
          participation_id: participation.id
        })));

      if (answersError) {
        logger.error('Error saving answers:', { error: answersError.message });
      }
    }

    // Mettre à jour le statut dans la table d'accès
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

    // Récupérer le classement mis à jour
    const { data: leaderboard } = await supabaseService
      .from('game_leaderboard')
      .select('*')
      .eq('game_id', gameId)
      .order('rank', { ascending: true });

    const playerRank = leaderboard?.find(p => p.participation_id === participation.id)?.rank;

    res.json({
      success: true,
      message: 'Game completed successfully',
      data: {
        score: totalScore,
        correctAnswers,
        totalQuestions: game.total_questions,
        rank: playerRank,
        totalParticipants: leaderboard?.length || 0
      }
    });
  } catch (error) {
    logger.error('Error playing game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while processing game'
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

    // Récupérer le classement
    const { data: leaderboard, error } = await supabaseService
      .from('game_leaderboard')
      .select('rank, player_display_name, total_score, correct_answers, total_answers, completed_at, player_type')
      .eq('game_id', gameId)
      .order('rank', { ascending: true })
      .limit(50);

    if (error) {
      throw error;
    }

    // Anonymiser les noms si le jeu n'est pas terminé et que ce n'est pas l'organisateur
    const sanitizedLeaderboard = leaderboard?.map((entry, index) => ({
      rank: entry.rank || index + 1,
      playerName: entry.player_display_name || (entry.player_type === 'family' ? 'Une famille' : 'Un invité'),
      score: entry.total_score,
      correctAnswers: entry.correct_answers,
      totalAnswers: entry.total_answers,
      isTop3: index < 3
    })) || [];

    res.json({
      success: true,
      data: {
        gameName: game.name,
        gameStatus: game.status,
        totalParticipants: sanitizedLeaderboard.length,
        leaderboard: sanitizedLeaderboard
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

    const { data: leaderboard, error } = await supabaseService
      .from('game_leaderboard')
      .select('*')
      .eq('game_id', gameId)
      .order('rank', { ascending: true });

    if (error) throw error;

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
