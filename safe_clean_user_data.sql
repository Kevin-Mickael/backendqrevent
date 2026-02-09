-- ============================================
-- SCRIPT DE NETTOYAGE SÉCURISÉ - SUPABASE AUTH MIGRATION
-- ============================================
-- Version sécurisée avec vérifications et rollback possible
-- Supprime toutes les données utilisateur mais garde les structures

-- ============================================
-- ÉTAPE 1: VÉRIFICATIONS PRÉALABLES
-- ============================================

DO $$
DECLARE
    user_count INTEGER;
    event_count INTEGER;
    total_data INTEGER;
BEGIN
    -- Compter les données existantes
    SELECT COUNT(*) INTO user_count FROM users;
    SELECT COUNT(*) INTO event_count FROM events;
    
    RAISE NOTICE 'AVANT NETTOYAGE:';
    RAISE NOTICE '- Utilisateurs: %', user_count;
    RAISE NOTICE '- Événements: %', event_count;
    
    -- Calculer le total approximatif de données
    SELECT (
        (SELECT COUNT(*) FROM users) +
        (SELECT COUNT(*) FROM events) +
        (SELECT COUNT(*) FROM guests) +
        (SELECT COUNT(*) FROM families) +
        (SELECT COUNT(*) FROM games) +
        (SELECT COUNT(*) FROM game_participations) +
        (SELECT COUNT(*) FROM qr_codes) +
        (SELECT COUNT(*) FROM attendance) +
        (SELECT COUNT(*) FROM wishes) +
        (SELECT COUNT(*) FROM feedback) +
        (SELECT COUNT(*) FROM story_events) +
        (SELECT COUNT(*) FROM seating_tables) +
        (SELECT COUNT(*) FROM family_rsvp) +
        (SELECT COUNT(*) FROM family_invitations)
    ) INTO total_data;
    
    RAISE NOTICE '- Total données à supprimer: %', total_data;
    
    IF total_data > 0 THEN
        RAISE NOTICE 'ATTENTION: % enregistrements vont être supprimés!', total_data;
    ELSE
        RAISE NOTICE 'Base de données déjà vide.';
    END IF;
END $$;

-- ============================================
-- ÉTAPE 2: NETTOYAGE EN CASCADE (TRANSACTION SÉCURISÉE)
-- ============================================

BEGIN;

-- Créer une table de sauvegarde temporaire pour les comptes
CREATE TEMP TABLE temp_cleanup_log (
    table_name VARCHAR(50),
    records_deleted INTEGER,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- 1. Suppression des participations aux jeux
WITH deleted AS (
    DELETE FROM game_participations 
    WHERE game_id IN (
        SELECT g.id FROM games g
        INNER JOIN events e ON g.event_id = e.id
        INNER JOIN users u ON e.user_id = u.id
    ) 
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('game_participations', (SELECT COUNT(*) FROM deleted), NOW());

-- 2. Suppression du leaderboard des jeux
WITH deleted AS (
    DELETE FROM game_leaderboard 
    WHERE game_id IN (
        SELECT g.id FROM games g
        INNER JOIN events e ON g.event_id = e.id
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('game_leaderboard', (SELECT COUNT(*) FROM deleted), NOW());

-- 3. Suppression des jeux
WITH deleted AS (
    DELETE FROM games 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('games', (SELECT COUNT(*) FROM deleted), NOW());

-- 4. Suppression des souhaits
WITH deleted AS (
    DELETE FROM wishes 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('wishes', (SELECT COUNT(*) FROM deleted), NOW());

-- 5. Suppression des feedbacks
WITH deleted AS (
    DELETE FROM feedback 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('feedback', (SELECT COUNT(*) FROM deleted), NOW());

-- 6. Suppression des présences
WITH deleted AS (
    DELETE FROM attendance 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('attendance', (SELECT COUNT(*) FROM deleted), NOW());

-- 7. Suppression des événements de l'histoire
WITH deleted AS (
    DELETE FROM story_events 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('story_events', (SELECT COUNT(*) FROM deleted), NOW());

-- 8. Suppression des codes QR
WITH deleted AS (
    DELETE FROM qr_codes 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('qr_codes', (SELECT COUNT(*) FROM deleted), NOW());

-- 9. Suppression des RSVP familles
WITH deleted AS (
    DELETE FROM family_rsvp 
    WHERE family_id IN (
        SELECT f.id FROM families f
        INNER JOIN events e ON f.event_id = e.id
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('family_rsvp', (SELECT COUNT(*) FROM deleted), NOW());

-- 10. Suppression des invitations familles
WITH deleted AS (
    DELETE FROM family_invitations 
    WHERE family_id IN (
        SELECT f.id FROM families f
        INNER JOIN events e ON f.event_id = e.id
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('family_invitations', (SELECT COUNT(*) FROM deleted), NOW());

-- 11. Suppression des invités
WITH deleted AS (
    DELETE FROM guests 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('guests', (SELECT COUNT(*) FROM deleted), NOW());

-- 12. Suppression des familles
WITH deleted AS (
    DELETE FROM families 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('families', (SELECT COUNT(*) FROM deleted), NOW());

-- 13. Suppression des tables de sièges
WITH deleted AS (
    DELETE FROM seating_tables 
    WHERE event_id IN (
        SELECT e.id FROM events e
        INNER JOIN users u ON e.user_id = u.id
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('seating_tables', (SELECT COUNT(*) FROM deleted), NOW());

-- 14. Suppression des événements
WITH deleted AS (
    DELETE FROM events 
    WHERE user_id IN (
        SELECT id FROM users
    )
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('events', (SELECT COUNT(*) FROM deleted), NOW());

-- 15. Suppression finale des utilisateurs (public.users)
WITH deleted AS (
    DELETE FROM users 
    RETURNING *
)
INSERT INTO temp_cleanup_log VALUES ('users', (SELECT COUNT(*) FROM deleted), NOW());

-- Afficher le rapport de nettoyage
SELECT 
    table_name,
    records_deleted,
    timestamp
FROM temp_cleanup_log 
ORDER BY timestamp;

-- Calculer le total supprimé
SELECT 
    'TOTAL SUPPRIMÉ' as summary,
    SUM(records_deleted) as total_records
FROM temp_cleanup_log;

COMMIT;

-- ============================================
-- ÉTAPE 3: VÉRIFICATION POST-NETTOYAGE
-- ============================================

DO $$
DECLARE
    remaining_data INTEGER;
BEGIN
    -- Vérifier qu'il ne reste plus de données
    SELECT (
        (SELECT COUNT(*) FROM users) +
        (SELECT COUNT(*) FROM events) +
        (SELECT COUNT(*) FROM guests) +
        (SELECT COUNT(*) FROM families) +
        (SELECT COUNT(*) FROM games) +
        (SELECT COUNT(*) FROM game_participations) +
        (SELECT COUNT(*) FROM qr_codes) +
        (SELECT COUNT(*) FROM attendance) +
        (SELECT COUNT(*) FROM wishes) +
        (SELECT COUNT(*) FROM feedback) +
        (SELECT COUNT(*) FROM story_events) +
        (SELECT COUNT(*) FROM seating_tables) +
        (SELECT COUNT(*) FROM family_rsvp) +
        (SELECT COUNT(*) FROM family_invitations)
    ) INTO remaining_data;
    
    IF remaining_data = 0 THEN
        RAISE NOTICE '✅ NETTOYAGE RÉUSSI: Toutes les données utilisateur ont été supprimées';
        RAISE NOTICE '✅ Les structures de tables sont préservées';
        RAISE NOTICE '✅ Prêt pour le nouveau système Supabase Auth';
    ELSE
        RAISE WARNING '⚠️ ATTENTION: % enregistrements restants après nettoyage', remaining_data;
    END IF;
END $$;

-- Vérification finale détaillée
SELECT 
    'users' as table_name, 
    COUNT(*) as remaining_records,
    CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END as status
FROM users
UNION ALL
SELECT 'events', COUNT(*), CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END FROM events
UNION ALL
SELECT 'guests', COUNT(*), CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END FROM guests
UNION ALL
SELECT 'families', COUNT(*), CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END FROM families
UNION ALL
SELECT 'games', COUNT(*), CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END FROM games
UNION ALL
SELECT 'game_participations', COUNT(*), CASE WHEN COUNT(*) = 0 THEN '✅ Vide' ELSE '❌ Données restantes' END FROM game_participations
ORDER BY remaining_records DESC;