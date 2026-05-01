// MercaBot Cockpit Admin v3 — dados reais, zero simulação.
// Consome /admin/dashboard (endpoint único). Filtra contas de teste por padrão.
(async function () {
  'use strict';

  var API = (window.__mbConfig || {}).API_BASE_URL || 'https://api.mercabot.com.br';
  var SUPABASE_URL = (window.__mbConfig || {}).SUPABASE_URL || 'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_KEY = (window.__mbConfig || {}).SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';

  var $ = function (id) { return document.getElementById(id); };
  var content = $('content'), statusEl = $('status'), foot = $('foot');
  var includeTestEl = $('includeTestToggle');

  // ── Helpers ──────────────────────────────────────────────────────
  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.style.color = isErr ? '#fca5a5' : '';
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function fmtBrl(n) {
    var v = Number(n || 0);
    if (v >= 1000000) return 'R$ ' + (v / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (v >= 10000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) { return n == null ? '—' : (n + '%'); }
  function relTime(iso) {
    if (!iso) return '—';
    var diffMs = Date.now() - new Date(iso).getTime();
    var min = Math.round(diffMs / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + 'min';
    if (min < 1440) return 'há ' + Math.round(min / 60) + 'h';
    var d = Math.round(min / 1440);
    return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }
  function shortDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
  function greetForHour() {
    var h = new Date().getHours();
    if (h < 5) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Sparkline SVG
  function sparkline(data) {
    if (!data || !data.length) return '<svg class="spark" viewBox="0 0 380 90"></svg>';
    var width = 380, height = 90, pad = 4;
    var w = width - pad * 2, h = height - pad * 2;
    var max = Math.max.apply(null, data.map(function (d) { return d.count || 0; }));
    if (max === 0) max = 1;
    var step = w / Math.max(1, data.length - 1);
    var pts = data.map(function (d, i) {
      var x = pad + i * step;
      var y = pad + h - ((d.count - 0) / (max - 0)) * h;
      return [x, y];
    });
    var dPath = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var dArea = dPath + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (pad + h) + ' L' + pts[0][0].toFixed(1) + ',' + (pad + h) + ' Z';
    var lastX = pts[pts.length - 1][0], lastY = pts[pts.length - 1][1];
    return '<svg class="spark" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#00e676" stop-opacity=".3"/>'
      + '<stop offset="100%" stop-color="#00e676" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + '<path d="' + dArea + '" fill="url(#g)"/>'
      + '<path d="' + dPath + '" fill="none" stroke="#00e676" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3.5" fill="#00e676"/>'
      + '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="6.5" fill="#00e676" fill-opacity=".25"/>'
      + '</svg>';
  }

  // ── Auth ──────────────────────────────────────────────────────────
  var sb;

  function showError(html) {
    content.innerHTML = '<div class="err">' + html + '</div>';
    setStatus('');
  }

  // Pre-check token expiry
  try {
    var raw = localStorage.getItem('sb-rurnemgzamnfjvmlbdug-auth-token');
    if (raw) {
      var parsed = JSON.parse(raw);
      var expSec = Number(parsed && parsed.expires_at || 0);
      if (expSec && (Date.now() / 1000 - expSec) > 86400) {
        localStorage.removeItem('sb-rurnemgzamnfjvmlbdug-auth-token');
        showError('Sua sessão expirou. <a href="/acesso/?next=/admin/">Faça login</a>.');
        return;
      }
    }
  } catch (_) { }

  sb = await window.__mbAuth.waitForSupabaseClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true } });
  if (!sb) { showError('Falha ao carregar Supabase.'); return; }

  var sr;
  try {
    sr = await Promise.race([
      sb.auth.getSession(),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 4000); })
    ]);
  } catch (_) {
    try { localStorage.removeItem('sb-rurnemgzamnfjvmlbdug-auth-token'); } catch (_) { }
    showError('Sessão inválida. <a href="/acesso/?next=/admin/">Faça login</a>.');
    return;
  }
  if (!sr || !sr.data || !sr.data.session) {
    showError('Não logado. <a href="/acesso/?next=/admin/">Faça login</a> com o e-mail admin.');
    return;
  }

  var userEmail = (sr.data.session.user && sr.data.session.user.email) || '';
  var firstName = userEmail.split('@')[0].split('.')[0];
  $('greetingName').textContent = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  function authFetch(path) {
    return sb.auth.getSession().then(function (r) {
      var t = r && r.data && r.data.session && r.data.session.access_token;
      if (!t) throw new Error('no_session');
      return fetch(API + path, { headers: { 'Authorization': 'Bearer ' + t } });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        return { ok: r.ok, status: r.status, body: b };
      });
    });
  }

  function authPost(path, body) {
    return sb.auth.getSession().then(function (r) {
      var t = r && r.data && r.data.session && r.data.session.access_token;
      if (!t) throw new Error('no_session');
      return fetch(API + path, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        return { ok: r.ok, status: r.status, body: b };
      });
    });
  }

  // ── Render ───────────────────────────────────────────────────────
  function renderRiskBadge(level) {
    var map = {
      critical: { color: '#ef4444', label: '🔴 Crítico' },
      warning: { color: '#f59e0b', label: '🟡 Atenção' },
      monitoring: { color: '#6b7280', label: '⚪ Monitoring' },
      healthy: { color: '#00e676', label: '🟢 Saudável' },
    };
    var m = map[level] || map.monitoring;
    return '<span class="risk-badge" style="background:' + m.color + '22;border:1px solid ' + m.color + ';color:' + m.color + '">' + m.label + '</span>';
  }

  function renderStatusTag(status) {
    var color = '#9aa3aa';
    if (status === 'active') color = '#00e676';
    else if (status === 'trial' || status === 'trialing') color = '#3b82f6';
    else if (status === 'past_due') color = '#ef4444';
    else if (status === 'canceled') color = '#6b7280';
    else if (status === 'pending_payment') color = '#f59e0b';
    return '<span class="tag" style="background:' + color + '22;border:1px solid ' + color + ';color:' + color + '">' + escHtml(status) + '</span>';
  }

  function render(d) {
    var c = d.customers, fin = d.finance, fn = d.funnel_30d, wf = d.wizard_funnel || null, p = d.partners, sys = d.system;
    var cl = d.customers_list || [];
    var f = d.filters || {};

    // Greeting
    var hourGreet = greetForHour();
    $('greetingHeadline').innerHTML = hourGreet + ', <em>' + escHtml(firstName.charAt(0).toUpperCase() + firstName.slice(1)) + '</em>.';
    var critical = cl.filter(function (x) { return x.risk_level === 'critical'; }).length;
    var warning = cl.filter(function (x) { return x.risk_level === 'warning'; }).length;
    var copyParts = [];
    if (critical > 0) copyParts.push('<strong style="color:#ef4444">' + critical + '</strong> cliente(s) <strong>crítico(s)</strong>');
    if (warning > 0) copyParts.push('<strong style="color:#f59e0b">' + warning + '</strong> em atenção');
    if (c.using.last_7d > 0) copyParts.push('<strong style="color:#00e676">' + c.using.last_7d + '</strong> usando o bot');
    $('greetingCopy').innerHTML = copyParts.length
      ? copyParts.join(' · ')
      : 'Sem clientes reais ativos hoje. Foco em validação.';

    var html = '';

    // ─────────── HERO REAL: MRR efetivo + clientes USANDO ───────────
    html += '<section class="hero">';
    html += '  <div class="hero-grid">';
    html += '    <div class="hero-cell">';
    html += '      <div class="hero-label">MRR efetivo</div>';
    html += '      <div class="hero-value">' + fmtBrl(fin.mrr_brl) + '</div>';
    html += '      <div class="hero-foot">'
      + 'só clientes <strong>active</strong> · '
      + fmtBrl(fin.mrr_in_trial_brl) + ' em trial · '
      + fmtBrl(fin.mrr_at_risk_brl) + ' em risco'
      + '</div>';
    html += '    </div>';
    html += '    <div class="hero-cell">';
    html += '      <div class="hero-label">Usando o bot (últimos 7d)</div>';
    html += '      <div class="hero-value" style="color:' + (c.using.last_7d > 0 ? '#00e676' : '#ef4444') + '">' + fmtNum(c.using.last_7d) + '</div>';
    html += '      <div class="hero-foot">'
      + 'de ' + fmtNum(c.total) + ' clientes reais · '
      + fmtNum(c.using.last_30d) + ' nos últimos 30d'
      + '</div>';
    html += '    </div>';
    html += '    <div class="hero-cell">';
    html += '      <div class="hero-label">Ativaram & não usam</div>';
    var azuColor = c.activated_zero_use > 0 ? '#ef4444' : '#00e676';
    html += '      <div class="hero-value" style="color:' + azuColor + '">' + fmtNum(c.activated_zero_use) + '</div>';
    html += '      <div class="hero-foot">'
      + fmtPct(c.activated_zero_use_pct) + ' dos ativados — gargalo PMF'
      + '</div>';
    html += '    </div>';
    html += '    <div class="hero-cell sparkline-cell">';
    html += '      <div class="hero-label">Sign-ups · 30 dias</div>';
    html += sparkline(d.signups_daily || []);
    html += '      <div class="hero-foot">' + fmtNum(fn.signups) + ' sign-ups · ' + fmtNum(fn.using_after_7d) + ' usando após 7d</div>';
    html += '    </div>';
    html += '  </div>';
    html += '</section>';

    // ─────────── FUNIL DE ATIVAÇÃO REAL ───────────
    html += '<div class="section-eyebrow">Funil real (últimos 30 dias)</div>';
    html += '<section class="funnel">';
    html += '  <div class="funnel-row">';
    [
      ['Sign-ups', fn.signups, null],
      ['Wizard completo', fn.wizard_completed, fn.conversion.signup_to_wizard],
      ['1ª mensagem', fn.first_message, fn.conversion.wizard_to_first_message],
      ['Usando após 7d', fn.using_after_7d, fn.conversion.first_message_to_using],
    ].forEach(function (step, idx) {
      var rate = step[2];
      var rateClass = rate == null ? '' : (rate >= 50 ? 'good' : rate >= 25 ? 'warn' : 'bad');
      html += '<div class="funnel-step">'
        + '<div class="funnel-step-label">' + escHtml(step[0]) + '</div>'
        + '<div class="funnel-step-num">' + fmtNum(step[1]) + '</div>'
        + (rate != null ? '<div class="funnel-step-rate ' + rateClass + '">' + fmtPct(rate) + ' do anterior</div>' : '<div class="funnel-step-rate">—</div>')
        + '</div>';
      if (idx < 3) html += '<div class="funnel-arrow">→</div>';
    });
    html += '  </div>';
    html += '  <div class="funnel-foot">Conversão signup → uso real: <strong>' + fmtPct(fn.conversion.signup_to_using) + '</strong>'
      + ' · alvo v2.1 ≥ 50% no decision gate M1</div>';
    html += '</section>';

    // ─────────── WIZARD DROP-OFF (instrumentation) ───────────
    if (wf) {
      html += '<div class="section-eyebrow">Wizard drop-off (toda a base real)</div>';
      html += '<section class="funnel">';
      html += '  <div class="funnel-row">';
      [
        ['Signups', wf.signups, null],
        ['Wizard aberto', wf.landed != null ? wf.landed : '—', wf.conversion.signup_to_landed],
        ['Step 1 — Negócio', wf.step1_completed, wf.conversion.landed_to_step1 || wf.conversion.signup_to_step1],
        ['Step 2 — Atendimento', wf.step2_completed, wf.conversion.step1_to_step2],
        ['Step 3 — Perguntas', wf.step3_completed, wf.conversion.step2_to_step3],
        ['Wizard salvo', wf.activated, wf.conversion.step3_to_activated],
      ].forEach(function (step, idx, arr) {
        var rate = step[2];
        var rateClass = rate == null ? '' : (rate >= 70 ? 'good' : rate >= 40 ? 'warn' : 'bad');
        html += '<div class="funnel-step">'
          + '<div class="funnel-step-label">' + escHtml(step[0]) + '</div>'
          + '<div class="funnel-step-num">' + fmtNum(step[1]) + '</div>'
          + (rate != null ? '<div class="funnel-step-rate ' + rateClass + '">' + fmtPct(rate) + ' do anterior</div>' : '<div class="funnel-step-rate">—</div>')
          + '</div>';
        if (idx < arr.length - 1) html += '<div class="funnel-arrow">→</div>';
      });
      html += '  </div>';
      // Drop-off destacado
      var drop = wf.drop || {};
      var dropKeys = ['signup_to_landed', 'landed_to_step1', 'step1_to_step2', 'step2_to_step3'];
      var dropTotal = dropKeys.reduce(function (s, k) { return s + (drop[k] || 0); }, 0);
      var biggestDrop = dropKeys.reduce(function (acc, k) {
        return (drop[k] || 0) > (drop[acc] || 0) ? k : acc;
      }, 'signup_to_landed');
      var dropLabel = ({
        'signup_to_landed': 'entre Signup → Wizard aberto (magic link nunca clicado ou link quebrado)',
        'landed_to_step1':  'entre Wizard aberto → Step 1 (cliente abriu mas desistiu antes do primeiro form)',
        'step1_to_step2':   'entre Step 1 → Step 2 (configuração de atendimento)',
        'step2_to_step3':   'entre Step 2 → Step 3 (perguntas frequentes)',
      })[biggestDrop] || biggestDrop;
      html += '  <div class="funnel-foot">';
      html += 'Drop-off total: <strong style="color:#ef4444">' + fmtNum(dropTotal) + '</strong> clientes abandonaram. ';
      html += 'Maior gargalo: <strong>' + escHtml(dropLabel) + '</strong> (' + fmtNum(wf.drop[biggestDrop]) + ' clientes).';
      html += '  </div>';
      html += '</section>';
    }

    // ─────────── CLIENTES — TABELA COMPLETA ───────────
    html += '<div class="section-eyebrow">Clientes reais (' + fmtNum(cl.length) + ')</div>';
    html += '<section class="customers-section">';
    if (cl.length === 0) {
      html += '<div class="empty-state">'
        + '<p>Nenhum cliente real encontrado.</p>'
        + '<small>' + (f.test_emails_excluded ? f.test_emails_excluded + ' contas de teste filtradas. ' : '') + 'Use o toggle "Incluir testes" no topo se quiser ver tudo.</small>'
        + '</div>';
    } else {
      html += '<div class="customers-table-wrap">';
      html += '<table class="customers-table">';
      html += '<thead><tr>'
        + '<th>Risco</th>'
        + '<th>Cliente</th>'
        + '<th>Plano</th>'
        + '<th>Status</th>'
        + '<th>MRR</th>'
        + '<th>Signup</th>'
        + '<th>Ativação</th>'
        + '<th>Conv 7d</th>'
        + '<th>Conv 30d</th>'
        + '<th>Próxima ação</th>'
        + '<th>Ações</th>'
        + '</tr></thead><tbody>';
      cl.forEach(function (x) {
        var name = x.company_name || ('<span style="color:#6b7280">— sem nome —</span>');
        var emailLine = x.email ? '<div class="email-line">' + escHtml(x.email) + '</div>' : '';
        var whatsLine = x.whatsapp_number ? '<div class="whats-line">📱 ' + escHtml(x.whatsapp_number) + '</div>' : '';
        var convCell7 = x.conversations_7d > 0
          ? '<span class="conv-num good">' + x.conversations_7d + '</span>'
          : '<span class="conv-num zero">0</span>';
        var convCell30 = x.conversations_30d > 0
          ? '<span class="conv-num">' + x.conversations_30d + '</span>'
          : '<span class="conv-num zero">0</span>';
        var actBtn = '';
        if (x.risk_level === 'critical' || x.risk_level === 'warning') {
          actBtn += '<button class="btn-mini" data-action="extend-trial" data-id="' + escHtml(x.id) + '" data-name="' + escHtml(x.company_name || x.email || '') + '">+14d trial</button>';
        }
        html += '<tr class="risk-' + escHtml(x.risk_level) + '">'
          + '<td>' + renderRiskBadge(x.risk_level) + '</td>'
          + '<td><div class="cust-name">' + escHtml(name) + '</div>' + emailLine + whatsLine + '</td>'
          + '<td><span class="plan-tag plan-' + escHtml(x.plan_code) + '">' + escHtml(x.plan_code || '—') + '</span></td>'
          + '<td>' + renderStatusTag(x.status) + '</td>'
          + '<td>' + (x.mrr_brl > 0 ? '<strong>' + fmtBrl(x.mrr_brl) + '</strong>' : '<span style="color:#6b7280">—</span>') + '</td>'
          + '<td>' + shortDate(x.created_at) + '<div class="ts-rel">' + (x.days_since_signup != null ? x.days_since_signup + 'd' : '—') + '</div></td>'
          + '<td>' + (x.activated_at ? shortDate(x.activated_at) + '<div class="ts-rel">' + (x.days_since_activated != null ? x.days_since_activated + 'd' : '—') + '</div>' : '<span style="color:#ef4444">não ativou</span>') + '</td>'
          + '<td>' + convCell7 + '</td>'
          + '<td>' + convCell30 + '</td>'
          + '<td><div class="next-action">' + escHtml(x.next_action) + '</div></td>'
          + '<td class="actions-col">' + actBtn + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }
    html += '</section>';

    // ─────────── FINANCEIRO ───────────
    html += '<div class="section-eyebrow">Financeiro (estimativa últimos 30d)</div>';
    html += '<section class="finance-grid">';
    html += '  <div class="fin-cell"><div class="fin-label">MRR confirmado</div><div class="fin-value">' + fmtBrl(fin.mrr_brl) + '</div></div>';
    html += '  <div class="fin-cell"><div class="fin-label">- Anthropic (IA)</div><div class="fin-value cost">' + fmtBrl(fin.cost_anthropic_brl_30d) + '</div></div>';
    html += '  <div class="fin-cell"><div class="fin-label">- Stripe fees</div><div class="fin-value cost">' + fmtBrl(fin.cost_stripe_brl_30d) + '</div></div>';
    html += '  <div class="fin-cell"><div class="fin-label">- BSP</div><div class="fin-value cost">' + fmtBrl(fin.cost_bsp_brl_30d) + '</div></div>';
    html += '  <div class="fin-cell highlight">'
      + '<div class="fin-label">Margem bruta</div>'
      + '<div class="fin-value">' + fmtBrl(fin.gross_margin_brl_30d) + '</div>'
      + '<div class="fin-foot">' + fmtPct(fin.gross_margin_pct) + ' de margem</div>'
      + '</div>';
    html += '</section>';

    // Plans
    html += '<div class="split-grid">';
    html += '  <div class="panel">';
    html += '    <h3>Distribuição por plano</h3>';
    var maxPlan = Math.max(c.by_plan.starter || 0, c.by_plan.pro || 0, c.by_plan.parceiro || 0, 1);
    html += '    <div class="bars">';
    [
      ['Starter R$197', c.by_plan.starter || 0, fin.mrr_by_plan.starter || 0, 'starter'],
      ['Pro R$497', c.by_plan.pro || 0, fin.mrr_by_plan.pro || 0, 'pro'],
      ['Parceiro R$1.297', c.by_plan.parceiro || 0, fin.mrr_by_plan.parceiro || 0, 'parceiro'],
    ].forEach(function (row) {
      var pct = ((row[1] / maxPlan) * 100).toFixed(0);
      html += '<div class="bar-row"><div class="bar-label">' + escHtml(row[0]) + '</div><div class="bar-track"><div class="bar-fill ' + row[3] + '" style="width:' + pct + '%"></div></div><div class="bar-num">' + fmtNum(row[1]) + ' · ' + fmtBrl(row[2]) + '</div></div>';
    });
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="panel">';
    html += '    <h3>Status detalhado da base</h3>';
    html += '    <div class="status-grid-mini">';
    [
      ['active', 'Active', '#00e676'],
      ['trial', 'Trial', '#3b82f6'],
      ['trialing', 'Trialing', '#3b82f6'],
      ['pending_payment', 'Pending pgto', '#f59e0b'],
      ['past_due', 'Past due', '#ef4444'],
      ['canceled', 'Canceled', '#6b7280'],
    ].forEach(function (row) {
      var n = c.by_status[row[0]] || 0;
      html += '<div class="status-cell"><div class="status-cell-label">' + escHtml(row[1]) + '</div><div class="status-cell-num" style="color:' + row[2] + '">' + fmtNum(n) + '</div></div>';
    });
    html += '    </div>';
    html += '  </div>';
    html += '</div>';

    // ─────────── PARCEIROS ───────────
    html += '<div class="section-eyebrow">Canal parceiro</div>';
    html += '<section class="partners-grid">';
    html += '  <div class="part-cell"><div class="part-label">Parceiros cadastrados</div><div class="part-value">' + fmtNum(p.total) + '</div></div>';
    html += '  <div class="part-cell"><div class="part-label">Com cliente ativo</div><div class="part-value">' + fmtNum(p.with_active_clients) + '</div></div>';
    html += '  <div class="part-cell"><div class="part-label">Comissão</div><div class="part-value">' + fmtPct(p.commission_rate_pct) + '</div></div>';
    html += '  <div class="part-cell"><div class="part-label">A pagar</div><div class="part-value" style="color:#f59e0b">' + fmtBrl(p.commissions_pending_brl) + '</div></div>';
    html += '  <div class="part-cell"><div class="part-label">Já pago (histórico)</div><div class="part-value">' + fmtBrl(p.commissions_paid_total_brl) + '</div></div>';
    html += '</section>';

    // ─────────── SISTEMA ───────────
    html += '<div class="section-eyebrow">Integrações & ambiente</div>';
    html += '<section class="system-grid">';
    Object.keys(sys.integrations).forEach(function (k) {
      var i = sys.integrations[k];
      var label = ({ meta_direct: 'Meta Direct', d360_dialog: '360Dialog', gupshup: 'Gupshup' })[k] || k;
      var color = i.enabled ? '#00e676' : '#6b7280';
      var modeTag = i.mode ? ' · ' + i.mode : '';
      html += '<div class="sys-cell">'
        + '<div class="sys-head"><span class="sys-dot" style="background:' + color + '"></span><strong>' + escHtml(label) + '</strong></div>'
        + '<div class="sys-meta">' + (i.enabled ? 'Ativo' : 'Desligado') + modeTag + '</div>'
        + '<div class="sys-url">' + escHtml(i.webhook_url || '—') + '</div>'
        + '</div>';
    });
    html += '</section>';

    // Env health row
    html += '<div class="env-row">';
    Object.keys(sys.env).forEach(function (k) {
      var ok = sys.env[k];
      html += '<span class="env-pill ' + (ok ? 'ok' : 'missing') + '" title="' + escHtml(k) + (ok ? ' configurada' : ' AUSENTE') + '">'
        + (ok ? '✓ ' : '✗ ') + escHtml(k.replace(/_/g, ' '))
        + '</span>';
    });
    html += '</div>';

    content.innerHTML = html;
    foot.innerHTML = 'Atualizado em ' + new Date(d.ts).toLocaleString('pt-BR')
      + ' · gerado em ' + d.generated_in_ms + 'ms'
      + ' · ' + d.filters.real_customers_count + ' clientes reais (' + d.filters.test_emails_excluded + ' testes filtrados de ' + d.filters.total_customers_in_db + ' totais)'
      + ' · MercaBot Cockpit v3';

    // Wire actions
    document.querySelectorAll('[data-action="extend-trial"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var name = btn.getAttribute('data-name');
        if (!confirm('Estender trial por +14 dias para: ' + (name || id) + '?')) return;
        btn.disabled = true; btn.textContent = '...';
        authPost('/admin/trial-extend', { customerId: id, days: 14 }).then(function (r) {
          if (r.ok) {
            btn.textContent = '✓ +14d';
            setTimeout(load, 800);
          } else {
            alert('Falha: ' + (r.body && r.body.error || r.status));
            btn.disabled = false; btn.textContent = '+14d trial';
          }
        });
      });
    });
  }

  async function load() {
    setStatus('Carregando…');
    try {
      var qs = includeTestEl && includeTestEl.checked ? '?include_test=1' : '';
      var r = await authFetch('/admin/dashboard' + qs);
      if (r.status === 403) {
        showError('Acesso restrito. Logado como ' + escHtml(userEmail) + '.');
        return;
      }
      if (!r.ok) {
        showError('Falha: ' + escHtml(r.body && r.body.error || ('HTTP ' + r.status)));
        return;
      }
      render(r.body);
      setStatus('Atualizado às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (err) {
      showError('Erro: ' + escHtml(String(err.message || err)));
    }
  }

  // Wire
  $('refreshBtn').addEventListener('click', load);
  if (includeTestEl) includeTestEl.addEventListener('change', load);
  $('diagBtn').addEventListener('click', async function () {
    setStatus('Carregando diag…');
    try {
      var r = await authFetch('/admin/diagnostics');
      if (!r.ok) { alert('Falha: ' + (r.body.error || r.status)); setStatus(''); return; }
      console.log('[admin/diagnostics]', r.body);
      console.table(r.body.env);
      setStatus('Diag no console (F12).');
    } catch (_) { setStatus('Erro', true); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'r' || e.key === 'R') load();
  });

  load();
  setInterval(load, 5 * 60 * 1000);
})();
