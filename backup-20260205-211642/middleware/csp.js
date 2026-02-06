const helmet = require('helmet');

// Configuration CSP (Content Security Policy) pour renforcer la sécurité
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'", // Nécessaire pour Next.js en développement
      "https://cdn.vercel-insights.com",
      "https://vercel.live",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://www.googleadservices.com",
      "https://googleads.g.doubleclick.net",
      "https://www.facebook.com",
      "https://connect.facebook.net"
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'", // Autoriser les styles inline pour Tailwind CSS
      "https://fonts.googleapis.com"
    ],
    imgSrc: [
      "'self'",
      "data:", // Autoriser les images data URIs
      "blob:", // Autoriser les blob URLs
      "https://www.google-analytics.com",
      "https://www.googleadservices.com",
      "https://googleads.g.doubleclick.net",
      "https://www.facebook.com",
      "https://cdn.dribbble.com",
      "https://www.google.com",
      "https://pub-1f346dbddb2b41169a36239ebd6d4408.r2.dev", // R2 Storage
      "https://*.r2.dev", // Tous les domaines R2
      "https://*.r2.cloudflarestorage.com", // R2 S3 API
      "https://*.cloudflarestorage.com" // Cloudflare Storage
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com",
      "data:" // Autoriser les polices data URIs
    ],
    connectSrc: [
      "'self'",
      "https://www.google-analytics.com",
      "https://stats.g.doubleclick.net",
      "https://api.qrevent.com", // Remplacez par votre domaine API
      "http://localhost:5000", // Pour le développement
      "https://vercel-insights.com"
    ],
    frameSrc: [
      "'self'",
      "https://www.google.com",
      "https://www.youtube.com",
      "https://www.facebook.com"
    ],
    objectSrc: ["'none'"], // Bloquer les plugins comme Flash
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"], // Empêcher l'intégration dans des iframes
  },
  // Signaler les violations de CSP
  reportOnly: false,
};

// Middleware pour appliquer la politique de sécurité
const securityMiddleware = helmet({
  contentSecurityPolicy: cspConfig,
  dnsPrefetchControl: {
    allow: true
  },
  referrerPolicy: {
    policy: ['origin-when-cross-origin']
  },
  permittedCrossDomainPolicies: {
    permittedPolicies: 'none'
  },
  // Désactiver X-Powered-By header
  hidePoweredBy: true,
});

module.exports = securityMiddleware;