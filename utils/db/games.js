const { supabaseService } = require('../../config/supabase');

// Games database utilities
const gamesDb = {
  // ==================== GAMES ====================
  
  // Create a new game
  create: async (gameData) => {
    const { data, error } = await supabaseService
      .from('games')
      .insert([gameData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating game: ${error.message}`);
    }

    return data;
  },

  // Find game by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('games')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding game: ${error.message}`);
    }

    return data;
  },

  // Find all games by event ID
  findByEvent: async (eventId) => {
    const { data, error } = await supabaseService
      .from('games')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding games: ${error.message}`);
    }

    return data || [];
  },

  // Find games by event and status
  findByEventAndStatus: async (eventId, status) => {
    const { data, error } = await supabaseService
      .from('games')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', status)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding games: ${error.message}`);
    }

    return data || [];
  },

  // Update game
  update: async (id, gameData) => {
    const { data, error } = await supabaseService
      .from('games')
      .update({ ...gameData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating game: ${error.message}`);
    }

    return data;
  },

  // Soft delete game
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('games')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting game: ${error.message}`);
    }

    return data;
  },

  // Update game status
  updateStatus: async (id, status) => {
    const updateData = { 
      status, 
      updated_at: new Date().toISOString() 
    };
    
    if (status === 'active') {
      updateData.started_at = new Date().toISOString();
    } else if (status === 'completed') {
      updateData.ended_at = new Date().toISOString();
    }

    const { data, error } = await supabaseService
      .from('games')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating game status: ${error.message}`);
    }

    return data;
  },

  // Get game with questions
  getGameWithQuestions: async (id) => {
    const { data: game, error: gameError } = await supabaseService
      .from('games')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (gameError) {
      if (gameError.code === 'PGRST116') return null;
      throw new Error(`Error finding game: ${gameError.message}`);
    }

    const { data: questions, error: questionsError } = await supabaseService
      .from('game_questions')
      .select('*')
      .eq('game_id', id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (questionsError) {
      throw new Error(`Error finding questions: ${questionsError.message}`);
    }

    return { ...game, questions: questions || [] };
  },

  // ==================== QUESTIONS ====================

  // Create a question
  createQuestion: async (questionData) => {
    const { data, error } = await supabaseService
      .from('game_questions')
      .insert([questionData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating question: ${error.message}`);
    }

    return data;
  },

  // Create multiple questions
  createQuestions: async (questionsData) => {
    const { data, error } = await supabaseService
      .from('game_questions')
      .insert(questionsData)
      .select();

    if (error) {
      throw new Error(`Error creating questions: ${error.message}`);
    }

    return data || [];
  },

  // Find question by ID
  findQuestionById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('game_questions')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding question: ${error.message}`);
    }

    return data;
  },

  // Find questions by game ID
  findQuestionsByGame: async (gameId) => {
    const { data, error } = await supabaseService
      .from('game_questions')
      .select('*')
      .eq('game_id', gameId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`Error finding questions: ${error.message}`);
    }

    return data || [];
  },

  // Update question
  updateQuestion: async (id, questionData) => {
    const { data, error } = await supabaseService
      .from('game_questions')
      .update({ ...questionData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating question: ${error.message}`);
    }

    return data;
  },

  // Delete question (hard delete - trigger will update count)
  deleteQuestion: async (id) => {
    const { error } = await supabaseService
      .from('game_questions')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Error deleting question: ${error.message}`);
    }

    return true;
  },

  // Reorder questions
  reorderQuestions: async (gameId, orderedIds) => {
    const updates = orderedIds.map((id, index) => ({
      id,
      sort_order: index,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabaseService
      .from('game_questions')
      .upsert(updates)
      .select();

    if (error) {
      throw new Error(`Error reordering questions: ${error.message}`);
    }

    return data;
  },

  // ==================== PARTICIPATIONS ====================

  // Create a participation
  createParticipation: async (participationData) => {
    const { data, error } = await supabaseService
      .from('game_participations')
      .insert([participationData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating participation: ${error.message}`);
    }

    return data;
  },

  // Find participation by game and guest
  findParticipation: async (gameId, guestId) => {
    const { data, error } = await supabaseService
      .from('game_participations')
      .select('*')
      .eq('game_id', gameId)
      .eq('guest_id', guestId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error finding participation: ${error.message}`);
    }

    return data;
  },

  // Find participations by game
  findParticipationsByGame: async (gameId) => {
    const { data, error } = await supabaseService
      .from('game_participations')
      .select(`
        *,
        guest:guests(first_name, last_name, email)
      `)
      .eq('game_id', gameId)
      .order('total_score', { ascending: false });

    if (error) {
      throw new Error(`Error finding participations: ${error.message}`);
    }

    return data || [];
  },

  // Update participation
  updateParticipation: async (id, participationData) => {
    const { data, error } = await supabaseService
      .from('game_participations')
      .update(participationData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating participation: ${error.message}`);
    }

    return data;
  },

  // Complete participation
  completeParticipation: async (id, score, correctAnswers, totalAnswers) => {
    const { data, error } = await supabaseService
      .from('game_participations')
      .update({
        is_completed: true,
        total_score: score,
        correct_answers: correctAnswers,
        total_answers: totalAnswers,
        completed_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error completing participation: ${error.message}`);
    }

    return data;
  },

  // ==================== ANSWERS ====================

  // Save an answer
  saveAnswer: async (answerData) => {
    const { data, error } = await supabaseService
      .from('game_answers')
      .insert([answerData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error saving answer: ${error.message}`);
    }

    return data;
  },

  // Find answers by participation
  findAnswersByParticipation: async (participationId) => {
    const { data, error } = await supabaseService
      .from('game_answers')
      .select('*')
      .eq('participation_id', participationId)
      .order('answered_at', { ascending: true });

    if (error) {
      throw new Error(`Error finding answers: ${error.message}`);
    }

    return data || [];
  },

  // ==================== STATISTICS ====================

  // Get game statistics
  getGameStats: async (gameId) => {
    const { data: game, error: gameError } = await supabaseService
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (gameError) {
      throw new Error(`Error finding game: ${gameError.message}`);
    }

    const { data: participations, error: partError } = await supabaseService
      .from('game_participations')
      .select('*')
      .eq('game_id', gameId);

    if (partError) {
      throw new Error(`Error finding participations: ${partError.message}`);
    }

    const completed = participations?.filter(p => p.is_completed) || [];
    
    return {
      game,
      totalParticipants: participations?.length || 0,
      completedParticipants: completed.length,
      averageScore: completed.length > 0 
        ? completed.reduce((sum, p) => sum + p.total_score, 0) / completed.length 
        : 0,
      highestScore: completed.length > 0
        ? Math.max(...completed.map(p => p.total_score))
        : 0,
      lowestScore: completed.length > 0
        ? Math.min(...completed.map(p => p.total_score))
        : 0
    };
  }
};

module.exports = gamesDb;
