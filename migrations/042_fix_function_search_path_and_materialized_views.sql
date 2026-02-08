-- ============================================================================
-- Migration: Correction search_path et vues matérialisées
-- Date: 2026-02-08  
-- Description: Corriger les fonctions avec search_path mutable et sécuriser les vues matérialisées
-- ============================================================================

-- ============================================================================
-- 1. CORRECTION DES FONCTIONS AVEC SEARCH_PATH MUTABLE
-- ============================================================================

-- Toutes les fonctions doivent avoir SET search_path = '' pour éviter les attaques par injection de schéma

-- 1.1 update_budget_items_updated_at
CREATE OR REPLACE FUNCTION update_budget_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.2 get_conversation_organizer  
CREATE OR REPLACE FUNCTION get_conversation_organizer(conv_id UUID)
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT c.organizer_id INTO org_id
    FROM public.conversations c
    WHERE c.id = conv_id;
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.3 get_event_organizer
CREATE OR REPLACE FUNCTION get_event_organizer(evt_id UUID)
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT e.organizer_id INTO org_id
    FROM public.events e
    WHERE e.id = evt_id;
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.4 mark_conversation_as_read
CREATE OR REPLACE FUNCTION mark_conversation_as_read(conv_id UUID, user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
    is_authorized BOOLEAN;
BEGIN
    -- Vérifier l'autorisation
    SELECT EXISTS (
        SELECT 1 FROM public.conversations c
        JOIN public.events e ON c.event_id = e.id
        WHERE c.id = conv_id
        AND (c.organizer_id = user_id OR e.organizer_id = user_id)
    ) INTO is_authorized;
    
    IF NOT is_authorized THEN
        RAISE EXCEPTION 'Non autorisé à marquer cette conversation comme lue';
    END IF;
    
    -- Marquer les messages comme lus
    UPDATE public.messages 
    SET is_read = true, 
        updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = conv_id 
    AND sender_type = 'guest'
    AND is_read = false;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    -- Mettre à jour la conversation
    UPDATE public.conversations 
    SET last_message_at = CURRENT_TIMESTAMP 
    WHERE id = conv_id;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.5 cleanup_old_audit_logs
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.audit_logs 
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.6 get_message_stats_secure
CREATE OR REPLACE FUNCTION get_message_stats_secure(p_event_id UUID)
RETURNS TABLE(
    total_conversations BIGINT,
    active_conversations BIGINT,
    total_messages BIGINT,
    unread_messages BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT CASE WHEN c.is_active THEN c.id END) as active_conversations,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN NOT m.is_read AND m.sender_type = 'guest' THEN m.id END) as unread_messages
    FROM public.conversations c
    LEFT JOIN public.messages m ON c.id = m.conversation_id
    WHERE c.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.7 log_audit_event
CREATE OR REPLACE FUNCTION log_audit_event(
    p_event_id UUID,
    p_user_id UUID,
    p_action TEXT,
    p_table_name TEXT,
    p_record_id UUID DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.audit_logs (
        event_id, user_id, action, table_name, 
        record_id, old_values, new_values, created_at
    ) VALUES (
        p_event_id, p_user_id, p_action, p_table_name,
        p_record_id, p_old_values, p_new_values, CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.8 log_login_attempt
CREATE OR REPLACE FUNCTION log_login_attempt(
    p_email TEXT,
    p_ip_address TEXT,
    p_success BOOLEAN,
    p_user_agent TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.failed_login_attempts (
        email, ip_address, success, user_agent, attempted_at
    ) VALUES (
        p_email, p_ip_address, p_success, p_user_agent, CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.9 get_failed_login_attempts
CREATE OR REPLACE FUNCTION get_failed_login_attempts(p_hours INTEGER DEFAULT 24)
RETURNS TABLE(
    email TEXT,
    ip_address TEXT,
    attempt_count BIGINT,
    last_attempt TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fla.email,
        fla.ip_address,
        COUNT(*) as attempt_count,
        MAX(fla.attempted_at) as last_attempt
    FROM public.failed_login_attempts fla
    WHERE fla.attempted_at > NOW() - (p_hours || ' hours')::INTERVAL
    AND fla.success = false
    GROUP BY fla.email, fla.ip_address
    ORDER BY attempt_count DESC, last_attempt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.10 get_failed_login_attempts_by_email
CREATE OR REPLACE FUNCTION get_failed_login_attempts_by_email(p_email TEXT, p_hours INTEGER DEFAULT 24)
RETURNS BIGINT AS $$
DECLARE
    attempt_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO attempt_count
    FROM public.failed_login_attempts
    WHERE email = p_email
    AND attempted_at > NOW() - (p_hours || ' hours')::INTERVAL
    AND success = false;
    
    RETURN attempt_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.11 cleanup_old_login_attempts
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.failed_login_attempts 
    WHERE attempted_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.12 migrate_existing_events_to_venues
CREATE OR REPLACE FUNCTION migrate_existing_events_to_venues()
RETURNS INTEGER AS $$
DECLARE
    migrated_count INTEGER := 0;
    event_record RECORD;
BEGIN
    FOR event_record IN 
        SELECT id, venue, ceremony_time, reception_time 
        FROM public.events 
        WHERE venue IS NOT NULL AND ceremony_venue IS NULL
    LOOP
        UPDATE public.events 
        SET 
            ceremony_venue = event_record.venue,
            reception_venue = event_record.venue,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = event_record.id;
        
        migrated_count := migrated_count + 1;
    END LOOP;
    
    RETURN migrated_count;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.13 validate_event_venues
CREATE OR REPLACE FUNCTION validate_event_venues(p_event_id UUID)
RETURNS TABLE(
    field_name TEXT,
    is_valid BOOLEAN,
    message TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH event_data AS (
        SELECT ceremony_venue, reception_venue, ceremony_time, reception_time
        FROM public.events WHERE id = p_event_id
    )
    SELECT 
        'ceremony_venue'::TEXT,
        CASE WHEN LENGTH(TRIM(ceremony_venue)) > 0 THEN true ELSE false END,
        CASE WHEN LENGTH(TRIM(ceremony_venue)) > 0 THEN 'OK' ELSE 'Lieu de cérémonie requis' END
    FROM event_data
    UNION ALL
    SELECT 
        'reception_venue'::TEXT,
        CASE WHEN LENGTH(TRIM(reception_venue)) > 0 THEN true ELSE false END,
        CASE WHEN LENGTH(TRIM(reception_venue)) > 0 THEN 'OK' ELSE 'Lieu de réception requis' END
    FROM event_data;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.14 generate_access_token
CREATE OR REPLACE FUNCTION generate_access_token()
RETURNS TEXT AS $$
BEGIN
    RETURN encode(gen_random_bytes(32), 'base64');
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.15 update_game_leaderboard
CREATE OR REPLACE FUNCTION update_game_leaderboard(p_game_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Mettre à jour les rangs dans game_participations
    WITH ranked_participations AS (
        SELECT 
            id,
            ROW_NUMBER() OVER (
                ORDER BY total_score DESC, completion_time ASC
            ) as new_rank
        FROM public.game_participations
        WHERE game_id = p_game_id
        AND total_score IS NOT NULL
    )
    UPDATE public.game_participations gp
    SET rank = rp.new_rank
    FROM ranked_participations rp
    WHERE gp.id = rp.id;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.16 get_events_with_stats
CREATE OR REPLACE FUNCTION get_events_with_stats(p_organizer_id UUID)
RETURNS TABLE(
    event_id UUID,
    title TEXT,
    date DATE,
    guest_count BIGINT,
    family_count BIGINT,
    game_count BIGINT,
    feedback_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.title,
        e.date,
        COALESCE(COUNT(DISTINCT g.id), 0) as guest_count,
        COALESCE(COUNT(DISTINCT f.id), 0) as family_count,
        COALESCE(COUNT(DISTINCT gm.id), 0) as game_count,
        COALESCE(COUNT(DISTINCT fb.id), 0) as feedback_count
    FROM public.events e
    LEFT JOIN public.guests g ON e.id = g.event_id
    LEFT JOIN public.families f ON e.id = f.event_id
    LEFT JOIN public.games gm ON e.id = gm.event_id
    LEFT JOIN public.feedbacks fb ON e.id = fb.event_id
    WHERE e.organizer_id = p_organizer_id
    GROUP BY e.id, e.title, e.date
    ORDER BY e.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.17 update_guest_search_vector
CREATE OR REPLACE FUNCTION update_guest_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('french', 
        COALESCE(NEW.name, '') || ' ' || 
        COALESCE(NEW.email, '') || ' ' ||
        COALESCE(NEW.phone, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.18 cleanup_query_cache
CREATE OR REPLACE FUNCTION cleanup_query_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.query_result_cache 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.19 update_updated_at_column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 1.20 get_dashboard_summary  
CREATE OR REPLACE FUNCTION get_dashboard_summary(p_organizer_id UUID)
RETURNS TABLE(
    total_events BIGINT,
    active_events BIGINT,
    total_guests BIGINT,
    total_families BIGINT,
    pending_rsvp BIGINT,
    confirmed_rsvp BIGINT,
    total_games BIGINT,
    total_participations BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH user_events AS (
        SELECT id FROM public.events WHERE organizer_id = p_organizer_id
    )
    SELECT 
        COUNT(DISTINCT e.id) as total_events,
        COUNT(DISTINCT CASE WHEN e.is_active THEN e.id END) as active_events,
        COUNT(DISTINCT g.id) as total_guests,
        COUNT(DISTINCT f.id) as total_families,
        COUNT(DISTINCT CASE WHEN fr.status = 'pending' THEN fr.id END) as pending_rsvp,
        COUNT(DISTINCT CASE WHEN fr.status = 'confirmed' THEN fr.id END) as confirmed_rsvp,
        COUNT(DISTINCT gm.id) as total_games,
        COUNT(DISTINCT gp.id) as total_participations
    FROM user_events ue
    JOIN public.events e ON ue.id = e.id
    LEFT JOIN public.guests g ON e.id = g.event_id
    LEFT JOIN public.families f ON e.id = f.event_id
    LEFT JOIN public.family_rsvp fr ON f.id = fr.family_id
    LEFT JOIN public.games gm ON e.id = gm.event_id
    LEFT JOIN public.game_participations gp ON gm.id = gp.game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 1.21 refresh_event_summary
CREATE OR REPLACE FUNCTION refresh_event_summary()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_event_summary;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- 2. SÉCURISATION DES VUES MATÉRIALISÉES 
-- ============================================================================

-- Les vues matérialisées ne doivent pas être accessibles directement via l'API
-- On active RLS sur ces vues pour contrôler l'accès

-- 2.1 Sécuriser mv_event_summary
ALTER MATERIALIZED VIEW mv_event_summary OWNER TO postgres;
ALTER TABLE mv_event_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mv_event_summary_access_policy ON mv_event_summary;
CREATE POLICY mv_event_summary_access_policy ON mv_event_summary
    USING (organizer_id = auth.uid());

-- 2.2 Sécuriser mv_qr_code_stats  
ALTER MATERIALIZED VIEW mv_qr_code_stats OWNER TO postgres;
ALTER TABLE mv_qr_code_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mv_qr_code_stats_access_policy ON mv_qr_code_stats;
CREATE POLICY mv_qr_code_stats_access_policy ON mv_qr_code_stats
    USING (
        event_id IN (
            SELECT id FROM public.events WHERE organizer_id = auth.uid()
        )
    );

-- 2.3 Sécuriser mv_game_stats
ALTER MATERIALIZED VIEW mv_game_stats OWNER TO postgres;
ALTER TABLE mv_game_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mv_game_stats_access_policy ON mv_game_stats;
CREATE POLICY mv_game_stats_access_policy ON mv_game_stats
    USING (
        event_id IN (
            SELECT id FROM public.events WHERE organizer_id = auth.uid()
        )
    );

-- ============================================================================
-- 3. CRÉATION DE VUES SÉCURISÉES POUR L'API
-- ============================================================================

-- Créer des vues normales qui peuvent remplacer l'accès direct aux vues matérialisées

-- 3.1 Vue sécurisée pour les statistiques d'événements
CREATE OR REPLACE VIEW event_summary_secure AS
SELECT 
    e.id as event_id,
    e.title,
    e.organizer_id,
    e.date,
    e.is_active,
    COUNT(DISTINCT g.id) as guest_count,
    COUNT(DISTINCT f.id) as family_count,
    COUNT(DISTINCT gm.id) as game_count,
    COUNT(DISTINCT fr.id) FILTER (WHERE fr.status = 'confirmed') as confirmed_rsvp_count,
    COUNT(DISTINCT fr.id) FILTER (WHERE fr.status = 'pending') as pending_rsvp_count,
    COUNT(DISTINCT qr.id) as qr_code_count,
    COUNT(DISTINCT qr.id) FILTER (WHERE qr.is_valid AND qr.expires_at > NOW()) as active_qr_count
FROM public.events e
LEFT JOIN public.guests g ON e.id = g.event_id
LEFT JOIN public.families f ON e.id = f.event_id
LEFT JOIN public.games gm ON e.id = gm.event_id
LEFT JOIN public.family_rsvp fr ON f.id = fr.family_id
LEFT JOIN public.qr_codes qr ON e.id = qr.event_id
WHERE e.organizer_id = auth.uid()
GROUP BY e.id, e.title, e.organizer_id, e.date, e.is_active;

-- 3.2 Vue sécurisée pour les statistiques QR codes
CREATE OR REPLACE VIEW qr_code_stats_secure AS
SELECT 
    qr.event_id,
    COUNT(*) as total_qr_codes,
    COUNT(*) FILTER (WHERE qr.is_valid = true AND qr.expires_at > NOW()) as active_qr_codes,
    COUNT(*) FILTER (WHERE qr.is_valid = false) as invalidated_qr_codes,
    COUNT(*) FILTER (WHERE qr.scanned_at IS NOT NULL) as scanned_qr_codes,
    MAX(qr.scanned_at) as last_scan_time,
    MIN(qr.created_at) as first_created_time
FROM public.qr_codes qr
JOIN public.events e ON qr.event_id = e.id
WHERE e.organizer_id = auth.uid()
GROUP BY qr.event_id;

-- 3.3 Vue sécurisée pour les statistiques de jeux
CREATE OR REPLACE VIEW game_stats_secure AS
SELECT 
    g.id as game_id,
    g.event_id,
    g.title as name,
    g.type,
    g.is_public,
    COUNT(DISTINCT gp.id) as total_participations,
    COUNT(DISTINCT gp.guest_id) as unique_players,
    AVG(gp.total_score) as average_score,
    MAX(gp.total_score) as highest_score,
    MIN(gp.total_score) FILTER (WHERE gp.total_score > 0) as lowest_score,
    COUNT(DISTINCT gq.id) as total_questions,
    g.created_at,
    g.is_active
FROM public.games g
LEFT JOIN public.game_participations gp ON g.id = gp.game_id
LEFT JOIN public.game_questions gq ON g.id = gq.game_id
JOIN public.events e ON g.event_id = e.id
WHERE e.organizer_id = auth.uid()
GROUP BY g.id, g.event_id, g.title, g.type, g.is_public, g.created_at, g.is_active;

-- ============================================================================
-- 4. FONCTION DE VÉRIFICATION DE SÉCURITÉ ÉTENDUE
-- ============================================================================

CREATE OR REPLACE FUNCTION check_extended_security_compliance()
RETURNS TABLE(
    check_name TEXT,
    function_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Vérifier que toutes les fonctions ont search_path = ''
    RETURN QUERY
    SELECT 
        'SEARCH_PATH_SECURE'::TEXT,
        p.proname::TEXT,
        CASE WHEN p.proconfig IS NULL OR 'search_path=' = ANY(p.proconfig) THEN 'OK' ELSE 'FAIL' END,
        CASE WHEN p.proconfig IS NULL OR 'search_path=' = ANY(p.proconfig) 
             THEN 'search_path sécurisé' 
             ELSE 'search_path mutable détecté' END
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname IN (
        'update_budget_items_updated_at', 'get_conversation_organizer', 
        'get_event_organizer', 'mark_conversation_as_read',
        'cleanup_old_audit_logs', 'get_message_stats_secure',
        'log_audit_event', 'log_login_attempt', 'get_failed_login_attempts',
        'get_failed_login_attempts_by_email', 'cleanup_old_login_attempts',
        'migrate_existing_events_to_venues', 'validate_event_venues',
        'generate_access_token', 'update_game_leaderboard', 
        'get_events_with_stats', 'update_guest_search_vector',
        'cleanup_query_cache', 'update_updated_at_column',
        'get_dashboard_summary', 'refresh_event_summary'
    );

    -- Vérifier RLS sur les vues matérialisées
    RETURN QUERY
    SELECT 
        'MATERIALIZED_VIEW_RLS'::TEXT,
        c.relname::TEXT,
        CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END,
        CASE WHEN c.relrowsecurity THEN 'RLS activé' ELSE 'RLS MANQUANT' END
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND c.relkind = 'm'  -- materialized view
    AND c.relname IN ('mv_event_summary', 'mv_qr_code_stats', 'mv_game_stats');
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ============================================================================
-- 5. COMMENTAIRES ET DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION check_extended_security_compliance() 
IS 'Vérifie la sécurité des fonctions (search_path) et des vues matérialisées (RLS)';

COMMENT ON VIEW event_summary_secure 
IS 'Vue sécurisée remplaçant l''accès direct à mv_event_summary';

COMMENT ON VIEW qr_code_stats_secure 
IS 'Vue sécurisée remplaçant l''accès direct à mv_qr_code_stats';

COMMENT ON VIEW game_stats_secure 
IS 'Vue sécurisée remplaçant l''accès direct à mv_game_stats';

-- ============================================================================
-- 6. AUDIT ET VÉRIFICATION FINALE
-- ============================================================================

DO $$
DECLARE
    security_issues RECORD;
    issue_count INTEGER := 0;
BEGIN
    -- Compter les problèmes restants
    FOR security_issues IN 
        SELECT * FROM check_extended_security_compliance() WHERE status = 'FAIL'
    LOOP
        issue_count := issue_count + 1;
        RAISE NOTICE 'PROBLÈME: % sur fonction/vue % - %', 
            security_issues.check_name, 
            security_issues.function_name, 
            security_issues.details;
    END LOOP;

    -- Log de fin
    IF issue_count = 0 THEN
        RAISE NOTICE '✅ Migration 042 terminée - Problèmes search_path et vues matérialisées corrigés';
        RAISE NOTICE '✅ Toutes les fonctions ont search_path = ''''';
        RAISE NOTICE '✅ RLS activé sur toutes les vues matérialisées';  
        RAISE NOTICE '✅ Vues sécurisées créées pour remplacer l''accès direct aux vues matérialisées';
    ELSE
        RAISE NOTICE '⚠️  Migration 042 terminée avec % problèmes restants', issue_count;
    END IF;

    RAISE NOTICE 'ℹ️  Utilisez SELECT * FROM check_extended_security_compliance(); pour vérifier l''état';
END $$;