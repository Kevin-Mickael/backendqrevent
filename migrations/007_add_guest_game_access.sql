-- Migration: Ajout du système d'accès aux jeux pour les invités/familles
-- Date: 2026-02-05
-- Description: Permet aux familles et invités d'accéder aux jeux via QR code

-- Table de liaison entre jeux et familles (accès autorisé)
CREATE TABLE IF NOT EXISTS game_family_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL, -- Token unique pour accès direct
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER, -- Classement
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(game_id, family_id)
);

-- Table de liaison entre jeux et invités individuels
CREATE TABLE IF NOT EXISTS game_guest_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(game_id, guest_id)
);

-- Modifier la table game_participations pour lier à family/guest
ALTER TABLE game_participations 
ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS access_token VARCHAR(100),
ADD COLUMN IF NOT EXISTS player_name VARCHAR(100), -- Nom du joueur (pour affichage)
ADD COLUMN IF NOT EXISTS player_type VARCHAR(20) DEFAULT 'individual' CHECK (player_type IN ('individual', 'family'));

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_game_family_access_game ON game_family_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_family ON game_family_access(family_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_token ON game_family_access(access_token);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_game ON game_guest_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_guest ON game_guest_access(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access(access_token);
CREATE INDEX IF NOT EXISTS idx_game_participations_family ON game_participations(family_id);
CREATE INDEX IF NOT EXISTS idx_game_participations_qr ON game_participations(qr_code);
CREATE INDEX IF NOT EXISTS idx_game_participations_token ON game_participations(access_token);
CREATE INDEX IF NOT EXISTS idx_game_participations_score ON game_participations(game_id, total_score DESC);

-- Fonction pour générer un token d'accès unique
CREATE OR REPLACE FUNCTION generate_access_token()
RETURNS VARCHAR(100) AS $$
DECLARE
    token VARCHAR(100);
    exists_check BOOLEAN;
BEGIN
    LOOP
        -- Générer un token aléatoire de 32 caractères
        token := encode(gen_random_bytes(24), 'base64');
        -- Vérifier s'il existe déjà
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

-- Fonction pour mettre à jour le classement d'un jeu
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

-- Trigger pour mettre à jour le classement automatiquement
CREATE TRIGGER trigger_update_leaderboard
AFTER INSERT OR UPDATE OF total_score, is_completed ON game_participations
FOR EACH ROW
WHEN (NEW.is_completed = TRUE)
EXECUTE FUNCTION update_game_leaderboard();

-- Vue pour le classement global d'un jeu
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
