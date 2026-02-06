# QR Event - Contexte et architecture

## Objectif
QR Event est une application web pour **générer et valider des QR codes** pour des événements. L’objectif est de garantir :

- La sécurité des codes et des sessions
- Une expérience utilisateur fluide
- Une application scalable pour **plusieurs milliers d’utilisateurs simultanés**
- Une architecture modulable et robuste

## Technologies
- Backend : Node.js + Express
- Base de données : PostgreSQL
- Frontend : React / Next.js
- Authentification : JWT stocké dans **cookies HTTP-only**
- QR Code : `qrcode` npm package ou solution custom sécurisée
- Cache : Redis pour les données fréquemment consultées

## Concepts clés

### 1. QR Codes sécurisés
- Codes uniques et isolés par événement
- Durée de validité limitée
- Vérification obligatoire côté serveur avant usage
- Logs pour toutes les actions liées aux QR codes

### 2. Architecture modulaire
- Pattern : Routes → Contrôleurs → Services → Modèles
- Modules critiques isolés :
  - Génération / validation QR codes
  - Authentification et gestion utilisateurs
  - Logging / audit
- Possibilité de remplacer ou étendre chaque module sans impacter le reste de l’app

### 3. Authentification sécurisée
- Stockage des tokens dans **cookies HTTP-only et Secure**
- Refresh token côté serveur pour sessions longues
- Validation des tokens sur **tous les endpoints sensibles**
- Expiration courte des tokens d’accès
- Protection contre XSS et CSRF

### 4. Cohérence Frontend / Backend
- Validation des données côté backend pour toute opération critique
- Erreurs standardisées (codes HTTP et messages)
- Synchronisation stricte des structures de données

### 5. Scalabilité multi-utilisateur
- Optimisation des requêtes PostgreSQL (index, transactions, pagination)
- Mise en cache des données fréquemment utilisées
- Clustering Node.js et load balancing
- Possibilité de microservices pour les modules critiques (QR, auth, logs)

### 6. Observabilité
- Logs détaillés pour audit et débogage
- Monitoring des performances et alertes sur erreurs critiques
- Tests de charge réguliers pour identifier les goulots d’étranglement

### Notes importantes
- Sécurité et scalabilité sont prioritaires sur la performance brute.
- Isolation stricte des fonctionnalités critiques pour éviter les effets de bord.
- Documenter toute modification majeure d’architecture ou de règles.
