-- ============================================
-- NETTOYAGE SUPABASE AUTH - ATTENTION ADMIN REQUIS
-- ============================================
-- Ce script nettoie aussi la partie auth.users de Supabase
-- IMPORTANT: Nécessite les droits admin ou service role

-- ============================================
-- PARTIE 1: NETTOYAGE auth.users (SUPABASE AUTH)
-- ============================================

-- ATTENTION: Cette partie nécessite le service role key
-- Option 1: Via interface Supabase Dashboard
-- Option 2: Via API avec service role key
-- Option 3: Via SQL avec permissions admin

DO $$
DECLARE
    auth_users_count INTEGER;
BEGIN
    -- Compter les utilisateurs auth
    SELECT COUNT(*) INTO auth_users_count FROM auth.users;
    RAISE NOTICE 'Utilisateurs auth.users à supprimer: %', auth_users_count;
    
    IF auth_users_count > 0 THEN
        -- Supprimer tous les utilisateurs auth
        -- ATTENTION: Ceci supprime TOUS les comptes Supabase Auth
        DELETE FROM auth.users;
        
        RAISE NOTICE '✅ Tous les utilisateurs auth.users supprimés';
    ELSE
        RAISE NOTICE '✅ auth.users déjà vide';
    END IF;
    
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE WARNING '❌ PERMISSIONS INSUFFISANTES pour nettoyer auth.users';
        RAISE NOTICE 'Solutions:';
        RAISE NOTICE '1. Utiliser l''interface Supabase Dashboard > Authentication > Users';
        RAISE NOTICE '2. Exécuter avec service role key';
        RAISE NOTICE '3. Utiliser l''API Supabase Admin';
    WHEN OTHERS THEN
        RAISE WARNING 'Erreur lors du nettoyage auth.users: %', SQLERRM;
END $$;

-- ============================================
-- PARTIE 2: INSTRUCTIONS MANUELLES
-- ============================================

-- Si le script SQL ne peut pas nettoyer auth.users, voici les alternatives :

/*
MÉTHODE 1: Interface Supabase Dashboard
1. Aller sur https://supabase.com/dashboard/project/[PROJECT-ID]/auth/users
2. Sélectionner tous les utilisateurs
3. Supprimer en masse

MÉTHODE 2: API Supabase (via script Node.js)
```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function deleteAllAuthUsers() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  
  if (error) {
    console.error('Erreur récupération users:', error);
    return;
  }
  
  for (const user of users.users) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error(`Erreur suppression ${user.email}:`, deleteError);
    } else {
      console.log(`✅ Utilisateur supprimé: ${user.email}`);
    }
  }
}

deleteAllAuthUsers();
```

MÉTHODE 3: cURL avec service role key
```bash
# Récupérer la liste des utilisateurs
curl -X GET "https://[PROJECT-ID].supabase.co/auth/v1/admin/users" \
  -H "Authorization: Bearer [SERVICE-ROLE-KEY]" \
  -H "apikey: [SERVICE-ROLE-KEY]"

# Supprimer chaque utilisateur (remplacer USER-ID)
curl -X DELETE "https://[PROJECT-ID].supabase.co/auth/v1/admin/users/[USER-ID]" \
  -H "Authorization: Bearer [SERVICE-ROLE-KEY]" \
  -H "apikey: [SERVICE-ROLE-KEY]"
```
*/

-- ============================================
-- VÉRIFICATION FINALE COMPLÈTE
-- ============================================

DO $$
DECLARE
    public_users INTEGER;
    auth_users INTEGER;
    total_remaining INTEGER;
BEGIN
    -- Compter public.users
    SELECT COUNT(*) INTO public_users FROM public.users;
    
    -- Essayer de compter auth.users
    BEGIN
        SELECT COUNT(*) INTO auth_users FROM auth.users;
    EXCEPTION
        WHEN insufficient_privilege THEN
            auth_users := -1; -- Indique qu'on ne peut pas vérifier
        WHEN OTHERS THEN
            auth_users := -1;
    END;
    
    total_remaining := public_users + COALESCE(NULLIF(auth_users, -1), 0);
    
    RAISE NOTICE '=== ÉTAT FINAL ===';
    RAISE NOTICE 'public.users: %', public_users;
    
    IF auth_users = -1 THEN
        RAISE NOTICE 'auth.users: Non vérifiable (permissions)';
        RAISE NOTICE '⚠️ Vérifier manuellement via Supabase Dashboard';
    ELSE
        RAISE NOTICE 'auth.users: %', auth_users;
    END IF;
    
    IF public_users = 0 AND (auth_users = 0 OR auth_users = -1) THEN
        RAISE NOTICE '✅ NETTOYAGE TERMINÉ - Fresh start prêt pour Supabase Auth';
    ELSE
        RAISE NOTICE '⚠️ Nettoyage partiel - Vérifier auth.users manuellement';
    END IF;
END $$;