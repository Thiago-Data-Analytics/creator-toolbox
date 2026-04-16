/**
 * extract-panel-js.js
 * Extracts all inline <script> blocks (excluding ld+json and src= scripts)
 * into an external JS file, then replaces them with a single deferred reference.
 *
 * Usage:
 *   node scripts/extract-panel-js.js <html-file> <output-js-file>
 *
 * Examples:
 *   node scripts/extract-panel-js.js painel-cliente/app/index.html painel-cliente/app/app.js
 *   node scripts/extract-panel-js.js painel-parceiro/index.html painel-parceiro/app.js
 *   node scripts/extract-panel-js.js index.html assets/main.js
 */

const fs   = require('fs');
const path = require('path');

const htmlRel = process.argv[2];
const jsRel   = process.argv[3];

if (!htmlRel || !jsRel) {
  console.error('Usage: node extract-panel-js.js <html-file> <output-js-file>');
  process.exit(1);
}

const HTML_PATH = path.resolve(__dirname, '..', htmlRel);
const JS_PATH   = path.resolve(__dirname, '..', jsRel);

const html = fs.readFileSync(HTML_PATH, 'utf8');

// Match inline <script> blocks:
// - No src= attribute
// - NOT type="application/ld+json" or type='application/ld+json'
const INLINE_SCRIPT_RE =
  /<script(?![^>]*(?:\bsrc\s*=|type\s*=\s*["']application\/ld\+json["']))[^>]*>([\s\S]*?)<\/script>/gi;

const jsChunks = [];
let match;
while ((match = INLINE_SCRIPT_RE.exec(html)) !== null) {
  const content = match[1].trim();
  if (content) jsChunks.push(content);
}

if (jsChunks.length === 0) {
  console.log('No inline script blocks found — nothing to extract.');
  process.exit(0);
}

// Compute src path relative to the HTML file's directory
const htmlDir  = path.dirname(HTML_PATH);
const jsSrcRel = '/' + path.relative(path.resolve(__dirname, '..'), JS_PATH).replace(/\\/g, '/');

// Write combined JS
const combined = jsChunks.join('\n\n');
fs.writeFileSync(JS_PATH, combined, 'utf8');
console.log(`Wrote ${combined.split('\n').length} lines (${combined.length} chars) across ${jsChunks.length} block(s) to ${jsRel}`);

// Remove all inline scripts (excluding ld+json), add single deferred external reference
INLINE_SCRIPT_RE.lastIndex = 0;
const cleaned = html
  .replace(INLINE_SCRIPT_RE, '')
  .replace(/<\/body>/, `<script src="${jsSrcRel}?v=20260415" defer></script>\n</body>`);

fs.writeFileSync(HTML_PATH, cleaned, 'utf8');
console.log(`Updated ${htmlRel}: removed inline scripts, added <script src="${jsSrcRel}?v=20260415" defer>`);
