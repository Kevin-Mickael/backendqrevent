# QR Event - Règles de développement

## 1. Sécurité des QR Codes
- Chaque QR code doit être **unique et non prévisible**.
- Ne jamais stocker ou exposer de données sensibles directement dans le QR code.
- Limiter la validité des QR codes (expiration automatique).
- Vérifier côté serveur que chaque QR code est utilisé **une seule fois** ou selon les règles de l’événement.
- Utiliser des algorithmes sécurisés pour générer les codes (UUID v4, hash sécurisé).

## 2. Authentification et gestion des sessions
- Ne jamais stocker de tokens d’authentification dans `localStorage`.
- Utiliser **cookies HTTP-only et Secure** pour stocker les tokens de session.
- Implémenter un **refresh token** côté serveur pour renouveler les sessions.
- Les endpoints sensibles doivent **toujours valider les tokens côté backend**, même si les routes sont protégées côté frontend.
- Prévoir une expiration courte pour les tokens d’accès et un mécanisme de revocation.

## 3. Cohérence Frontend / Backend
- Toutes les validations côté frontend doivent être répétées côté backend.
- Les structures de données doivent être identiques dans les deux couches.
- Les erreurs doivent être gérées de manière uniforme (codes HTTP, messages).

## 4. Gestion des codes
- Chaque code doit être isolé et lié à un événement spécifique.
- Éviter la duplication de codes.
- Utiliser des **transactions atomiques** pour l’écriture en base de données.
- Logger toutes les actions critiques liées aux codes (création, validation, expiration).

## 5. Architecture et isolation du code
- Séparer les responsabilités : routes → contrôleurs → services → modèles.
- Isoler les modules critiques :
  - Génération/validation des QR codes
  - Authentification et gestion des utilisateurs
  - Logs et audit
- Utiliser des middlewares pour gérer la sécurité et les permissions.

## 6. Scalabilité et performance
- Prévoir la montée en charge : support de plusieurs milliers d’utilisateurs simultanés.
- Optimiser les requêtes PostgreSQL (index, pagination, transactions).
- Utiliser un système de **cache** pour les données fréquemment consultées.
- Prévoir un clustering Node.js et load balancer pour la distribution des requêtes.

## 7. Bonnes pratiques Node.js
- Utiliser `async/await` et gérer toutes les erreurs.
- Ne jamais exposer les secrets dans le code (utiliser `.env`).
- Minimiser les dépendances et vérifier régulièrement les vulnérabilités (`npm audit`).
- Prévoir la récupération en cas d’erreurs critiques (retry, fallback).

## 8. Tests et QA
- Tests unitaires pour les fonctions critiques : QR code, auth, transactions.
- Tests d’intégration pour la communication frontend/backend.
- Tests de performance et de charge pour vérifier la scalabilité.
- Scanner régulièrement les vulnérabilités XSS, CSRF, injection SQL.

## 9. Documentation
- Documenter chaque module avec sa fonction et ses limites.
- Mettre à jour `rules.md` à chaque changement critique.
- Documenter les scénarios de montée en charge et stratégies de scalabilité.
