-- Migration 018: Création des tables pour la messagerie
-- Cette migration crée les tables nécessaires pour les conversations entre organisateurs et invités

-- Table des conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
    family_id UUID REFERENCES families(id) ON DELETE SET NULL,
    organizer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(200),
    is_active BOOLEAN DEFAULT TRUE,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Une conversation doit être liée à un invité OU une famille
    CONSTRAINT conversation_participant_check CHECK (
        (guest_id IS NOT NULL) OR (family_id IS NOT NULL)
    )
);

-- Table des messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('organizer', 'guest', 'system')),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    attachments JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table pour les pièces jointes des messages (optionnel, pour stockage métadonnées)
CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_conversations_event ON conversations(event_id);
CREATE INDEX IF NOT EXISTS idx_conversations_guest ON conversations(guest_id);
CREATE INDEX IF NOT EXISTS idx_conversations_family ON conversations(family_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_organizer ON conversations(organizer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(is_read) WHERE is_read = FALSE;

-- Trigger pour mettre à jour updated_at
CREATE TRIGGER update_conversations_updated_at 
    BEFORE UPDATE ON conversations 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at 
    BEFORE UPDATE ON messages 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Vue pour obtenir les conversations avec le dernier message et le nombre de messages non lus
CREATE OR REPLACE VIEW conversation_summary AS
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
        WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_type = 'guest'
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

-- Commentaire sur la migration
COMMENT ON TABLE conversations IS 'Table des conversations entre organisateurs et invités/familles';
COMMENT ON TABLE messages IS 'Table des messages dans les conversations';
