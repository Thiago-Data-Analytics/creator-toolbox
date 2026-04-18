
(function(){
  var picker = document.getElementById('wlColorPicker');
  var hex    = document.getElementById('wlColor');
  var preview = document.getElementById('wlLogoPreview');

  function isValidHex(v){ return /^#[0-9a-fA-F]{6}$/.test(v); }

  function applyColor(c){
    if(preview) preview.style.color = c;
    if(picker)  picker.value = c;
  }

  if(picker){
    picker.addEventListener('input', function(){
      hex.value = picker.value;
      applyColor(picker.value);
    });
  }
  if(hex){
    hex.addEventListener('input', function(){
      var v = hex.value.trim();
      if(isValidHex(v)) applyColor(v);
    });
  }

  function generateWhitelabelHTML(brand, color){
    var safeBrand = brand || 'Minha Marca';
    var safeColor = isValidHex(color) ? color : '#00e676';
    var html = '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>'+safeBrand+' — Atendimento com IA</title>\n<style>\n:root{--brand:'+safeColor+';--bg:#080c09;--text:#eaf2eb;--muted:rgba(234,242,235,.56);--border:rgba(234,242,235,.08)}\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\nbody{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at top left,rgba('+hexToRgb(safeColor)+',0.12),transparent 30%),var(--bg);color:var(--text);font-family:system-ui,sans-serif}\n.card{max-width:520px;width:100%;background:rgba(13,18,14,.96);border:1px solid var(--border);border-radius:24px;padding:40px 36px;text-align:center}\n.logo{font-size:1.5rem;font-weight:800;color:var(--brand);letter-spacing:-.04em;margin-bottom:24px}\n.badge{display:inline-flex;background:rgba('+hexToRgb(safeColor)+',0.1);border:1px solid rgba('+hexToRgb(safeColor)+',0.3);color:var(--brand);padding:6px 14px;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:20px}\nh1{font-size:clamp(1.5rem,3vw,2.2rem);font-weight:800;line-height:1.1;letter-spacing:-.04em;margin-bottom:14px}\np{color:var(--muted);font-size:1rem;line-height:1.7;margin-bottom:28px}\n.btn{display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;border-radius:12px;background:var(--brand);color:#080c09;font-weight:700;font-size:1rem;text-decoration:none;cursor:pointer}\n</style>\n</head>\n<body>\n<main class="card">\n  <div class="logo">'+safeBrand+'</div>\n  <div class="badge">✦ Atendimento com IA</div>\n  <h1>Seu cliente atendido 24h no WhatsApp</h1>\n  <p>Responda perguntas, envie cardápios, feche pedidos e colete leads — tudo no automático, com a identidade da '+safeBrand+'.</p>\n  <a href="#" class="btn">Começar agora →</a>\n</main>\n</body>\n</html>';
    return html;
  }

  function hexToRgb(hex){
    var r = parseInt(hex.slice(1,3),16);
    var g = parseInt(hex.slice(3,5),16);
    var b = parseInt(hex.slice(5,7),16);
    return r+','+g+','+b;
  }

  var downloadBtn = document.getElementById('downloadWhitelabelBtn');
  if(downloadBtn){
    downloadBtn.addEventListener('click', function(){
      var brand = (document.getElementById('wlBrand')||{}).value || 'Minha Marca';
      var color = (hex||{}).value || '#00e676';
      var content = generateWhitelabelHTML(brand.trim(), color.trim());
      var blob = new Blob([content], {type:'text/html'});
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url;
      a.download = (brand.trim().replace(/\s+/g,'-').toLowerCase() || 'whitelabel') + '-demo.html';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
    });
  }
})();



/* ── Wizard "Adicionar cliente" ─────────────────────────── */
(function(){
  var currentStep = 1;
  var totalSteps  = 3;

  function digitsOnly(v){ return (v||'').replace(/\D/g,''); }
  function formatBR(digits){
    if(!digits.startsWith('55')) digits = '55' + digits;
    var d = digits;
    var out = '+' + d.slice(0,2);
    if(d.length > 2) out += ' (' + d.slice(2,4);
    if(d.length > 4) out += ') ';
    if(d.length > 4 && d.length <= 10) out += d.slice(4);
    else if(d.length > 10) out += d.slice(4, d.length-4) + '-' + d.slice(-4);
    return out;
  }
  function validPhone(v){ var d=digitsOnly(v); return d.length>=12&&d.length<=13; }

  // Phone mask on newKey
  var keyInput = document.getElementById('newKey');
  var keyIcon  = document.getElementById('newKeyIcon');
  var keyHint  = document.getElementById('newKeyHint');
  if(keyInput){
    keyInput.addEventListener('input', function(){
      var raw = digitsOnly(keyInput.value);
      if(!raw){ keyInput.value=''; return; }
      keyInput.value = formatBR(raw);
      if(validPhone(keyInput.value)){
        keyIcon.textContent='✅'; keyIcon.style.opacity='1';
        keyInput.style.borderColor='rgba(0,230,118,.55)';
        if(keyHint){ keyHint.textContent='Número válido.'; keyHint.style.color='rgba(0,230,118,.8)'; }
      } else {
        keyIcon.style.opacity='0'; keyInput.style.borderColor='';
        if(keyHint){ keyHint.textContent='Digite com DDD — ex: 11 99999-9999.'; keyHint.style.color=''; }
      }
    });
  }

  // Plan card selection
  document.querySelectorAll('.plan-opt-card').forEach(function(card){
    card.addEventListener('click', function(){
      document.querySelectorAll('.plan-opt-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      var radio = card.querySelector('input[type=radio]');
      if(radio) radio.checked = true;
      var sel = document.getElementById('newPlan');
      if(sel) sel.value = card.dataset.val || '';
    });
  });

  function showStep(n){
    for(var i=1;i<=totalSteps;i++){
      var panel = document.getElementById('wz-panel-'+i);
      var dot   = document.getElementById('wz-dot-'+i);
      var line  = document.getElementById('wz-line-'+i);
      if(panel) panel.style.display = (i===n) ? '' : 'none';
      if(dot){
        dot.classList.toggle('active', i===n);
        dot.classList.toggle('done', i<n);
      }
      if(line && i<totalSteps) line.classList.toggle('done', i<n);
    }
    var back   = document.getElementById('wzBackBtn');
    var next   = document.getElementById('wzNextBtn');
    var finish = document.getElementById('addClientBtn');
    if(back)   back.style.display   = n>1 ? '' : 'none';
    if(next)   next.style.display   = n<totalSteps ? '' : 'none';
    if(finish) finish.style.display = n===totalSteps ? '' : 'none';
    if(n===totalSteps) buildSummary();
    currentStep = n;
  }

  function buildSummary(){
    var name    = (document.getElementById('newName')||{}).value||'—';
    var email   = (document.getElementById('newEmail')||{}).value||'—';
    var seg     = (document.getElementById('newSegment')||{}).value||'—';
    var phone   = (document.getElementById('newKey')||{}).value||'—';
    var plan    = (document.getElementById('newPlan')||{}).value||'—';
    var box     = document.getElementById('wzSummary');
    if(!box) return;
    box.innerHTML =
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:.3rem 1rem">' +
      '<span style="color:var(--muted)">Empresa</span><strong>'+name+'</strong>' +
      '<span style="color:var(--muted)">E-mail</span><span>'+email+'</span>' +
      '<span style="color:var(--muted)">Segmento</span><span>'+(seg||'não informado')+'</span>' +
      '<span style="color:var(--muted)">WhatsApp</span><span>'+phone+'</span>' +
      '<span style="color:var(--muted)">Plano</span><strong style="color:var(--green)">'+plan+'</strong>' +
      '</div>';
  }

  function validateStep(n){
    if(n===1){
      var name  = ((document.getElementById('newName')||{}).value||'').trim();
      var email = ((document.getElementById('newEmail')||{}).value||'').trim();
      if(!name){ alert('Informe o nome da empresa.'); return false; }
      if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ alert('Informe um e-mail válido.'); return false; }
    }
    if(n===2){
      var phone = ((document.getElementById('newKey')||{}).value||'').trim();
      if(!validPhone(phone)){ alert('Informe o número de WhatsApp com DDD.'); return false; }
      var plan = ((document.getElementById('newPlan')||{}).value||'').trim();
      if(!plan){ alert('Selecione um plano para o cliente.'); return false; }
    }
    return true;
  }

  var nextBtn = document.getElementById('wzNextBtn');
  var backBtn = document.getElementById('wzBackBtn');
  if(nextBtn) nextBtn.addEventListener('click', function(){
    if(validateStep(currentStep)) showStep(currentStep+1);
  });
  if(backBtn) backBtn.addEventListener('click', function(){
    showStep(currentStep-1);
  });

  // Reset wizard when modal opens
  var openBtn = document.getElementById('clientsAddClientBtn');
  if(openBtn) openBtn.addEventListener('click', function(){
    showStep(1);
    // clear fields
    ['newName','newEmail','newSegment','newKey'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.value='';
    });
    document.querySelectorAll('.plan-opt-card').forEach(function(c){ c.classList.remove('selected'); });
    var ps = document.getElementById('newPlan'); if(ps) ps.value='';
    if(keyIcon){ keyIcon.style.opacity='0'; }
    if(keyInput){ keyInput.style.borderColor=''; }
  });
})();

/* ── Guia DNS inline — accordion + tabs ───────────────────── */
(function(){
  var toggle  = document.getElementById('dnsGuideToggle');
  var content = document.getElementById('dnsGuideContent');
  var arrow   = document.getElementById('dnsGuideArrow');
  if(!toggle || !content) return;

  toggle.addEventListener('click', function(){
    var open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'block';
    arrow.style.transform = open ? '' : 'rotate(90deg)';
  });

  document.querySelectorAll('.dns-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      // Reset all tabs
      document.querySelectorAll('.dns-tab').forEach(function(t){
        t.style.background = 'rgba(234,242,235,.04)';
        t.style.borderColor = 'var(--border)';
        t.style.color = 'var(--muted)';
      });
      // Activate clicked
      tab.style.background  = 'rgba(0,230,118,.1)';
      tab.style.borderColor = 'rgba(0,230,118,.25)';
      tab.style.color       = 'var(--green)';
      // Show correct panel
      document.querySelectorAll('.dns-panel').forEach(function(p){ p.style.display = 'none'; });
      var panel = document.getElementById('dns-' + tab.dataset.tab);
      if(panel) panel.style.display = 'block';
    });
  });
})();
