const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./config');

// Créer un client S3 pour Cloudflare R2
const r2Client = new S3Client({
  region: 'auto', // R2 utilise 'auto' comme région
  endpoint: config.r2Endpoint,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

module.exports = {
  r2Client
};