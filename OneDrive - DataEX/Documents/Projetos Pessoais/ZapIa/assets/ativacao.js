(function(){
  'use strict';

  var API_URL = (window.__mbConfig||{}).API_BASE_URL||'https://api.mercabot.com.br';
  var MAX_FAQ = 5;

  // Dados do signup via sessionStorage
  var signupData = {};
  try { signupData = JSON.parse(sessionStorage.getItem('mb_signup') || '{}'); } catch(_){}

  var params = new URLSearchParams(window.location.search);
  var sessionId = params.get('session_id');
  var lang = params.get('lang') === 'es' ? 'es' : 'pt';

  // Estado do wizard
  var ob = {
    step: 1,
    tom: 'amigavel',
    faqCount: 0
  };

  // ── HELPERS ────────────────────────────────────────────────────
  function $(id){ return document.getElementById(id); }
  function qs(sel){ return document.querySelector(sel); }
  function qsa(sel){ return document.querySelectorAll(sel); }

  // ── VERIFICAR PAGAMENTO ────────────────────────────────────────
  function verificarPagamento() {
    if (!sessionId) {
      // Sem session_id — mostrar wizard diretamente (pode ser redirect manual)
      showWizard(null);
      return;
    }
    fetch(API_URL + '/verificar-pagamento?session_id=' + encodeURIComponent(sessionId))
      .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(result){
        var data = result.data || {};
        if (data.status === 'paid' || data.status === 'no_payment_required') {
          showWizard(data);
        } else {
          // Pago mas em processamento (boleto) — mostrar wizard mesmo assim
          showWizard(data);
        }
      })
      .catch(function(){
        // Falha na verificação — mostrar wizard de qualquer forma
        showWizard(null);
      });
  }

  function showWizard(paymentData) {
    var pw = $('paymentWaiting');
    var oc = $('onboardCard');
    if (pw) pw.style.display = 'none';
    if (oc) { oc.style.display = 'block'; oc.classList.add('visible'); }

    // Pré-preencher saudação com nome da empresa se já disponível
    var empresa = (paymentData && paymentData.metadata && paymentData.metadata.empresa) || signupData.empresa || '';
    if (empresa) {
      var saudacaoEl = $('ob-saudacao');
      if (saudacaoEl && !saudacaoEl.value) {
        saudacaoEl.placeholder = 'Olá! 👋 Bem-vindo à ' + empresa + '! Como posso te ajudar hoje?';
      }
      var empresaEl = $('ob-empresa');
      if (empresaEl && !empresaEl.value) empresaEl.value = empresa;
    }
  }

  // ── NAVEGAÇÃO ─────────────────────────────────────────────────
  function goToObStep(next, direction) {
    var cur = ob.step;
    if (next === cur) return;
    var panelCur = $('ob-panel-' + cur);
    var panelNext = $('ob-panel-' + next);
    if (!panelNext) return;
    if (panelCur) { panelCur.classList.remove('active'); }
    panelNext.classList.remove('back-enter');
    if (direction === 'back') panelNext.classList.add('back-enter');
    panelNext.classList.add('active');
    ob.step = next;
    updateObProgress();
    var h = panelNext.querySelector('.step-heading, h2');
    if (h) { h.setAttribute('tabindex','-1'); h.focus(); }
    var card = $('onboardCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateObProgress() {
    var step = ob.step;
    var prog = qs('.ob-progress');
    if (prog) prog.setAttribute('aria-valuenow', step);
    qsa('.ob-step').forEach(function(el){
      var s = parseInt(el.getAttribute('data-step'), 10);
      el.classList.remove('active','done');
      if (s === step) el.classList.add('active');
      else if (s < step) el.classList.add('done');
    });
    qsa('.ob-line').forEach(function(el, i){ el.classList.toggle('done', i+1 < step); });
  }

  // ── VALIDAÇÕES ────────────────────────────────────────────────
  function validateStep1() {
    var empresa = $('ob-empresa');
    var segmento = $('ob-segmento');
    var empresaOk = empresa && empresa.value.trim().length >= 2;
    var segmentoOk = segmento && segmento.value !== '';
    var fgE = $('fg-empresa'), fgS = $('fg-segmento');
    if (fgE) fgE.classList.toggle('has-error', !empresaOk);
    if (fgS) fgS.classList.toggle('has-error', !segmentoOk);
    if (!empresaOk && empresa) { empresa.focus(); return false; }
    if (!segmentoOk && segmento) { segmento.focus(); return false; }
    return true;
  }

  // ── FAQ ───────────────────────────────────────────────────────
  function renderFaqItem(index) {
    var item = document.createElement('div');
    item.className = 'faq-item';
    item.dataset.index = index;
    item.innerHTML =
      '<div class="faq-item-num">Pergunta ' + (index+1) + '</div>' +
      '<button type="button" class="faq-remove" aria-label="Remover pergunta ' + (index+1) + '">×</button>' +
      '<div class="form-group" style="margin-bottom:.65rem">' +
        '<label class="form-label" for="faq-q-' + index + '">Pergunta do cliente</label>' +
        '<input class="form-input" id="faq-q-' + index + '" type="text" placeholder="Ex: Qual o horário de atendimento?">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0">' +
        '<label class="form-label" for="faq-a-' + index + '">Resposta do bot</label>' +
        '<textarea class="form-textarea" id="faq-a-' + index + '" placeholder="Ex: Nosso horário é de segunda a sexta, das 9h às 18h." rows="2"></textarea>' +
      '</div>';
    item.querySelector('.faq-remove').addEventListener('click', function(){
      item.remove();
      ob.faqCount--;
      updateFaqButton();
      renumberFaq();
    });
    return item;
  }

  function addFaqItem() {
    if (ob.faqCount >= MAX_FAQ) return;
    var list = $('faq-list');
    if (!list) return;
    list.appendChild(renderFaqItem(ob.faqCount));
    ob.faqCount++;
    updateFaqButton();
  }

  function updateFaqButton() {
    var btn = $('add-faq-btn');
    if (!btn) return;
    if (ob.faqCount >= MAX_FAQ) {
      btn.disabled = true;
      btn.textContent = 'Máximo de ' + MAX_FAQ + ' perguntas atingido';
    } else {
      btn.disabled = false;
      btn.textContent = '+ Adicionar pergunta frequente';
    }
  }

  function renumberFaq() {
    var items = document.querySelectorAll('.faq-item');
    items.forEach(function(item, i){
      item.dataset.index = i;
      var num = item.querySelector('.faq-item-num');
      if (num) num.textContent = 'Pergunta ' + (i+1);
      var q = item.querySelector('.form-input');
      if (q) q.id = 'faq-q-' + i;
      var a = item.querySelector('.form-textarea');
      if (a) a.id = 'faq-a-' + i;
      var removeBtn = item.querySelector('.faq-remove');
      if (removeBtn) removeBtn.setAttribute('aria-label', 'Remover pergunta ' + (i+1));
    });
    ob.faqCount = items.length;
  }

  function collectFaq() {
    var items = document.querySelectorAll('.faq-item');
    var faq = [];
    items.forEach(function(item, i){
      var q = item.querySelector('#faq-q-' + i);
      var a = item.querySelector('#faq-a-' + i);
      var qVal = q ? q.value.trim() : '';
      var aVal = a ? a.value.trim() : '';
      if (qVal || aVal) faq.push({ pergunta: qVal, resposta: aVal });
    });
    return faq;
  }

  // ── ENVIO DO ONBOARDING ───────────────────────────────────────
  function submitOnboarding() {
    var btn = $('ob-submit');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    var tomMap = { amigavel: 'amigável', formal: 'formal', descontraido: 'descontraído' };

    var payload = {
      email:          signupData.email || params.get('email') || '',
      whats:          signupData.whats || params.get('whats') || '',
      empresa:        ($('ob-empresa') ? $('ob-empresa').value.trim() : ''),
      responsavel:    ($('ob-responsavel') ? $('ob-responsavel').value.trim() : ''),
      segmento:       ($('ob-segmento') ? $('ob-segmento').value : ''),
      tom:            tomMap[ob.tom] || ob.tom,
      saudacao:       ($('ob-saudacao') ? $('ob-saudacao').value.trim() : ''),
      horario_inicio: ($('ob-horario-inicio') ? $('ob-horario-inicio').value : '09:00'),
      horario_fim:    ($('ob-horario-fim') ? $('ob-horario-fim').value : '18:00'),
      fora_horario:   ($('ob-fora-horario') ? $('ob-fora-horario').value.trim() : ''),
      faq:            collectFaq(),
      session_id:     sessionId || '',
      lang:           lang
    };

    sessionStorage.setItem('mb_onboarding', JSON.stringify(payload));

    fetch(API_URL + '/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r){ return r.json(); })
    .then(function(){ showSuccess(payload); })
    .catch(function(){ showSuccess(payload); }); // sucesso mesmo se API falhar (dados no sessionStorage)
  }

  function showSuccess(payload) {
    var oc = $('onboardCard');
    var sb = $('successBox');
    if (oc) oc.style.display = 'none';
    if (sb) sb.style.display = 'flex';
    if (sb) sb.style.flexDirection = 'column';
    if (sb) sb.style.alignItems = 'center';

    // Chips de resumo
    var summary = $('success-summary');
    if (summary && payload) {
      var chips = [];
      if (payload.empresa) chips.push('🏢 ' + payload.empresa);
      if (payload.segmento) chips.push('📋 ' + payload.segmento);
      if (payload.tom) chips.push('🗣 Tom ' + payload.tom);
      if (payload.faq && payload.faq.length) chips.push('❓ ' + payload.faq.length + ' pergunta(s) configurada(s)');
      summary.innerHTML = chips.map(function(c){ return '<span class="summary-chip">' + c + '</span>'; }).join('');
    }

    // Scroll ao topo
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── TOM DE VOZ ────────────────────────────────────────────────
  function bindTomButtons() {
    qsa('.tom-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        qsa('.tom-btn').forEach(function(b){ b.classList.remove('selected'); b.setAttribute('aria-pressed','false'); });
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed','true');
        ob.tom = btn.getAttribute('data-tom');
      });
    });
  }

  // ── EVENTOS ──────────────────────────────────────────────────
  function bindEvents() {
    // Passo 1 → 2
    var btn1 = $('ob-btn1-next');
    if (btn1) btn1.addEventListener('click', function(){ if(validateStep1()) goToObStep(2,'forward'); });

    // Enter nos campos do passo 1
    ['ob-empresa','ob-responsavel'].forEach(function(id, idx){
      var el = $(id);
      if (!el) return;
      el.addEventListener('keydown', function(e){
        if (e.key === 'Enter') {
          e.preventDefault();
          if (idx === 0) { var next = $('ob-responsavel'); if(next) next.focus(); }
          else { var seg = $('ob-segmento'); if(seg) seg.focus(); }
        }
      });
    });

    // Voltar 2 → 1
    var btn2back = $('ob-btn2-back');
    if (btn2back) btn2back.addEventListener('click', function(){ goToObStep(1,'back'); });
    // Avançar 2 → 3
    var btn2next = $('ob-btn2-next');
    if (btn2next) btn2next.addEventListener('click', function(){ goToObStep(3,'forward'); });
    // Voltar 3 → 2
    var btn3back = $('ob-btn3-back');
    if (btn3back) btn3back.addEventListener('click', function(){ goToObStep(2,'back'); });

    // Submit
    var submitBtn = $('ob-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitOnboarding);

    // Pular FAQ
    var skipBtn = $('faq-skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', submitOnboarding);

    // Adicionar FAQ
    var addFaq = $('add-faq-btn');
    if (addFaq) addFaq.addEventListener('click', addFaqItem);

    // Tom
    bindTomButtons();
  }

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    bindEvents();
    verificarPagamento();
    // Adicionar 1 FAQ em branco como exemplo
    addFaqItem();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
