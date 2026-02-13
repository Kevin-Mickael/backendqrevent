# 🔧 Fix RLS Policies - Instructions

## Problème
Les politiques RLS (Row Level Security) bloquent les opérations du backend, même avec le service role key.

## Solution
Appliquer la migration `004_fix_rls_policies.sql` dans Supabase.

## Étapes

### Option 1 : Via l'interface Supabase (RECOMMANDÉ)

1. Allez sur https://supabase.com/dashboard
2. Sélectionnez votre projet
3. Allez dans **SQL Editor** (dans le menu latéral)
4. Cliquez sur **New Query**
5. Copiez-collez le contenu du fichier `004_fix_rls_policies.sql`
6. Cliquez sur **Run** (ou Ctrl+Enter)

### Option 2 : Via psql (si vous avez accès direct)

```bash
cd /home/kevin/Mify/backendMify
psql "YOUR_SUPABASE_CONNECTION_STRING" -f migrations/004_fix_rls_policies.sql
```

## Vérification

Après avoir appliqué la migration, testez en créant un groupe dans "Gestion de famille".
L'erreur `new row violates row-level security policy` ne devrait plus apparaître.

## Ce que fait cette migration

- ✅ Supprime les anciennes politiques trop restrictives `USING (false)`
- ✅ Crée des politiques explicites pour le `service_role` avec accès complet
- ✅ Maintient le blocage pour les connexions anonymes (sécurité)
- ✅ S'applique aux tables : qr_codes, family_invitations, guests, events, users, attendance, files

## Rollback (si nécessaire)

Si vous voulez revenir en arrière :

```sql
-- Revenir aux anciennes politiques (non recommandé)
-- Exécutez le fichier 003_secure_tables.sql
```
