-- Migration: Ajout des tables pour le système de jeux (version simplifiée)
-- Date: 2026-02-05

-- Créer la fonction update_updated_at_column si elle n'existe pas
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Table des jeux
CREATE TABLE IF NOT EXISTS games (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('quiz', 'puzzle', 'shoe_game', 'photo_scavenger', 'blind_test', 'twelve_months', 'memory', 'trivia')),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    description TEXT,
    settings JSONB DEFAULT '{}',
    total_questions INTEGER DEFAULT 0,
    players_count INTEGER DEFAULT 0,
    avg_score DECIMAL(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des questions pour les jeux
CREATE TABLE IF NOT EXISTS game_questions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    question TEXT NOT NULL,
    question_type VARCHAR(50) DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'photo', 'boolean', 'ordering')),
    options JSONB,
    correct_answer TEXT,
    points INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    media_url TEXT,
    time_limit INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des participations aux jeux
CREATE TABLE IF NOT EXISTS game_participations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    total_score INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    total_answers INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    UNIQUE(game_id, guest_id)
);

-- Table des réponses aux questions
CREATE TABLE IF NOT EXISTS game_answers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    participation_id UUID REFERENCES game_participations(id) ON DELETE CASCADE NOT NULL,
    question_id UUID REFERENCES game_questions(id) ON DELETE CASCADE NOT NULL,
    answer TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    points_earned INTEGER DEFAULT 0,
    answered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(participation_id, question_id)
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_games_event ON games(event_id);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(type);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_game_questions_game ON game_questions(game_id);
CREATE INDEX IF NOT EXISTS idx_game_questions_sort ON game_questions(game_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_game_participations_game ON game_participations(game_id);
CREATE INDEX IF NOT EXISTS idx_game_participations_guest ON game_participations(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_participation ON game_answers(participation_id);

-- Trigger pour mettre à jour updated_at sur games
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour mettre à jour updated_at sur game_questions
DROP TRIGGER IF EXISTS update_game_questions_updated_at ON game_questions;
CREATE TRIGGER update_game_questions_updated_at BEFORE UPDATE ON game_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
