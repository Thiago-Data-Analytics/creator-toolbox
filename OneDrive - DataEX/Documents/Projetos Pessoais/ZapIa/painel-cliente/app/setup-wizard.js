/* MercaBot Setup Wizard — setup-wizard.js
   Full-screen step-by-step onboarding wizard.
   Exposes window.MBWizard = { init, destroy }
   Compatible: ES5 var, no arrow functions, no ES6 modules.
*/
(function(global) {
  'use strict';

  var DONE_KEY = 'mb_setup_wizard_done_v2';
  var DRAFT_KEY = 'mb_wiz_draft';

  /* ─── CSS ─────────────────────────────────────────────────────────────── */
  var CSS = [
    '.mbwiz-overlay{position:fixed;inset:0;z-index:600;background:var(--bg,#080c09);display:flex;flex-direction:column;overflow:hidden;font-family:\'Cabinet Grotesk\',sans-serif}',
    '.mbwiz-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-bottom:1px solid var(--border,rgba(234,242,235,.08));flex-shrink:0}',
    '.mbwiz-logo{font-family:\'Clash Display\',sans-serif;font-size:1.2rem;font-weight:700;color:var(--text,#eaf2eb);letter-spacing:-.03em}.mbwiz-logo span{color:var(--green,#00e676)}',
    '.mbwiz-skip-all{background:none;border:none;color:var(--muted,rgba(234,242,235,.55));font-family:\'Cabinet Grotesk\',sans-serif;font-size:.9rem;cursor:pointer;padding:.4rem .6rem;border-radius:8px;transition:color .2s}.mbwiz-skip-all:hover{color:var(--text,#eaf2eb)}',
    '.mbwiz-dots{display:flex;align-items:center;justify-content:center;gap:.55rem;padding:.85rem 1.5rem;flex-shrink:0}',
    '.mbwiz-dot{width:8px;height:8px;border-radius:50%;background:var(--border,rgba(234,242,235,.08));border:1px solid rgba(234,242,235,.15);transition:all .3s}',
    '.mbwiz-dot.active{background:var(--green,#00e676);border-color:var(--green,#00e676);width:24px;border-radius:4px}',
    '.mbwiz-dot.done{background:rgba(0,230,118,.35);border-color:rgba(0,230,118,.5)}',
    '.mbwiz-body{flex:1;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:1.5rem}',
    '.mbwiz-stage{width:100%;max-width:560px;position:relative}',
    '.mbwiz-step{position:absolute;top:0;left:0;width:100%;opacity:0;transform:translateX(30px);pointer-events:none;transition:opacity .32s ease,transform .32s ease}',
    '.mbwiz-step.active{position:relative;opacity:1;transform:translateX(0);pointer-events:auto}',
    '.mbwiz-step.exit-left{opacity:0;transform:translateX(-30px)}',
    '.mbwiz-step.exit-right{opacity:0;transform:translateX(30px)}',
    '.mbwiz-icon{font-size:3rem;margin-bottom:1rem;display:block;line-height:1}',
    '.mbwiz-icon.rocket-anim{animation:mbwiz-rocket .6s ease both}',
    '@keyframes mbwiz-rocket{0%{transform:scale(.5) rotate(-15deg);opacity:0}60%{transform:scale(1.2) rotate(5deg)}100%{transform:scale(1) rotate(0);opacity:1}}',
    '.mbwiz-title{font-family:\'Clash Display\',sans-serif;font-size:clamp(1.6rem,4vw,2.1rem);font-weight:700;letter-spacing:-.04em;line-height:1.1;color:var(--text,#eaf2eb);margin-bottom:.65rem}',
    '.mbwiz-sub{font-size:1rem;color:var(--muted,rgba(234,242,235,.55));line-height:1.72;margin-bottom:1.6rem;max-width:480px}',
    '.mbwiz-list{list-style:none;display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.8rem}',
    '.mbwiz-list li{display:flex;align-items:center;gap:.75rem;font-size:.97rem;color:var(--muted,rgba(234,242,235,.55))}',
    '.mbwiz-pill{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.3);color:var(--green,#00e676);font-size:.78rem;font-weight:800;flex-shrink:0}',
    '.mbwiz-label{font-size:.82rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,rgba(234,242,235,.55));margin-bottom:.55rem;display:block}',
    '.mbwiz-input{width:100%;background:var(--bg2,#0d120e);border:1px solid var(--border,rgba(234,242,235,.08));color:var(--text,#eaf2eb);font-family:\'Cabinet Grotesk\',sans-serif;font-size:1.05rem;padding:.85rem 1rem;border-radius:12px;outline:none;transition:border-color .2s;margin-bottom:1.2rem}',
    '.mbwiz-input:focus{border-color:rgba(0,230,118,.35)}',
    '.mbwiz-input::placeholder{color:var(--muted,rgba(234,242,235,.55))}',
    '.mbwiz-textarea{resize:vertical;min-height:110px;line-height:1.65}',
    '.mbwiz-seg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem;margin-bottom:1.4rem}',
    '@media(max-width:380px){.mbwiz-seg-grid{grid-template-columns:repeat(2,1fr)}}',
    '.mbwiz-seg-btn{background:var(--bg2,#0d120e);border:1px solid var(--border,rgba(234,242,235,.08));color:var(--muted,rgba(234,242,235,.55));font-family:\'Cabinet Grotesk\',sans-serif;font-size:.88rem;padding:.65rem .5rem;border-radius:12px;cursor:pointer;transition:all .2s;text-align:center;line-height:1.35}',
    '.mbwiz-seg-btn:hover{border-color:rgba(0,230,118,.25);color:var(--text,#eaf2eb)}',
    '.mbwiz-seg-btn.selected{background:rgba(0,230,118,.1);border-color:rgba(0,230,118,.4);color:var(--green,#00e676)}',
    '.mbwiz-tone-row{display:flex;gap:.55rem;margin-bottom:1.2rem}',
    '.mbwiz-tone-btn{flex:1;background:var(--bg2,#0d120e);border:1px solid var(--border,rgba(234,242,235,.08));color:var(--muted,rgba(234,242,235,.55));font-family:\'Cabinet Grotesk\',sans-serif;font-size:.9rem;padding:.65rem .5rem;border-radius:12px;cursor:pointer;transition:all .2s;text-align:center}',
    '.mbwiz-tone-btn:hover{border-color:rgba(0,230,118,.25);color:var(--text,#eaf2eb)}',
    '.mbwiz-tone-btn.selected{background:rgba(0,230,118,.1);border-color:rgba(0,230,118,.4);color:var(--green,#00e676)}',
    '.mbwiz-preset-grid{display:flex;flex-direction:column;gap:.55rem;margin-bottom:1.2rem}',
    '.mbwiz-preset-btn{background:var(--bg2,#0d120e);border:1px solid var(--border,rgba(234,242,235,.08));color:var(--text,#eaf2eb);font-family:\'Cabinet Grotesk\',sans-serif;font-size:.95rem;padding:.85rem 1rem;border-radius:12px;cursor:pointer;transition:all .2s;text-align:left}',
    '.mbwiz-preset-btn:hover{border-color:rgba(0,230,118,.25)}',
    '.mbwiz-preset-btn.selected{background:rgba(0,230,118,.1);border-color:rgba(0,230,118,.4);color:var(--green,#00e676)}',
    '.mbwiz-green-box{background:rgba(0,230,118,.06);border:1px solid rgba(0,230,118,.22);border-radius:14px;padding:1rem 1.1rem;font-size:.96rem;color:var(--text,#eaf2eb);line-height:1.7;margin-bottom:1.6rem}',
    '.mbwiz-green-box strong{color:var(--green,#00e676)}',
    '.mbwiz-footer{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-top:1px solid var(--border,rgba(234,242,235,.08));flex-shrink:0;gap:1rem}',
    '.mbwiz-back-btn{background:none;border:1px solid var(--border,rgba(234,242,235,.08));color:var(--muted,rgba(234,242,235,.55));font-family:\'Cabinet Grotesk\',sans-serif;font-size:.95rem;padding:.7rem 1.1rem;border-radius:12px;cursor:pointer;transition:all .2s}',
    '.mbwiz-back-btn:hover{border-color:rgba(234,242,235,.2);color:var(--text,#eaf2eb)}',
    '.mbwiz-back-btn.hidden,.mbwiz-skip-step.hidden{display:none!important}',
    '.mbwiz-save-indicator{font-size:.9rem;color:var(--muted,rgba(234,242,235,.55));flex:1;text-align:center;min-width:0}',
    '.mbwiz-footer-right{display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;flex-shrink:0}',
    '.mbwiz-next-btn{background:var(--green,#00e676);color:#080c09;border:none;font-family:\'Cabinet Grotesk\',sans-serif;font-weight:700;font-size:1rem;padding:.85rem 1.6rem;border-radius:12px;cursor:pointer;transition:all .2s;white-space:nowrap}',
    '.mbwiz-next-btn:disabled{opacity:.4;cursor:not-allowed}',
    '.mbwiz-next-btn.secondary{background:none;border:1px solid rgba(0,230,118,.3);color:var(--green,#00e676);padding:.7rem 1.2rem;font-size:.95rem}',
    '.mbwiz-next-btn.secondary:hover:not(:disabled){background:rgba(0,230,118,.08)}',
    '.mbwiz-skip-step{background:none;border:none;color:var(--muted,rgba(234,242,235,.55));font-family:\'Cabinet Grotesk\',sans-serif;font-size:.88rem;cursor:pointer;padding:.2rem 0;text-decoration:underline;text-underline-offset:3px}',
    '.mbwiz-skip-step:hover{color:var(--text,#eaf2eb)}',
    '.mbwiz-field-group{margin-bottom:1rem}'
  ].join('\n');

  /* ─── Segment examples ─────────────────────────────────────────────── */
  var SEGMENT_EXAMPLES = {
    loja: 'Atenda com simpatia. Mostre os produtos quando o cliente perguntar. Se houver dúvida de estoque ou entrega, encaminhe para a equipe.',
    restaurante: 'Informe o cardápio, horários e opções de delivery. Para reservas e pedidos especiais, encaminhe para a equipe.',
    clinica: 'Informe serviços, horários e planos atendidos. Para agendamentos, encaminhe para a recepção.',
    salao: 'Mostre os serviços e preços. Para agendamentos, confirme disponibilidade com a equipe.',
    imoveis: 'Apresente os imóveis disponíveis. Para visitas e negociações, encaminhe para o corretor.',
    cursos: 'Apresente cursos, preços e formas de pagamento. Para matrículas, encaminhe para a equipe.',
    autopecas: 'Informe disponibilidade e preço. Se não tiver certeza sobre o item, encaminhe para a equipe.',
    academia: 'Mostre os planos e valores. Para tour e matrícula, encaminhe para a equipe.',
    outros: 'Atenda com simpatia. Responda as dúvidas frequentes e, quando precisar de aprovação, encaminhe para a equipe.'
  };

  /* ─── State ────────────────────────────────────────────────────────── */
  var wiz = {
    el: null,
    currentStep: 0,
    totalContentSteps: 4, // steps 1-4 shown in dots
    options: {},
    data: {
      company: '',
      segment: '',
      tone: 'neutro',
      notes: '',
      specialHours: '',
      quickReply: ''
    }
  };

  /* ─── Helpers ──────────────────────────────────────────────────────── */
  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        step: wiz.currentStep,
        data: wiz.data
      }));
    } catch(e) {}
  }

  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(e) { return null; }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch(e) {}
  }

  function markDone(flag) {
    try { localStorage.setItem(DONE_KEY, flag || '1'); } catch(e) {}
  }

  function isDone() {
    try { return !!localStorage.getItem(DONE_KEY); } catch(e) { return false; }
  }

  function q(sel) {
    return wiz.el ? wiz.el.querySelector(sel) : null;
  }

  function qAll(sel) {
    return wiz.el ? wiz.el.querySelectorAll(sel) : [];
  }

  /* ─── Build HTML ───────────────────────────────────────────────────── */
  function buildHTML() {
    return '<div class="mbwiz-topbar">' +
      '<div class="mbwiz-logo">Merca<span>Bot</span></div>' +
      '<button class="mbwiz-skip-all" id="mbwiz-skip-all-btn" type="button">' + (window.MB_t ? window.MB_t('wiz.skipAll','Pular configuração') : 'Pular configuração') + '</button>' +
    '</div>' +
    '<div class="mbwiz-dots" id="mbwiz-dots" style="display:none">' +
      '<div class="mbwiz-dot" data-dot="0"></div>' +
      '<div class="mbwiz-dot" data-dot="1"></div>' +
      '<div class="mbwiz-dot" data-dot="2"></div>' +
      '<div class="mbwiz-dot" data-dot="3"></div>' +
    '</div>' +
    '<div class="mbwiz-body">' +
      '<div class="mbwiz-stage" id="mbwiz-stage">' +
        buildStep0() +
        buildStep1() +
        buildStep2() +
        buildStep3() +
        buildStep4() +
        buildStep5() +
      '</div>' +
    '</div>' +
    '<div class="mbwiz-footer">' +
      '<button class="mbwiz-back-btn hidden" id="mbwiz-back-btn" type="button">← Voltar</button>' +
      '<div class="mbwiz-save-indicator" id="mbwiz-save-indicator"></div>' +
      '<div class="mbwiz-footer-right">' +
        '<button class="mbwiz-next-btn" id="mbwiz-next-btn" type="button">' + (window.MB_t ? window.MB_t('wiz.start','Começar →') : 'Começar →') + '</button>' +
        '<button class="mbwiz-skip-step hidden" id="mbwiz-skip-step-btn" type="button">' + (window.MB_t ? window.MB_t('wiz.skipStep','Pular esta etapa') : 'Pular esta etapa') + '</button>' +
      '</div>' +
    '</div>';
  }

  function buildStep0() {
    return '<div class="mbwiz-step" id="mbwiz-step-0">' +
      '<span class="mbwiz-icon">👋</span>' +
      '<h1 class="mbwiz-title">Vamos colocar seu atendimento no ar.</h1>' +
      '<p class="mbwiz-sub">São 4 perguntas rápidas. Menos de 5 minutos.</p>' +
      '<ul class="mbwiz-list">' +
        '<li><span class="mbwiz-pill">1</span> Nome e segmento do negócio</li>' +
        '<li><span class="mbwiz-pill">2</span> Como o bot deve se comportar</li>' +
        '<li><span class="mbwiz-pill">3</span> Horário de funcionamento</li>' +
        '<li><span class="mbwiz-pill">4</span> Pergunta mais frequente dos clientes</li>' +
      '</ul>' +
    '</div>';
  }

  function buildStep1() {
    return '<div class="mbwiz-step" id="mbwiz-step-1">' +
      '<span class="mbwiz-icon">🏢</span>' +
      '<h1 class="mbwiz-title">Como se chama seu negócio?</h1>' +
      '<p class="mbwiz-sub">E qual é o segmento? A IA responde melhor quando conhece seu ramo.</p>' +
      '<div class="mbwiz-field-group">' +
        '<label class="mbwiz-label" for="mbwiz-company">Nome do negócio</label>' +
        '<input class="mbwiz-input" id="mbwiz-company" type="text" placeholder="Ex: Restaurante do João" autocomplete="organization" maxlength="100">' +
      '</div>' +
      '<label class="mbwiz-label">Segmento</label>' +
      '<div class="mbwiz-seg-grid" id="mbwiz-seg-grid">' +
        '<button class="mbwiz-seg-btn" data-seg="loja" type="button">🛍️ Loja/Varejo</button>' +
        '<button class="mbwiz-seg-btn" data-seg="restaurante" type="button">🍽️ Restaurante</button>' +
        '<button class="mbwiz-seg-btn" data-seg="clinica" type="button">🏥 Clínica/Saúde</button>' +
        '<button class="mbwiz-seg-btn" data-seg="salao" type="button">💇 Salão/Estética</button>' +
        '<button class="mbwiz-seg-btn" data-seg="imoveis" type="button">🏠 Imóveis</button>' +
        '<button class="mbwiz-seg-btn" data-seg="cursos" type="button">📚 Cursos</button>' +
        '<button class="mbwiz-seg-btn" data-seg="autopecas" type="button">🔧 Auto/Mecânica</button>' +
        '<button class="mbwiz-seg-btn" data-seg="academia" type="button">💪 Academia</button>' +
        '<button class="mbwiz-seg-btn" data-seg="outros" type="button">💼 Outro</button>' +
      '</div>' +
    '</div>';
  }

  function buildStep2() {
    return '<div class="mbwiz-step" id="mbwiz-step-2">' +
      '<span class="mbwiz-icon">💬</span>' +
      '<h1 class="mbwiz-title">Como o bot deve se comportar?</h1>' +
      '<p class="mbwiz-sub">Escreva como explicaria para um funcionário novo. Uma frase já basta.</p>' +
      '<label class="mbwiz-label">Tom de atendimento</label>' +
      '<div class="mbwiz-tone-row" id="mbwiz-tone-row">' +
        '<button class="mbwiz-tone-btn" data-tone="formal" type="button">🎩 Formal</button>' +
        '<button class="mbwiz-tone-btn selected" data-tone="neutro" type="button">⚖️ Neutro</button>' +
        '<button class="mbwiz-tone-btn" data-tone="descontraido" type="button">😊 Descontraído</button>' +
      '</div>' +
      '<label class="mbwiz-label" for="mbwiz-notes">Instruções para o bot</label>' +
      '<textarea class="mbwiz-input mbwiz-textarea" id="mbwiz-notes" placeholder="Ex: Atenda com simpatia. Quando o cliente perguntar sobre preços, mostre as opções disponíveis." maxlength="1200"></textarea>' +
    '</div>';
  }

  function buildStep3() {
    return '<div class="mbwiz-step" id="mbwiz-step-3">' +
      '<span class="mbwiz-icon">🕐</span>' +
      '<h1 class="mbwiz-title">Quando sua empresa está aberta?</h1>' +
      '<p class="mbwiz-sub">O bot informa isso automaticamente quando o cliente perguntar.</p>' +
      '<div class="mbwiz-preset-grid" id="mbwiz-preset-grid">' +
        '<button class="mbwiz-preset-btn" data-preset="Seg–Sex 8h–18h · Sáb 9h–13h" type="button">Seg–Sex 8h–18h · Sáb 9h–13h</button>' +
        '<button class="mbwiz-preset-btn" data-preset="Seg–Dom 11h–23h" type="button">Seg–Dom 11h–23h</button>' +
        '<button class="mbwiz-preset-btn" data-preset="24h por dia, 7 dias por semana" type="button">24h por dia, 7 dias por semana</button>' +
        '<button class="mbwiz-preset-btn" data-preset="Seg–Sáb 9h–18h" type="button">Seg–Sáb 9h–18h</button>' +
      '</div>' +
      '<label class="mbwiz-label" for="mbwiz-hours">Ou escreva seu horário</label>' +
      '<input class="mbwiz-input" id="mbwiz-hours" type="text" placeholder="Ex: Seg–Sex 9h–18h · Sáb 9h–13h">' +
    '</div>';
  }

  function buildStep4() {
    return '<div class="mbwiz-step" id="mbwiz-step-4">' +
      '<span class="mbwiz-icon">💡</span>' +
      '<h1 class="mbwiz-title">Qual pergunta seus clientes mais fazem?</h1>' +
      '<p class="mbwiz-sub">Cadastre uma frase pronta. Você adiciona mais no painel depois.</p>' +
      '<label class="mbwiz-label" for="mbwiz-faq">Pergunta frequente (opcional)</label>' +
      '<input class="mbwiz-input" id="mbwiz-faq" type="text" placeholder="Ex: Posso te mostrar as opções mais alinhadas ao que você procura.">' +
    '</div>';
  }

  function buildStep5() {
    return '<div class="mbwiz-step" id="mbwiz-step-5">' +
      '<span class="mbwiz-icon rocket-anim" id="mbwiz-rocket">🚀</span>' +
      '<h1 class="mbwiz-title">Pronto! Seu bot está configurado.</h1>' +
      '<p class="mbwiz-sub">Agora conecte o WhatsApp oficial para ativar o atendimento automático.</p>' +
      '<div class="mbwiz-green-box">' + (window.MB_t ? window.MB_t('wiz.greenBox','<strong>Próximo passo</strong> — Conecte o número oficial da sua empresa pelo WhatsApp Business da Meta. Leva ~3 minutos.') : '<strong>Próximo passo</strong> — Conecte o número oficial da sua empresa pelo WhatsApp Business da Meta. Leva ~3 minutos.') + '</div>' +
    '</div>';
  }

  /* ─── Render helpers ───────────────────────────────────────────────── */
  function updateDots() {
    var step = wiz.currentStep;
    var dotsEl = q('#mbwiz-dots');
    if (!dotsEl) return;
    // Show dots only for steps 1-4
    if (step >= 1 && step <= 4) {
      dotsEl.style.display = 'flex';
      var dots = qAll('.mbwiz-dot');
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.remove('active', 'done');
        var dotIdx = parseInt(dots[i].getAttribute('data-dot'), 10);
        var contentStep = step - 1; // step 1 = content step 0
        if (dotIdx < contentStep) {
          dots[i].classList.add('done');
        } else if (dotIdx === contentStep) {
          dots[i].classList.add('active');
        }
      }
    } else {
      dotsEl.style.display = 'none';
    }
  }

  function updateFooter() {
    var step = wiz.currentStep;
    var backBtn = q('#mbwiz-back-btn');
    var nextBtn = q('#mbwiz-next-btn');
    var skipStepBtn = q('#mbwiz-skip-step-btn');

    if (!backBtn || !nextBtn) return;

    // Back button
    if (step === 0 || step === 5) {
      backBtn.classList.add('hidden');
    } else {
      backBtn.classList.remove('hidden');
    }

    // Skip step link — only on step 4
    if (step === 4) {
      skipStepBtn.classList.remove('hidden');
    } else {
      skipStepBtn.classList.add('hidden');
    }

    // Next button label & style
    var T = function(k, fb){ return (window.MB_t ? window.MB_t(k, fb) : fb); };
    if (step === 0) {
      nextBtn.textContent = T('wiz.start', 'Começar →');
      nextBtn.className = 'mbwiz-next-btn';
    } else if (step === 5) {
      nextBtn.textContent = T('wiz.connectWA', 'Conectar WhatsApp →');
      nextBtn.className = 'mbwiz-next-btn';
    } else {
      nextBtn.textContent = step === 4 ? T('wiz.conclude', 'Concluir →') : T('wiz.next', 'Próximo →');
      nextBtn.className = 'mbwiz-next-btn';
    }

    // Validity
    nextBtn.disabled = !isStepValid(step);
  }

  function isStepValid(step) {
    if (step === 0 || step === 4 || step === 5) return true;
    if (step === 1) {
      return wiz.data.company.trim().length > 0 && wiz.data.segment.length > 0;
    }
    if (step === 2) {
      return wiz.data.notes.trim().length >= 5;
    }
    if (step === 3) {
      return wiz.data.specialHours.trim().length > 0;
    }
    return true;
  }

  /* ─── Navigation ───────────────────────────────────────────────────── */
  function goTo(targetStep, direction) {
    if (targetStep < 0 || targetStep > 5) return;
    var fromStep = wiz.currentStep;
    var dir = direction || (targetStep > fromStep ? 'forward' : 'back');

    var fromEl = q('#mbwiz-step-' + fromStep);
    var toEl = q('#mbwiz-step-' + targetStep);
    if (!fromEl || !toEl) return;

    // Exit current
    fromEl.classList.remove('active');
    fromEl.classList.add(dir === 'forward' ? 'exit-left' : 'exit-right');

    // Set incoming position
    toEl.style.transform = dir === 'forward' ? 'translateX(30px)' : 'translateX(-30px)';
    toEl.style.opacity = '0';
    toEl.style.position = 'absolute';

    // Trigger reflow
    void toEl.offsetWidth;

    wiz.currentStep = targetStep;
    toEl.classList.add('active');
    toEl.style.transform = '';
    toEl.style.opacity = '';
    toEl.style.position = '';

    // Clean up exiting step after transition
    setTimeout(function() {
      fromEl.classList.remove('exit-left', 'exit-right');
    }, 350);

    updateDots();
    updateFooter();
    syncStepInputs(targetStep);
    saveDraft();

    // Focus first input in step
    setTimeout(function() {
      var firstInput = toEl.querySelector('input, textarea');
      if (firstInput && targetStep !== 0 && targetStep !== 5) {
        firstInput.focus();
      }
    }, 350);
  }

  function syncStepInputs(step) {
    if (step === 1) {
      var companyEl = q('#mbwiz-company');
      if (companyEl) companyEl.value = wiz.data.company;
      var segBtns = qAll('.mbwiz-seg-btn');
      for (var i = 0; i < segBtns.length; i++) {
        if (segBtns[i].getAttribute('data-seg') === wiz.data.segment) {
          segBtns[i].classList.add('selected');
        } else {
          segBtns[i].classList.remove('selected');
        }
      }
    } else if (step === 2) {
      var notesEl = q('#mbwiz-notes');
      if (notesEl) {
        // Pre-fill with segment example if notes are empty
        if (!wiz.data.notes && wiz.data.segment && SEGMENT_EXAMPLES[wiz.data.segment]) {
          wiz.data.notes = SEGMENT_EXAMPLES[wiz.data.segment];
        }
        notesEl.value = wiz.data.notes;
      }
      var toneBtns = qAll('.mbwiz-tone-btn');
      for (var j = 0; j < toneBtns.length; j++) {
        if (toneBtns[j].getAttribute('data-tone') === wiz.data.tone) {
          toneBtns[j].classList.add('selected');
        } else {
          toneBtns[j].classList.remove('selected');
        }
      }
    } else if (step === 3) {
      var hoursEl = q('#mbwiz-hours');
      if (hoursEl) hoursEl.value = wiz.data.specialHours;
      var presetBtns = qAll('.mbwiz-preset-btn');
      for (var k = 0; k < presetBtns.length; k++) {
        if (presetBtns[k].getAttribute('data-preset') === wiz.data.specialHours) {
          presetBtns[k].classList.add('selected');
        } else {
          presetBtns[k].classList.remove('selected');
        }
      }
    } else if (step === 4) {
      var faqEl = q('#mbwiz-faq');
      if (faqEl) faqEl.value = wiz.data.quickReply;
    }
  }

  function advance() {
    var step = wiz.currentStep;
    if (!isStepValid(step)) return;

    if (step === 4) {
      // Collect faq data then save
      var faqEl = q('#mbwiz-faq');
      if (faqEl) wiz.data.quickReply = faqEl.value.trim();
      goTo(5, 'forward');
      // Trigger rocket animation
      setTimeout(function() {
        var rocket = q('#mbwiz-rocket');
        if (rocket) {
          rocket.style.animation = 'none';
          void rocket.offsetWidth;
          rocket.style.animation = '';
        }
      }, 50);
      doSave();
      return;
    }

    if (step === 5) {
      complete('whatsapp');
      return;
    }

    goTo(step + 1, 'forward');
  }

  function goBack() {
    if (wiz.currentStep <= 1) return;
    goTo(wiz.currentStep - 1, 'back');
  }

  /* ─── Save ─────────────────────────────────────────────────────────── */
  function doSave() {
    var indicator = q('#mbwiz-save-indicator');
    if (indicator) indicator.textContent = (window.MB_t ? window.MB_t('wiz.indicatorSaving','Salvando…') : 'Salvando…');

    var tonePrefix = '';
    if (wiz.data.tone === 'formal') tonePrefix = '[Tom: Formal] ';
    if (wiz.data.tone === 'descontraido') tonePrefix = '[Tom: Descontraído] ';

    var payload = {
      notes: tonePrefix + wiz.data.notes,
      specialHours: wiz.data.specialHours,
      quickReplies: [wiz.data.quickReply, '', ''],
      businessProfile: {
        segment: wiz.data.segment,
        fields: { nome: wiz.data.company },
        freeText: '',
        aiGenerated: false
      }
    };

    try {
      if (typeof persistWorkspace === 'function') {
        persistWorkspace('base', payload).then(function() {
          if (indicator) {
            indicator.textContent = (window.MB_t ? window.MB_t('wiz.indicatorSaved','✓ Salvo!') : '✓ Salvo!');
            setTimeout(function() { if (indicator) indicator.textContent = ''; }, 2500);
          }
        }).catch(function(err) {
          console.error('[MBWizard] doSave failed:', err);
          if (indicator) {
            indicator.textContent = (window.MB_t ? window.MB_t('wiz.indicatorError','⚠ Erro ao salvar') : '⚠ Erro ao salvar');
            setTimeout(function() { if (indicator) indicator.textContent = ''; }, 3000);
          }
        });
      } else {
        if (indicator) indicator.textContent = '';
      }
    } catch(e) {
      console.error('[MBWizard] doSave exception:', e);
      if (indicator) {
        indicator.textContent = (window.MB_t ? window.MB_t('wiz.indicatorError','⚠ Erro ao salvar') : '⚠ Erro ao salvar');
        setTimeout(function() { if (indicator) indicator.textContent = ''; }, 3000);
      }
    }
  }

  /* ─── Complete / Skip ──────────────────────────────────────────────── */
  function complete(action) {
    markDone('1');
    clearDraft();
    destroy();
    if (typeof wiz.options.onComplete === 'function') {
      wiz.options.onComplete(action);
    }
  }

  function skipAll() {
    if (!confirm(window.MB_t ? window.MB_t('wiz.skipAllConfirm','Pular a configuração inicial? Você pode configurar o bot pelo painel a qualquer momento.') : 'Pular a configuração inicial? Você pode configurar o bot pelo painel a qualquer momento.')) return;
    markDone('skipped');
    clearDraft();
    destroy();
    if (typeof wiz.options.onSkip === 'function') {
      wiz.options.onSkip();
    }
  }

  function skipStep() {
    // Step 4 is optional — skip straight to final
    if (wiz.currentStep === 4) {
      wiz.data.quickReply = '';
      goTo(5, 'forward');
      doSave();
    }
  }

  function viewPanelFirst() {
    markDone('1');
    clearDraft();
    destroy();
    if (typeof wiz.options.onSkip === 'function') {
      wiz.options.onSkip();
    }
  }

  /* ─── Event wiring ─────────────────────────────────────────────────── */
  function wireEvents() {
    // Next
    var nextBtn = q('#mbwiz-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', function() { advance(); });

    // Back
    var backBtn = q('#mbwiz-back-btn');
    if (backBtn) backBtn.addEventListener('click', function() { goBack(); });

    // Skip all
    var skipAllBtn = q('#mbwiz-skip-all-btn');
    if (skipAllBtn) skipAllBtn.addEventListener('click', function() { skipAll(); });

    // Skip step
    var skipStepBtn = q('#mbwiz-skip-step-btn');
    if (skipStepBtn) skipStepBtn.addEventListener('click', function() { skipStep(); });

    // Segment buttons
    var segBtns = qAll('.mbwiz-seg-btn');
    for (var i = 0; i < segBtns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var seg = btn.getAttribute('data-seg');
          wiz.data.segment = seg;
          var all = qAll('.mbwiz-seg-btn');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
          btn.classList.add('selected');
          // Reset notes so segment example can be re-applied on step 2
          if (wiz.data.notes && SEGMENT_EXAMPLES[seg] !== wiz.data.notes) {
            // User had notes from a different segment — keep them
          } else {
            wiz.data.notes = '';
          }
          updateFooter();
          // Auto-advance to next if company name is also filled
          var companyEl = q('#mbwiz-company');
          if (companyEl && companyEl.value.trim().length > 0) {
            setTimeout(function() { advance(); }, 220);
          }
        });
      })(segBtns[i]);
    }

    // Company input
    var companyEl = q('#mbwiz-company');
    if (companyEl) {
      companyEl.addEventListener('input', function() {
        wiz.data.company = companyEl.value;
        updateFooter();
      });
      companyEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { if (isStepValid(1)) advance(); }
      });
    }

    // Tone buttons
    var toneBtns = qAll('.mbwiz-tone-btn');
    for (var t = 0; t < toneBtns.length; t++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          wiz.data.tone = btn.getAttribute('data-tone');
          var all = qAll('.mbwiz-tone-btn');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
          btn.classList.add('selected');
        });
      })(toneBtns[t]);
    }

    // Notes textarea
    var notesEl = q('#mbwiz-notes');
    if (notesEl) {
      notesEl.addEventListener('input', function() {
        wiz.data.notes = notesEl.value;
        updateFooter();
      });
    }

    // Preset hour buttons
    var presetBtns = qAll('.mbwiz-preset-btn');
    for (var p = 0; p < presetBtns.length; p++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var preset = btn.getAttribute('data-preset');
          wiz.data.specialHours = preset;
          var all = qAll('.mbwiz-preset-btn');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
          btn.classList.add('selected');
          var hoursEl = q('#mbwiz-hours');
          if (hoursEl) hoursEl.value = preset;
          updateFooter();
        });
      })(presetBtns[p]);
    }

    // Hours input
    var hoursEl = q('#mbwiz-hours');
    if (hoursEl) {
      hoursEl.addEventListener('input', function() {
        wiz.data.specialHours = hoursEl.value;
        // Deselect presets if user typed manually
        var all = qAll('.mbwiz-preset-btn');
        var matched = false;
        for (var j = 0; j < all.length; j++) {
          if (all[j].getAttribute('data-preset') === hoursEl.value) {
            all[j].classList.add('selected');
            matched = true;
          } else {
            all[j].classList.remove('selected');
          }
        }
        updateFooter();
      });
      hoursEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { if (isStepValid(3)) advance(); }
      });
    }

    // FAQ input
    var faqEl = q('#mbwiz-faq');
    if (faqEl) {
      faqEl.addEventListener('input', function() {
        wiz.data.quickReply = faqEl.value;
      });
      faqEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') advance();
      });
    }

    // Keyboard: Escape = close wizard silently (no confirm dialog)
    wiz._onKeydown = function(e) {
      if (e.key === 'Escape') {
        markDone('skipped');
        clearDraft();
        destroy();
        if (typeof wiz.options.onSkip === 'function') wiz.options.onSkip();
      }
    };
    document.addEventListener('keydown', wiz._onKeydown);

    // Step 5 secondary action — dynamically injected after step 5 renders
    // We use event delegation on the overlay
    wiz.el.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'mbwiz-view-panel-btn') {
        viewPanelFirst();
      }
    });
  }

  /* ─── Step 5 secondary button ──────────────────────────────────────── */
  // Inject "Ver painel primeiro" into footer right when on step 5
  function updateStep5Footer() {
    // This is handled by the next button click being 'Conectar WhatsApp →'
    // and we inject a secondary link below next button on step 5
    var footerRight = q('.mbwiz-footer-right');
    if (!footerRight) return;
    var existing = q('#mbwiz-view-panel-btn');
    if (wiz.currentStep === 5 && !existing) {
      var link = document.createElement('button');
      link.type = 'button';
      link.id = 'mbwiz-view-panel-btn';
      link.className = 'mbwiz-skip-step';
      link.style.display = 'block';
      link.textContent = (window.MB_t ? window.MB_t('wiz.viewPanel','Ver painel primeiro') : 'Ver painel primeiro');
      footerRight.appendChild(link);
    } else if (wiz.currentStep !== 5 && existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  /* ─── Override goTo to also handle step 5 footer ──────────────────── */
  var _origGoTo = goTo;
  goTo = function(targetStep, direction) {
    _origGoTo(targetStep, direction);
    updateStep5Footer();
  };

  /* ─── Inject CSS ───────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('mbwiz-css')) return;
    var style = document.createElement('style');
    style.id = 'mbwiz-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ─── Public API ───────────────────────────────────────────────────── */
  function init(options) {
    try {
      if (isDone()) return;
      if (options && options.hasExistingSetup) return;

      wiz.options = options || {};

      injectCSS();

      // Create overlay
      var overlay = document.createElement('div');
      overlay.className = 'mbwiz-overlay';
      overlay.id = 'mbwiz-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Configuração inicial do MercaBot');
      overlay.innerHTML = buildHTML();
      document.body.appendChild(overlay);
      wiz.el = overlay;

      // Restore draft
      var draft = loadDraft();
      if (draft && draft.data) {
        wiz.data = draft.data;
        wiz.currentStep = 0; // always start from welcome on fresh load
      }

      // Show step 0
      var step0 = q('#mbwiz-step-0');
      if (step0) step0.classList.add('active');

      updateDots();
      updateFooter();
      wireEvents();

    } catch(e) {
      // Non-fatal: wizard failure must not break the panel
      if (console && console.error) console.error('[MBWizard]', e);
    }
  }

  function destroy() {
    try {
      if (wiz._onKeydown) {
        document.removeEventListener('keydown', wiz._onKeydown);
        wiz._onKeydown = null;
      }
      if (wiz.el && wiz.el.parentNode) {
        wiz.el.parentNode.removeChild(wiz.el);
      }
      wiz.el = null;
    } catch(e) {}
  }

  global.MBWizard = {
    init: init,
    destroy: destroy
  };

})(window);
