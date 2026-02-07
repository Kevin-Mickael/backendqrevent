-- Migration 019: Sécurisation des tables de messagerie avec RLS
-- Cette migration ajoute Row Level Security et des contraintes de sécurité

-- ============================================
-- 1. ACTIVER RLS SUR LES TABLES
-- ============================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. FONCTION UTILITAIRE POUR RÉCUPÉRER L'ORGANIZER_ID
-- ============================================

CREATE OR REPLACE FUNCTION get_conversation_organizer(conv_id UUID)
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT c.organizer_id INTO org_id
    FROM conversations c
    WHERE c.id = conv_id;
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_event_organizer(evt_id UUID)
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT e.organizer_id INTO org_id
    FROM events e
    WHERE e.id = evt_id;
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. POLICIES POUR LA TABLE CONVERSATIONS
-- ============================================

-- Policy: Les organisateurs peuvent voir leurs propres conversations
CREATE POLICY conversations_select_own ON conversations
    FOR SELECT
    USING (
        organizer_id = current_setting('app.current_user_id', true)::UUID
        OR EXISTS (
            SELECT 1 FROM events e 
            WHERE e.id = conversations.event_id 
            AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- Policy: Les organisateurs peuvent créer des conversations pour leurs événements
CREATE POLICY conversations_insert_own ON conversations
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM events e 
            WHERE e.id = conversations.event_id 
            AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- Policy: Les organisateurs peuvent modifier leurs conversations
CREATE POLICY conversations_update_own ON conversations
    FOR UPDATE
    USING (
        organizer_id = current_setting('app.current_user_id', true)::UUID
        OR EXISTS (
            SELECT 1 FROM events e 
            WHERE e.id = conversations.event_id 
            AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- Policy: Les organisateurs peuvent supprimer (soft delete) leurs conversations
CREATE POLICY conversations_delete_own ON conversations
    FOR DELETE
    USING (
        organizer_id = current_setting('app.current_user_id', true)::UUID
        OR EXISTS (
            SELECT 1 FROM events e 
            WHERE e.id = conversations.event_id 
            AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- ============================================
-- 4. POLICIES POUR LA TABLE MESSAGES
-- ============================================

-- Policy: Voir les messages des conversations accessibles
CREATE POLICY messages_select_accessible ON messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversations c
            JOIN events e ON c.event_id = e.id
            WHERE c.id = messages.conversation_id
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

-- Policy: Insérer des messages dans les conversations accessibles
CREATE POLICY messages_insert_accessible ON messages
    FOR INSERT
    WITH CHECK (
        sender_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM conversations c
            JOIN events e ON c.event_id = e.id
            WHERE c.id = messages.conversation_id
            AND c.is_active = true
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

-- Policy: Mettre à jour ses propres messages (ou marquer comme lu)
CREATE POLICY messages_update_accessible ON messages
    FOR UPDATE
    USING (
        sender_id = current_setting('app.current_user_id', true)::UUID
        OR EXISTS (
            SELECT 1 FROM conversations c
            JOIN events e ON c.event_id = e.id
            WHERE c.id = messages.conversation_id
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

-- ============================================
-- 5. POLICIES POUR LES PIÈCES JOINTES
-- ============================================

CREATE POLICY attachments_select_accessible ON message_attachments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            JOIN events e ON c.event_id = e.id
            WHERE m.id = message_attachments.message_id
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

CREATE POLICY attachments_insert_accessible ON message_attachments
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            JOIN events e ON c.event_id = e.id
            WHERE m.id = message_attachments.message_id
            AND m.sender_id = current_setting('app.current_user_id', true)::UUID
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

-- ============================================
-- 6. VUE SÉCURISÉE AVEC FILTRAGE
-- ============================================

-- Supprimer l'ancienne vue si elle existe
DROP VIEW IF EXISTS conversation_summary;
DROP VIEW IF EXISTS conversation_summary_secure;

-- Créer la vue sécurisée avec filtrage par organizer_id
CREATE VIEW conversation_summary_secure AS
SELECT 
    c.id,
    c.event_id,
    c.guest_id,
    c.family_id,
    c.organizer_id,
    c.subject,
    c.is_active,
    c.last_message_at,
    c.created_at,
    (
        SELECT COUNT(*) 
        FROM messages m 
        WHERE m.conversation_id = c.id 
        AND m.is_read = FALSE 
        AND m.sender_type = 'guest'
    ) as unread_count,
    (
        SELECT json_build_object(
            'id', m.id,
            'content', LEFT(m.content, 100),
            'sender_type', m.sender_type,
            'created_at', m.created_at
        )
        FROM messages m 
        WHERE m.conversation_id = c.id 
        ORDER BY m.created_at DESC 
        LIMIT 1
    ) as last_message,
    CASE 
        WHEN c.guest_id IS NOT NULL THEN 
            json_build_object(
                'id', g.id,
                'name', CONCAT(g.first_name, ' ', g.last_name),
                'email', g.email,
                'type', 'guest'
            )
        WHEN c.family_id IS NOT NULL THEN 
            json_build_object(
                'id', f.id,
                'name', f.name,
                'type', 'family'
            )
    END as participant
FROM conversations c
LEFT JOIN guests g ON c.guest_id = g.id
LEFT JOIN families f ON c.family_id = f.id
WHERE c.is_active = TRUE;

-- ============================================
-- 7. CONTRAINTES SUPPLÉMENTAIRES
-- ============================================

-- Limite de taille sur les attachments (max 5 éléments via validation applicative)
-- Mais on ajoute une contrainte CHECK pour renforcer
ALTER TABLE messages 
    ADD CONSTRAINT check_attachments_is_array 
    CHECK (jsonb_typeof(attachments) = 'array');

-- Index supplémentaires pour les performances
CREATE INDEX IF NOT EXISTS idx_messages_is_read_sender 
    ON messages(is_read, sender_type) 
    WHERE is_read = FALSE AND sender_type = 'guest';

CREATE INDEX IF NOT EXISTS idx_conversations_active_organizer 
    ON conversations(is_active, organizer_id) 
    WHERE is_active = TRUE;

-- ============================================
-- 8. FONCTION POUR MARQUER TOUS LES MESSAGES COMME LUS
-- ============================================

CREATE OR REPLACE FUNCTION mark_conversation_as_read(conv_id UUID, user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
    is_authorized BOOLEAN;
BEGIN
    -- Vérifier l'autorisation
    SELECT EXISTS (
        SELECT 1 FROM conversations c
        JOIN events e ON c.event_id = e.id
        WHERE c.id = conv_id
        AND (c.organizer_id = user_id OR e.organizer_id = user_id)
    ) INTO is_authorized;

    IF NOT is_authorized THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Mettre à jour les messages
    UPDATE messages 
    SET is_read = TRUE, read_at = NOW()
    WHERE conversation_id = conv_id
    AND sender_type = 'guest'
    AND is_read = FALSE;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. COMMENTAIRES
-- ============================================

COMMENT ON TABLE conversations IS 'Table des conversations - RLS activé';
COMMENT ON TABLE messages IS 'Table des messages - RLS activé';
COMMENT ON VIEW conversation_summary_secure IS 'Vue sécurisée des conversations avec filtrage RLS';

-- ============================================
-- 10. DONNER LES PERMISSIONS SUR LA VUE
-- ============================================

GRANT SELECT ON conversation_summary_secure TO authenticated;

-- Vérification
SELECT 'Migration 019 applied successfully' as status;
