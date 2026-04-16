#!/usr/bin/env node
/**
 * Rewrites HTML script src references to point at *.min.js.
 * Only touches top-level project files — ignores demo/, .claude/, index_prev_backup.html.
 *
 * Run: node scripts/update-refs.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// JS files we minified (relative to root, without leading slash)
const MINIFIED = [
  'assets/access.js',
  'assets/demo.js',
  'assets/login.js',
  'assets/main-en.js',
  'assets/main-es.js',
  'assets/main.js',
  'assets/signup.js',
  'assets/whatsapp-sales.js',
  'vendor/sentry.js',
];

// HTML files to update (relative to root)
const HTML_FILES = [
  'index.html',
  'acesso/index.html',
  'login/index.html',
  'cadastro/index.html',
  'demo/index.html',
  'en/index.html',
  'es/index.html',
  'faq/index.html',
  'soporte/index.html',
  'suporte/index.html',
];

let totalFiles = 0;
let totalReplacements = 0;

for (const rel of HTML_FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;

  let content = fs.readFileSync(file, 'utf8');
  let replacements = 0;

  for (const js of MINIFIED) {
    // Match /assets/foo.js or /assets/foo.js?v=xxx  (not already .min.js)
    const escaped = js.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(/${escaped})(\\?[^"'\\s>]*)?(["'\\s>])`, 'g');
    const before = content;
    content = content.replace(re, (match, src, qs, end) => {
      const minSrc = src.replace(/\.js$/, '.min.js');
      return minSrc + (qs || '') + end;
    });
    if (content !== before) replacements++;
  }

  if (replacements > 0) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`[ok]  ${rel.padEnd(30)} (${replacements} ref${replacements > 1 ? 's' : ''} updated)`);
    totalFiles++;
    totalReplacements += replacements;
  }
}

console.log(`\nDone. ${totalFiles} files, ${totalReplacements} references updated.`);
