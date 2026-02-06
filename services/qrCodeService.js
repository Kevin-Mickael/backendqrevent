const { qrCodes, guests, events, users, families } = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config/config');

/**
 * Generate a unique and secure QR code
 * Following security rules: unique, unpredictable, with expiration
 */
const generateSecureQRCode = () => {
  // Generate a random string using crypto for better security
  const randomBytes = crypto.randomBytes(Math.ceil(config.qrCodeLength / 2));
  const qrCode = randomBytes.toString('hex').substring(0, config.qrCodeLength);

  return qrCode;
};

/**
 * Create a new QR code for a guest
 */
const createQRCodeForGuest = async (eventId, guestId, userId) => {
  try {
    // Validate inputs
    if (!eventId || !guestId || !userId) {
      throw new Error('Event ID, Guest ID, and User ID are required');
    }

    // Check if event and guest exist
    let event, guest, user;
    try {
      event = await events.findById(eventId);
    } catch (error) {
      throw new Error('Event not found');
    }

    try {
      guest = await guests.findById(guestId);
    } catch (error) {
      throw new Error('Guest not found');
    }

    try {
      user = await users.findById(userId);
    } catch (error) {
      throw new Error('User not found');
    }

    if (!event) throw new Error('Event not found');
    if (!guest) throw new Error('Guest not found');
    if (!user) throw new Error('User not found');

    // Check if guest belongs to the event
    if (guest.event_id !== eventId) {
      throw new Error('Guest does not belong to this event');
    }

    // Generate unique QR code
    let qrCode;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      qrCode = generateSecureQRCode();

      // Check if QR code already exists
      try {
        await qrCodes.findByCode(qrCode);
      } catch (error) {
        // If QR code doesn't exist, it means it's unique
        if (error.message.includes('Row not found')) {
          isUnique = true;
        } else {
          throw error;
        }
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error('Could not generate unique QR code after multiple attempts');
    }

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.qrCodeExpirationHours);

    // Create QR code document
    const qrCodeData = {
      code: qrCode,
      event_id: eventId,
      guest_id: guestId,
      generated_by: userId,
      expires_at: expiresAt.toISOString(),
      is_valid: true
    };

    const savedQRCode = await qrCodes.create(qrCodeData);

    // Update guest with QR code info
    await guests.update(guestId, {
      qr_code: qrCode,
      qr_generated_at: new Date().toISOString(),
      qr_expires_at: expiresAt.toISOString()
    });

    return {
      success: true,
      qrCode: savedQRCode.code,
      expiresAt: savedQRCode.expires_at,
      guestId: savedQRCode.guest_id,
      eventId: savedQRCode.event_id
    };
  } catch (error) {
    console.error('Error creating QR code for guest:', error);
    throw error;
  }
};

/**
 * Create a new QR code for a family
 */
const createQRCodeForFamily = async (eventId, familyId, userId, invitedCount) => {
  try {
    // Validate inputs
    if (!eventId || !familyId || !userId) {
      throw new Error('Event ID, Family ID, and User ID are required');
    }

    // Check if event and family exist
    let event, family, user;
    try {
      event = await events.findById(eventId);
    } catch (error) {
      throw new Error('Event not found');
    }

    try {
      family = await families.findById(familyId);
    } catch (error) {
      throw new Error('Family not found');
    }

    try {
      user = await users.findById(userId);
    } catch (error) {
      throw new Error('User not found');
    }

    if (!event) throw new Error('Event not found');
    if (!family) throw new Error('Family not found');
    if (!user) throw new Error('User not found');

    // Generate unique QR code
    let qrCode;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      qrCode = generateSecureQRCode();

      try {
        await qrCodes.findByCode(qrCode);
      } catch (error) {
        if (error.message.includes('Row not found')) {
          isUnique = true;
        } else {
          throw error;
        }
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error('Could not generate unique QR code after multiple attempts');
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (config.qrCodeExpirationHours || 24 * 365)); // Default to 1 year if not set

    // Create QR code document
    const qrCodeData = {
      code: qrCode,
      event_id: eventId,
      family_id: familyId,
      generated_by: userId,
      expires_at: expiresAt.toISOString(),
      invited_count: invitedCount,
      is_valid: true
    };

    const savedQRCode = await qrCodes.create(qrCodeData);

    return {
      success: true,
      qrCode: savedQRCode.code,
      expiresAt: savedQRCode.expires_at,
      familyId: savedQRCode.family_id,
      eventId: savedQRCode.event_id,
      invitedCount: invitedCount
    };
  } catch (error) {
    console.error('Error creating QR code for family:', error);
    throw error;
  }
};

/**
 * Validate a QR code
 */
const validateQRCode = async (qrCode) => {
  try {
    if (!qrCode) {
      throw new Error('QR code is required');
    }

    // Find the QR code document
    let qrCodeDoc;
    try {
      qrCodeDoc = await qrCodes.findByCode(qrCode);
    } catch (error) {
      return {
        success: false,
        message: 'Invalid or expired QR code'
      };
    }

    if (!qrCodeDoc) {
      return {
        success: false,
        message: 'Invalid or expired QR code'
      };
    }

    // Increment scan count
    const updatedQRCode = await qrCodes.update(qrCodeDoc.id, {
      scan_count: qrCodeDoc.scan_count + 1,
      last_scanned_at: new Date().toISOString()
    });

    // Get associated guest and event data
    let guest, event;
    try {
      guest = await guests.findById(qrCodeDoc.guest_id);
      event = await events.findById(qrCodeDoc.event_id);
    } catch (error) {
      console.error('Error fetching guest or event data:', error);
      throw error;
    }

    return {
      success: true,
      qrCode: updatedQRCode.code,
      guest: guest,
      event: event,
      isValid: updatedQRCode.is_valid,
      expiresAt: updatedQRCode.expires_at,
      scanCount: updatedQRCode.scan_count
    };
  } catch (error) {
    console.error('Error validating QR code:', error);
    throw error;
  }
};

/**
 * Invalidate a QR code (for security purposes)
 */
const invalidateQRCode = async (qrCodeId, reason = 'Manual invalidation') => {
  try {
    const updatedQRCode = await qrCodes.invalidate(qrCodeId);

    if (!updatedQRCode) {
      throw new Error('QR code not found');
    }

    return {
      success: true,
      message: 'QR code invalidated successfully',
      qrCode: updatedQRCode
    };
  } catch (error) {
    console.error('Error invalidating QR code:', error);
    throw error;
  }
};

/**
 * Generate multiple QR codes for guests in an event
 */
const generateQRCodeBatch = async (eventId, userId) => {
  try {
    // Get all guests for the event that don't have a QR code yet
    const allGuests = await guests.findByEvent(eventId);
    const guestsWithoutQR = allGuests.filter(guest => !guest.qr_code);

    const results = [];
    for (const guest of guestsWithoutQR) {
      try {
        const result = await createQRCodeForGuest(eventId, guest.id, userId);
        results.push(result);
      } catch (error) {
        console.error(`Failed to create QR code for guest ${guest.id}:`, error.message);
        results.push({
          guestId: guest.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error generating QR code batch:', error);
    throw error;
  }
};

/**
 * Refresh an existing QR code (extend expiration)
 */
const refreshQRCode = async (qrCode, hoursToAdd = config.qrCodeExpirationHours) => {
  try {
    let qrCodeDoc;
    try {
      qrCodeDoc = await qrCodes.findByCode(qrCode);
    } catch (error) {
      throw new Error('QR code not found or invalid');
    }

    if (!qrCodeDoc || !qrCodeDoc.is_valid) {
      throw new Error('QR code not found or invalid');
    }

    // Extend expiration time
    const newExpiresAt = new Date(qrCodeDoc.expires_at);
    newExpiresAt.setHours(newExpiresAt.getHours() + hoursToAdd);

    const updatedQRCode = await qrCodes.update(qrCodeDoc.id, {
      expires_at: newExpiresAt.toISOString()
    });

    return {
      success: true,
      message: 'QR code refreshed successfully',
      qrCode: updatedQRCode.code,
      newExpiresAt: updatedQRCode.expires_at
    };
  } catch (error) {
    console.error('Error refreshing QR code:', error);
    throw error;
  }
};

module.exports = {
  generateSecureQRCode,
  createQRCodeForGuest,
  validateQRCode,
  invalidateQRCode,
  generateQRCodeBatch,
  refreshQRCode,
  createQRCodeForFamily
};