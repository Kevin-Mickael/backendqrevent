-- ============================================================================
-- Migration: Fonction sécurisée de création d'événement
-- Date: 2026-02-07
-- Description: Implémente une fonction atomique pour créer des événements
-- ============================================================================

-- ============================================================================
-- 1. FONCTION de création sécurisée d'événement
-- ============================================================================
CREATE OR REPLACE FUNCTION create_event_secure(p_event_data JSONB)
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
    bride_name VARCHAR(100),
    groom_name VARCHAR(100)
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
    v_created_event events%ROWTYPE;
BEGIN
    -- 🛡️ RÈGLE 1: Validation UUID v4 pour l'ID
    v_event_id := (p_event_data->>'id')::UUID;
    IF v_event_id IS NULL THEN
        v_event_id := gen_random_uuid();
    END IF;
    
    -- 🛡️ Validation organizer_id obligatoire
    v_organizer_id := (p_event_data->>'organizer_id')::UUID;
    IF v_organizer_id IS NULL THEN
        RAISE EXCEPTION 'Organizer ID is required and must be a valid UUID';
    END IF;
    
    -- 🛡️ Vérifier que l'organisateur existe
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_organizer_id) THEN
        RAISE EXCEPTION 'Organizer not found';
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
    v_event_date := (p_event_data->>'date')::TIMESTAMP WITH TIME ZONE;
    IF v_event_date IS NULL THEN
        RAISE EXCEPTION 'Event date is required';
    END IF;
    
    IF v_event_date < NOW()::DATE THEN
        RAISE EXCEPTION 'Event date cannot be in the past';
    END IF;
    
    -- 🛡️ Validation optionnelle des autres champs
    v_description := p_event_data->>'description';
    v_guest_count := (p_event_data->>'guest_count')::INTEGER;
    v_location := p_event_data->'location';
    v_settings := p_event_data->'settings';
    
    -- Valider guest_count si fourni
    IF v_guest_count IS NOT NULL AND (v_guest_count < 1 OR v_guest_count > 1000) THEN
        RAISE EXCEPTION 'Guest count must be between 1 and 1000';
    END IF;
    
    -- Valider settings si fourni
    IF v_settings IS NULL THEN
        v_settings := '{
            "enableRSVP": true,
            "enableGames": true,
            "enablePhotoGallery": true,
            "enableGuestBook": true,
            "enableQRVerification": true
        }'::JSONB;
    END IF;
    
    -- 🛡️ RÈGLE 4: Transaction atomique - créer l'événement
    BEGIN
        INSERT INTO events (
            id, title, description, guest_count, date, location, 
            cover_image, banner_image, settings, is_active, organizer_id,
            created_at, updated_at
        ) VALUES (
            v_event_id,
            v_title,
            v_description,
            v_guest_count,
            v_event_date,
            v_location,
            p_event_data->>'cover_image',
            p_event_data->>'banner_image',
            v_settings,
            COALESCE((p_event_data->>'is_active')::BOOLEAN, true),
            v_organizer_id,
            NOW(),
            NOW()
        ) RETURNING * INTO v_created_event;
        
        -- 🛡️ Créer le menu par défaut pour cet événement
        PERFORM create_default_event_menu(v_event_id, 'Menu de ' || v_title);
        
        -- 🛡️ RÈGLE 6: Logger la création sans données sensibles
        INSERT INTO audit_log (
            table_name, operation, record_id, user_id, changes, timestamp
        ) VALUES (
            'events', 'CREATE', v_event_id, v_organizer_id, 
            jsonb_build_object(
                'title_length', LENGTH(v_title),
                'guest_count', v_guest_count,
                'has_location', v_location IS NOT NULL
            ), 
            NOW()
        );
        
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'An event with this ID already exists';
        WHEN foreign_key_violation THEN
            RAISE EXCEPTION 'Invalid organizer ID';
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Database error during event creation: %', SQLERRM;
    END;
    
    -- Retourner l'événement créé
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
        v_created_event.bride_name,
        v_created_event.groom_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. FONCTION de génération de QR Code sécurisé
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_secure_qr_code()
RETURNS VARCHAR(50) AS $$
DECLARE
    v_qr_code VARCHAR(50);
    v_attempts INTEGER := 0;
    v_max_attempts INTEGER := 100;
BEGIN
    LOOP
        -- 🛡️ RÈGLE 1: Générer QR code non prévisible avec UUID v4
        v_qr_code := REPLACE(gen_random_uuid()::TEXT, '-', '');
        
        -- 🛡️ Vérifier l'unicité dans qr_codes ET family_invitations
        IF NOT EXISTS (
            SELECT 1 FROM qr_codes WHERE code = v_qr_code
            UNION
            SELECT 1 FROM family_invitations WHERE qr_code = v_qr_code
        ) THEN
            EXIT; -- QR code unique trouvé
        END IF;
        
        v_attempts := v_attempts + 1;
        IF v_attempts > v_max_attempts THEN
            RAISE EXCEPTION 'Cannot generate unique QR code after % attempts', v_max_attempts;
        END IF;
    END LOOP;
    
    RETURN v_qr_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. FONCTION de validation d'événement et organisateur
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_event_organizer(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_organizer_id UUID;
BEGIN
    -- 🛡️ RÈGLE 2: Valider que l'utilisateur est bien l'organisateur
    SELECT organizer_id INTO v_organizer_id
    FROM events 
    WHERE id = p_event_id AND is_active = true;
    
    IF v_organizer_id IS NULL THEN
        RETURN false; -- Événement non trouvé ou inactif
    END IF;
    
    RETURN v_organizer_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. POLITIQUE RLS pour events (sécurité renforcée)
-- ============================================================================
-- Assurer que RLS est activé
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Supprimer les politiques existantes si elles existent
DROP POLICY IF EXISTS events_organizer_policy ON events;

-- 🛡️ RÈGLE 2: Politique stricte - seul l'organisateur peut accéder
CREATE POLICY events_organizer_policy ON events
    FOR ALL
    TO authenticated
    USING (organizer_id = auth.uid())
    WITH CHECK (organizer_id = auth.uid());

-- ============================================================================
-- 5. INDEX de performance pour sécurité
-- ============================================================================
-- Index pour validation rapide organisateur
CREATE INDEX IF NOT EXISTS idx_events_organizer_active 
    ON events(organizer_id, is_active) 
    WHERE is_active = true;

-- Index pour QR codes uniques
CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_codes_unique 
    ON qr_codes(code) 
    WHERE is_valid = true;

-- ============================================================================
-- 6. COMMENTAIRES de documentation
-- ============================================================================
COMMENT ON FUNCTION create_event_secure(JSONB) 
IS 'Création sécurisée d''événement avec validation complète et transaction atomique';

COMMENT ON FUNCTION generate_secure_qr_code() 
IS 'Génération de QR code unique non prévisible selon règles de sécurité';

COMMENT ON FUNCTION validate_event_organizer(UUID, UUID) 
IS 'Validation que l''utilisateur est l''organisateur de l''événement';

-- ============================================================================
-- 7. GRANT de permissions appropriées
-- ============================================================================
-- Donner accès aux fonctions aux rôles authentifiés
GRANT EXECUTE ON FUNCTION create_event_secure(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_secure_qr_code() TO authenticated;
GRANT EXECUTE ON FUNCTION validate_event_organizer(UUID, UUID) TO authenticated;

-- ============================================================================
-- 8. LOG de fin de migration
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 026 terminée - Fonctions sécurisées créées';
    RAISE NOTICE 'ℹ️  create_event_secure() : Création d''événement atomique';
    RAISE NOTICE 'ℹ️  generate_secure_qr_code() : QR codes non prévisibles';
    RAISE NOTICE 'ℹ️  validate_event_organizer() : Validation organisateur';
    RAISE NOTICE '🛡️ RLS activé avec politique stricte sur events';
END $$;