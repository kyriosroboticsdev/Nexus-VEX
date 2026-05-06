// build-web.js — packages Nexus as a self-contained web folder.
// Run with:  node build-web.js
// Outputs:
//   nexus-web/             — local fallback (open index.html in Chrome)
//   compile-server/public/ — served by Railway at the root URL

const fs   = require('fs');
const path = require('path');

const FILES = [
  'index.html',
  'app.js',
  'simulator.js',
  'config.js',
  'web-stub.js',
  'code.js',
  'notebook.html',
];

function copyTo(outDir) {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  FILES.forEach(f => {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, f));
      console.log('  copied', f, '→', path.relative(__dirname, outDir));
    } else {
      console.warn('  skipped (not found):', f);
    }
  });
}

// 1. Local fallback folder
copyTo(path.join(__dirname, 'nexus-web'));

// 2. Compile-server public folder (deployed to Railway)
copyTo(path.join(__dirname, 'compile-server', 'public'));

console.log('\nDone.');
console.log('  nexus-web/             — open index.html locally if needed');
console.log('  compile-server/public/ — commit + push to deploy on Railway');
