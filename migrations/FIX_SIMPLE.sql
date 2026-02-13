-- Migration simplifiée et sécurisée
-- Ajoute les colonnes partner1_name et partner2_name

-- Ajouter partner1_name si elle n'existe pas
ALTER TABLE events ADD COLUMN IF NOT EXISTS partner1_name VARCHAR(100);

-- Ajouter partner2_name si elle n'existe pas
ALTER TABLE events ADD COLUMN IF NOT EXISTS partner2_name VARCHAR(100);

-- Créer les index si ils n'existent pas
CREATE INDEX IF NOT EXISTS idx_events_partner1_name ON events(partner1_name);
CREATE INDEX IF NOT EXISTS idx_events_partner2_name ON events(partner2_name);

-- Afficher confirmation
SELECT
  'Migration terminée!' as status,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'events'
AND column_name IN ('partner1_name', 'partner2_name')
ORDER BY column_name;
