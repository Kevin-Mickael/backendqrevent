# 🔧 Fix Partner Names (Marié/Mariée) - Instructions

## Problème
Les noms du marié et de la mariée ne s'affichent pas dans la page "Bannière" car les colonnes `partner1_name` et `partner2_name` n'existent peut-être pas dans la table `events`.

## Solution
Appliquer la migration `032_add_partner_names_and_schedule.sql` dans Supabase.

## Étapes

### Option 1 : Via l'interface Supabase (RECOMMANDÉ)

1. Allez sur https://supabase.com/dashboard
2. Sélectionnez votre projet
3. Allez dans **SQL Editor** (dans le menu latéral)
4. Cliquez sur **New Query**
5. Copiez-collez le contenu du fichier `032_add_partner_names_and_schedule.sql`
6. Cliquez sur **Run** (ou Ctrl+Enter)

### Vérification

Après avoir appliqué la migration, exécutez cette requête pour vérifier :

```sql
-- Vérifier que les colonnes existent
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'events'
AND column_name IN ('partner1_name', 'partner2_name', 'bride_name', 'groom_name');

-- Vérifier les données existantes
SELECT id, title, partner1_name, partner2_name, bride_name, groom_name
FROM events
LIMIT 10;
```

### Migration manuelle des données existantes (si nécessaire)

Si vous avez des événements existants avec des champs vides, vous pouvez les mettre à jour manuellement :

```sql
-- Mettre à jour un événement spécifique
UPDATE events
SET
  partner1_name = 'NomDuMarié',
  partner2_name = 'NomDeLaMariée'
WHERE id = 'VOTRE_EVENT_ID';
```

## Test

1. Créez un nouvel événement via l'interface
2. Remplissez les champs "Prénom du marié" et "Prénom de la mariée"
3. Allez dans "Bannière"
4. Les noms devraient apparaître automatiquement dans les champs en lecture seule

## Ce que fait cette migration

- ✅ Ajoute les colonnes `partner1_name` et `partner2_name` à la table `events`
- ✅ Migre automatiquement les anciennes données de `bride_name` et `groom_name` si elles existent
- ✅ Crée des index pour améliorer les performances
- ✅ Compatible avec les anciens événements (les anciennes colonnes ne sont pas supprimées)
