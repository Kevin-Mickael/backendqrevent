-- Migration: Rendre guest_id nullable dans game_participations
-- Date: 2026-02-08
-- Description: Permet les participations sans invité spécifique (accès public)

ALTER TABLE game_participations 
ALTER COLUMN guest_id DROP NOT NULL;

-- S'assurer que family_id est aussi nullable
ALTER TABLE game_participations 
ALTER COLUMN family_id DROP NOT NULL;

-- Commentaire
COMMENT ON COLUMN game_participations.guest_id IS 'ID de l''invité (NULL pour accès public)';
COMMENT ON COLUMN game_participations.family_id IS 'ID de la famille (NULL pour accès individuel ou public)';
