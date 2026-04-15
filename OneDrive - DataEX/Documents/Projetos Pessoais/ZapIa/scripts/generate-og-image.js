/**
 * Gera og-image.png a partir de og-image-source.html
 * Uso: node scripts/generate-og-image.js
 * Requer: npx puppeteer (instala automaticamente se não existir)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

async function generate() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.log('Puppeteer não encontrado — instalando via npx...');
    const { execSync } = require('child_process');
    execSync('npm install puppeteer --save-dev', { stdio: 'inherit' });
    puppeteer = require('puppeteer');
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });

  const sourceFile = path.resolve(__dirname, '..', 'og-image-source.html');
  await page.goto('file://' + sourceFile, { waitUntil: 'networkidle0' });

  const outPath = path.resolve(__dirname, '..', 'og-image.png');
  await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });

  await browser.close();
  console.log('✅ og-image.png gerado em:', outPath);
}

generate().catch(err => {
  console.error('Erro ao gerar og-image.png:', err.message);
  process.exit(1);
});
