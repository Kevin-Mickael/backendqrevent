const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/security');
const eventGallery = require('../utils/db/eventGallery');
const { events } = require('../utils/database');
const storageService = require('../services/storageService');
const imageService = require('../services/imageService');
const upload = require('../middleware/upload');
const uploadVideo = require('../middleware/uploadVideo');
const logger = require('../utils/logger');
const { buildSecurePath, sanitizeFilename } = require('../utils/securityUtils');

const router = express.Router();

// Validation schemas
const galleryValidationSchema = {
  upload: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required()
    })
  }),
  
  updateCaption: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      galleryId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      caption: Joi.string().max(500).allow('').optional()
    })
  }),

  moderation: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      galleryId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      action: Joi.string().valid('approve', 'reject', 'feature', 'unfeature').required()
    })
  })
};

/**
 * Helper: Verify event ownership
 */
async function verifyEventOwnership(eventId, userId) {
  const event = await events.findById(eventId);
  if (!event || event.organizer_id !== userId) {
    return null;
  }
  return event;
}

/**
 * Helper: Generate unique filename
 */
function generateUniqueFilename(originalName, eventId) {
  const ext = originalName.split('.').pop();
  const sanitized = sanitizeFilename(originalName.split('.').slice(0, -1).join('.'));
  return `${eventId}/${Date.now()}_${uuidv4().slice(0, 8)}_${sanitized}.${ext}`;
}

/**
 * GET /api/events/:eventId/gallery - Get gallery items for an event
 * Public access for approved items
 */
router.get('/events/:eventId/gallery', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { type, limit = 50, offset = 0 } = req.query;

    // Check if event exists and is active
    const event = await events.findById(eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const galleryItems = await eventGallery.findByEvent(eventId, {
      fileType: type,
      limit: parseInt(limit),
      offset: parseInt(offset),
      includeUnapproved: false
    });

    // Get stats
    const stats = await eventGallery.getStats(eventId);

    res.json({
      success: true,
      data: galleryItems,
      stats,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: stats.total_items
      }
    });
  } catch (error) {
    logger.error('Error fetching gallery:', { error: error.message, eventId: req.params.eventId });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching gallery'
    });
  }
});

/**
 * GET /api/events/:eventId/gallery/stats - Get gallery statistics
 */
router.get('/events/:eventId/gallery/stats', async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await events.findById(eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const stats = await eventGallery.getStats(eventId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching gallery stats:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching gallery stats'
    });
  }
});

/**
 * POST /api/events/:eventId/gallery/upload - Upload photo/video
 * Supports both authenticated users and guests (via QR)
 */
router.post('/events/:eventId/gallery/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const { familyId, guestId, caption } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Check if event exists and is active
    const event = await events.findById(eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or inactive'
      });
    }

    // Validate file type
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');

    if (!isImage && !isVideo) {
      return res.status(400).json({
        success: false,
        message: 'Only images and videos are allowed'
      });
    }

    const fileType = isImage ? 'image' : 'video';

    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(req.file.originalname, eventId);
    const folder = buildSecurePath('gallery', eventId);

    // Optimize image if needed
    let processedBuffer = req.file.buffer;
    let processedMimetype = req.file.mimetype;

    if (isImage && req.file.size > 100 * 1024) {
      try {
        const optimized = await imageService.optimizeGalleryImage(req.file.buffer);
        processedBuffer = optimized.buffer;
        processedMimetype = optimized.mimetype;
      } catch (optimizeError) {
        logger.warn('Image optimization failed, using original:', optimizeError.message);
      }
    }

    // Upload to storage
    const fileToUpload = {
      ...req.file,
      buffer: processedBuffer,
      mimetype: processedMimetype
    };

    const publicUrl = await storageService.uploadFile(fileToUpload, folder);
    const r2Key = `${folder}/${uniqueFilename}`;

    // Create gallery item
    const galleryItem = await eventGallery.create({
      event_id: eventId,
      family_id: familyId || null,
      guest_id: guestId || null,
      uploaded_by: req.user?.id || null,
      original_name: req.file.originalname,
      file_name: uniqueFilename,
      file_path: publicUrl,
      file_size: processedBuffer.length,
      mime_type: processedMimetype,
      file_type: fileType,
      r2_key: r2Key,
      r2_url: publicUrl,
      thumbnail_url: isImage ? publicUrl : null, // Videos would need thumbnail generation
      caption: caption || null,
      is_approved: true, // Auto-approve for now, can be moderated later
      metadata: {
        original_size: req.file.size,
        optimized: processedBuffer.length !== req.file.size,
        uploaded_from: req.headers['user-agent'] || 'unknown'
      }
    });

    logger.info('Gallery upload successful', {
      eventId,
      galleryId: galleryItem.id,
      fileType,
      uploadedBy: req.user?.id || 'guest'
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: galleryItem
    });

  } catch (error) {
    logger.error('Error uploading to gallery:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while uploading file'
    });
  }
});

/**
 * POST /api/events/:eventId/gallery/upload-video - Upload video
 */
router.post('/events/:eventId/gallery/upload-video', uploadLimiter, uploadVideo.single('video'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const { familyId, guestId, caption } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video uploaded'
      });
    }

    const event = await events.findById(eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or inactive'
      });
    }

    const uniqueFilename = generateUniqueFilename(req.file.originalname, eventId);
    const folder = buildSecurePath('gallery', eventId);

    const publicUrl = await storageService.uploadFile(req.file, folder);
    const r2Key = `${folder}/${uniqueFilename}`;

    const galleryItem = await eventGallery.create({
      event_id: eventId,
      family_id: familyId || null,
      guest_id: guestId || null,
      uploaded_by: req.user?.id || null,
      original_name: req.file.originalname,
      file_name: uniqueFilename,
      file_path: publicUrl,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      file_type: 'video',
      r2_key: r2Key,
      r2_url: publicUrl,
      caption: caption || null,
      is_approved: true,
      metadata: {
        duration: null, // Could extract with ffprobe
        uploaded_from: req.headers['user-agent'] || 'unknown'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: galleryItem
    });

  } catch (error) {
    logger.error('Error uploading video to gallery:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while uploading video'
    });
  }
});

/**
 * Protected routes - Event organizer only
 */

// GET /api/events/:eventId/gallery/all - Get all items including unapproved (organizer only)
router.get('/events/:eventId/gallery/all', authenticateToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { type } = req.query;

    const event = await verifyEventOwnership(eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or access denied'
      });
    }

    const galleryItems = await eventGallery.findByEvent(eventId, {
      fileType: type,
      includeUnapproved: true
    });

    res.json({
      success: true,
      data: galleryItems
    });
  } catch (error) {
    logger.error('Error fetching all gallery items:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT /api/gallery/:galleryId/caption - Update caption
router.put('/gallery/:galleryId/caption', authenticateToken, galleryValidationSchema.updateCaption, async (req, res) => {
  try {
    const { galleryId } = req.params;
    const { caption } = req.body;

    const item = await eventGallery.findById(galleryId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found'
      });
    }

    // Verify ownership
    const event = await verifyEventOwnership(item.event_id, req.user.id);
    if (!event && item.uploaded_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updated = await eventGallery.update(galleryId, { caption });

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Error updating caption:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// DELETE /api/gallery/:galleryId - Delete gallery item
router.delete('/gallery/:galleryId', authenticateToken, async (req, res) => {
  try {
    const { galleryId } = req.params;

    const item = await eventGallery.findById(galleryId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found'
      });
    }

    // Verify ownership
    const event = await verifyEventOwnership(item.event_id, req.user.id);
    if (!event && item.uploaded_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Delete from storage
    try {
      await storageService.deleteFile(item.r2_url);
    } catch (deleteError) {
      logger.warn('Failed to delete file from storage:', deleteError.message);
    }

    await eventGallery.softDelete(galleryId);

    res.json({
      success: true,
      message: 'Gallery item deleted'
    });
  } catch (error) {
    logger.error('Error deleting gallery item:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// POST /api/gallery/:galleryId/moderate - Moderate gallery item
router.post('/gallery/:galleryId/moderate', authenticateToken, galleryValidationSchema.moderation, async (req, res) => {
  try {
    const { galleryId } = req.params;
    const { action } = req.body;

    const item = await eventGallery.findById(galleryId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Gallery item not found'
      });
    }

    // Verify ownership
    const event = await verifyEventOwnership(item.event_id, req.user.id);
    if (!event) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let result;
    switch (action) {
      case 'approve':
        result = await eventGallery.setApproval(galleryId, true);
        break;
      case 'reject':
        result = await eventGallery.setApproval(galleryId, false);
        break;
      case 'feature':
        result = await eventGallery.setFeatured(galleryId, true);
        break;
      case 'unfeature':
        result = await eventGallery.setFeatured(galleryId, false);
        break;
    }

    res.json({
      success: true,
      message: `Gallery item ${action}ed`,
      data: result
    });
  } catch (error) {
    logger.error('Error moderating gallery item:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
