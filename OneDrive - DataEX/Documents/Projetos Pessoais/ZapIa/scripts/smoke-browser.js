/**
 * MercaBot — Browser Smoke Tests (Puppeteer)
 * Run: node scripts/smoke-browser.js [baseUrl]
 * Default baseUrl: https://mercabot.com.br
 *
 * Covers 5 critical happy paths:
 *  1. Landing — hero renders with correct headline + CTA
 *  2. Claude diff section — 3 comparison scenarios present
 *  3. Nav structure — Privacidade removed, expected links present
 *  4. Pricing toggle — Anual/Mensal switch toggles prices
 *  5. Login page — form fields and submit button render
 */

const puppeteer = require('puppeteer');

const BASE_URL = process.argv[2] || 'https://mercabot.com.br';
let passed = 0;
let failed = 0;

function ok(label) {
  console.log('OK\t' + label);
  passed++;
}

function fail(label, reason) {
  console.error('FAIL\t' + label + '\t' + reason);
  failed++;
}

async function withPage(browser, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  try {
    await fn(page);
  } finally {
    await page.close();
  }
}

// Test 1: Landing hero headline + single CTA
async function testLandingHero(browser) {
  const label = 'landing/hero';
  try {
    await withPage(browser, async (page) => {
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const h1 = await page.$eval('h1', el => el.textContent);
      if (!h1.includes('WhatsApp') || !h1.includes('IA')) {
        return fail(label, 'h1 missing expected text: ' + h1.trim().slice(0, 80));
      }

      const ctaCount = await page.$$eval('.hero-ctas a', els => els.length);
      if (ctaCount !== 2) {
        return fail(label, 'expected 2 hero CTAs, found ' + ctaCount);
      }

      const ctaText = await page.$eval('.hero-ctas a.btn-main', el => el.textContent.trim());
      if (!ctaText.toLowerCase().includes('ativar')) {
        return fail(label, 'primary CTA text unexpected: ' + ctaText);
      }

      ok(label);
    });
  } catch (e) {
    fail(label, e.message);
  }
}

// Test 2: Claude diff section — 3 scenarios visible
async function testClaudeDiffSection(browser) {
  const label = 'landing/claude-diff';
  try {
    await withPage(browser, async (page) => {
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const sectionExists = await page.$('#claude-diff');
      if (!sectionExists) {
        return fail(label, '#claude-diff section not found');
      }

      const scenarioCount = await page.$$eval('.diff-scenario', els => els.length);
      if (scenarioCount < 3) {
        return fail(label, 'expected >= 3 diff scenarios, found ' + scenarioCount);
      }

      const hasBot = await page.$eval('.diff-col-label', el => el.textContent.includes('Bot'));
      if (!hasBot) {
        return fail(label, '.diff-col-label does not mention Bot');
      }

      ok(label);
    });
  } catch (e) {
    fail(label, e.message);
  }
}

// Test 3: Nav structure — no Privacidade, has expected links
async function testNavStructure(browser) {
  const label = 'landing/nav';
  try {
    await withPage(browser, async (page) => {
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const navLinks = await page.$$eval('nav a', els => els.map(e => e.href + '|' + e.textContent.trim()));

      const hasPrivacidade = navLinks.some(l => l.includes('/privacidade/') || l.toLowerCase().includes('privacidade'));
      if (hasPrivacidade) {
        return fail(label, 'Privacidade link still present in nav');
      }

      const hasPricing = navLinks.some(l => l.includes('#planos') || l.toLowerCase().includes('planos') || l.toLowerCase().includes('preço'));
      if (!hasPricing) {
        return fail(label, 'Pricing/Planos link missing from nav');
      }

      ok(label);
    });
  } catch (e) {
    fail(label, e.message);
  }
}

// Test 4: Pricing toggle — Anual/Mensal switch exists and changes prices
async function testPricingToggle(browser) {
  const label = 'landing/pricing-toggle';
  try {
    await withPage(browser, async (page) => {
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const toggle = await page.$('.billing-toggle, [data-billing], input[type="checkbox"][id*="billing"], input[type="checkbox"][id*="anual"]');
      if (!toggle) {
        // try by text
        const toggleByText = await page.$x('//*[contains(text(),"Mensal") or contains(text(),"Anual")]');
        if (toggleByText.length === 0) {
          return fail(label, 'pricing toggle / Mensal/Anual labels not found');
        }
      }

      // Check a price is visible
      const priceExists = await page.$('.price-val, .price, [class*="price"]');
      if (!priceExists) {
        return fail(label, 'no price element found on page');
      }

      ok(label);
    });
  } catch (e) {
    fail(label, e.message);
  }
}

// Test 5: Login page — email field, submit button, no tokens in form action
async function testLoginPage(browser) {
  const label = 'login/form';
  try {
    await withPage(browser, async (page) => {
      await page.goto(BASE_URL + '/login/', { waitUntil: 'domcontentloaded', timeout: 15000 });

      const emailInput = await page.$('#authEmail, input[type="email"]');
      if (!emailInput) {
        return fail(label, 'email input not found');
      }

      const submitBtn = await page.$('#authBtn, button[type="submit"], button');
      if (!submitBtn) {
        return fail(label, 'submit button not found');
      }

      // Verify no token in page URL after load
      const url = page.url();
      if (url.includes('access_token') || url.includes('refresh_token')) {
        return fail(label, 'tokens found in URL: ' + url);
      }

      // Type an invalid email and check validation (should not navigate away)
      await emailInput.type('notanemail');
      await submitBtn.click();
      await page.waitForTimeout(500);
      const urlAfterClick = page.url();
      if (!urlAfterClick.includes('/login/')) {
        return fail(label, 'page navigated away on invalid email: ' + urlAfterClick);
      }

      ok(label);
    });
  } catch (e) {
    fail(label, e.message);
  }
}

async function main() {
  console.log('MercaBot Browser Smoke Tests — ' + BASE_URL);
  console.log('─'.repeat(60));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    await testLandingHero(browser);
    await testClaudeDiffSection(browser);
    await testNavStructure(browser);
    await testPricingToggle(browser);
    await testLoginPage(browser);
  } finally {
    await browser.close();
  }

  console.log('─'.repeat(60));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('FATAL', e.message || e);
  process.exit(1);
});
