/**
 * extract-panel-js.js
 * Extracts all inline <script> blocks from painel-cliente/app/index.html
 * into painel-cliente/app/app.js, then replaces them with a single
 * <script src="app.js"></script> reference.
 *
 * Run: node scripts/extract-panel-js.js
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'painel-cliente', 'app', 'index.html');
const JS_PATH   = path.join(__dirname, '..', 'painel-cliente', 'app', 'app.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');

// Match every <script> block that has NO src= attribute (inline scripts only)
// Captures the inner content between <script...> and </script>
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

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

// Write combined JS to app.js
const combined = jsChunks.join('\n\n');
fs.writeFileSync(JS_PATH, combined, 'utf8');
console.log(`Wrote ${combined.length} chars across ${jsChunks.length} blocks to app.js`);

// Replace ALL inline <script>...</script> blocks with a single external reference
// placed just before </body>
const cleaned = html.replace(INLINE_SCRIPT_RE, '').replace(/<\/body>/, '<script src="app.js"></script>\n</body>');
fs.writeFileSync(HTML_PATH, cleaned, 'utf8');
console.log('Updated index.html — inline scripts removed, app.js reference added before </body>');
console.log('Done. Verify the painel loads correctly before deploying.');
