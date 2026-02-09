# Système de Nettoyage Automatique Cloudflare R2

## Vue d'ensemble

Ce système implémente une architecture complète pour la gestion automatique des fichiers utilisateurs dans Cloudflare R2, avec suppression automatique lors de la suppression d'un utilisateur depuis Supabase ou la base de données.

## Architecture

### Structure des répertoires R2

```
users/{userId}/
├── avatars/           # Avatar de l'utilisateur
├── temp/             # Fichiers temporaires
└── events/{eventId}/
    ├── banners/      # Bannières d'événement
    ├── covers/       # Images de couverture
    ├── gallery/      # Photos de galerie
    ├── qr-codes/     # Codes QR générés
    ├── messages/     # Pièces jointes de messages
    └── menus/
        ├── appetizers/     # Entrées
        ├── main-courses/   # Plats principaux
        ├── desserts/       # Desserts
        ├── drinks/         # Boissons
        ├── wine-list/      # Carte des vins
        ├── full-menu/      # Menu complet
        ├── allergies/      # Informations allergies
        ├── vegetarian/     # Options végétariennes
        └── special-diet/   # Régimes spéciaux
```

## Services implémentés

### 1. UserDirectoryCleanupService
- **Fichier**: `services/userDirectoryCleanupService.js`
- **Fonction**: Nettoyage direct des fichiers R2
- **Méthodes principales**:
  - `cleanupUserDirectory(userId)` - Supprime tous les fichiers d'un utilisateur
  - `cleanupUserTempFiles(userId)` - Supprime seulement les fichiers temporaires
  - `getUserStorageStats(userId)` - Obtient les statistiques de stockage

### 2. UserCleanupOrchestrator
- **Fichier**: `services/userCleanupOrchestrator.js`
- **Fonction**: Orchestration complète de la suppression
- **Méthodes principales**:
  - `orchestrateUserDeletion(userId, reason, context)` - Suppression complète orchestrée
  - `handleDatabaseUserDeletion(userId, triggerSource)` - Appelé par les triggers DB

### 3. DatabaseNotificationListener
- **Fichier**: `services/databaseNotificationListener.js`
- **Fonction**: Écoute des notifications PostgreSQL (LISTEN/NOTIFY)
- **Fonctionnalités**:
  - Reconnexion automatique
  - Traitement asynchrone des notifications
  - Gestion d'erreurs robuste

## Intégration avec la base de données

### Migration 047: R2 Cleanup Integration
- **Fichier**: `migrations/047_r2_cleanup_integration.sql`
- **Fonctionnalités**:
  - Trigger automatique lors de la suppression d'utilisateur
  - Table de logs des nettoyages (`r2_cleanup_logs`)
  - Notifications PostgreSQL (LISTEN/NOTIFY)

### Triggers automatiques

```sql
-- Trigger sur suppression d'utilisateur
CREATE TRIGGER on_public_user_deleted
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_cascade_deletion();

-- Fonction de nettoyage R2
CREATE FUNCTION public.trigger_r2_cleanup(user_id UUID)
```

## APIs exposées

### Endpoints internes

```javascript
// Nettoyage complet (endpoint interne)
POST /api/internal/cleanup-user-files
{
  "userId": "uuid",
  "trigger": "database_deletion",
  "reason": "User deletion"
}

// Nettoyage fichiers temporaires (authentifié)
POST /api/internal/cleanup-user-temp-files

// Statistiques de stockage (authentifié)
GET /api/internal/user-storage-stats

// Nettoyage forcé administrateur (admin uniquement)
POST /api/admin/force-user-cleanup
```

## Utilisation

### Démarrage automatique

Le système se lance automatiquement avec le backend :

```javascript
// Dans services/databaseNotificationListener.js
// Le listener démarre automatiquement si ENABLE_DB_NOTIFICATIONS !== 'false'
```

### Tests

Exécuter les tests complets :

```bash
cd backendMify
node scripts/test-r2-cleanup.js
```

### Configuration requise

Variables d'environnement R2 :
```bash
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev  # Optionnel
```

## Flux de suppression automatique

1. **Suppression utilisateur** (Supabase Auth ou base de données)
2. **Trigger PostgreSQL** déclenché automatiquement
3. **Notification LISTEN/NOTIFY** envoyée
4. **Service Node.js** reçoit la notification
5. **Orchestrateur** lance le nettoyage R2
6. **Suppression par lots** des fichiers (max 1000 par lot)
7. **Logging** des résultats dans `r2_cleanup_logs`

## Sécurité

- **Validation UUID** stricte pour tous les userId
- **Transactions atomiques** pour les opérations critiques
- **Limitation par lots** (1000 fichiers max par requête AWS)
- **Retry automatique** avec backoff exponentiel
- **Audit logging** complet des opérations

## Monitoring

### Logs d'audit
- Table `r2_cleanup_logs` pour tracking des nettoyages
- États : `pending`, `processing`, `completed`, `failed`
- Détails complets des opérations

### Métriques de performance
- Durée des nettoyages
- Nombre de fichiers supprimés
- Erreurs et reprises

## Gestion des erreurs

### Scénarios gérés
- **R2 indisponible** : Graceful fallback, logs d'erreur
- **Utilisateur inexistant** : Nettoyage silencieux
- **Fichiers déjà supprimés** : Pas d'erreur fatale
- **Connexion DB perdue** : Reconnexion automatique

### Stratégie de reprise
- **Reconnexion automatique** du listener DB (max 10 tentatives)
- **Retry par lots** en cas d'échec partiel
- **Nettoyage asynchrone** non-bloquant pour les triggers DB

## Maintenance

### Nettoyage régulier des logs
```sql
-- Nettoyer les logs anciens (> 30 jours)
DELETE FROM r2_cleanup_logs 
WHERE created_at < NOW() - INTERVAL '30 days' 
AND status IN ('completed', 'failed');
```

### Vérification de l'état
```javascript
// Obtenir l'état du listener
const status = notificationListener.getStatus();
console.log(status);
```

## Tests et validation

Le script de test `scripts/test-r2-cleanup.js` valide :
- ✅ Configuration R2
- ✅ Création de fichiers structurés
- ✅ Statistiques de stockage
- ✅ Nettoyage fichiers temporaires
- ✅ Nettoyage complet utilisateur
- ✅ Gestion d'erreurs
- ✅ Validation des UUIDs

## Performance

### Optimisations implémentées
- **Suppression par lots** (AWS DeleteObjects)
- **Parallélisation** des opérations
- **Pagination** pour les grandes listes
- **Cache en mémoire** pour éviter les re-scans

### Limites AWS S3/R2
- **1000 objets max** par DeleteObjects
- **Délais** entre les lots pour éviter la surcharge
- **Gestion des erreurs** partielles par lot

## Évolutions futures

### Améliorations possibles
- **Queue system** (Bull/Kue) pour les gros volumes
- **Monitoring avancé** avec métriques temps-réel
- **Compression** avant suppression pour archivage
- **Notifications webhook** vers services externes