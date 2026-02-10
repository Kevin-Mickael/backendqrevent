-- ============================================================================
-- CORRECTION DU SCHÉMA DE LA TABLE EVENTS
-- Date: 2026-02-10
-- Description: Ajoute les colonnes manquantes pour la création d'événements
-- ============================================================================

-- Ajouter les colonnes modernes pour les partenaires
DO $$
BEGIN
    -- Ajouter partner1_name et partner2_name (plus générique que bride/groom)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner1_name') THEN
        ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
        RAISE NOTICE 'Colonne partner1_name ajoutée à la table events';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner2_name') THEN
        ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
        RAISE NOTICE 'Colonne partner2_name ajoutée à la table events';
    END IF;
    
    -- Ajouter event_schedule pour le programme détaillé
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'event_schedule') THEN
        ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
        RAISE NOTICE 'Colonne event_schedule ajoutée à la table events';
    END IF;
    
    -- Ajouter settings pour les paramètres d'événement
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'settings') THEN
        ALTER TABLE events ADD COLUMN settings JSONB DEFAULT '{
            "enableRSVP": true,
            "enableGames": false,
            "enablePhotoGallery": true,
            "enableGuestBook": true,
            "enableQRVerification": true
        }';
        RAISE NOTICE 'Colonne settings ajoutée à la table events';
    END IF;
    
    -- Ajouter cover_image et banner_image
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'cover_image') THEN
        ALTER TABLE events ADD COLUMN cover_image TEXT;
        RAISE NOTICE 'Colonne cover_image ajoutée à la table events';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'banner_image') THEN
        ALTER TABLE events ADD COLUMN banner_image TEXT;
        RAISE NOTICE 'Colonne banner_image ajoutée à la table events';
    END IF;
END $$;

-- Migrer les données existantes de bride_name/groom_name vers partner1_name/partner2_name
UPDATE events 
SET partner1_name = groom_name,
    partner2_name = bride_name
WHERE (partner1_name IS NULL AND groom_name IS NOT NULL) 
   OR (partner2_name IS NULL AND bride_name IS NOT NULL);

-- Créer des index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_events_partners ON events(partner1_name, partner2_name) WHERE partner1_name IS NOT NULL OR partner2_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_schedule ON events USING GIN (event_schedule) WHERE event_schedule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_settings ON events USING GIN (settings) WHERE settings IS NOT NULL;

-- Ajouter un commentaire pour documenter la structure
COMMENT ON COLUMN events.partner1_name IS 'Nom du premier partenaire (plus générique que groom_name)';
COMMENT ON COLUMN events.partner2_name IS 'Nom du second partenaire (plus générique que bride_name)';
COMMENT ON COLUMN events.event_schedule IS 'Programme détaillé de l''événement en format JSON';
COMMENT ON COLUMN events.settings IS 'Paramètres et configurations de l''événement en format JSON';
COMMENT ON COLUMN events.cover_image IS 'URL de l''image de couverture de l''événement';
COMMENT ON COLUMN events.banner_image IS 'URL de l''image de bannière de l''événement';

-- Vérification finale
DO $$
DECLARE
    missing_columns TEXT[] := '{}';
BEGIN
    -- Vérifier que toutes les colonnes nécessaires existent
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner1_name') THEN
        missing_columns := array_append(missing_columns, 'partner1_name');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner2_name') THEN
        missing_columns := array_append(missing_columns, 'partner2_name');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'event_schedule') THEN
        missing_columns := array_append(missing_columns, 'event_schedule');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'settings') THEN
        missing_columns := array_append(missing_columns, 'settings');
    END IF;
    
    IF array_length(missing_columns, 1) > 0 THEN
        RAISE EXCEPTION 'Migration échouée. Colonnes manquantes: %', array_to_string(missing_columns, ', ');
    ELSE
        RAISE NOTICE 'Migration 048_fix_events_schema.sql complétée avec succès !';
    END IF;
END $$;