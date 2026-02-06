const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./config');

// 🛡️ Créer le client S3 uniquement si R2 est configuré
let r2Client = null;

if (config.r2Endpoint && config.r2AccessKeyId && config.r2SecretAccessKey) {
  r2Client = new S3Client({
    region: 'auto',
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
} else {
  console.warn('[R2] Configuration incomplete. File uploads will be disabled.');
  console.warn('[R2] Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to enable.');
}

module.exports = {
  r2Client
};
