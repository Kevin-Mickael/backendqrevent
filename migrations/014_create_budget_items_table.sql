-- Migration: Création de la table budget_items pour la gestion des dépenses et devis
-- Date: 2026-02-06
-- Description: Table pour suivre les dépenses du mariage avec catégories, fournisseurs, statuts de paiement

-- Créer l'enum pour les catégories de budget
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'budget_category') THEN
        CREATE TYPE budget_category AS ENUM (
            'venue',          -- Lieu de réception
            'catering',       -- Traiteur
            'photography',    -- Photographe/Vidéaste
            'music',          -- Musique/DJ
            'flowers',        -- Fleurs/Décoration
            'attire',         -- Tenue/Mariée/Marié
            'transport',      -- Transport
            'accommodation',  -- Hébergement
            'invitations',    -- Faire-part
            'jewelry',        -- Bijoux/Alliances
            'beauty',         -- Coiffure/Maquillage
            'wedding_party',  -- Enterrement de vie de garçon/fille
            'gifts',          -- Cadeaux invités
            'other'           -- Autre
        );
    END IF;
END $$;

-- Créer l'enum pour le statut de paiement
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM (
            'pending',     -- En attente
            'partial',     -- Paiement partiel
            'paid',        -- Payé
            'cancelled'    -- Annulé
        );
    END IF;
END $$;

-- Créer la table budget_items
CREATE TABLE IF NOT EXISTS budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Informations de base
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category budget_category DEFAULT 'other',
    
    -- Informations financières
    estimated_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    actual_amount DECIMAL(12, 2) DEFAULT 0,
    paid_amount DECIMAL(12, 2) DEFAULT 0,
    
    -- Informations fournisseur
    vendor_name VARCHAR(200),
    vendor_contact VARCHAR(255),
    vendor_email VARCHAR(255),
    vendor_phone VARCHAR(50),
    
    -- Statut et dates
    payment_status payment_status DEFAULT 'pending',
    due_date DATE,
    payment_date DATE,
    
    -- Notes et pièces jointes
    notes TEXT,
    attachment_url TEXT,
    
    -- Métadonnées
    is_essential BOOLEAN DEFAULT false,
    is_paid_by_partner1 BOOLEAN DEFAULT true,
    is_paid_by_partner2 BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Créer les index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_budget_items_event_id ON budget_items(event_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_user_id ON budget_items(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_category ON budget_items(category);
CREATE INDEX IF NOT EXISTS idx_budget_items_payment_status ON budget_items(payment_status);
CREATE INDEX IF NOT EXISTS idx_budget_items_due_date ON budget_items(due_date);

-- Créer la fonction pour mettre à jour le timestamp updated_at
CREATE OR REPLACE FUNCTION update_budget_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour mettre à jour automatiquement updated_at
DROP TRIGGER IF EXISTS update_budget_items_updated_at ON budget_items;
CREATE TRIGGER update_budget_items_updated_at
    BEFORE UPDATE ON budget_items
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_items_updated_at();

-- Activer RLS (Row Level Security)
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

-- Créer la politique pour permettre aux utilisateurs de voir uniquement leurs propres items
DROP POLICY IF EXISTS budget_items_select_policy ON budget_items;
CREATE POLICY budget_items_select_policy ON budget_items
    FOR SELECT USING (user_id = auth.uid());

-- Créer la politique pour permettre aux utilisateurs d'insérer leurs propres items
DROP POLICY IF EXISTS budget_items_insert_policy ON budget_items;
CREATE POLICY budget_items_insert_policy ON budget_items
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Créer la politique pour permettre aux utilisateurs de modifier leurs propres items
DROP POLICY IF EXISTS budget_items_update_policy ON budget_items;
CREATE POLICY budget_items_update_policy ON budget_items
    FOR UPDATE USING (user_id = auth.uid());

-- Créer la politique pour permettre aux utilisateurs de supprimer leurs propres items
DROP POLICY IF EXISTS budget_items_delete_policy ON budget_items;
CREATE POLICY budget_items_delete_policy ON budget_items
    FOR DELETE USING (user_id = auth.uid());

-- Commentaire sur la table
COMMENT ON TABLE budget_items IS 'Table de gestion des dépenses et devis du mariage';
COMMENT ON COLUMN budget_items.estimated_amount IS 'Montant estimé/dévisé';
COMMENT ON COLUMN budget_items.actual_amount IS 'Montant final/facturé';
COMMENT ON COLUMN budget_items.paid_amount IS 'Montant déjà payé';
COMMENT ON COLUMN budget_items.is_essential IS 'Indique si cette dépense est essentielle';
COMMENT ON COLUMN budget_items.is_paid_by_partner1 IS 'Payé par le premier conjoint';
COMMENT ON COLUMN budget_items.is_paid_by_partner2 IS 'Payé par le deuxième conjoint';
