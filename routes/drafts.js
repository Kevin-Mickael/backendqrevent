/**
 * Routes pour la gestion des brouillons (drafts)
 * Permet la sauvegarde automatique des données de formulaire
 */

const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const { supabaseService } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const draftValidation = {
  save: celebrate({
    [Segments.BODY]: Joi.object({
      form_type: Joi.string().required(),
      form_id: Joi.string().optional().allow(null, ''),
      draft_data: Joi.object().required()
    })
  }),
  get: celebrate({
    [Segments.QUERY]: Joi.object({
      form_type: Joi.string().required(),
      form_id: Joi.string().optional().allow('')
    })
  }),
  delete: celebrate({
    [Segments.PARAMS]: Joi.object({
      draftId: Joi.string().uuid().required()
    })
  })
};

/**
 * POST /api/drafts - Sauvegarder un brouillon
 */
router.post('/', authenticateToken, draftValidation.save, async (req, res) => {
  try {
    const userId = req.user.id;
    const { form_type, form_id, draft_data } = req.body;

    // Vérifier si un brouillon existe déjà pour ce formulaire
    const { data: existingDraft } = await supabaseService
      .from('form_drafts')
      .select('id')
      .eq('user_id', userId)
      .eq('form_type', form_type)
      .eq('form_id', form_id || null)
      .single();

    let result;
    
    if (existingDraft) {
      // Mettre à jour le brouillon existant
      const { data, error } = await supabaseService
        .from('form_drafts')
        .update({
          draft_data,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingDraft.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Créer un nouveau brouillon
      const { data, error } = await supabaseService
        .from('form_drafts')
        .insert({
          user_id: userId,
          form_type,
          form_id: form_id || null,
          draft_data
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json({
      success: true,
      data: result,
      message: 'Brouillon sauvegardé'
    });

  } catch (error) {
    logger.error('Erreur sauvegarde brouillon:', {
      error: error.message,
      code: error.code,
      userId: req.user?.id,
      formType,
      formId
    });
    
    // Message d'erreur plus spécifique selon le type d'erreur
    let errorMessage = 'Erreur lors de la sauvegarde du brouillon';
    if (error.code === '23503') {
      errorMessage = 'Données de référence invalides';
    } else if (error.code === '42P01') {
      errorMessage = 'Table de brouillons non trouvée - Contactez l\'administrateur';
    } else if (error.message?.includes('permission denied')) {
      errorMessage = 'Permissions insuffisantes';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      code: error.code,
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

/**
 * GET /api/drafts - Récupérer un brouillon
 */
router.get('/', authenticateToken, draftValidation.get, async (req, res) => {
  try {
    const userId = req.user.id;
    const { form_type, form_id } = req.query;

    const { data, error } = await supabaseService
      .from('form_drafts')
      .select('*')
      .eq('user_id', userId)
      .eq('form_type', form_type)
      .eq('form_id', form_id || null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      success: true,
      data: data || null,
      message: data ? 'Brouillon trouvé' : 'Aucun brouillon'
    });

  } catch (error) {
    logger.error('Erreur récupération brouillon:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du brouillon'
    });
  }
});

/**
 * GET /api/drafts/all - Récupérer tous les brouillons de l'utilisateur
 */
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabaseService
      .from('form_drafts')
      .select('id, form_type, form_id, updated_at')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });

  } catch (error) {
    logger.error('Erreur récupération brouillons:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des brouillons'
    });
  }
});

/**
 * DELETE /api/drafts/:draftId - Supprimer un brouillon
 */
router.delete('/:draftId', authenticateToken, draftValidation.delete, async (req, res) => {
  try {
    const userId = req.user.id;
    const { draftId } = req.params;

    // Vérifier que le brouillon appartient à l'utilisateur
    const { data: draft } = await supabaseService
      .from('form_drafts')
      .select('id')
      .eq('id', draftId)
      .eq('user_id', userId)
      .single();

    if (!draft) {
      return res.status(404).json({
        success: false,
        message: 'Brouillon non trouvé'
      });
    }

    const { error } = await supabaseService
      .from('form_drafts')
      .delete()
      .eq('id', draftId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Brouillon supprimé'
    });

  } catch (error) {
    logger.error('Erreur suppression brouillon:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du brouillon'
    });
  }
});

/**
 * DELETE /api/drafts/cleanup - Nettoyer les vieux brouillons (admin uniquement)
 */
router.delete('/cleanup/all', authenticateToken, async (req, res) => {
  try {
    // Vérifier que l'utilisateur est admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    const { count, error } = await supabaseService
      .from('form_drafts')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (error) throw error;

    res.json({
      success: true,
      message: 'Brouillons expirés nettoyés',
      deleted_count: count || 0
    });

  } catch (error) {
    logger.error('Erreur nettoyage brouillons:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage'
    });
  }
});

module.exports = router;
