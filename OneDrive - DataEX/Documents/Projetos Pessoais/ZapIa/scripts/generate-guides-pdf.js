/**
 * Gera os 2 PDFs profissionais (Cliente + Parceiro) a partir dos HTMLs em /docs.
 * Uso: node scripts/generate-guides-pdf.js
 * Puppeteer já é devDependency.
 */
'use strict';
const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const TARGETS = [
  { src: 'guia-cliente-source.html',  out: 'MercaBot-Guia-Cliente.pdf' },
  { src: 'guia-parceiro-source.html', out: 'MercaBot-Guia-Parceiro.pdf' },
  { src: 'guia-escopo-source.html',   out: 'MercaBot-Escopo-Faz-NaoFaz.pdf' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const t of TARGETS) {
      const srcPath = path.join(DOCS, t.src);
      const outPath = path.join(DOCS, t.out);
      if (!fs.existsSync(srcPath)) {
        console.error('❌ HTML não encontrado:', srcPath);
        continue;
      }
      const page = await browser.newPage();
      // Desktop hi-DPI viewport — mantém qualidade do render mesmo em A4
      await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
      await page.goto('file://' + srcPath, { waitUntil: 'networkidle0', timeout: 30000 });

      await page.pdf({
        path: outPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: true,
      });

      const { size } = fs.statSync(outPath);
      console.log(`✅ ${t.out} — ${(size / 1024).toFixed(0)} kB`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('❌ Falha ao gerar PDFs:', err.message);
  process.exit(1);
});
