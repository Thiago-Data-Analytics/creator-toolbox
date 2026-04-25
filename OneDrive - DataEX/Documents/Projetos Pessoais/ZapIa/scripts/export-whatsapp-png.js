// export-whatsapp-png.js — gera PNGs do ícone WhatsApp usando sharp
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const LOGOS = path.resolve(__dirname, '..', 'logos');

const exports_ = [
  { src: 'mercabot-whatsapp-icon-dark.svg', out: 'mercabot-whatsapp-dark-512.png', size: 512 },
  { src: 'mercabot-whatsapp-icon-dark.svg', out: 'mercabot-whatsapp-dark-300.png', size: 300 },
  { src: 'mercabot-whatsapp-icon.svg',      out: 'mercabot-whatsapp-light-512.png', size: 512 },
];

(async () => {
  for (const { src, out, size } of exports_) {
    const input  = path.join(LOGOS, src);
    const output = path.join(LOGOS, out);
    await sharp(fs.readFileSync(input))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(output);
    console.log(`[ok] ${out} (${size}x${size})`);
  }
  console.log('\nDone. PNGs em: logos/');
})();
