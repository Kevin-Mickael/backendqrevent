# QR Event - Guide pour Agents IA

Ce document fournit toutes les informations essentielles pour comprendre et travailler sur le backend de la plateforme Qrevent.

---

## Vue d'ensemble du projet

**Qrevent Backend** est une application Node.js/Express.js qui sert de backend pour la plateforme d'invitations de mariage Qrevent. Elle gère l'authentification des utilisateurs, la gestion d'événements, la gestion d'invités, et la génération/validation de codes QR.

### Fonctionnalités clés

- Authentification et autorisation des utilisateurs avec JWT (cookies HTTP-only)
- Création et gestion d'événements de mariage
- Gestion d'invités avec fonctionnalité RSVP
- Génération et validation sécurisée de codes QR
- Suivi de présence aux événements
- Plan de tables (seating tables)
- Jeux interactifs pour les invités
- Livre d'or et vœux des invités
- Gestion des familles d'invités
- Galerie photos/vidéos
- API RESTful
- Intégration Supabase (PostgreSQL + Auth)
- Optimisation d'images en arrière-plan avec Bull/Redis
- Mise en cache avec Redis (multi-niveau: Redis + mémoire)
- Vues matérialisées pour les statistiques dashboard

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Runtime | Node.js |
| Framework | Express.js |
| Base de données | PostgreSQL (via Supabase) |
| Authentification | JWT + Supabase Auth |
| Cache & Files d'attente | Redis + Bull |
| Stockage fichiers | Cloudflare R2 (AWS S3 compatible) |
| Validation | Joi + Celebrate |
| Logging | Winston |
| Sécurité | Helmet, express-rate-limit, xss-clean |
| Traitement images | Sharp |
| Tests | Jest + Supertest |
| Tests de charge | k6 |

---

## Structure des dossiers

```
backend/
├── config/              # Configuration (Supabase, R2, Redis)
│   ├── config.js        # Variables d'environnement avec validation JWT
│   ├── supabase.js      # Clients Supabase (anon + service)
│   ├── r2.js            # Configuration Cloudflare R2
│   └── redis.js         # Configuration Redis
├── controllers/         # Gestionnaires de requêtes
│   └── authController.js
├── middleware/          # Middleware personnalisé
│   ├── auth.js          # Authentification JWT
│   ├── security.js      # Rate limiting, Helmet, validation QR
│   ├── rateLimiter.js   # Rate limiters spécifiques
│   ├── cacheMiddleware.js # Cache multi-niveau (Redis + mémoire)
│   ├── upload.js        # Multer pour uploads images
│   ├── uploadVideo.js   # Multer pour uploads vidéos
│   ├── refreshToken.js  # Gestion des refresh tokens
│   └── csp.js           # Content Security Policy
├── migrations/          # Scripts de migration SQL (45+ migrations)
│   ├── 001_create_tables.sql
│   ├── 999_final_schema_sync.sql
│   └── ...
├── routes/              # Définitions des routes API
│   ├── api.js           # Routes principales (événements, invités, jeux)
│   ├── auth.js          # Routes d'authentification
│   ├── games-public.js  # Routes publiques pour jeux
│   ├── budget.js        # Gestion du budget
│   ├── messages.js      # Messages entre invités
│   ├── gallery.js       # Galerie photos/vidéos
│   └── seating-tables.js # Plan de tables
├── services/            # Logique métier
│   ├── qrCodeService.js # Génération/validation QR codes
│   ├── storageService.js # Upload vers R2
│   ├── imageService.js  # Optimisation d'images avec Sharp
│   ├── imageOptimizationQueue.js # File d'attente Bull
│   ├── redisService.js  # Service Redis avec files d'attente
│   └── auditService.js  # Journal d'audit
├── utils/               # Fonctions utilitaires
│   ├── logger.js        # Winston logger
│   ├── cache.js         # Client Redis avec helpers
│   ├── database.js      # Export des modules DB
│   ├── sanitize.js      # Fonctions de nettoyage
│   ├── securityUtils.js # Utilitaires de sécurité
│   └── db/              # Modèles de base de données (18 fichiers)
│       ├── users.js, events.js, guests.js, qrCodes.js
│       ├── families.js, familyInvitations.js, familyRsvp.js
│       ├── games.js, wishes.js, feedback.js, attendance.js
│       ├── storyEvents.js, seatingTables.js, budgetItems.js
│       └── ...
├── jobs/                # Traitements en arrière-plan
│   ├── gameStatsProcessor.js
│   └── refreshMaterializedViews.js
├── scripts/             # Scripts utilitaires
│   ├── run-migration.js
│   ├── monitor-performance.js
│   └── ...
├── load-tests/          # Tests de charge k6
│   ├── dashboard-load-test.js
│   └── game-load-test.js
├── examples/            # Exemples de code
│   └── cache-usage-example.js
├── logs/                # Fichiers de log (non versionnés)
├── server.js            # Point d'entrée principal
├── package.json
├── .env.secure.example  # Template de configuration
└── rules.md             # Règles de développement
```

---

## Commandes de build et développement

### Installation

```bash
npm install
```

### Configuration

Créer un fichier `.env` basé sur `.env.secure.example` :

```bash
cp .env.secure.example .env
# Éditer .env avec vos valeurs
```

### Scripts npm

```bash
# Démarrage
npm start              # Production
npm run dev            # Développement avec nodemon
npm run dev-with-redis # Avec Docker Compose pour Redis

# Base de données
npm run migrate        # Exécuter les migrations
npm run migrate:optimized  # Migrations optimisées
npm run migrate:sync   # Synchronisation schéma final
npm run db:check       # Vérifier l'état de la base
npm run db:analyze     # Analyser les migrations

# Tests
npm test               # Exécuter les tests Jest
npm run test:watch     # Mode watch

# Qualité de code
npm run lint           # ESLint

# Jobs en arrière-plan
npm run jobs:game-stats        # Traiter les stats de jeux
npm run jobs:refresh-views     # Rafraîchir les vues matérialisées (once)
npm run jobs:refresh-views:daemon # Mode daemon

# Performance
npm run monitor        # Monitoring performance
npm run load-test:dashboard  # Test de charge dashboard (nécessite k6)
npm run load-test:game       # Test de charge jeux (nécessite k6)

# Redis (via Docker)
npm run redis-up       # Démarrer Redis
npm run redis-down     # Arrêter Redis
```

---

## Architecture du code

### Flux de requête

```
Requête HTTP
    ↓
Middleware de sécurité (Helmet, CSP, Rate limiting)
    ↓
CSRF Protection (pour POST/PUT/DELETE)
    ↓
CORS avec origines strictes
    ↓
Middleware d'authentification (JWT depuis cookie)
    ↓
Token Refresh automatique (si nécessaire)
    ↓
Validation (Celebrate/Joi)
    ↓
Cache Middleware (GET requests)
    ↓
Route Handler
    ↓
Service/DB Layer (utils/db/)
    ↓
Supabase/PostgreSQL
```

### Organisation des modules

1. **Routes** (`routes/`): Définissent les endpoints Express et utilisent `celebrate` pour la validation
2. **Middleware** (`middleware/`): Fonctions réutilisables (auth, sécurité, cache, upload)
3. **Services** (`services/`): Logique métier complexe (QR codes, optimisation images, stockage)
4. **Utils/DB** (`utils/db/`): Couche d'accès données avec Supabase client
5. **Jobs** (`jobs/`): Traitements en arrière-plan (stats, vues matérialisées)

---

## Guide de style du code

### Langue

- **Code et commentaires**: Principalement en français (convention établie)
- **Noms de variables/fonctions**: Anglais technique
- **Documentation**: Français

### Patterns obligatoires

1. **Toujours utiliser async/await** avec gestion d'erreurs try/catch
2. **Ne jamais exposer de secrets** dans le code (utiliser `.env`)
3. **Valider toutes les entrées** avec Joi/Celebrate
4. **Logger les actions critiques** avec Winston
5. **Utiliser des transactions** pour les opérations DB multiples
6. **Sanitiser les entrées** pour éviter injections XSS/SQL

### Exemple de structure de route

```javascript
router.get('/resource', authenticateToken, async (req, res) => {
  try {
    // Récupération avec vérification de propriété
    const resource = await service.findById(req.params.id);
    if (!resource || resource.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    
    res.json({ success: true, data: resource });
  } catch (error) {
    logger.error('Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
```

---

## Stratégie de test

### Tests avec Jest

```bash
# Tous les tests
npm test

# Watch mode
npm run test:watch

# Avec couverture
npm test -- --coverage
```

### Tests de charge avec k6

Les fichiers de test de charge sont dans `load-tests/`:
- `dashboard-load-test.js`: Teste les performances du dashboard
- `game-load-test.js`: Teste les performances des jeux

```bash
# Configuration requise: installer k6 (https://k6.io/docs/get-started/installation/)
npm run load-test:dashboard
```

### Bonnes pratiques de test

- Tests unitaires pour les fonctions critiques (QR codes, auth)
- Tests d'intégration pour les flux complets
- Tests de charge pour valider la scalabilité
- Seuils de performance: p(95) < 500ms pour les requêtes API

---

## Considérations de sécurité

### Authentification

- Tokens JWT stockés dans **cookies HTTP-only** (jamais localStorage)
- Rate limiting strict sur `/auth/*` (10 tentatives / 15 min en prod)
- Refresh tokens côté serveur avec rotation
- Validation de la force du JWT_SECRET (min 32 caractères)

### QR Codes

- Codes générés avec UUID v4 (non prévisibles, 122 bits d'entropie)
- Expiration automatique (configurable, défaut: 24h pour invités, 1 an pour familles)
- Validation côté serveur obligatoire
- Rate limiting spécifique (10 scans/minute en prod)
- Journal d'audit pour chaque génération/validation

### Uploads

- Validation du type MIME
- Limite de taille: 5MB images, 500MB vidéos
- Optimisation d'images avec Sharp avant stockage (WebP)
- Stockage sur R2 (pas sur le filesystem)
- Rate limiting: 20 uploads/heure par utilisateur

### Headers de sécurité

Helmet configuré avec:
- CSP strict avec directives spécifiques
- HSTS activé (2 ans, preload ready)
- Frameguard DENY (protection clickjacking)
- X-Content-Type-Options: nosniff
- Permissions-Policy restrictif

### Protection CSRF

- Vérification de l'origin/referer pour les requêtes POST/PUT/DELETE
- Autorisation stricte des origines en production
- Skip pour webhooks et endpoints publics

### Rate Limiting

Plusieurs niveaux de protection:
- `generalLimiter`: 200 req/15min (général)
- `authLimiter`: 10 tentatives/15min (authentification)
- `qrVerifyLimiter`: 10 scans/minute (QR codes)
- `uploadLimiter`: 20 uploads/heure (fichiers)
- `dashboardLimiter`: 60 req/minute (API dashboard)

### Injection SQL

Toutes les requêtes passent par le client Supabase qui utilise des requêtes paramétrées. Pas de concaténation SQL directe.

---

## Variables d'environnement

| Variable | Description | Requise |
|----------|-------------|---------|
| `PORT` | Port du serveur (défaut: 5000) | Non |
| `JWT_SECRET` | Clé secrète pour JWT (min 32 caractères) | **Oui** |
| `JWT_EXPIRE` | Durée de validité JWT (défaut: 1h) | Non |
| `SUPABASE_URL` | URL du projet Supabase | **Oui** |
| `SUPABASE_ANON_KEY` | Clé anonyme Supabase | **Oui** |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service Supabase | **Oui** |
| `SUPABASE_CONNECTION_STRING` | Chaîne de connexion PostgreSQL | **Oui** |
| `REDIS_URL` | URL Redis (défaut: redis://localhost:6379) | Non |
| `R2_ENDPOINT` | Endpoint Cloudflare R2 | Pour uploads |
| `R2_ACCESS_KEY_ID` | Access Key R2 | Pour uploads |
| `R2_SECRET_ACCESS_KEY` | Secret Key R2 | Pour uploads |
| `R2_BUCKET` | Nom du bucket R2 | Pour uploads |
| `R2_PUBLIC_URL` | URL publique R2 | Pour uploads |
| `ALLOWED_ORIGINS` | Origines CORS (séparées par virgules) | **Oui** en prod |
| `COOKIE_DOMAIN` | Domaine pour les cookies | **Oui** en prod |
| `BCRYPT_ROUNDS` | Tours de hachage bcrypt (défaut: 12) | Non |
| `LOG_LEVEL` | Niveau de log (debug/info/warn/error) | Non |
| `NODE_ENV` | Environnement (development/production) | Non |

---

## Modèle de base de données

### Tables principales

| Table | Description |
|-------|-------------|
| `users` | Comptes utilisateurs (organisateurs) |
| `events` | Événements de mariage |
| `guests` | Invités aux événements |
| `families` | Gestion des familles d'invités |
| `family_invitations` | Invitations par famille avec QR codes |
| `qr_codes` | Codes QR générés avec métadonnées |
| `attendance` | Suivi de présence |
| `games` | Jeux interactifs |
| `story_events` | Chronologie de l'histoire du couple |
| `wishes` | Vœux des invités |
| `feedback` | Livre d'or et témoignages |
| `seating_tables` | Plan de tables |
| `budget_items` | Gestion du budget événement |
| `messages` | Messages entre invités |
| `event_gallery` | Galerie photos/vidéos par événement |

### Index de performance

- `idx_events_organizer_active`: Événements actifs par organisateur
- `idx_events_date_active`: Événements par date
- `idx_guests_event_rsvp`: Guests par événement et statut RSVP
- `idx_qr_codes_code_valid`: QR codes valides (unicité rapide)
- `idx_attendance_timestamp_brin`: Index BRIN pour les données temporelles
- Vues matérialisées: `mv_event_summary`, `mv_qr_code_stats`, `mv_game_stats`

---

## Cache Redis

### Architecture multi-niveau

Le système de cache utilise une stratégie multi-niveau:
1. **Redis** (distribué) si disponible
2. **Mémoire** (Map) en fallback local

### TTL par type de données

```javascript
IntelligentCache.TTL = {
  USER_PROFILE: 300,      // 5 minutes
  EVENTS_LIST: 180,       // 3 minutes
  EVENT_DETAILS: 600,     // 10 minutes
  QR_VALIDATION: 30,      // 30 secondes
  DASHBOARD_STATS: 120,   // 2 minutes
  FAMILIES: 300,          // 5 minutes
  STATIC_DATA: 3600,      // 1 heure
};
```

### Utilisation

```javascript
const { userProfileCache, autoInvalidateCache } = require('./middleware/cacheMiddleware');

// Appliquer le cache sur une route GET
router.get('/profile', authenticateToken, userProfileCache, getProfile);

// Invalider automatiquement après mutation
router.put('/profile', authenticateToken, autoInvalidateCache('user_update'), updateProfile);
```

---

## Traitement d'images

### Optimisations disponibles

| Usage | Dimensions | Format | Qualité |
|-------|------------|--------|---------|
| Avatar | 500x500 | WebP | 80% |
| Cover | 1920x1080 | WebP | 85% |
| Banner | 1080x1920 (portrait) | WebP | 85% |
| Gallery | 1920x1920 | WebP | 90% |
| General | 1200x1200 | WebP | 85% |

### File d'attente Bull

Les uploads d'images sont traités en arrière-plan via Bull:
- Traitement asynchrone pour ne pas bloquer les requêtes
- 3 tentatives en cas d'échec avec backoff exponentiel
- Fallback au traitement immédiat si Redis indisponible

---

## Fichiers critiques à ne pas modifier sans précaution

1. **`middleware/security.js`** - Rate limiting et headers de sécurité
2. **`services/qrCodeService.js`** - Logique de génération QR (sécurité)
3. **`middleware/auth.js`** - Authentification JWT
4. **`config/config.js`** - Configuration sensible avec validation JWT
5. **Migrations SQL existantes** - Ne jamais modifier, créer de nouvelles migrations
6. **`server.js`** - Configuration de sécurité globale et middlewares

---

## Ressources supplémentaires

- `rules.md` - Règles de développement détaillées (sécurité, architecture)
- `QWEN.md` - Documentation détaillée du projet
- `README.md` - Guide d'installation rapide
- `SECURITY_FIXES.md` - Historique des corrections de sécurité
- `DATABASE_OPTIMIZATIONS.md` - Optimisations de base de données
- `MIGRATION_GUIDE.md` - Guide pour les migrations
- `examples/cache-usage-example.js` - Exemples d'utilisation du cache
