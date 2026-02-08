#!/usr/bin/env node

/**
 * Script de déploiement sécurisé pour l'optimisation de la base de données
 * 
 * Ce script:
 * 1. Vérifie l'état actuel de la DB
 * 2. Applique les migrations manquantes
 * 3. Exécute l'optimisation sécurisée
 * 4. Valide les résultats
 * 5. Génère un rapport
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class DatabaseOptimizer {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.SUPABASE_CONNECTION_STRING || process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        
        this.log = {
            info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
            warn: (msg) => console.log(`[WARN] ${new Date().toISOString()} - ${msg}`),
            error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} - ${msg}`),
            success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`)
        };
    }

    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW()');
            this.log.success('Connexion à la base de données établie');
            return true;
        } catch (error) {
            this.log.error(`Impossible de se connecter à la DB: ${error.message}`);
            return false;
        }
    }

    async checkTableExists(tableName) {
        try {
            const result = await this.pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                )
            `, [tableName]);
            return result.rows[0].exists;
        } catch (error) {
            this.log.warn(`Erreur lors de la vérification de la table ${tableName}: ${error.message}`);
            return false;
        }
    }

    async getExistingTables() {
        try {
            const result = await this.pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                ORDER BY table_name
            `);
            return result.rows.map(row => row.table_name);
        } catch (error) {
            this.log.error(`Impossible de récupérer la liste des tables: ${error.message}`);
            return [];
        }
    }

    async executeMigrationFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.trim()) {
                await this.pool.query(content);
                return true;
            }
            return false;
        } catch (error) {
            this.log.error(`Erreur lors de l'exécution de ${path.basename(filePath)}: ${error.message}`);
            throw error;
        }
    }

    async applyBaseMigrations() {
        const requiredTables = ['users', 'events', 'guests', 'qr_codes', 'attendance'];
        const existingTables = await this.getExistingTables();
        
        const missingTables = requiredTables.filter(table => !existingTables.includes(table));
        
        if (missingTables.length === 0) {
            this.log.info('Toutes les tables de base existent déjà');
            return true;
        }

        this.log.info(`Tables manquantes détectées: ${missingTables.join(', ')}`);
        
        try {
            // Appliquer la migration de base
            const baseMigration = path.join(__dirname, '..', 'migrations', '001_create_tables.sql');
            if (fs.existsSync(baseMigration)) {
                this.log.info('Application de la migration de base...');
                await this.executeMigrationFile(baseMigration);
                this.log.success('Migration de base appliquée');
            }
            
            // Vérifier le résultat
            const newTables = await this.getExistingTables();
            const stillMissing = requiredTables.filter(table => !newTables.includes(table));
            
            if (stillMissing.length === 0) {
                this.log.success('Toutes les tables de base sont maintenant présentes');
                return true;
            } else {
                this.log.warn(`Tables encore manquantes: ${stillMissing.join(', ')}`);
                return false;
            }
        } catch (error) {
            this.log.error(`Erreur lors de l'application des migrations de base: ${error.message}`);
            return false;
        }
    }

    async applyOptimization() {
        try {
            const optimizationFile = path.join(__dirname, '..', 'migrations', '100_SAFE_database_optimization.sql');
            
            if (!fs.existsSync(optimizationFile)) {
                this.log.error('Fichier d\'optimisation non trouvé');
                return false;
            }

            this.log.info('Application de l\'optimisation sécurisée...');
            await this.executeMigrationFile(optimizationFile);
            this.log.success('Optimisation appliquée avec succès');
            return true;
            
        } catch (error) {
            this.log.error(`Erreur lors de l'optimisation: ${error.message}`);
            return false;
        }
    }

    async generateReport() {
        try {
            const tables = await this.getExistingTables();
            
            // Compter les index
            const indexResult = await this.pool.query(`
                SELECT COUNT(*) as count 
                FROM pg_indexes 
                WHERE schemaname = 'public'
            `);
            
            // Vérifier les vues matérialisées
            const matviewResult = await this.pool.query(`
                SELECT COUNT(*) as count 
                FROM pg_matviews 
                WHERE schemaname = 'public'
            `);

            // Vérifier les contraintes
            const constraintResult = await this.pool.query(`
                SELECT COUNT(*) as count 
                FROM information_schema.table_constraints 
                WHERE constraint_schema = 'public'
            `);

            const report = {
                timestamp: new Date().toISOString(),
                tables: {
                    count: tables.length,
                    list: tables
                },
                indexes: indexResult.rows[0].count,
                materialized_views: matviewResult.rows[0].count,
                constraints: constraintResult.rows[0].count,
                optimized: true
            };

            // Sauvegarder le rapport
            const reportPath = path.join(__dirname, '..', 'reports', `optimization_report_${Date.now()}.json`);
            const reportDir = path.dirname(reportPath);
            
            if (!fs.existsSync(reportDir)) {
                fs.mkdirSync(reportDir, { recursive: true });
            }
            
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
            
            this.log.success('=== RAPPORT D\'OPTIMISATION ===');
            this.log.info(`Tables: ${report.tables.count}`);
            this.log.info(`Index: ${report.indexes}`);
            this.log.info(`Vues matérialisées: ${report.materialized_views}`);
            this.log.info(`Contraintes: ${report.constraints}`);
            this.log.success(`Rapport sauvegardé: ${reportPath}`);
            
            return report;
            
        } catch (error) {
            this.log.error(`Erreur lors de la génération du rapport: ${error.message}`);
            return null;
        }
    }

    async cleanup() {
        await this.pool.end();
    }

    async run() {
        this.log.info('=== DÉMARRAGE DE L\'OPTIMISATION SÉCURISÉE ===');
        
        try {
            // 1. Test de connexion
            if (!(await this.testConnection())) {
                throw new Error('Impossible d\'établir la connexion à la base de données');
            }

            // 2. Application des migrations de base si nécessaire
            if (!(await this.applyBaseMigrations())) {
                throw new Error('Échec de l\'application des migrations de base');
            }

            // 3. Application de l'optimisation
            if (!(await this.applyOptimization())) {
                throw new Error('Échec de l\'optimisation');
            }

            // 4. Génération du rapport
            const report = await this.generateReport();
            
            if (report) {
                this.log.success('=== OPTIMISATION TERMINÉE AVEC SUCCÈS ===');
                return true;
            } else {
                this.log.warn('Optimisation terminée mais rapport incomplet');
                return false;
            }
            
        } catch (error) {
            this.log.error(`Échec de l'optimisation: ${error.message}`);
            return false;
        } finally {
            await this.cleanup();
        }
    }
}

// Exécution si appelé directement
if (require.main === module) {
    const optimizer = new DatabaseOptimizer();
    optimizer.run().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = DatabaseOptimizer;