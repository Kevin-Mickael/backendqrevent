-- ============================================
-- SCRIPT DE NETTOYAGE EN CASCADE - SUPABASE AUTH MIGRATION
-- ============================================
-- Ce script supprime toutes les données liées aux utilisateurs
-- pour permettre un fresh start avec le nouveau système Supabase Auth
-- ATTENTION: Ceci supprime TOUTES les données utilisateur mais garde les tables

-- ============================================
-- ORDRE DE SUPPRESSION (CASCADE)
-- ============================================
-- L'ordre est important pour respecter les contraintes de clés étrangères

BEGIN;

-- 1. Tables liées aux événements (contenu user-generated)
DELETE FROM game_participations WHERE game_id IN (
    SELECT id FROM games WHERE event_id IN (
        SELECT id FROM events WHERE user_id IN (
            SELECT id FROM users
        )
    )
);

DELETE FROM game_leaderboard WHERE game_id IN (
    SELECT id FROM games WHERE event_id IN (
        SELECT id FROM events WHERE user_id IN (
            SELECT id FROM users
        )
    )
);

DELETE FROM games WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

-- 2. Suppression des données d'événements
DELETE FROM wishes WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

DELETE FROM feedback WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

DELETE FROM attendance WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

DELETE FROM story_events WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

-- 3. Suppression des QR codes et invitations
DELETE FROM qr_codes WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

-- 4. Suppression des familles et invités
DELETE FROM family_rsvp WHERE family_id IN (
    SELECT id FROM families WHERE event_id IN (
        SELECT id FROM events WHERE user_id IN (
            SELECT id FROM users
        )
    )
);

DELETE FROM family_invitations WHERE family_id IN (
    SELECT id FROM families WHERE event_id IN (
        SELECT id FROM events WHERE user_id IN (
            SELECT id FROM users
        )
    )
);

DELETE FROM guests WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

DELETE FROM families WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

-- 5. Suppression des tables de sièges
DELETE FROM seating_tables WHERE event_id IN (
    SELECT id FROM events WHERE user_id IN (
        SELECT id FROM users
    )
);

-- 6. Suppression des événements
DELETE FROM events WHERE user_id IN (
    SELECT id FROM users
);

-- 7. Suppression finale des utilisateurs dans public.users
DELETE FROM users;

-- 8. Nettoyage de auth.users (Supabase Auth)
-- NOTE: Ceci doit être fait via l'interface Supabase ou avec les permissions admin
-- DELETE FROM auth.users;

COMMIT;

-- ============================================
-- VÉRIFICATION POST-NETTOYAGE
-- ============================================

-- Vérifier que les tables sont vides
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'events' as table_name, COUNT(*) as count FROM events
UNION ALL
SELECT 'guests' as table_name, COUNT(*) as count FROM guests
UNION ALL
SELECT 'families' as table_name, COUNT(*) as count FROM families
UNION ALL
SELECT 'games' as table_name, COUNT(*) as count FROM games
UNION ALL
SELECT 'game_participations' as table_name, COUNT(*) as count FROM game_participations
UNION ALL
SELECT 'qr_codes' as table_name, COUNT(*) as count FROM qr_codes
UNION ALL
SELECT 'attendance' as table_name, COUNT(*) as count FROM attendance
UNION ALL
SELECT 'wishes' as table_name, COUNT(*) as count FROM wishes
UNION ALL
SELECT 'feedback' as table_name, COUNT(*) as count FROM feedback
UNION ALL
SELECT 'story_events' as table_name, COUNT(*) as count FROM story_events
UNION ALL
SELECT 'seating_tables' as table_name, COUNT(*) as count FROM seating_tables
ORDER BY table_name;

-- Afficher les structures de tables (pour vérifier qu'elles existent toujours)
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
    AND table_name IN ('users', 'events', 'guests', 'families', 'games')
ORDER BY table_name, ordinal_position;