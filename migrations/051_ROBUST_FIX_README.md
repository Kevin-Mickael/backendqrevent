# 🛡️ Robust Event Creation Fix - Guide de Déploiement

> **CRITIQUE**: Ce guide concerne la correction du problème de création d'événements.
> **AUTEUR**: Claude Code Assistant  
> **DATE**: 2026-02-11  
> **STATUT**: Production Ready

---

## 📋 Vue d'Ensemble

Ce fix résout les problèmes de création d'événements causés par :
1. ❌ Colonnes `venue_*` manquantes dans certains environnements
2. ❌ Trigger `validate_event_venues_trigger` trop strict
3. ❌ Politiques RLS bloquantes
4. ❌ Incohérences entre migrations

### 🎯 Solution

Une approche **défensive en 3 couches** :

```
┌─────────────────────────────────────────────────────────────┐
│  COUCHE 1: Migration SQL (051_robust_event_creation_fix.sql)│
│  → Corrige le schéma de manière idempotente                 │
├─────────────────────────────────────────────────────────────┤
│  COUCHE 2: Backend Safe (events.safe.js)                    │
│  → Détection dynamique du schéma + fallback automatique     │
├─────────────────────────────────────────────────────────────┤
│  COUCHE 3: Diagnostic & Monitoring                          │
│  → Scripts de vérification et rollback                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Déploiement Rapide (5 minutes)

### Étape 1: Diagnostic (1 min)

```bash
cd backendMify
node scripts/diagnose-database.js
```

**Résultat attendu** :
- 🟢 Si "EXCELLENT! Aucun problème détecté" → Le fix est déjà appliqué
- 🟡 Si avertissements → Appliquer la migration
- 🔴 Si erreurs critiques → Suivre le guide complet ci-dessous

### Étape 2: Backup & Migration (3 min)

```bash
# Mode simulation (recommandé pour tester)
node scripts/migrate-safe.js --dry-run

# Exécution réelle
node scripts/migrate-safe.js
```

Le script va :
1. ✅ Créer un backup automatique (`backups/backup-before-051-*.json`)
2. ✅ Vérifier les prérequis
3. ✅ Appliquer la migration 051
4. ✅ Vérifier le résultat

### Étape 3: Vérification (1 min)

```bash
# Relancer le diagnostic
node scripts/diagnose-database.js

# Tester la création d'événement via l'API
curl -X POST http://localhost:5000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -d '{
    "title": "Test Migration",
    "date": "2026-12-31T14:00:00Z",
    "location": {"address": "123 Test Street"},
    "guest_count": 50
  }'
```

---

## 📖 Guide Complet

### Prérequis

- Node.js 18+
- Accès à la base Supabase (service_role key)
- Backup de la base de données (automatique avec le script)

### Option A: Déploiement Automatique (Recommandé)

```bash
# 1. Aller dans le dossier backend
cd backendMify

# 2. Installer les dépendances si nécessaire
npm install

# 3. Lancer le diagnostic
node scripts/diagnose-database.js

# 4. Appliquer la migration sécurisée
node scripts/migrate-safe.js

# 5. Redémarrer le serveur backend
npm run dev
```

### Option B: Déploiement Manuel (Supabase SQL Editor)

Si le script automatique échoue :

1. **Ouvrir** l'éditeur SQL Supabase Dashboard
2. **Copier** le contenu de `migrations/051_robust_event_creation_fix.sql`
3. **Exécuter** le script
4. **Vérifier** les messages de sortie (doivent contenir "🎉 MIGRATION 051 TERMINÉE")

### Option C: Déploiement Progressif (Sans downtime)

Pour les environnements de production avec traffic :

```bash
# 1. Démarrer avec la couche safe (compatible ancien/nouveau schéma)
# Le backend détecte automatiquement le schéma et s'adapte

# 2. Appliquer la migration en arrière-plan
node scripts/migrate-safe.js

# 3. La couche safe bascule automatiquement sur le nouveau schéma
```

---

## 🔧 Détails Techniques

### Ce que fait la Migration 051

#### 1. Correction du Schéma Events

```sql
-- Ajoute TOUTES les colonnes manquantes (si pas déjà présentes)
- venue_type, ceremony_venue, reception_venue
- ceremony_date, ceremony_time, reception_date, reception_time
- partner1_name, partner2_name, event_schedule
- settings, guest_count, cover_image, banner_image
```

#### 2. Suppression du Trigger Problématique

```sql
-- Supprime le trigger trop strict
DROP TRIGGER IF EXISTS validate_event_venues_trigger ON events;

-- Remplace par une version souple avec valeurs par défaut
CREATE TRIGGER validate_event_venues_soft_trigger
```

#### 3. Correction des Politiques RLS

```sql
-- Politique pour service_role (backend)
CREATE POLICY "Events full access for service role"

-- Politique pour authenticated (utilisateurs)
CREATE POLICY "Events access for authenticated users"
```

#### 4. Fonction RPC Robuste

```sql
-- Crée create_event_robust() qui:
-- • Gère toutes les conversions de données
-- • Fournit des valeurs par défaut intelligentes
-- • Valide les entrées
-- • Gère les erreurs proprement
```

### Ce que fait la Couche Backend Safe

Le fichier `utils/db/events.safe.js` :

1. **Détecte** le schéma à l'exécution (`detectEventSchema()`)
2. **Filtre** les données pour ne garder que les colonnes existantes
3. **Transforme** automatiquement les données (ex: location → ceremony_venue)
4. **Fallback** sur plusieurs méthodes (RPC → Insertion directe)
5. **Gère** les erreurs avec retry

---

## 🧪 Tests et Vérification

### Test 1: Création Basique

```bash
curl -X POST http://localhost:5000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "title": "Mariage Test",
    "date": "2026-06-15T14:00:00Z"
  }'
```

**Attendu**: `201 Created` avec l'événement créé

### Test 2: Création Complète

```bash
curl -X POST http://localhost:5000/api/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "title": "Grand Mariage",
    "date": "2026-08-20T15:00:00Z",
    "guest_count": 150,
    "partner1_name": "Jean",
    "partner2_name": "Marie",
    "location": {"address": "Paris, France"},
    "event_schedule": [
      {"id": "1", "name": "Cérémonie", "location": "Mairie", "time": "14:00"},
      {"id": "2", "name": "Réception", "location": "Château", "time": "18:00"}
    ],
    "settings": {
      "enableRSVP": true,
      "enableGames": true
    }
  }'
```

### Test 3: Vérification en Base

```sql
-- Dans Supabase SQL Editor
SELECT 
  id, title, 
  venue_type, 
  ceremony_date, 
  ceremony_time,
  partner1_name,
  partner2_name
FROM events 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## 🔄 Rollback (En Cas de Problème)

### Méthode 1: Restauration depuis le Backup

```bash
# Le backup est créé automatiquement par migrate-safe.js
# Localisation: backendMify/backups/backup-before-051-*.json

# Pour restaurer manuellement, utilisez les données du fichier
# et réinsérez-les via l'API ou SQL
```

### Méthode 2: Annulation Manuelle

```sql
-- Dans Supabase SQL Editor

-- 1. Supprimer le trigger soft (optionnel)
DROP TRIGGER IF EXISTS validate_event_venues_soft_trigger ON events;

-- 2. Recréer l'ancien trigger si nécessaire (NON RECOMMANDÉ)
-- Voir migration 029 pour le code original

-- 3. Les colonnes ajoutées peuvent rester (pas de conflit)
-- Elles sont ignorées si non utilisées
```

---

## 📊 Monitoring

### Logs à Surveiller

```bash
# Backend
tail -f backendMify/logs/app.log | grep -E "(events\.safe|create_event|migration)"

# Rechercher ces patterns:
# ✅ "Schéma détecté:" 
# ✅ "Utilisation de create_event_robust()"
# ✅ "Event created successfully"
# ❌ "Échec RPC, fallback sur insertion directe"
# ❌ "Impossible de créer l'utilisateur"
```

### Métriques Clés

| Métrique | Commande | Valeur Attendue |
|----------|----------|-----------------|
| Colonnes events | `SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'events'` | ≥ 20 |
| Fonction RPC | `SELECT proname FROM pg_proc WHERE proname = 'create_event_robust'` | 1 row |
| Trigger actif | `SELECT tgname FROM pg_trigger WHERE tgname = 'validate_event_venues_soft_trigger'` | 1 row |

---

## 🐛 Dépannage

### Problème: "function exec_sql does not exist"

**Solution**:
```bash
# Le script va automatiquement passer en mode alternatif
# Ou exécuter la migration manuellement dans Supabase SQL Editor
```

### Problème: "Organizer not found"

**Cause**: L'utilisateur n'existe que dans `auth.users`, pas dans `public.users`  
**Solution**: La couche safe tente de créer l'utilisateur automatiquement. Si ça échoue :

```sql
-- Créer manuellement l'utilisateur
INSERT INTO public.users (id, auth_id, email, name, role, is_active)
VALUES (
  'UUID_DE_L_USER',
  'UUID_DE_L_USER', 
  'email@example.com',
  'Nom Utilisateur',
  'organizer',
  true
);
```

### Problème: "column 'X' of relation 'events' does not exist"

**Cause**: La migration n'a pas été appliquée  
**Solution**: 
```bash
node scripts/migrate-safe.js --force
```

### Problème: "permission denied for table events"

**Cause**: Politique RLS bloquante  
**Solution**: Vérifier que les politiques sont correctes :

```sql
-- Vérifier
SELECT * FROM pg_policies WHERE tablename = 'events';

-- Si besoin, désactiver temporairement RLS (DANGER!)
-- ALTER TABLE events DISABLE ROW LEVEL SECURITY;
```

---

## 📁 Fichiers Créés/Modifiés

### Nouveaux Fichiers

```
backendMify/
├── migrations/
│   └── 051_robust_event_creation_fix.sql  # Migration principale
├── scripts/
│   ├── diagnose-database.js               # Diagnostic
│   └── migrate-safe.js                    # Migration sécurisée
└── utils/db/
    └── events.safe.js                     # Couche backend safe
```

### Fichiers Modifiés

```
backendMify/
└── routes/
    └── api.js                             # Utilise eventsSafe.create
```

---

## ✅ Checklist de Validation

Après déploiement, vérifier :

- [ ] `node scripts/diagnose-database.js` retourne "EXCELLENT"
- [ ] Création d'événement via l'API fonctionne
- [ ] Toutes les colonnes sont présentes (20+)
- [ ] Le trigger `validate_event_venues_soft_trigger` existe
- [ ] La fonction `create_event_robust` existe
- [ ] Les politiques RLS permettent l'accès
- [ ] Les événements créés ont les champs `venue_type` et `ceremony_date` remplis

---

## 🎓 Architecture Expliquée

### Pourquoi 3 Couches ?

```
Couche 1 (SQL)      → Corrige définitivement le schéma
Couche 2 (Backend)  → Compatibilité runtime (ancien/nouveau)
Couche 3 (Scripts)  → Observabilité et rollback
```

### Pourquoi Idempotent ?

La migration peut être exécutée **plusieurs fois sans danger** :
- `IF NOT EXISTS` pour toutes les colonnes
- `DROP IF EXISTS` avant `CREATE` pour triggers/fonctions
- `CREATE OR REPLACE` pour les fonctions

---

## 📞 Support

En cas de problème :
1. Exécuter `node scripts/diagnose-database.js`
2. Copier le résultat
3. Vérifier les logs backend
4. Consulter ce README

---

**Fin du document** - Bonne migration! 🚀
