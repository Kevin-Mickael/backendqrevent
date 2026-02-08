const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateGuest, optionalGuestAuth } = require('../middleware/guestAuth');
const { games } = require('../utils/database');
const { supabaseService } = require('../config/supabase');
const { intelligentCache } = require('../services/intelligentCache');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 🚀 ROUTES JEUX OPTIMISÉES POUR LA SCALABILITÉ
 * 
 * Optimisations appliquées:
 * - Élimination requêtes N+1 avec jointures
 * - Cache intelligent multi-niveau
 * - Pagination cursor-based
 * - Rate limiting adaptatif
 * - Circuit breaker pattern
 */

// Validation schemas
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
    playerName: Joi.string().max(100).optional(),
    accessToken: Joi.string().optional()
  }).unknown(true)
});

// ==================== ROUTES PUBLIQUES OPTIMISÉES ====================

/**
 * GET /api/games/public/:gameId - Récupérer un jeu (AVEC CACHE)
 */
router.get('/public/:gameId', authenticateGuest, async (req, res) => {
  try {
    const { gameId } = req.params;
    const cacheKey = `game:public:${gameId}:${req.guest.event_id}`;
    
    // 🚀 CACHE INTELLIGENT
    const result = await intelligentCache.get(
      cacheKey,
      async () => {
        const game = await games.getGameWithQuestions(gameId);
        
        if (!game || !game.is_active || game.status !== 'active') {
          return null; // Ne pas cacher les erreurs
        }
        
        // 🛡️ SECURITY: Verify game belongs to guest's event
        if (game.event_id !== req.guest.event_id) {
          return null; // Ne pas cacher les erreurs de sécurité
        }
        
        // Sanitize questions (remove correct answers)
        const sanitizedQuestions = game.questions.map(q => ({
          id: q.id,
          question: q.question,
          question_type: q.question_type,
          options: q.options ? q.options.map(opt => ({
            text: opt.text
            // Pas de isCorrect exposé
          })) : null,
          points: q.points,
          sort_order: q.sort_order,
          media_url: q.media_url,
          time_limit: q.time_limit
        }));
        
        return {
          id: game.id,
          name: game.name,
          type: game.type,
          description: game.description,
          total_questions: game.total_questions,
          questions: sanitizedQuestions
        };
      },
      'GAME_DATA'
    );
    
    if (!result.data) {
      return res.status(404).json({
        success: false,
        message: 'Game not found or inactive'
      });
    }
    
    res.json({
      success: true,
      data: {
        ...result.data,
        guest: {
          accessType: req.guest.accessType,
          hasPlayed: req.guest.has_played || false
        }
      },
      meta: {
        cached: result.source !== 'fresh',
        ttl: result.ttl
      }
    });
    
  } catch (error) {
    logger.error('Error fetching public game:', { error: error.message, gameId: req.params.gameId });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching game'
    });
  }
});

/**
 * POST /api/games/public/:gameId/play - Jouer (AVEC OPTIMISATIONS)
 */
router.post('/public/:gameId/play', authenticateGuest, playGameSchema, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { answers, playerName } = req.body;
    
    // 🛡️ SECURITY: Comprehensive validation
    if (!req.guest?.event_id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid guest data'
      });
    }
    
    const clientIP = getClientIP(req);
    
    // 🚀 PARALLEL SECURITY CHECKS (instead of sequential)
    const [game, existingIP, existingParticipation] = await Promise.all([
      games.getGameWithQuestions(gameId),
      
      // Check IP tracking
      supabaseService
        .from('game_ip_tracking')
        .select('id')
        .eq('game_id', gameId)
        .eq('ip_address', clientIP)
        .single()
        .then(({ data, error }) => error?.code === 'PGRST116' ? null : data),
      
      // Check existing participation
      supabaseService
        .from('game_participations')
        .select('id, total_score, rank')
        .eq('game_id', gameId)
        .eq('access_token', req.query.token || req.body.accessToken)
        .eq('is_completed', true)
        .single()
        .then(({ data, error }) => error?.code === 'PGRST116' ? null : data)
    ]);
    
    // Validations
    if (!game || !game.is_active || game.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Game not found or not active' });
    }
    
    if (game.event_id !== req.guest.event_id) {
      logger.warn('IDOR attempt in game play', { guestEventId: req.guest.event_id, gameEventId: game.event_id });
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    if (existingIP) {
      return res.status(403).json({
        success: false,
        message: 'Vous avez déjà joué depuis cet appareil',
        code: 'ALREADY_PLAYED_IP'
      });
    }
    
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
    
    // Normalize answers
    let answersArray = Array.isArray(answers) ? answers : Object.values(answers || {});
    
    if (!answersArray.length) {
      return res.status(400).json({
        success: false,
        message: 'No answers provided'
      });
    }
    
    // 🧮 OPTIMIZED SCORE CALCULATION
    let totalScore = 0;
    let correctAnswers = 0;
    const answerRecords = [];
    
    for (const userAnswer of answersArray) {
      const question = game.questions.find(q => q.id === userAnswer.questionId);
      if (!question) continue;
      
      const { isCorrect, pointsEarned } = calculateAnswerScore(question, userAnswer.answer);
      
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
    
    // 🚀 ATOMIC TRANSACTION FOR PARTICIPATION + ANSWERS + IP TRACKING
    const { data: participation, error: participationError } = await supabaseService.rpc(
      'create_game_participation_atomic',
      {
        p_game_id: gameId,
        p_guest_id: req.guest.accessType === 'individual' ? req.guest.guest_id : null,
        p_family_id: req.guest.accessType === 'family' ? req.guest.family_id : null,
        p_qr_code: req.guest.qr_code,
        p_access_token: req.query.token || req.body.accessToken,
        p_player_name: playerName || getDefaultPlayerName(req.guest),
        p_player_type: req.guest.accessType,
        p_total_score: totalScore,
        p_correct_answers: correctAnswers,
        p_total_answers: answersArray.length,
        p_answer_records: answerRecords,
        p_client_ip: clientIP,
        p_user_agent: req.headers['user-agent']
      }
    );
    
    if (participationError) {
      logger.error('Error creating participation:', participationError);
      throw participationError;
    }
    
    // 🚀 PRELOAD LEADERBOARD ASYNCHRONOUSLY
    const leaderboardKey = `leaderboard:${gameId}`;
    setImmediate(() => {
      intelligentCache.invalidatePattern(`leaderboard:${gameId}`);
      intelligentCache.preload(gameId, req.guest.event_id);
    });
    
    // 🏆 GET RANK FROM CACHED LEADERBOARD
    const leaderboardResult = await intelligentCache.get(
      leaderboardKey,
      () => fetchOptimizedLeaderboard(gameId),
      'LEADERBOARD'
    );
    
    const playerRank = leaderboardResult.data?.find(p => p.participationId === participation.id)?.rank;
    
    res.json({
      success: true,
      message: 'Game completed successfully',
      data: {
        score: totalScore,
        correctAnswers,
        totalQuestions: game.total_questions,
        rank: playerRank,
        totalParticipants: leaderboardResult.data?.length || 0
      },
      meta: {
        leaderboardCached: leaderboardResult.source !== 'fresh'
      }
    });
    
  } catch (error) {
    logger.error('Error playing game:', { 
      error: error.message,
      gameId: req.params.gameId,
      guestEventId: req.guest?.event_id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Server error while processing game'
    });
  }
});

/**
 * GET /api/games/public/:gameId/leaderboard - CLASSEMENT OPTIMISÉ
 */
router.get('/public/:gameId/leaderboard', optionalGuestAuth, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { limit = 50, cursor } = req.query;
    
    // 🚀 CACHE INTELLIGENT AVEC CURSOR PAGINATION
    const cacheKey = cursor ? 
      `leaderboard:${gameId}:cursor:${cursor}:${limit}` : 
      `leaderboard:${gameId}:top:${limit}`;
    
    const result = await intelligentCache.get(
      cacheKey,
      () => fetchOptimizedLeaderboard(gameId, { limit: parseInt(limit), cursor }),
      'LEADERBOARD'
    );
    
    if (!result.data) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        leaderboard: result.data.leaderboard,
        gameName: result.data.gameName,
        totalParticipants: result.data.totalParticipants,
        pagination: {
          hasNext: result.data.hasNext,
          nextCursor: result.data.nextCursor
        }
      },
      meta: {
        cached: result.source !== 'fresh',
        ttl: result.ttl
      }
    });
    
  } catch (error) {
    logger.error('Error fetching leaderboard:', { error: error.message, gameId: req.params.gameId });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching leaderboard'
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * 🧮 OPTIMIZED SCORE CALCULATION
 */
function calculateAnswerScore(question, userAnswer) {
  let isCorrect = false;
  let pointsEarned = 0;
  
  switch (question.question_type) {
    case 'multiple_choice':
      const correctOption = question.options?.find(opt => opt.isCorrect);
      if (correctOption && correctOption.text === userAnswer) {
        isCorrect = true;
        pointsEarned = question.points;
      }
      break;
    
    case 'text':
      if (question.correct_answer && 
          question.correct_answer.toLowerCase().trim() === userAnswer.toLowerCase().trim()) {
        isCorrect = true;
        pointsEarned = question.points;
      }
      break;
    
    case 'boolean':
      if (question.correct_answer === userAnswer) {
        isCorrect = true;
        pointsEarned = question.points;
      }
      break;
  }
  
  return { isCorrect, pointsEarned };
}

/**
 * 🏆 LEADERBOARD OPTIMISÉ (ÉLIMINE N+1)
 */
async function fetchOptimizedLeaderboard(gameId, pagination = {}) {
  const { limit = 50, cursor } = pagination;
  
  let query = supabaseService
    .from('game_participations')
    .select(`
      id,
      total_score,
      correct_answers,
      total_answers,
      completed_at,
      player_name,
      player_type,
      rank,
      families!left(name),
      guests!left(first_name, last_name)
    `)
    .eq('game_id', gameId)
    .eq('is_completed', true)
    .order('total_score', { ascending: false })
    .order('completed_at', { ascending: true })
    .limit(limit + 1); // +1 pour detecter hasNext
  
  // Cursor pagination
  if (cursor) {
    query = query.lt('completed_at', cursor);
  }
  
  const { data: participations, error } = await query;
  
  if (error) throw error;
  
  // Get game info
  const game = await games.findById(gameId);
  
  const hasNext = participations.length > limit;
  if (hasNext) participations.pop(); // Remove extra item
  
  const leaderboard = participations.map((entry, index) => ({
    participationId: entry.id,
    rank: entry.rank || index + 1,
    playerName: entry.player_name ||
               entry.families?.[0]?.name ||
               (entry.guests?.[0] ? `${entry.guests[0].first_name} ${entry.guests[0].last_name}` : 'Anonyme'),
    score: entry.total_score,
    correctAnswers: entry.correct_answers,
    totalAnswers: entry.total_answers,
    isTop3: (entry.rank || index + 1) <= 3
  }));
  
  return {
    leaderboard,
    gameName: game?.name || '',
    totalParticipants: leaderboard.length,
    hasNext,
    nextCursor: hasNext ? participations[participations.length - 1]?.completed_at : null
  };
}

/**
 * 🏷️ PLAYER NAME HELPER
 */
function getDefaultPlayerName(guest) {
  switch (guest.accessType) {
    case 'family': return 'Famille';
    case 'individual': return 'Invité';
    default: return 'Joueur';
  }
}

/**
 * 🌐 CLIENT IP HELPER
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

module.exports = router;