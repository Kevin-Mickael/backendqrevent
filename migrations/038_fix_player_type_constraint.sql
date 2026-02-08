-- Migration: Correction de la contrainte CHECK sur player_type
-- Date: 2026-02-08
-- Description: Permet la valeur 'public' pour player_type dans game_participations

-- Supprimer l'ancienne contrainte CHECK
ALTER TABLE game_participations 
DROP CONSTRAINT IF EXISTS game_participations_player_type_check;

-- Ajouter la nouvelle contrainte avec 'public' inclus
ALTER TABLE game_participations 
ADD CONSTRAINT game_participations_player_type_check 
CHECK (player_type IN ('individual', 'family', 'public'));

-- Commentaire
COMMENT ON COLUMN game_participations.player_type IS 'Type de joueur: individual, family, ou public';
