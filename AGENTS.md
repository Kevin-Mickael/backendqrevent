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
- API RESTful
- Intégration Supabase (PostgreSQL + Auth)
- Optimisation d'images en arrière-plan avec Bull/Redis
- Mise en cache avec Redis

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

---

## Structure des dossiers

```
backend/
├── config/              # Configuration (Supabase, R2, app config)
│   ├── config.js        # Variables d'environnement
│   ├── supabase.js      # Clients Supabase (anon + service)
│   ├── r2.js            # Configuration Cloudflare R2
│   └── redis.js         # Configuration Redis
├── controllers/         # Gestionnaires de requêtes
│   └── authController.js
├── middleware/          # Middleware personnalisé
│   ├── auth.js          # Authentification JWT
│   ├── security.js      # Rate limiting, Helmet, validation QR
│   ├── cacheMiddleware.js # Middleware de cache Redis
│   ├── upload.js        # Multer pour uploads images
│   ├── uploadVideo.js   # Multer pour uploads vidéos
│   └── refreshToken.js  # Gestion des refresh tokens
├── migrations/          # Scripts de migration SQL
│   ├── 001_create_tables.sql
│   ├── 002_add_couple_names.sql
│   └── ... (21 migrations au total)
├── routes/              # Définitions des routes API
│   ├── api.js           # Routes principales (événements, invités, jeux)
│   ├── auth.js          # Routes d'authentification
│   ├── games-public.js  # Routes publiques pour jeux
│   └── seating-tables.js # Plan de tables
├── services/            # Logique métier
│   ├── qrCodeService.js # Génération/validation QR codes
│   ├── storageService.js # Upload vers R2
│   ├── imageService.js  # Optimisation d'images avec Sharp
│   └── imageOptimizationQueue.js # File d'attente Bull
├── utils/               # Fonctions utilitaires
│   ├── logger.js        # Winston logger
│   ├── cache.js         # Client Redis avec helpers
│   ├── database.js      # Export des modules DB
│   └── db/              # Modèles de base de données
│       ├── users.js
│       ├── events.js
│       ├── guests.js
│       ├── qrCodes.js
│       └── ... (18 fichiers)
├── jobs/                # Traitements en arrière-plan
│   ├── gameStatsProcessor.js
│   └── refreshMaterializedViews.js
├── scripts/             # Scripts utilitaires
│   ├── run-migration.js
│   └── monitor-performance.js
├── examples/            # Exemples de code
│   └── cache-usage-example.js
├── logs/                # Fichiers de log (non versionnés)
├── server.js            # Point d'entrée principal
└── package.json
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
npm run seed           # Peupler la base avec données de test
npm run db:check       # Vérifier l'état de la base

# Tests
npm test               # Exécuter les tests Jest
npm run test:watch     # Mode watch

# Qualité de code
npm run lint           # ESLint

# Jobs en arrière-plan
npm run jobs:game-stats        # Traiter les stats de jeux
npm run jobs:refresh-views     # Rafraîchir les vues matérialisées
npm run jobs:refresh-views:daemon # Mode daemon

# Tests de charge (nécessite k6)
npm run load-test:dashboard
npm run load-test:game
```

---

## Architecture du code

### Flux de requête

```
Requête HTTP
    ↓
Middleware de sécurité (Helmet, Rate limiting)
    ↓
CORS
    ↓
Middleware d'authentification (JWT depuis cookie)
    ↓
Validation (Celebrate/Joi)
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

### Conventions de nommage

- Fichiers: `camelCase.js` ou `nom-descriptif.js`
- Routes API: `kebab-case` (ex: `/api/events/:eventId/story-events`)
- Tables DB: `snake_case` (ex: `qr_codes`, `story_events`)
- Variables: `camelCase` en JavaScript, `snake_case` en SQL

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
    console.error('Error:', error);
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
- `dashboard-load-test.js`
- `game-load-test.js`

```bash
npm run load-test:dashboard
```

### Bonnes pratiques de test

- Tests unitaires pour les fonctions critiques (QR codes, auth)
- Tests d'intégration pour les flux complets
- Tests de charge pour valider la scalabilité

---

## Considérations de sécurité

### Authentification

- Tokens JWT stockés dans **cookies HTTP-only** (jamais localStorage)
- Rate limiting strict sur `/auth/*` (8 tentatives / 15 min)
- Refresh tokens côté serveur

### QR Codes

- Codes générés avec UUID v4 (non prévisibles, 122 bits d'entropie)
- Expiration automatique (configurable, défaut: 24h)
- Validation côté serveur obligatoire
- Rate limiting spécifique (30 scans/minute)

### Uploads

- Validation du type MIME
- Limite de taille: 5MB images, 500MB vidéos
- Optimisation d'images avec Sharp avant stockage
- Stockage sur R2 (pas sur le filesystem)

### Headers de sécurité

Helmet est configuré avec:
- CSP strict
- HSTS activé
- Frameguard DENY
- X-Content-Type-Options: nosniff

### Injection SQL

Toutes les requêtes passent par le client Supabase qui utilise des requêtes paramétrées.

---

## Variables d'environnement

| Variable | Description | Requise |
|----------|-------------|---------|
| `PORT` | Port du serveur (défaut: 5000) | Non |
| `JWT_SECRET` | Clé secrète pour JWT | **Oui** |
| `JWT_EXPIRE` | Durée de validité JWT (défaut: 24h) | Non |
| `SUPABASE_URL` | URL du projet Supabase | **Oui** |
| `SUPABASE_ANON_KEY` | Clé anonyme Supabase | **Oui** |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service Supabase | **Oui** |
| `REDIS_URL` | URL Redis (défaut: redis://localhost:6379) | Non |
| `R2_*` | Credentials Cloudflare R2 | Pour uploads |
| `ALLOWED_ORIGINS` | Origines CORS (séparées par virgule) | Non |
| `LOG_LEVEL` | Niveau de log (debug/info/warn/error) | Non |

---

## Modèle de base de données

### Tables principales

| Table | Description |
|-------|-------------|
| `users` | Comptes utilisateurs (organisateurs) |
| `events` | Événements de mariage |
| `guests` | Invités aux événements |
| `qr_codes` | Codes QR générés |
| `attendance` | Suivi de présence |
| `families` | Gestion des familles d'invités |
| `games` | Jeux interactifs |
| `story_events` | Chronologie de l'histoire du couple |
| `wishes` | Vœux des invités |
| `feedback` | Livre d'or et témoignages |
| `seating_tables` | Plan de tables |

### Index de performance

Les migrations incluent des index sur:
- `events.organizer_id`
- `guests.event_id`, `guests.email`
- `qr_codes.code`
- `attendance.event_id`, `attendance.timestamp`

Des vues matérialisées sont utilisées pour optimiser le dashboard.

---

## Cache Redis

### Utilisation

Le cache est utilisé pour:
- Profils utilisateurs (`user:${userId}`)
- Listes d'événements (`events:${organizerId}`)
- Stats dashboard (`dashboard:${organizerId}`)

### API du cache

```javascript
const cache = require('./utils/cache');

// Récupération avec fallback
const data = await cache.getOrSet('key', async () => {
  return await fetchFromDb();
}, 300); // TTL: 5 minutes

// Invalidation
await cache.del('key');
await cache.delPattern('events:*');
```

Voir `examples/cache-usage-example.js` pour plus d'exemples.

---

## Fichiers critiques à ne pas modifier sans précaution

1. **`middleware/security.js`** - Rate limiting et headers de sécurité
2. **`services/qrCodeService.js`** - Logique de génération QR (sécurité)
3. **`middleware/auth.js`** - Authentification JWT
4. **`config/config.js`** - Configuration sensible
5. **Migrations SQL existantes** - Ne jamais modifier, créer de nouvelles migrations

---

## Ressources supplémentaires

- `rules.md` - Règles de développement (sécurité, architecture)
- `QWEN.md` - Documentation détaillée du projet
- `README.md` - Guide d'installation rapide
- `examples/cache-usage-example.js` - Exemples d'utilisation du cache
