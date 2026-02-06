-- Migration: Ajout d'index de performance critiques
-- Date: 2026-02-05
-- Priorité: CRITIQUE
-- Description: Optimise les requêtes fréquentes pour la montée en charge

-- ============================================
-- 1. INDEX QR CODES - Validation rapide
-- ============================================
-- Problème: Requête findByCode avec is_valid + expires_at fait un seq scan
-- Impact: Chaque scan de QR (~1M/jour potentiel) est lent

DROP INDEX IF EXISTS idx_qr_codes_validation;
CREATE INDEX idx_qr_codes_validation 
ON qr_codes(code, is_valid, expires_at) 
WHERE is_valid = true;

COMMENT ON INDEX idx_qr_codes_validation IS 'Index composite pour validation QR rapide';

-- Index pour nettoyage des QR expirés (job de maintenance)
DROP INDEX IF EXISTS idx_qr_codes_expiry_cleanup;
CREATE INDEX idx_qr_codes_expiry_cleanup 
ON qr_codes(expires_at) 
WHERE is_valid = true;

COMMENT ON INDEX idx_qr_codes_expiry_cleanup IS 'Index pour job de nettoyage des QR expirés';

-- ============================================
-- 2. INDEX ATTENDANCE - Requêtes par événement
-- ============================================
-- Problème: findByEvent fait un seq scan + tri
-- Impact: Dashboard lent avec beaucoup d'entrées

DROP INDEX IF EXISTS idx_attendance_event_timestamp;
CREATE INDEX idx_attendance_event_timestamp 
ON attendance(event_id, timestamp DESC);

COMMENT ON INDEX idx_attendance_event_timestamp IS 'Index pour requêtes attendance récentes';

-- Index couvrant pour éviter le lookup
DROP INDEX IF EXISTS idx_attendance_event_guest_timestamp;
CREATE INDEX idx_attendance_event_guest_timestamp 
ON attendance(event_id, guest_id, timestamp DESC);

COMMENT ON INDEX idx_attendance_event_guest_timestamp IS 'Index couvrant pour requêtes avec guest';

-- Index pour statistiques par jour (reporting) - sans DATE() pour éviter immutable restriction
DROP INDEX IF EXISTS idx_attendance_date;
CREATE INDEX idx_attendance_date 
ON attendance(event_id, timestamp, status);

COMMENT ON INDEX idx_attendance_date IS 'Index pour agrégations par jour';

-- ============================================
-- 3. INDEX GUESTS - Recherches fréquentes
-- ============================================
-- Index pour recherche par statut RSVP (dashboard)
DROP INDEX IF EXISTS idx_guests_event_rsvp;
CREATE INDEX idx_guests_event_rsvp 
ON guests(event_id, rsvp_status);

COMMENT ON INDEX idx_guests_event_rsvp IS 'Index pour filtrage par statut RSVP';

-- Index pour recherche par statut présence (entrée/sortie)
DROP INDEX IF EXISTS idx_guests_event_attendance;
CREATE INDEX idx_guests_event_attendance 
ON guests(event_id, attendance_status);

COMMENT ON INDEX idx_guests_event_attendance IS 'Index pour filtrage par statut présence';

-- ============================================
-- 4. INDEX FILES - Recherches par événement/menu
-- ============================================
DROP INDEX IF EXISTS idx_files_event_menu;
CREATE INDEX idx_files_event_menu 
ON files(event_id, menu, submenu) 
WHERE is_deleted = false;

COMMENT ON INDEX idx_files_event_menu IS 'Index pour requêtes fichiers par événement/menu';

-- Index pour recherches par user
DROP INDEX IF EXISTS idx_files_user_menu_active;
CREATE INDEX idx_files_user_menu_active 
ON files(user_id, menu, submenu) 
WHERE is_deleted = false;

COMMENT ON INDEX idx_files_user_menu_active IS 'Index pour requêtes fichiers par utilisateur';

-- ============================================
-- 5. INDEX EVENTS - Recherches par organisateur
-- ============================================
-- Index pour requêtes dashboard (events + guests count)
DROP INDEX IF EXISTS idx_events_organizer_active;
CREATE INDEX idx_events_organizer_active 
ON events(organizer_id, created_at DESC) 
WHERE is_active = true;

COMMENT ON INDEX idx_events_organizer_active IS 'Index optimisé pour requêtes dashboard';

-- ============================================
-- 6. INDEX GAME TABLES - Performance jeux
-- ============================================
-- Index pour participations par jeu
DROP INDEX IF EXISTS idx_game_participations_game_completed;
CREATE INDEX idx_game_participations_game_completed 
ON game_participations(game_id, is_completed, total_score);

COMMENT ON INDEX idx_game_participations_game_completed IS 'Index pour calcul stats jeu';

-- Index pour réponses récentes
DROP INDEX IF EXISTS idx_game_answers_participation_question;
CREATE INDEX idx_game_answers_participation_question 
ON game_answers(participation_id, question_id);

COMMENT ON INDEX idx_game_answers_participation_question IS 'Index couvrant pour vérification réponses';

-- ============================================
-- 7. OPTIMISATION: Désactivation trigger synchrone game_stats
-- ============================================
-- Le trigger recalcule les stats à chaque réponse (trop coûteux)
-- Solution: Traitement asynchrone via job queue

DROP TRIGGER IF EXISTS trigger_update_game_stats ON game_participations;

COMMENT ON TABLE game_participations IS 'Trigger synchrone game_stats désactivé - utiliser job queue';

-- ============================================
-- 8. TABLE POUR STATS UPDATE JOBS
-- ============================================
CREATE TABLE IF NOT EXISTS game_stats_update_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0
);

-- Index pour récupérer les jobs pending
CREATE INDEX idx_game_stats_jobs_pending ON game_stats_update_jobs(status, created_at) 
WHERE status = 'pending';

COMMENT ON TABLE game_stats_update_jobs IS 'File d''attente pour mise à jour async des stats de jeu';

-- ============================================
-- 9. FONCTION TRIGGER LÉGÈRE
-- ============================================
CREATE OR REPLACE FUNCTION queue_game_stats_update()
RETURNS TRIGGER AS $$
DECLARE
    v_game_id UUID;
BEGIN
    v_game_id := COALESCE(NEW.game_id, OLD.game_id);
    
    -- Insère juste un job si pas déjà pending pour ce jeu
    INSERT INTO game_stats_update_jobs (game_id, status, created_at)
    SELECT v_game_id, 'pending', NOW()
    WHERE NOT EXISTS (
        SELECT 1 FROM game_stats_update_jobs 
        WHERE game_id = v_game_id AND status = 'pending'
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql' VOLATILE;

-- Trigger léger (async)
DROP TRIGGER IF EXISTS trigger_queue_game_stats_update ON game_participations;
CREATE TRIGGER trigger_queue_game_stats_update
AFTER INSERT OR UPDATE OR DELETE ON game_participations
FOR EACH ROW
EXECUTE FUNCTION queue_game_stats_update();

-- ============================================
-- 10. VERIFICATION
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Index de performance créés avec succès';
    RAISE NOTICE 'Trigger game_stats synchrone remplacé par version async';
END $$;
