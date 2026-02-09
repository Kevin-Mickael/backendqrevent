-- =============================================================================
-- Migration 047: Intégration du nettoyage automatique des fichiers R2
-- =============================================================================

-- Step 1: Function to call Node.js cleanup service for R2 files
CREATE OR REPLACE FUNCTION public.trigger_r2_cleanup(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    cleanup_url TEXT;
    payload JSONB;
    http_response JSONB;
BEGIN
    -- Construire l'URL de callback pour le service de nettoyage
    -- En production, cela devrait pointer vers votre backend
    cleanup_url := COALESCE(
        current_setting('app.r2_cleanup_webhook_url', true),
        'http://localhost:5000/api/internal/cleanup-user-files'
    );
    
    -- Payload pour la requête de nettoyage
    payload := jsonb_build_object(
        'userId', user_id,
        'trigger', 'database_deletion',
        'timestamp', EXTRACT(epoch FROM now())
    );
    
    -- Log de l'action
    RAISE LOG 'Triggering R2 cleanup for user_id: % via %', user_id, cleanup_url;
    
    -- Note: Dans un environnement de production, vous pourriez utiliser:
    -- 1. Une extension PostgreSQL comme pg_net pour les requêtes HTTP
    -- 2. Un système de queues comme pg_boss
    -- 3. Un webhook vers votre service Node.js
    -- 
    -- Pour cette implémentation, nous utilisons NOTIFY pour déclencher
    -- le nettoyage depuis l'application Node.js qui écoute les notifications
    
    PERFORM pg_notify('user_deletion_r2_cleanup', payload::text);
    
    -- Log pour audit
    RAISE LOG 'R2 cleanup notification sent for user_id: %', user_id;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Ne pas bloquer la suppression si le nettoyage R2 échoue
        RAISE WARNING 'Failed to trigger R2 cleanup for user_id: %. Error: %', user_id, SQLERRM;
END;
$$;

-- Step 2: Update the existing user cascade deletion function to include R2 cleanup
CREATE OR REPLACE FUNCTION public.handle_user_cascade_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Log what will be deleted
    RAISE LOG 'Cascading deletion for user_id: %, email: %', OLD.id, OLD.email;
    
    -- Déclencher le nettoyage R2 de façon asynchrone
    BEGIN
        PERFORM public.trigger_r2_cleanup(OLD.id);
    EXCEPTION
        WHEN OTHERS THEN
            -- Log l'erreur mais ne pas bloquer la suppression
            RAISE WARNING 'R2 cleanup trigger failed for user_id: %. Error: %', OLD.id, SQLERRM;
    END;
    
    -- Note: Other related data (events, guests, etc.) should already be handled
    -- by existing foreign key constraints with CASCADE
    
    RETURN OLD;
END;
$$;

-- Step 3: Function to handle cleanup notification in Node.js app
-- Cette fonction sera appelée depuis Node.js pour traiter les notifications
CREATE OR REPLACE FUNCTION public.get_pending_r2_cleanups()
RETURNS TABLE (
    user_id UUID,
    triggered_at TIMESTAMP WITH TIME ZONE,
    payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Cette fonction peut être utilisée pour récupérer les nettoyages en attente
    -- si vous utilisez une approche basée sur une table de queue
    RETURN QUERY
    SELECT 
        NULL::UUID as user_id,
        now() as triggered_at,
        '{}'::JSONB as payload
    WHERE FALSE; -- Placeholder - implémentation via NOTIFY/LISTEN
END;
$$;

-- Step 4: Table pour journaliser les nettoyages R2 (optionnel)
CREATE TABLE IF NOT EXISTS public.r2_cleanup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    trigger_source VARCHAR(100) NOT NULL, -- 'database_deletion', 'manual', etc.
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    files_deleted INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE,
    details JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_r2_cleanup_logs_user_id ON public.r2_cleanup_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_r2_cleanup_logs_status ON public.r2_cleanup_logs(status);
CREATE INDEX IF NOT EXISTS idx_r2_cleanup_logs_created_at ON public.r2_cleanup_logs(created_at);

-- Step 5: Function to log R2 cleanup operations
CREATE OR REPLACE FUNCTION public.log_r2_cleanup(
    user_id UUID,
    trigger_source TEXT,
    status TEXT DEFAULT 'pending',
    files_deleted INTEGER DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    details JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO public.r2_cleanup_logs (
        user_id,
        trigger_source,
        status,
        files_deleted,
        error_message,
        details,
        started_at,
        completed_at
    )
    VALUES (
        user_id,
        trigger_source,
        status,
        files_deleted,
        error_message,
        details,
        now(),
        CASE WHEN status IN ('completed', 'failed') THEN now() ELSE NULL END
    )
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$;

-- Step 6: Function to update R2 cleanup status
CREATE OR REPLACE FUNCTION public.update_r2_cleanup_status(
    log_id UUID,
    new_status TEXT,
    files_deleted INTEGER DEFAULT NULL,
    error_message TEXT DEFAULT NULL,
    details JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.r2_cleanup_logs
    SET 
        status = new_status,
        files_deleted = COALESCE(update_r2_cleanup_status.files_deleted, r2_cleanup_logs.files_deleted),
        error_message = COALESCE(update_r2_cleanup_status.error_message, r2_cleanup_logs.error_message),
        details = COALESCE(update_r2_cleanup_status.details, r2_cleanup_logs.details),
        completed_at = CASE 
            WHEN new_status IN ('completed', 'failed') THEN now() 
            ELSE r2_cleanup_logs.completed_at 
        END,
        updated_at = now()
    WHERE id = log_id;
END;
$$;

-- Step 7: Grant permissions
GRANT EXECUTE ON FUNCTION public.trigger_r2_cleanup(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_r2_cleanup(UUID, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_r2_cleanup_status(UUID, TEXT, INTEGER, TEXT, JSONB) TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.r2_cleanup_logs TO service_role;

-- Step 8: Configuration settings (à définir dans votre environment)
-- Ces settings peuvent être configurés via ALTER SYSTEM SET ou variables d'environnement
COMMENT ON FUNCTION public.trigger_r2_cleanup IS 
'Déclenche le nettoyage automatique des fichiers R2 lors de la suppression d''un utilisateur. 
Configure app.r2_cleanup_webhook_url pour pointer vers votre service de nettoyage.';

-- Step 9: Verification
SELECT 
  'R2 cleanup integration setup complete' as status,
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'trigger_r2_cleanup') as cleanup_function_exists,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'r2_cleanup_logs') as log_table_exists;