-- ============================================================================
-- FINAL SCHEMA SYNCHRONIZATION
-- Date: 2026-02-07
-- Description: Synchronise le schéma final et optimise pour la scalabilité
-- ============================================================================

-- ============================================================================
-- 1. TABLE: users
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url') THEN
        ALTER TABLE users ADD COLUMN avatar_url TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferences') THEN
        ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
    END IF;
END $$;

-- ============================================================================
-- 2. TABLE: events
-- ============================================================================
DO $$
BEGIN
    -- Make description nullable
    ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'bride_name') THEN
        ALTER TABLE events ADD COLUMN bride_name VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'groom_name') THEN
        ALTER TABLE events ADD COLUMN groom_name VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'total_budget') THEN
        ALTER TABLE events ADD COLUMN total_budget DECIMAL(10, 2) DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'guest_count') THEN
        ALTER TABLE events ADD COLUMN guest_count INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'menu_settings') THEN
        ALTER TABLE events ADD COLUMN menu_settings JSONB DEFAULT '{
            "enabled": false,
            "title": "Menu du Jour",
            "subtitle": "Une expérience culinaire unique",
            "description": "",
            "starter": { "title": "Entrée", "description": "" },
            "main": { "title": "Plat Principal", "description": "" },
            "dessert": { "title": "Dessert", "description": "" },
            "drinks": { "title": "Boissons", "description": "" }
        }';
    END IF;
END $$;

-- Optimized indexes for events
CREATE INDEX IF NOT EXISTS idx_events_organizer_active ON events(organizer_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_events_date_active ON events(date, is_active);

-- ============================================================================
-- 3. TABLE: guests
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guests' AND column_name = 'is_active') THEN
        ALTER TABLE guests ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guests_event_rsvp ON guests(event_id, rsvp_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_event_attendance ON guests(event_id, attendance_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_qr_code ON guests(qr_code) WHERE qr_code IS NOT NULL;

-- ============================================================================
-- 4. TABLE: families
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'max_people') THEN
        ALTER TABLE families ADD COLUMN max_people INTEGER DEFAULT 1;
    END IF;
END $$;

-- ============================================================================
-- 5. TABLE: qr_codes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_qr_codes_code_valid ON qr_codes(code, is_valid) WHERE is_valid = true;
CREATE INDEX IF NOT EXISTS idx_qr_codes_event_valid ON qr_codes(event_id, is_valid);

-- ============================================================================
-- 6. TABLE: attendance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_attendance_event_status ON attendance(event_id, status);

-- BRIN index for time-series data (very efficient for large tables)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_timestamp_brin') THEN
        CREATE INDEX idx_attendance_timestamp_brin ON attendance USING BRIN (timestamp) 
        WITH (pages_per_range = 128);
    END IF;
END $$;

-- ============================================================================
-- 7. TABLE: budget_items
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'quantity') THEN
        ALTER TABLE budget_items ADD COLUMN quantity INTEGER DEFAULT 1;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'unit_price') THEN
        ALTER TABLE budget_items ADD COLUMN unit_price DECIMAL(10, 2);
    END IF;
    
    -- Recalculate totals (seulement si total_price existe)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'total_price') THEN
        UPDATE budget_items SET total_price = COALESCE(quantity, 1) * COALESCE(unit_price, total_price, 0) 
        WHERE quantity IS NOT NULL AND unit_price IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_items_event_category ON budget_items(event_id, category);

-- ============================================================================
-- 8. Update function for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================================
-- 9. Create triggers for all tables
-- ============================================================================
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY['users', 'events', 'guests', 'qr_codes', 'families', 'seating_tables', 
                           'budget_items', 'games', 'wishes', 'feedback', 'story_events'];
BEGIN
    FOREACH tbl IN ARRAY tables
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_' || tbl || '_updated_at') THEN
                EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
            END IF;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 10. Drop redundant indexes (keep composite ones)
-- ============================================================================
DROP INDEX IF EXISTS idx_events_organizer;

-- ============================================================================
-- 11. TABLES DE JEUX - Corrections complètes
-- ============================================================================

-- 11.1 Table game_participations - Ajout des colonnes manquantes
DO $$
BEGIN
    -- Ajouter family_id si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'family_id') THEN
        ALTER TABLE game_participations ADD COLUMN family_id UUID REFERENCES families(id) ON DELETE CASCADE;
    END IF;

    -- Ajouter qr_code si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'qr_code') THEN
        ALTER TABLE game_participations ADD COLUMN qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE SET NULL;
    END IF;

    -- Ajouter access_token si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'access_token') THEN
        ALTER TABLE game_participations ADD COLUMN access_token VARCHAR(100);
    END IF;

    -- Ajouter player_name si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'player_name') THEN
        ALTER TABLE game_participations ADD COLUMN player_name VARCHAR(100);
    END IF;

    -- Ajouter player_type si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'player_type') THEN
        ALTER TABLE game_participations ADD COLUMN player_type VARCHAR(20) DEFAULT 'individual';
    END IF;

    -- Ajouter rank si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_participations' AND column_name = 'rank') THEN
        ALTER TABLE game_participations ADD COLUMN rank INTEGER;
    END IF;

    -- Rendre guest_id nullable (pour l'accès public)
    ALTER TABLE game_participations ALTER COLUMN guest_id DROP NOT NULL;

    -- Supprimer l'ancienne contrainte CHECK sur player_type si elle existe
    ALTER TABLE game_participations DROP CONSTRAINT IF EXISTS game_participations_player_type_check;

    -- Ajouter la nouvelle contrainte CHECK avec 'public' inclus
    ALTER TABLE game_participations ADD CONSTRAINT game_participations_player_type_check 
    CHECK (player_type IN ('individual', 'family', 'public'));
END $$;

-- Index pour game_participations
CREATE INDEX IF NOT EXISTS idx_game_participations_family ON game_participations(family_id);
CREATE INDEX IF NOT EXISTS idx_game_participations_qr ON game_participations(qr_code);
CREATE INDEX IF NOT EXISTS idx_game_participations_token ON game_participations(access_token);
CREATE INDEX IF NOT EXISTS idx_game_participations_score ON game_participations(game_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_game_participations_rank ON game_participations(game_id, rank);

-- 11.2 Table game_guest_access (accès public et individuel)
CREATE TABLE IF NOT EXISTS game_guest_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour game_guest_access
CREATE INDEX IF NOT EXISTS idx_game_guest_access_game ON game_guest_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_guest ON game_guest_access(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access(access_token);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_public ON game_guest_access (game_id, is_public) WHERE is_public = TRUE;

-- Rendre guest_id nullable dans game_guest_access
ALTER TABLE game_guest_access ALTER COLUMN guest_id DROP NOT NULL;

-- 11.3 Table game_family_access (accès familles)
CREATE TABLE IF NOT EXISTS game_family_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(game_id, family_id)
);

-- Index pour game_family_access
CREATE INDEX IF NOT EXISTS idx_game_family_access_game ON game_family_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_family ON game_family_access(family_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_token ON game_family_access(access_token);

-- 11.4 Table game_ip_tracking (sécurité anti-fraude)
CREATE TABLE IF NOT EXISTS game_ip_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    score INTEGER DEFAULT 0,
    player_name VARCHAR(100),
    UNIQUE(game_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_game_ip_tracking_game_ip ON game_ip_tracking(game_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_game_ip_tracking_ip ON game_ip_tracking(ip_address);

-- 11.5 Fonction pour générer un token d'accès unique
CREATE OR REPLACE FUNCTION generate_access_token()
RETURNS VARCHAR(100) AS $$
DECLARE
    token VARCHAR(100);
    exists_check BOOLEAN;
BEGIN
    LOOP
        token := encode(gen_random_bytes(24), 'base64');
        SELECT EXISTS(
            SELECT 1 FROM game_family_access WHERE access_token = token
            UNION
            SELECT 1 FROM game_guest_access WHERE access_token = token
        ) INTO exists_check;
        
        EXIT WHEN NOT exists_check;
    END LOOP;
    
    RETURN token;
END;
$$ language 'plpgsql';

-- 11.6 Fonction et trigger pour mettre à jour le classement
CREATE OR REPLACE FUNCTION update_game_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
    -- Mettre à jour le classement pour toutes les participations du jeu
    WITH ranked AS (
        SELECT 
            id,
            ROW_NUMBER() OVER (ORDER BY total_score DESC, completed_at ASC) as new_rank
        FROM game_participations
        WHERE game_id = NEW.game_id AND is_completed = TRUE
    )
    UPDATE game_participations gp
    SET rank = r.new_rank
    FROM ranked r
    WHERE gp.id = r.id;
    
    -- Mettre à jour aussi les tables d'accès
    UPDATE game_family_access
    SET rank = subquery.new_rank,
        score = subquery.total_score
    FROM (
        SELECT 
            gfa.family_id,
            gp.total_score,
            RANK() OVER (ORDER BY gp.total_score DESC) as new_rank
        FROM game_family_access gfa
        JOIN game_participations gp ON gp.game_id = gfa.game_id AND gp.family_id = gfa.family_id
        WHERE gfa.game_id = NEW.game_id AND gp.is_completed = TRUE
    ) subquery
    WHERE game_family_access.game_id = NEW.game_id 
    AND game_family_access.family_id = subquery.family_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Supprimer et recréer le trigger
DROP TRIGGER IF EXISTS trigger_update_leaderboard ON game_participations;

CREATE TRIGGER trigger_update_leaderboard
AFTER INSERT OR UPDATE OF total_score, is_completed ON game_participations
FOR EACH ROW
WHEN (NEW.is_completed = TRUE)
EXECUTE FUNCTION update_game_leaderboard();

-- 11.7 Vue pour le classement global d'un jeu
CREATE OR REPLACE VIEW game_leaderboard AS
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
    gp.completed_at,
    gp.rank,
    gp.qr_code,
    g.name as game_name,
    g.type as game_type,
    CASE 
        WHEN gp.family_id IS NOT NULL THEN f.name
        ELSE CONCAT(gt.first_name, ' ', gt.last_name)
    END as player_display_name
FROM game_participations gp
JOIN games g ON gp.game_id = g.id
LEFT JOIN families f ON gp.family_id = f.id
LEFT JOIN guests gt ON gp.guest_id = gt.id
WHERE gp.is_completed = TRUE
ORDER BY gp.game_id, gp.rank;

-- 11.8 Trigger pour game_participations updated_at
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_game_participations_updated_at') THEN
        CREATE TRIGGER update_game_participations_updated_at BEFORE UPDATE ON game_participations 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- 11.9 Commentaires
COMMENT ON COLUMN game_participations.player_type IS 'Type de joueur: individual, family, ou public';
COMMENT ON COLUMN game_participations.guest_id IS 'ID de l''invité (NULL pour accès public)';
COMMENT ON COLUMN game_participations.family_id IS 'ID de la famille (NULL pour accès individuel ou public)';
COMMENT ON TABLE game_ip_tracking IS 'Suit les adresses IP qui ont joué à chaque jeu pour éviter les fraudes';
COMMENT ON COLUMN game_guest_access.is_public IS 'Indique si cet accès est public (QR code partagé)';
COMMENT ON COLUMN game_guest_access.guest_id IS 'ID de l''invité (NULL pour accès public)';
COMMENT ON VIEW game_leaderboard IS 'Vue pour afficher le classement global d''un jeu';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 
    'Schema Sync Complete' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') as total_indexes,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE 'update_%_updated_at') as auto_update_triggers,
    NOW() as executed_at;
