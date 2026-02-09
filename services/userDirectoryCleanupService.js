/**
 * Service de nettoyage automatique des répertoires utilisateurs dans Cloudflare R2
 * Se déclenche automatiquement lors de la suppression d'un utilisateur
 */

const { ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { r2Client } = require('../config/r2');
const config = require('../config/config');
const pathBuilder = require('./pathBuilder');

class UserDirectoryCleanupService {
    constructor() {
        this.client = r2Client;
        this.bucket = config.r2Bucket;
    }

    /**
     * Vérifie si le service est configuré
     * @returns {boolean}
     */
    isConfigured() {
        return !!(this.client && this.bucket);
    }

    /**
     * Nettoie tous les fichiers d'un utilisateur dans R2
     * @param {string} userId - ID de l'utilisateur à supprimer
     * @returns {Promise<Object>} Résultat du nettoyage
     */
    async cleanupUserDirectory(userId) {
        if (!this.isConfigured()) {
            console.warn('[Cleanup] R2 not configured, skipping directory cleanup for user:', userId);
            return { success: false, message: 'R2 not configured' };
        }

        if (!userId) {
            throw new Error('userId est requis pour le nettoyage');
        }

        // Validation UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
            throw new Error('userId doit être un UUID valide');
        }

        const userPrefix = `users/${userId}/`;
        
        console.log(`[Cleanup] Starting cleanup for user directory: ${userPrefix}`);

        try {
            // 1. Lister tous les fichiers de l'utilisateur
            const allFiles = await this.listAllUserFiles(userPrefix);
            
            if (allFiles.length === 0) {
                console.log(`[Cleanup] No files found for user ${userId}`);
                return {
                    success: true,
                    message: 'No files to delete',
                    filesDeleted: 0,
                    details: { userPrefix, filesFound: 0 }
                };
            }

            console.log(`[Cleanup] Found ${allFiles.length} files to delete for user ${userId}`);

            // 2. Supprimer tous les fichiers par lots
            const deleteResults = await this.deleteFilesInBatches(allFiles);

            // 3. Compiler les résultats
            const totalDeleted = deleteResults.reduce((sum, result) => sum + result.deleted, 0);
            const errors = deleteResults.filter(result => result.errors.length > 0);

            console.log(`[Cleanup] Successfully deleted ${totalDeleted} files for user ${userId}`);
            
            if (errors.length > 0) {
                console.warn(`[Cleanup] Some deletion errors occurred:`, errors);
            }

            return {
                success: true,
                message: `Successfully cleaned up user directory`,
                filesDeleted: totalDeleted,
                details: {
                    userPrefix,
                    filesFound: allFiles.length,
                    batchResults: deleteResults,
                    errors: errors.length > 0 ? errors : undefined
                }
            };

        } catch (error) {
            console.error(`[Cleanup] Error cleaning up user directory for ${userId}:`, error);
            return {
                success: false,
                message: error.message,
                details: { userPrefix, error: error.message }
            };
        }
    }

    /**
     * Liste récursivement tous les fichiers d'un utilisateur
     * @param {string} prefix - Préfixe du répertoire utilisateur
     * @returns {Promise<Array>} Liste des clés de fichiers
     */
    async listAllUserFiles(prefix) {
        const allFiles = [];
        let continuationToken = null;

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
                MaxKeys: 1000 // AWS recommande max 1000 par requête
            });

            try {
                const response = await this.client.send(listCommand);
                
                if (response.Contents) {
                    const fileKeys = response.Contents.map(obj => obj.Key);
                    allFiles.push(...fileKeys);
                    
                    console.log(`[Cleanup] Listed ${fileKeys.length} files (total: ${allFiles.length})`);
                }

                continuationToken = response.NextContinuationToken;

            } catch (error) {
                console.error('[Cleanup] Error listing files:', error);
                throw new Error(`Failed to list files: ${error.message}`);
            }

        } while (continuationToken);

        return allFiles;
    }

    /**
     * Supprime les fichiers par lots (max 1000 par lot selon AWS)
     * @param {Array} fileKeys - Liste des clés de fichiers à supprimer
     * @returns {Promise<Array>} Résultats de suppression par lot
     */
    async deleteFilesInBatches(fileKeys) {
        const batchSize = 1000; // Limite AWS pour delete objects
        const batches = [];
        const results = [];

        // Diviser en lots
        for (let i = 0; i < fileKeys.length; i += batchSize) {
            batches.push(fileKeys.slice(i, i + batchSize));
        }

        console.log(`[Cleanup] Deleting ${fileKeys.length} files in ${batches.length} batches`);

        // Supprimer chaque lot
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(`[Cleanup] Processing batch ${i + 1}/${batches.length} (${batch.length} files)`);

            try {
                const deleteResult = await this.deleteBatch(batch);
                results.push(deleteResult);
                
                // Petite pause entre les lots pour éviter la surcharge
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

            } catch (error) {
                console.error(`[Cleanup] Error in batch ${i + 1}:`, error);
                results.push({
                    deleted: 0,
                    errors: [`Batch ${i + 1} failed: ${error.message}`]
                });
            }
        }

        return results;
    }

    /**
     * Supprime un lot de fichiers
     * @param {Array} fileKeys - Clés des fichiers à supprimer
     * @returns {Promise<Object>} Résultat de la suppression
     */
    async deleteBatch(fileKeys) {
        if (fileKeys.length === 0) {
            return { deleted: 0, errors: [] };
        }

        // Pour les petits lots, utiliser deleteObjects (plus efficace)
        if (fileKeys.length > 1) {
            return await this.deleteBatchOptimized(fileKeys);
        } else {
            // Pour un seul fichier, utiliser deleteObject
            return await this.deleteSingleFile(fileKeys[0]);
        }
    }

    /**
     * Suppression optimisée par lot (AWS DeleteObjects)
     * @param {Array} fileKeys - Clés des fichiers
     * @returns {Promise<Object>} Résultat
     */
    async deleteBatchOptimized(fileKeys) {
        const deleteParams = {
            Bucket: this.bucket,
            Delete: {
                Objects: fileKeys.map(key => ({ Key: key })),
                Quiet: true // Retourne seulement les erreurs
            }
        };

        try {
            const command = new DeleteObjectsCommand(deleteParams);
            const response = await this.client.send(command);

            const errors = response.Errors || [];
            const deleted = fileKeys.length - errors.length;

            if (errors.length > 0) {
                console.warn(`[Cleanup] ${errors.length} deletion errors in batch:`, errors);
            }

            return {
                deleted,
                errors: errors.map(err => `${err.Key}: ${err.Message}`)
            };

        } catch (error) {
            console.error('[Cleanup] Batch deletion failed:', error);
            return {
                deleted: 0,
                errors: [`Batch deletion failed: ${error.message}`]
            };
        }
    }

    /**
     * Supprime un fichier unique
     * @param {string} fileKey - Clé du fichier
     * @returns {Promise<Object>} Résultat
     */
    async deleteSingleFile(fileKey) {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: fileKey
            });

            await this.client.send(command);
            return { deleted: 1, errors: [] };

        } catch (error) {
            console.error(`[Cleanup] Error deleting file ${fileKey}:`, error);
            return {
                deleted: 0,
                errors: [`${fileKey}: ${error.message}`]
            };
        }
    }

    /**
     * Nettoie les fichiers temporaires d'un utilisateur
     * @param {string} userId - ID de l'utilisateur
     * @returns {Promise<Object>} Résultat du nettoyage
     */
    async cleanupUserTempFiles(userId) {
        if (!this.isConfigured()) {
            return { success: false, message: 'R2 not configured' };
        }

        const tempPrefix = `users/${userId}/temp/`;
        
        try {
            const tempFiles = await this.listAllUserFiles(tempPrefix);
            
            if (tempFiles.length === 0) {
                return { success: true, message: 'No temp files to delete', filesDeleted: 0 };
            }

            const deleteResults = await this.deleteFilesInBatches(tempFiles);
            const totalDeleted = deleteResults.reduce((sum, result) => sum + result.deleted, 0);

            return {
                success: true,
                message: `Deleted ${totalDeleted} temp files`,
                filesDeleted: totalDeleted
            };

        } catch (error) {
            console.error(`[Cleanup] Error cleaning temp files for ${userId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Obtient des statistiques sur les fichiers d'un utilisateur
     * @param {string} userId - ID de l'utilisateur
     * @returns {Promise<Object>} Statistiques
     */
    async getUserStorageStats(userId) {
        if (!this.isConfigured()) {
            return { success: false, message: 'R2 not configured' };
        }

        const userPrefix = `users/${userId}/`;
        
        try {
            let totalFiles = 0;
            let totalSize = 0;
            const fileTypeStats = {};
            let continuationToken = null;

            do {
                const listCommand = new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: userPrefix,
                    ContinuationToken: continuationToken,
                    MaxKeys: 1000
                });

                const response = await this.client.send(listCommand);
                
                if (response.Contents) {
                    for (const obj of response.Contents) {
                        totalFiles++;
                        totalSize += obj.Size || 0;

                        // Analyser le type de fichier par le chemin
                        const pathParts = obj.Key.split('/');
                        const fileType = pathParts[3] || 'unknown'; // users/{id}/events/{id}/{type}/ ou users/{id}/{type}/
                        
                        if (!fileTypeStats[fileType]) {
                            fileTypeStats[fileType] = { count: 0, size: 0 };
                        }
                        fileTypeStats[fileType].count++;
                        fileTypeStats[fileType].size += obj.Size || 0;
                    }
                }

                continuationToken = response.NextContinuationToken;

            } while (continuationToken);

            return {
                success: true,
                userId,
                stats: {
                    totalFiles,
                    totalSize,
                    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
                    fileTypeStats
                }
            };

        } catch (error) {
            console.error(`[Cleanup] Error getting storage stats for ${userId}:`, error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = new UserDirectoryCleanupService();