#!/usr/bin/env node
// Copies browser builds of the runtime libraries from node_modules to vendor/.
// Run after changing versions in package.json:  npm install && npm run vendor
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = {
  'pdf-lib.min.js':     'pdf-lib/dist/pdf-lib.min.js',
  'fontkit.min.js':     '@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'pdf.min.js':         'pdfjs-dist/build/pdf.min.js',
  'pdf.worker.min.js':  'pdfjs-dist/build/pdf.worker.min.js',
  'jszip.min.js':       'jszip/dist/jszip.min.js',
};

fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
for (const [dest, src] of Object.entries(files)) {
  const from = require.resolve(src, { paths: [root] });
  fs.copyFileSync(from, path.join(root, 'vendor', dest));
  console.log(`vendor/${dest}  ←  ${src}  (${Math.round(fs.statSync(from).size / 1024)} KB)`);
}

// Fonts pdf.js needs for templates that use non-embedded standard fonts
// (fetched lazily, only when such a template is opened).
const sf = path.join(path.dirname(require.resolve('pdfjs-dist/package.json', { paths: [root] })), 'standard_fonts');
fs.cpSync(sf, path.join(root, 'vendor', 'standard_fonts'), { recursive: true });
console.log('vendor/standard_fonts/  ←  pdfjs-dist/standard_fonts');
