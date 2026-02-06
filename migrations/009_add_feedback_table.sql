-- Migration: Ajout de la table feedbacks pour les avis et témoignages
-- Date: 2026-02-05
-- Description: Création de la table pour stocker les avis/feedbacks des invités/familles

-- Table des avis et feedbacks
CREATE TABLE IF NOT EXISTS feedbacks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE SET NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
    
    -- Informations sur l'auteur
    author_name VARCHAR(100) NOT NULL,
    author_email VARCHAR(255),
    
    -- Contenu du feedback
    message TEXT NOT NULL,
    feedback_type VARCHAR(20) DEFAULT 'wish' CHECK (feedback_type IN ('wish', 'guestbook', 'testimonial')),
    
    -- Pour les avis avec notation (guestbook)
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    category VARCHAR(50), -- Ambiance, Déco, Service, etc.
    
    -- Tag/Accent pour l'affichage (wish)
    tag VARCHAR(50), -- Excellence, Célébration, Joie, Bonheur, etc.
    accent_color VARCHAR(20), -- Code couleur pour l'affichage
    
    -- Métadonnées
    is_approved BOOLEAN DEFAULT FALSE, -- Modération
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Source (qr_code, direct, etc.)
    source VARCHAR(50) DEFAULT 'direct',
    qr_code_used VARCHAR(50),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_feedbacks_event ON feedbacks(event_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_family ON feedbacks(family_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_guest ON feedbacks(guest_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_type ON feedbacks(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedbacks_approved ON feedbacks(event_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at DESC);

-- Trigger pour mettre à jour updated_at
CREATE TRIGGER update_feedbacks_updated_at 
BEFORE UPDATE ON feedbacks 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

-- Vue pour les statistiques de feedback par événement
CREATE OR REPLACE VIEW feedback_stats AS
SELECT 
    event_id,
    COUNT(*) as total_feedbacks,
    COUNT(*) FILTER (WHERE feedback_type = 'wish') as total_wishes,
    COUNT(*) FILTER (WHERE feedback_type = 'guestbook') as total_guestbook,
    COUNT(*) FILTER (WHERE is_approved = TRUE) as approved_count,
    COUNT(*) FILTER (WHERE is_approved = FALSE) as pending_count,
    AVG(rating) FILTER (WHERE rating IS NOT NULL) as average_rating,
    COUNT(*) FILTER (WHERE rating = 5) as five_star_count,
    MAX(created_at) as last_feedback_date
FROM feedbacks
WHERE is_active = TRUE
GROUP BY event_id;

-- Commentaire sur la table
COMMENT ON TABLE feedbacks IS 'Stocke les avis, vœux et témoignages des invités et familles';
COMMENT ON COLUMN feedbacks.feedback_type IS 'Type de feedback: wish (vœux), guestbook (livre d''or), testimonial (témoignage)';
COMMENT ON COLUMN feedbacks.is_approved IS 'Indique si le feedback a été approuvé par le modérateur';
