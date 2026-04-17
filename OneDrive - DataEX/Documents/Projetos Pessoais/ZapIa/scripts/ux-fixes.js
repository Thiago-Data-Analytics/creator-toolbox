#!/usr/bin/env node
// UX Audit Fixes — PR #33
// Applies all copy/UX improvements across PT, ES, EN

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function rep(src, old, neo, label) {
  const idx = src.indexOf(old);
  if (idx === -1) {
    console.error('  NOT FOUND [' + (label||old.slice(0,50)) + ']');
    return src;
  }
  console.log('  OK  [' + (label||old.slice(0,50)) + ']');
  return src.slice(0, idx) + neo + src.slice(idx + old.length);
}

function repAll(src, old, neo, label) {
  if (!src.includes(old)) {
    console.error('  NOT FOUND (repAll) [' + (label||old) + ']');
    return src;
  }
  console.log('  OK* [' + (label||old) + ']');
  return src.split(old).join(neo);
}

// ─────────────────────────────────────────────
// PT
// ─────────────────────────────────────────────
console.log('\n=== PT (index.html) ===');
let pt = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

pt = rep(pt,
  '<span id="camp-counter">Configuração guiada + ativação digital na implantação</span>',
  '<span id="camp-counter">Seu bot no ar no mesmo dia · configuração guiada incluída</span>',
  'topbar text'
);

pt = rep(pt,
  '<h1>Seu <span class="hl-term">WhatsApp</span><br>atende 24h.<br>Com <em>IA real.</em></h1>',
  '<h1>Seu <span class="hl-term">WhatsApp</span>.<br>Nunca mais<br>sem resposta.</h1>',
  'hero H1'
);

pt = rep(pt,
  '<p class="hero-sub">Sua equipe responde as mesmas perguntas todo dia. Clientes somem fora do horário. A MercaBot entra no número oficial da sua empresa com <span class="anthropic-brand"><span class="anthropic-logo" aria-hidden="true"></span><span class="anthropic-term">Claude</span></span> da <span class="anthropic-term">Anthropic</span> no backend — e resolve os dois, sem depender de técnico.</p>',
  '<p class="hero-sub">IA generativa no número que seus clientes já conhecem.<br>Atendimento 24h, sem técnico, sem mudar de canal.</p>',
  'hero subtitle'
);

pt = rep(pt,
  'Sem fidelidade · R$197/mês · ativo no mesmo dia',
  '7 dias grátis · R$197/mês · sem fidelidade · ativo no mesmo dia',
  'hero trust line'
);

pt = rep(pt,
  '<h2 class="section-title" style="text-align:center">Escolha o plano certo para o seu momento<br>e ative com acompanhamento simples.</h2>',
  '<h2 class="section-title" style="text-align:center">Comece hoje. Teste por 7 dias.<br>Cancele quando quiser.</h2>',
  'pricing H2'
);

pt = rep(pt,
  '<div class="popular-badge">Mais escolhido</div>',
  '<div class="popular-badge">Mais escolhido · 7 dias grátis</div>',
  'pro badge'
);

pt = repAll(pt, 'Central digital da conta', 'Painel da conta', 'central digital da conta');
pt = repAll(pt, 'Central digital de ajuda', 'Central de ajuda', 'central digital de ajuda');
pt = repAll(pt, 'Central digital para parceiros', 'Painel para parceiros', 'central digital parceiros');
pt = repAll(pt, 'central digital da operação', 'painel da conta', 'central digital operação');
pt = repAll(pt, 'uma central digital para tocar a operação sem depender de intervenção manual',
  'um painel centralizado para tocar a operação sem depender de intervenção manual', 'central digital FAQ');

pt = rep(pt,
  '<p>Sim. A equipe da empresa pode assumir quando necessário, conforme a configuração ativa e o ambiente implantado para a conta.</p>',
  '<p>Sim. Qualquer pessoa da equipe pode entrar na conversa e assumir o atendimento. O bot para automaticamente quando um humano assume — e retoma quando a equipe sai, se você configurar assim.</p>',
  'FAQ Q3 answer'
);

pt = rep(pt,
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">Como funciona o Plano Parceiro (agências e revendedores)?',
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">Tem fidelidade ou multa se eu cancelar?',
  'FAQ Q9 question'
);
pt = rep(pt,
  '<p>Você revende o serviço com a sua marca, nos seus preços e com estrutura para usar domínio próprio. O parceiro ganha um painel central para organizar clientes, materiais prontos para implantação, white-label guiado e um painel centralizado para tocar a operação sem depender de intervenção manual.</p>',
  '<p>Não. Nenhuma fidelidade, nenhuma multa. Você pode cancelar a qualquer momento pelo painel da sua conta, sem ligar para ninguém, sem justificar. Os primeiros 7 dias são de avaliação — se não funcionar para o seu negócio, cancele e não paga nada.</p>',
  'FAQ Q9 answer'
);

// Remove testimonials block
const tsStart = '<!-- TESTIMONIALS -->';
const tsEnd   = '<!-- REFERRAL PROGRAM -->';
const tsi = pt.indexOf(tsStart);
const tei = pt.indexOf(tsEnd);
if (tsi !== -1 && tei !== -1) {
  pt = pt.slice(0, tsi) + pt.slice(tei);
  console.log('  OK  [testimonials removed]');
} else {
  console.error('  NOT FOUND [testimonials block]', tsi, tei);
}

pt = rep(pt,
  'Sem fidelidade · R$197/mês · cancelamento a qualquer momento',
  '7 dias grátis · R$197/mês · cancele quando quiser · configura em 10 minutos',
  'final CTA trust line'
);

pt = rep(pt,
  '<li><a href="/suporte/#aviso-ia">Aviso IA</a></li>',
  '<li><a href="/suporte/#aviso-ia">Política de IA</a></li>',
  'footer aviso IA'
);

pt = rep(pt,
  '<small style="font-size:var(--fs-sm);color:var(--faint);display:block;margin-top:.5rem;text-align:center">© 2026 MercaBot Tecnologia Ltda.</small>',
  '<small style="font-size:var(--fs-sm);color:var(--faint);display:block;margin-top:.5rem;text-align:center">© 2026 MercaBot Tecnologia Ltda. · contato@mercabot.com.br</small>',
  'footer email PT'
);

// Mobile proof bar CSS fix (5 items → grid 2+2+1)
pt = rep(pt,
  '@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}}',
  '@media(max-width:600px){.founders-grid{grid-template-columns:1fr!important}.proof-bar{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}.proof-item:last-child{grid-column:1/-1;text-align:center}}',
  'proof bar mobile CSS'
);

fs.writeFileSync(path.join(ROOT, 'index.html'), pt, 'utf8');
console.log('PT saved ✓');

// ─────────────────────────────────────────────
// ES
// ─────────────────────────────────────────────
console.log('\n=== ES (es/index.html) ===');
let es = fs.readFileSync(path.join(ROOT, 'es/index.html'), 'utf8');

es = rep(es,
  '<span>Configuración guiada + activación digital en la puesta en marcha</span>',
  '<span>Tu bot en el aire hoy · configuración guiada incluida</span>',
  'topbar text'
);

es = rep(es,
  '<p class="hero-sub">Tu empresa no tiene que elegir entre atender bien y ganar escala. En el <strong><span class="hl-term">WhatsApp</span> que tu cliente ya usa, MercaBot organiza la operación, responde con <span class="hl-term">IA</span></strong> y deja al equipo de la empresa libre para entrar donde realmente aporta valor. Con modelos <span class="anthropic-brand"><span class="anthropic-logo" aria-hidden="true"></span><span class="anthropic-term">Claude</span></span> de <span class="anthropic-term">Anthropic</span> operando en el backend, cada conversación se vuelve más clara, más útil y más cercana a una venta bien llevada.</p>',
  '<p class="hero-sub">IA generativa en el número que tus clientes ya conocen.<br>Atención 24h, sin técnico, sin cambiar de canal.</p>',
  'hero subtitle'
);

// Add hero trust line (ES has no trust line — insert after last CTA link, before closing </div>)
es = rep(es,
  '    <a href="#como-funciona" class="btn-ghost">Ver cómo funciona →</a>\n    <a href="https://api.mercabot.com.br/whatsapp/abrir?text=Hola%2C%20MercaBot.%20Quiero%20resolver%20dudas%20sobre%20el%20producto%20y%20entender%20qu%C3%A9%20plan%20encaja%20mejor%20con%20mi%20negocio.&source=site-es&lang=es" class="mbwa-inline secondary" target="_blank" rel="noopener">Hablar por WhatsApp</a>\n  </div>',
  '    <a href="#como-funciona" class="btn-ghost">Ver cómo funciona →</a>\n    <a href="https://api.mercabot.com.br/whatsapp/abrir?text=Hola%2C%20MercaBot.%20Quiero%20resolver%20dudas%20sobre%20el%20producto%20y%20entender%20qu%C3%A9%20plan%20encaja%20mejor%20con%20mi%20negocio.&source=site-es&lang=es" class="mbwa-inline secondary" target="_blank" rel="noopener">Hablar por WhatsApp</a>\n  </div>\n  <p style="font-size:.9rem;color:var(--faint);margin-top:1.1rem;position:relative;z-index:2">7 días gratis · desde $49 USD/mes · sin permanencia · activo el mismo día</p>',
  'hero trust line (add)'
);

es = rep(es,
  '<h2 class="section-title" style="text-align:center">Elige el plan correcto para tu momento<br>y empieza sin complicarte.</h2>',
  '<h2 class="section-title" style="text-align:center">Empieza hoy. Prueba 7 días.<br>Cancela cuando quieras.</h2>',
  'pricing H2'
);

es = rep(es,
  '<div class="popular-badge">Más elegido</div>',
  '<div class="popular-badge">Más elegido · 7 días gratis</div>',
  'pro badge'
);

// Remove testimonials (ES)
const tsLabel_es = '    <p class="section-label">Testimonios</p>';
const tsAfter_es = '<!-- WHY VALUE ES -->';
const tsi_es = es.lastIndexOf('<section', es.indexOf(tsLabel_es));
const tei_es = es.indexOf(tsAfter_es);
if (tsi_es !== -1 && tei_es !== -1) {
  es = es.slice(0, tsi_es) + es.slice(tei_es);
  console.log('  OK  [testimonials removed]');
} else {
  console.error('  NOT FOUND [testimonials ES]', tsi_es, tei_es);
}

es = repAll(es, 'central digital', 'panel de cuenta', 'central digital (all ES)');
es = repAll(es, 'Central digital', 'Panel de cuenta', 'Central digital (all ES)');

es = rep(es,
  '<p>Sí. La atención humana puede tomar la conversación cuando sea necesario, según la configuración activa del entorno.</p>',
  '<p>Sí. Cualquier persona del equipo puede entrar y tomar la conversación en cualquier momento. El bot se detiene automáticamente cuando un humano asume — y retoma si el equipo sale, si lo configuras así.</p>',
  'FAQ Q3 answer'
);

es = rep(es,
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">¿Cómo funciona la reventa del chatbot para WhatsApp (plan Agencia)?',
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">¿Hay permanencia o multa si cancelo?',
  'FAQ last question'
);
es = rep(es,
  '<p>Revendes el servicio con tu marca, con tus precios y con estructura para usar dominio propio. Accedes a un panel central para gestionar clientes, activar white-label guiado, usar materiales listos y seguir la operación desde una panel de cuenta. Ideal para agencias y consultoras que quieren vender automatización sin construir tecnología propia.</p>',
  '<p>No. Sin permanencia ni penalización. Puedes cancelar en cualquier momento desde el panel de tu cuenta, sin llamar a nadie ni dar explicaciones. Los primeros 7 días son de evaluación — si no funciona para tu negocio, cancela y no se te cobra nada.</p>',
  'FAQ last answer'
);

es = rep(es,
  'Sin permanencia · cancelación por entorno autenticado o centro digital',
  '7 días gratis · desde $49 USD/mes · cancela cuando quieras · listo el mismo día',
  'final CTA trust line'
);

es = rep(es,
  '<li><a href="/soporte/#aviso-ia">Aviso IA</a></li>',
  '<li><a href="/soporte/#aviso-ia">Política de IA</a></li>',
  'footer aviso IA'
);

fs.writeFileSync(path.join(ROOT, 'es/index.html'), es, 'utf8');
console.log('ES saved ✓');

// ─────────────────────────────────────────────
// EN
// ─────────────────────────────────────────────
console.log('\n=== EN (en/index.html) ===');
let en = fs.readFileSync(path.join(ROOT, 'en/index.html'), 'utf8');

en = rep(en,
  '<span>Guided setup + digital activation at launch — no developer needed</span>',
  '<span>Your bot live today · guided setup included · no developer needed</span>',
  'topbar text'
);

en = rep(en,
  "  <p class=\"hero-sub\">Your business doesn't have to choose between serving customers well and growing at scale. On the <strong><span class=\"hl-term\">WhatsApp</span> your customers already use, MercaBot organizes the operation, responds with <span class=\"hl-term\">AI</span></strong> and frees your team to step in where they truly add value. Powered by <span class=\"anthropic-brand\"><span class=\"anthropic-logo\" aria-hidden=\"true\"></span><span class=\"anthropic-term\">Claude</span></span> models from <span class=\"anthropic-term\">Anthropic</span>, every conversation becomes clearer, more useful and closer to a well-handled sale.</p>",
  "  <p class=\"hero-sub\">Generative AI on the number your customers already know.<br>24/7 service, no developer, no channel switch.</p>",
  'hero subtitle'
);

// Add trust line after last CTA (before closing </div>\n</section>)
en = rep(en,
  "    <a href=\"https://api.mercabot.com.br/whatsapp/abrir?text=Hi%2C%20MercaBot.%20I'd%20like%20to%20learn%20about%20the%20product%20and%20understand%20which%20plan%20fits%20my%20business.&source=site-en&lang=en\" class=\"btn-ghost\" style=\"border-color:rgba(0,230,118,.3);color:var(--green)\" target=\"_blank\" rel=\"noopener\">Chat on WhatsApp</a>\n  </div>\n</section>",
  "    <a href=\"https://api.mercabot.com.br/whatsapp/abrir?text=Hi%2C%20MercaBot.%20I'd%20like%20to%20learn%20about%20the%20product%20and%20understand%20which%20plan%20fits%20my%20business.&source=site-en&lang=en\" class=\"btn-ghost\" style=\"border-color:rgba(0,230,118,.3);color:var(--green)\" target=\"_blank\" rel=\"noopener\">Chat on WhatsApp</a>\n  </div>\n  <p style=\"font-size:.9rem;color:var(--faint);margin-top:1.1rem;position:relative;z-index:2\">7-day free trial · from $49 USD/mo · no lock-in · live same day</p>\n</section>",
  'hero trust line (add)'
);

en = rep(en,
  '<h2 class="section-title" style="text-align:center">Choose the right plan for where you are<br>and get started without the headache.</h2>',
  '<h2 class="section-title" style="text-align:center">Start today. Try free for 7 days.<br>Cancel anytime.</h2>',
  'pricing H2'
);

en = rep(en,
  '<div class="popular-badge">Most popular</div>',
  '<div class="popular-badge">Most popular · 7 days free</div>',
  'pro badge'
);

// Remove testimonials (EN)
const tsLabel_en = '    <p class="section-label">Testimonials</p>';
const tsAfter_en = '<!-- WHY VALUE EN -->';
const tsi_en = en.lastIndexOf('<section', en.indexOf(tsLabel_en));
const tei_en = en.indexOf(tsAfter_en);
if (tsi_en !== -1 && tei_en !== -1) {
  en = en.slice(0, tsi_en) + en.slice(tei_en);
  console.log('  OK  [testimonials removed]');
} else {
  console.error('  NOT FOUND [testimonials EN]', tsi_en, tei_en);
}

en = repAll(en, 'or digital hub', 'or account panel', 'digital hub → account panel');
en = repAll(en, 'from a digital hub', 'from the account panel', 'from a digital hub');
en = repAll(en, 'digital hub', 'account panel', 'digital hub remaining');

en = rep(en,
  '<p>Yes. A human agent can take over any conversation at any time, according to the active configuration of the environment.</p>',
  '<p>Yes. Anyone on your team can step into a conversation and take over at any time. The bot pauses automatically when a human steps in — and resumes when the team steps out, if you configure it that way.</p>',
  'FAQ Q3 answer'
);

en = rep(en,
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">How does the Partner / agency reselling plan work?',
  '<div class="faq-item"><button type="button" class="faq-q" aria-expanded="false">Is there a contract or cancellation fee?',
  'FAQ last question'
);
en = rep(en,
  '<p>You resell the service under your own brand, at your own prices, with custom domain support. You get a central panel to manage clients, activate guided white-label, use ready-made sales materials and monitor the operation from the account panel. Ideal for agencies and consultancies that want to sell automation without building their own technology.</p>',
  "<p>No. No lock-in, no cancellation fee. You can cancel any time from your account panel, without calling anyone or giving a reason. The first 7 days are a free trial — if it's not right for your business, cancel and you won't be charged anything.</p>",
  'FAQ last answer'
);

en = rep(en,
  'No lock-in · cancel from authenticated environment or account panel',
  '7-day free trial · from $49/mo · no lock-in · cancel anytime · live same day',
  'final CTA trust line'
);

fs.writeFileSync(path.join(ROOT, 'en/index.html'), en, 'utf8');
console.log('EN saved ✓');
console.log('\nAll files updated.');
