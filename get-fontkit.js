#!/usr/bin/env node
/**
 * Run this ONCE to download fontkit for local use:
 *   node get-fontkit.js
 * 
 * After running, open index.html directly in browser (file://)
 * and full Cyrillic support will work.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const URL  = 'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.js';
const DEST = path.join(__dirname, 'fontkit.js');

if (fs.existsSync(DEST)) {
  console.log('✅ fontkit.js already exists!');
  process.exit(0);
}

console.log('Downloading fontkit from CDN...');
https.get(URL, res => {
  if (res.statusCode !== 200) {
    console.error('❌ HTTP', res.statusCode);
    process.exit(1);
  }
  const chunks = [];
  res.on('data', d => chunks.push(d));
  res.on('end', () => {
    fs.writeFileSync(DEST, Buffer.concat(chunks));
    console.log('✅ fontkit.js saved! (' + Math.round(fs.statSync(DEST).size/1024) + 'KB)');
    console.log('Now open index.html in your browser.');
  });
}).on('error', e => {
  console.error('❌ Download failed:', e.message);
  process.exit(1);
});
