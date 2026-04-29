(async function(){
  'use strict';
  var API = (window.__mbConfig||{}).API_BASE_URL||'https://api.mercabot.com.br';
  var SUPABASE_URL = (window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_KEY = (window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';

  var $ = function(id){ return document.getElementById(id); };
  var content = $('content'); var statusEl = $('status'); var foot = $('foot');

  function setStatus(msg, isErr){
    statusEl.textContent = msg || '';
    statusEl.style.color = isErr ? '#fca5a5' : '';
  }

  function escHtml(s){
    return String(s||'').replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function fmtNum(n){ return Number(n||0).toLocaleString('pt-BR'); }
  function fmtBrl(n){
    var v = Math.round(Number(n||0));
    if (v >= 1000000) return 'R$ ' + (v/1000000).toFixed(1).replace('.', ',') + 'M';
    if (v >= 10000)   return 'R$ ' + (v/1000).toFixed(1).replace('.', ',') + 'k';
    return 'R$ ' + v.toLocaleString('pt-BR');
  }
  function fmtPct(n){ return n == null ? '—' : (n+'%'); }

  function relativeTime(iso){
    if (!iso) return '';
    var diffMs = Date.now() - new Date(iso).getTime();
    var min = Math.round(diffMs / 60000);
    if (min < 1)    return 'agora';
    if (min < 60)   return 'há ' + min + ' min';
    if (min < 1440) return 'há ' + Math.round(min/60) + 'h';
    var d = Math.round(min/1440);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }

  function greetForHour(){
    var h = new Date().getHours();
    if (h < 5)  return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Sparkline SVG generator (sem libs externas)
  function sparkline(data, width, height){
    if (!data || !data.length) return '<svg class="spark" viewBox="0 0 100 30"></svg>';
    width = width || 380; height = height || 90;
    var pad = 4;
    var w = width - pad*2, h = height - pad*2;
    var max = Math.max.apply(null, data.map(function(d){ return d.count || 0; }));
    var min = 0;
    if (max === 0) max = 1;
    var step = w / Math.max(1, data.length - 1);
    var pts = data.map(function(d, i){
      var x = pad + i * step;
      var y = pad + h - ((d.count - min) / (max - min)) * h;
      return [x, y];
    });
    var dPath = pts.map(function(p, i){ return (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var dArea = dPath + ' L' + pts[pts.length-1][0].toFixed(1) + ',' + (pad + h) + ' L' + pts[0][0].toFixed(1) + ',' + (pad + h) + ' Z';
    var lastX = pts[pts.length-1][0], lastY = pts[pts.length-1][1];
    return '<svg class="spark" viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none">'
      + '<defs><linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#00e676" stop-opacity=".3"/>'
      + '<stop offset="100%" stop-color="#00e676" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + '<path d="'+dArea+'" fill="url(#sparkGrad)" stroke="none"/>'
      + '<path d="'+dPath+'" fill="none" stroke="#00e676" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="3.5" fill="#00e676"/>'
      + '<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="6.5" fill="#00e676" fill-opacity=".25"/>'
      + '</svg>';
  }

  function healthRing(score, color){
    var R = 50, C = 2 * Math.PI * R;
    var dash = (score / 100) * C;
    return '<svg viewBox="0 0 120 120">'
      + '<circle class="bg" cx="60" cy="60" r="'+R+'"/>'
      + '<circle class="fg" cx="60" cy="60" r="'+R+'" stroke="'+color+'" stroke-dasharray="'+dash.toFixed(1)+' '+(C - dash).toFixed(1)+'"/>'
      + '</svg>';
  }

  function healthCopy(score){
    if (score >= 85) return ['Negócio saudável.', 'Indicadores no verde — só seguir.'];
    if (score >= 65) return ['Bom, com pontos de atenção.', 'Olhe os fatores em amarelo abaixo.'];
    if (score >= 40) return ['Atenção necessária.', 'Mais de um fator pedindo ação imediata.'];
    return ['Sangria ativa.', 'Vários fatores críticos. Priorize as ações abaixo.'];
  }

  function authFetch(path, opts){
    return supabaseClientReady().then(function(_jwt){
      return fetch(API + path, Object.assign({
        headers: Object.assign({ 'Authorization': 'Bearer ' + _jwt }, (opts||{}).headers || {})
      }, opts || {}));
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){
        return { ok: r.ok, status: r.status, body: b };
      });
    });
  }

  // ── Auth handshake ─────────────────────────────────────────────
  var sb;
  async function supabaseClientReady(){
    if (!sb) throw new Error('client_not_ready');
    var sr = await sb.auth.getSession();
    if (!sr || !sr.data || !sr.data.session) throw new Error('no_session');
    return sr.data.session.access_token;
  }

  function showError(html){
    content.innerHTML = '<div class="err">' + html + '</div>';
    setStatus('');
  }

  // ── Pre-check: descarta token expirado antes do getSession travar ──
  try {
    var tokenKey = 'sb-rurnemgzamnfjvmlbdug-auth-token';
    var raw = localStorage.getItem(tokenKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      var expSec = Number(parsed && parsed.expires_at || 0);
      if (expSec && (Date.now() / 1000 - expSec) > 86400) {
        localStorage.removeItem(tokenKey);
        showError('Sua sessão expirou. <a href="/acesso/?next=/admin/">Faça login</a> novamente.');
        return;
      }
    }
  } catch (_) {}

  // ── Bootstrap ─────────────────────────────────────────────
  sb = await window.__mbAuth.waitForSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:true}});
  if (!sb) { showError('Falha ao carregar Supabase.'); return; }

  // Race: getSession com timeout de 4s — se travar, limpa token e redirect.
  var sr;
  try {
    sr = await Promise.race([
      sb.auth.getSession(),
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('getSession timeout')); }, 4000); })
    ]);
  } catch (err) {
    try { localStorage.removeItem('sb-rurnemgzamnfjvmlbdug-auth-token'); } catch(_){}
    showError('Sessão inválida ou expirada. <a href="/acesso/?next=/admin/">Faça login</a> novamente.');
    return;
  }
  if (!sr || !sr.data || !sr.data.session) {
    showError('Você não está logado. <a href="/acesso/?next=/admin/">Faça login</a> com o e-mail admin.');
    return;
  }

  var userEmail = sr.data.session.user && sr.data.session.user.email ? sr.data.session.user.email : '';
  var firstName = userEmail.split('@')[0].split('.')[0];
  $('greetingName').textContent = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  // ── Render ─────────────────────────────────────────────
  function renderDashboard(d){
    var c = d.customers || {};
    var g = d.growth || {};
    var a = d.alerts || {};
    var mrr = d.mrr || {};
    var plans = d.plans || {};
    var health = d.health || { score: 0, factors: {} };
    var recent = d.recent_signups || [];
    var totalActivePaying = (c.active||0) + (c.trialing||0);
    var mrrConfirmed = (mrr.by_plan ? Object.values(mrr.by_plan).reduce(function(a,b){ return a+b; }, 0) : 0) - 0;

    // Greeting copy adaptado
    var hourGreet = greetForHour();
    var greetH = $('greetingHeadline');
    var greetCopy = $('greetingCopy');
    greetH.innerHTML = hourGreet + ', <em>' + escHtml(firstName.charAt(0).toUpperCase() + firstName.slice(1)) + '</em>.';
    var copyParts = [];
    if (g.signups_24h > 0) copyParts.push('<strong>' + g.signups_24h + '</strong> novo' + (g.signups_24h>1?'s':'') + ' sign-up' + (g.signups_24h>1?'s':'') + ' nas últimas 24 horas');
    else if (g.signups_7d > 0) copyParts.push('<strong>' + g.signups_7d + '</strong> sign-up' + (g.signups_7d>1?'s':'') + ' na última semana');
    if (a.past_due_count > 0) copyParts.push('<strong style="color:#fca5a5">' + a.past_due_count + '</strong> cliente' + (a.past_due_count>1?'s':'') + ' inadimplente' + (a.past_due_count>1?'s':''));
    if (a.hot_leads_count > 0) copyParts.push('<strong style="color:#fcd34d">' + a.hot_leads_count + '</strong> lead' + (a.hot_leads_count>1?'s':'') + ' quente' + (a.hot_leads_count>1?'s':'') + ' esfriou');
    greetCopy.innerHTML = copyParts.length
      ? copyParts.join(' · ') + '.'
      : 'Tudo calmo por aqui — bom momento pra prospectar.';

    var html = '';

    // ── HERO MRR + sparkline ─────────────
    var mrrColor = mrr.brl_estimated > 0 ? 'var(--green)' : 'var(--muted)';
    html += '<section class="hero fade-in">';
    html += '  <div class="hero-grid">';
    html += '    <div>';
    html += '      <div class="hero-label">MRR estimado</div>';
    html += '      <div class="hero-value">' + fmtBrl(mrr.brl_estimated) + '<span class="hero-value-small">/mês</span></div>';
    html += '      <div class="hero-foot">';
    html +=          '<strong>' + fmtNum(c.active) + '</strong> ativos · <strong>' + fmtNum(c.trialing) + '</strong> em trial · <strong>' + fmtNum(c.total) + '</strong> total na base';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="spark-wrap">';
    html += '      <span class="spark-label">Sign-ups · últimos 30 dias</span>';
    html +=        sparkline(g.daily_signups || []);
    html += '      <div style="font-size:.78rem;color:var(--muted)"><strong style="color:var(--green)">' + fmtNum(g.signups_30d) + '</strong> nos últimos 30d · <strong>' + fmtNum(g.signups_7d) + '</strong> em 7d</div>';
    html += '    </div>';
    html += '  </div>';
    html += '</section>';

    // ── HEALTH SCORE ─────────────
    var hcopy = healthCopy(health.score);
    var ringColor = health.score >= 85 ? '#00e676' : health.score >= 65 ? '#3b82f6' : health.score >= 40 ? '#f59e0b' : '#ef4444';
    html += '<section class="health fade-in">';
    html += '  <div class="health-ring">' + healthRing(health.score, ringColor)
            + '    <div class="health-ring-label"><div class="health-ring-num">' + Math.round(health.score) + '</div><div class="health-ring-cap">/ 100</div></div>'
            + '  </div>';
    html += '  <div class="health-info">';
    html += '    <h3>Health score · ' + escHtml(hcopy[0]) + '</h3>';
    html += '    <p>' + escHtml(hcopy[1]) + ' Composição: 30 pts pagamento + 25 pts churn + 25 pts ativação + 20 pts crescimento.</p>';
    html += '    <div class="health-factors">';
    var factorLabels = { payment:'Pagamentos', churn:'Churn', activations:'Ativação', growth:'Crescimento 7d' };
    Object.keys(factorLabels).forEach(function(k){
      var fv = (health.factors && health.factors[k]) || 'good';
      html += '<span class="factor ' + fv + '">' + escHtml(factorLabels[k]) + '</span>';
    });
    html += '    </div>';
    html += '  </div>';
    html += '</section>';

    // ── ALERTS BANNER (só se houver algo) ─────────────
    var totalAlerts = (a.past_due_count||0) + (a.at_risk_count||0) + (a.pending_payment_count||0) + (a.hot_leads_count||0);
    if (totalAlerts > 0) {
      var critical = a.past_due_count > 0;
      html += '<section class="alerts-banner ' + (critical ? 'critical' : '') + ' fade-in">';
      html += '  <div class="alerts-head"><span class="icon">' + (critical?'🚨':'⚠️') + '</span><h3>' + (critical ? 'Ações urgentes' : 'Atenção necessária') + '</h3></div>';
      html += '  <div class="alerts-grid">';
      if (a.past_due_count > 0) html += '<div class="alert-cell"><div class="alert-num">' + fmtNum(a.past_due_count) + '</div><div class="alert-cap">Past due — bot suspenso</div></div>';
      if (a.at_risk_count > 0) html += '<div class="alert-cell"><div class="alert-num">' + fmtNum(a.at_risk_count) + '</div><div class="alert-cap">At risk — cartão recusou</div></div>';
      if (a.pending_payment_count > 0) html += '<div class="alert-cell"><div class="alert-num">' + fmtNum(a.pending_payment_count) + '</div><div class="alert-cap">Boleto pendente</div></div>';
      if (a.hot_leads_count > 0) html += '<div class="alert-cell"><div class="alert-num">' + fmtNum(a.hot_leads_count) + '</div><div class="alert-cap">🔥 Leads quentes esfriaram</div></div>';
      html += '  </div>';
      html += '  <div style="margin-top:.95rem;font-size:.84rem;color:var(--muted)">Use o botão <strong style="color:var(--text)">Recovery</strong> no topo para disparar e-mails dos inadimplentes em 1 clique.</div>';
      html += '</section>';
    }

    // ── KPIs principais ─────────────
    html += '<div class="section-eyebrow">Indicadores</div>';
    html += '<div class="kpis">';
    html += '  <div class="kpi fade-in"><div class="kpi-label">📈 Sign-ups 24h / 7d / 30d</div><div class="kpi-value">' + fmtNum(g.signups_24h) + ' / ' + fmtNum(g.signups_7d) + ' / ' + fmtNum(g.signups_30d) + '</div><div class="kpi-foot">conversão 30d: <span class="' + (g.conversion_rate_pct >= 30 ? 'kpi-trend-up' : 'kpi-trend-down') + '">' + fmtPct(g.conversion_rate_pct) + '</span></div></div>';
    html += '  <div class="kpi fade-in"><div class="kpi-label">📉 Churn 30d</div><div class="kpi-value ' + (g.churn_rate_30d_pct > 5 ? '' : '') + '">' + fmtPct(g.churn_rate_30d_pct) + '</div><div class="kpi-foot">' + fmtNum(g.canceled_30d) + ' cancelaram</div></div>';
    html += '  <div class="kpi fade-in"><div class="kpi-label">💚 Clientes ativos</div><div class="kpi-value">' + fmtNum(c.active) + '</div><div class="kpi-foot">' + fmtNum(c.trialing) + ' em trial · vão pagar em breve</div></div>';
    html += '  <div class="kpi fade-in"><div class="kpi-label">🔥 Leads quentes</div><div class="kpi-value">' + fmtNum(a.hot_leads_count) + '</div><div class="kpi-foot">' + (a.hot_leads_count > 0 ? '<a href="/painel-cliente/app/?tab=conversas">retomar →</a>' : 'nenhum esfriou ainda') + '</div></div>';
    html += '</div>';

    // ── Plans + Recent activity ─────────────
    html += '<div class="section-eyebrow">Composição da base</div>';
    html += '<div class="split-grid">';
    var totalPaying = (plans.starter||0) + (plans.pro||0) + (plans.parceiro||0);
    var maxPlan = Math.max(plans.starter||0, plans.pro||0, plans.parceiro||0, 1);
    html += '  <div class="panel fade-in">';
    html += '    <h3>📦 Distribuição por plano</h3>';
    html += '    <p class="panel-sub">' + fmtNum(totalPaying) + ' clientes pagantes · MRR estimado por plano (active+trialing)</p>';
    html += '    <div class="bars">';
    [
      ['Starter', plans.starter||0, mrr.by_plan ? mrr.by_plan.starter : 0, 'starter'],
      ['Pro',     plans.pro||0,     mrr.by_plan ? mrr.by_plan.pro : 0, 'pro'],
      ['Parceiro', plans.parceiro||0, mrr.by_plan ? mrr.by_plan.parceiro : 0, 'parceiro'],
    ].forEach(function(p){
      var pct = ((p[1] / maxPlan) * 100).toFixed(0);
      html += '<div class="bar-row"><div class="bar-label">' + p[0] + '</div><div class="bar-track"><div class="bar-fill ' + p[3] + '" style="width:' + pct + '%"></div></div><div class="bar-num">' + fmtNum(p[1]) + ' · ' + fmtBrl(p[2]) + '</div></div>';
    });
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="panel fade-in">';
    html += '    <h3>🆕 Atividade recente</h3>';
    html += '    <p class="panel-sub">Últimos 10 sign-ups</p>';
    html += '    <div class="activity">';
    if (recent.length === 0) {
      html += '<div style="padding:1rem 0;color:var(--muted);font-size:.88rem">Nenhum sign-up registrado ainda.</div>';
    } else {
      recent.forEach(function(r){
        var planTag = r.plan_code ? '<span class="tag ' + escHtml(r.plan_code) + '">' + escHtml(r.plan_code) + '</span>' : '';
        var statusTag = r.status ? '<span class="tag status-' + escHtml(r.status) + '">' + escHtml(r.status) + '</span>' : '';
        html += '<div class="activity-row">'
              + '<div class="activity-name" title="' + escHtml(r.company_name) + '">' + escHtml(r.company_name) + '</div>'
              + '<div>' + planTag + ' ' + statusTag + '</div>'
              + '<div class="activity-meta">' + escHtml(relativeTime(r.created_at)) + '</div>'
              + '</div>';
      });
    }
    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    // ── Status detalhado (full breakdown) ─────────────
    html += '<div class="section-eyebrow">Status detalhado da base</div>';
    html += '<div class="status-grid">';
    [
      ['active', 'Active', 'var(--green)'],
      ['trialing', 'Trialing', '#93c5fd'],
      ['pending_payment', 'Pending payment', '#fcd34d'],
      ['at_risk', 'At risk', '#fcd34d'],
      ['past_due', 'Past due', '#fca5a5'],
      ['canceled', 'Canceled', '#fca5a5'],
      ['other', 'Outros', 'var(--whisper)'],
    ].forEach(function(row){
      html += '<div class="status-cell"><div class="status-cell-label">' + row[1] + '</div><div class="status-cell-num" style="color:' + row[2] + '">' + fmtNum(c[row[0]]||0) + '</div></div>';
    });
    html += '</div>';

    content.innerHTML = html;

    foot.innerHTML = 'Atualizado em ' + new Date(d.ts).toLocaleString('pt-BR') + ' · MercaBot Cockpit Admin';
  }

  async function loadKpis(){
    setStatus('Carregando…');
    try {
      var r = await authFetch('/admin/kpis');
      if (r.status === 403) { showError('Acesso restrito ao admin. Você está logado como ' + escHtml(userEmail) + ', mas não é o e-mail admin.'); return; }
      if (!r.ok) { showError('Falha ao carregar KPIs: ' + escHtml(r.body.error || ('HTTP '+r.status))); return; }
      renderDashboard(r.body);
      setStatus('Atualizado às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (err) {
      showError('Erro: ' + escHtml(String(err.message || err)));
    }
  }

  // Wire actions
  $('refreshBtn').addEventListener('click', loadKpis);

  $('diagBtn').addEventListener('click', async function(){
    setStatus('Carregando diagnostics…');
    try {
      var r = await authFetch('/admin/diagnostics');
      if (!r.ok) { alert('Falha: ' + (r.body.error||r.status)); setStatus(''); return; }
      console.log('[admin/diagnostics]', r.body);
      console.table(r.body.env);
      console.log('Stripe:', r.body.stripe);
      console.log('Resend:', r.body.resend);
      setStatus('Diagnostics no console (F12).');
    } catch (err) { setStatus('Erro', true); }
  });

  $('recoveryBtn').addEventListener('click', async function(){
    if (!confirm('Disparar recovery (modo dry-run, sem enviar e-mails de verdade)?')) return;
    setStatus('Calculando…');
    try {
      var jwt = await supabaseClientReady();
      var r = await fetch(API + '/admin/recovery-blast', {
        method:'POST',
        headers:{'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
        body: JSON.stringify({ dry: true })
      });
      var b = await r.json().catch(function(){ return {}; });
      if (!r.ok) { alert('Falha: ' + (b.error||r.status)); setStatus(''); return; }
      console.log('[recovery dry-run]', b);
      var lines = (b.results||[]).map(function(x){ return x.email + ' → ' + x.kind; }).join('\n');
      alert('Recovery dry-run\n\nElegíveis: ' + (b.totalEligible||0) + '\n\n' + (lines || '(nenhum)') + '\n\nDetalhes no console.');
      setStatus('');
    } catch (err) { setStatus('Erro', true); }
  });

  // Atalho: R refresca
  document.addEventListener('keydown', function(e){
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'r' || e.key === 'R') loadKpis();
  });

  loadKpis();
  // Auto-refresh a cada 5 min
  setInterval(loadKpis, 5 * 60 * 1000);
})();
