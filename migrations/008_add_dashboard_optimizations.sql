-- Migration: Optimisations Dashboard et vues matérialisées
-- Date: 2026-02-05
-- Priorité: HAUTE
-- Description: Élimine les requêtes N+1 et accélère les rapports

-- ============================================
-- 1. VUE MATÉRIALISÉE: Résumé par événement
-- ============================================
-- Élimine les requêtes N+1 dans le dashboard

DROP MATERIALIZED VIEW IF EXISTS mv_event_summary CASCADE;

CREATE MATERIALIZED VIEW mv_event_summary AS
SELECT 
    e.id as event_id,
    e.title,
    e.organizer_id,
    e.date,
    e.is_active,
    e.created_at,
    -- Compteurs guests
    COUNT(DISTINCT g.id) as total_guests,
    COUNT(DISTINCT CASE WHEN g.rsvp_status = 'accepted' THEN g.id END) as confirmed_guests,
    COUNT(DISTINCT CASE WHEN g.rsvp_status = 'declined' THEN g.id END) as declined_guests,
    COUNT(DISTINCT CASE WHEN g.rsvp_status = 'pending' THEN g.id END) as pending_guests,
    -- Compteurs présence
    COUNT(DISTINCT CASE WHEN g.attendance_status = 'arrived' THEN g.id END) as arrived_guests,
    COUNT(DISTINCT CASE WHEN g.attendance_status = 'left' THEN g.id END) as left_guests,
    -- Dernière activité
    MAX(g.updated_at) as last_guest_update,
    MAX(a.timestamp) as last_attendance
FROM events e
LEFT JOIN guests g ON g.event_id = e.id AND (g.is_active = true OR g.is_active IS NULL)
LEFT JOIN attendance a ON a.event_id = e.id
WHERE e.is_active = true
GROUP BY e.id, e.title, e.organizer_id, e.date, e.is_active, e.created_at;

-- Index sur la vue matérialisée
CREATE UNIQUE INDEX idx_mv_event_summary_event_id ON mv_event_summary(event_id);
CREATE INDEX idx_mv_event_summary_organizer ON mv_event_summary(organizer_id);

COMMENT ON MATERIALIZED VIEW mv_event_summary IS 'Vue matérialisée pour dashboard - rafraîchir toutes les 5 min';

-- ============================================
-- 2. FONCTION DE RAFRAÎCHISSEMENT
-- ============================================
CREATE OR REPLACE FUNCTION refresh_event_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. VUE MATÉRIALISÉE: Statistiques QR Codes
-- ============================================
DROP MATERIALIZED VIEW IF EXISTS mv_qr_code_stats CASCADE;

CREATE MATERIALIZED VIEW mv_qr_code_stats AS
SELECT 
    event_id,
    COUNT(*) as total_qr_codes,
    COUNT(*) FILTER (WHERE is_valid = true AND expires_at > NOW()) as active_qr_codes,
    COUNT(*) FILTER (WHERE is_valid = false) as invalidated_qr_codes,
    COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired_qr_codes,
    COALESCE(SUM(scan_count), 0) as total_scans,
    MAX(last_scanned_at) as last_scan_at
FROM qr_codes
GROUP BY event_id;

CREATE UNIQUE INDEX idx_mv_qr_code_stats_event ON mv_qr_code_stats(event_id);

COMMENT ON MATERIALIZED VIEW mv_qr_code_stats IS 'Stats QR codes par événement';

-- ============================================
-- 4. VUE MATÉRIALISÉE: Stats Jeux
-- ============================================
DROP MATERIALIZED VIEW IF EXISTS mv_game_stats CASCADE;

CREATE MATERIALIZED VIEW mv_game_stats AS
SELECT 
    g.id as game_id,
    g.event_id,
    g.name,
    g.type,
    g.status,
    COUNT(DISTINCT gp.guest_id) as player_count,
    COUNT(DISTINCT CASE WHEN gp.is_completed THEN gp.guest_id END) as completed_count,
    COALESCE(AVG(gp.total_score) FILTER (WHERE gp.is_completed), 0) as avg_score,
    MAX(gp.total_score) as max_score,
    COUNT(DISTINCT ga.id) as total_answers,
    COUNT(DISTINCT CASE WHEN ga.is_correct THEN ga.id END) as correct_answers
FROM games g
LEFT JOIN game_participations gp ON gp.game_id = g.id
LEFT JOIN game_answers ga ON ga.participation_id = gp.id
WHERE g.is_active = true
GROUP BY g.id, g.event_id, g.name, g.type, g.status;

CREATE UNIQUE INDEX idx_mv_game_stats_game ON mv_game_stats(game_id);
CREATE INDEX idx_mv_game_stats_event ON mv_game_stats(event_id);

COMMENT ON MATERIALIZED VIEW mv_game_stats IS 'Stats jeux calculées - remplace le trigger synchrone';

-- ============================================
-- 5. FONCTION: Récupérer dashboard summary optimisé
-- ============================================
CREATE OR REPLACE FUNCTION get_dashboard_summary(p_organizer_id UUID)
RETURNS TABLE (
    total_events BIGINT,
    total_guests BIGINT,
    confirmed_guests BIGINT,
    pending_guests BIGINT,
    declined_guests BIGINT,
    arrived_guests BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT es.event_id),
        COALESCE(SUM(es.total_guests), 0),
        COALESCE(SUM(es.confirmed_guests), 0),
        COALESCE(SUM(es.pending_guests), 0),
        COALESCE(SUM(es.declined_guests), 0),
        COALESCE(SUM(es.arrived_guests), 0)
    FROM mv_event_summary es
    WHERE es.organizer_id = p_organizer_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_dashboard_summary IS 'Fonction optimisée pour le dashboard - utilise vue matérialisée';

-- ============================================
-- 6. FONCTION: Liste events avec stats (remplace N+1)
-- ============================================
CREATE OR REPLACE FUNCTION get_events_with_stats(p_organizer_id UUID)
RETURNS TABLE (
    event_id UUID,
    title VARCHAR,
    event_date TIMESTAMP WITH TIME ZONE,
    location JSONB,
    total_guests BIGINT,
    confirmed_guests BIGINT,
    pending_guests BIGINT,
    declined_guests BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        es.event_id,
        es.title,
        es.date,
        e.location,
        es.total_guests,
        es.confirmed_guests,
        es.pending_guests,
        es.declined_guests
    FROM mv_event_summary es
    JOIN events e ON e.id = es.event_id
    WHERE es.organizer_id = p_organizer_id
    ORDER BY es.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_events_with_stats IS 'Récupère events avec stats en une requête';

-- ============================================
-- 7. INDEX POUR RECHERCHE FULL-TEXT
-- ============================================
-- Ajout de recherche textuelle sur guests (nom/prénom/email)

ALTER TABLE guests ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE guests SET search_vector = 
    setweight(to_tsvector('simple', COALESCE(first_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(last_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(email, '')), 'B');

CREATE INDEX idx_guests_search ON guests USING GIN (search_vector);

-- Trigger pour maintenir le search_vector à jour
CREATE OR REPLACE FUNCTION update_guest_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.first_name, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.last_name, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.email, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_guest_search ON guests;
CREATE TRIGGER trigger_update_guest_search
    BEFORE INSERT OR UPDATE ON guests
    FOR EACH ROW
    EXECUTE FUNCTION update_guest_search_vector();

COMMENT ON FUNCTION update_guest_search_vector IS 'Met à jour le search vector pour recherche full-text';

-- ============================================
-- 8. TABLE: Cache pour résultats de requêtes lourdes
-- ============================================
CREATE TABLE IF NOT EXISTS query_result_cache (
    cache_key VARCHAR(255) PRIMARY KEY,
    result_data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_query_cache_expires ON query_result_cache(expires_at);

-- Fonction de nettoyage du cache
CREATE OR REPLACE FUNCTION cleanup_query_cache()
RETURNS void AS $$
BEGIN
    DELETE FROM query_result_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE query_result_cache IS 'Cache applicatif pour résultats de requêtes coûteuses';

-- ============================================
-- 9. VERIFICATION
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Vues matérialisées créées: mv_event_summary, mv_qr_code_stats, mv_game_stats';
    RAISE NOTICE 'Fonctions optimisées créées pour dashboard';
    RAISE NOTICE 'Recherche full-text activée sur guests';
    RAISE NOTICE 'Cache applicatif configuré';
END $$;
