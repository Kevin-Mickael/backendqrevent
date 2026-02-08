require('dotenv').config();

// 🛡️ SECURITY: Validate JWT Secret strength (ENHANCED)
function validateJwtSecret(secret) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  // Minimum length requirements
  const minLength = isProduction ? 64 : 32; // Production needs 64+ chars
  if (secret.length < minLength) {
    throw new Error(`JWT_SECRET must be at least ${minLength} characters long (current: ${secret.length})`);
  }
  
  // Check for development placeholder patterns
  const devPlaceholders = [
    /CHANGE_ME/i,
    /REPLACE_ME/i,
    /YOUR_SECRET/i,
    /PLACEHOLDER/i,
    /EXAMPLE/i,
    /DEFAULT/i,
  ];
  
  for (const pattern of devPlaceholders) {
    if (pattern.test(secret)) {
      throw new Error('JWT_SECRET contains placeholder text. Please generate a secure random secret.');
    }
  }
  
  // Check for common weak patterns
  const weakPatterns = [
    /^password/i,
    /^secret/i,
    /^admin/i,
    /^test/i,
    /^123456/,
    /^qwerty/i,
    /^(.)\1{5,}$/,  // Same character repeated 6+ times
    /^12345/,
    /^abcde/i,
  ];
  
  for (const pattern of weakPatterns) {
    if (pattern.test(secret)) {
      throw new Error('JWT_SECRET appears to be weak or common. Please use a strong, random secret.');
    }
  }
  
  // Enhanced entropy calculation
  const uniqueChars = new Set(secret).size;
  const entropy = uniqueChars / secret.length;
  
  // Strict entropy requirements for production
  const minEntropy = isProduction ? 0.6 : 0.5;
  if (entropy < minEntropy) {
    const message = `JWT_SECRET has low character diversity (${(entropy * 100).toFixed(1)}%). Use a random generator.`;
    if (isProduction) {
      throw new Error(message);
    } else {
      console.warn('⚠️ WARNING:', message);
    }
  }
  
  // Check for common hex patterns in production
  if (isProduction && /^[a-f0-9]+$/i.test(secret) && secret.length === 64) {
    // This is actually good - likely from openssl rand -hex 32
    console.log('✅ JWT_SECRET appears to be a secure hex string');
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
  // Frontend URL for QR codes and redirects
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};