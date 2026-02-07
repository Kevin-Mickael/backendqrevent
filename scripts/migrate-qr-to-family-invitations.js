const { qrCodes, familyInvitations } = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Migration script to create family invitation records for existing QR codes
 */
async function migrateQRCodesToFamilyInvitations() {
    try {
        logger.info('Starting QR codes to family invitations migration...');

        // Find all QR codes that have family_id (family QR codes)
        const familyQRCodes = await qrCodes.findByFamily();
        
        if (!familyQRCodes || familyQRCodes.length === 0) {
            logger.info('No family QR codes found to migrate');
            return;
        }

        logger.info(`Found ${familyQRCodes.length} family QR codes to migrate`);

        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const qrCode of familyQRCodes) {
            try {
                // Check if family invitation already exists for this QR code
                const existingInvitation = await familyInvitations.findByQRCode(qrCode.code);
                
                if (existingInvitation) {
                    logger.info(`Invitation already exists for QR code ${qrCode.code}`);
                    skippedCount++;
                    continue;
                }

                // Create family invitation record
                const familyInvitationData = {
                    family_id: qrCode.family_id,
                    event_id: qrCode.event_id,
                    user_id: qrCode.generated_by,
                    invited_count: qrCode.invited_count || 1,
                    qr_code: qrCode.code,
                    qr_expires_at: qrCode.expires_at,
                    is_valid: qrCode.is_valid,
                    scan_count: 0,
                    created_at: qrCode.created_at
                };

                await familyInvitations.create(familyInvitationData);
                migratedCount++;
                
                logger.info(`✅ Created family invitation for QR code ${qrCode.code}`);

            } catch (error) {
                logger.error(`❌ Error migrating QR code ${qrCode.code}:`, error.message);
                errorCount++;
            }
        }

        logger.info('Migration completed:');
        logger.info(`  📊 Total QR codes: ${familyQRCodes.length}`);
        logger.info(`  ✅ Migrated: ${migratedCount}`);
        logger.info(`  ⏭️ Skipped: ${skippedCount}`);
        logger.info(`  ❌ Errors: ${errorCount}`);

    } catch (error) {
        logger.error('Migration failed:', error);
        throw error;
    }
}

// Check if running directly
if (require.main === module) {
    migrateQRCodesToFamilyInvitations()
        .then(() => {
            console.log('Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { migrateQRCodesToFamilyInvitations };