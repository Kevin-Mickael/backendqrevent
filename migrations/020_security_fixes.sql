-- Migration 020: Corrections de sécurité suite à audit
-- Applique les corrections pour les vulnérabilités trouvées

-- ============================================
-- 1. CONTRAINTE UNIQUE POUR ÉVITER LES RACE CONDITIONS
-- ============================================

-- Une seule conversation active par guest_id par événement
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_guest 
    ON conversations(event_id, guest_id) 
    WHERE guest_id IS NOT NULL AND is_active = TRUE;

-- Une seule conversation active par family_id par événement  
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_family
    ON conversations(event_id, family_id)
    WHERE family_id IS NOT NULL AND is_active = TRUE;

-- ============================================
-- 2. CORRECTION RLS - VÉRIFICATION NULL
-- ============================================

-- Supprimer les anciennes policies
DROP POLICY IF EXISTS conversations_select_own ON conversations;
DROP POLICY IF EXISTS conversations_insert_own ON conversations;
DROP POLICY IF EXISTS conversations_update_own ON conversations;
DROP POLICY IF EXISTS conversations_delete_own ON conversations;

-- Recréer avec vérification NULL
CREATE POLICY conversations_select_own ON conversations
    FOR SELECT
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND (
            organizer_id = current_setting('app.current_user_id', true)::UUID
            OR EXISTS (
                SELECT 1 FROM events e 
                WHERE e.id = conversations.event_id 
                AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
            )
        )
    );

CREATE POLICY conversations_insert_own ON conversations
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM events e 
            WHERE e.id = conversations.event_id 
            AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY conversations_update_own ON conversations
    FOR UPDATE
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND (
            organizer_id = current_setting('app.current_user_id', true)::UUID
            OR EXISTS (
                SELECT 1 FROM events e 
                WHERE e.id = conversations.event_id 
                AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
            )
        )
    );

CREATE POLICY conversations_delete_own ON conversations
    FOR DELETE
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND (
            organizer_id = current_setting('app.current_user_id', true)::UUID
            OR EXISTS (
                SELECT 1 FROM events e 
                WHERE e.id = conversations.event_id 
                AND e.organizer_id = current_setting('app.current_user_id', true)::UUID
            )
        )
    );

-- Même chose pour messages
DROP POLICY IF EXISTS messages_select_accessible ON messages;
DROP POLICY IF EXISTS messages_insert_accessible ON messages;
DROP POLICY IF EXISTS messages_update_accessible ON messages;

CREATE POLICY messages_select_accessible ON messages
    FOR SELECT
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM conversations c
            JOIN events e ON c.event_id = e.id
            WHERE c.id = messages.conversation_id
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

CREATE POLICY messages_insert_accessible ON messages
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND sender_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM conversations c
            JOIN events e ON c.event_id = e.id
            WHERE c.id = messages.conversation_id
            AND c.is_active = true
            AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                 OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
        )
    );

CREATE POLICY messages_update_accessible ON messages
    FOR UPDATE
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND (
            sender_id = current_setting('app.current_user_id', true)::UUID
            OR EXISTS (
                SELECT 1 FROM conversations c
                JOIN events e ON c.event_id = e.id
                WHERE c.id = messages.conversation_id
                AND (c.organizer_id = current_setting('app.current_user_id', true)::UUID
                     OR e.organizer_id = current_setting('app.current_user_id', true)::UUID)
            )
        )
    );

-- ============================================
-- 3. INDEX MANQUANTS POUR PERFORMANCES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_conversations_event_organizer 
    ON conversations(event_id, organizer_id) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_read 
    ON messages(conversation_id, sender_type, is_read) 
    WHERE sender_type = 'guest' AND is_read = FALSE;

-- Index pour la vérification d'appartenance guest/family
CREATE INDEX IF NOT EXISTS idx_guests_event_lookup 
    ON guests(id, event_id);

-- Note: families n'a pas de event_id direct, elle est liée via family_invitations
-- L'index sur family_invitations existe déjà dans la migration 007
-- CREATE INDEX IF NOT EXISTS idx_family_invitations_event ON family_invitations(event_id);

-- ============================================
-- 4. VUE SÉCURISÉE CORRIGÉE (AVEC FILTRAGE)
-- ============================================

DROP VIEW IF EXISTS conversation_summary_secure;

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
WHERE c.is_active = TRUE
-- 🔒 La vue est filtrée par RLS, pas besoin de filtre supplémentaire ici
;

-- ============================================
-- 5. FONCTION STATS SÉCURISÉE AVEC LIMITE
-- ============================================

CREATE OR REPLACE FUNCTION get_message_stats_secure(
    p_user_id UUID,
    p_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
    total_conversations BIGINT,
    total_messages BIGINT,
    unread_messages BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH user_events AS (
        SELECT e.id as evt_id
        FROM events e
        WHERE e.organizer_id = p_user_id
        AND (p_event_id IS NULL OR e.id = p_event_id)
        LIMIT 1000  -- 🔒 Protection DoS
    ),
    user_conversations AS (
        SELECT c.id as conv_id
        FROM conversations c
        WHERE c.event_id IN (SELECT evt_id FROM user_events)
        AND c.is_active = TRUE
        LIMIT 1000  -- 🔒 Protection DoS
    )
    SELECT 
        (SELECT COUNT(*) FROM user_conversations) as total_conversations,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id IN (SELECT conv_id FROM user_conversations)) as total_messages,
        (SELECT COUNT(*) FROM messages m 
         WHERE m.conversation_id IN (SELECT conv_id FROM user_conversations)
         AND m.is_read = FALSE AND m.sender_type = 'guest') as unread_messages;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. COMMENTAIRES
-- ============================================

COMMENT ON INDEX idx_unique_conversation_guest IS 'Contrainte implicite: un seul conversation par guest';
COMMENT ON INDEX idx_unique_conversation_family IS 'Contrainte implicite: un seul conversation par family';
COMMENT ON FUNCTION get_message_stats_secure IS 'Fonction sécurisée pour stats avec limites DoS';

-- Vérification
SELECT 'Migration 020 applied successfully' as status;
