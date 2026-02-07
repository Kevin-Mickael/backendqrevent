-- ============================================================================
-- Migration: Système de menu robuste lié aux événements
-- Date: 2026-02-07
-- Description: Crée un système de menu complet avec liaison aux événements
-- ============================================================================

-- ============================================================================
-- 1. TABLE: event_menus - Menu principal par événement
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_menus (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL DEFAULT 'Menu du Jour',
    subtitle VARCHAR(300) DEFAULT 'Une expérience culinaire unique',
    description TEXT,
    menu_type VARCHAR(50) DEFAULT 'wedding' CHECK (menu_type IN ('wedding', 'cocktail', 'buffet', 'sit_down')),
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Un seul menu actif par événement
    UNIQUE(event_id) DEFERRABLE INITIALLY DEFERRED
);

-- ============================================================================
-- 2. TABLE: menu_items - Plats du menu
-- ============================================================================
CREATE TABLE IF NOT EXISTS menu_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    menu_id UUID NOT NULL REFERENCES event_menus(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE, -- Redondance sécurisée
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN ('starter', 'main', 'dessert', 'drink', 'appetizer', 'side')),
    dietary_restrictions JSONB DEFAULT '[]', -- ["vegetarian", "vegan", "gluten-free", "dairy-free"]
    allergens JSONB DEFAULT '[]', -- ["gluten", "lactose", "nuts", "shellfish", "eggs"]
    price DECIMAL(8, 2), -- Prix optionnel
    calories INTEGER, -- Calories optionnelles
    is_optional BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    portion_size VARCHAR(100),
    preparation_time INTEGER, -- En minutes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. TABLE: guest_menu_preferences - Choix des invités
-- ============================================================================
CREATE TABLE IF NOT EXISTS guest_menu_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
    special_requests TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Un choix par invité par plat
    UNIQUE(guest_id, menu_item_id)
);

-- ============================================================================
-- 4. MISE À JOUR: Lier families aux événements
-- ============================================================================
DO $$
BEGIN
    -- Ajouter event_id à la table families si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'families' AND column_name = 'event_id') THEN
        ALTER TABLE families ADD COLUMN event_id UUID REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- 5. INDEXES pour performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_event_menus_event ON event_menus(event_id);
CREATE INDEX IF NOT EXISTS idx_event_menus_active ON event_menus(event_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_event ON menu_items(event_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(event_id, category);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(event_id, is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_menu_items_order ON menu_items(menu_id, display_order);

CREATE INDEX IF NOT EXISTS idx_guest_menu_prefs_guest ON guest_menu_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_menu_prefs_event ON guest_menu_preferences(event_id);
CREATE INDEX IF NOT EXISTS idx_guest_menu_prefs_item ON guest_menu_preferences(menu_item_id);

CREATE INDEX IF NOT EXISTS idx_families_event ON families(event_id) WHERE event_id IS NOT NULL;

-- ============================================================================
-- 6. TRIGGERS pour updated_at
-- ============================================================================
CREATE TRIGGER update_event_menus_updated_at 
    BEFORE UPDATE ON event_menus 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_menu_items_updated_at 
    BEFORE UPDATE ON menu_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guest_menu_preferences_updated_at 
    BEFORE UPDATE ON guest_menu_preferences 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. CONTRAINTES de cohérence
-- ============================================================================
-- Fonction pour vérifier la cohérence menu_item.event_id = menu.event_id
CREATE OR REPLACE FUNCTION check_menu_item_event_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.event_id != (SELECT event_id FROM event_menus WHERE id = NEW.menu_id) THEN
        RAISE EXCEPTION 'menu_item.event_id doit correspondre à event_menus.event_id';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_menu_item_consistency 
    BEFORE INSERT OR UPDATE ON menu_items 
    FOR EACH ROW 
    EXECUTE FUNCTION check_menu_item_event_consistency();

-- ============================================================================
-- 8. VUES matérialisées pour performance
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS event_menu_stats AS
SELECT 
    e.id as event_id,
    e.title as event_title,
    COUNT(DISTINCT em.id) as menu_count,
    COUNT(DISTINCT mi.id) as total_items,
    COUNT(DISTINCT CASE WHEN mi.category = 'starter' THEN mi.id END) as starter_count,
    COUNT(DISTINCT CASE WHEN mi.category = 'main' THEN mi.id END) as main_count,
    COUNT(DISTINCT CASE WHEN mi.category = 'dessert' THEN mi.id END) as dessert_count,
    COUNT(DISTINCT CASE WHEN mi.category = 'drink' THEN mi.id END) as drink_count,
    COUNT(DISTINCT gmp.guest_id) as guests_with_preferences,
    AVG(mi.price) as avg_price
FROM events e
LEFT JOIN event_menus em ON e.id = em.event_id AND em.is_active = true
LEFT JOIN menu_items mi ON em.id = mi.menu_id AND mi.is_available = true
LEFT JOIN guest_menu_preferences gmp ON mi.id = gmp.menu_item_id
GROUP BY e.id, e.title;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_menu_stats_event ON event_menu_stats(event_id);

-- ============================================================================
-- 9. FONCTIONS utilitaires
-- ============================================================================

-- Fonction pour créer un menu par défaut pour un événement
CREATE OR REPLACE FUNCTION create_default_event_menu(p_event_id UUID, p_title VARCHAR DEFAULT 'Menu du Jour')
RETURNS UUID AS $$
DECLARE
    menu_id UUID;
BEGIN
    INSERT INTO event_menus (event_id, title, is_active)
    VALUES (p_event_id, p_title, true)
    RETURNING id INTO menu_id;
    
    RETURN menu_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour dupliquer un menu d'un événement vers un autre
CREATE OR REPLACE FUNCTION duplicate_menu_to_event(p_source_event_id UUID, p_target_event_id UUID)
RETURNS UUID AS $$
DECLARE
    new_menu_id UUID;
    menu_record RECORD;
    item_record RECORD;
BEGIN
    -- Copier le menu principal
    SELECT * INTO menu_record 
    FROM event_menus 
    WHERE event_id = p_source_event_id AND is_active = true 
    LIMIT 1;
    
    IF menu_record IS NULL THEN
        RAISE EXCEPTION 'Aucun menu actif trouvé pour l''événement source';
    END IF;
    
    INSERT INTO event_menus (event_id, title, subtitle, description, menu_type, is_active)
    VALUES (p_target_event_id, menu_record.title, menu_record.subtitle, menu_record.description, menu_record.menu_type, true)
    RETURNING id INTO new_menu_id;
    
    -- Copier tous les plats
    FOR item_record IN 
        SELECT * FROM menu_items 
        WHERE menu_id = menu_record.id AND is_available = true
        ORDER BY display_order
    LOOP
        INSERT INTO menu_items (
            menu_id, event_id, name, description, category, 
            dietary_restrictions, allergens, price, calories,
            is_optional, is_available, display_order, portion_size, preparation_time
        ) VALUES (
            new_menu_id, p_target_event_id, item_record.name, item_record.description, item_record.category,
            item_record.dietary_restrictions, item_record.allergens, item_record.price, item_record.calories,
            item_record.is_optional, item_record.is_available, item_record.display_order, 
            item_record.portion_size, item_record.preparation_time
        );
    END LOOP;
    
    RETURN new_menu_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. POLITIQUE de sécurité RLS (Row Level Security)
-- ============================================================================
ALTER TABLE event_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_menu_preferences ENABLE ROW LEVEL SECURITY;

-- Politique pour event_menus : seul l'organisateur peut modifier
CREATE POLICY event_menus_organizer_policy ON event_menus
    USING (event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid()));

-- Politique pour menu_items : seul l'organisateur peut modifier
CREATE POLICY menu_items_organizer_policy ON menu_items
    USING (event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid()));

-- Politique pour guest_menu_preferences : invités et organisateurs
CREATE POLICY guest_menu_preferences_access_policy ON guest_menu_preferences
    USING (
        guest_id IN (SELECT id FROM guests WHERE email = auth.email()) OR
        event_id IN (SELECT id FROM events WHERE organizer_id = auth.uid())
    );

-- ============================================================================
-- 11. COMMENTAIRES pour documentation
-- ============================================================================
COMMENT ON TABLE event_menus IS 'Menus principaux liés aux événements avec un menu par événement';
COMMENT ON TABLE menu_items IS 'Plats et boissons des menus avec liaison forte aux événements';
COMMENT ON TABLE guest_menu_preferences IS 'Préférences et choix des invités pour les plats';
COMMENT ON COLUMN menu_items.event_id IS 'Liaison directe pour performance et cohérence (redondance sécurisée)';
COMMENT ON COLUMN families.event_id IS 'Liaison des familles aux événements pour isolation complète';

-- ============================================================================
-- 12. DONNÉES DE TEST (optionnel)
-- ============================================================================
-- Migrer les données existantes du menu React vers la DB si un événement existe
-- Note: À adapter selon vos besoins de migration de données