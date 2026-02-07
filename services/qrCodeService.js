const { qrCodes, guests, events, users, families, familyInvitations } = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config/config');
const auditService = require('./auditService');

/**
 * Generate a unique and secure QR code
 * Following security rules: unique, unpredictable, with expiration
 * 🛡️ SECURITY FIX: Using UUID v4 as required by rules.md
 */
const generateSecureQRCode = () => {
  // Generate a cryptographically secure UUID v4 as required by rules.md
  // UUID v4 provides 122 bits of entropy, much more secure than hex string
  return uuidv4();
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
      const existingQR = await qrCodes.findByCode(qrCode);
      if (existingQR) {
        // QR code already exists, try again
        isUnique = false;
      } else {
        // QR code doesn't exist, it's unique
        isUnique = true;
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

    // 🛡️ Log QR code generation for audit
    await auditService.logEvent({
      userId: userId,
      action: auditService.ACTIONS.QR_GENERATE,
      resourceType: auditService.RESOURCE_TYPES.QR_CODE,
      resourceId: savedQRCode.id,
      eventId: eventId,
      details: {
        guestId: guestId,
        qrCode: qrCode,
        expiresAt: expiresAt.toISOString(),
        generatedFor: 'guest'
      },
      severity: auditService.SEVERITIES.INFO,
      success: true
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

    // Validate invitedCount does not exceed max_people
    const maxPeople = family.max_people || family.members?.length || 1;
    if (invitedCount > maxPeople) {
      throw new Error(`Invited count (${invitedCount}) exceeds maximum allowed (${maxPeople}) for this family`);
    }

    // Generate unique QR code
    let qrCode;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      qrCode = generateSecureQRCode();

      // Check if QR code already exists
      const existingQR = await qrCodes.findByCode(qrCode);
      if (existingQR) {
        // QR code already exists, try again
        isUnique = false;
      } else {
        // QR code doesn't exist, it's unique
        isUnique = true;
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

    // Check if family invitation already exists for this family/event
    let savedFamilyInvitation;
    try {
      const existingInvitation = await familyInvitations.findByFamily(familyId);
      const familyEventInvitation = existingInvitation.find(inv => inv.event_id === eventId);
      
      if (familyEventInvitation) {
        // Update existing invitation with this QR code if needed
        savedFamilyInvitation = await familyInvitations.update(familyEventInvitation.id, {
          qr_code: qrCode,
          qr_expires_at: expiresAt.toISOString(),
          invited_count: Math.max(familyEventInvitation.invited_count, invitedCount)
        });
      } else {
        // Create new family invitation record
        const familyInvitationData = {
          family_id: familyId,
          event_id: eventId,
          user_id: userId,
          invited_count: invitedCount,
          qr_code: qrCode,
          qr_expires_at: expiresAt.toISOString(),
          is_valid: true,
          scan_count: 0
        };
        savedFamilyInvitation = await familyInvitations.create(familyInvitationData);
      }
    } catch (error) {
      console.error('Error managing family invitation:', error);
      // Continue without family invitation if there's an error
      savedFamilyInvitation = { id: null };
    }

    return {
      success: true,
      qrCode: savedQRCode.code,
      expiresAt: savedQRCode.expires_at,
      familyId: savedQRCode.family_id,
      eventId: savedQRCode.event_id,
      invitedCount: invitedCount,
      invitationId: savedFamilyInvitation.id
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
    const qrCodeDoc = await qrCodes.findByCode(qrCode);

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

    // 🛡️ Log QR code scan for audit
    await auditService.logEvent({
      userId: null, // QR scans can be anonymous
      action: auditService.ACTIONS.QR_SCAN,
      resourceType: auditService.RESOURCE_TYPES.QR_CODE,
      resourceId: qrCodeDoc.id,
      eventId: qrCodeDoc.event_id,
      details: {
        qrCode: qrCode,
        guestId: qrCodeDoc.guest_id,
        scanCount: updatedQRCode.scan_count,
        lastScanned: updatedQRCode.last_scanned_at,
        validationResult: 'success'
      },
      severity: auditService.SEVERITIES.INFO,
      success: true
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
    const qrCodeDoc = await qrCodes.findByCode(qrCode);

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