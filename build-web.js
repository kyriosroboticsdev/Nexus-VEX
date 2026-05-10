// build-web.js — packages Nexus as a self-contained web folder.
// Run with:  node build-web.js
// Outputs:
//   nexus-web/             — local fallback (open index.html in Chrome)
//   compile-server/public/ — served by Railway at the root URL

const fs   = require('fs');
const path = require('path');

// Files sourced from the project root
const ROOT_FILES = [
  'index.html',
  'app.js',
  'simulator.js',
  'config.js',
  'web-stub.js',
  'code.js',
  'three.min.js',
];

// Files that live in nexus-web/ (read before we touch the output dir)
const NEXUS_WEB_FILES = [
  'notebook.html',
  'docx.js',
];

function buildPublicDir(outDir) {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  ROOT_FILES.forEach(f => {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, f));
      console.log('  copied', f, '→', path.relative(__dirname, outDir));
    } else {
      console.warn('  skipped (not found):', f);
    }
  });

  NEXUS_WEB_FILES.forEach(f => {
    const src = path.join(__dirname, 'nexus-web', f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, f));
      console.log('  copied nexus-web/' + f, '→', path.relative(__dirname, outDir));
    } else {
      console.warn('  skipped (not found): nexus-web/' + f);
    }
  });
}

function syncNexusWebDir() {
  // nexus-web/ is the source for notebook.html / docx.js; only sync root files into it.
  const outDir = path.join(__dirname, 'nexus-web');
  fs.mkdirSync(outDir, { recursive: true });
  ROOT_FILES.forEach(f => {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, f));
      console.log('  updated', f, '→ nexus-web');
    } else {
      console.warn('  skipped (not found):', f);
    }
  });
}

// 1. Update root files inside nexus-web/ (notebook.html/docx.js already live there)
syncNexusWebDir();

// 2. Build compile-server/public/ from both root files and nexus-web/ files
buildPublicDir(path.join(__dirname, 'compile-server', 'public'));

console.log('\nDone.');
console.log('  nexus-web/             — open index.html locally if needed');
console.log('  compile-server/public/ — commit + push to deploy on Railway');
