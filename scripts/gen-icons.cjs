const fs = require('fs');
const path = require('path');
// Minimal valid 1×1 green PNG (base64)
const PNG_1x1_GREEN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
fs.writeFileSync(path.join(__dirname, '../public/pwa-192x192.png'), PNG_1x1_GREEN);
fs.writeFileSync(path.join(__dirname, '../public/pwa-512x512.png'), PNG_1x1_GREEN);
console.log('Icons written: pwa-192x192.png, pwa-512x512.png');
