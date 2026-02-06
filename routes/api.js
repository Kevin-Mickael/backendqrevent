const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authorizeRole, validateRequest } = require('../middleware/auth');
const { validateQRCode, qrVerifyLimiter, uploadLimiter } = require('../middleware/security');
const qrCodeService = require('../services/qrCodeService');
const { users, events, guests, qrCodes, attendance, families, familyInvitations, familyRsvp, storyEvents, games, wishes, feedback, seatingTables } = require('../utils/database');
const { updateEventIfOwner, softDeleteEventIfOwner, getEventIfOwner, updateGuestIfEventOwner, deleteGuestIfEventOwner } = require('../utils/db/atomicOperations');
const upload = require('../middleware/upload');
const uploadVideo = require('../middleware/uploadVideo');
const uploadAny = require('../middleware/uploadAny');
const storageService = require('../services/storageService');
const imageService = require('../services/imageService');
const { addImageOptimizationJob } = require('../services/imageOptimizationQueue');
const { sanitizeEventData, sanitizeFilename, sanitizeForLog } = require('../utils/securityUtils');
const { validateEventIdParam, validateGuestIdParam, buildSecurePath } = require('../utils/validationUtils');
const logger = require('../utils/logger');
const { redisService, imageProcessingQueue } = require('../services/redisService');

const router = express.Router();

// Validation schemas
const eventValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      title: Joi.string().required().max(200),
      description: Joi.string().required().max(1000),
      date: Joi.date().required(),
      location: Joi.object().keys({
        address: Joi.string().required(),
        coordinates: Joi.object().keys({
          lat: Joi.number(),
          lng: Joi.number()
        })
      }),
      cover_image: Joi.string().uri().optional(), // Updated to match database column name
      banner_image: Joi.string().uri().optional(), // Updated to match database column name
      settings: Joi.object().keys({
        enableRSVP: Joi.boolean(),
        enableGames: Joi.boolean(),
        enablePhotoGallery: Joi.boolean(),
        enableGuestBook: Joi.boolean(),
        enableQRVerification: Joi.boolean()
      })
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().required().length(24).hex() // MongoDB ObjectId length
    }),
    [Segments.BODY]: Joi.object().keys({
      title: Joi.string().optional().max(200),
      description: Joi.string().optional().max(1000),
      date: Joi.date().optional(),
      location: Joi.object().keys({
        address: Joi.string().optional(),
        coordinates: Joi.object().keys({
          lat: Joi.number(),
          lng: Joi.number()
        })
      }).optional(),
      cover_image: Joi.string().uri().optional(), // Updated to match database column name
      banner_image: Joi.string().uri().optional(), // Updated to match database column name
      settings: Joi.object().keys({
        enableRSVP: Joi.boolean(),
        enableGames: Joi.boolean(),
        enablePhotoGallery: Joi.boolean(),
        enableGuestBook: Joi.boolean(),
        enableQRVerification: Joi.boolean()
      }).optional(),
      is_active: Joi.boolean().optional()
    })
  })
};

const guestValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      firstName: Joi.string().required().max(50),
      lastName: Joi.string().required().max(50),
      email: Joi.string().email().required(),
      phone: Joi.string().optional(),
      eventId: Joi.string().required().length(24).hex(),
      dietaryRestrictions: Joi.string().max(200).optional(),
      plusOne: Joi.boolean().optional(),
      guestPlusOne: Joi.object().keys({
        firstName: Joi.string().max(50),
        lastName: Joi.string().max(50)
      }).optional(),
      notes: Joi.string().max(500).optional()
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      guestId: Joi.string().required().length(24).hex()
    }),
    [Segments.BODY]: Joi.object().keys({
      firstName: Joi.string().optional().max(50),
      lastName: Joi.string().optional().max(50),
      email: Joi.string().email().optional(),
      phone: Joi.string().optional(),
      rsvpStatus: Joi.string().valid('pending', 'accepted', 'declined').optional(),
      attendanceStatus: Joi.string().valid('not_arrived', 'arrived', 'left').optional(),
      dietaryRestrictions: Joi.string().max(200).optional(),
      plusOne: Joi.boolean().optional(),
      guestPlusOne: Joi.object().keys({
        firstName: Joi.string().max(50),
        lastName: Joi.string().max(50)
      }).optional(),
      notes: Joi.string().max(500).optional()
    })
  })
};

const familyValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(100),
      members: Joi.array().items(Joi.string()).optional()
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      familyId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().optional().max(100),
      members: Joi.array().items(Joi.string()).optional()
    })
  }),

  generateQR: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().required().length(24).hex(),
      familyId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      invitedCount: Joi.number().required().min(1)
    })
  })
};

const storyEventValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      event_id: Joi.string().required().uuid(),
      title: Joi.string().required().max(200),
      event_date: Joi.date().optional(),
      location: Joi.string().max(200).optional(),
      description: Joi.string().max(2000).optional(),
      media_type: Joi.string().valid('photo', 'video').optional(),
      media_url: Joi.string().uri().optional(),
      sort_order: Joi.number().integer().optional()
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      storyEventId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      title: Joi.string().max(200).optional(),
      event_date: Joi.date().optional(),
      location: Joi.string().max(200).optional(),
      description: Joi.string().max(2000).optional(),
      media_type: Joi.string().valid('photo', 'video').optional(),
      media_url: Joi.string().uri().optional(),
      sort_order: Joi.number().integer().optional()
    })
  })
};

// Game validation schemas
const feedbackValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      authorName: Joi.string().required().max(100),
      authorEmail: Joi.string().email().optional(),
      message: Joi.string().required().max(2000),
      feedbackType: Joi.string().valid('wish', 'guestbook', 'testimonial').default('wish'),
      rating: Joi.number().integer().min(1).max(5).optional(),
      category: Joi.string().max(50).optional(),
      tag: Joi.string().max(50).optional(),
      accentColor: Joi.string().max(20).optional(),
      familyId: Joi.string().uuid().optional(),
      guestId: Joi.string().uuid().optional()
    })
  }),
  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      feedbackId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      authorName: Joi.string().max(100).optional(),
      authorEmail: Joi.string().email().optional(),
      message: Joi.string().max(2000).optional(),
      rating: Joi.number().integer().min(1).max(5).optional(),
      category: Joi.string().max(50).optional(),
      tag: Joi.string().max(50).optional(),
      accentColor: Joi.string().max(20).optional(),
      isApproved: Joi.boolean().optional(),
      isFeatured: Joi.boolean().optional()
    })
  }),
  moderation: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      feedbackId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      action: Joi.string().required().valid('approve', 'reject', 'feature', 'unfeature')
    })
  })
};

const gameValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(200),
      type: Joi.string().required().valid('quiz', 'puzzle', 'shoe_game', 'photo_scavenger', 'blind_test', 'twelve_months', 'memory', 'trivia'),
      description: Joi.string().max(1000).optional(),
      settings: Joi.object().optional()
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      gameId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().max(200).optional(),
      description: Joi.string().max(1000).optional(),
      settings: Joi.object().optional()
    })
  }),

  updateStatus: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      gameId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      status: Joi.string().required().valid('draft', 'active', 'paused', 'completed')
    })
  })
};

const questionValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      question: Joi.string().required().max(500),
      question_type: Joi.string().valid('multiple_choice', 'text', 'photo', 'boolean', 'ordering').optional(),
      options: Joi.array().items(Joi.object()).optional(),
      correct_answer: Joi.string().max(500).optional(),
      points: Joi.number().integer().min(1).max(100).optional(),
      time_limit: Joi.number().integer().min(5).max(300).optional(),
      media_url: Joi.string().uri().optional(),
      sort_order: Joi.number().integer().optional()
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      questionId: Joi.string().required().uuid()
    }),
    [Segments.BODY]: Joi.object().keys({
      question: Joi.string().max(500).optional(),
      question_type: Joi.string().valid('multiple_choice', 'text', 'photo', 'boolean', 'ordering').optional(),
      options: Joi.array().items(Joi.object()).optional(),
      correct_answer: Joi.string().max(500).optional(),
      points: Joi.number().integer().min(1).max(100).optional(),
      time_limit: Joi.number().integer().min(5).max(300).optional(),
      media_url: Joi.string().uri().optional().allow(null),
      sort_order: Joi.number().integer().optional()
    })
  })
};

// Routes

// GET /api/events - Get all events for the authenticated user
router.get('/events', authenticateToken, async (req, res) => {
  try {
    const eventsList = await events.findByOrganizer(req.user.id);

    res.json({
      success: true,
      data: eventsList,
      count: eventsList.length
    });
  } catch (error) {
    logger.error('Error fetching events:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching events'
    });
  }
});

// POST /api/events - Create a new event
router.post('/events', authenticateToken, eventValidationSchema.create, async (req, res) => {
  try {
    // 🛡️ Sanitiser les données pour éviter les injections
    const sanitizedData = sanitizeEventData(req.body);
    
    const eventData = {
      ...sanitizedData,
      organizer_id: req.user.id, // Toujours utiliser l'ID du user authentifié
      is_active: true
    };

    const event = await events.create(eventData);

    logger.info('Event created', { 
      eventId: event.id, 
      userId: req.user.id,
      title: event.title 
    });

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: event
    });
  } catch (error) {
    logger.error('Error creating event:', {
      error: error.message,
      userId: req.user?.id,
      body: sanitizeForLog(req.body, 500)
    });
    res.status(500).json({
      success: false,
      message: 'Server error while creating event'
    });
  }
});

// GET /api/events/:eventId - Get a specific event
router.get('/events/:eventId', authenticateToken, async (req, res) => {
  try {
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    res.json({
      success: true,
      data: event
    });
  } catch (error) {
    logger.error('Error fetching event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching event'
    });
  }
});

// GET /api/events/:eventId/public - Get public event data for guest view (NO AUTH required)
router.get('/events/:eventId/public', async (req, res) => {
  try {
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Return only public fields (no sensitive data)
    const publicEventData = {
      id: event.id,
      title: event.title,
      description: event.description,
      date: event.date,
      location: event.location,
      banner_image: event.banner_image,
      cover_image: event.cover_image,
      bride_name: event.bride_name,
      groom_name: event.groom_name,
      settings: event.settings
    };

    res.json({
      success: true,
      data: publicEventData
    });
  } catch (error) {
    logger.error('Error fetching public event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching event'
    });
  }
});

// PUT /api/events/:eventId - Update an event
// 🛡️ SECURITY: Uses atomic operation to prevent TOCTOU race condition
router.put('/events/:eventId', authenticateToken, eventValidationSchema.update, async (req, res) => {
  try {
    const updatedEvent = await updateEventIfOwner(
      req.params.eventId, 
      req.user.id, 
      req.body
    );

    res.json({
      success: true,
      message: 'Event updated successfully',
      data: updatedEvent
    });
  } catch (error) {
    logger.error('Error updating event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating event'
    });
  }
});

// DELETE /api/events/:eventId - Delete an event (soft delete)
router.delete('/events/:eventId', authenticateToken, async (req, res) => {
  try {
    // 🛡️ SECURITY: Uses atomic operation to prevent TOCTOU race condition
    await softDeleteEventIfOwner(req.params.eventId, req.user.id);

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting event:', { error: error.message });
    
    if (error.message.includes('not found') || error.message.includes('permission')) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to delete it'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while deleting event'
    });
  }
});

// POST /api/events/:eventId/upload-banner - Upload a banner image for an event
router.post('/events/:eventId/upload-banner', authenticateToken, upload.single('banner'), async (req, res) => {
  try {
    // 🛡️ SECURITY: Validate eventId format to prevent injection
    try {
      validateEventId(req.params.eventId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid event ID format'
      });
    }

    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No banner file uploaded'
      });
    }

    // Delete old banner if exists
    const oldBannerUrl = event.banner_image;
    if (oldBannerUrl) {
      try {
        logger.info('[Banner Upload] Deleting old banner', { url: oldBannerUrl });
        await storageService.deleteFile(oldBannerUrl);
        logger.info('[Banner Upload] Old banner deleted successfully');
      } catch (deleteError) {
        logger.error('[Banner Upload] Failed to delete old banner', { error: deleteError.message });
        // Continue with upload even if delete fails
      }
    }

    // Add image optimization to background job queue
    if (req.file.mimetype.startsWith('image/')) {
      try {
        const result = await addImageOptimizationJob({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          folder: buildSecurePath('events', req.params.eventId, 'banners'),
          imageUsage: 'banner', // Use banner-specific optimization
          userId: req.user.id,
          eventId: req.params.eventId
        });

        // Check if result is a URL (direct processing) or job ID (queue processing)
        if (result.startsWith('http')) {
          // Direct processing completed, return the URL
          res.json({
            success: true,
            message: 'Banner uploaded and event updated successfully',
            data: {
              eventId: req.params.eventId,
              bannerUrl: result
            }
          });
        } else {
          // Queue processing, return job ID
          res.json({
            success: true,
            message: 'Banner upload initiated, optimization in progress',
            data: {
              eventId: req.params.eventId,
              jobId: result
            }
          });
        }
      } catch (optimizationError) {
        logger.error('Error adding banner optimization job', { error: optimizationError.message });

        // Fallback to immediate processing if queue fails
        const { buffer, mimetype, extension } = await imageService.optimizeBannerImage(req.file.buffer);

        // Replace original file properties with optimized ones
        req.file.buffer = buffer;
        req.file.mimetype = mimetype;

        // Update originalname extension if needed
        const originalNameWithoutExt = req.file.originalname.substring(0, req.file.originalname.lastIndexOf('.')) || req.file.originalname;
        req.file.originalname = `${originalNameWithoutExt}${extension}`;

        // Upload to R2 with event-specific folder
        const folder = buildSecurePath('events', req.params.eventId, 'banners');
        const publicUrl = await storageService.uploadFile(req.file, folder);

        // Update the event with the banner URL
        const updatedEvent = await events.update(req.params.eventId, {
          banner_image: publicUrl
        });

        res.json({
          success: true,
          message: 'Banner uploaded and event updated successfully (fallback processing)',
          data: {
            eventId: updatedEvent.id,
            bannerUrl: publicUrl
          }
        });
      }
    } else {
      // For non-image files, upload directly
      const folder = buildSecurePath('events', req.params.eventId, 'banners');
      const publicUrl = await storageService.uploadFile(req.file, folder);

      // Update the event with the banner URL
      const updatedEvent = await events.update(req.params.eventId, {
        banner_image: publicUrl
      });

      res.json({
        success: true,
        message: 'Banner uploaded and event updated successfully',
        data: {
          eventId: updatedEvent.id,
          bannerUrl: publicUrl
        }
      });
    }
  } catch (error) {
    logger.error('Error uploading banner:', { error: error.message });

    // Check for specific image optimization errors
    if (error.message.includes('unsupported image format') ||
      error.message.includes('Invalid or empty image buffer') ||
      error.message.includes('Failed to optimize')) {
      return res.status(400).json({
        success: false,
        message: 'The uploaded image format is not supported or the file is corrupted. Please try a different image (JPG, PNG, WebP).'
      });
    }

    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Server error while uploading banner'
    });
  }
});

// POST /api/events/:eventId/upload-cover - Upload a cover image for an event
router.post('/events/:eventId/upload-cover', authenticateToken, upload.single('cover'), async (req, res) => {
  try {
    // 🛡️ SECURITY: Validate eventId format to prevent injection
    try {
      validateEventId(req.params.eventId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid event ID format'
      });
    }

    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No cover file uploaded'
      });
    }

    // Add image optimization to background job queue
    if (req.file.mimetype.startsWith('image/')) {
      try {
        const jobId = await addImageOptimizationJob({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          folder: buildSecurePath('events', req.params.eventId, 'covers'),
          imageUsage: 'cover',
          userId: req.user.id,
          eventId: req.params.eventId
        });

        res.json({
          success: true,
          message: 'Cover upload initiated, optimization in progress',
          data: {
            eventId: req.params.eventId,
            jobId: jobId
          }
        });
      } catch (optimizationError) {
        logger.error('Error adding cover optimization job', { error: optimizationError.message });

        // Fallback to immediate processing if queue fails
        const { buffer, mimetype, extension } = await imageService.optimizeCoverImage(req.file.buffer);

        // Replace original file properties with optimized ones
        req.file.buffer = buffer;
        req.file.mimetype = mimetype;

        // Update originalname extension if needed
        const originalNameWithoutExt = req.file.originalname.substring(0, req.file.originalname.lastIndexOf('.')) || req.file.originalname;
        req.file.originalname = `${originalNameWithoutExt}${extension}`;

        // Upload to R2 with event-specific folder
        const folder = buildSecurePath('events', req.params.eventId, 'covers');
        const publicUrl = await storageService.uploadFile(req.file, folder);

        // Update the event with the cover URL
        const updatedEvent = await events.update(req.params.eventId, {
          cover_image: publicUrl
        });

        res.json({
          success: true,
          message: 'Cover uploaded and event updated successfully (processed immediately)',
          data: {
            eventId: updatedEvent.id,
            coverUrl: publicUrl
          }
        });
      }
    } else {
      // For non-image files, upload directly
      const folder = buildSecurePath('events', req.params.eventId, 'covers');
      const publicUrl = await storageService.uploadFile(req.file, folder);

      // Update the event with the cover URL
      const updatedEvent = await events.update(req.params.eventId, {
        cover_image: publicUrl
      });

      res.json({
        success: true,
        message: 'Cover uploaded and event updated successfully',
        data: {
          eventId: updatedEvent.id,
          coverUrl: publicUrl
        }
      });
    }
  } catch (error) {
    logger.error('Error uploading cover:', { error: error.message });
    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Server error while uploading cover'
    });
  }
});

// POST /api/user/upload-avatar - Upload user avatar image
router.post('/user/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No avatar file provided'
      });
    }

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed'
      });
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (req.file.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 5MB'
      });
    }

    logger.info('Avatar upload request', {
      userId: req.user.id,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      originalName: sanitizeFilename(req.file.originalname)
    });

    let processedUrl = null;
    const shouldProcessImage = req.file.mimetype.startsWith('image/') && req.file.size > 100 * 1024;

    if (shouldProcessImage && redisService.isConnected()) {
      const jobData = {
        userId: req.user.id,
        file: {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          originalname: req.file.originalname,
          size: req.file.size
        },
        folder: 'avatars',
        processType: 'avatar'
      };

      await imageProcessingQueue.add('processImage', jobData, {
        attempts: 3,
        backoff: 'exponential',
        removeOnComplete: 10,
        removeOnFail: 5
      });

      logger.info('Avatar queued for background processing');

      return res.json({
        success: true,
        message: 'Avatar upload received and queued for processing',
        processing: true,
        jobId: `avatar-${req.user.id}-${Date.now()}`
      });
    }

    processedUrl = await storageService.uploadFile(req.file, 'avatars');

    await users.update(req.user.id, {
      avatar_url: processedUrl,
      updated_at: new Date().toISOString()
    });

    logger.info('Avatar uploaded successfully', {
      userId: req.user.id,
      url: processedUrl
    });

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      url: processedUrl,
      processing: false
    });
  } catch (error) {
    logger.error('Error uploading avatar:', { error: error.message });
    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Server error while uploading avatar'
    });
  }
});

// GET /api/events/:eventId/guests - Get all guests for an event
router.get('/events/:eventId/guests', authenticateToken, async (req, res) => {
  try {
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const guestsList = await guests.findByEvent(req.params.eventId);

    res.json({
      success: true,
      data: guestsList,
      count: guestsList.length
    });
  } catch (error) {
    logger.error('Error fetching guests:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching guests'
    });
  }
});

// POST /api/events/:eventId/guests - Add a guest to an event
router.post('/events/:eventId/guests', authenticateToken, guestValidationSchema.create, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Check if guest already exists for this event
    try {
      const existingGuest = await guests.findByEmailAndEvent(req.body.email.toLowerCase(), req.params.eventId);
      if (existingGuest) {
        return res.status(409).json({
          success: false,
          message: 'A guest with this email already exists for this event'
        });
      }
    } catch (error) {
      // If no guest found, continue with creation
      if (!error.message.includes('Row not found')) {
        throw error;
      }
    }

    const guestData = {
      ...req.body,
      email: req.body.email.toLowerCase(),
      event_id: req.params.eventId
    };

    const guest = await guests.create(guestData);

    // Generate QR code for the guest
    try {
      await qrCodeService.createQRCodeForGuest(
        req.params.eventId,
        guest.id,
        req.user.id
      );
    } catch (qrError) {
      logger.error('Error generating QR code for guest', { error: qrError.message });
      // Still return success for guest creation, but log the QR code issue
    }

    res.status(201).json({
      success: true,
      message: 'Guest added successfully',
      data: guest
    });
  } catch (error) {
    logger.error('Error adding guest:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while adding guest'
    });
  }
});

// PUT /api/events/:eventId/guests/:guestId - Update a guest
// 🛡️ SECURITY: Uses atomic operation to prevent TOCTOU race condition
router.put('/events/:eventId/guests/:guestId', authenticateToken, guestValidationSchema.update, async (req, res) => {
  try {
    const updatedGuest = await updateGuestIfEventOwner(
      req.params.guestId,
      req.params.eventId,
      req.user.id,
      req.body
    );

    res.json({
      success: true,
      message: 'Guest updated successfully',
      data: updatedGuest
    });
  } catch (error) {
    logger.error('Error updating guest:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating guest'
    });
  }
});

// DELETE /api/events/:eventId/guests/:guestId - Remove a guest from an event
// 🛡️ SECURITY: Uses atomic operation to prevent TOCTOU race condition
router.delete('/events/:eventId/guests/:guestId', authenticateToken, async (req, res) => {
  try {
    await deleteGuestIfEventOwner(
      req.params.guestId,
      req.params.eventId,
      req.user.id
    );

    res.json({
      success: true,
      message: 'Guest removed successfully'
    });
  } catch (error) {
    logger.error('Error removing guest:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while removing guest'
    });
  }
});

// POST /api/events/:eventId/generate-qr-codes - Generate QR codes for all guests
router.post('/events/:eventId/generate-qr-codes', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const results = await qrCodeService.generateQRCodeBatch(
      req.params.eventId,
      req.user.id
    );

    res.json({
      success: true,
      message: 'QR codes generation completed',
      results
    });
  } catch (error) {
    logger.error('Error generating QR codes:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while generating QR codes'
    });
  }
});

// POST /api/verify-qr/:qrCode - Verify a QR code (for scanning at event)
// 🛡️ Rate limité pour prévenir les scans abusifs
router.post('/verify-qr/:qrCode', qrVerifyLimiter, validateQRCode, async (req, res) => {
  try {
    const result = await qrCodeService.validateQRCode(req.params.qrCode);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Log attendance
    const attendanceData = {
      event_id: result.event.id,
      guest_id: result.guest.id,
      qr_code: result.qrCode,
      verified_by: req.user ? req.user.id : null, // Could be verified by admin or scanner
      status: 'arrived',
      timestamp: new Date().toISOString()
    };

    const attendanceRecord = await attendance.create(attendanceData);

    // Update guest attendance status
    await guests.update(result.guest.id, {
      attendance_status: 'arrived',
      attendance_time: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'QR code verified successfully',
      data: {
        guest: result.guest,
        event: result.event,
        attendance: attendanceRecord
      }
    });
  } catch (error) {
    logger.error('Error verifying QR code:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while verifying QR code'
    });
  }
});

// GET /api/invitations - Get all invitations (events with stats) for the authenticated user
// 🚀 OPTIMISÉ: Utilise la vue matérialisée pour éliminer les requêtes N+1
router.get('/invitations', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    let eventsList;
    let pagination = { page, limit, total: 0, totalPages: 0 };
    
    // Essayer d'abord la méthode optimisée (vue matérialisée)
    try {
      const eventsOptimized = require('../utils/db/eventsOptimized');
      const result = await eventsOptimized.findByOrganizerWithStats(
        req.user.id, 
        { page, limit }
      );
      eventsList = result.events;
      pagination = result.pagination;
    } catch (optimizedError) {
      // Fallback: utiliser la méthode standard si la vue n'existe pas
      logger.info('Fallback to standard events query (mv_event_summary not available)');
      const allEvents = await events.findByOrganizer(req.user.id);
      
      // Pagination manuelle
      const total = allEvents.length;
      const totalPages = Math.ceil(total / limit);
      eventsList = allEvents.slice((page - 1) * limit, page * limit);
      pagination = { page, limit, total, totalPages };
      
      // Récupérer les stats pour chaque événement
      for (let event of eventsList) {
        const guestsList = await guests.findByEvent(event.id);
        event.stats = {
          totalGuests: guestsList.length,
          confirmed: guestsList.filter(g => g.rsvp_status === 'accepted').length,
          declined: guestsList.filter(g => g.rsvp_status === 'declined').length,
          pending: guestsList.filter(g => g.rsvp_status === 'pending').length
        };
      }
    }

    // Formater pour compatibilité avec le frontend
    const invitations = eventsList.map(event => {
      const eventDate = new Date(event.date);
      const now = new Date();
      let status = 'draft';
      if (event.is_active) {
        status = eventDate > now ? 'published' : 'completed';
      }
      
      return {
        id: event.id,
        name: event.title,
        template: event.settings?.template || 'Dentelle Royale',
        status: status,
        views: 0, // À implémenter avec analytics
        responses: event.stats?.totalGuests || 0,
        confirmed: event.stats?.confirmed || 0,
        declined: event.stats?.declined || 0,
        pending: event.stats?.pending || 0,
        date: eventDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        fullDate: event.date,
        location: event.location,
        coverImage: event.cover_image,
        bannerImage: event.banner_image,
        settings: event.settings
      };
    });

    res.json({
      success: true,
      data: invitations,
      pagination,
      count: invitations.length
    });
  } catch (error) {
    logger.error('Error fetching invitations:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invitations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/dashboard/summary - Get dashboard summary statistics
// 🚀 OPTIMISÉ: Utilise la fonction SQL ou vue matérialisée pour éviter les requêtes N+1
router.get('/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const eventsOptimized = require('../utils/db/eventsOptimized');
    
    // 🚀 Récupère tous les stats en une seule requête
    const summaryData = await eventsOptimized.getDashboardSummary(req.user.id);
    
    // Récupère le dernier événement pour les détails
    const { events: eventsList } = await eventsOptimized.findByOrganizerWithStats(
      req.user.id, 
      { page: 1, limit: 1 }
    );

    const latestEvent = eventsList[0];

    // Construire la réponse
    const summary = {
      totalEvents: summaryData.total_events || 0,
      latestEvent: latestEvent ? {
        id: latestEvent.id,
        title: latestEvent.title,
        date: latestEvent.date,
        location: latestEvent.location,
        coverImage: latestEvent.cover_image,
        bannerImage: latestEvent.banner_image
      } : null,
      stats: {
        totalGuests: summaryData.total_guests || 0,
        confirmed: summaryData.confirmed_guests || 0,
        pending: summaryData.pending_guests || 0,
        declined: summaryData.declined_guests || 0,
        arrived: summaryData.arrived_guests || 0
      },
      recentActivity: [] // Simplifié - peut être enrichi avec une table d'activités si nécessaire
    };

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Error fetching dashboard summary:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard summary'
    });
  }
});

// Family Routes

// GET /api/families - Get all families for the authenticated user
router.get('/families', authenticateToken, async (req, res) => {
  try {
    const familiesList = await families.findByUser(req.user.id);
    res.json({
      success: true,
      data: familiesList
    });
  } catch (error) {
    logger.error('Error fetching families:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching families'
    });
  }
});

// POST /api/families - Create a new family
router.post('/families', authenticateToken, familyValidationSchema.create, async (req, res) => {
  try {
    const familyData = {
      ...req.body,
      user_id: req.user.id
    };
    const family = await families.create(familyData);
    res.status(201).json({
      success: true,
      data: family
    });
  } catch (error) {
    logger.error('Error creating family:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating family'
    });
  }
});

// PUT /api/families/:familyId - Update a family
router.put('/families/:familyId', authenticateToken, familyValidationSchema.update, async (req, res) => {
  try {
    const family = await families.findById(req.params.familyId);
    if (!family || family.user_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Family not found'
      });
    }
    const updatedFamily = await families.update(req.params.familyId, req.body);
    res.json({
      success: true,
      data: updatedFamily
    });
  } catch (error) {
    logger.error('Error updating family:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating family'
    });
  }
});

// DELETE /api/families/:familyId - Delete a family
router.delete('/families/:familyId', authenticateToken, async (req, res) => {
  try {
    const family = await families.findById(req.params.familyId);
    if (!family || family.user_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Family not found'
      });
    }
    await families.delete(req.params.familyId);
    res.json({
      success: true,
      message: 'Family deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting family:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting family'
    });
  }
});

// POST /api/events/:eventId/families/:familyId/generate-qr - Generate QR code for a family
router.post('/events/:eventId/families/:familyId/generate-qr', authenticateToken, familyValidationSchema.generateQR, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (e) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Verify family belongs to user
    const family = await families.findById(req.params.familyId);
    if (!family || family.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Family not found' });
    }

    const { invitedCount } = req.body;
    const result = await qrCodeService.createQRCodeForFamily(
      req.params.eventId,
      req.params.familyId,
      req.user.id,
      invitedCount
    );

    res.json({
      success: true,
      message: 'QR code generated for family',
      data: result
    });
  } catch (error) {
    logger.error('Error generating QR code for family:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while generating QR code'
    });
  }
});


// POST /api/upload - Upload a file (image) to R2 with background optimization
// 🛡️ Rate limité pour éviter le spam
router.post('/upload', authenticateToken, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // 🛡️ SECURITY: Sanitize folder path to prevent path traversal
    let folder;
    try {
      folder = buildSecurePath(req.body.folder, req.body.eventId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid folder path'
      });
    }
    const imageUsage = req.body.imageUsage || 'general';

    // Handle image optimization with background processing
    if (req.file.mimetype.startsWith('image/')) {
      try {
        // Try to use background optimization queue
        const result = await addImageOptimizationJob({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          folder: folder,
          imageUsage: imageUsage, // 'avatar', 'banner', 'cover', or 'general'
          userId: req.user.id
        });

        // Check if result is a URL (direct processing) or job ID (queue processing)
        if (result.startsWith('http')) {
          // Direct processing completed, return the URL immediately
          res.json({
            success: true,
            message: 'File uploaded and optimized successfully',
            url: result
          });
        } else {
          // Queue processing started
          res.json({
            success: true,
            message: 'Upload initiated, optimization in progress',
            jobId: result
          });
        }
      } catch (optimizationError) {
        logger.error('Background optimization failed, falling back to direct', { error: optimizationError.message });
        
        // Fallback: optimize directly in the request
        const { buffer, mimetype, extension } = await imageService.optimizeImageByUsage(
          req.file.buffer,
          imageUsage
        );

        // Replace original file properties with optimized ones
        req.file.buffer = buffer;
        req.file.mimetype = mimetype;

        // Update originalname extension if needed
        const originalNameWithoutExt = req.file.originalname.substring(0, req.file.originalname.lastIndexOf('.')) || req.file.originalname;
        req.file.originalname = `${originalNameWithoutExt}${extension}`;

        const publicUrl = await storageService.uploadFile(req.file, folder);

        res.json({
          success: true,
          message: 'File uploaded successfully (direct processing)',
          url: publicUrl
        });
      }
    } else {
      // For non-image files, upload directly
      const publicUrl = await storageService.uploadFile(req.file, folder);

      res.json({
        success: true,
        message: 'File uploaded successfully',
        url: publicUrl
      });
    }
  } catch (error) {
    logger.error('Error uploading file:', { error: error.message });
    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Server error while uploading file'
    });
  }
});

// POST /api/upload/video - Upload a video file to R2
router.post('/upload/video', authenticateToken, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucune vidéo uploadée'
      });
    }

    logger.info('Video upload request', {
      originalname: sanitizeFilename(req.file.originalname),
      mimetype: req.file.mimetype,
      size: req.file.size,
      folder: req.body.folder || 'videos'
    });

    // 🛡️ SECURITY: Sanitize folder path to prevent path traversal
    let finalFolder;
    try {
      finalFolder = buildSecurePath(req.body.folder, req.body.eventId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid folder path'
      });
    }

    // Upload vidéo directement (pas d'optimisation pour les vidéos pour l'instant)
    const publicUrl = await storageService.uploadFile(req.file, finalFolder);

    logger.info('Video uploaded successfully', { url: publicUrl });

    res.json({
      success: true,
      message: 'Vidéo uploadée avec succès',
      url: publicUrl,
      data: {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        folder: finalFolder
      }
    });
  } catch (error) {
    logger.error('Error uploading video:', { error: error.message });
    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Erreur serveur lors de l\'upload de la vidéo'
    });
  }
});

// POST /api/upload/any - Upload any file (image or video) to R2
router.post('/upload/any', authenticateToken, uploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier uploadé'
      });
    }

    logger.info('File upload request', {
      originalname: sanitizeFilename(req.file.originalname),
      mimetype: req.file.mimetype,
      size: req.file.size,
      folder: req.body.folder || 'uploads'
    });

    // 🛡️ SECURITY: Sanitize folder path to prevent path traversal
    let finalFolder;
    try {
      finalFolder = buildSecurePath(req.body.folder, req.body.eventId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid folder path'
      });
    }
    const imageUsage = req.body.imageUsage || 'general';

    // Détecter si c'est une image ou une vidéo
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');

    if (isImage) {
      // Traitement spécial pour les images (optimisation)
      try {
        const result = await addImageOptimizationJob({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          folder: finalFolder,
          imageUsage: imageUsage,
          userId: req.user.id,
          eventId: eventId
        });

        if (result.startsWith('http')) {
          res.json({
            success: true,
            message: 'Fichier uploadé et optimisé avec succès',
            url: result,
            type: 'image'
          });
        } else {
          res.json({
            success: true,
            message: 'Upload démarré, optimisation en cours',
            jobId: result,
            type: 'image'
          });
        }
      } catch (optimizationError) {
        logger.error('Background optimization failed, falling back to direct', { error: optimizationError.message });
        
        // Fallback: optimize directly
        const { buffer, mimetype, extension } = await imageService.optimizeImageByUsage(
          req.file.buffer,
          imageUsage
        );

        req.file.buffer = buffer;
        req.file.mimetype = mimetype;

        const originalNameWithoutExt = req.file.originalname.substring(0, req.file.originalname.lastIndexOf('.')) || req.file.originalname;
        req.file.originalname = `${originalNameWithoutExt}${extension}`;

        const publicUrl = await storageService.uploadFile(req.file, finalFolder);

        res.json({
          success: true,
          message: 'Fichier uploadé avec succès (traitement direct)',
          url: publicUrl,
          type: 'image'
        });
      }
    } else if (isVideo) {
      // Upload vidéo directement
      const publicUrl = await storageService.uploadFile(req.file, finalFolder);

      res.json({
        success: true,
        message: 'Vidéo uploadée avec succès',
        url: publicUrl,
        type: 'video',
        data: {
          filename: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        }
      });
    } else {
      // Autres types de fichiers
      const publicUrl = await storageService.uploadFile(req.file, finalFolder);

      res.json({
        success: true,
        message: 'Fichier uploadé avec succès',
        url: publicUrl,
        type: 'other'
      });
    }
  } catch (error) {
    logger.error('Error uploading file:', { error: error.message });
    res.status(500).json({
      success: false,
      message: config.nodeEnv === 'development' ? error.message : 'Erreur serveur lors de l\'upload du fichier'
    });
  }
});

// GET /api/upload/health - Health check pour le service d'upload
router.get('/upload/health', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Service d\'upload opérationnel',
      config: {
        imageMaxSize: '5MB',
        videoMaxSize: '500MB',
        supportedImageTypes: ['jpeg', 'jpg', 'png', 'webp', 'gif', 'svg', 'bmp', 'tiff'],
        supportedVideoTypes: ['mp4', 'webm', 'mov', 'ogg', 'avi', 'mkv', 'mpeg']
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Service d\'upload indisponible'
    });
  }
});

// ==================== STORY EVENTS ROUTES ====================

// GET /api/events/:eventId/story-events - Get all story events for an event
router.get('/events/:eventId/story-events', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const storyEventsList = await storyEvents.findByEvent(req.params.eventId);

    res.json({
      success: true,
      data: storyEventsList,
      count: storyEventsList.length
    });
  } catch (error) {
    logger.error('Error fetching story events:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching story events'
    });
  }
});

// POST /api/events/:eventId/story-events - Create a new story event
router.post('/events/:eventId/story-events', authenticateToken, storyEventValidationSchema.create, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const storyEventData = {
      ...req.body,
      event_id: req.params.eventId,
      is_active: true
    };

    const storyEvent = await storyEvents.create(storyEventData);

    res.status(201).json({
      success: true,
      message: 'Story event created successfully',
      data: storyEvent
    });
  } catch (error) {
    logger.error('Error creating story event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating story event'
    });
  }
});

// PUT /api/events/:eventId/story-events/:storyEventId - Update a story event
router.put('/events/:eventId/story-events/:storyEventId', authenticateToken, storyEventValidationSchema.update, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Verify story event belongs to the event
    let storyEvent;
    try {
      storyEvent = await storyEvents.findById(req.params.storyEventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Story event not found'
      });
    }

    if (!storyEvent || storyEvent.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Story event not found or does not belong to this event'
      });
    }

    const updatedStoryEvent = await storyEvents.update(req.params.storyEventId, req.body);

    res.json({
      success: true,
      message: 'Story event updated successfully',
      data: updatedStoryEvent
    });
  } catch (error) {
    logger.error('Error updating story event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating story event'
    });
  }
});

// DELETE /api/events/:eventId/story-events/:storyEventId - Delete a story event
router.delete('/events/:eventId/story-events/:storyEventId', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Verify story event belongs to the event
    let storyEvent;
    try {
      storyEvent = await storyEvents.findById(req.params.storyEventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Story event not found'
      });
    }

    if (!storyEvent || storyEvent.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Story event not found or does not belong to this event'
      });
    }

    await storyEvents.softDelete(req.params.storyEventId);

    res.json({
      success: true,
      message: 'Story event deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting story event:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting story event'
    });
  }
});

// ==================== GAMES ROUTES ====================

// Helper function to verify event ownership
async function verifyEventOwnership(eventId, userId) {
  const event = await events.findById(eventId);
  if (!event || event.organizer_id !== userId) {
    return null;
  }
  return event;
}

// GET /api/events/:eventId/games - Get all games for an event
router.get('/events/:eventId/games', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const gamesList = await games.findByEvent(req.params.eventId);

    res.json({
      success: true,
      data: gamesList,
      count: gamesList.length
    });
  } catch (error) {
    logger.error('Error fetching games:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching games'
    });
  }
});

// GET /api/events/:eventId/games/:gameId - Get a specific game with questions
router.get('/events/:eventId/games/:gameId', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.getGameWithQuestions(req.params.gameId);
    
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      data: game
    });
  } catch (error) {
    logger.error('Error fetching game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching game'
    });
  }
});

// POST /api/events/:eventId/games - Create a new game
router.post('/events/:eventId/games', authenticateToken, gameValidationSchema.create, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const gameData = {
      ...req.body,
      event_id: req.params.eventId,
      status: 'draft',
      is_active: true
    };

    const game = await games.create(gameData);

    res.status(201).json({
      success: true,
      message: 'Game created successfully',
      data: game
    });
  } catch (error) {
    logger.error('Error creating game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating game'
    });
  }
});

// PUT /api/events/:eventId/games/:gameId - Update a game
router.put('/events/:eventId/games/:gameId', authenticateToken, gameValidationSchema.update, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const existingGame = await games.findById(req.params.gameId);
    if (!existingGame || existingGame.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const updatedGame = await games.update(req.params.gameId, req.body);

    res.json({
      success: true,
      message: 'Game updated successfully',
      data: updatedGame
    });
  } catch (error) {
    logger.error('Error updating game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating game'
    });
  }
});

// PATCH /api/events/:eventId/games/:gameId/status - Update game status
router.patch('/events/:eventId/games/:gameId/status', authenticateToken, gameValidationSchema.updateStatus, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const existingGame = await games.findById(req.params.gameId);
    if (!existingGame || existingGame.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const updatedGame = await games.updateStatus(req.params.gameId, req.body.status);

    res.json({
      success: true,
      message: `Game status updated to ${req.body.status}`,
      data: updatedGame
    });
  } catch (error) {
    logger.error('Error updating game status:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating game status'
    });
  }
});

// DELETE /api/events/:eventId/games/:gameId - Delete a game (soft delete)
router.delete('/events/:eventId/games/:gameId', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const existingGame = await games.findById(req.params.gameId);
    if (!existingGame || existingGame.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    await games.softDelete(req.params.gameId);

    res.json({
      success: true,
      message: 'Game deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting game:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting game'
    });
  }
});

// GET /api/events/:eventId/games/:gameId/stats - Get game statistics
router.get('/events/:eventId/games/:gameId/stats', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const existingGame = await games.findById(req.params.gameId);
    if (!existingGame || existingGame.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const stats = await games.getGameStats(req.params.gameId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching game stats:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching game statistics'
    });
  }
});

// ==================== QUESTIONS ROUTES ====================

// GET /api/events/:eventId/games/:gameId/questions - Get all questions for a game
router.get('/events/:eventId/games/:gameId/questions', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.findById(req.params.gameId);
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const questions = await games.findQuestionsByGame(req.params.gameId);

    res.json({
      success: true,
      data: questions,
      count: questions.length
    });
  } catch (error) {
    logger.error('Error fetching questions:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching questions'
    });
  }
});

// POST /api/events/:eventId/games/:gameId/questions - Add a question to a game
router.post('/events/:eventId/games/:gameId/questions', authenticateToken, questionValidationSchema.create, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.findById(req.params.gameId);
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const questionData = {
      ...req.body,
      game_id: req.params.gameId,
      is_active: true
    };

    const question = await games.createQuestion(questionData);

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: question
    });
  } catch (error) {
    logger.error('Error creating question:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating question'
    });
  }
});

// PUT /api/events/:eventId/games/:gameId/questions/:questionId - Update a question
router.put('/events/:eventId/games/:gameId/questions/:questionId', authenticateToken, questionValidationSchema.update, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.findById(req.params.gameId);
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const question = await games.findQuestionById(req.params.questionId);
    if (!question || question.game_id !== req.params.gameId) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const updatedQuestion = await games.updateQuestion(req.params.questionId, req.body);

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: updatedQuestion
    });
  } catch (error) {
    logger.error('Error updating question:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating question'
    });
  }
});

// DELETE /api/events/:eventId/games/:gameId/questions/:questionId - Delete a question
router.delete('/events/:eventId/games/:gameId/questions/:questionId', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.findById(req.params.gameId);
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const question = await games.findQuestionById(req.params.questionId);
    if (!question || question.game_id !== req.params.gameId) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    await games.deleteQuestion(req.params.questionId);

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting question:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting question'
    });
  }
});

// POST /api/events/:eventId/games/:gameId/questions/reorder - Reorder questions
router.post('/events/:eventId/games/:gameId/questions/reorder', authenticateToken, async (req, res) => {
  try {
    const event = await verifyEventOwnership(req.params.eventId, req.user.id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const game = await games.findById(req.params.gameId);
    if (!game || game.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({
        success: false,
        message: 'orderedIds must be an array'
      });
    }

    const updatedQuestions = await games.reorderQuestions(req.params.gameId, orderedIds);

    res.json({
      success: true,
      message: 'Questions reordered successfully',
      data: updatedQuestions
    });
  } catch (error) {
    logger.error('Error reordering questions:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while reordering questions'
    });
  }
});

// ============================================================================
// FAMILY INVITATIONS & RSVP ROUTES
// ============================================================================

// POST /api/events/:eventId/families/:familyId/invite - Create invitation for family
router.post('/events/:eventId/families/:familyId/invite', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Verify family belongs to user
    const family = await families.findById(req.params.familyId);
    if (!family || family.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Family not found' });
    }

    const { invitedCount = 1 } = req.body;

    // Check if invitation already exists
    const existingInvitations = await familyInvitations.findByEvent(req.params.eventId);
    const existingInvitation = existingInvitations.find(inv => inv.family_id === req.params.familyId);
    
    if (existingInvitation) {
      return res.status(409).json({
        success: false,
        message: 'An invitation already exists for this family'
      });
    }

    // Generate unique QR code
    // 🛡️ SECURITY FIX: Using UUID v4 as required by rules.md instead of Math.random
    const qrCode = `FAM-${uuidv4()}`;
    
    // Calculate expiration (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create invitation
    const invitation = await familyInvitations.create({
      family_id: req.params.familyId,
      event_id: req.params.eventId,
      user_id: req.user.id,
      invited_count: invitedCount,
      qr_code: qrCode,
      qr_expires_at: expiresAt.toISOString(),
      is_valid: true,
      scan_count: 0
    });

    res.status(201).json({
      success: true,
      message: 'Family invitation created successfully',
      data: {
        ...invitation,
        family: { name: family.name, members: family.members },
        event: { title: event.title, date: event.date }
      }
    });
  } catch (error) {
    logger.error('Error creating family invitation:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating family invitation'
    });
  }
});

// GET /api/events/:eventId/family-invitations - Get all family invitations for event
router.get('/events/:eventId/family-invitations', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const invitations = await familyInvitations.findByEvent(req.params.eventId);

    // Get RSVP stats for each invitation
    const invitationsWithStats = await Promise.all(
      invitations.map(async (inv) => {
        try {
          const stats = await familyRsvp.getStats(inv.id);
          return { ...inv, rsvp_stats: stats };
        } catch (e) {
          return { ...inv, rsvp_stats: { total: 0, attending: 0, notAttending: 0, notResponded: 0 } };
        }
      })
    );

    res.json({
      success: true,
      data: invitationsWithStats,
      count: invitationsWithStats.length
    });
  } catch (error) {
    logger.error('Error fetching family invitations:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching family invitations'
    });
  }
});

// DELETE /api/family-invitations/:invitationId - Delete a family invitation
router.delete('/family-invitations/:invitationId', authenticateToken, async (req, res) => {
  try {
    const invitation = await familyInvitations.findById(req.params.invitationId);
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    // Verify event belongs to user
    const event = await events.findById(invitation.event_id);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    await familyInvitations.delete(req.params.invitationId);

    res.json({
      success: true,
      message: 'Family invitation deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting family invitation:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting family invitation'
    });
  }
});

// PUBLIC ROUTE (no auth required) - GET /api/public/invitation/:qrCode - Get invitation by QR code
router.get('/public/invitation/:qrCode', async (req, res) => {
  try {
    const invitation = await familyInvitations.findByQRCode(req.params.qrCode);
    
    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    // Check if invitation is still valid
    if (!invitation.is_valid) {
      return res.status(400).json({
        success: false,
        message: 'This invitation has been invalidated'
      });
    }

    // Check if QR code has expired
    if (invitation.qr_expires_at && new Date(invitation.qr_expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This invitation has expired'
      });
    }

    // Increment scan count
    await familyInvitations.incrementScan(invitation.id);

    // Get existing RSVP responses
    const rsvpResponses = await familyRsvp.findByInvitation(invitation.id);

    res.json({
      success: true,
      data: {
        invitation: {
          id: invitation.id,
          qr_code: invitation.qr_code,
          invited_count: invitation.invited_count,
          created_at: invitation.created_at
        },
        family: invitation.families,
        event: invitation.events,
        rsvp_responses: rsvpResponses
      }
    });
  } catch (error) {
    logger.error('Error fetching public invitation:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invitation'
    });
  }
});

// PUBLIC ROUTE (no auth required) - POST /api/public/invitation/:qrCode/rsvp - Submit RSVP responses
router.post('/public/invitation/:qrCode/rsvp', async (req, res) => {
  try {
    const invitation = await familyInvitations.findByQRCode(req.params.qrCode);
    
    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    // Check if invitation is still valid
    if (!invitation.is_valid) {
      return res.status(400).json({
        success: false,
        message: 'This invitation has been invalidated'
      });
    }

    const { responses } = req.body; // Array of { member_name, will_attend, dietary_restrictions, notes }

    if (!Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Responses array is required'
      });
    }

    // Save each response
    const savedResponses = await Promise.all(
      responses.map(async (response) => {
        try {
          return await familyRsvp.upsert(invitation.id, response.member_name, {
            will_attend: response.will_attend,
            dietary_restrictions: response.dietary_restrictions,
            notes: response.notes
          });
        } catch (e) {
          logger.error('Error saving RSVP for member', { memberName: response.member_name, error: e.message });
          return null;
        }
      })
    );

    // Get updated stats
    const stats = await familyRsvp.getStats(invitation.id);

    res.json({
      success: true,
      message: 'RSVP responses saved successfully',
      data: {
        responses: savedResponses.filter(r => r !== null),
        stats
      }
    });
  } catch (error) {
    logger.error('Error saving RSVP:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while saving RSVP'
    });
  }
});

// GET /api/family-invitations/:invitationId/rsvp - Get RSVP responses for an invitation (authenticated)
router.get('/family-invitations/:invitationId/rsvp', authenticateToken, async (req, res) => {
  try {
    const invitation = await familyInvitations.findById(req.params.invitationId);
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    // Verify event belongs to user
    const event = await events.findById(invitation.event_id);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    const responses = await familyRsvp.findByInvitation(req.params.invitationId);
    const stats = await familyRsvp.getStats(req.params.invitationId);

    res.json({
      success: true,
      data: {
        responses,
        stats
      }
    });
  } catch (error) {
    logger.error('Error fetching RSVP responses:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching RSVP responses'
    });
  }
});

// ==================== WISHES ROUTES (VŒUX) ====================

// Validation schema for wishes
const wishValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      authorName: Joi.string().required().max(100),
      authorEmail: Joi.string().email().optional().allow(''),
      message: Joi.string().required().min(1).max(2000),
      style: Joi.string().valid('serif', 'cursive', 'modern').optional(),
      color: Joi.string().optional().max(50),
      guestId: Joi.string().uuid().optional()
    })
  })
};

// GET /api/events/:eventId/wishes - Get all wishes for an event (authenticated)
router.get('/events/:eventId/wishes', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const { limit = 100, offset = 0, isPublic } = req.query;
    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      isPublic: isPublic !== undefined ? isPublic === 'true' : null
    };

    const wishesList = await wishes.findByEvent(req.params.eventId, options);
    const stats = await wishes.getStats(req.params.eventId);

    res.json({
      success: true,
      data: wishesList,
      stats,
      count: wishesList.length
    });
  } catch (error) {
    logger.error('Error fetching wishes:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching wishes'
    });
  }
});

// GET /api/events/:eventId/wishes/public - Get public wishes for an event (NO AUTH required)
router.get('/events/:eventId/wishes/public', async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if guest book is enabled
    if (event.settings?.enableGuestBook === false) {
      return res.status(403).json({
        success: false,
        message: 'Guest book is disabled for this event'
      });
    }

    const { limit = 50, offset = 0 } = req.query;
    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      isPublic: true
    };

    const wishesList = await wishes.findByEvent(req.params.eventId, options);

    // Format for public display (remove sensitive info)
    const publicWishes = wishesList.map(wish => ({
      id: wish.id,
      authorName: wish.author_name,
      message: wish.message,
      style: wish.style,
      color: wish.color,
      createdAt: wish.created_at
    }));

    res.json({
      success: true,
      data: publicWishes,
      count: publicWishes.length
    });
  } catch (error) {
    logger.error('Error fetching public wishes:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching wishes'
    });
  }
});

// POST /api/events/:eventId/wishes - Create a new wish (NO AUTH required - public)
router.post('/events/:eventId/wishes', wishValidationSchema.create, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if guest book is enabled
    if (event.settings?.enableGuestBook === false) {
      return res.status(403).json({
        success: false,
        message: 'Guest book is disabled for this event'
      });
    }

    const { authorName, authorEmail, message, style, color, guestId } = req.body;

    // Verify guest ID if provided
    if (guestId) {
      const guest = await guests.findById(guestId);
      if (!guest || guest.event_id !== req.params.eventId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid guest ID'
        });
      }
    }

    // Check rate limiting based on IP
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    const wishData = {
      event_id: req.params.eventId,
      guest_id: guestId || null,
      author_name: authorName.trim(),
      author_email: authorEmail ? authorEmail.trim().toLowerCase() : null,
      message: message.trim(),
      style: style || 'serif',
      color: color || 'bg-[#F5E6D3]',
      is_public: true,
      is_moderated: false,
      ip_address: ipAddress,
      user_agent: req.headers['user-agent'] || null
    };

    const newWish = await wishes.create(wishData);

    res.status(201).json({
      success: true,
      message: 'Wish created successfully',
      data: {
        id: newWish.id,
        authorName: newWish.author_name,
        message: newWish.message,
        style: newWish.style,
        color: newWish.color,
        createdAt: newWish.created_at
      }
    });
  } catch (error) {
    logger.error('Error creating wish:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating wish'
    });
  }
});

// PUT /api/events/:eventId/wishes/:wishId/moderate - Moderate a wish (authenticated)
router.put('/events/:eventId/wishes/:wishId/moderate', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Verify wish belongs to the event
    const wish = await wishes.findById(req.params.wishId);
    if (!wish || wish.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Wish not found'
      });
    }

    const { isApproved } = req.body;
    const moderatedWish = await wishes.moderate(req.params.wishId, req.user.id, isApproved !== false);

    res.json({
      success: true,
      message: `Wish ${isApproved !== false ? 'approved' : 'rejected'} successfully`,
      data: moderatedWish
    });
  } catch (error) {
    logger.error('Error moderating wish:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while moderating wish'
    });
  }
});

// DELETE /api/events/:eventId/wishes/:wishId - Delete a wish (authenticated)
router.delete('/events/:eventId/wishes/:wishId', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Verify wish belongs to the event
    const wish = await wishes.findById(req.params.wishId);
    if (!wish || wish.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Wish not found'
      });
    }

    await wishes.delete(req.params.wishId);

    res.json({
      success: true,
      message: 'Wish deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting wish:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting wish'
    });
  }
});

// GET /api/events/:eventId/wishes/stats - Get wish statistics (authenticated)
router.get('/events/:eventId/wishes/stats', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const stats = await wishes.getStats(req.params.eventId);
    const todayCount = await wishes.countByEvent(req.params.eventId, { today: true });

    res.json({
      success: true,
      data: {
        ...stats,
        today: todayCount
      }
    });
  } catch (error) {
    logger.error('Error fetching wish stats:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching wish statistics'
    });
  }
});

// ============================================================================
// FEEDBACK & TESTIMONIALS ROUTES
// ============================================================================

// GET /api/events/:eventId/feedbacks - Get all feedbacks for an event
router.get('/events/:eventId/feedbacks', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const options = {
      feedbackType: req.query.type || null,
      isApproved: req.query.approved === 'true' ? true : req.query.approved === 'false' ? false : null,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0
    };

    const feedbacks = await feedback.findByEvent(req.params.eventId, options);

    res.json({
      success: true,
      data: feedbacks,
      count: feedbacks.length
    });
  } catch (error) {
    logger.error('Error fetching feedbacks:', { error: error.message });
    // Check if table doesn't exist
    if (error.message && error.message.includes('relation "feedbacks" does not exist')) {
      return res.status(500).json({
        success: false,
        message: 'Database table not found. Please run migration 009_add_feedback_table.sql'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching feedbacks'
    });
  }
});

// GET /api/events/:eventId/feedbacks/stats - Get feedback statistics
router.get('/events/:eventId/feedbacks/stats', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const [stats, ratingDistribution] = await Promise.all([
      feedback.getStats(req.params.eventId),
      feedback.getRatingDistribution(req.params.eventId)
    ]);

    res.json({
      success: true,
      data: {
        ...stats,
        ratingDistribution
      }
    });
  } catch (error) {
    logger.error('Error fetching feedback stats:', { error: error.message });
    // Check if table or view doesn't exist
    if (error.message && (error.message.includes('relation "feedbacks" does not exist') || error.message.includes('relation "feedback_stats" does not exist'))) {
      return res.status(500).json({
        success: false,
        message: 'Database table not found. Please run migration 009_add_feedback_table.sql'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching feedback statistics'
    });
  }
});

// POST /api/events/:eventId/feedbacks - Create a new feedback
router.post('/events/:eventId/feedbacks', authenticateToken, feedbackValidationSchema.create, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const feedbackData = {
      event_id: req.params.eventId,
      author_name: req.body.authorName,
      author_email: req.body.authorEmail?.toLowerCase(),
      message: req.body.message,
      feedback_type: req.body.feedbackType,
      rating: req.body.rating,
      category: req.body.category,
      tag: req.body.tag,
      accent_color: req.body.accentColor,
      family_id: req.body.familyId || null,
      guest_id: req.body.guestId || null,
      is_approved: true, // Auto-approve when created by organizer
      is_active: true
    };

    const newFeedback = await feedback.create(feedbackData);

    res.status(201).json({
      success: true,
      message: 'Feedback created successfully',
      data: newFeedback
    });
  } catch (error) {
    logger.error('Error creating feedback:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating feedback'
    });
  }
});

// PUT /api/events/:eventId/feedbacks/:feedbackId - Update a feedback
router.put('/events/:eventId/feedbacks/:feedbackId', authenticateToken, feedbackValidationSchema.update, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Find feedback
    const existingFeedback = await feedback.findById(req.params.feedbackId);
    if (!existingFeedback || existingFeedback.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    const updateData = {};
    if (req.body.authorName) updateData.author_name = req.body.authorName;
    if (req.body.authorEmail) updateData.author_email = req.body.authorEmail.toLowerCase();
    if (req.body.message) updateData.message = req.body.message;
    if (req.body.rating) updateData.rating = req.body.rating;
    if (req.body.category) updateData.category = req.body.category;
    if (req.body.tag) updateData.tag = req.body.tag;
    if (req.body.accentColor) updateData.accent_color = req.body.accentColor;
    if (req.body.isApproved !== undefined) updateData.is_approved = req.body.isApproved;
    if (req.body.isFeatured !== undefined) updateData.is_featured = req.body.isFeatured;

    const updatedFeedback = await feedback.update(req.params.feedbackId, updateData);

    res.json({
      success: true,
      message: 'Feedback updated successfully',
      data: updatedFeedback
    });
  } catch (error) {
    logger.error('Error updating feedback:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating feedback'
    });
  }
});

// DELETE /api/events/:eventId/feedbacks/:feedbackId - Delete a feedback (soft delete)
router.delete('/events/:eventId/feedbacks/:feedbackId', authenticateToken, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Find feedback
    const existingFeedback = await feedback.findById(req.params.feedbackId);
    if (!existingFeedback || existingFeedback.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    await feedback.softDelete(req.params.feedbackId);

    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting feedback:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting feedback'
    });
  }
});

// POST /api/events/:eventId/feedbacks/:feedbackId/moderate - Moderate a feedback
router.post('/events/:eventId/feedbacks/:feedbackId/moderate', authenticateToken, feedbackValidationSchema.moderation, async (req, res) => {
  try {
    // Verify event belongs to user
    let event;
    try {
      event = await events.findById(req.params.eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    // Find feedback
    const existingFeedback = await feedback.findById(req.params.feedbackId);
    if (!existingFeedback || existingFeedback.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    const { action } = req.body;
    let updatedFeedback;
    let message;

    switch (action) {
      case 'approve':
        updatedFeedback = await feedback.approve(req.params.feedbackId);
        message = 'Feedback approved successfully';
        break;
      case 'reject':
        updatedFeedback = await feedback.unapprove(req.params.feedbackId);
        message = 'Feedback rejected successfully';
        break;
      case 'feature':
        updatedFeedback = await feedback.setFeatured(req.params.feedbackId, true);
        message = 'Feedback marked as featured';
        break;
      case 'unfeature':
        updatedFeedback = await feedback.setFeatured(req.params.feedbackId, false);
        message = 'Feedback unmarked as featured';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid moderation action'
        });
    }

    res.json({
      success: true,
      message,
      data: updatedFeedback
    });
  } catch (error) {
    logger.error('Error moderating feedback:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while moderating feedback'
    });
  }
});

// PUBLIC ROUTE - POST /api/public/feedback/:eventId - Submit feedback from public (QR code)
router.post('/public/feedback/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { 
      authorName, 
      authorEmail, 
      message, 
      feedbackType = 'wish',
      rating,
      category,
      tag,
      accentColor,
      familyId,
      guestId,
      qrCode 
    } = req.body;

    // Validate required fields
    if (!authorName || !message) {
      return res.status(400).json({
        success: false,
        message: 'Author name and message are required'
      });
    }

    // Verify event exists and is active
    let event;
    try {
      event = await events.findById(eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or inactive'
      });
    }

    // If QR code is provided, validate it
    let validFamilyId = familyId;
    if (qrCode) {
      const invitation = await familyInvitations.findByQRCode(qrCode);
      if (invitation && invitation.event_id === eventId && invitation.is_valid) {
        validFamilyId = invitation.family_id;
      }
    }

    const feedbackData = {
      event_id: eventId,
      author_name: authorName,
      author_email: authorEmail?.toLowerCase(),
      message,
      feedback_type: feedbackType,
      rating,
      category,
      tag,
      accent_color: accentColor,
      family_id: validFamilyId || null,
      guest_id: guestId || null,
      qr_code_used: qrCode || null,
      source: qrCode ? 'qr_code' : 'direct',
      is_approved: false, // Requires moderation when submitted publicly
      is_active: true
    };

    const newFeedback = await feedback.create(feedbackData);

    res.status(201).json({
      success: true,
      message: 'Thank you for your feedback! It will be reviewed shortly.',
      data: {
        id: newFeedback.id,
        author_name: newFeedback.author_name,
        message: newFeedback.message,
        feedback_type: newFeedback.feedback_type,
        created_at: newFeedback.created_at
      }
    });
  } catch (error) {
    logger.error('Error submitting public feedback:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while submitting feedback'
    });
  }
});

// PUBLIC ROUTE - GET /api/public/feedback/:eventId - Get approved feedbacks for public display
router.get('/public/feedback/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const feedbackType = req.query.type || null;
    const limit = parseInt(req.query.limit) || 50;

    // Verify event exists and is active
    let event;
    try {
      event = await events.findById(eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (!event || !event.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or inactive'
      });
    }

    // Get only approved feedbacks for public display
    const feedbacks = await feedback.findByEvent(eventId, {
      feedbackType,
      isApproved: true,
      limit
    });

    res.json({
      success: true,
      data: feedbacks,
      count: feedbacks.length
    });
  } catch (error) {
    logger.error('Error fetching public feedbacks:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching feedbacks'
    });
  }
});

// ==================== SEATING TABLES ROUTES ====================

// Validation schemas for seating tables
const seatingTableValidationSchema = {
  create: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(100),
      seats: Joi.number().integer().min(1).max(50).required(),
      table_shape: Joi.string().valid('round', 'rectangular', 'square', 'oval').optional(),
      position_x: Joi.number().integer().optional(),
      position_y: Joi.number().integer().optional(),
      notes: Joi.string().max(500).optional()
    })
  }),

  update: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().max(100).optional(),
      seats: Joi.number().integer().min(1).max(50).optional(),
      table_shape: Joi.string().valid('round', 'rectangular', 'square', 'oval').optional(),
      position_x: Joi.number().integer().optional(),
      position_y: Joi.number().integer().optional(),
      notes: Joi.string().max(500).optional()
    })
  }),

  assignGuest: celebrate({
    [Segments.BODY]: Joi.object().keys({
      guestId: Joi.string().uuid().required(),
      seatNumber: Joi.number().integer().optional()
    })
  }),

  assignFamily: celebrate({
    [Segments.BODY]: Joi.object().keys({
      familyId: Joi.string().uuid().required(),
      seatNumber: Joi.number().integer().optional()
    })
  }),

  addManualGuest: celebrate({
    [Segments.BODY]: Joi.object().keys({
      firstName: Joi.string().required().max(50),
      lastName: Joi.string().required().max(50),
      email: Joi.string().email().optional().allow(''),
      phone: Joi.string().optional().max(20),
      dietaryRestrictions: Joi.string().max(200).optional(),
      notes: Joi.string().max(500).optional(),
      seatNumber: Joi.number().integer().optional()
    })
  })
};

// GET /api/events/:eventId/seating-tables - Get all seating tables for an event
router.get('/events/:eventId/seating-tables', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const tables = await seatingTables.findByEvent(req.params.eventId, req.user.id);

    res.json({
      success: true,
      data: tables,
      count: tables.length
    });
  } catch (error) {
    logger.error('Error fetching seating tables:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching seating tables'
    });
  }
});

// GET /api/events/:eventId/seating-tables/available-families - Get families not assigned to any table
router.get('/events/:eventId/seating-tables/available-families', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const availableFamilies = await seatingTables.getAvailableFamilies(req.params.eventId, req.user.id);

    res.json({
      success: true,
      data: availableFamilies,
      count: availableFamilies.length
    });
  } catch (error) {
    logger.error('Error fetching available families:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching available families'
    });
  }
});

// GET /api/events/:eventId/seating-tables/unassigned-guests - Get unassigned guests
router.get('/events/:eventId/seating-tables/unassigned-guests', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const unassignedGuests = await seatingTables.getUnassignedGuests(req.params.eventId, req.user.id);

    res.json({
      success: true,
      data: unassignedGuests,
      count: unassignedGuests.length
    });
  } catch (error) {
    logger.error('Error fetching unassigned guests:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching unassigned guests'
    });
  }
});

// GET /api/events/:eventId/seating-tables/stats - Get seating stats
router.get('/events/:eventId/seating-tables/stats', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const stats = await seatingTables.getStats(req.params.eventId, req.user.id);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching seating stats:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while fetching seating stats'
    });
  }
});

// POST /api/events/:eventId/seating-tables - Create a new seating table
router.post('/events/:eventId/seating-tables', authenticateToken, seatingTableValidationSchema.create, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const tableData = {
      ...req.body,
      event_id: req.params.eventId
    };

    const table = await seatingTables.create(tableData);

    res.status(201).json({
      success: true,
      message: 'Seating table created successfully',
      data: table
    });
  } catch (error) {
    logger.error('Error creating seating table:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while creating seating table'
    });
  }
});

// PUT /api/events/:eventId/seating-tables/:tableId - Update a seating table
router.put('/events/:eventId/seating-tables/:tableId', authenticateToken, seatingTableValidationSchema.update, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    const updatedTable = await seatingTables.update(req.params.tableId, req.body);

    res.json({
      success: true,
      message: 'Seating table updated successfully',
      data: updatedTable
    });
  } catch (error) {
    logger.error('Error updating seating table:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while updating seating table'
    });
  }
});

// DELETE /api/events/:eventId/seating-tables/:tableId - Delete a seating table
router.delete('/events/:eventId/seating-tables/:tableId', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    await seatingTables.delete(req.params.tableId);

    res.json({
      success: true,
      message: 'Seating table deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting seating table:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while deleting seating table'
    });
  }
});

// POST /api/events/:eventId/seating-tables/:tableId/assign-guest - Assign a guest to a table
router.post('/events/:eventId/seating-tables/:tableId/assign-guest', authenticateToken, seatingTableValidationSchema.assignGuest, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    const guest = await guests.findById(req.body.guestId);
    if (!guest || guest.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Guest not found or does not belong to this event'
      });
    }

    const existingAssignment = await seatingTables.findAssignmentByGuest(req.body.guestId);
    if (existingAssignment) {
      return res.status(409).json({
        success: false,
        message: 'Guest is already assigned to a table'
      });
    }

    const assignment = await seatingTables.assignGuest(
      req.params.tableId,
      req.body.guestId,
      req.body.seatNumber
    );

    res.status(201).json({
      success: true,
      message: 'Guest assigned to table successfully',
      data: assignment
    });
  } catch (error) {
    logger.error('Error assigning guest to table:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while assigning guest to table'
    });
  }
});

// POST /api/events/:eventId/seating-tables/:tableId/assign-family - Assign a family to a table
router.post('/events/:eventId/seating-tables/:tableId/assign-family', authenticateToken, seatingTableValidationSchema.assignFamily, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    const family = await families.findById(req.body.familyId);
    if (!family || family.user_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Family not found'
      });
    }

    const assignment = await seatingTables.assignFamily(
      req.params.tableId,
      req.body.familyId,
      req.body.seatNumber
    );

    res.status(201).json({
      success: true,
      message: 'Family assigned to table successfully',
      data: assignment
    });
  } catch (error) {
    logger.error('Error assigning family to table:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while assigning family to table'
    });
  }
});

// POST /api/events/:eventId/seating-tables/:tableId/add-manual-guest - Add manual guest to table
router.post('/events/:eventId/seating-tables/:tableId/add-manual-guest', authenticateToken, seatingTableValidationSchema.addManualGuest, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    const manualGuest = await seatingTables.addManualGuest(
      req.params.tableId,
      req.body
    );

    res.status(201).json({
      success: true,
      message: 'Manual guest added to table successfully',
      data: manualGuest
    });
  } catch (error) {
    logger.error('Error adding manual guest:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while adding manual guest'
    });
  }
});

// DELETE /api/events/:eventId/seating-tables/:tableId/assignments/:assignmentId - Remove assignment
router.delete('/events/:eventId/seating-tables/:tableId/assignments/:assignmentId', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    await seatingTables.removeAssignment(req.params.assignmentId);

    res.json({
      success: true,
      message: 'Assignment removed from table successfully'
    });
  } catch (error) {
    logger.error('Error removing assignment:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while removing assignment'
    });
  }
});

// DELETE /api/events/:eventId/seating-tables/:tableId/manual-guests/:manualGuestId - Remove manual guest
router.delete('/events/:eventId/seating-tables/:tableId/manual-guests/:manualGuestId', authenticateToken, async (req, res) => {
  try {
    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const table = await seatingTables.findById(req.params.tableId);
    if (!table || table.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Seating table not found'
      });
    }

    await seatingTables.removeManualGuest(req.params.manualGuestId);

    res.json({
      success: true,
      message: 'Manual guest removed from table successfully'
    });
  } catch (error) {
    logger.error('Error removing manual guest:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while removing manual guest'
    });
  }
});

// POST /api/events/:eventId/seating-tables/:tableId/move-assignment - Move assignment to another table
router.post('/events/:eventId/seating-tables/:tableId/move-assignment', authenticateToken, async (req, res) => {
  try {
    const { assignmentId, targetTableId, seatNumber } = req.body;

    const event = await events.findById(req.params.eventId);
    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found or you do not have permission to access it'
      });
    }

    const sourceTable = await seatingTables.findById(req.params.tableId);
    if (!sourceTable || sourceTable.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Source table not found'
      });
    }

    const targetTable = await seatingTables.findById(targetTableId);
    if (!targetTable || targetTable.event_id !== req.params.eventId) {
      return res.status(404).json({
        success: false,
        message: 'Target table not found'
      });
    }

    const updatedAssignment = await seatingTables.moveAssignment(assignmentId, targetTableId, seatNumber);

    res.json({
      success: true,
      message: 'Assignment moved to new table successfully',
      data: updatedAssignment
    });
  } catch (error) {
    logger.error('Error moving assignment:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Server error while moving assignment'
    });
  }
});

module.exports = router;
