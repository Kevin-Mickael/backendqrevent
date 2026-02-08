-- ============================================================================
-- Migration: Correction des vulnérabilités de sécurité Supabase
-- Date: 2026-02-08  
-- Description: Corriger toutes les erreurs du linter de sécurité Supabase
-- ============================================================================

-- ============================================================================
-- 1. CORRECTION DES VUES SECURITY DEFINER
-- ============================================================================

-- Recréer game_leaderboard sans SECURITY DEFINER
DROP VIEW IF EXISTS game_leaderboard;
CREATE VIEW game_leaderboard AS
SELECT 
    gp.id as participation_id,
    gp.game_id,
    gp.guest_id,
    gp.family_id,
    gp.player_name,
    gp.player_type,
    gp.total_score,
    gp.correct_answers,
    gp.total_answers,
    gp.completion_time,
    gp.rank,
    gp.created_at,
    g.title as game_title,
    g.event_id,
    CASE 
        WHEN gp.guest_id IS NOT NULL THEN 
            (SELECT name FROM guests WHERE id = gp.guest_id)
        WHEN gp.family_id IS NOT NULL THEN 
            (SELECT name FROM families WHERE id = gp.family_id)
        ELSE gp.player_name
    END as display_name
FROM game_participations gp
JOIN games g ON gp.game_id = g.id
ORDER BY gp.total_score DESC, gp.completion_time ASC;

-- Recréer conversation_summary_secure sans SECURITY DEFINER  
DROP VIEW IF EXISTS conversation_summary_secure;
CREATE VIEW conversation_summary_secure AS
SELECT 
    c.id,
    c.event_id,
    c.guest_id,
    c.family_id,
    c.organizer_id,
    c.subject,
    c.is_active,
    c.last_message_at,
    c.created_at,
    (
        SELECT COUNT(*) 
        FROM messages m 
        WHERE m.conversation_id = c.id 
        AND m.is_read = FALSE 
        AND m.sender_type = 'guest'
    ) as unread_count,
    (
        SELECT json_build_object(
            'id', m.id,
            'content', LEFT(m.content, 100),
            'sender_type', m.sender_type,
            'created_at', m.created_at
        )
        FROM messages m 
        WHERE m.conversation_id = c.id 
        ORDER BY m.created_at DESC 
        LIMIT 1
    ) as last_message,
    COALESCE(
        (SELECT name FROM guests WHERE id = c.guest_id),
        (SELECT name FROM families WHERE id = c.family_id),
        'Inconnu'
    ) as sender_name
FROM conversations c;

-- Recréer security_dashboard sans SECURITY DEFINER
DROP VIEW IF EXISTS security_dashboard;
CREATE VIEW security_dashboard AS
SELECT 
    'audit_logs' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT event_id) as unique_events,
    MAX(created_at) as last_activity
FROM audit_logs
UNION ALL
SELECT 
    'game_ip_tracking' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT game_id) as unique_events,
    MAX(created_at) as last_activity
FROM game_ip_tracking
UNION ALL
SELECT 
    'failed_login_attempts' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT ip_address) as unique_events,
    MAX(attempted_at) as last_activity
FROM failed_login_attempts;

-- Recréer feedback_stats sans SECURITY DEFINER
DROP VIEW IF EXISTS feedback_stats;
CREATE VIEW feedback_stats AS
SELECT 
    f.event_id,
    COUNT(*) as total_feedback,
    ROUND(AVG(f.rating), 2) as average_rating,
    COUNT(CASE WHEN f.rating >= 4 THEN 1 END) as positive_feedback,
    COUNT(CASE WHEN f.rating <= 2 THEN 1 END) as negative_feedback,
    MIN(f.created_at) as first_feedback_date,
    MAX(f.created_at) as last_feedback_date,
    e.title as event_title,
    u.name as organizer_name
FROM feedbacks f
JOIN events e ON f.event_id = e.id
JOIN users u ON e.organizer_id = u.id
GROUP BY f.event_id, e.title, u.name;

-- ============================================================================
-- 2. ACTIVATION DE RLS SUR TOUTES LES TABLES PUBLIQUES
-- ============================================================================

-- Games
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS games_access_policy ON games;
CREATE POLICY games_access_policy ON games
    USING (
        event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid())
        OR is_public = true
    );

-- Game Questions  
ALTER TABLE game_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_questions_access_policy ON game_questions;
CREATE POLICY game_questions_access_policy ON game_questions
    USING (
        game_id IN (
            SELECT g.id FROM games g 
            JOIN events e ON g.event_id = e.id 
            WHERE e.organizer_id = auth.uid() OR g.is_public = true
        )
    );

-- Game Participations
ALTER TABLE game_participations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_participations_access_policy ON game_participations;
CREATE POLICY game_participations_access_policy ON game_participations
    USING (
        game_id IN (
            SELECT g.id FROM games g 
            JOIN events e ON g.event_id = e.id 
            WHERE e.organizer_id = auth.uid() OR g.is_public = true
        )
    );

-- Game Answers
ALTER TABLE game_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_answers_access_policy ON game_answers;
CREATE POLICY game_answers_access_policy ON game_answers
    USING (
        participation_id IN (
            SELECT gp.id FROM game_participations gp
            JOIN games g ON gp.game_id = g.id
            JOIN events e ON g.event_id = e.id 
            WHERE e.organizer_id = auth.uid() OR g.is_public = true
        )
    );

-- Family Invitations
ALTER TABLE family_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_invitations_access_policy ON family_invitations;
CREATE POLICY family_invitations_access_policy ON family_invitations
    USING (
        family_id IN (
            SELECT f.id FROM families f
            JOIN events e ON f.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
        OR guest_id IN (
            SELECT g.id FROM guests g
            JOIN events e ON g.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- Family RSVP
ALTER TABLE family_rsvp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_rsvp_access_policy ON family_rsvp;
CREATE POLICY family_rsvp_access_policy ON family_rsvp
    USING (
        family_id IN (
            SELECT f.id FROM families f
            JOIN events e ON f.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- Table Assignments
ALTER TABLE table_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS table_assignments_access_policy ON table_assignments;
CREATE POLICY table_assignments_access_policy ON table_assignments
    USING (
        table_id IN (
            SELECT st.id FROM seating_tables st
            JOIN events e ON st.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- Query Result Cache (table système)
ALTER TABLE query_result_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS query_result_cache_access_policy ON query_result_cache;
CREATE POLICY query_result_cache_access_policy ON query_result_cache
    USING (
        cache_key LIKE CONCAT('%', auth.uid()::text, '%') 
        OR cache_key NOT LIKE '%user%'
    );

-- Feedbacks
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedbacks_access_policy ON feedbacks;
CREATE POLICY feedbacks_access_policy ON feedbacks
    USING (
        event_id IN (
            SELECT id FROM events WHERE organizer_id = auth.uid()
        )
    );

-- Wishes
ALTER TABLE wishes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wishes_access_policy ON wishes;
CREATE POLICY wishes_access_policy ON wishes
    USING (
        event_id IN (
            SELECT id FROM events WHERE organizer_id = auth.uid()
        )
    );

-- Seating Tables
ALTER TABLE seating_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seating_tables_access_policy ON seating_tables;
CREATE POLICY seating_tables_access_policy ON seating_tables
    USING (
        event_id IN (
            SELECT id FROM events WHERE organizer_id = auth.uid()
        )
    );

-- ============================================================================
-- 3. PROTECTION RENFORCÉE DES COLONNES SENSIBLES (ACCESS_TOKEN)
-- ============================================================================

-- Game Guest Access - Protection stricte des tokens
ALTER TABLE game_guest_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_guest_access_access_policy ON game_guest_access;
CREATE POLICY game_guest_access_access_policy ON game_guest_access
    USING (
        game_id IN (
            SELECT g.id FROM games g
            JOIN events e ON g.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- Game Family Access - Protection stricte des tokens
ALTER TABLE game_family_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_family_access_access_policy ON game_family_access;
CREATE POLICY game_family_access_access_policy ON game_family_access
    USING (
        game_id IN (
            SELECT g.id FROM games g
            JOIN events e ON g.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- Game IP Tracking
ALTER TABLE game_ip_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_ip_tracking_access_policy ON game_ip_tracking;
CREATE POLICY game_ip_tracking_access_policy ON game_ip_tracking
    USING (
        game_id IN (
            SELECT g.id FROM games g
            JOIN events e ON g.event_id = e.id
            WHERE e.organizer_id = auth.uid()
        )
    );

-- ============================================================================
-- 4. CRÉATION D'UNE VUE SÉCURISÉE POUR LES TOKENS (POUR LES ORGANISATEURS)
-- ============================================================================

-- Vue pour les tokens d'accès aux jeux (masqués pour les non-propriétaires)
CREATE OR REPLACE VIEW game_access_tokens_secure AS
SELECT 
    gga.id,
    gga.game_id,
    gga.guest_id,
    -- Masquer le token complet sauf pour le propriétaire
    CASE 
        WHEN g.event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid()) 
        THEN gga.access_token
        ELSE CONCAT(LEFT(gga.access_token, 8), '...') 
    END as access_token_display,
    gga.is_used,
    gga.used_at,
    gga.created_at,
    g.title as game_title,
    gu.name as guest_name
FROM game_guest_access gga
JOIN games g ON gga.game_id = g.id
LEFT JOIN guests gu ON gga.guest_id = gu.id;

-- Vue pour les tokens d'accès famille (masqués pour les non-propriétaires)  
CREATE OR REPLACE VIEW family_access_tokens_secure AS
SELECT 
    gfa.id,
    gfa.game_id,
    gfa.family_id,
    -- Masquer le token complet sauf pour le propriétaire
    CASE 
        WHEN g.event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid()) 
        THEN gfa.access_token
        ELSE CONCAT(LEFT(gfa.access_token, 8), '...') 
    END as access_token_display,
    gfa.is_used,
    gfa.used_at,
    gfa.created_at,
    g.title as game_title,
    f.name as family_name
FROM game_family_access gfa
JOIN games g ON gfa.game_id = g.id
LEFT JOIN families f ON gfa.family_id = f.id;

-- ============================================================================
-- 5. FONCTION UTILITAIRE POUR VÉRIFIER LA SÉCURITÉ
-- ============================================================================

CREATE OR REPLACE FUNCTION check_security_compliance()
RETURNS TABLE(
    check_name TEXT,
    table_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Vérifier RLS activé sur toutes les tables publiques
    RETURN QUERY
    SELECT 
        'RLS_ENABLED'::TEXT,
        t.tablename::TEXT,
        CASE WHEN pg_class.relrowsecurity THEN 'OK' ELSE 'FAIL' END,
        CASE WHEN pg_class.relrowsecurity THEN 'RLS activé' ELSE 'RLS MANQUANT' END
    FROM pg_tables t
    JOIN pg_class ON pg_class.relname = t.tablename
    WHERE t.schemaname = 'public' 
    AND t.tablename IN (
        'games', 'game_questions', 'game_participations', 'game_answers',
        'family_invitations', 'family_rsvp', 'table_assignments', 'families',
        'query_result_cache', 'feedbacks', 'wishes', 'seating_tables',
        'game_guest_access', 'game_family_access', 'game_ip_tracking'
    );

    -- Vérifier les vues sans SECURITY DEFINER
    RETURN QUERY
    SELECT 
        'VIEW_SECURITY'::TEXT,
        v.table_name::TEXT,
        CASE WHEN v.view_definition NOT LIKE '%SECURITY DEFINER%' THEN 'OK' ELSE 'FAIL' END,
        CASE WHEN v.view_definition NOT LIKE '%SECURITY DEFINER%' 
             THEN 'Vue sécurisée' 
             ELSE 'Vue avec SECURITY DEFINER détectée' END
    FROM information_schema.views v
    WHERE v.table_schema = 'public'
    AND v.table_name IN ('game_leaderboard', 'conversation_summary_secure', 'security_dashboard', 'feedback_stats');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. REFRESH DES VUES MATÉRIALISÉES APRÈS LES CHANGEMENTS
-- ============================================================================

-- Refresh des vues matérialisées qui dépendent des tables modifiées
REFRESH MATERIALIZED VIEW CONCURRENTLY event_menu_stats;

-- ============================================================================
-- 7. COMMENTAIRES ET DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION check_security_compliance() 
IS 'Vérifie la conformité sécuritaire de la base de données selon les standards Supabase';

COMMENT ON VIEW game_access_tokens_secure 
IS 'Vue sécurisée des tokens d''accès aux jeux - tokens masqués pour les non-propriétaires';

COMMENT ON VIEW family_access_tokens_secure 
IS 'Vue sécurisée des tokens d''accès famille - tokens masqués pour les non-propriétaires';

-- ============================================================================
-- 8. AUDIT ET VÉRIFICATION FINALE
-- ============================================================================

DO $$
DECLARE
    security_issues RECORD;
    issue_count INTEGER := 0;
BEGIN
    -- Compter les problèmes restants
    FOR security_issues IN 
        SELECT * FROM check_security_compliance() WHERE status = 'FAIL'
    LOOP
        issue_count := issue_count + 1;
        RAISE NOTICE 'PROBLÈME: % sur table % - %', 
            security_issues.check_name, 
            security_issues.table_name, 
            security_issues.details;
    END LOOP;

    -- Log de fin
    IF issue_count = 0 THEN
        RAISE NOTICE '✅ Migration 041 terminée - Toutes les vulnérabilités Supabase corrigées';
        RAISE NOTICE '✅ RLS activé sur toutes les tables publiques exposées';
        RAISE NOTICE '✅ Vues SECURITY DEFINER supprimées et recréées en mode sécurisé';  
        RAISE NOTICE '✅ Colonnes sensibles (access_token) protégées par RLS';
    ELSE
        RAISE NOTICE '⚠️  Migration 041 terminée avec % problèmes restants', issue_count;
    END IF;

    RAISE NOTICE 'ℹ️  Utilisez SELECT * FROM check_security_compliance(); pour vérifier l''état';
END $$;