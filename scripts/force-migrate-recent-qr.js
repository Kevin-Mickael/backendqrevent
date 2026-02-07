const { qrCodes, familyInvitations } = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Script pour forcer la migration des QR codes récents en supprimant d'abord les doublons
 */
async function forceMigrateRecentQR() {
    try {
        logger.info('Démarrage de la migration forcée des QR codes récents...');

        // Trouver tous les QR codes famille
        const familyQRCodes = await qrCodes.findByFamily();
        
        if (!familyQRCodes || familyQRCodes.length === 0) {
            logger.info('Aucun QR code famille trouvé');
            return;
        }

        logger.info(`Trouvé ${familyQRCodes.length} QR codes famille à traiter`);

        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const qrCode of familyQRCodes) {
            try {
                // Vérifier si l'invitation famille existe déjà
                const existingInvitation = await familyInvitations.findByQRCode(qrCode.code);
                
                if (existingInvitation) {
                    logger.info(`✅ Invitation existe déjà pour QR code ${qrCode.code}`);
                    skippedCount++;
                    continue;
                }

                // Vérifier s'il y a une invitation existante pour cette famille/événement
                const existingByFamily = await familyInvitations.findByFamily(qrCode.family_id);
                const duplicateForEvent = existingByFamily.find(inv => inv.event_id === qrCode.event_id);

                if (duplicateForEvent) {
                    // Supprimer l'ancienne invitation pour cette famille/événement
                    logger.info(`Suppression de l'ancienne invitation ${duplicateForEvent.id} pour famille ${qrCode.family_id}`);
                    await familyInvitations.delete(duplicateForEvent.id);
                }

                // Créer la nouvelle invitation famille
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
                
                logger.info(`✅ Migration réussie pour QR code ${qrCode.code}`);

            } catch (error) {
                logger.error(`❌ Erreur lors de la migration du QR code ${qrCode.code}:`, error.message);
                errorCount++;
            }
        }

        logger.info('Migration forcée terminée:');
        logger.info(`  📊 Total QR codes: ${familyQRCodes.length}`);
        logger.info(`  ✅ Migrés: ${migratedCount}`);
        logger.info(`  ⏭️ Ignorés: ${skippedCount}`);
        logger.info(`  ❌ Erreurs: ${errorCount}`);

    } catch (error) {
        logger.error('Migration forcée échouée:', error);
        throw error;
    }
}

// Vérifier si exécuté directement
if (require.main === module) {
    forceMigrateRecentQR()
        .then(() => {
            console.log('Migration forcée terminée avec succès');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration forcée échouée:', error);
            process.exit(1);
        });
}

module.exports = { forceMigrateRecentQR };