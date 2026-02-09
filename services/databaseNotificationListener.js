/**
 * Service d'écoute des notifications PostgreSQL pour le nettoyage automatique R2
 * Utilise LISTEN/NOTIFY pour déclencher les nettoyages de façon asynchrone
 */

const { Client } = require('pg');
const config = require('../config/config');
const userCleanupOrchestrator = require('./userCleanupOrchestrator');

class DatabaseNotificationListener {
    constructor() {
        this.client = null;
        this.isListening = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000; // 5 secondes
    }

    /**
     * Démarre l'écoute des notifications de base de données
     * @returns {Promise<void>}
     */
    async startListening() {
        if (this.isListening) {
            console.log('[DB Notifications] Already listening');
            return;
        }

        try {
            console.log('[DB Notifications] Starting database notification listener...');
            
            // Créer une connexion dédiée pour les notifications
            this.client = new Client({
                host: config.database.host,
                port: config.database.port,
                database: config.database.name,
                user: config.database.user,
                password: config.database.password,
                ssl: config.database.ssl
            });

            // Gérer les erreurs de connexion
            this.client.on('error', (err) => {
                console.error('[DB Notifications] Connection error:', err);
                this.handleConnectionError();
            });

            this.client.on('end', () => {
                console.warn('[DB Notifications] Connection ended');
                this.isListening = false;
                this.handleConnectionError();
            });

            // Connexion
            await this.client.connect();
            console.log('[DB Notifications] Connected to database for notifications');

            // Écouter les notifications de nettoyage R2
            await this.client.query('LISTEN user_deletion_r2_cleanup');
            console.log('[DB Notifications] Now listening for user_deletion_r2_cleanup notifications');

            // Gérer les notifications reçues
            this.client.on('notification', (msg) => {
                this.handleNotification(msg);
            });

            this.isListening = true;
            this.reconnectAttempts = 0;

            console.log('[DB Notifications] Database notification listener started successfully');

        } catch (error) {
            console.error('[DB Notifications] Failed to start listener:', error);
            this.handleConnectionError();
        }
    }

    /**
     * Traite une notification reçue
     * @param {Object} msg - Message de notification
     */
    async handleNotification(msg) {
        try {
            console.log(`[DB Notifications] Received ${msg.channel} notification:`, msg.payload);

            if (msg.channel === 'user_deletion_r2_cleanup') {
                await this.handleUserDeletionNotification(msg.payload);
            }

        } catch (error) {
            console.error('[DB Notifications] Error handling notification:', error);
        }
    }

    /**
     * Traite une notification de suppression d'utilisateur
     * @param {string} payload - Payload JSON de la notification
     */
    async handleUserDeletionNotification(payload) {
        try {
            const data = JSON.parse(payload);
            const { userId, trigger, timestamp } = data;

            if (!userId) {
                console.error('[DB Notifications] No userId in deletion notification');
                return;
            }

            console.log(`[DB Notifications] Processing R2 cleanup for user ${userId} (triggered by ${trigger})`);

            // Déclencher le nettoyage orchestré
            const result = await userCleanupOrchestrator.orchestrateUserDeletion(
                userId,
                `Automatic cleanup from database trigger (${trigger})`,
                {
                    triggerSource: 'database_notification',
                    originalTrigger: trigger,
                    notificationTimestamp: timestamp,
                    processedAt: Date.now()
                }
            );

            if (result.success) {
                console.log(`[DB Notifications] R2 cleanup completed for user ${userId}: ${result.summary.filesDeleted} files deleted`);
            } else {
                console.error(`[DB Notifications] R2 cleanup failed for user ${userId}:`, result.summary.message);
            }

            // Optionnel: Mettre à jour la table de logs si disponible
            await this.updateCleanupLog(userId, result);

        } catch (error) {
            console.error('[DB Notifications] Error processing user deletion notification:', error);
        }
    }

    /**
     * Met à jour la table de logs de nettoyage (si disponible)
     * @param {string} userId - ID de l'utilisateur
     * @param {Object} result - Résultat du nettoyage
     */
    async updateCleanupLog(userId, result) {
        try {
            // Cette fonction nécessiterait une connexion DB séparée
            // Pour éviter les conflits avec la connexion de notifications
            const { Pool } = require('pg');
            const pool = new Pool({
                host: config.database.host,
                port: config.database.port,
                database: config.database.name,
                user: config.database.user,
                password: config.database.password,
                ssl: config.database.ssl,
                max: 1 // Une seule connexion pour les logs
            });

            const logResult = await pool.query(`
                SELECT public.log_r2_cleanup($1, $2, $3, $4, $5, $6) as log_id
            `, [
                userId,
                'database_notification',
                result.success ? 'completed' : 'failed',
                result.summary?.filesDeleted || 0,
                result.success ? null : result.summary?.message,
                JSON.stringify(result)
            ]);

            console.log(`[DB Notifications] Cleanup log created with ID: ${logResult.rows[0].log_id}`);
            
            await pool.end();

        } catch (error) {
            console.warn('[DB Notifications] Failed to update cleanup log:', error.message);
            // Ne pas faire échouer le processus principal
        }
    }

    /**
     * Gère les erreurs de connexion et tente une reconnexion
     */
    async handleConnectionError() {
        if (!this.isListening) {
            return; // Déjà en cours de reconnexion ou arrêté
        }

        this.isListening = false;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[DB Notifications] Max reconnection attempts reached. Stopping listener.');
            return;
        }

        this.reconnectAttempts++;
        console.log(`[DB Notifications] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms...`);

        setTimeout(async () => {
            try {
                await this.stopListening();
                await this.startListening();
            } catch (error) {
                console.error('[DB Notifications] Reconnection failed:', error);
                this.handleConnectionError();
            }
        }, this.reconnectDelay);
    }

    /**
     * Arrête l'écoute des notifications
     * @returns {Promise<void>}
     */
    async stopListening() {
        if (!this.isListening || !this.client) {
            return;
        }

        try {
            console.log('[DB Notifications] Stopping database notification listener...');
            
            await this.client.query('UNLISTEN user_deletion_r2_cleanup');
            await this.client.end();
            
            this.isListening = false;
            this.client = null;
            
            console.log('[DB Notifications] Database notification listener stopped');

        } catch (error) {
            console.error('[DB Notifications] Error stopping listener:', error);
        }
    }

    /**
     * Teste la fonctionnalité de notification
     * @param {string} testUserId - ID de test
     * @returns {Promise<void>}
     */
    async testNotification(testUserId = 'test-user-id') {
        if (!this.isListening) {
            throw new Error('Listener not started');
        }

        try {
            const payload = JSON.stringify({
                userId: testUserId,
                trigger: 'test',
                timestamp: Date.now()
            });

            // Envoyer une notification de test
            await this.client.query('SELECT pg_notify($1, $2)', ['user_deletion_r2_cleanup', payload]);
            console.log('[DB Notifications] Test notification sent');

        } catch (error) {
            console.error('[DB Notifications] Failed to send test notification:', error);
            throw error;
        }
    }

    /**
     * Vérifie l'état du listener
     * @returns {Object} État du listener
     */
    getStatus() {
        return {
            isListening: this.isListening,
            reconnectAttempts: this.reconnectAttempts,
            connected: this.client && !this.client._ending,
            pid: this.client?.processID || null
        };
    }
}

// Singleton instance
const notificationListener = new DatabaseNotificationListener();

// Démarrer automatiquement si configuré
if (config.database && process.env.ENABLE_DB_NOTIFICATIONS !== 'false') {
    // Démarrer après un court délai pour permettre à l'app de s'initialiser
    setTimeout(() => {
        notificationListener.startListening().catch((error) => {
            console.error('[DB Notifications] Failed to start on initialization:', error);
        });
    }, 2000);
}

// Arrêt propre
process.on('SIGTERM', async () => {
    console.log('[DB Notifications] Received SIGTERM, stopping listener...');
    await notificationListener.stopListening();
});

process.on('SIGINT', async () => {
    console.log('[DB Notifications] Received SIGINT, stopping listener...');
    await notificationListener.stopListening();
});

module.exports = notificationListener;