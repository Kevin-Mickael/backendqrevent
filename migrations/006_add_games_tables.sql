-- Migration: Ajout des tables pour le système de jeux
-- Date: 2026-02-05
-- Description: Création des tables games, game_questions, game_participations, game_scores

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
    options JSONB, -- Pour les questions à choix multiples: [{"text": "Option 1", "isCorrect": true}, ...]
    correct_answer TEXT, -- Réponse correcte pour les questions texte
    points INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    media_url TEXT, -- URL d'image ou vidéo associée à la question
    time_limit INTEGER, -- Temps limite en secondes (NULL = pas de limite)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des participations aux jeux (pour les invités)
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

-- Trigger pour mettre à jour updated_at
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_questions_updated_at BEFORE UPDATE ON game_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Fonction pour recalculer les statistiques d'un jeu
CREATE OR REPLACE FUNCTION update_game_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE games
    SET 
        players_count = (
            SELECT COUNT(DISTINCT guest_id) 
            FROM game_participations 
            WHERE game_id = COALESCE(NEW.game_id, OLD.game_id)
        ),
        avg_score = (
            SELECT COALESCE(AVG(total_score), 0)
            FROM game_participations 
            WHERE game_id = COALESCE(NEW.game_id, OLD.game_id) AND is_completed = TRUE
        ),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.game_id, OLD.game_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger pour mettre à jour les stats automatiquement
CREATE TRIGGER trigger_update_game_stats
AFTER INSERT OR UPDATE OR DELETE ON game_participations
FOR EACH ROW
EXECUTE FUNCTION update_game_stats();

-- Fonction pour mettre à jour le compteur de questions
CREATE OR REPLACE FUNCTION update_game_question_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE games SET total_questions = total_questions + 1 WHERE id = NEW.game_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE games SET total_questions = total_questions - 1 WHERE id = OLD.game_id;
        RETURN OLD;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger pour le compteur de questions
CREATE TRIGGER trigger_update_question_count
AFTER INSERT OR DELETE ON game_questions
FOR EACH ROW
EXECUTE FUNCTION update_game_question_count();
