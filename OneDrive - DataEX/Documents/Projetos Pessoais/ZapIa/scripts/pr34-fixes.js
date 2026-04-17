#!/usr/bin/env node
/**
 * PR #34 — Consistency & polish fixes
 *
 * 1. Proof bar mobile grid fix → es/index.html, en/index.html
 *    (same 5-item 2×2+1 layout already applied to PT in PR #33)
 *
 * 2. Worker "central digital" → linguagem consistente
 *    cloudflare-worker.js  (3 ocorrências)
 *
 * 3. Meta description / OG — menciona "7 dias grátis" e copy atualizado
 *    index.html, es/index.html, en/index.html
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let changes = 0;

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function save(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  console.log('[ok]  ' + rel);
}

function rep(content, from, to, label) {
  if (!content.includes(from)) {
    console.warn('[WARN] NOT FOUND: ' + label);
    return content;
  }
  changes++;
  return content.replace(from, to);
}

function repAll(content, from, to, label) {
  if (!content.includes(from)) {
    console.warn('[WARN] NOT FOUND: ' + label);
    return content;
  }
  changes++;
  return content.split(from).join(to);
}

// ─────────────────────────────────────────────────────────────
// 1. Proof bar mobile grid fix — ES
// ─────────────────────────────────────────────────────────────
{
  let c = load('es/index.html');
  // Detect line ending
  const crlf = c.includes('\r\n');
  const nl = crlf ? '\r\n' : '\n';

  // The founders-grid fix is on its own media query line; append proof-bar grid rules to it
  const from = `@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}}`;
  const to   = `@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}.proof-bar{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}.proof-item:last-child{grid-column:1/-1;text-align:center}}`;
  c = rep(c, from, to, 'es proof-bar grid');
  save('es/index.html', c);
}

// ─────────────────────────────────────────────────────────────
// 2. Proof bar mobile grid fix — EN
// ─────────────────────────────────────────────────────────────
{
  let c = load('en/index.html');
  const from = `@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}}`;
  const to   = `@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}.proof-bar{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}.proof-item:last-child{grid-column:1/-1;text-align:center}}`;
  c = rep(c, from, to, 'en proof-bar grid');
  save('en/index.html', c);
}

// ─────────────────────────────────────────────────────────────
// 3. Worker "central digital" cleanup
// ─────────────────────────────────────────────────────────────
{
  let c = load('cloudflare-worker.js');

  // 3a. Error message for cancellation flow
  c = rep(c,
    `Use a central digital para seguir com o cancelamento.`,
    `Acesse o painel da conta para seguir com o cancelamento.`,
    'worker cancelamento central digital'
  );

  // 3b. Email body link text
  c = rep(c,
    `central digital da operação</a> para seguir pelo próximo passo.`,
    `central de ajuda</a> para o próximo passo.`,
    'worker email onboarding central digital'
  );

  // 3c. Billing failure email body text
  c = rep(c,
    `no portal do cliente ou siga pela central digital da operação.`,
    `no portal do cliente ou acesse a <a href="https://mercabot.com.br/suporte/" style="color:#f59e0b">central de ajuda</a>.`,
    'worker billing email central digital'
  );

  // 3d. Billing email footer note
  c = rep(c,
    `Central digital em mercabot.com.br/suporte`,
    `Suporte em mercabot.com.br/suporte`,
    'worker billing footer central digital'
  );

  save('cloudflare-worker.js', c);
}

// ─────────────────────────────────────────────────────────────
// 4. Meta descriptions — adiciona "7 dias grátis", linguagem atual
// ─────────────────────────────────────────────────────────────

// PT
{
  let c = load('index.html');

  c = rep(c,
    `content="Chatbot para WhatsApp com IA generativa real. Automatize atendimento, vendas e qualificação de leads com ativação guiada, sem código e com operação no número oficial da empresa."`,
    `content="Chatbot para WhatsApp com IA generativa real. 7 dias grátis, sem fidelidade. Atendimento 24h automatizado, sem técnico e no número que seus clientes já conhecem."`,
    'pt meta description'
  );

  c = rep(c,
    `content="MercaBot — Chatbot para WhatsApp com IA | Atendimento Automatizado com Ativação Guiada"`,
    `content="MercaBot — Chatbot para WhatsApp com IA | 7 Dias Grátis · Atendimento 24h Automatizado"`,
    'pt og:title'
  );

  c = rep(c,
    `content="Chatbot para WhatsApp com IA que vende e atende com ativação guiada, sem código e no número oficial da empresa."`,
    `content="Chatbot de IA para WhatsApp que atende 24h, sem técnico e sem mudar de número. 7 dias grátis, cancele quando quiser."`,
    'pt og:description'
  );

  c = repAll(c,
    `content="Chatbot de IA para WhatsApp que vende e atende com ativação guiada, sem código e no número oficial da empresa."`,
    `content="Chatbot de IA para WhatsApp que atende 24h, sem técnico e sem mudar de número. 7 dias grátis, cancele quando quiser."`,
    'pt twitter:description'
  );

  save('index.html', c);
}

// ES
{
  let c = load('es/index.html');

  c = rep(c,
    `content="Chatbot para WhatsApp con IA generativa real. Automatiza atención, ventas y calificación de leads con activación guiada, sin código y en el número oficial de la empresa."`,
    `content="Chatbot para WhatsApp con IA generativa real. 7 días gratis, sin permanencia. Atención 24h automatizada, sin técnico y en el número que tus clientes ya conocen."`,
    'es meta description'
  );

  c = rep(c,
    `content="MercaBot — Chatbot para WhatsApp con IA | Atención Automatizada con Activación Guiada"`,
    `content="MercaBot — Chatbot para WhatsApp con IA | 7 Días Gratis · Atención 24h Automatizada"`,
    'es og:title'
  );

  c = repAll(c,
    `content="Chatbot para WhatsApp con IA que vende y atiende con activación guiada, sin código y en el número oficial de la empresa."`,
    `content="Chatbot de IA para WhatsApp que atiende 24h, sin técnico y sin cambiar de número. 7 días gratis, cancela cuando quieras."`,
    'es og:description + twitter:description'
  );

  save('es/index.html', c);
}

// EN
{
  let c = load('en/index.html');

  c = rep(c,
    `content="WhatsApp AI chatbot with real generative AI. Automate customer service, sales and lead qualification with guided activation — no code, on your official business number."`,
    `content="WhatsApp AI chatbot with real generative AI. 7-day free trial, no lock-in. 24/7 automated service, no developer, on the number your customers already know."`,
    'en meta description'
  );

  c = rep(c,
    `content="MercaBot — WhatsApp AI Chatbot | Automated Customer Service with Guided Activation"`,
    `content="MercaBot — WhatsApp AI Chatbot | 7-Day Free Trial · 24/7 Automated Service"`,
    'en og:title'
  );

  c = repAll(c,
    `content="WhatsApp AI chatbot that sells and serves with guided activation — no code, on your official business number."`,
    `content="WhatsApp AI chatbot that serves 24/7, no developer, no number change. 7-day free trial, cancel anytime."`,
    'en og:description + twitter:description'
  );

  save('en/index.html', c);
}

console.log(`\nTotal de alterações aplicadas: ${changes}`);
