
/* ── 1. Autoformatação do número de telefone ─────────────────── */
(function(){
  var input = document.getElementById('channelNumber');
  var icon  = document.getElementById('channelNumberIcon');
  var hint  = document.getElementById('channelNumberHint');
  if(!input) return;

  function digitsOnly(v){ return v.replace(/\D/g,''); }

  function formatBR(digits){
    // +55 (XX) XXXXX-XXXX  ou  +55 (XX) XXXX-XXXX
    if(!digits.startsWith('55')) digits = '55' + digits;
    var d = digits;
    var out = '+' + d.slice(0,2);                      // +55
    if(d.length > 2)  out += ' (' + d.slice(2,4);
    if(d.length > 4)  out += ') ';
    if(d.length > 4 && d.length <= 10) out += d.slice(4);
    else if(d.length > 10) out += d.slice(4, d.length-4) + '-' + d.slice(-4);
    return out;
  }

  function validate(v){
    var d = digitsOnly(v);
    return d.length >= 12 && d.length <= 13; // 55 + DDD(2) + numero(8ou9)
  }

  input.addEventListener('input', function(){
    var raw = digitsOnly(input.value);
    if(raw.length === 0){ input.value=''; setIcon(''); return; }
    var formatted = formatBR(raw);
    input.value = formatted;
    if(validate(formatted)){
      setIcon('✅'); input.style.borderColor='rgba(0,230,118,.55)';
      hint.textContent = 'Número válido — pode salvar.';
      hint.style.color = 'rgba(0,230,118,.8)';
    } else {
      setIcon(''); input.style.borderColor='';
      hint.textContent = 'Digite o número com DDD — ex: 11 99999-9999.';
      hint.style.color = '';
    }
  });

  function setIcon(v){
    if(!icon) return;
    icon.textContent = v;
    icon.style.opacity = v ? '1' : '0';
  }
})();

/* ── X. Copiar número com 1 clique ───────────────────────────── */
(function(){
  var copyBtn = document.getElementById('copyWaNumberBtn');
  if(!copyBtn) return;

  function refreshCopyBtn(){
    var num = typeof state !== 'undefined' && state && state.waNumber ? state.waNumber : '';
    copyBtn.style.display = num ? '' : 'none';
    copyBtn.title = num ? 'Copiar: ' + num : 'Copiar número';
  }

  copyBtn.addEventListener('click', function(){
    var num = typeof state !== 'undefined' && state && state.waNumber ? state.waNumber : '';
    if(!num) return;
    navigator.clipboard.writeText(num).then(function(){
      copyBtn.textContent = '✅';
      copyBtn.style.color = 'var(--green)';
      setTimeout(function(){ copyBtn.textContent = '📋'; copyBtn.style.color = ''; }, 2000);
    }).catch(function(){
      // Fallback for browsers without clipboard API
      var ta = document.createElement('textarea');
      ta.value = num;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      copyBtn.textContent = '✅';
      setTimeout(function(){ copyBtn.textContent = '📋'; }, 2000);
    });
  });

  setTimeout(function(){ refreshCopyBtn(); setInterval(refreshCopyBtn, 3000); }, 2000);
})();

/* ── Y. AI onboarding shortcut ───────────────────────────────── */
(function(){
  var btn   = document.getElementById('aiOnboardBtn');
  var input = document.getElementById('aiOnboardInput');
  if(!btn || !input) return;

  btn.addEventListener('click', function(){
    var text = (input.value || '').trim();
    if(!text){ input.focus(); return; }
    // Copy text into bpFreeText and trigger generate button
    var freeText = document.getElementById('bpFreeText');
    var genBtn   = document.getElementById('bpGenerateBtn');
    // First select a generic segment if none selected
    var firstSeg = document.querySelector('.bp-seg');
    if(firstSeg && !document.querySelector('.bp-seg.selected')){
      firstSeg.click();
    }
    setTimeout(function(){
      if(freeText){ freeText.value = text; }
      if(genBtn){ genBtn.click(); }
    }, 180);
  });
})();

/* ── Z. Celebração ao concluir o setup ───────────────────────── */
(function(){
  var KEY = 'mb_celebrated';
  var overlay = document.getElementById('celebrationOverlay');
  var canvas  = document.getElementById('confettiCanvas');
  if(!overlay || !canvas) return;

  var shown = false;

  // Simple confetti engine
  function launchConfetti(){
    var ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    var particles = [];
    var colors = ['#00e676','#00c853','#69f0ae','#ffffff','#b9f6ca','#ffd740'];
    for(var i=0;i<120;i++){
      particles.push({
        x: Math.random()*canvas.width,
        y: -10 - Math.random()*100,
        w: 8 + Math.random()*6,
        h: 4 + Math.random()*4,
        color: colors[Math.floor(Math.random()*colors.length)],
        vx: (Math.random()-0.5)*4,
        vy: 2 + Math.random()*4,
        angle: Math.random()*360,
        spin: (Math.random()-0.5)*8,
        opacity: 1
      });
    }
    var startTime = Date.now();
    function draw(){
      if(Date.now()-startTime > 3500){ ctx.clearRect(0,0,canvas.width,canvas.height); return; }
      ctx.clearRect(0,0,canvas.width,canvas.height);
      particles.forEach(function(p){
        p.x += p.vx; p.y += p.vy; p.angle += p.spin; p.vy += 0.08;
        p.opacity = Math.max(0, 1 - (Date.now()-startTime)/3000);
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle * Math.PI/180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        ctx.restore();
      });
      requestAnimationFrame(draw);
    }
    draw();
  }

  function showCelebration(){
    if(shown) return;
    try{ if(localStorage.getItem(KEY)) return; } catch(_){}
    shown = true;
    overlay.style.display = 'block';
    launchConfetti();
    try{ localStorage.setItem(KEY,'1'); } catch(_){}
  }

  function checkSetupComplete(){
    if(typeof state === 'undefined' || !state) return;
    var hasPhone = state.channelConnected || state.channelPending;
    var notes    = document.getElementById('opNotes');
    var qr1      = document.getElementById('quickReply1');
    var hasOp    = notes && notes.value.trim() && qr1 && qr1.value.trim();
    var hasTested = state.channelConnected;
    if(hasPhone && hasOp && hasTested) showCelebration();
  }

  var testBtn  = document.getElementById('celebrationTestBtn');
  var closeBtn = document.getElementById('celebrationCloseBtn');
  if(testBtn) testBtn.addEventListener('click', function(){
    overlay.style.display = 'none';
    var btn = document.getElementById('runChannelSelfTestBtn');
    if(btn) btn.click();
  });
  if(closeBtn) closeBtn.addEventListener('click', function(){ overlay.style.display = 'none'; });

  // Check every 5s after initial load
  setTimeout(function(){ checkSetupComplete(); setInterval(checkSetupComplete, 5000); }, 3000);
})();

/* ── W. Boas-vindas no primeiro acesso ───────────────────────── */
(function(){
  var KEY = 'mb_welcome_shown';
  var overlay = document.getElementById('welcomeOverlay');
  if(!overlay) return;

  function showWelcome(){
    try{ if(localStorage.getItem(KEY)) return; } catch(_){}
    // Only show if setup is not done
    var isDone = typeof state !== 'undefined' && state && state.channelConnected;
    if(isDone) return;
    overlay.style.display = 'flex';
    // Personalize message
    var msg = document.getElementById('welcomeMsg');
    var name = typeof state !== 'undefined' && state && state.company ? state.company : '';
    if(msg && name) msg.textContent = 'Olá, ' + name + '! Agora você tem tudo que precisa para colocar a IA respondendo seus clientes no WhatsApp. São só 3 passos — leva menos de 15 minutos.';
    try{ localStorage.setItem(KEY,'1'); } catch(_){}
  }

  function dismiss(){
    overlay.style.display = 'none';
  }

  var startBtn   = document.getElementById('welcomeStartBtn');
  var dismissBtn = document.getElementById('welcomeDismissBtn');
  if(startBtn) startBtn.addEventListener('click', function(){
    dismiss();
    // Scroll to quickstart or open channel modal
    var qs1 = document.getElementById('qs1ActionBtn');
    if(qs1){ setTimeout(function(){ qs1.click(); }, 200); }
  });
  if(dismissBtn) dismissBtn.addEventListener('click', dismiss);

  // Show after app loads and state is available
  setTimeout(showWelcome, 2500);
})();

/* ── I. Lembrete de inatividade in-app ───────────────────────── */
(function(){
  var KEY_DISMISSED = 'mb_inactivity_dismissed';
  var banner  = document.getElementById('inactivityBanner');
  var msgEl   = document.getElementById('inactivityMsg');
  var stepEl  = document.getElementById('inactivityStep');
  var ctaBtn  = document.getElementById('inactivityCta');
  var closeBtn= document.getElementById('inactivityDismiss');
  if(!banner) return;

  function getNextStep(){
    if(typeof state === 'undefined' || !state) return null;
    if(!state.waNumber && !state.channelConnected && !state.channelPending)
      return { label:'Informar o número do WhatsApp', action: function(){ var b=document.getElementById('qs1ActionBtn'); if(b) b.click(); }};
    var notes = document.getElementById('opNotes');
    var qr1   = document.getElementById('quickReply1');
    if((!notes||!notes.value.trim()) || (!qr1||!qr1.value.trim()))
      return { label:'Preencher como o bot deve atender', action: function(){ var b=document.getElementById('qs2ActionBtn'); if(b) b.click(); }};
    if(!state.channelConnected)
      return { label:'Fazer o primeiro teste guiado', action: function(){ var b=document.getElementById('qs3ActionBtn'); if(b) b.click(); }};
    return null;
  }

  function showReminder(){
    try{ if(localStorage.getItem(KEY_DISMISSED)) return; } catch(_){}
    var step = getNextStep();
    if(!step) return;
    if(msgEl)  msgEl.textContent  = 'Falta só mais um passo para o bot começar a responder.';
    if(stepEl) stepEl.textContent = '→ ' + step.label;
    if(ctaBtn) ctaBtn.onclick = function(){ banner.style.display='none'; step.action(); };
    banner.style.display = 'flex';
  }

  if(closeBtn) closeBtn.addEventListener('click', function(){
    banner.style.display = 'none';
    try{ localStorage.setItem(KEY_DISMISSED,'1'); } catch(_){}
  });

  // Show 90s after page load if setup not done
  setTimeout(showReminder, 90000);
})();

/* ── S. Frases prontas por segmento ──────────────────────────── */
(function(){
  var SEGMENT_REPLIES = {
    loja:        ['Posso te mostrar as opções disponíveis e já verificar o estoque.','Qual é o tamanho ou modelo que você tem em mente?','Se quiser, finalizo o pedido aqui pelo WhatsApp mesmo.'],
    restaurante: ['Olha o cardápio completo — me diz o que te interessou!','Qual é o endereço para eu calcular o prazo de entrega?','Posso fechar o pedido aqui ou prefere ligar para confirmar?'],
    clinica:     ['Qual especialidade ou procedimento você está buscando?','Tem convênio? Me diz qual para eu verificar a cobertura.','Posso te encaminhar para o agendamento — quando você prefere?'],
    salao:       ['Qual serviço você quer agendar? Corte, escova, coloração?','Você tem preferência de horário ou profissional?','Vou verificar a agenda e já te confirmo a disponibilidade.'],
    imobiliaria: ['Você está buscando imóvel para comprar ou alugar?','Qual faixa de valor e região você tem em mente?','Posso agendar uma visita — qual dia funciona melhor para você?'],
    cursos:      ['Posso te falar mais sobre o conteúdo e o que você vai aprender.','O curso tem garantia de 7 dias — você pode testar sem risco.','Quer o link direto para a página do curso ou prefere tirar dúvidas primeiro?'],
    autopecas:   ['Me diz a marca, modelo e ano do carro para eu verificar a peça.','Temos entrega ou você pode retirar na loja — qual prefere?','Posso passar o orçamento aqui pelo WhatsApp agora.'],
    academia:    ['Quer conhecer os planos disponíveis? Tenho opções a partir de R$89/mês.','Você prefere vir fazer uma aula experimental antes de assinar?','Posso te enviar a programação das aulas da semana.'],
    outros:      ['Como posso te ajudar hoje?','Me conta um pouco mais sobre o que você precisa.','Posso conectar você com nossa equipe para mais detalhes.']
  };

  var pill = document.getElementById('bpActiveSegmentPill');
  if(!pill) return;

  var lastSeg = '';
  var mo = new MutationObserver(function(){
    var segId = pill.getAttribute('data-seg-id');
    if(!segId || segId === lastSeg) return;
    lastSeg = segId;
    var replies = SEGMENT_REPLIES[segId];
    if(!replies) return;
    // Only fill empty fields
    setTimeout(function(){
      [['quickReply1',0],['quickReply2',1],['quickReply3',2]].forEach(function(pair){
        var el = document.getElementById(pair[0]);
        if(el && !el.value.trim()) el.value = replies[pair[1]] || '';
      });
    }, 200);
  });
  mo.observe(pill, {attributes:true, attributeFilter:['data-seg-id']});
})();

/* ── A. Auto-save em background ──────────────────────────────── */
(function(){
  var timer = null;
  var FIELDS = ['opNotes','quickReply1','quickReply2','quickReply3','specialHours'];
  var indicator = null;

  function showSaved(){
    if(!indicator){
      indicator = document.createElement('span');
      indicator.style.cssText = 'position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);background:#111e13;border:1px solid rgba(0,230,118,.3);color:rgba(0,230,118,.85);padding:.4rem 1rem;border-radius:8px;font-size:.82rem;font-weight:600;z-index:9999;opacity:0;transition:opacity .25s;pointer-events:none';
      indicator.textContent = '✓ Salvo automaticamente';
      document.body.appendChild(indicator);
    }
    indicator.style.opacity = '1';
    clearTimeout(indicator._t);
    indicator._t = setTimeout(function(){ indicator.style.opacity='0'; }, 2200);
  }

  function tryAutoSave(){
    // Only auto-save if the button exists and has changed content
    var btn = document.getElementById('saveWorkspaceBaseBtn');
    if(!btn || btn.disabled) return;
    btn.click();
    setTimeout(showSaved, 600);
  }

  function scheduleAutoSave(){
    clearTimeout(timer);
    timer = setTimeout(tryAutoSave, 1400);
  }

  document.addEventListener('DOMContentLoaded', function(){
    FIELDS.forEach(function(id){
      var el = document.getElementById(id);
      if(!el) return;
      el.addEventListener('blur', scheduleAutoSave);
    });
  });

  // Also hook into tone-btn clicks
  document.addEventListener('click', function(e){
    if(e.target && e.target.classList.contains('tone-btn')){
      clearTimeout(timer);
      timer = setTimeout(tryAutoSave, 1800);
    }
  });
})();

/* ── B. Checklist de ativação visual ─────────────────────────── */
(function(){
  function refreshActivationBar(){
    var bar   = document.getElementById('activationBar');
    if(!bar) return;

    var s1 = document.getElementById('actStep1');
    var s2 = document.getElementById('actStep2');
    var s3 = document.getElementById('actStep3');
    var fill  = document.getElementById('actProgressFill');
    var label = document.getElementById('actProgressLabel');

    // Step 1: phone saved
    var hasPhone = typeof state !== 'undefined' && state && (state.waNumber || state.channelConnected);
    // Step 2: operation saved
    var hasOp = typeof state !== 'undefined' && state && state.workspace &&
      ((state.workspace.notes||'').trim() || (state.workspace.quickReplies&&state.workspace.quickReplies[0]||'').trim());
    // Step 3: test passed
    var hasTested = typeof state !== 'undefined' && state && state.channelConnected;

    var done = [hasPhone, hasOp, hasTested].filter(Boolean).length;

    if(s1) s1.classList.toggle('done', !!hasPhone);
    if(s2) s2.classList.toggle('done', !!hasOp);
    if(s3) s3.classList.toggle('done', !!hasTested);
    if(fill)  fill.style.width = Math.round((done/3)*100) + '%';
    if(label) label.textContent = done + ' / 3';

    // Show bar only when app is visible
    var wrap = document.getElementById('appWrap');
    bar.style.display = (wrap && !wrap.classList.contains('hidden')) ? 'flex' : 'none';
  }

  // Refresh every 3s after app loads
  setTimeout(function(){
    refreshActivationBar();
    setInterval(refreshActivationBar, 3000);
  }, 2000);
})();

/* ── C. Preview da primeira mensagem do bot ──────────────────── */
(function(){
  var COMPANY_PLACEHOLDER = 'sua empresa';

  function buildPreview(instruction, company){
    company = (company||'').trim() || COMPANY_PLACEHOLDER;
    if(!instruction || instruction.length < 10) return '';
    // Detect tone
    var lower = instruction.toLowerCase();
    var greeting, closing;
    if(lower.includes('formal') || lower.includes('profissional')){
      greeting = 'Olá! Bem-vindo ao atendimento da ' + company + '. Como posso ajudá-lo hoje?';
      closing  = 'Estou à disposição para qualquer esclarecimento.';
    } else if(lower.includes('descontra') || lower.includes('amig') || lower.includes('simpl')){
      greeting = 'Oi! 👋 Seja bem-vindo à ' + company + '! Como posso te ajudar?';
      closing  = 'Pode falar — estou aqui!';
    } else {
      greeting = 'Olá! Sou o assistente da ' + company + '. Em que posso ajudar?';
      closing  = 'Fique à vontade para perguntar.';
    }
    return greeting + ' ' + closing;
  }

  function refreshPreview(){
    var ta    = document.getElementById('opNotes');
    var wrap  = document.getElementById('botPreviewWrap');
    var bubble = document.getElementById('botPreviewBubble');
    if(!ta || !wrap || !bubble) return;
    var text = (ta.value||'').trim();
    var company = typeof state !== 'undefined' && state ? (state.company||state.businessName||'') : '';
    var preview = buildPreview(text, company);
    if(preview){
      bubble.textContent = preview;
      wrap.style.display = '';
    } else {
      wrap.style.display = 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    var ta = document.getElementById('opNotes');
    if(ta){
      ta.addEventListener('input', refreshPreview);
      ta.addEventListener('blur',  refreshPreview);
    }
    setTimeout(refreshPreview, 1500);
  });

  // Also refresh after tone button click
  document.addEventListener('click', function(e){
    if(e.target && e.target.classList.contains('tone-btn')){
      setTimeout(refreshPreview, 50);
    }
  });
})();

/* ── 0. Tooltips de contexto ─────────────────────────────────── */
(function(){
  // Inject tooltip popups into .tip-btn elements
  document.querySelectorAll('.tip-btn[data-tip]').forEach(function(btn){
    var popup = document.createElement('span');
    popup.className = 'tip-popup';
    popup.setAttribute('role','tooltip');
    popup.textContent = btn.getAttribute('data-tip');
    btn.style.position = 'relative';
    btn.appendChild(popup);
    // Also toggle on click for mobile
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      popup.style.opacity = popup.style.opacity === '1' ? '0' : '1';
    });
    document.addEventListener('click', function(){ popup.style.opacity='0'; });
  });
})();

/* ── 0b. Horário — preset buttons + sugestão por segmento ────── */
(function(){
  // Preset click → fill field
  document.querySelectorAll('.hours-preset').forEach(function(btn){
    btn.addEventListener('click', function(){
      var el = document.getElementById('specialHours');
      if(el) el.value = btn.getAttribute('data-hours');
    });
  });

  // Segment → suggest hours when specialHours is empty
  var SEGMENT_HOURS = {
    loja:        'Seg–Sex 9h–18h · Sáb 9h–14h',
    restaurante: 'Seg–Dom 11h–23h',
    clinica:     'Seg–Sex 8h–18h · Sáb 8h–13h',
    salao:       'Ter–Sáb 9h–19h',
    imobiliaria: 'Seg–Sex 9h–18h · Sáb 9h–13h',
    cursos:      '24h — dúvidas respondidas automaticamente',
    autopecas:   'Seg–Sex 8h–18h · Sáb 8h–12h',
    academia:    'Seg–Sex 6h–22h · Sáb 8h–14h',
    outros:      'Seg–Sex 9h–18h'
  };

  // Observe segment selection via MutationObserver on bpActiveSegmentPill
  var pill = document.getElementById('bpActiveSegmentPill');
  if(pill){
    var mo = new MutationObserver(function(){
      var segId = pill.getAttribute('data-seg-id') || (pill.textContent||'').toLowerCase();
      var suggested = SEGMENT_HOURS[segId];
      var hours = document.getElementById('specialHours');
      if(suggested && hours && !hours.value.trim()){
        hours.value = suggested;
        hours.style.borderColor = 'rgba(0,230,118,.45)';
        setTimeout(function(){ hours.style.borderColor=''; }, 2000);
      }
    });
    mo.observe(pill, {childList:true, attributes:true, subtree:true});
  }
})();

/* ── 0c. Badge de número no teste guiado ─────────────────────── */
(function(){
  function refreshSelfTestBadge(){
    var badge = document.getElementById('selfTestNumberBadge');
    if(!badge) return;
    // Access global state object populated by app.js
    var num = (typeof state !== 'undefined' && state && state.waNumber) ? state.waNumber : '';
    if(!num){
      var inp = document.getElementById('channelNumber');
      num = inp ? inp.value.trim() : '';
    }
    if(num){
      badge.textContent = '📱 ' + num;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // Poll lightly after modal opens
  var btn = document.getElementById('runChannelSelfTestBtn');
  if(btn) btn.addEventListener('mouseenter', refreshSelfTestBadge);
  // Also refresh when channel overlay opens
  var openModal = document.getElementById('channelBtn') || document.getElementById('qs3ActionBtn');
  if(openModal) openModal.addEventListener('click', function(){ setTimeout(refreshSelfTestBadge, 300); });
  setTimeout(refreshSelfTestBadge, 1500);
})();

/* ── 1b. Métrica de valor + share + alerta de plano ─────────── */
(function(){
  var MINS_PER_CONV = 4; // avg minutes saved per conversation handled by bot

  function getConvCount(){
    // Try global state first, then DOM
    if(typeof state !== 'undefined' && state && state.convCount) return +state.convCount || 0;
    var el = document.getElementById('statConv');
    if(el){ var n = parseInt((el.textContent||'').replace(/\D/g,''),10); if(!isNaN(n)) return n; }
    return 0;
  }

  function getConvLimit(){
    if(typeof state !== 'undefined' && state && state.convLimit) return +state.convLimit || 0;
    var el = document.getElementById('statLimit');
    if(el){ var n = parseInt((el.textContent||'').replace(/\D/g,''),10); if(!isNaN(n)) return n; }
    return 0;
  }

  function getWaNumber(){
    if(typeof state !== 'undefined' && state && state.waNumber) return state.waNumber;
    var el = document.getElementById('waNumber');
    return el ? (el.textContent||'').trim() : '';
  }

  function buildShareLink(raw){
    // strip non-digits then build wa.me link
    var digits = (raw||'').replace(/\D/g,'');
    if(!digits || digits.length < 10) return null;
    // if already has country code (55) keep, else prepend 55
    if(!digits.startsWith('55') && digits.length <= 11) digits = '55' + digits;
    return 'https://wa.me/' + digits;
  }

  function refreshValueBanner(){
    var conv   = getConvCount();
    var limit  = getConvLimit();
    var banner = document.getElementById('valueSavingsBanner');
    var hoursEl= document.getElementById('savingsHours');
    var shareA = document.getElementById('shareBotWaLink');

    // Value metric: only show when there are real conversations
    if(banner && conv > 0){
      var mins  = conv * MINS_PER_CONV;
      var hours = (mins / 60);
      var label = hours < 1 ? Math.round(mins) + ' min' : '~' + (Number.isInteger(hours) ? hours : hours.toFixed(1)) + 'h';
      if(hoursEl) hoursEl.textContent = label;
      banner.style.display = 'flex';
    } else if(banner){
      banner.style.display = 'none';
    }

    // Share link
    if(shareA){
      var num  = getWaNumber();
      var link = buildShareLink(num);
      if(link){ shareA.href = link; shareA.style.display = ''; }
      else { shareA.style.display = 'none'; }
    }

    // Plan limit alert: show when >80% of limit
    var alertEl  = document.getElementById('planLimitAlert');
    var pctEl    = document.getElementById('planLimitPct');
    var dismissed= sessionStorage.getItem('mb_limit_dismissed');
    if(alertEl && !dismissed){
      var pct = limit > 0 ? Math.round((conv / limit) * 100) : 0;
      if(pct >= 80){
        if(pctEl) pctEl.textContent = pct + '%';
        alertEl.style.display = 'flex';
      } else {
        alertEl.style.display = 'none';
      }
    }
  }

  // Dismiss plan limit alert for this session
  var dismissBtn = document.getElementById('planLimitDismiss');
  if(dismissBtn) dismissBtn.addEventListener('click', function(){
    var el = document.getElementById('planLimitAlert');
    if(el) el.style.display = 'none';
    sessionStorage.setItem('mb_limit_dismissed', '1');
  });

  // Run after app.js has time to populate state
  setTimeout(refreshValueBanner, 1800);
  // Re-run whenever stats DOM updates (app.js writes to statConv)
  var statEl = document.getElementById('statConv');
  if(statEl && window.MutationObserver){
    new MutationObserver(refreshValueBanner).observe(statEl, {childList:true, characterData:true, subtree:true});
  }
})();

/* ── 2. Seletor de tom do bot ────────────────────────────────── */
(function(){
  var toneMap = {
    formal:       'Atenda de forma profissional e respeitosa, usando linguagem formal. Evite gírias. Priorize clareza e objetividade.',
    neutro:       'Atenda de forma clara e educada, sem ser excessivamente formal nem muito informal. Seja direto e prestativo.',
    descontraido: 'Atenda de forma amigável e próxima, como uma conversa natural. Pode usar linguagem simples e descontraída, sem exageros.'
  };
  var activeStyle = 'background:rgba(0,230,118,.12);border-color:rgba(0,230,118,.5);color:var(--green)';
  var inactiveStyle = 'background:rgba(234,242,235,.04);border-color:var(--border);color:var(--muted)';

  document.querySelectorAll('.tone-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.tone-btn').forEach(function(b){
        b.setAttribute('style', b.getAttribute('style').replace(/background:[^;]+;border-color:[^;]+;color:[^;]+/, '') + inactiveStyle.replace('background:','background:').split(';').map(function(p){ return p.trim(); }).join(';'));
      });
      // Mark active
      btn.style.background = 'rgba(0,230,118,.12)';
      btn.style.borderColor = 'rgba(0,230,118,.5)';
      btn.style.color = 'var(--green)';

      var ta = document.getElementById('opNotes');
      if(ta && !ta.value.trim()){
        ta.value = toneMap[btn.dataset.tone] || '';
      } else if(ta){
        // Prepend tone prefix without overwriting custom text
        var prefix = toneMap[btn.dataset.tone] || '';
        if(!ta.value.startsWith(prefix)){
          ta.value = prefix + (ta.value ? ' ' + ta.value : '');
        }
      }
    });
  });
})();
