-- Migration: Ajout du support pour l'accès public aux jeux (via QR code)
-- Date: 2026-02-08
-- Description: Permet l'accès aux jeux sans invité spécifique (liens publics)

-- Rendre guest_id nullable dans game_guest_access
ALTER TABLE game_guest_access 
ALTER COLUMN guest_id DROP NOT NULL;

-- Ajouter colonne is_public
ALTER TABLE game_guest_access 
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Supprimer l'ancienne contrainte d'unicité si elle existe
ALTER TABLE game_guest_access 
DROP CONSTRAINT IF EXISTS game_guest_access_game_id_guest_id_key;

-- Supprimer l'index unique s'il existe
DROP INDEX IF EXISTS idx_game_guest_access_unique;

-- Index pour les accès publics
CREATE INDEX IF NOT EXISTS idx_game_guest_access_public 
ON game_guest_access (game_id, is_public) 
WHERE is_public = TRUE;

-- Index pour accès par token
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token 
ON game_guest_access (access_token);

COMMENT ON COLUMN game_guest_access.is_public IS 'Indique si cet accès est public (QR code partagé)';
COMMENT ON COLUMN game_guest_access.guest_id IS 'ID de l''invité (NULL pour accès public)';
