#!/usr/bin/env node
/**
 * Build script — minifies JS assets with esbuild and stamps content-hash filenames.
 *
 * Usage:
 *   node scripts/build.js          # minify all assets → foo.{hash8}.min.js
 *   node scripts/build.js --check  # dry-run: print savings + hashes without writing
 *
 * Output:
 *   - assets/login.abc12345.min.js  (hash = first 8 chars of SHA-256 of minified content)
 *   - scripts/asset-manifest.json   (mapping: source → hashed output, consumed by update-refs.js)
 *
 * Old hashed variants (assets/login.*.min.js) are deleted before writing the new one.
 * The originals (assets/login.js) stay in the repo as readable source.
 */

const esbuild = require('esbuild');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const ROOT          = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'asset-manifest.json');
const CHECK         = process.argv.includes('--check');

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
  'vendor/auth-utils.js',
  'vendor/sentry.js',
];

/** First 8 hex chars of SHA-256 of content string. */
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Delete all <baseName>.min.js and <baseName>.<8hex>.min.js files in dir.
 * Silently ignores errors (e.g. file not found on first run).
 */
function deleteOldFiles(dir, baseName) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  const pattern = new RegExp(`^${baseName}(?:\\.[a-f0-9]{8})?\\.min\\.js$`);
  for (const f of files) {
    if (pattern.test(f)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ }
    }
  }
}

async function run() {
  let totalOriginal = 0;
  let totalMinified = 0;
  const manifest    = {};

  for (const rel of TARGETS) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP (not found): ${rel}`);
      continue;
    }

    const result = await esbuild.transform(fs.readFileSync(src, 'utf8'), {
      minify: true,
      target: 'es2017',
    });

    const original = fs.statSync(src).size;
    const minified = Buffer.byteLength(result.code, 'utf8');
    const saving   = ((1 - minified / original) * 100).toFixed(1);
    totalOriginal += original;
    totalMinified += minified;

    const hash       = hashContent(result.code);
    const dir        = path.dirname(src);
    const baseName   = path.basename(rel, '.js');          // e.g. 'login'
    const hashedFile = `${baseName}.${hash}.min.js`;       // e.g. 'login.abc12345.min.js'
    // Normalise to forward slashes for use as URL paths
    const hashedRel  = rel.replace(/\.js$/, '').replace(/\\/g, '/').split('/').slice(0, -1).concat(hashedFile).join('/');
    // e.g. 'assets/login.abc12345.min.js'

    manifest[rel] = hashedRel;

    if (!CHECK) {
      deleteOldFiles(dir, baseName);
      fs.writeFileSync(path.join(dir, hashedFile), result.code, 'utf8');
    }

    console.log(
      `${CHECK ? '[dry]' : '[ok] '} ${rel.padEnd(36)} ${kb(original)} → ${kb(minified)} (${saving}% saved) → ${hashedFile}`
    );
  }

  if (!CHECK) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`\n✅ Manifest: scripts/asset-manifest.json`);
  }

  const totalSaving = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
  console.log(`\nTotal: ${kb(totalOriginal)} → ${kb(totalMinified)} (${totalSaving}% saved)`);
  if (CHECK) console.log('\nDry-run complete — no files written.');
  else       console.log('Done. Run update-refs.js to stamp HTML references.');
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' kB'; }

run().catch(err => { console.error(err); process.exit(1); });
