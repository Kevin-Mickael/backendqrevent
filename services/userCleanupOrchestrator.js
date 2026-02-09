/**
 * Orchestrateur pour la suppression complète d'un utilisateur
 * Coordonne la suppression des données en base et des fichiers R2
 */

const userDirectoryCleanupService = require('./userDirectoryCleanupService');
const auditService = require('./auditService');

class UserCleanupOrchestrator {
    /**
     * Orchestre la suppression complète d'un utilisateur
     * 1. Supprime les fichiers R2
     * 2. Les données en base sont supprimées automatiquement par les triggers CASCADE
     * 3. Journalise toutes les opérations
     * 
     * @param {string} userId - ID de l'utilisateur à supprimer
     * @param {string} reason - Raison de la suppression (pour audit)
     * @param {Object} context - Contexte de suppression (qui l'a demandée, etc.)
     * @returns {Promise<Object>} Résultat complet de la suppression
     */
    async orchestrateUserDeletion(userId, reason = 'User requested deletion', context = {}) {
        const startTime = Date.now();
        const deletionId = `deletion_${userId}_${startTime}`;
        
        console.log(`[UserCleanup] Starting orchestrated deletion for user ${userId} (${deletionId})`);

        const result = {
            deletionId,
            userId,
            reason,
            context,
            startTime,
            endTime: null,
            success: false,
            steps: {
                storageCleanup: { attempted: false, success: false, details: null },
                auditLog: { attempted: false, success: false, details: null }
            },
            summary: null
        };

        try {
            // Étape 1: Récupérer les statistiques avant suppression (pour audit)
            console.log(`[UserCleanup] Getting storage stats before deletion...`);
            const preDeleteStats = await userDirectoryCleanupService.getUserStorageStats(userId);
            
            // Étape 2: Nettoyer les fichiers R2
            console.log(`[UserCleanup] Cleaning up R2 storage...`);
            result.steps.storageCleanup.attempted = true;
            
            const storageResult = await userDirectoryCleanupService.cleanupUserDirectory(userId);
            result.steps.storageCleanup.success = storageResult.success;
            result.steps.storageCleanup.details = storageResult;

            if (!storageResult.success) {
                console.warn(`[UserCleanup] Storage cleanup failed:`, storageResult.message);
                // Continue quand même - les données en base seront supprimées
            } else {
                console.log(`[UserCleanup] Storage cleanup successful: ${storageResult.filesDeleted} files deleted`);
            }

            // Étape 3: Journaliser dans l'audit
            console.log(`[UserCleanup] Creating audit log...`);
            result.steps.auditLog.attempted = true;
            
            try {
                const auditData = {
                    action: 'user_deletion_orchestrated',
                    user_id: userId,
                    details: {
                        deletionId,
                        reason,
                        context,
                        preDeleteStats: preDeleteStats.success ? preDeleteStats.stats : null,
                        storageCleanup: result.steps.storageCleanup,
                        timestamp: new Date().toISOString()
                    }
                };

                // Tentative d'audit (peut échouer si la DB est déjà down)
                if (auditService && typeof auditService.logAction === 'function') {
                    await auditService.logAction('system', auditData.action, auditData.details);
                    result.steps.auditLog.success = true;
                    result.steps.auditLog.details = { message: 'Audit logged successfully' };
                } else {
                    console.warn(`[UserCleanup] Audit service not available`);
                    result.steps.auditLog.success = false;
                    result.steps.auditLog.details = { message: 'Audit service not available' };
                }

            } catch (auditError) {
                console.warn(`[UserCleanup] Audit logging failed:`, auditError.message);
                result.steps.auditLog.success = false;
                result.steps.auditLog.details = { error: auditError.message };
            }

            // Compilation des résultats
            result.endTime = Date.now();
            result.success = result.steps.storageCleanup.success; // Le storage est critique
            
            const filesDeleted = result.steps.storageCleanup.success ? 
                result.steps.storageCleanup.details.filesDeleted : 0;

            result.summary = {
                duration: result.endTime - result.startTime,
                filesDeleted,
                storageCleanupSuccess: result.steps.storageCleanup.success,
                auditLogSuccess: result.steps.auditLog.success,
                message: result.success ? 
                    `User deletion orchestrated successfully (${filesDeleted} files deleted)` :
                    'User deletion partially completed (storage cleanup failed)'
            };

            console.log(`[UserCleanup] Orchestration completed for ${userId}:`, result.summary);

            return result;

        } catch (error) {
            result.endTime = Date.now();
            result.success = false;
            result.summary = {
                duration: result.endTime - result.startTime,
                error: error.message,
                message: `User deletion orchestration failed: ${error.message}`
            };

            console.error(`[UserCleanup] Orchestration failed for ${userId}:`, error);
            return result;
        }
    }

    /**
     * Nettoie seulement les fichiers temporaires d'un utilisateur
     * @param {string} userId - ID de l'utilisateur
     * @returns {Promise<Object>} Résultat du nettoyage
     */
    async cleanupUserTempFiles(userId) {
        console.log(`[UserCleanup] Cleaning temp files for user ${userId}`);
        
        try {
            const result = await userDirectoryCleanupService.cleanupUserTempFiles(userId);
            
            // Log pour audit si disponible
            if (auditService && result.success && result.filesDeleted > 0) {
                try {
                    await auditService.logAction('system', 'temp_files_cleanup', {
                        user_id: userId,
                        files_deleted: result.filesDeleted
                    });
                } catch (auditError) {
                    console.warn('Failed to log temp cleanup:', auditError.message);
                }
            }

            return result;

        } catch (error) {
            console.error(`[UserCleanup] Temp cleanup failed for ${userId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Obtient des statistiques de stockage pour un utilisateur
     * @param {string} userId - ID de l'utilisateur
     * @returns {Promise<Object>} Statistiques
     */
    async getUserStorageStats(userId) {
        try {
            return await userDirectoryCleanupService.getUserStorageStats(userId);
        } catch (error) {
            console.error(`[UserCleanup] Failed to get storage stats for ${userId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Fonction appelée par les triggers de base de données
     * Déclenche le nettoyage automatique lors de la suppression d'un utilisateur
     * @param {string} userId - ID de l'utilisateur supprimé
     * @param {string} triggerSource - Source du trigger (auth.users, public.users)
     * @returns {Promise<void>}
     */
    async handleDatabaseUserDeletion(userId, triggerSource = 'unknown') {
        console.log(`[UserCleanup] Database deletion trigger for ${userId} from ${triggerSource}`);

        try {
            // Nettoyage asynchrone en arrière-plan
            // Ne pas attendre pour éviter de bloquer le trigger DB
            setTimeout(async () => {
                await this.orchestrateUserDeletion(userId, `Automatic cleanup from ${triggerSource}`, {
                    triggerSource,
                    automatic: true,
                    triggeredAt: new Date().toISOString()
                });
            }, 1000); // Délai de 1 seconde pour permettre au trigger DB de se terminer

            console.log(`[UserCleanup] Scheduled async cleanup for ${userId}`);

        } catch (error) {
            console.error(`[UserCleanup] Error scheduling cleanup for ${userId}:`, error);
        }
    }
}

module.exports = new UserCleanupOrchestrator();