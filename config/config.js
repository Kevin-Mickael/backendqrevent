require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  jwtSecret: process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
  jwtExpire: process.env.JWT_EXPIRE || '1h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  qrCodeLength: parseInt(process.env.QR_CODE_LENGTH) || 10,
  qrCodeExpirationHours: parseInt(process.env.QR_CODE_EXPIRATION_HOURS) || 24,
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  logLevel: process.env.LOG_LEVEL || 'info',
  // Cloudflare R2 Configuration
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2Bucket: process.env.R2_BUCKET,
  r2Endpoint: process.env.R2_ENDPOINT,
  r2PublicUrl: process.env.R2_PUBLIC_URL,
};