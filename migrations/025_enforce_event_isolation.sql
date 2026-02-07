-- ============================================================================
-- Migration: Renforcement isolation par événement
-- Date: 2026-02-07  
-- Description: S'assurer que toutes les entités sont liées à un événement
-- ============================================================================

-- ============================================================================
-- 1. AUDIT des données existantes
-- ============================================================================
-- Créer une vue pour auditer les données non liées aux événements
CREATE OR REPLACE VIEW event_data_audit AS
SELECT 
    'families' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN event_id IS NULL THEN 1 END) as unlinked_records,
    ROUND(100.0 * COUNT(CASE WHEN event_id IS NULL THEN 1 END) / COUNT(*), 2) as unlinked_percentage
FROM families
UNION ALL
SELECT 
    'seating_tables' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN event_id IS NULL THEN 1 END) as unlinked_records,
    ROUND(100.0 * COUNT(CASE WHEN event_id IS NULL THEN 1 END) / COUNT(*), 2) as unlinked_percentage
FROM seating_tables
UNION ALL
SELECT 
    'guests' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN event_id IS NULL THEN 1 END) as unlinked_records,
    ROUND(100.0 * COUNT(CASE WHEN event_id IS NULL THEN 1 END) / COUNT(*), 2) as unlinked_percentage
FROM guests;

-- ============================================================================
-- 2. CONTRAINTES strictes pour isolation par événement
-- ============================================================================

-- Fonction pour valider qu'un guest appartient au bon événement
CREATE OR REPLACE FUNCTION validate_guest_event_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- Pour table_assignments : vérifier que guest et table appartiennent au même événement
    IF TG_TABLE_NAME = 'table_assignments' THEN
        IF NOT EXISTS (
            SELECT 1 FROM guests g 
            JOIN seating_tables st ON st.event_id = g.event_id 
            WHERE g.id = NEW.guest_id AND st.id = NEW.table_id
        ) THEN
            RAISE EXCEPTION 'Guest et table doivent appartenir au même événement';
        END IF;
    END IF;
    
    -- Pour guest_menu_preferences : vérifier cohérence événement
    IF TG_TABLE_NAME = 'guest_menu_preferences' THEN
        IF NOT EXISTS (
            SELECT 1 FROM guests g 
            JOIN menu_items mi ON mi.event_id = g.event_id 
            WHERE g.id = NEW.guest_id AND mi.id = NEW.menu_item_id
        ) THEN
            RAISE EXCEPTION 'Guest et menu_item doivent appartenir au même événement';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ajouter triggers de validation
DROP TRIGGER IF EXISTS validate_table_assignment_consistency ON table_assignments;
CREATE TRIGGER validate_table_assignment_consistency 
    BEFORE INSERT OR UPDATE ON table_assignments 
    FOR EACH ROW 
    EXECUTE FUNCTION validate_guest_event_consistency();

DROP TRIGGER IF EXISTS validate_guest_menu_consistency ON guest_menu_preferences;
CREATE TRIGGER validate_guest_menu_consistency 
    BEFORE INSERT OR UPDATE ON guest_menu_preferences 
    FOR EACH ROW 
    EXECUTE FUNCTION validate_guest_event_consistency();

-- ============================================================================
-- 3. MIGRATION des familles orphelines
-- ============================================================================
DO $$
DECLARE
    orphan_family RECORD;
    default_event_id UUID;
BEGIN
    -- Trouver ou créer un événement par défaut pour les familles orphelines
    SELECT id INTO default_event_id 
    FROM events 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- Si aucun événement n'existe, en créer un temporaire
    IF default_event_id IS NULL THEN
        INSERT INTO events (title, description, date, organizer_id, is_active)
        SELECT 'Événement Migration', 'Événement temporaire pour migration', NOW() + INTERVAL '1 year', 
               id, false
        FROM users 
        LIMIT 1
        RETURNING id INTO default_event_id;
        
        RAISE NOTICE 'Événement temporaire créé avec ID: %', default_event_id;
    END IF;
    
    -- Lier les familles orphelines à l'événement par défaut
    UPDATE families 
    SET event_id = default_event_id 
    WHERE event_id IS NULL;
    
    GET DIAGNOSTICS orphan_family.name = ROW_COUNT;
    RAISE NOTICE 'Migré % familles orphelines vers événement %', orphan_family.name, default_event_id;
END $$;

-- ============================================================================
-- 4. CONTRAINTES NOT NULL après migration
-- ============================================================================
-- Maintenant que toutes les familles ont un event_id, rendre la colonne obligatoire
ALTER TABLE families ALTER COLUMN event_id SET NOT NULL;

-- Ajouter une contrainte unique pour éviter les doublons de noms par événement
ALTER TABLE families 
ADD CONSTRAINT families_unique_name_per_event 
UNIQUE (event_id, name);

-- ============================================================================
-- 5. VUE complète de l'isolation par événement
-- ============================================================================
CREATE OR REPLACE VIEW event_isolation_check AS
SELECT 
    e.id as event_id,
    e.title as event_title,
    e.organizer_id,
    u.name as organizer_name,
    COUNT(DISTINCT g.id) as guest_count,
    COUNT(DISTINCT f.id) as family_count,
    COUNT(DISTINCT st.id) as table_count,
    COUNT(DISTINCT em.id) as menu_count,
    COUNT(DISTINCT mi.id) as menu_item_count,
    COUNT(DISTINCT ta.id) as table_assignment_count,
    COUNT(DISTINCT gmp.id) as menu_preference_count,
    -- Vérifications de cohérence
    COUNT(DISTINCT CASE WHEN g.event_id != e.id THEN g.id END) as inconsistent_guests,
    COUNT(DISTINCT CASE WHEN f.event_id != e.id THEN f.id END) as inconsistent_families,
    COUNT(DISTINCT CASE WHEN st.event_id != e.id THEN st.id END) as inconsistent_tables
FROM events e
JOIN users u ON e.organizer_id = u.id
LEFT JOIN guests g ON e.id = g.event_id
LEFT JOIN families f ON e.id = f.event_id  
LEFT JOIN seating_tables st ON e.id = st.event_id
LEFT JOIN event_menus em ON e.id = em.event_id
LEFT JOIN menu_items mi ON e.id = mi.event_id
LEFT JOIN table_assignments ta ON st.id = ta.table_id
LEFT JOIN guest_menu_preferences gmp ON g.id = gmp.guest_id
GROUP BY e.id, e.title, e.organizer_id, u.name
ORDER BY e.created_at DESC;

-- ============================================================================
-- 6. FONCTIONS d'aide pour maintenance
-- ============================================================================

-- Fonction pour nettoyer un événement et toutes ses données liées
CREATE OR REPLACE FUNCTION delete_event_cascade(p_event_id UUID)
RETURNS TABLE(deleted_table TEXT, deleted_count BIGINT) AS $$
DECLARE
    result_record RECORD;
BEGIN
    -- Les suppressions se feront automatiquement via CASCADE
    -- Mais on peut auditer ce qui sera supprimé
    
    RETURN QUERY
    SELECT 'guest_menu_preferences'::TEXT, COUNT(*)
    FROM guest_menu_preferences 
    WHERE event_id = p_event_id;
    
    RETURN QUERY  
    SELECT 'table_assignments'::TEXT, COUNT(*)
    FROM table_assignments ta
    JOIN seating_tables st ON ta.table_id = st.id
    WHERE st.event_id = p_event_id;
    
    RETURN QUERY
    SELECT 'menu_items'::TEXT, COUNT(*)
    FROM menu_items 
    WHERE event_id = p_event_id;
    
    RETURN QUERY
    SELECT 'event_menus'::TEXT, COUNT(*)
    FROM event_menus 
    WHERE event_id = p_event_id;
    
    RETURN QUERY
    SELECT 'seating_tables'::TEXT, COUNT(*)
    FROM seating_tables 
    WHERE event_id = p_event_id;
    
    RETURN QUERY
    SELECT 'families'::TEXT, COUNT(*)
    FROM families 
    WHERE event_id = p_event_id;
    
    RETURN QUERY
    SELECT 'guests'::TEXT, COUNT(*)
    FROM guests 
    WHERE event_id = p_event_id;
    
    -- Effectuer la suppression
    DELETE FROM events WHERE id = p_event_id;
    
    RETURN QUERY
    SELECT 'events'::TEXT, 1::BIGINT;
    
END;
$$ LANGUAGE plpgsql;

-- Fonction pour vérifier l'intégrité des données d'un événement
CREATE OR REPLACE FUNCTION validate_event_integrity(p_event_id UUID)
RETURNS TABLE(check_name TEXT, is_valid BOOLEAN, error_message TEXT) AS $$
BEGIN
    -- Vérifier que tous les guests ont le bon event_id
    RETURN QUERY
    SELECT 
        'guests_event_id_consistency'::TEXT,
        COUNT(*) = 0,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE COUNT(*)::TEXT || ' guests avec event_id incorrect' END
    FROM guests 
    WHERE id IN (
        SELECT g.id FROM guests g 
        JOIN table_assignments ta ON g.id = ta.guest_id 
        JOIN seating_tables st ON ta.table_id = st.id 
        WHERE st.event_id = p_event_id AND g.event_id != p_event_id
    );
    
    -- Vérifier cohérence des préférences menu
    RETURN QUERY
    SELECT 
        'menu_preferences_consistency'::TEXT,
        COUNT(*) = 0,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE COUNT(*)::TEXT || ' préférences menu incohérentes' END
    FROM guest_menu_preferences gmp
    JOIN guests g ON gmp.guest_id = g.id
    WHERE gmp.event_id = p_event_id AND g.event_id != p_event_id;
    
    -- Vérifier que les familles appartiennent au bon événement
    RETURN QUERY
    SELECT 
        'families_event_consistency'::TEXT,
        COUNT(*) = 0,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE COUNT(*)::TEXT || ' familles mal liées' END
    FROM families 
    WHERE event_id = p_event_id AND user_id NOT IN (
        SELECT organizer_id FROM events WHERE id = p_event_id
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. MISE À JOUR des politiques RLS pour families  
-- ============================================================================
ALTER TABLE families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS families_access_policy ON families;
CREATE POLICY families_access_policy ON families
    USING (
        event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid()) OR
        user_id = auth.uid()
    );

-- ============================================================================
-- 8. REFRESH des vues matérialisées
-- ============================================================================
REFRESH MATERIALIZED VIEW CONCURRENTLY event_menu_stats;

-- ============================================================================
-- 9. COMMENTAIRES de documentation
-- ============================================================================
COMMENT ON CONSTRAINT families_unique_name_per_event ON families 
IS 'Évite les doublons de noms de famille par événement';

COMMENT ON VIEW event_isolation_check 
IS 'Vue complète pour vérifier l''isolation des données par événement';

COMMENT ON FUNCTION validate_event_integrity(UUID) 
IS 'Valide l''intégrité référentielle des données d''un événement';

COMMENT ON FUNCTION delete_event_cascade(UUID) 
IS 'Supprime un événement et audite toutes les données liées supprimées';

-- ============================================================================
-- 10. LOG de fin de migration
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 025 terminée - Isolation par événement renforcée';
    RAISE NOTICE 'ℹ️  Utilisez SELECT * FROM event_isolation_check; pour vérifier l''état';
    RAISE NOTICE 'ℹ️  Utilisez SELECT * FROM validate_event_integrity(''uuid''); pour valider un événement';
END $$;