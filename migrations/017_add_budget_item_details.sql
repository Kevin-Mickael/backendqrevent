-- Migration: Ajout de la table budget_item_details pour les détails de dépenses
-- Date: 2026-02-07
-- Description: Table pour stocker les détails d'un item de budget (lieu, prix, notes sous forme de tableau)

-- Créer la table budget_item_details
CREATE TABLE IF NOT EXISTS budget_item_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    
    -- Informations du détail
    location VARCHAR(255),           -- Lieu (ex: "Salle des fêtes Le Palace")
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,  -- Prix de ce détail
    notes TEXT,                      -- Notes spécifiques à ce détail
    
    -- Métadonnées
    sort_order INTEGER DEFAULT 0,    -- Ordre d'affichage
    is_active BOOLEAN DEFAULT true,  -- Actif ou non
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Créer les index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_budget_item_details_budget_item_id ON budget_item_details(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_budget_item_details_sort_order ON budget_item_details(sort_order);

-- Créer la fonction pour mettre à jour le timestamp updated_at
CREATE OR REPLACE FUNCTION update_budget_item_details_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour mettre à jour automatiquement updated_at
DROP TRIGGER IF EXISTS update_budget_item_details_updated_at ON budget_item_details;
CREATE TRIGGER update_budget_item_details_updated_at
    BEFORE UPDATE ON budget_item_details
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_item_details_updated_at();

-- Activer RLS (Row Level Security)
ALTER TABLE budget_item_details ENABLE ROW LEVEL SECURITY;

-- Créer la politique pour permettre aux utilisateurs de voir uniquement leurs propres détails
-- (via une sous-requête sur budget_items)
DROP POLICY IF EXISTS budget_item_details_select_policy ON budget_item_details;
CREATE POLICY budget_item_details_select_policy ON budget_item_details
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM budget_items 
            WHERE budget_items.id = budget_item_details.budget_item_id 
            AND budget_items.user_id = auth.uid()
        )
    );

-- Créer la politique pour permettre aux utilisateurs d'insérer leurs propres détails
DROP POLICY IF EXISTS budget_item_details_insert_policy ON budget_item_details;
CREATE POLICY budget_item_details_insert_policy ON budget_item_details
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM budget_items 
            WHERE budget_items.id = budget_item_details.budget_item_id 
            AND budget_items.user_id = auth.uid()
        )
    );

-- Créer la politique pour permettre aux utilisateurs de modifier leurs propres détails
DROP POLICY IF EXISTS budget_item_details_update_policy ON budget_item_details;
CREATE POLICY budget_item_details_update_policy ON budget_item_details
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM budget_items 
            WHERE budget_items.id = budget_item_details.budget_item_id 
            AND budget_items.user_id = auth.uid()
        )
    );

-- Créer la politique pour permettre aux utilisateurs de supprimer leurs propres détails
DROP POLICY IF EXISTS budget_item_details_delete_policy ON budget_item_details;
CREATE POLICY budget_item_details_delete_policy ON budget_item_details
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM budget_items 
            WHERE budget_items.id = budget_item_details.budget_item_id 
            AND budget_items.user_id = auth.uid()
        )
    );

-- Commentaire sur la table
COMMENT ON TABLE budget_item_details IS 'Détails des items de budget (lieu, prix, notes sous forme de tableau)';
COMMENT ON COLUMN budget_item_details.location IS 'Lieu ou endroit concerné par ce détail';
COMMENT ON COLUMN budget_item_details.price IS 'Prix spécifique à ce détail';
COMMENT ON COLUMN budget_item_details.notes IS 'Notes additionnelles pour ce détail';
COMMENT ON COLUMN budget_item_details.sort_order IS 'Ordre d''affichage dans le tableau';
