// fix-logo-color.js
// Problema: .logo span{color:var(--green)} pinta TODOS os spans dentro de .logo verde,
//           incluindo .logo-word, tornando "Merca" também verde.
// Fix:      Se já existe .logo-word span{color:...} → remove a regra .logo span duplicada.
//           Caso contrário → troca .logo span{color:...} por .logo-word>span{color:...}
//
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const IGNORE = ['.claude','node_modules','.wrangler','demo','worktrees','logos','scripts','backup'];

// Variações possíveis da regra errada
const BAD_VARIANTS = [
  /\.logo\s+span\s*\{\s*color\s*:\s*var\(--green\)\s*\}/g,
  /\.logo\s+span\s*\{\s*color\s*:#00e676\s*\}/g,
];

// Regra correta que deve existir
const HAS_CORRECT = /\.logo-word\s*(?:>?\s*)?span\s*\{\s*color/;

function processFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  let out = src;

  const hasCorrect = HAS_CORRECT.test(src);

  for (const re of BAD_VARIANTS) {
    if (hasCorrect) {
      // já existe regra correta → remove a errada completamente
      out = out.replace(re, '');
    } else {
      // não existe regra correta → converte para seletor específico
      out = out.replace(re, '.logo-word>span{color:var(--green)}');
    }
  }

  // limpa linhas em branco duplicadas resultantes da remoção
  out = out.replace(/\n{3,}/g, '\n\n');

  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    return true;
  }
  return false;
}

function collectFiles(dir, exts, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.some(i => entry.name === i)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, exts, list);
    else if (exts.some(e => entry.name.endsWith(e))) list.push(full);
  }
  return list;
}

let updated = 0;
for (const file of collectFiles(ROOT, ['.html', '.css'])) {
  if (processFile(file)) {
    updated++;
    console.log('[ok] ' + path.relative(ROOT, file));
  }
}
console.log(`\nDone. ${updated} arquivo(s) corrigido(s).`);
