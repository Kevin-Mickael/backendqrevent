require('dotenv').config();

// 🛡️ SECURITY: Validate JWT Secret strength
function validateJwtSecret(secret) {
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security');
  }
  
  // Check for common weak patterns
  const weakPatterns = [
    /^password/i,
    /^secret/i,
    /^admin/i,
    /^test/i,
    /^123456/,
    /^qwerty/i,
    /^(.)\1+$/,  // Same character repeated
  ];
  
  for (const pattern of weakPatterns) {
    if (pattern.test(secret)) {
      throw new Error('JWT_SECRET appears to be weak or common. Please use a strong, random secret.');
    }
  }
  
  // Calculate entropy (rough estimate)
  const uniqueChars = new Set(secret).size;
  const entropy = uniqueChars / secret.length;
  if (entropy < 0.5 && secret.length < 64) {
    console.warn('⚠️ WARNING: JWT_SECRET has low character diversity. Consider using a longer or more random secret.');
  }
  
  return secret;
}

const jwtSecret = validateJwtSecret(process.env.JWT_SECRET);

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  jwtSecret: jwtSecret,
  jwtExpire: process.env.JWT_EXPIRE || '24h',  // 🛡️ SECURITY FIX: Max 24h as per rules.md
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