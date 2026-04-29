(async function(){
  var API = (window.__mbConfig||{}).API_BASE_URL||'https://api.mercabot.com.br';
  var SUPABASE_URL = (window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_KEY = (window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
  var content = document.getElementById('content');
  var statusEl = document.getElementById('status');

  function setStatus(msg, isErr){
    statusEl.textContent = msg || '';
    statusEl.style.color = isErr ? '#fca5a5' : 'var(--muted)';
  }

  function showError(msg){
    content.innerHTML = '<div class="err">'+msg+'</div>';
  }

  // Auth: aguarda Supabase, valida sessão
  var sb = await window.__mbAuth.waitForSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:true}});
  if(!sb){ showError('Não foi possível carregar Supabase.'); return; }

  var sr = await sb.auth.getSession();
  if(!sr || !sr.data || !sr.data.session){
    showError('Você não está logado. <a href="/acesso/?next=/admin/">Faça login</a> com o e-mail admin.');
    return;
  }
  var jwt = sr.data.session.access_token;

  async function authFetch(path){
    var r = await fetch(API + path, { headers:{'Authorization':'Bearer '+jwt}});
    var b = await r.json().catch(function(){ return {}; });
    return { ok: r.ok, status: r.status, body: b };
  }

  function fmtNum(n){ return Number(n||0).toLocaleString('pt-BR'); }
  function fmtBrl(n){ return 'R$ ' + fmtNum(Math.round(Number(n||0))); }
  function fmtPct(n){ return n == null ? '—' : (n+'%'); }

  function renderKpis(d){
    var c = d.customers || {};
    var g = d.growth || {};
    var a = d.alerts || {};
    var mrr = (d.mrr && d.mrr.brl_estimated) || 0;
    var html = '';

    html += '<div class="grid">';
    html += '  <div class="card green"><div class="card-label">MRR estimado</div><div class="card-value">'+fmtBrl(mrr)+'</div><div class="card-foot">active + trialing — quando trial converter</div></div>';
    html += '  <div class="card"><div class="card-label">Clientes ativos</div><div class="card-value">'+fmtNum(c.active)+'</div><div class="card-foot">'+fmtNum(c.trialing)+' em trial · '+fmtNum(c.total)+' total</div></div>';
    html += '  <div class="card"><div class="card-label">Sign-ups (7d / 30d)</div><div class="card-value">'+fmtNum(g.signups_7d)+' <span style="font-size:1.1rem;color:var(--muted)">/ '+fmtNum(g.signups_30d)+'</span></div><div class="card-foot">conversão 30d: '+fmtPct(g.conversion_rate_pct)+'</div></div>';
    html += '  <div class="card '+(g.churn_rate_30d_pct>5?'red':'')+'"><div class="card-label">Churn (30d)</div><div class="card-value">'+fmtPct(g.churn_rate_30d_pct)+'</div><div class="card-foot">'+fmtNum(g.canceled_30d)+' cancelamentos</div></div>';
    html += '</div>';

    if(a.past_due_count + a.at_risk_count + a.pending_payment_count > 0){
      html += '<div class="section-title">⚠️ Alertas de pagamento</div>';
      html += '<div class="grid">';
      if(a.past_due_count > 0) html += '<div class="card red"><div class="card-label">Past due</div><div class="card-value">'+fmtNum(a.past_due_count)+'</div><div class="card-foot">bot suspenso</div></div>';
      if(a.at_risk_count > 0) html += '<div class="card amber"><div class="card-label">At risk</div><div class="card-value">'+fmtNum(a.at_risk_count)+'</div><div class="card-foot">cartão recusou</div></div>';
      if(a.pending_payment_count > 0) html += '<div class="card amber"><div class="card-label">Boleto pendente</div><div class="card-value">'+fmtNum(a.pending_payment_count)+'</div><div class="card-foot">aguardando compensação</div></div>';
      html += '</div>';
    }

    html += '<div class="section-title">Distribuição por plano</div>';
    html += '<table><thead><tr><th>Plano</th><th>Total</th><th>% da base</th></tr></thead><tbody>';
    var plans = d.plans || {};
    var totalPlan = (plans.starter||0) + (plans.pro||0) + (plans.parceiro||0) + (plans.other||0);
    ['starter','pro','parceiro','other'].forEach(function(p){
      var n = plans[p]||0;
      var pct = totalPlan > 0 ? Math.round((n/totalPlan)*100) : 0;
      html += '<tr><td>'+(p==='other'?'Outros':p.charAt(0).toUpperCase()+p.slice(1))+'</td><td>'+fmtNum(n)+'</td><td class="muted">'+pct+'%</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div class="section-title">Status detalhado</div>';
    html += '<table><thead><tr><th>Status</th><th>Total</th></tr></thead><tbody>';
    [
      ['active', 'Active', 'ok'],
      ['trialing', 'Trialing', ''],
      ['pending_payment', 'Pending payment', 'amber-text'],
      ['at_risk', 'At risk', 'amber-text'],
      ['past_due', 'Past due', 'bad'],
      ['canceled', 'Canceled', 'bad'],
      ['other', 'Outros', 'muted'],
    ].forEach(function(row){
      html += '<tr><td class="'+row[2]+'">'+row[1]+'</td><td>'+fmtNum(c[row[0]]||0)+'</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div style="margin-top:2rem;color:var(--faint);font-size:.78rem">Atualizado em '+new Date(d.ts).toLocaleString('pt-BR')+'</div>';

    content.innerHTML = html;
  }

  async function loadKpis(){
    setStatus('Carregando KPIs…');
    var r = await authFetch('/admin/kpis');
    if(r.status === 403){ showError('Acesso restrito ao admin (e-mail '+(r.body.error||'').toLowerCase()+').'); setStatus(''); return; }
    if(!r.ok){ showError('Falha ao carregar KPIs: '+(r.body.error||r.status)); setStatus(''); return; }
    renderKpis(r.body);
    setStatus('Atualizado às '+new Date().toLocaleTimeString('pt-BR'));
  }

  document.getElementById('refreshBtn').addEventListener('click', loadKpis);

  document.getElementById('diagBtn').addEventListener('click', async function(){
    setStatus('Carregando diagnostics…');
    var r = await authFetch('/admin/diagnostics');
    if(!r.ok){ alert('Falha: '+(r.body.error||r.status)); setStatus(''); return; }
    setStatus('Diagnostics no console (F12).');
    console.log('[admin/diagnostics]', r.body);
    console.table(r.body.env);
  });

  document.getElementById('recoveryBtn').addEventListener('click', async function(){
    if(!confirm('Disparar dry-run de recovery? (não envia e-mails, só lista)')) return;
    setStatus('Calculando…');
    var r = await fetch(API + '/admin/recovery-blast', {
      method:'POST', headers:{'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
      body: JSON.stringify({ dry: true })
    });
    var b = await r.json().catch(function(){ return {}; });
    if(!r.ok){ alert('Falha: '+(b.error||r.status)); setStatus(''); return; }
    console.log('[recovery dry-run]', b);
    var lines = (b.results||[]).map(function(x){ return x.email + ' → ' + x.kind; }).join('\n');
    alert('Elegíveis: '+(b.totalEligible||0)+'\n\n'+lines+'\n\nVer detalhes no console.');
    setStatus('');
  });

  loadKpis();
})();
