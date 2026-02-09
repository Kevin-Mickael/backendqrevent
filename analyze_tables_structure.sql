-- ============================================
-- ANALYSE DES TABLES ET RELATIONS - AVANT NETTOYAGE
-- ============================================

-- 1. Lister toutes les tables avec leur nombre de lignes
SELECT 
    schemaname,
    tablename,
    n_tup_ins as total_inserts,
    n_tup_upd as total_updates,
    n_tup_del as total_deletes,
    n_live_tup as current_rows
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY current_rows DESC;

-- 2. Analyser les contraintes de clés étrangères
SELECT 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_schema='public'
    AND (ccu.table_name = 'users' OR tc.table_name LIKE '%user%')
ORDER BY tc.table_name, kcu.column_name;

-- 3. Compter les données par table importante
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'events', COUNT(*) FROM events
UNION ALL
SELECT 'guests', COUNT(*) FROM guests
UNION ALL
SELECT 'families', COUNT(*) FROM families
UNION ALL
SELECT 'games', COUNT(*) FROM games
UNION ALL
SELECT 'game_participations', COUNT(*) FROM game_participations
UNION ALL
SELECT 'qr_codes', COUNT(*) FROM qr_codes
UNION ALL
SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL
SELECT 'wishes', COUNT(*) FROM wishes
UNION ALL
SELECT 'feedback', COUNT(*) FROM feedback
UNION ALL
SELECT 'story_events', COUNT(*) FROM story_events
UNION ALL
SELECT 'seating_tables', COUNT(*) FROM seating_tables
UNION ALL
SELECT 'family_rsvp', COUNT(*) FROM family_rsvp
UNION ALL
SELECT 'family_invitations', COUNT(*) FROM family_invitations
ORDER BY count DESC;

-- 4. Analyser les relations users -> events -> autres tables
SELECT 
    'Total users' as description,
    COUNT(*) as count
FROM users
UNION ALL
SELECT 
    'Events by users',
    COUNT(*)
FROM events e
INNER JOIN users u ON e.user_id = u.id
UNION ALL
SELECT 
    'Games in user events',
    COUNT(*)
FROM games g
INNER JOIN events e ON g.event_id = e.id
INNER JOIN users u ON e.user_id = u.id
UNION ALL
SELECT 
    'Guests in user events',
    COUNT(*)
FROM guests guest
INNER JOIN events e ON guest.event_id = e.id
INNER JOIN users u ON e.user_id = u.id;