# 🔒 Corrections de Sécurité - QR Event Backend

Ce document résume les corrections de sécurité appliquées à l'application.

## 📋 Résumé des Corrections

### 1. ✅ Rate Limiting Auth Renforcé (CRITIQUE)
**Fichier:** `middleware/rateLimiter.js`

**Changements:**
- Ajout d'un `keyGenerator` composite (IP + Email) pour éviter les contournements
- Ajout d'un handler personnalisé avec logging des tentatives
- `skipSuccessfulRequests: true` pour ne pas pénaliser les utilisateurs légitimes
- Message d'erreur standardisé sans fuites d'informations

**Avant:**
```javascript
max: 5, // Uniquement par IP
```

**Après:**
```javascript
max: 5,
keyGenerator: (req) => {
  const email = req.body?.email?.toLowerCase()?.trim() || 'no-email';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  return `auth:${ip}:${email}`;
},
```

---

### 2. ✅ Stockage Redis pour Refresh Tokens (CRITIQUE)
**Fichier:** `middleware/refreshToken.js`

**Problème corrigé:** Les refresh tokens étaient stockés en mémoire (`Map`), ce qui causait :
- Perte des sessions au redémarrage
- Impossibilité de scaler horizontalement
- Pas de persistance

**Solution:** Migration vers Redis avec fallback mémoire

**Changements:**
- Stockage Redis avec TTL de 7 jours
- Token rotation (nouveau refresh token à chaque utilisation)
- Fallback mémoire si Redis indisponible
- Nettoyage automatique des tokens expirés

**Méthodes mises à jour:**
- `generateRefreshToken()` - maintenant async
- `verifyRefreshToken()` - maintenant async
- `revokeRefreshToken()` - suppression de Redis

---

### 3. ✅ Validation QR Code Stricte (CRITIQUE)
**Fichier:** `middleware/security.js`

**Problème corrigé:** Le middleware `validateQRCode` ne bloquait pas les requêtes invalides.

**Changements:**
- Vérification stricte de l'existence du QR code
- Regex validant uniquement alphanumérique 10-50 caractères
- Logging des tentatives suspectes
- Retour d'erreur 400 pour les QR codes invalides

---

### 4. ✅ Rate Limiting Général Renforcé (MAJEUR)
**Fichier:** `middleware/security.js`

**Changements:**
- Réduction des limites : Auth (10→8), QR verify (30→10), Upload (50→20)
- Handler personnalisé avec logging
- Clés par utilisateur authentifié quand disponible

**Nouvelles limites:**
| Endpoint | Avant | Après |
|----------|-------|-------|
| Auth | 10/15min | 8/15min |
| QR Verify | 30/min | 10/min |
| Upload | 50/heure | 20/heure |
| API générale | 150/15min | 100/15min |

---

### 5. ✅ CORS Durci (MAJEUR)
**Fichier:** `server.js`

**Changements:**
- Fonction `origin` avec vérification stricte en production
- Rejet des origines non autorisées en production
- Headers exposés limités (`X-New-Access-Token`)
- Logging des tentatives bloquées

---

### 6. ✅ Sanitisation des Logs (MAJEUR)
**Fichiers:** `utils/securityUtils.js` (nouveau), `server.js`, `routes/api.js`

**Nouvel utilitaire:** `sanitizeForLog()`

**Fonctionnalités:**
- Masquage des champs sensibles (password, token, secret, etc.)
- Troncation des strings longs (>500 caractères)
- Suppression des caractères de contrôle
- Traitement récursif des objets imbriqués

**Champs masqués automatiquement:**
- password, password_hash
- token, refresh_token, access_token
- secret, api_key, private_key
- credit_card, cvv, ssn

---

### 7. ✅ Cookies Sécurisés (MAJEUR)
**Fichiers:** `utils/session.js`, `controllers/authController.js`, `middleware/refreshToken.js`

**Changements:**
- Réduction de la durée des cookies session (30 jours → 24 heures)
- SameSite 'lax' en développement pour faciliter le dev cross-origin
- Domaine configurable via `COOKIE_DOMAIN`
- Options cohérentes sur tous les cookies (session, refresh)

---

### 8. ✅ Rate Limiting sur Uploads (MOYEN)
**Fichier:** `routes/api.js`

**Changements:**
- Ajout du `uploadLimiter` sur les routes `/api/upload`, `/api/upload/video`, `/api/upload/any`
- Limite de 20 uploads/heure par utilisateur

---

### 9. ✅ Validation Stricte des Champs (MOYEN)
**Fichiers:** `utils/securityUtils.js`, `routes/api.js`

**Nouvelles fonctions:**
- `sanitizeEventData()` - Nettoie les données d'événement
- `sanitizeString()` - Nettoie les strings utilisateur
- `sanitizeFilename()` - Nettoie les noms de fichiers
- `detectSQLInjection()` - Détecte les injections SQL
- `detectXSS()` - Détecte les tentatives XSS
- `suspiciousActivityDetector` - Middleware de détection

**Protection contre:**
- Path traversal (`../`)
- Headers suspects
- Champs non autorisés dans les requêtes

---

### 10. ✅ Détecteur d'Activités Suspectes (MOYEN)
**Fichier:** `utils/securityUtils.js`, `server.js`

**Middleware:** `suspiciousActivityDetector`

**Détecte:**
- Headers de méthode override suspects
- Tentatives de path traversal
- Logging des activités suspectes

---

### 11. ✅ Remplacement des console.log par Logger (MAJEUR)
**Fichiers:** `routes/api.js`, `routes/games-public.js`

**Problème corrigé:** Les `console.log` et `console.error` pouvaient exposer des informations sensibles et n'étaient pas persistés.

**Changements:**
- Tous les `console.log` remplacés par `logger.info()`
- Tous les `console.error` remplacés par `logger.error()`
- Sanitisation des données avant logging
- Suppression des références à `console`

---

### 12. ✅ Masquage des Messages d'Erreur (MAJEUR)
**Fichier:** `routes/api.js`

**Problème corrigé:** Les messages d'erreur du serveur (`error.message`) étaient exposés au client, risquant de fuir des informations sensibles.

**Changements:**
- En production: message générique "Server error..."
- En développement: `error.message` accessible pour le debug
- Pattern: `config.nodeEnv === 'development' ? error.message : 'Generic message'`

---

### 13. ✅ Validation des IDs et Chemins (CRITIQUE)
**Fichier:** `utils/validationUtils.js` (nouveau)

**Problème corrigé:** Les IDs utilisés dans les chemins de fichiers n'étaient pas validés, permettant potentiellement du path traversal.

**Nouvelles fonctions:**
- `isValidEventId()` - Valide le format UUID/ObjectId
- `isValidUserId()` - Valide les IDs utilisateur
- `isValidQRCode()` - Valide le format des QR codes
- `sanitizeFolderPath()` - Sanitise les chemins de dossiers
- `buildSecurePath()` - Construit des chemins sécurisés
- `validateEventIdParam` - Middleware de validation

**Protection:**
- Suppression des `../` et `..\`
- Validation des caractères autorisés
- Limite de longueur des chemins

---

### 14. ✅ Service Redis pour Queues (MAJEUR)
**Fichier:** `services/redisService.js` (nouveau)

**Problème corrigé:** Des références à `redisService` et `imageProcessingQueue` étaient utilisées mais non définies, causant des erreurs.

**Solution:**
- Création d'un service Redis réutilisable
- Stub pour `imageProcessingQueue` avec fallback
- Gestion des erreurs de connexion Redis

---

## 🔧 Configuration Requise

### Variables d'environnement à ajouter dans `.env`:

```bash
# Cookie Domain (optionnel, pour les sous-domaines)
COOKIE_DOMAIN=.qrevent.com

# Redis (déjà configuré mais vérifier)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# CORS Origins (stricte en production)
ALLOWED_ORIGINS=https://app.qrevent.com,https://admin.qrevent.com
```

---

## ✅ Vérification Post-Déploiement

```bash
# 1. Vérifier la syntaxe
node -c server.js
node -c middleware/refreshToken.js

# 2. Tester le rate limiting
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}'
# Répéter 6 fois pour vérifier le blocage

# 3. Tester la validation QR code
curl -X POST http://localhost:5000/api/verify-qr/invalid!<script>
# Doit retourner 400 Bad Request

# 4. Vérifier que Redis est utilisé pour les refresh tokens
redis-cli KEYS "refresh_token:*"
```

---

## 🎯 Recommandations Futures

1. **Ajouter un WAF** (Web Application Firewall) type Cloudflare
2. **Implémenter la détection d'anomalies** (login depuis nouvelle IP, etc.)
3. **Configurer les alertes** pour les tentatives de brute force
4. **Auditer régulièrement** avec `npm audit`
5. **Activer HSTS** en production (déjà configuré dans Helmet)

---

## 📊 Statistiques

| Métrique | Valeur |
|----------|--------|
| Fichiers modifiés | 10 |
| Nouveaux fichiers | 3 (`utils/securityUtils.js`, `utils/validationUtils.js`, `services/redisService.js`) |
| Vulnérabilités critiques corrigées | 4 |
| Vulnérabilités majeures corrigées | 7 |
| Vulnérabilités moyennes corrigées | 3 |

---

**Date des corrections:** 2026-02-06  
**Version:** 1.2.0-security  
**Statut:** ✅ Terminé
