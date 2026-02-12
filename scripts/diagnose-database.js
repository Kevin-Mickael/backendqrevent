#!/usr/bin/env node
/**
 * 🔍 DATABASE DIAGNOSTIC SCRIPT
 * 
 * Ce script analyse l'état de la base de données SANS AUCUNE MODIFICATION
 * Il génère un rapport détaillé des problèmes potentiels
 * 
 * Usage: node scripts/diagnose-database.js
 */

const { supabaseService } = require('../config/supabase');

const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(level, message) {
    const color = COLORS[level] || COLORS.reset;
    console.log(`${color}${message}${COLORS.reset}`);
}

async function checkTableExists(tableName) {
    const { data, error } = await supabaseService
        .rpc('exec_sql', {
            query: `
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = '${tableName}'
                ) as exists
            `
        });
    
    if (error) {
        // Si exec_sql n'existe pas, utiliser une requête directe
        const { data: directData, error: directError } = await supabaseService
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_name', tableName)
            .single();
        return !directError && directData;
    }
    return data?.[0]?.exists || false;
}

async function getTableColumns(tableName) {
    const { data, error } = await supabaseService
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_name', tableName)
        .order('ordinal_position');
    
    if (error) {
        log('red', `❌ Erreur lors de la récupération des colonnes de ${tableName}: ${error.message}`);
        return [];
    }
    return data || [];
}

async function checkTriggerExists(triggerName, tableName) {
    const { data, error } = await supabaseService
        .from('pg_trigger')
        .select('tgname')
        .eq('tgname', triggerName)
        .single();
    
    return !error && data;
}

async function checkPolicyExists(tableName, policyName) {
    const { data, error } = await supabaseService
        .from('pg_policies')
        .select('policyname')
        .eq('tablename', tableName)
        .eq('policyname', policyName)
        .single();
    
    return !error && data;
}

async function getRLSPolicies(tableName) {
    const { data, error } = await supabaseService
        .from('pg_policies')
        .select('policyname, permissive, roles, cmd, qual')
        .eq('tablename', tableName);
    
    return data || [];
}

async function countRecords(tableName) {
    const { data, error } = await supabaseService
        .from(tableName)
        .select('*', { count: 'exact', head: true });
    
    return error ? -1 : data?.length || 0;
}

async function diagnose() {
    log('cyan', '\n╔════════════════════════════════════════════════════════════╗');
    log('cyan', '║      🔍 DIAGNOSTIC BASE DE DONNÉES - QREVENT              ║');
    log('cyan', '║         Aucune modification ne sera effectuée             ║');
    log('cyan', '╚════════════════════════════════════════════════════════════╝\n');

    const issues = [];
    const warnings = [];
    const ok = [];

    // 1. Vérifier les tables principales
    log('blue', '\n📋 Vérification des tables principales...\n');
    
    const mainTables = ['users', 'events', 'guests', 'families', 'qr_codes'];
    for (const table of mainTables) {
        const exists = await checkTableExists(table);
        if (exists) {
            const count = await countRecords(table);
            log('green', `  ✅ ${table}: existe (${count} enregistrements)`);
            ok.push(`${table} existe`);
        } else {
            log('red', `  ❌ ${table}: MANQUANTE`);
            issues.push(`Table ${table} manquante`);
        }
    }

    // 2. Vérifier les colonnes de la table events
    log('blue', '\n📋 Vérification du schéma "events"...\n');
    
    const requiredColumns = [
        { name: 'id', type: 'uuid' },
        { name: 'title', type: 'character varying' },
        { name: 'description', type: 'text', nullable: true },
        { name: 'date', type: 'timestamp with time zone' },
        { name: 'organizer_id', type: 'uuid' },
        { name: 'is_active', type: 'boolean' },
        { name: 'settings', type: 'jsonb' },
        { name: 'partner1_name', type: 'character varying', critical: false },
        { name: 'partner2_name', type: 'character varying', critical: false },
        { name: 'event_schedule', type: 'jsonb', critical: false },
        { name: 'venue_type', type: 'character varying', critical: false },
        { name: 'ceremony_venue', type: 'jsonb', critical: false },
        { name: 'ceremony_date', type: 'date', critical: false },
        { name: 'ceremony_time', type: 'time without time zone', critical: false }
    ];

    const eventColumns = await getTableColumns('events');
    const existingColumns = new Set(eventColumns.map(c => c.column_name));

    for (const col of requiredColumns) {
        const exists = existingColumns.has(col.name);
        const isNullable = col.nullable || false;
        const isCritical = col.critical !== false;

        if (exists) {
            const dbCol = eventColumns.find(c => c.column_name === col.name);
            if (col.name === 'description' && dbCol.is_nullable === 'NO') {
                log('yellow', `  ⚠️  ${col.name}: existe mais NOT NULL (devrait être nullable)`);
                warnings.push(`Colonne ${col.name} devrait être nullable`);
            } else {
                log('green', `  ✅ ${col.name}`);
                ok.push(`events.${col.name} existe`);
            }
        } else {
            if (isCritical) {
                log('red', `  ❌ ${col.name}: MANQUANTE (CRITIQUE)`);
                issues.push(`Colonne critique ${col.name} manquante dans events`);
            } else {
                log('yellow', `  ⚠️  ${col.name}: manquante (optionnelle)`);
                warnings.push(`Colonne ${col.name} manquante dans events`);
            }
        }
    }

    // 3. Vérifier les triggers problématiques
    log('blue', '\n📋 Vérification des triggers...\n');
    
    const problematicTriggers = [
        { name: 'validate_event_venues_trigger', table: 'events', severity: 'high' },
        { name: 'validate_event_venues_soft_trigger', table: 'events', severity: 'low' }
    ];

    for (const trigger of problematicTriggers) {
        const exists = await checkTriggerExists(trigger.name);
        if (exists) {
            if (trigger.severity === 'high') {
                log('red', `  ❌ ${trigger.name}: ACTIF (peut causer des problèmes)`);
                issues.push(`Trigger problématique ${trigger.name} actif`);
            } else {
                log('green', `  ✅ ${trigger.name}: actif (OK)`);
                ok.push(`Trigger ${trigger.name} actif`);
            }
        } else {
            if (trigger.severity === 'high') {
                log('green', `  ✅ ${trigger.name}: inactif (OK)`);
                ok.push(`Trigger problématique ${trigger.name} inactif`);
            } else {
                log('yellow', `  ⚠️  ${trigger.name}: inactif`);
                warnings.push(`Trigger ${trigger.name} inactif`);
            }
        }
    }

    // 4. Vérifier les politiques RLS
    log('blue', '\n📋 Vérification des politiques RLS sur events...\n');
    
    const policies = await getRLSPolicies('events');
    if (policies.length === 0) {
        log('yellow', `  ⚠️  Aucune politique RLS trouvée`);
        warnings.push('Aucune politique RLS sur events');
    } else {
        log('green', `  ✅ ${policies.length} politique(s) trouvée(s):`);
        for (const policy of policies) {
            console.log(`     - ${policy.policyname} (${policy.cmd})`);
        }
        ok.push(`${policies.length} politiques RLS sur events`);
    }

    // 5. Vérifier la liaison auth.users <-> public.users
    log('blue', '\n📋 Vérification de la liaison Auth <-> Public...\n');
    
    const authUsersColumn = eventColumns.find(c => c.column_name === 'auth_id');
    if (existingColumns.has('auth_id')) {
        log('green', `  ✅ Colonne users.auth_id existe`);
        ok.push('Liaison auth_id configurée');
    } else {
        log('yellow', `  ⚠️  Colonne users.auth_id manquante`);
        warnings.push('Liaison auth_id non configurée');
    }

    // 6. Vérifier les fonctions critiques
    log('blue', '\n📋 Vérification des fonctions RPC...\n');
    
    const criticalFunctions = [
        'create_event_robust',
        'handle_new_user',
        'sync_auth_user_to_public'
    ];

    for (const func of criticalFunctions) {
        const { data, error } = await supabaseService
            .from('pg_proc')
            .select('proname')
            .eq('proname', func)
            .single();
        
        if (!error && data) {
            log('green', `  ✅ ${func}()`);
            ok.push(`Fonction ${func}() existe`);
        } else {
            log('yellow', `  ⚠️  ${func}(): manquante`);
            warnings.push(`Fonction ${func}() manquante`);
        }
    }

    // 7. Test de création d'événement (simulation)
    log('blue', '\n📋 Test de simulation de création d\'événement...\n');
    
    try {
        // Tester si la fonction create_event_robust existe
        const { data: funcExists, error: funcError } = await supabaseService
            .rpc('create_event_robust', {
                p_event_data: {
                    title: 'TEST_DIAGNOSTIC',
                    date: '2099-12-31T14:00:00Z',
                    organizer_id: '00000000-0000-0000-0000-000000000000'
                }
            });
        
        if (funcError) {
            if (funcError.message.includes('function') && funcError.message.includes('does not exist')) {
                log('yellow', `  ⚠️  Fonction create_event_robust non disponible`);
                warnings.push('Fonction create_event_robust non installée');
            } else if (funcError.message.includes('Organizer not found')) {
                log('green', `  ✅ La fonction create_event_robust existe et fonctionne`);
                ok.push('Fonction create_event_robust opérationnelle');
            } else {
                log('yellow', `  ⚠️  Erreur lors du test: ${funcError.message}`);
                warnings.push(`Test create_event_robust: ${funcError.message}`);
            }
        }
    } catch (error) {
        log('yellow', `  ⚠️  Impossible de tester create_event_robust`);
    }

    // RAPPORT FINAL
    log('cyan', '\n╔════════════════════════════════════════════════════════════╗');
    log('cyan', '║                      RAPPORT FINAL                         ║');
    log('cyan', '╚════════════════════════════════════════════════════════════╝\n');

    if (issues.length === 0 && warnings.length === 0) {
        log('green', '🎉 EXCELLENT! Aucun problème détecté.');
        log('green', `   ${ok.length} vérifications OK`);
    } else {
        if (issues.length > 0) {
            log('red', `\n❌ PROBLÈMES CRITIQUES (${issues.length}):`);
            issues.forEach(issue => log('red', `   • ${issue}`));
        }
        
        if (warnings.length > 0) {
            log('yellow', `\n⚠️  AVERTISSEMENTS (${warnings.length}):`);
            warnings.forEach(warning => log('yellow', `   • ${warning}`));
        }
        
        log('green', `\n✅ Points validés: ${ok.length}`);
    }

    // Recommandations
    log('blue', '\n📋 RECOMMANDATIONS:\n');
    
    if (issues.some(i => i.includes('venue_type') || i.includes('ceremony'))) {
        log('yellow', '• Exécutez la migration 051_robust_event_creation_fix.sql');
    }
    
    if (issues.some(i => i.includes('Trigger'))) {
        log('yellow', '• Le trigger validate_event_venues_trigger doit être supprimé');
    }
    
    if (warnings.some(w => w.includes('create_event_robust'))) {
        log('yellow', '• Installez la fonction create_event_robust pour une création sécurisée');
    }
    
    if (issues.length === 0 && warnings.length === 0) {
        log('green', '• Aucune action requise. La base de données est en bon état.');
    }

    console.log('\n');
    
    // Retourner le code de sortie
    process.exit(issues.length > 0 ? 1 : 0);
}

// Exécuter le diagnostic
diagnose().catch(error => {
    log('red', `\n❌ Erreur fatale: ${error.message}`);
    console.error(error);
    process.exit(1);
});
