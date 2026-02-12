-- Migration: Création de la table pour les brouillons auto-sauvegardés
-- Permet de sauvegarder automatiquement les données des formulaires

CREATE TABLE IF NOT EXISTS form_drafts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    form_type VARCHAR(50) NOT NULL, -- 'event_create', 'event_edit', 'profile', etc.
    form_id VARCHAR(100), -- ID spécifique (ex: event_id pour edit)
    draft_data JSONB NOT NULL, -- Données du formulaire
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days'
);

-- Index pour des recherches rapides
CREATE INDEX IF NOT EXISTS idx_form_drafts_user_id ON form_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_form_drafts_form_type ON form_drafts(form_type);
CREATE INDEX IF NOT EXISTS idx_form_drafts_user_form ON form_drafts(user_id, form_type, form_id);
CREATE INDEX IF NOT EXISTS idx_form_drafts_expires ON form_drafts(expires_at);

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_draft_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.expires_at = NOW() + INTERVAL '7 days';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_draft_timestamp ON form_drafts;
CREATE TRIGGER trigger_update_draft_timestamp
    BEFORE UPDATE ON form_drafts
    FOR EACH ROW
    EXECUTE FUNCTION update_draft_timestamp();

-- Fonction pour nettoyer les vieux brouillons
CREATE OR REPLACE FUNCTION cleanup_expired_drafts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM form_drafts
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Commentaire sur la table
COMMENT ON TABLE form_drafts IS 'Stocke les brouillons auto-sauvegardés des formulaires pour persistance des données utilisateur';

-- Log de création (uniquement si la table audit_logs existe)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        INSERT INTO audit_logs (user_id, action, resource_type, details, severity)
        VALUES (NULL, 'draft_system_created', 'system', 
                jsonb_build_object('migration', '050_create_drafts_table', 'table', 'form_drafts'),
                'info');
    END IF;
END $$;
