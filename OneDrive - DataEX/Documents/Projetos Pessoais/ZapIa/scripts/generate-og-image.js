/**
 * Gera og-image.png (1200×630) a partir de og-image-source.html via Puppeteer.
 * Uso: node scripts/generate-og-image.js
 * Puppeteer já é devDependency do projeto (package.json).
 */
'use strict';
const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'og-image-source.html');
const OUT = path.resolve(__dirname, '..', 'og-image.png');

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('❌ og-image-source.html não encontrado:', SRC);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // Retina 2× para nitidez máxima
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });

    // Carrega o HTML local (sem dependências externas)
    await page.goto('file://' + SRC, { waitUntil: 'load', timeout: 10000 });

    await page.screenshot({
      path: OUT,
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });

    const { size } = fs.statSync(OUT);
    console.log(`✅ og-image.png gerado — ${Math.round(size / 1024)} kB`);
    console.log('   →', OUT);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('❌ Falha ao gerar og-image.png:', err.message);
  process.exit(1);
});
