-- Migration: Ajout du suivi des IP pour sécuriser les jeux
-- Date: 2026-02-08
-- Description: Empêche une même IP de jouer plusieurs fois

-- Table pour tracker les IP qui ont joué
CREATE TABLE IF NOT EXISTS game_ip_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    ip_address VARCHAR(45) NOT NULL,  -- Support IPv4 et IPv6
    user_agent TEXT,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    score INTEGER DEFAULT 0,
    player_name VARCHAR(100),
    UNIQUE(game_id, ip_address)  -- Une IP ne peut jouer qu'une fois par jeu
);

-- Index pour recherche rapide par IP
CREATE INDEX IF NOT EXISTS idx_game_ip_tracking_game_ip 
ON game_ip_tracking(game_id, ip_address);

-- Index pour recherche par IP seule (sécurité)
CREATE INDEX IF NOT EXISTS idx_game_ip_tracking_ip 
ON game_ip_tracking(ip_address);

COMMENT ON TABLE game_ip_tracking IS 'Suit les adresses IP qui ont joué à chaque jeu pour éviter les fraudes';
