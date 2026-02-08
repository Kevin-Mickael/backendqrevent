-- Migration: Ajout de la colonne rank à game_participations
-- Date: 2026-02-08
-- Description: Nécessaire pour le classement des joueurs

-- Ajouter la colonne rank si elle n'existe pas
ALTER TABLE game_participations 
ADD COLUMN IF NOT EXISTS rank INTEGER;

-- Index pour améliorer les performances des requêtes de classement
CREATE INDEX IF NOT EXISTS idx_game_participations_rank 
ON game_participations(game_id, rank);

-- Commentaire
COMMENT ON COLUMN game_participations.rank IS 'Classement du joueur dans ce jeu (1 = premier)';
