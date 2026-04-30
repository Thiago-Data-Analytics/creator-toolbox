(function () {
  'use strict';

  var API_URL = (window.__mbConfig || {}).API_BASE_URL || 'https://api.mercabot.com.br';

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

  var PLANS_EN = {
    starter:  { name: 'Starter', monthly: '$49 USD',  annual: '$41 USD' },
    pro:      { name: 'Pro',     monthly: '$119 USD', annual: '$99 USD' },
    parceiro: { name: 'Partner', monthly: '$279 USD', annual: '$233 USD' }
  };

  // Economia anual por plano (exibida nos cartões quando "Anual" selecionado)
  var SAVINGS_PT = {
    starter:  'Economize R$396/ano',
    pro:      'Economize R$996/ano',
    parceiro: 'Economize R$2.592/ano'
  };
  var SAVINGS_ES = {
    starter:  'Ahorra $96 USD/año',
    pro:      'Ahorra $240 USD/año',
    parceiro: 'Ahorra $552 USD/año'
  };
  var SAVINGS_EN = {
    starter:  'Save $96 USD/year',
    pro:      'Save $240 USD/year',
    parceiro: 'Save $552 USD/year'
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
    errLink: 'central digital',
    trust1: 'Stripe PCI DSS',
    trust2: '7 días sin riesgo',
    trust3: 'Pago en Stripe',
    mobilePill1: '⚡ Activación guiada',
    mobilePill2: '🔒 Stripe PCI DSS',
    mobilePill3: '↩️ 7 días sin riesgo',
    mobilePill4: '🤖 IA Claude'
  };

  var EN = {
    navLogin: 'I already have an account',
    asideTitle: 'Your WhatsApp answering customers <em>24/7.</em>',
    asideCopy: 'Enter your number, choose a plan and pay. The technical part is on MercaBot — you just tell us how the bot should respond.',
    b1Title: 'Enter your WhatsApp and email',
    b1Copy: 'The number your customers already use. Nothing to set up now.',
    b2Title: 'Choose a plan and pay securely',
    b2Copy: 'Stripe PCI DSS Level 1. 7-day risk-free trial.',
    b3Title: 'Tell us how the bot should respond',
    b3Copy: 'After payment, you describe your business and the AI starts working.',
    b4Title: 'MercaBot handles all the tech',
    b4Copy: 'WhatsApp connection, <span class="claude-brand">Claude AI</span> setup — no engineering team needed.',
    proofCopy: 'Guided activation included — you leave checkout with the next step already on screen.',
    prog1: 'Contact', prog2: 'Plan',
    step1Heading: 'Your business WhatsApp and email',
    step1Sub: 'Just that for now. The rest you set up after payment — guided.',
    lblWhats: 'Business WhatsApp',
    whatsHint: 'The number your customers already use to talk to you',
    whatsErr: 'Enter a valid phone number with country code',
    lblEmail: 'Your best email',
    emailHint: 'Your access credentials arrive here after payment',
    emailErr: 'Enter a valid email address',
    waReassurance: 'No need to touch the WhatsApp API now. MercaBot handles it after payment.',
    btn1Text: 'Choose plan →',
    step2Heading: 'Choose your plan',
    step2Sub: 'All include a 7-day trial and guided activation. No contract — cancel anytime.',
    lblMensal: 'Monthly', lblAnual: 'Annual', economiaBadge: '2 months free',
    popularBadge: 'Most popular',
    trialStrip: 'No charge now. Payment confirmed by Stripe with full security.',
    backLabel: 'Back',
    submitText: 'Go to payment →',
    fallbackTitle: 'Checkout having trouble?',
    fallbackCopy: 'Our digital center picks up the context and shows the next step.',
    fallbackLink: 'Open digital center →', fallbackHref: '/support/',
    termsNote: 'By continuing you agree to the <a href="/terminos/">Terms of Use</a> and the <a href="/privacidad/">Privacy Policy</a>. Payment processed securely by Stripe.',
    planNameParceiro: 'Partner',
    planNoteParceiro: 'Resell with ready structure',
    planNotePro: 'Commercial control without complexity',
    planNoteStarter: 'Organized base, no rework',
    starterFeatures: ['✓ 1,000 AI replies/month', '✓ Auto FAQ', '✓ Quick replies', '✓ Guided activation'],
    proFeatures: ['✓ 4,000 AI replies/month', '✓ Everything in Starter', '✓ Lead qualification', '✓ Results dashboard'],
    parceiroFeatures: ['✓ 15,000 AI replies/month', '✓ Everything in Pro', '✓ Your own brand (white-label)', '✓ Multi-client portfolio'],
    readinessError: 'English checkout is not yet ready. Use the digital center to proceed.',
    readinessOk: 'English checkout is ready.',
    errGeneric: 'We are having technical issues. Please try again in a few minutes.',
    errTimeout: 'Connection timed out. Check your internet and try again.',
    errSuffix: 'If the issue persists, continue via the ',
    errLink: 'digital center',
    trust1: 'Stripe PCI DSS',
    trust2: '7 days risk-free',
    trust3: 'Stripe payment',
    mobilePill1: '⚡ Guided activation',
    mobilePill2: '🔒 Stripe PCI DSS',
    mobilePill3: '↩️ 7 days risk-free',
    mobilePill4: '🤖 Claude AI'
  };

  // ── ESTADO ──────────────────────────────────────────────────────
  var state = { currentStep: 1, selectedPlan: 'pro', isAnual: false, lang: 'pt' };
  var _submitting = false;

  // ── HELPERS ──────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }
  function getLang() {
    var L = String(new URLSearchParams(window.location.search).get('lang') || '').toLowerCase();
    if (L === 'es') return 'es';
    if (L === 'en') return 'en';
    return 'pt';
  }
  function isUsdLang(l) { return l === 'es' || l === 'en'; }
  function planBundle(l) { return l === 'es' ? PLANS_ES : (l === 'en' ? PLANS_EN : PLANS_PT); }
  function savingsBundle(l) { return l === 'es' ? SAVINGS_ES : (l === 'en' ? SAVINGS_EN : SAVINGS_PT); }
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
    var plans = planBundle(state.lang);
    var suffix = state.lang === 'es' ? '/mes' : (state.lang === 'en' ? '/mo' : '/mês');
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
    updatePlanSavings();
  }

  // ── ECONOMIA ANUAL ────────────────────────────────────────────────
  function updatePlanSavings() {
    var savings = savingsBundle(state.lang);
    ['starter', 'pro', 'parceiro'].forEach(function(plan) {
      var el = document.getElementById('plan-savings-' + plan);
      if (!el) return;
      if (state.isAnual && savings[plan]) {
        el.textContent = savings[plan];
        el.style.display = 'inline-block';
      } else {
        el.style.display = 'none';
      }
    });
  }

  // ── SUBMIT ───────────────────────────────────────────────────────
  function submitForm() {
    if (_submitting) return;
    _submitting = true;
    var btn = $('submitBtn'), banner = $('errorBanner');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    if (banner) banner.style.display = 'none';

    var planoKey = state.selectedPlan + (state.isAnual ? '_anual' : '');
    var plans = planBundle(state.lang);
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

    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 15000);

    fetch(API_URL + '/criar-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctrl.signal
    })
    .then(function(r) { clearTimeout(timer); return r.json(); })
    .then(function(res) {
      if (res.url) {
        // Cadastro foi pra pagamento — limpa draft local (não vamos mais usar)
        clearAutosave();
        window.location.href = res.url;
      }
      else throw new Error(res.error || 'Erro ao criar sessão de pagamento');
    })
    .catch(function(err) {
      clearTimeout(timer);
      _submitting = false;
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      var isAbort = err && (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort')));
      showError(isAbort ? { message: 'timeout' } : err);
    });
  }

  function showError(err) {
    var banner = $('errorBanner'), fallback = $('fallback-contact');
    var L = state.lang;
    var isTimeout = err && err.message && err.message.toLowerCase().includes('timeout');
    var msg, suffix, linkText, linkHref;
    if (L === 'es') {
      msg = isTimeout ? ES.errTimeout : ES.errGeneric;
      suffix = ES.errSuffix; linkText = ES.errLink; linkHref = '/soporte/';
    } else if (L === 'en') {
      msg = isTimeout ? EN.errTimeout : EN.errGeneric;
      suffix = EN.errSuffix; linkText = EN.errLink; linkHref = '/support/';
    } else {
      msg = isTimeout ? 'A conexão expirou. Verifique sua internet e tente novamente.' : 'Estamos com dificuldades técnicas. Tente novamente em alguns minutos.';
      suffix = 'Se persistir, siga pela '; linkText = 'central digital'; linkHref = '/suporte/';
    }
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

  // ── READINESS ES/EN (USD) ────────────────────────────────────────
  function loadCheckoutReadiness() {
    if (!isUsdLang(state.lang)) return;
    var pack = state.lang === 'en' ? EN : ES;
    var ctrlR = new AbortController();
    var readinessTimer = setTimeout(function() { ctrlR.abort(); }, 8000);
    fetch(API_URL + '/checkout/readiness', { signal: ctrlR.signal })
      .then(function(r) { clearTimeout(readinessTimer); return r.json(); })
      .then(function(p) {
        if (!p || !p.readiness) return;
        var banner = $('checkoutReadinessBanner'), btn = $('submitBtn');
        // backend's readiness.es covers USD prices for both ES and EN flows
        var usdReady = p.readiness.es && p.readiness.es.ready;
        if (!usdReady) {
          if (banner) { banner.textContent = pack.readinessError; banner.style.display = 'block'; }
          if (btn) btn.disabled = true;
        } else {
          if (banner) { banner.className = 'status-banner ok'; banner.textContent = pack.readinessOk; banner.style.display = 'block'; }
        }
      }).catch(function(err) {
        clearTimeout(readinessTimer);
        var isAbort = err && err.name === 'AbortError';
        var banner = $('checkoutReadinessBanner'), btn = $('submitBtn');
        if (!isAbort) {
          if (btn) btn.disabled = true;
          if (banner) { banner.textContent = pack.readinessError; banner.style.display = 'block'; }
        }
      });
  }

  // ── AUTO-SAVE (LGPD-friendly: TTL 7 dias, opt-out fácil) ──────────
  // Persiste whats + email em localStorage para o usuário não perder o
  // que digitou ao recarregar a página, fechar o navegador ou voltar do
  // Stripe cancelado. Limpa automaticamente após cadastro completo ou
  // após 7 dias (TTL). Não salva nada sensível além do par whats+email.
  var AUTOSAVE_KEY = 'mb_signup_draft_v1';
  var AUTOSAVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function loadAutosave() {
    try {
      var raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      if (!data.savedAt || (Date.now() - data.savedAt) > AUTOSAVE_TTL_MS) {
        localStorage.removeItem(AUTOSAVE_KEY);
        return null;
      }
      return data;
    } catch (_) { return null; }
  }

  function saveAutosave() {
    try {
      var whatsEl = $('whats'), emailEl = $('email');
      var whats = whatsEl ? whatsEl.value : '';
      var email = emailEl ? emailEl.value : '';
      if (!whats && !email) {
        localStorage.removeItem(AUTOSAVE_KEY);
        return;
      }
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        whats: whats, email: email, savedAt: Date.now()
      }));
    } catch (_) { /* quota exceeded ou modo privado — ignora silenciosamente */ }
  }

  function clearAutosave() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) {}
  }

  function restoreAutosaveIfAvailable() {
    var saved = loadAutosave();
    if (!saved) return;
    var whatsEl = $('whats'), emailEl = $('email');
    if (whatsEl && saved.whats && !whatsEl.value) whatsEl.value = saved.whats;
    if (emailEl && saved.email && !emailEl.value) emailEl.value = saved.email;
    // Dispara validação visual para já mostrar checkmark verde nos campos válidos
    if (whatsEl && saved.whats) {
      var d = saved.whats.replace(/\D/g,'');
      var fg = $('fg-whats');
      if (fg && d.length >= 10) fg.classList.add('valid');
    }
    if (emailEl && saved.email) {
      var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      var fg2 = $('fg-email');
      if (fg2 && emailRx.test(saved.email.trim())) fg2.classList.add('valid');
    }
  }

  // ── VALIDAÇÃO TEMPO REAL ──────────────────────────────────────────
  function setupRealtimeValidation() {
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var whatsEl = $('whats');
    if (whatsEl) {
      // Formata enquanto digita e remove erro quando válido
      whatsEl.addEventListener('input', function() {
        var atEnd = this.selectionStart === this.value.length;
        if (atEnd) this.value = formatPhone(this.value);
        var d = this.value.replace(/\D/g,'');
        var fg = $('fg-whats');
        if (fg) {
          if (d.length >= 10) { fg.classList.remove('has-error'); fg.classList.add('valid'); }
          else { fg.classList.remove('valid'); }
        }
        saveAutosave();
      });
      // Valida ao sair do campo (blur) — exibe erro cedo, antes do submit
      whatsEl.addEventListener('blur', function() {
        var d = this.value.replace(/\D/g,'');
        var fg = $('fg-whats');
        if (fg && d.length > 0 && d.length < 10) {
          fg.classList.add('has-error');
          fg.classList.remove('valid');
        }
      });
    }
    var emailEl = $('email');
    if (emailEl) {
      // Remove erro quando e-mail fica válido
      emailEl.addEventListener('input', function() {
        var fg = $('fg-email');
        if (fg) {
          if (emailRx.test(this.value.trim())) { fg.classList.remove('has-error'); fg.classList.add('valid'); }
          else { fg.classList.remove('valid'); }
        }
        saveAutosave();
      });
      // Normaliza (lowercase + trim) e valida ao sair do campo
      emailEl.addEventListener('blur', function() {
        this.value = this.value.toLowerCase().trim();
        var fg = $('fg-email');
        if (fg && this.value.length > 0) {
          var ok = emailRx.test(this.value);
          fg.classList.toggle('has-error', !ok);
          fg.classList.toggle('valid', ok);
        }
      });
    }
  }

  // ── TRADUÇÃO ─────────────────────────────────────────────────────
  function applyLang() {
    var L = state.lang;
    qsa('.locale-link').forEach(function(link) {
      var linkLang = link.getAttribute('data-lang-option') || 'pt';
      var isActive = linkLang === L;
      link.classList.toggle('active', isActive);
      if (isActive) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
    if (L === 'pt') return; // PT é o default — nada para traduzir

    var T = (L === 'en') ? EN : ES;
    var titleByLang = { es: 'Comenzar ahora — MercaBot', en: 'Get started — MercaBot' };
    var ariaSubmitByLang = { es: 'Ir al pago seguro en Stripe', en: 'Go to secure Stripe checkout' };
    var phonePlaceholderByLang = {
      es: '+52, +54, +57 o +55',
      en: 'e.g. +1 555 123 4567'
    };

    document.documentElement.lang = L;
    document.title = titleByLang[L] || titleByLang.es;

    setText('nav-login-link', T.navLogin);
    setHTML('aside-title', T.asideTitle);
    setText('aside-copy', T.asideCopy);
    setText('b1-title', T.b1Title); setText('b1-copy', T.b1Copy);
    setText('b2-title', T.b2Title); setText('b2-copy', T.b2Copy);
    setText('b3-title', T.b3Title); setText('b3-copy', T.b3Copy);
    setHTML('b4-title', T.b4Title); setHTML('b4-copy', T.b4Copy);
    setText('proof-copy', T.proofCopy);
    setText('prog-label-1', T.prog1); setText('prog-label-2', T.prog2);

    // Passo 1
    setText('step1-heading', T.step1Heading); setText('step1-sub', T.step1Sub);
    setText('lbl-whats', T.lblWhats);
    var wh = $('whats-hint'); if(wh) wh.textContent = T.whatsHint;
    var we = $('whats-err'); if(we) we.textContent = T.whatsErr;
    setPlaceholder('whats', phonePlaceholderByLang[L] || '+52, +54, +57 o +55');
    var ph = $('phone-prefix'); if(ph) ph.textContent = '🌎 +';
    setText('lbl-email', T.lblEmail);
    var eh = $('email-hint'); if(eh) eh.textContent = T.emailHint;
    var ee = $('email-err'); if(ee) ee.textContent = T.emailErr;
    var wr = $('wa-reassurance-copy'); if(wr) wr.textContent = T.waReassurance;
    // Meta prerequisites callout — traduzido
    var summaryEl = $('metaPrereqSummary');
    if (summaryEl) {
      var summaryText = L === 'es'
        ? '📋 Lo que vas a necesitar para activar WhatsApp (haz clic para ver)'
        : L === 'en'
        ? '📋 What you\'ll need to activate WhatsApp (click to expand)'
        : '📋 O que você vai precisar pra ativar o WhatsApp (clique pra ver)';
      var spanText = summaryEl.querySelector('span');
      if (spanText) spanText.textContent = summaryText;
    }
    var introEl = $('metaPrereqIntro');
    if (introEl) {
      introEl.textContent = L === 'es'
        ? 'Para que el bot funcione oficialmente en WhatsApp, Meta exige:'
        : L === 'en'
        ? 'For the bot to work officially on WhatsApp, Meta requires:'
        : 'Para o bot funcionar oficialmente no WhatsApp, a Meta exige:';
    }
    var hintEl = $('metaPrereqHint');
    if (hintEl) {
      hintEl.innerHTML = L === 'es'
        ? '¿No tienes todo ahora? No hay problema — puedes pagar y configurar el bot mientras resuelves Meta. <strong style="color:var(--text)">No cobramos nada en estos 7 días de evaluación.</strong>'
        : L === 'en'
        ? 'Don\'t have everything now? No problem — you can pay and configure the bot while sorting out Meta. <strong style="color:var(--text)">We charge nothing in these 7 evaluation days.</strong>'
        : 'Não tem tudo agora? Sem problema — você pode pagar e configurar o bot enquanto resolve a Meta. <strong style="color:var(--text)">Não cobramos nada nesses 7 dias de avaliação.</strong>';
    }
    setText('btn1-text', T.btn1Text);

    // Passo 2
    setText('step2-heading', T.step2Heading); setText('step2-sub', T.step2Sub);
    setText('lbl-mensal', T.lblMensal); setText('lbl-anual', T.lblAnual);
    setText('economia-badge', T.economiaBadge);
    var pb = qs('.plan-popular-badge'); if(pb) pb.textContent = T.popularBadge;
    setText('back-label-2', T.backLabel);
    setText('submit-text', T.submitText);
    var sbEl = $('submitBtn'); if (sbEl) sbEl.setAttribute('aria-label', ariaSubmitByLang[L] || ariaSubmitByLang.es);
    setText('plan-name-parceiro', T.planNameParceiro);
    setText('plan-note-starter', T.planNoteStarter);
    setText('plan-note-pro', T.planNotePro);
    setText('plan-note-parceiro', T.planNoteParceiro);

    [['starter-features', T.starterFeatures],['pro-features', T.proFeatures],['parceiro-features', T.parceiroFeatures]].forEach(function(pair) {
      var ul = $(pair[0]);
      if (ul) ul.innerHTML = pair[1].map(function(f){ return '<li>'+f+'</li>'; }).join('');
    });

    // Trust row
    setText('trust-1', T.trust1); setText('trust-2', T.trust2); setText('trust-3', T.trust3);

    // Mobile benefits pills
    var pills = document.querySelectorAll('.mb-pill');
    var pillTexts = [T.mobilePill1, T.mobilePill2, T.mobilePill3, T.mobilePill4];
    pills.forEach(function(p, i) { if (pillTexts[i]) p.textContent = pillTexts[i]; });

    setText('fallback-title', T.fallbackTitle); setText('fallback-copy', T.fallbackCopy);
    var fa = $('fallback-wa'); if(fa) { fa.textContent = T.fallbackLink; fa.href = T.fallbackHref; }
    var tn = $('terms-note'); if(tn) tn.innerHTML = T.termsNote;
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

    // Planos — click / Enter / Space no card
    qsa('.plan-card[data-plan]').forEach(function(card) {
      card.addEventListener('click', function() { selectPlan(card.getAttribute('data-plan')); });
      card.addEventListener('keydown', function(e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectPlan(card.getAttribute('data-plan')); }
      });
    });
    // Planos — setas do teclado (focus no radio interno) → sincroniza .selected
    qsa('.plan-card[data-plan] input[type=radio]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        if (this.checked) selectPlan(this.value);
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

  // ── RETORNO DO CHECKOUT CANCELADO ─────────────────────────────────
  // Quando o usuário clica "Voltar" no Stripe, chega com ?cancelado=1.
  // Restauramos os dados salvos em sessionStorage e exibimos uma mensagem suave.
  function handleCanceladoReturn() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('cancelado') !== '1') return;

    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var saved = {};
    try { saved = JSON.parse(sessionStorage.getItem('mb_signup') || '{}'); } catch(_) {}

    // Restaura campos do passo 1
    var whatsEl = $('whats'), emailEl = $('email');
    if (saved.whats && whatsEl && !whatsEl.value) {
      whatsEl.value = saved.whats;
      var d = saved.whats.replace(/\D/g, '');
      var fgW = $('fg-whats');
      if (fgW && d.length >= 10) fgW.classList.add('valid');
    }
    if (saved.email && emailEl && !emailEl.value) {
      emailEl.value = saved.email;
      var fgE = $('fg-email');
      if (fgE && emailRx.test(saved.email)) fgE.classList.add('valid');
    }

    // Se ambos os campos estão preenchidos, vai direto para o passo 2
    if (saved.whats && saved.email) {
      goToStep(2, 'forward');
      var warnBanner = $('checkoutReadinessBanner');
      if (warnBanner) {
        warnBanner.className = 'status-banner warn';
        warnBanner.textContent = state.lang === 'es'
          ? 'Checkout cancelado. Revisa el plan e intenta de nuevo.'
          : (state.lang === 'en'
              ? 'Checkout canceled. Review your plan and try again when ready.'
              : 'Checkout cancelado. Revise o plano e tente novamente quando estiver pronto.');
        warnBanner.style.display = 'block';
      }
    }

    // Limpa o parâmetro da URL sem recarregar
    var cleanUrl = window.location.pathname + (state.lang !== 'pt' ? '?lang=' + state.lang : '');
    history.replaceState(null, '', cleanUrl);
  }

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
    state.lang = getLang();
    applyLang();
    applyQueryParams();
    updatePrices();
    updatePlanSavings(); // inicializa badges (oculto para mensal, visível para anual via URL)
    updateProgress();
    setupRealtimeValidation();
    bindEvents();
    restoreAutosaveIfAvailable(); // recupera draft do usuário após reload/voltar do Stripe
    handleCanceladoReturn(); // detecta retorno do Stripe cancelado e restaura estado
    loadCheckoutReadiness();
    // Foca o primeiro campo visível do passo atual
    setTimeout(function() {
      if (state.currentStep === 1) { var f = $('whats'); if(f) f.focus(); }
    }, 100);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
