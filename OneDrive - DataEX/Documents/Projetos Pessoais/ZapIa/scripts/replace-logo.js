// replace-logo.js — troca o ícone de logo para Lightning Bubble em todo o site
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── O novo ícone (Lightning Bubble) ─────────────────────────────────────────
const NEW_MARK = `<svg class="logo-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true" width="26" height="26"><path d="M5 0h18a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H12L6 28l2.5-4H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z" fill="#00e676"/><path d="M17 4L9 16h6l-5 8 13-10h-6z" fill="#050c07" opacity=".85"/></svg>`;

// ── Diretórios a ignorar ─────────────────────────────────────────────────────
const IGNORE = ['.claude','node_modules','.wrangler','demo','worktrees','logos','scripts','backup'];

// ── Coleta todos os HTMLs recursivamente ─────────────────────────────────────
function collectHtml(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.some(i => entry.name === i)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full, list);
    else if (entry.name.endsWith('.html')) list.push(full);
  }
  return list;
}

// ── Substituições ────────────────────────────────────────────────────────────
let updated = 0;
let skipped = 0;

for (const file of collectHtml(ROOT)) {
  let src = fs.readFileSync(file, 'utf8');
  let out = src;

  // 1. Substitui qualquer SVG logo-mark existente pelo novo ícone
  out = out.replace(/<svg\s+class="logo-mark"[\s\S]*?<\/svg>/g, NEW_MARK);

  // 2. Para logos que só têm texto (sem SVG mark), insere o ícone antes do texto
  //    Padrão: ">Merca<span>Bot</span>" sem SVG mark imediatamente antes
  //    Só aplica quando o ícone ainda não está presente antes do texto
  out = out.replace(
    /(<a[^>]*class="logo"[^>]*>)(Merca<span>Bot<\/span>)/g,
    (match, openTag, wordmark) => `${openTag}${NEW_MARK}${wordmark}`
  );

  // 3. Para logos do tipo "logo-word" sem SVG (alguns SEO pages)
  //    Padrão: <a class="logo"...>\n  Merca<span>Bot</span>\n</a>
  out = out.replace(
    /(<a[^>]*class="logo"[^>]*>\s*)(Merca<span>Bot<\/span>)/g,
    (match, openTag, wordmark) => {
      if (openTag.includes('logo-mark') || match.includes('logo-mark')) return match;
      return `${openTag}${NEW_MARK}${wordmark}`;
    }
  );

  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    updated++;
    console.log(`[ok] ${path.relative(ROOT, file)}`);
  } else {
    skipped++;
  }
}

console.log(`\nDone. ${updated} updated, ${skipped} unchanged.`);
