(function () {
  'use strict';

  var API_URL = 'https://api.mercabot.com.br';

  var PLANS_PT = {
    starter:  { name: 'Starter',  monthly: 'R$197', annual: 'R$164' },
    pro:      { name: 'Pro',      monthly: 'R$497', annual: 'R$414' },
    parceiro: { name: 'Parceiro', monthly: 'R$1.297', annual: 'R$1.081' }
  };

  var PLANS_ES = {
    starter:  { name: 'Starter',  monthly: '$49 USD',  annual: '$41 USD' },
    pro:      { name: 'Pro',      monthly: '$119 USD', annual: '$99 USD' },
    parceiro: { name: 'Socio',    monthly: '$279 USD', annual: '$233 USD' }
  };

  var ES = {
    navLogin: 'Ya tengo cuenta',
    asideTitle: 'Tu WhatsApp atendiendo clientes <em>24h al día.</em>',
    asideCopy: 'Ingresas el número, eliges el plan y pagas. La parte técnica la resuelve MercaBot — tú solo cuentas cómo quieres que el bot atienda.',
    b1Title: 'Ingresa tu WhatsApp y correo',
    b1Copy: 'Es el número que tus clientes ya usan. Nada para configurar ahora.',
    b2Title: 'Elige el plan y paga con seguridad',
    b2Copy: 'Stripe PCI DSS nivel 1. 7 días de evaluación sin riesgo.',
    b3Title: 'Completa cómo el bot debe atender',
    b3Copy: 'Después del pago, cuentas sobre tu negocio y la IA comienza a trabajar.',
    b4Title: 'MercaBot resuelve todo lo técnico',
    b4Copy: 'Conexión WhatsApp, configuración de <span class="claude-brand">IA Claude</span> — sin equipo técnico.',
    proofCopy: 'Activación guiada incluida — sales del pago con el siguiente paso ya en pantalla.',
    prog1: 'Contacto', prog2: 'Plan',
    step1Heading: 'WhatsApp y correo de tu empresa',
    step1Sub: 'Solo eso por ahora. El resto lo completas después del pago — con nuestra guía.',
    lblWhats: 'WhatsApp de la empresa',
    whatsHint: 'El número que tus clientes ya usan para hablar contigo',
    whatsErr: 'Ingresa el número con código de área (10 o 11 dígitos)',
    lblEmail: 'Tu mejor correo electrónico',
    emailHint: 'Tus credenciales de acceso llegan aquí después del pago',
    emailErr: 'Ingresa un correo electrónico válido',
    waReassurance: 'No necesitas tocar la API de WhatsApp ahora. MercaBot lo hace por ti después del pago.',
    btn1Text: 'Elegir plan →',
    step2Heading: 'Elige tu plan',
    step2Sub: 'Todos incluyen 7 días de evaluación y activación guiada. Sin contrato — cancela cuando quieras.',
    lblMensal: 'Mensual', lblAnual: 'Anual', economiaBadge: '2 meses gratis',
    popularBadge: 'Más popular',
    trialStrip: 'No se te cobra ahora. El pago se confirma en Stripe con total seguridad.',
    backLabel: 'Volver',
    submitText: 'Ir al pago →',
    fallbackTitle: '¿Checkout con dificultades?',
    fallbackCopy: 'Nuestro centro digital retoma el contexto y muestra el siguiente paso.',
    fallbackLink: 'Abrir centro digital →', fallbackHref: '/soporte/',
    termsNote: 'Al continuar aceptas los <a href="/terminos/">Términos de Uso</a> y la <a href="/privacidad/">Política de Privacidad</a>. Pago procesado de forma segura por Stripe.',
    planNameParceiro: 'Socio',
    planNoteParceiro: 'Revende con estructura lista',
    planNotePro: 'Control comercial sin complicar',
    planNoteStarter: 'Base organizada sin retrabajo',
    starterFeatures: ['✓ 1.000 respuestas de IA/mes', '✓ FAQ automático', '✓ Respuestas rápidas', '✓ Activación guiada'],
    proFeatures: ['✓ 4.000 respuestas de IA/mes', '✓ Todo lo del Starter', '✓ Calificación de leads', '✓ Panel de resultados'],
    parceiroFeatures: ['✓ 15.000 respuestas de IA/mes', '✓ Todo lo del Pro', '✓ Marca propia (white-label)', '✓ Cartera multicliente'],
    readinessError: 'La contratación en español todavía no está lista. Usa la central digital para avanzar.',
    readinessOk: 'El checkout en español está listo.',
    errGeneric: 'Estamos con dificultades técnicas. Intenta nuevamente en unos minutos.',
    errTimeout: 'La conexión expiró. Verifica tu internet e intenta de nuevo.',
    errSuffix: 'Si el problema persiste, sigue por la ',
    errLink: 'central digital'
  };

  // ── ESTADO ──────────────────────────────────────────────────────
  var state = { currentStep: 1, selectedPlan: 'pro', isAnual: false, lang: 'pt' };

  // ── HELPERS ──────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }
  function getLang() { return new URLSearchParams(window.location.search).get('lang') === 'es' ? 'es' : 'pt'; }
  function setHTML(id, html) { var el=$(id); if(el) el.innerHTML=html; }
  function setText(id, text) { var el=$(id); if(el) el.textContent=text; }
  function setPlaceholder(id, ph) { var el=$(id); if(el) el.placeholder=ph; }

  // ── FORMATAÇÃO TELEFONE ──────────────────────────────────────────
  function formatPhone(raw) {
    var d = raw.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0,2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
    return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
  }

  // ── VALIDAÇÃO PASSO 1 (whats + email) ────────────────────────────
  function validateStep1() {
    var whatsEl = $('whats'), emailEl = $('email');
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var digits = whatsEl ? whatsEl.value.replace(/\D/g,'') : '';
    var whatsOk = digits.length >= 10 && digits.length <= 11;
    var emailOk = emailEl ? emailRx.test(emailEl.value.trim()) : false;
    var fgW = $('fg-whats'), fgE = $('fg-email');
    if (fgW) fgW.classList.toggle('has-error', !whatsOk);
    if (fgE) fgE.classList.toggle('has-error', !emailOk);
    if (!whatsOk && whatsEl) { whatsEl.focus(); return false; }
    if (!emailOk && emailEl) { emailEl.focus(); return false; }
    return true;
  }

  // ── NAVEGAÇÃO ────────────────────────────────────────────────────
  function goToStep(next, direction) {
    var cur = state.currentStep;
    if (next === cur) return;
    var panelCur = $('panel-' + cur), panelNext = $('panel-' + next);
    if (!panelNext) return;
    if (panelCur) { panelCur.classList.remove('active'); panelCur.style.display = 'none'; }
    panelNext.style.display = 'block';
    panelNext.classList.remove('entering-back');
    if (direction === 'back') panelNext.classList.add('entering-back');
    panelNext.classList.add('active');
    state.currentStep = next;
    updateProgress();
    var h = panelNext.querySelector('.step-heading, h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
    var card = qs('.signup-card');
    if (card && window.innerWidth <= 860) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateProgress() {
    var step = state.currentStep;
    var prog = qs('.wizard-progress');
    if (prog) prog.setAttribute('aria-valuenow', step);
    qsa('.wp-step').forEach(function(el) {
      var s = parseInt(el.getAttribute('data-step'), 10);
      el.classList.remove('active','done');
      if (s === step) el.classList.add('active');
      else if (s < step) el.classList.add('done');
    });
    qsa('.wp-line').forEach(function(el, i) { el.classList.toggle('done', i + 1 < step); });
  }

  // ── PLANO ────────────────────────────────────────────────────────
  function selectPlan(plan) {
    state.selectedPlan = plan;
    qsa('.plan-card').forEach(function(el) {
      var p = el.getAttribute('data-plan');
      el.classList.toggle('selected', p === plan);
      var r = el.querySelector('input[type=radio]');
      if (r) r.checked = (p === plan);
    });
  }

  function updatePrices() {
    var plans = state.lang === 'es' ? PLANS_ES : PLANS_PT;
    var suffix = state.lang === 'es' ? '/mes' : '/mês';
    Object.keys(plans).forEach(function(key) {
      var el = $('plan-price-' + key);
      if (!el) return;
      el.innerHTML = (state.isAnual ? plans[key].annual : plans[key].monthly) + '<span>' + suffix + '</span>';
    });
  }

  function togglePeriodo(annual) {
    state.isAnual = annual;
    var btnM = $('btn-mensal'), btnA = $('btn-anual');
    if (btnM) { btnM.classList.toggle('active', !annual); btnM.setAttribute('aria-pressed', String(!annual)); }
    if (btnA) { btnA.classList.toggle('active', annual); btnA.setAttribute('aria-pressed', String(annual)); }
    updatePrices();
  }

  // ── SUBMIT ───────────────────────────────────────────────────────
  function submitForm() {
    var btn = $('submitBtn'), banner = $('errorBanner');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    if (banner) banner.style.display = 'none';

    var planoKey = state.selectedPlan + (state.isAnual ? '_anual' : '');
    var plans = state.lang === 'es' ? PLANS_ES : PLANS_PT;
    var planName = (plans[state.selectedPlan] ? plans[state.selectedPlan].name : state.selectedPlan) + (state.isAnual ? ' Anual' : '');

    var data = {
      nome:     '',
      empresa:  '',
      email:    ($('email') ? $('email').value.trim() : ''),
      whats:    ($('whats') ? $('whats').value.trim() : ''),
      lang:     state.lang,
      plano:    planoKey,
      planName: planName
    };

    sessionStorage.setItem('mb_signup', JSON.stringify(data));

    fetch(API_URL + '/criar-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.url) { window.location.href = res.url; }
      else throw new Error(res.error || 'Erro ao criar sessão de pagamento');
    })
    .catch(function(err) {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      showError(err);
    });
  }

  function showError(err) {
    var banner = $('errorBanner'), fallback = $('fallback-contact');
    var isEs = state.lang === 'es';
    var isTimeout = err && err.message && err.message.toLowerCase().includes('timeout');
    var msg = isEs ? (isTimeout ? ES.errTimeout : ES.errGeneric) : (isTimeout ? 'A conexão expirou. Verifique sua internet e tente novamente.' : 'Estamos com dificuldades técnicas. Tente novamente em alguns minutos.');
    var suffix = isEs ? ES.errSuffix : 'Se persistir, siga pela ';
    var linkText = isEs ? ES.errLink : 'central digital';
    var linkHref = isEs ? '/soporte/' : '/suporte/';
    if (banner) {
      banner.textContent = '';
      banner.appendChild(document.createTextNode(msg + ' ' + suffix));
      var a = document.createElement('a'); a.href = linkHref; a.textContent = linkText;
      banner.appendChild(a); banner.appendChild(document.createTextNode('.')); banner.style.display = 'block';
    }
    if (fallback) {
      fallback.style.display = 'block';
      var wa = $('fallback-wa');
      if (wa) { try { var d = JSON.parse(sessionStorage.getItem('mb_signup')||'{}'); localStorage.setItem('mb_help_draft','Checkout interrompido\nPlano: '+(d.planName||'')+'\nEmail: '+(d.email||'')); } catch(_){} wa.href = linkHref; }
    }
  }

  // ── READINESS ES ─────────────────────────────────────────────────
  function loadCheckoutReadiness() {
    if (state.lang !== 'es') return;
    fetch(API_URL + '/checkout/readiness')
      .then(function(r) { return r.json(); })
      .then(function(p) {
        if (!p || !p.readiness) return;
        var banner = $('checkoutReadinessBanner'), btn = $('submitBtn');
        var esReady = p.readiness.es && p.readiness.es.ready;
        if (!esReady) {
          if (banner) { banner.textContent = ES.readinessError; banner.style.display = 'block'; }
          if (btn) btn.disabled = true;
        } else {
          if (banner) { banner.className = 'status-banner ok'; banner.textContent = ES.readinessOk; banner.style.display = 'block'; }
        }
      }).catch(function(){});
  }

  // ── VALIDAÇÃO TEMPO REAL ──────────────────────────────────────────
  function setupRealtimeValidation() {
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var whatsEl = $('whats');
    if (whatsEl) {
      whatsEl.addEventListener('input', function() {
        var atEnd = this.selectionStart === this.value.length;
        if (atEnd) this.value = formatPhone(this.value);
        var d = this.value.replace(/\D/g,'');
        var fg = $('fg-whats');
        if (fg && d.length >= 10) fg.classList.remove('has-error');
      });
    }
    var emailEl = $('email');
    if (emailEl) {
      emailEl.addEventListener('input', function() {
        var fg = $('fg-email');
        if (fg && emailRx.test(this.value.trim())) fg.classList.remove('has-error');
      });
    }
  }

  // ── TRADUÇÃO ─────────────────────────────────────────────────────
  function applyLang() {
    var isEs = state.lang === 'es';
    qsa('.locale-link').forEach(function(link) {
      var linkIsEs = link.getAttribute('data-lang-option') === 'es';
      link.classList.toggle('active', isEs ? linkIsEs : !linkIsEs);
      if (isEs ? linkIsEs : !linkIsEs) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
    if (!isEs) return;

    document.documentElement.lang = 'es';
    document.title = 'Comenzar ahora — MercaBot';

    setText('nav-login-link', ES.navLogin);
    setHTML('aside-title', ES.asideTitle);
    setText('aside-copy', ES.asideCopy);
    setText('b1-title', ES.b1Title); setText('b1-copy', ES.b1Copy);
    setText('b2-title', ES.b2Title); setText('b2-copy', ES.b2Copy);
    setText('b3-title', ES.b3Title); setText('b3-copy', ES.b3Copy);
    setHTML('b4-title', ES.b4Title); setHTML('b4-copy', ES.b4Copy);
    setText('proof-copy', ES.proofCopy);
    setText('prog-label-1', ES.prog1); setText('prog-label-2', ES.prog2);

    // Passo 1
    setText('step1-heading', ES.step1Heading); setText('step1-sub', ES.step1Sub);
    setText('lbl-whats', ES.lblWhats);
    var wh = $('whats-hint'); if(wh) wh.textContent = ES.whatsHint;
    var we = $('whats-err'); if(we) we.textContent = ES.whatsErr;
    setPlaceholder('whats', '+52, +54, +57 o +55');
    var ph = $('phone-prefix'); if(ph) ph.textContent = '🌎 +';
    setText('lbl-email', ES.lblEmail);
    var eh = $('email-hint'); if(eh) eh.textContent = ES.emailHint;
    var ee = $('email-err'); if(ee) ee.textContent = ES.emailErr;
    var wr = $('wa-reassurance-copy'); if(wr) wr.textContent = ES.waReassurance;
    setText('btn1-text', ES.btn1Text);

    // Passo 2
    setText('step2-heading', ES.step2Heading); setText('step2-sub', ES.step2Sub);
    setText('lbl-mensal', ES.lblMensal); setText('lbl-anual', ES.lblAnual);
    setText('economia-badge', ES.economiaBadge);
    var pb = qs('.plan-popular-badge'); if(pb) pb.textContent = ES.popularBadge;
    setText('trial-strip-copy', ES.trialStrip);
    setText('back-label-2', ES.backLabel);
    setText('submit-text', ES.submitText);
    setText('plan-name-parceiro', ES.planNameParceiro);
    setText('plan-note-starter', ES.planNoteStarter);
    setText('plan-note-pro', ES.planNotePro);
    setText('plan-note-parceiro', ES.planNoteParceiro);

    [['starter-features', ES.starterFeatures],['pro-features', ES.proFeatures],['parceiro-features', ES.parceiroFeatures]].forEach(function(pair) {
      var ul = $(pair[0]);
      if (ul) ul.innerHTML = pair[1].map(function(f){ return '<li>'+f+'</li>'; }).join('');
    });

    setText('fallback-title', ES.fallbackTitle); setText('fallback-copy', ES.fallbackCopy);
    var fa = $('fallback-wa'); if(fa) { fa.textContent = ES.fallbackLink; fa.href = ES.fallbackHref; }
    var tn = $('terms-note'); if(tn) tn.innerHTML = ES.termsNote;
  }

  // ── EVENTOS ──────────────────────────────────────────────────────
  function bindEvents() {
    // Passo 1 → 2
    var btn1 = $('btn1-next');
    if (btn1) btn1.addEventListener('click', function() { if (validateStep1()) goToStep(2,'forward'); });

    // Enter no whats → foca email; Enter no email → avança
    var whatsEl = $('whats');
    if (whatsEl) whatsEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); var em = $('email'); if(em) em.focus(); }
    });
    var emailEl = $('email');
    if (emailEl) emailEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); if (validateStep1()) goToStep(2,'forward'); }
    });

    // Botão voltar
    var btn2back = $('btn2-back');
    if (btn2back) btn2back.addEventListener('click', function() { goToStep(1,'back'); });

    // Submit
    var submitBtn = $('submitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitForm);

    // Planos
    qsa('.plan-card[data-plan]').forEach(function(card) {
      card.addEventListener('click', function() { selectPlan(card.getAttribute('data-plan')); });
      card.addEventListener('keydown', function(e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectPlan(card.getAttribute('data-plan')); }
      });
    });

    // Toggle período
    var btnM = $('btn-mensal'), btnA = $('btn-anual');
    if (btnM) btnM.addEventListener('click', function() { togglePeriodo(false); });
    if (btnA) btnA.addEventListener('click', function() { togglePeriodo(true); });
  }

  // ── QUERY PARAMS ─────────────────────────────────────────────────
  function applyQueryParams() {
    var params = new URLSearchParams(window.location.search);
    var planParam = params.get('plano');
    selectPlan((['starter','pro','parceiro'].indexOf(planParam) !== -1) ? planParam : 'pro');
    if (params.get('periodo') === 'anual') togglePeriodo(true);
  }

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
    state.lang = getLang();
    applyLang();
    applyQueryParams();
    updatePrices();
    updateProgress();
    setupRealtimeValidation();
    bindEvents();
    loadCheckoutReadiness();
    setTimeout(function() { var f = $('whats'); if(f) f.focus(); }, 100);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
