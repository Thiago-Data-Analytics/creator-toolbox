// fix-logo-order.js — corrige a ordem logo-word → logo-mark para logo-mark → logo-word
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE = ['.claude','node_modules','.wrangler','demo','worktrees','logos','scripts','backup'];

const NEW_MARK = `<svg class="logo-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true" width="26" height="26"><path d="M5 0h18a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H12L6 28l2.5-4H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z" fill="#00e676"/><path d="M17 4L9 16h6l-5 8 13-10h-6z" fill="#050c07" opacity=".85"/></svg>`;

function collectHtml(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.some(i => entry.name === i)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full, list);
    else if (entry.name.endsWith('.html')) list.push(full);
  }
  return list;
}

let updated = 0;

for (const file of collectHtml(ROOT)) {
  let src = fs.readFileSync(file, 'utf8');
  let out = src;

  // Padrão: logo-word ANTES do logo-mark → inverte para mark ANTES de word
  // Handles: whitespace/newlines between the two elements
  out = out.replace(
    /(<span class="logo-word">Merca<span>Bot<\/span><\/span>)([\s\n\r]*)(<svg class="logo-mark"[\s\S]*?<\/svg>)/g,
    (match, word, space, svg) => `${svg}${word}`
  );

  // Also fix: logo-word with trailing whitespace before SVG (multiline)
  out = out.replace(
    /(<span class="logo-word">Merca<span>Bot<\/span><\/span>\s*\n\s*)(<svg class="logo-mark"[\s\S]*?<\/svg>)/g,
    (match, word, svg) => `${svg}\n  ${word.trim()}`
  );

  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    updated++;
    console.log(`[ok] ${path.relative(ROOT, file)}`);
  }
}

console.log(`\nDone. ${updated} reordered.`);
