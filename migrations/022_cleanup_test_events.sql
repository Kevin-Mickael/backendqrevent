-- Migration: Nettoyer les événements de test
-- Date: 2026-02-07
-- ⚠️ À utiliser avec précaution - supprime tous les événements marqués comme test

-- Option 1: Supprimer les événements avec "test" dans le titre (insensible à la casse)
-- DELETE FROM events 
-- WHERE LOWER(title) LIKE '%test%' 
--    OR LOWER(title) LIKE '%démonstration%'
--    OR LOWER(title) LIKE '%demo%'
--    OR LOWER(title) LIKE '%exemple%'
--    OR LOWER(title) LIKE '%example%';

-- Option 2: Soft delete des événements de test (recommandé)
UPDATE events 
SET is_active = false,
    updated_at = NOW()
WHERE LOWER(title) LIKE '%test%' 
   OR LOWER(title) LIKE '%démonstration%'
   OR LOWER(title) LIKE '%demo%'
   OR LOWER(title) LIKE '%exemple%'
   OR LOWER(title) LIKE '%example%';

-- Option 3: Supprimer tous les événements sans organisateur valide
-- DELETE FROM events 
-- WHERE organizer_id NOT IN (SELECT id FROM users);

-- Vérification: Compter les événements actifs restants
-- SELECT COUNT(*) as active_events FROM events WHERE is_active = true;
