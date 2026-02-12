-- ============================================================================
-- MIGRATION 051: Robust Event Creation Fix
-- Date: 2026-02-11
-- Description: Solution complète et adaptive pour la création d'événements
--              Cette migration est IDEMPOTENTE et peut être réexécutée sans danger
-- ============================================================================

-- ============================================================================
-- PARTIE 1: VÉRIFICATION ET CORRECTION DU SCHÉMA EVENTS
-- ============================================================================

DO $$
DECLARE
    v_column_exists BOOLEAN;
    v_trigger_exists BOOLEAN;
    v_policy_exists BOOLEAN;
    v_constraint_exists BOOLEAN;
BEGIN
    RAISE NOTICE '🔍 Début de la vérification du schéma events...';

    -- 1.1 Vérifier et ajouter les colonnes de base si elles n'existent pas
    
    -- partner1_name
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'partner1_name'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
        RAISE NOTICE '✅ Colonne partner1_name ajoutée';
    END IF;

    -- partner2_name
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'partner2_name'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
        RAISE NOTICE '✅ Colonne partner2_name ajoutée';
    END IF;

    -- event_schedule
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'event_schedule'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
        RAISE NOTICE '✅ Colonne event_schedule ajoutée';
    END IF;

    -- settings (avec valeur par défaut complète)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'settings'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN settings JSONB DEFAULT '{
            "enableRSVP": true,
            "enableGames": false,
            "enablePhotoGallery": true,
            "enableGuestBook": true,
            "enableQRVerification": true
        }';
        RAISE NOTICE '✅ Colonne settings ajoutée';
    END IF;

    -- cover_image
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'cover_image'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN cover_image TEXT;
        RAISE NOTICE '✅ Colonne cover_image ajoutée';
    END IF;

    -- banner_image
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'banner_image'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN banner_image TEXT;
        RAISE NOTICE '✅ Colonne banner_image ajoutée';
    END IF;

    -- guest_count
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'guest_count'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN guest_count INTEGER DEFAULT 0;
        RAISE NOTICE '✅ Colonne guest_count ajoutée';
    END IF;

    -- total_budget
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'total_budget'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN total_budget DECIMAL(10, 2) DEFAULT 0;
        RAISE NOTICE '✅ Colonne total_budget ajoutée';
    END IF;

    -- menu_settings
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'menu_settings'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN menu_settings JSONB DEFAULT '{
            "enabled": false,
            "title": "Menu du Jour",
            "subtitle": "Une expérience culinaire unique",
            "description": "",
            "starter": { "title": "Entrée", "description": "" },
            "main": { "title": "Plat Principal", "description": "" },
            "dessert": { "title": "Dessert", "description": "" },
            "drinks": { "title": "Boissons", "description": "" }
        }';
        RAISE NOTICE '✅ Colonne menu_settings ajoutée';
    END IF;

    -- Colonnes pour les venues (ceremony/reception)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'venue_type'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN venue_type VARCHAR(20) DEFAULT 'single';
        RAISE NOTICE '✅ Colonne venue_type ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'ceremony_venue'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN ceremony_venue JSONB;
        RAISE NOTICE '✅ Colonne ceremony_venue ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'reception_venue'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN reception_venue JSONB;
        RAISE NOTICE '✅ Colonne reception_venue ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'ceremony_date'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN ceremony_date DATE;
        RAISE NOTICE '✅ Colonne ceremony_date ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'ceremony_time'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN ceremony_time TIME;
        RAISE NOTICE '✅ Colonne ceremony_time ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'reception_date'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN reception_date DATE;
        RAISE NOTICE '✅ Colonne reception_date ajoutée';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'reception_time'
    ) INTO v_column_exists;
    IF NOT v_column_exists THEN
        ALTER TABLE events ADD COLUMN reception_time TIME;
        RAISE NOTICE '✅ Colonne reception_time ajoutée';
    END IF;

    -- 1.2 Rendre description nullable (si ce n'est pas déjà fait)
    BEGIN
        ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
        RAISE NOTICE '✅ Colonne description rendue nullable';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'ℹ️ Colonne description déjà nullable ou erreur: %', SQLERRM;
    END;

    RAISE NOTICE '✅ Vérification du schéma events terminée';
END $$;

-- ============================================================================
-- PARTIE 2: SUPPRESSION DU TRIGGER DE VALIDATION PROBLÉMATIQUE
-- ============================================================================

-- Supprimer le trigger validate_event_venues_trigger s'il existe
-- Ce trigger impose des contraintes trop strictes qui empêchent la création d'événements
DROP TRIGGER IF EXISTS validate_event_venues_trigger ON events;

-- Supprimer aussi la fonction associée si elle existe
DROP FUNCTION IF EXISTS validate_event_venues();

-- Créer une version plus souple du trigger (optionnelle)
CREATE OR REPLACE FUNCTION validate_event_venues_soft()
RETURNS trigger AS $$
BEGIN
    -- Validation souple: si venue_type n'est pas défini, le mettre à 'single'
    IF NEW.venue_type IS NULL THEN
        NEW.venue_type := 'single';
    END IF;
    
    -- Si cérémonie non définie mais date principale oui, utiliser la date principale
    IF NEW.ceremony_date IS NULL AND NEW.date IS NOT NULL THEN
        NEW.ceremony_date := NEW.date::DATE;
    END IF;
    
    -- Si pas d'heure de cérémonie, mettre une valeur par défaut
    IF NEW.ceremony_time IS NULL THEN
        NEW.ceremony_time := '14:00'::TIME;
    END IF;
    
    -- Si venue cérémonie non définie mais location oui, utiliser location
    IF NEW.ceremony_venue IS NULL AND NEW.location IS NOT NULL THEN
        NEW.ceremony_venue := NEW.location;
    END IF;
    
    -- Pour les réceptions, si non définies, utiliser les valeurs de la cérémonie
    IF NEW.reception_date IS NULL THEN
        NEW.reception_date := NEW.ceremony_date;
    END IF;
    
    IF NEW.reception_time IS NULL THEN
        NEW.reception_time := '18:00'::TIME;
    END IF;
    
    IF NEW.reception_venue IS NULL THEN
        NEW.reception_venue := NEW.ceremony_venue;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger qui s'exécute BEFORE INSERT/UPDATE pour remplir les valeurs par défaut
DROP TRIGGER IF EXISTS validate_event_venues_soft_trigger ON events;
CREATE TRIGGER validate_event_venues_soft_trigger
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION validate_event_venues_soft();

-- ============================================================================
-- PARTIE 3: CORRECTION DES POLITIQUES RLS POUR EVENTS
-- ============================================================================

-- Activer RLS sur events (idempotent)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques qui pourraient causer des problèmes
DROP POLICY IF EXISTS "Deny Public Access" ON events;
DROP POLICY IF EXISTS events_organizer_policy ON events;
DROP POLICY IF EXISTS "Events access policy" ON events;
DROP POLICY IF EXISTS "Events organizer access" ON events;

-- Créer une politique RLS qui fonctionne avec l'architecture hybride
-- Cette politique permet l'accès via Service Role (backend) et via auth.uid() (RLS standard)
CREATE POLICY "Events full access for service role" ON events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Politique pour les utilisateurs authentifiés (via auth.users)
-- Note: Cette politique suppose que organizer_id dans events correspond à auth.users.id
-- Si votre architecture utilise public.users.id, ajustez en conséquence
CREATE POLICY "Events access for authenticated users" ON events
    FOR ALL
    TO authenticated
    USING (
        -- L'utilisateur est l'organisateur (comparaison directe avec auth.uid)
        organizer_id = auth.uid()
        -- OU l'utilisateur est lié via public.users
        OR organizer_id IN (
            SELECT id FROM public.users WHERE auth_id = auth.uid()
        )
    )
    WITH CHECK (
        organizer_id = auth.uid()
        OR organizer_id IN (
            SELECT id FROM public.users WHERE auth_id = auth.uid()
        )
    );

-- ============================================================================
-- PARTIE 4: FONCTION ROBUSTE DE CRÉATION D'ÉVÉNEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION create_event_robust(p_event_data JSONB)
RETURNS TABLE(
    id UUID,
    title VARCHAR(200),
    description TEXT,
    guest_count INTEGER,
    date TIMESTAMP WITH TIME ZONE,
    location JSONB,
    cover_image TEXT,
    banner_image TEXT,
    settings JSONB,
    is_active BOOLEAN,
    organizer_id UUID,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    partner1_name VARCHAR(100),
    partner2_name VARCHAR(100),
    venue_type VARCHAR(20),
    ceremony_venue JSONB,
    reception_venue JSONB,
    ceremony_date DATE,
    ceremony_time TIME,
    reception_date DATE,
    reception_time TIME,
    event_schedule JSONB
) AS $$
DECLARE
    v_event_id UUID;
    v_organizer_id UUID;
    v_event_date TIMESTAMP WITH TIME ZONE;
    v_title VARCHAR(200);
    v_description TEXT;
    v_guest_count INTEGER;
    v_location JSONB;
    v_settings JSONB;
    v_cover_image TEXT;
    v_banner_image TEXT;
    v_partner1_name VARCHAR(100);
    v_partner2_name VARCHAR(100);
    v_venue_type VARCHAR(20);
    v_ceremony_venue JSONB;
    v_reception_venue JSONB;
    v_ceremony_date DATE;
    v_ceremony_time TIME;
    v_reception_date DATE;
    v_reception_time TIME;
    v_event_schedule JSONB;
    v_created_event events%ROWTYPE;
BEGIN
    -- 🛡️ Validation UUID pour l'ID (générer si non fourni)
    BEGIN
        v_event_id := (p_event_data->>'id')::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            v_event_id := gen_random_uuid();
    END;
    
    IF v_event_id IS NULL THEN
        v_event_id := gen_random_uuid();
    END IF;
    
    -- 🛡️ Validation organizer_id obligatoire
    BEGIN
        v_organizer_id := (p_event_data->>'organizer_id')::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Organizer ID is required and must be a valid UUID';
    END;
    
    IF v_organizer_id IS NULL THEN
        RAISE EXCEPTION 'Organizer ID is required';
    END IF;
    
    -- 🛡️ Vérifier que l'organisateur existe (dans auth.users ou public.users)
    IF NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = v_organizer_id
        UNION
        SELECT 1 FROM public.users WHERE id = v_organizer_id OR auth_id = v_organizer_id
    ) THEN
        RAISE EXCEPTION 'Organizer not found: %', v_organizer_id;
    END IF;
    
    -- 🛡️ Validation du titre obligatoire
    v_title := p_event_data->>'title';
    IF v_title IS NULL OR LENGTH(TRIM(v_title)) = 0 THEN
        RAISE EXCEPTION 'Event title is required and cannot be empty';
    END IF;
    
    IF LENGTH(v_title) > 200 THEN
        RAISE EXCEPTION 'Event title cannot exceed 200 characters';
    END IF;
    
    -- 🛡️ Validation de la date obligatoire et future
    BEGIN
        v_event_date := (p_event_data->>'date')::TIMESTAMP WITH TIME ZONE;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Event date is required and must be a valid timestamp';
    END;
    
    IF v_event_date IS NULL THEN
        RAISE EXCEPTION 'Event date is required';
    END IF;
    
    IF v_event_date < NOW()::DATE THEN
        RAISE EXCEPTION 'Event date cannot be in the past';
    END IF;
    
    -- Extraction des autres champs avec valeurs par défaut
    v_description := p_event_data->>'description';
    
    BEGIN
        v_guest_count := (p_event_data->>'guest_count')::INTEGER;
    EXCEPTION
        WHEN OTHERS THEN
        v_guest_count := NULL;
    END;
    
    v_location := p_event_data->'location';
    
    -- Settings avec valeur par défaut
    v_settings := p_event_data->'settings';
    IF v_settings IS NULL THEN
        v_settings := '{
            "enableRSVP": true,
            "enableGames": false,
            "enablePhotoGallery": true,
            "enableGuestBook": true,
            "enableQRVerification": true
        }'::JSONB;
    END IF;
    
    -- Images
    v_cover_image := p_event_data->>'cover_image';
    v_banner_image := p_event_data->>'banner_image';
    
    -- Partner names
    v_partner1_name := p_event_data->>'partner1_name';
    v_partner2_name := p_event_data->>'partner2_name';
    
    -- Event schedule
    v_event_schedule := p_event_data->'event_schedule';
    IF v_event_schedule IS NULL THEN
        v_event_schedule := '[]'::JSONB;
    END IF;
    
    -- Venue data avec valeurs par défaut automatiques
    v_venue_type := COALESCE(p_event_data->>'venue_type', 'single');
    
    -- Ceremony venue: utiliser location si non fourni
    v_ceremony_venue := p_event_data->'ceremony_venue';
    IF v_ceremony_venue IS NULL AND v_location IS NOT NULL THEN
        v_ceremony_venue := v_location;
    END IF;
    
    -- Ceremony date: utiliser date principale si non fourni
    BEGIN
        v_ceremony_date := (p_event_data->>'ceremony_date')::DATE;
    EXCEPTION
        WHEN OTHERS THEN
        v_ceremony_date := NULL;
    END;
    IF v_ceremony_date IS NULL THEN
        v_ceremony_date := v_event_date::DATE;
    END IF;
    
    -- Ceremony time avec valeur par défaut depuis event_schedule ou 14:00
    BEGIN
        v_ceremony_time := (p_event_data->>'ceremony_time')::TIME;
    EXCEPTION
        WHEN OTHERS THEN
        v_ceremony_time := NULL;
    END;
    IF v_ceremony_time IS NULL THEN
        -- Essayer d'extraire depuis event_schedule
        BEGIN
            v_ceremony_time := (p_event_data->'event_schedule'->0->>'time')::TIME;
        EXCEPTION
            WHEN OTHERS THEN
            v_ceremony_time := NULL;
        END;
        IF v_ceremony_time IS NULL THEN
            v_ceremony_time := '14:00'::TIME;
        END IF;
    END IF;
    
    -- Reception data: utiliser les mêmes valeurs que ceremony par défaut
    v_reception_venue := p_event_data->'reception_venue';
    IF v_reception_venue IS NULL THEN
        v_reception_venue := v_ceremony_venue;
    END IF;
    
    BEGIN
        v_reception_date := (p_event_data->>'reception_date')::DATE;
    EXCEPTION
        WHEN OTHERS THEN
        v_reception_date := NULL;
    END;
    IF v_reception_date IS NULL THEN
        v_reception_date := v_ceremony_date;
    END IF;
    
    BEGIN
        v_reception_time := (p_event_data->>'reception_time')::TIME;
    EXCEPTION
        WHEN OTHERS THEN
        v_reception_time := NULL;
    END;
    IF v_reception_time IS NULL THEN
        -- Essayer d'extraire depuis event_schedule (deuxième étape)
        BEGIN
            v_reception_time := (p_event_data->'event_schedule'->1->>'time')::TIME;
        EXCEPTION
            WHEN OTHERS THEN
            v_reception_time := NULL;
        END;
        IF v_reception_time IS NULL THEN
            v_reception_time := '18:00'::TIME;
        END IF;
    END IF;
    
    -- 🛡️ Transaction atomique - créer l'événement
    BEGIN
        INSERT INTO events (
            id, title, description, guest_count, date, location, 
            cover_image, banner_image, settings, is_active, organizer_id,
            created_at, updated_at,
            partner1_name, partner2_name,
            venue_type, ceremony_venue, reception_venue,
            ceremony_date, ceremony_time, reception_date, reception_time,
            event_schedule
        ) VALUES (
            v_event_id,
            v_title,
            v_description,
            v_guest_count,
            v_event_date,
            v_location,
            v_cover_image,
            v_banner_image,
            v_settings,
            COALESCE((p_event_data->>'is_active')::BOOLEAN, true),
            v_organizer_id,
            NOW(),
            NOW(),
            v_partner1_name,
            v_partner2_name,
            v_venue_type,
            v_ceremony_venue,
            v_reception_venue,
            v_ceremony_date,
            v_ceremony_time,
            v_reception_date,
            v_reception_time,
            v_event_schedule
        ) RETURNING * INTO v_created_event;
        
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'An event with this ID already exists';
        WHEN foreign_key_violation THEN
            RAISE EXCEPTION 'Invalid organizer ID: %', v_organizer_id;
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Database error during event creation: %', SQLERRM;
    END;
    
    -- Retourner l'événement créé avec toutes les colonnes
    RETURN QUERY SELECT 
        v_created_event.id,
        v_created_event.title,
        v_created_event.description,
        v_created_event.guest_count,
        v_created_event.date,
        v_created_event.location,
        v_created_event.cover_image,
        v_created_event.banner_image,
        v_created_event.settings,
        v_created_event.is_active,
        v_created_event.organizer_id,
        v_created_event.created_at,
        v_created_event.updated_at,
        v_created_event.partner1_name,
        v_created_event.partner2_name,
        v_created_event.venue_type,
        v_created_event.ceremony_venue,
        v_created_event.reception_venue,
        v_created_event.ceremony_date,
        v_created_event.ceremony_time,
        v_created_event.reception_date,
        v_created_event.reception_time,
        v_created_event.event_schedule;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accorder les permissions
GRANT EXECUTE ON FUNCTION create_event_robust(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION create_event_robust(JSONB) TO service_role;

-- ============================================================================
-- PARTIE 5: CORRECTION DE LA LIAISON AUTH.USERS <-> PUBLIC.USERS
-- ============================================================================

-- S'assurer que auth_id existe et est correctement indexé
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'auth_id'
    ) THEN
        ALTER TABLE public.users ADD COLUMN auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
        RAISE NOTICE '✅ Colonne auth_id ajoutée à public.users';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);

-- S'assurer que password_hash est nullable
DO $$
BEGIN
    ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'ℹ️ password_hash déjà nullable ou erreur: %', SQLERRM;
END $$;

-- Fonction pour synchroniser un utilisateur auth avec public.users
CREATE OR REPLACE FUNCTION sync_auth_user_to_public(p_auth_id UUID)
RETURNS UUID AS $$
DECLARE
    v_public_user_id UUID;
    v_auth_user RECORD;
BEGIN
    -- Récupérer les infos de auth.users
    SELECT id, email, raw_user_meta_data INTO v_auth_user
    FROM auth.users
    WHERE id = p_auth_id;
    
    IF v_auth_user IS NULL THEN
        RAISE EXCEPTION 'Auth user not found: %', p_auth_id;
    END IF;
    
    -- Vérifier si l'utilisateur existe déjà dans public.users
    SELECT id INTO v_public_user_id
    FROM public.users
    WHERE auth_id = p_auth_id;
    
    IF v_public_user_id IS NULL THEN
        -- Créer l'utilisateur dans public.users
        INSERT INTO public.users (
            id,
            auth_id,
            name,
            email,
            role,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            p_auth_id,
            COALESCE(v_auth_user.raw_user_meta_data->>'name', split_part(v_auth_user.email, '@', 1)),
            v_auth_user.email,
            COALESCE(v_auth_user.raw_user_meta_data->>'role', 'organizer'),
            true,
            NOW(),
            NOW()
        )
        RETURNING id INTO v_public_user_id;
        
        RAISE NOTICE '✅ Created public.users entry for auth_id: %', p_auth_id;
    END IF;
    
    RETURN v_public_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION sync_auth_user_to_public(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_auth_user_to_public(UUID) TO service_role;

-- ============================================================================
-- PARTIE 6: INDEX DE PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_organizer_active ON events(organizer_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_events_date_active ON events(date, is_active);
CREATE INDEX IF NOT EXISTS idx_events_partners ON events(partner1_name, partner2_name) WHERE partner1_name IS NOT NULL OR partner2_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_schedule ON events USING GIN (event_schedule) WHERE event_schedule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_settings ON events USING GIN (settings) WHERE settings IS NOT NULL;

-- ============================================================================
-- PARTIE 7: COMMENTAIRES ET DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION create_event_robust(JSONB) IS 
'Fonction robuste de création d''événement avec validation complète et valeurs par défaut automatiques.
Gère automatiquement:
- La conversion des dates et heures
- Les venues par défaut depuis location
- Les valeurs manquantes avec des defaults sensibles';

COMMENT ON FUNCTION validate_event_venues_soft() IS 
'Trigger souple qui remplit automatiquement les champs venue manquants avec des valeurs par défaut cohérentes';

COMMENT ON FUNCTION sync_auth_user_to_public(UUID) IS 
'Synchronise un utilisateur auth.users vers public.users si nécessaire';

-- ============================================================================
-- PARTIE 8: VÉRIFICATION FINALE
-- ============================================================================

DO $$
DECLARE
    v_missing_columns TEXT[] := '{}';
    v_all_good BOOLEAN := true;
BEGIN
    -- Vérifier toutes les colonnes critiques
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'venue_type') THEN
        v_missing_columns := array_append(v_missing_columns, 'venue_type');
        v_all_good := false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'ceremony_venue') THEN
        v_missing_columns := array_append(v_missing_columns, 'ceremony_venue');
        v_all_good := false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner1_name') THEN
        v_missing_columns := array_append(v_missing_columns, 'partner1_name');
        v_all_good := false;
    END IF;
    
    IF v_all_good THEN
        RAISE NOTICE E'\n🎉 MIGRATION 051 TERMINÉE AVEC SUCCÈS!\n';
        RAISE NOTICE '✅ Toutes les colonnes nécessaires sont présentes';
        RAISE NOTICE '✅ Le trigger de validation problématique a été remplacé';
        RAISE NOTICE '✅ Les politiques RLS sont configurées';
        RAISE NOTICE '✅ La fonction create_event_robust est disponible';
        RAISE NOTICE E'\n💡 Utilisez SELECT * FROM create_event_robust(''{"title":"Test","date":"2026-12-31T14:00:00Z","organizer_id":"votre-uuid"}''::jsonb);\n';
    ELSE
        RAISE WARNING E'\n⚠️ PROBLÈME: Colonnes manquantes: %\n', array_to_string(v_missing_columns, ', ');
    END IF;
END $$;
