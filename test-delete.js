require('dotenv').config();
const storageService = require('./services/storageService');

async function testDelete() {
  // Remplace par l'URL d'un ancien avatar que tu veux tester
  const testUrl = 'https://pub-1f346dbddb2b41169a36239ebd6d4408.r2.dev/avatars/ANCIEN_FICHIER.webp';
  
  console.log('Testing delete for:', testUrl);
  await storageService.deleteFile(testUrl);
  console.log('Delete test complete');
}

testDelete().catch(console.error);
