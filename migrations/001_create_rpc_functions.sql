-- ============================================
-- Migration 001: Création des fonctions RPC manquantes
-- ============================================
-- Description: Créer les fonctions PostgreSQL nécessaires pour le bon
--              fonctionnement des appels RPC Supabase
-- Date: 2026-02-05
-- Auteur: Claude Code Assistant

-- ============================================
-- 1. FONCTION exec_sql (pour l'exécution de SQL dynamique)
-- ============================================
CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Vérifications de sécurité basiques
  IF query IS NULL OR LENGTH(TRIM(query)) = 0 THEN
    RAISE EXCEPTION 'Query cannot be empty';
  END IF;

  -- Bloquer certaines opérations dangereuses
  IF UPPER(query) LIKE '%DROP%USER%' 
     OR UPPER(query) LIKE '%DROP%ROLE%'
     OR UPPER(query) LIKE '%ALTER%USER%'
     OR UPPER(query) LIKE '%CREATE%USER%'
     OR UPPER(query) LIKE '%GRANT%'
     OR UPPER(query) LIKE '%REVOKE%' THEN
    RAISE EXCEPTION 'Restricted SQL operation not allowed';
  END IF;

  -- Exécuter la requête
  EXECUTE query;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error executing query: %', SQLERRM;
END;
$$;

-- Commentaire sur la fonction
COMMENT ON FUNCTION exec_sql(TEXT) IS 'Execute dynamic SQL with basic security restrictions';

-- ============================================
-- 2. FONCTION get_dashboard_summary
-- ============================================
CREATE OR REPLACE FUNCTION get_dashboard_summary(p_organizer_id UUID)
RETURNS TABLE (
  total_events INTEGER,
  total_guests INTEGER,
  confirmed_guests INTEGER,
  pending_guests INTEGER,
  declined_guests INTEGER,
  arrived_guests INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(events_count.total_events, 0)::INTEGER as total_events,
    COALESCE(guest_stats.total_guests, 0)::INTEGER as total_guests,
    COALESCE(guest_stats.confirmed_guests, 0)::INTEGER as confirmed_guests,
    COALESCE(guest_stats.pending_guests, 0)::INTEGER as pending_guests,
    COALESCE(guest_stats.declined_guests, 0)::INTEGER as declined_guests,
    COALESCE(guest_stats.arrived_guests, 0)::INTEGER as arrived_guests
  FROM 
    (
      -- Compter les événements
      SELECT COUNT(*)::INTEGER as total_events
      FROM events 
      WHERE organizer_id = p_organizer_id 
        AND is_active = true
    ) events_count
  CROSS JOIN
    (
      -- Compter les invités par statut
      SELECT 
        COUNT(g.id)::INTEGER as total_guests,
        COUNT(CASE WHEN g.status = 'confirmed' THEN 1 END)::INTEGER as confirmed_guests,
        COUNT(CASE WHEN g.status = 'pending' THEN 1 END)::INTEGER as pending_guests,
        COUNT(CASE WHEN g.status = 'declined' THEN 1 END)::INTEGER as declined_guests,
        COUNT(CASE WHEN g.status = 'arrived' THEN 1 END)::INTEGER as arrived_guests
      FROM events e
      LEFT JOIN guests g ON e.id = g.event_id
      WHERE e.organizer_id = p_organizer_id 
        AND e.is_active = true
    ) guest_stats;
END;
$$;

-- Commentaire sur la fonction
COMMENT ON FUNCTION get_dashboard_summary(UUID) IS 'Get dashboard statistics for an organizer';

-- ============================================
-- 3. FONCTION refresh_event_summary (pour les vues matérialisées)
-- ============================================
CREATE OR REPLACE FUNCTION refresh_event_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Vérifier si la vue matérialisée existe
  IF EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'mv_event_summary'
  ) THEN
    -- Essayer CONCURRENTLY d'abord
    BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_event_summary;
    EXCEPTION
      WHEN OTHERS THEN
        -- Si CONCURRENTLY échoue, faire un refresh standard
        REFRESH MATERIALIZED VIEW mv_event_summary;
    END;
  ELSE
    RAISE NOTICE 'Materialized view mv_event_summary does not exist';
  END IF;
END;
$$;

-- Commentaire sur la fonction
COMMENT ON FUNCTION refresh_event_summary() IS 'Refresh the event summary materialized view';

-- ============================================
-- 4. VUE MATÉRIALISÉE mv_event_summary (si elle n'existe pas)
-- ============================================
-- Créer la vue seulement si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews 
    WHERE matviewname = 'mv_event_summary'
  ) THEN
    EXECUTE '
    CREATE MATERIALIZED VIEW mv_event_summary AS
    SELECT 
      e.id as event_id,
      e.title,
      e.date,
      e.is_active,
      e.created_at,
      e.organizer_id,
      COALESCE(guest_counts.total_guests, 0) as total_guests,
      COALESCE(guest_counts.confirmed_guests, 0) as confirmed_guests,
      COALESCE(guest_counts.pending_guests, 0) as pending_guests,
      COALESCE(guest_counts.declined_guests, 0) as declined_guests,
      COALESCE(guest_counts.arrived_guests, 0) as arrived_guests,
      COALESCE(guest_counts.left_guests, 0) as left_guests
    FROM events e
    LEFT JOIN (
      SELECT 
        event_id,
        COUNT(*) as total_guests,
        COUNT(CASE WHEN status = ''confirmed'' THEN 1 END) as confirmed_guests,
        COUNT(CASE WHEN status = ''pending'' THEN 1 END) as pending_guests,
        COUNT(CASE WHEN status = ''declined'' THEN 1 END) as declined_guests,
        COUNT(CASE WHEN status = ''arrived'' THEN 1 END) as arrived_guests,
        COUNT(CASE WHEN status = ''left'' THEN 1 END) as left_guests
      FROM guests
      GROUP BY event_id
    ) guest_counts ON e.id = guest_counts.event_id
    WHERE e.is_active = true';
    
    -- Créer un index unique pour permettre REFRESH CONCURRENTLY
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS mv_event_summary_unique_idx ON mv_event_summary (event_id)';
    
    RAISE NOTICE 'Created materialized view mv_event_summary with unique index';
  ELSE
    RAISE NOTICE 'Materialized view mv_event_summary already exists';
  END IF;
END;
$$;

-- ============================================
-- 5. PERMISSIONS ET SÉCURITÉ
-- ============================================

-- Accorder les permissions d'exécution à authenticated
-- (ajuster selon vos besoins de sécurité)
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_event_summary() TO authenticated;

-- Accorder les permissions de lecture sur la vue matérialisée
GRANT SELECT ON mv_event_summary TO authenticated;

-- ============================================
-- 6. FONCTIONS DE VALIDATION ET TESTS
-- ============================================

-- Fonction pour tester si tout fonctionne
CREATE OR REPLACE FUNCTION test_rpc_functions()
RETURNS TABLE (
  function_name TEXT,
  exists BOOLEAN,
  test_result TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Test exec_sql
  RETURN QUERY SELECT 
    'exec_sql'::TEXT,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'exec_sql'),
    'Function exists'::TEXT;

  -- Test get_dashboard_summary
  RETURN QUERY SELECT 
    'get_dashboard_summary'::TEXT,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_summary'),
    'Function exists'::TEXT;

  -- Test refresh_event_summary
  RETURN QUERY SELECT 
    'refresh_event_summary'::TEXT,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'refresh_event_summary'),
    'Function exists'::TEXT;

  -- Test vue matérialisée
  RETURN QUERY SELECT 
    'mv_event_summary'::TEXT,
    EXISTS(SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_event_summary'),
    'Materialized view exists'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION test_rpc_functions() TO authenticated;

-- ============================================
-- FINALISATION
-- ============================================

-- Log de fin de migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 001 completed successfully at %', NOW();
  RAISE NOTICE 'Created functions: exec_sql, get_dashboard_summary, refresh_event_summary, test_rpc_functions';
  RAISE NOTICE 'Created materialized view: mv_event_summary';
  RAISE NOTICE 'Use SELECT * FROM test_rpc_functions() to verify installation';
END;
$$;