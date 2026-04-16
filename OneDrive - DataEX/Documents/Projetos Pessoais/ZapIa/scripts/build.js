#!/usr/bin/env node
/**
 * Build script — minifies JS assets with esbuild.
 *
 * Usage:
 *   node scripts/build.js          # minify all assets in-place (adds .min.js alongside originals)
 *   node scripts/build.js --check  # dry-run: print size savings without writing files
 *
 * The minified files are written as <name>.min.js next to the originals.
 * HTML files reference the .min.js versions via query-string versioning.
 * The originals stay in the repo as readable source.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

// Files to minify. vendor/supabase.js is already a CDN bundle — skip.
const TARGETS = [
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

async function run() {
  let totalOriginal = 0;
  let totalMinified = 0;

  for (const rel of TARGETS) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP (not found): ${rel}`);
      continue;
    }

    const result = await esbuild.transform(fs.readFileSync(src, 'utf8'), {
      minify: true,
      target: 'es2017', // supports all modern browsers; IE11 not a target
    });

    const original = fs.statSync(src).size;
    const minified = Buffer.byteLength(result.code, 'utf8');
    const saving = ((1 - minified / original) * 100).toFixed(1);
    totalOriginal += original;
    totalMinified += minified;

    const dest = src.replace(/\.js$/, '.min.js');
    if (!CHECK) {
      fs.writeFileSync(dest, result.code, 'utf8');
    }

    console.log(
      `${CHECK ? '[dry]' : '[ok] '} ${rel.padEnd(36)} ${kb(original)} → ${kb(minified)} (${saving}% saved)`
    );
  }

  const totalSaving = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
  console.log('');
  console.log(`Total: ${kb(totalOriginal)} → ${kb(totalMinified)} (${totalSaving}% saved)`);
  if (CHECK) console.log('\nDry-run complete — no files written.');
  else console.log('\nDone. Reference *.min.js in HTML for production.');
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' kB';
}

run().catch(err => { console.error(err); process.exit(1); });
