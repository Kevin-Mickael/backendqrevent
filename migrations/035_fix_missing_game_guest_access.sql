-- Migration: Création de la table game_guest_access si elle n'existe pas
-- Date: 2026-02-08
-- Description: Cette migration crée la table manquante pour l'accès aux jeux

-- =====================================================
-- 1. Table de liaison entre jeux et invités individuels
-- =====================================================
CREATE TABLE IF NOT EXISTS game_guest_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,  -- NULL pour accès public
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    is_public BOOLEAN DEFAULT FALSE,  -- TRUE pour accès public via QR code
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_game_guest_access_game ON game_guest_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_guest ON game_guest_access(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access(access_token);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_public ON game_guest_access (game_id, is_public) WHERE is_public = TRUE;

-- =====================================================
-- 2. Table de liaison entre jeux et familles
-- =====================================================
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

CREATE INDEX IF NOT EXISTS idx_game_family_access_game ON game_family_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_family ON game_family_access(family_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_token ON game_family_access(access_token);

-- =====================================================
-- 3. Ajout des colonnes à game_participations
-- =====================================================
ALTER TABLE game_participations 
ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS access_token VARCHAR(100),
ADD COLUMN IF NOT EXISTS player_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS player_type VARCHAR(20) DEFAULT 'individual' CHECK (player_type IN ('individual', 'family'));

CREATE INDEX IF NOT EXISTS idx_game_participations_family ON game_participations(family_id);
CREATE INDEX IF NOT EXISTS idx_game_participations_qr ON game_participations(qr_code);
CREATE INDEX IF NOT EXISTS idx_game_participations_token ON game_participations(access_token);
CREATE INDEX IF NOT EXISTS idx_game_participations_score ON game_participations(game_id, total_score DESC);

-- =====================================================
-- 4. Fonction pour générer un token d'accès unique
-- =====================================================
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

-- =====================================================
-- 5. Commentaires
-- =====================================================
COMMENT ON COLUMN game_guest_access.is_public IS 'Indique si cet accès est public (QR code partagé)';
COMMENT ON COLUMN game_guest_access.guest_id IS 'ID de l''invité (NULL pour accès public)';
