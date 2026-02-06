require('dotenv').config();

// 🛡️ Validation stricte des variables d'environnement critiques
const validateConfig = () => {
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'JWT_SECRET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_ENDPOINT'
  ];

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // 🛡️ Vérifier que JWT_SECRET est suffisamment long et sécurisé
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security');
  }
  
  // 🛡️ Vérifier que JWT_SECRET n'est pas une valeur par défaut connue
  const weakSecrets = ['secret', 'password', '123456', 'jwt-secret', 'fallback'];
  if (weakSecrets.some(weak => jwtSecret.toLowerCase().includes(weak))) {
    throw new Error('JWT_SECRET appears to be a weak/default value. Please use a strong random string.');
  }

  // 🛡️ Vérifier BCRYPT_ROUNDS
  const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  if (bcryptRounds < 10) {
    console.warn('⚠️  Warning: BCRYPT_ROUNDS is less than 10. Consider increasing for better security.');
  }

  return { jwtSecret, bcryptRounds };
};

const { jwtSecret, bcryptRounds } = validateConfig();

// 🛡️ Configuration CORS stricte
const getAllowedOrigins = () => {
  if (process.env.NODE_ENV === 'production') {
    // En production, exiger une configuration explicite
    if (!process.env.ALLOWED_ORIGINS) {
      throw new Error('ALLOWED_ORIGINS must be defined in production mode');
    }
    return process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  }
  
  // En développement, permettre localhost
  return process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];
};

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  
  // 🛡️ JWT sécurisé - pas de fallback
  jwtSecret: jwtSecret,
  jwtExpire: process.env.JWT_EXPIRE || '1h', // 🛡️ Réduit à 1 heure max
  
  // Bcrypt
  bcryptRounds: bcryptRounds,
  
  // QR Code
  qrCodeLength: parseInt(process.env.QR_CODE_LENGTH) || 10,
  qrCodeExpirationHours: parseInt(process.env.QR_CODE_EXPIRATION_HOURS) || 24,
  
  // 🛡️ CORS sécurisé
  allowedOrigins: getAllowedOrigins(),
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Cloudflare R2
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2Bucket: process.env.R2_BUCKET,
  r2Endpoint: process.env.R2_ENDPOINT,
  r2PublicUrl: process.env.R2_PUBLIC_URL,
};
