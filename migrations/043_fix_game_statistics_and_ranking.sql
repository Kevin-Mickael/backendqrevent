-- Migration: Fix game statistics and ranking system
-- Description: Répare les statistiques de jeu et le système de classement
-- Date: 2026-02-09
-- Auteur: Claude (Assistant AI)

-- 🛡️ SÉCURITÉ: Migration idempotente selon rules.md
-- Toutes les opérations utilisent IF NOT EXISTS et IF EXISTS

DO $$
BEGIN
    -- 1. Corriger la fonction update_game_leaderboard
    CREATE OR REPLACE FUNCTION update_game_leaderboard(p_game_id UUID DEFAULT NULL)
    RETURNS void AS 
    $func$
    DECLARE
        game_record RECORD;
    BEGIN
        -- Si p_game_id est fourni, ne traiter que ce jeu
        -- Sinon, traiter tous les jeux
        FOR game_record IN 
            SELECT DISTINCT game_id 
            FROM public.game_participations
            WHERE (p_game_id IS NULL OR game_id = p_game_id)
              AND is_completed = true
        LOOP
            -- Mettre à jour les rangs pour ce jeu spécifique
            WITH ranked_participants AS (
                SELECT 
                    id,
                    ROW_NUMBER() OVER (
                        ORDER BY total_score DESC, 
                                 completed_at ASC
                    ) as new_rank
                FROM public.game_participations
                WHERE game_id = game_record.game_id 
                  AND is_completed = true
            )
            UPDATE public.game_participations gp
            SET rank = rp.new_rank,
                updated_at = CURRENT_TIMESTAMP
            FROM ranked_participants rp
            WHERE gp.id = rp.id;
            
            -- Log pour debug
            RAISE NOTICE 'Updated ranks for game %', game_record.game_id;
        END LOOP;
        
    EXCEPTION
        WHEN OTHERS THEN
            -- Log l'erreur mais ne pas échouer
            RAISE NOTICE 'Error updating leaderboard: %', SQLERRM;
    END;
    $func$ LANGUAGE plpgsql SECURITY INVOKER;

    -- 2. Recréer le trigger pour s'assurer qu'il fonctionne
    DROP TRIGGER IF EXISTS trigger_update_leaderboard ON public.game_participations;
    
    CREATE TRIGGER trigger_update_leaderboard
        AFTER INSERT OR UPDATE OF total_score, is_completed 
        ON public.game_participations
        FOR EACH ROW 
        WHEN (NEW.is_completed = true)
        EXECUTE FUNCTION update_game_leaderboard(NEW.game_id);

    -- 3. Corriger la vue game_leaderboard pour un meilleur performance
    DROP VIEW IF EXISTS game_leaderboard CASCADE;
    
    CREATE VIEW game_leaderboard AS
    SELECT 
        gp.game_id,
        gp.id as participation_id,
        gp.rank,
        gp.total_score as score,
        gp.correct_answers,
        gp.total_answers,
        gp.completed_at,
        gp.player_name,
        gp.player_type,
        -- Nom d'affichage intelligent
        CASE 
            WHEN gp.player_name IS NOT NULL AND gp.player_name != '' THEN gp.player_name
            WHEN gp.family_id IS NOT NULL AND f.name IS NOT NULL THEN f.name
            WHEN gp.guest_id IS NOT NULL THEN COALESCE(g.first_name || ' ' || g.last_name, 'Invité')
            ELSE 'Participant'
        END as display_name,
        -- Métadonnées pour l'organisateur
        gp.guest_id,
        gp.family_id,
        gp.qr_code,
        gp.access_token,
        g.first_name,
        g.last_name,
        f.name as family_name
    FROM public.game_participations gp
    LEFT JOIN public.guests g ON gp.guest_id = g.id
    LEFT JOIN public.families f ON gp.family_id = f.id
    WHERE gp.is_completed = true
    ORDER BY gp.game_id, gp.rank ASC;

    -- 4. Créer une vue optimisée pour les statistiques organisateur
    DROP VIEW IF EXISTS game_statistics_dashboard CASCADE;
    
    CREATE VIEW game_statistics_dashboard AS
    SELECT 
        g.id as game_id,
        g.name as game_name,
        g.type as game_type,
        g.status as game_status,
        g.event_id,
        -- Statistiques de participation
        COUNT(gp.id) as total_participants,
        COUNT(DISTINCT gp.family_id) as unique_families,
        COUNT(DISTINCT gp.guest_id) as unique_guests,
        -- Statistiques de score
        COALESCE(AVG(gp.total_score), 0) as average_score,
        COALESCE(MAX(gp.total_score), 0) as max_score,
        COALESCE(MIN(gp.total_score), 0) as min_score,
        -- Statistiques de réussite
        ROUND(
            AVG(CASE WHEN gp.total_answers > 0 THEN (gp.correct_answers::float / gp.total_answers) * 100 ELSE 0 END), 
            2
        ) as average_success_rate,
        -- Timing
        MIN(gp.completed_at) as first_completion,
        MAX(gp.completed_at) as last_completion,
        g.created_at,
        g.updated_at
    FROM public.games g
    LEFT JOIN public.game_participations gp ON g.id = gp.game_id 
        AND gp.is_completed = true
    WHERE g.is_active = true
    GROUP BY g.id, g.name, g.type, g.status, g.event_id, g.created_at, g.updated_at
    ORDER BY g.created_at DESC;

    -- 5. Index pour optimiser les performances
    CREATE INDEX IF NOT EXISTS idx_game_participations_completed_rank 
    ON public.game_participations(game_id, is_completed, rank) 
    WHERE is_completed = true;

    CREATE INDEX IF NOT EXISTS idx_game_participations_score_time 
    ON public.game_participations(game_id, total_score DESC, completed_at ASC) 
    WHERE is_completed = true;

    -- 6. Corriger toutes les participations existantes sans rang
    UPDATE public.game_participations 
    SET rank = NULL 
    WHERE rank IS NOT NULL;
    
    -- 7. Exécuter la fonction pour recalculer tous les rangs
    PERFORM update_game_leaderboard(NULL);

    -- 8. Vérifier l'intégrité des données
    DO $integrity$
    BEGIN
        -- Vérifier qu'il n'y a pas de doublons de rang par jeu
        IF EXISTS (
            SELECT game_id, rank 
            FROM public.game_participations 
            WHERE is_completed = true AND rank IS NOT NULL
            GROUP BY game_id, rank 
            HAVING COUNT(*) > 1
        ) THEN
            RAISE NOTICE 'WARNING: Duplicate ranks detected, re-running ranking function';
            PERFORM update_game_leaderboard(NULL);
        END IF;
    END $integrity$;

    -- 9. Ajouter des commentaires pour la documentation
    COMMENT ON FUNCTION update_game_leaderboard IS 'Calcule et met à jour les rangs des participants pour un ou tous les jeux';
    COMMENT ON VIEW game_leaderboard IS 'Vue complète du classement des jeux avec noms d''affichage intelligents';
    COMMENT ON VIEW game_statistics_dashboard IS 'Vue statistiques pour le dashboard organisateur';
    
    RAISE NOTICE '✅ Migration 043 terminée : Système de classement et statistiques réparé';

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Erreur dans migration 043: %', SQLERRM;
        RAISE;
END $$;