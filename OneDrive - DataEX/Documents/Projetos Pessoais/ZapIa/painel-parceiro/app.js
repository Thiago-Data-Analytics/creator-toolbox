// ── Security: HTML sanitizer for user-controlled data ────────────
function esc(str){
  if(str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
    .replace(/\//g,'&#47;');
}

// ── DATA ────────────────────────────────────────────────────────
// Autenticação gerenciada pelo Cloudflare Access (Zero Trust)
// O acesso ao /painel-parceiro requer email autorizado via Cloudflare Access
var LS = {
  get: function(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
  set: function(k,v){ if(!k || k === 'undefined' || k === 'null') return; try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} },
};

// ── PLAN PRICES BRL — atualizar aqui se os preços mudarem ────────
var PLAN_PRICES_BRL = { Starter: 197, Pro: 497, Parceiro: 1297 };

// ── BACKEND SYNC ─────────────────────────────────────────────────
var _PARTNER_API = (window.__mbConfig || {}).API_BASE_URL || 'https://api.mercabot.com.br';
var _syncTimer = null;

function _getCFToken(){
  var m = document.cookie.match(/CF_Authorization=([^;]+)/);
  if(!m) return null;
  var token = m[1].trim();
  try{
    var parts = token.split('.');
    if(parts.length !== 3) return null;
    var b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
    var padded = b64 + '==='.slice(0,(4 - b64.length % 4) % 4);
    var payload = JSON.parse(atob(padded));
    var exp = Number(payload.exp || 0);
    if(exp && Math.floor(Date.now() / 1000) > exp) return null;
  }catch(_){ return null; }
  return token;
}

function _collectAllData(){
  return {
    clients:   getClients(),
    resources: getResources(),
    config: {
      partner:    LS.get('mb_partner_config') || {},
      whitelabel: LS.get('mb_wl')             || {},
      domain:     LS.get('mb_wl_domain')      || ''
    }
  };
}

function scheduleSync(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_pushToBackend, 1500);
}

function _pushToBackend(){
  var token = _getCFToken();
  if(!token) return;
  var ctrl = new AbortController();
  setTimeout(function(){ ctrl.abort(); }, 5000);
  fetch(_PARTNER_API + '/partner/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(_collectAllData()),
    signal: ctrl.signal
  }).catch(function(){});
}

// Retorna true se o backend tinha uma linha salva (updatedAt presente),
// false se não havia linha ainda (não sobrescreve dados locais nesse caso).
function _pullFromBackend(onDone){
  var token = _getCFToken();
  if(!token){ onDone && onDone(false); return; }
  var ctrl = new AbortController();
  setTimeout(function(){ ctrl.abort(); }, 8000);
  fetch(_PARTNER_API + '/partner/sync', {
    headers: { 'Authorization': 'Bearer ' + token },
    signal: ctrl.signal
  })
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(data){
    if(!data || !data.ok){ onDone && onDone(false); return; }
    // Só sobrescreve localStorage se o banco já tinha uma linha (updatedAt presente).
    // Sem essa guarda, o primeiro pull de um parceiro novo apagaria todos os
    // dados que ele tinha em localStorage antes do backend sync existir.
    var hasRow = !!data.updatedAt;
    if(hasRow){
      if(Array.isArray(data.clients))  LS.set('mb_partner_clients',  data.clients);
      if(Array.isArray(data.resources)) LS.set('mb_partner_resources', data.resources);
      if(data.config){
        if(data.config.partner    && typeof data.config.partner    === 'object') LS.set('mb_partner_config', data.config.partner);
        if(data.config.whitelabel && typeof data.config.whitelabel === 'object') LS.set('mb_wl',             data.config.whitelabel);
        if(data.config.domain)                                                    LS.set('mb_wl_domain',      data.config.domain);
      }
    }
    onDone && onDone(hasRow);
  })
  .catch(function(){ onDone && onDone(false); });
}

function defaultClients(){
  return [];
}

function defaultResources(){
  return [];
}

function getClients(){ return LS.get('mb_partner_clients') || defaultClients(); }
function getResources(){ return LS.get('mb_partner_resources') || defaultResources(); }

function doLogout(){
  showConfirm('Deseja sair do painel parceiro agora?', function(){
    window.location.href = '/cdn-cgi/access/logout';
  }, 'Sair', 'Cancelar');
}

function setButtonBusy(target, isBusy, busyLabel){
  var el = typeof target === 'string' ? document.getElementById(target) : target;
  if(!el) return;
  if(isBusy){
    if(!el.dataset.originalLabel) el.dataset.originalLabel = el.textContent;
    el.disabled = true;
    el.classList.add('btn-busy');
    el.textContent = busyLabel || 'Processando...';
    return;
  }
  el.disabled = false;
  el.classList.remove('btn-busy');
  if(el.dataset.originalLabel){
    el.textContent = el.dataset.originalLabel;
  }
}

function isValidEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizePhoneDigits(value){
  return String(value || '').replace(/\D+/g,'');
}

function formatOfficialNumber(value){
  var digits = normalizePhoneDigits(value).slice(0, 15);
  if(!digits) return '';
  if(digits.length <= 2) return '+' + digits;
  var country = digits.slice(0, 2);
  var rest = digits.slice(2);
  if(rest.length <= 2) return '+' + country + ' ' + rest;
  if(rest.length <= 7) return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2);
  if(rest.length <= 11) return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2, rest.length - 4) + '-' + rest.slice(rest.length - 4);
  return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2, 7) + '-' + rest.slice(7, 11);
}

function isValidOfficialNumber(value){
  return /^\d{10,15}$/.test(normalizePhoneDigits(value));
}

function isValidDomain(value){
  return /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(String(value || '').trim());
}

function startApp(name){
  document.getElementById('app').style.display = 'flex';
  document.getElementById('topbarName').textContent = name || 'Sessão protegida';
  _pullFromBackend(function(hadBackendData){
    renderAll();
    showPage(getStoredPartnerPage());
    // Migração localStorage → backend: se não havia linha no banco mas há
    // dados locais, faz um push imediato para criar a linha e garantir que
    // outros dispositivos enxerguem os dados na próxima abertura.
    if(!hadBackendData && getClients().length > 0){
      _pushToBackend();
    }
  });
}

// Inicialização por Cloudflare Access — só mostra o app se o cookie CF_Authorization existir
(function initPartnerAuth(){
  var hasCFToken = document.cookie.split(';').some(function(c){
    return c.trim().indexOf('CF_Authorization=') === 0;
  });
  if(!hasCFToken){
    document.getElementById('authScreen').style.display = 'flex';
    return;
  }
  document.getElementById('authScreen').style.display = 'none';
  startApp('Sessão protegida');
}());

// ── NAVIGATION ───────────────────────────────────────────────────
var ACTIVE_PARTNER_PAGE_KEY = 'mb_partner_active_page';
function getAllowedPartnerPages(){
  return ['dashboard','performance','clientes','whitelabel','resources','onboarding','config'];
}
function getStoredPartnerPage(){
  try{
    var saved = String(localStorage.getItem(ACTIVE_PARTNER_PAGE_KEY) || '').trim();
    return getAllowedPartnerPages().indexOf(saved) >= 0 ? saved : 'dashboard';
  }catch(_){
    return 'dashboard';
  }
}
function storePartnerPage(pageId){
  try{
    localStorage.setItem(ACTIVE_PARTNER_PAGE_KEY, getAllowedPartnerPages().indexOf(pageId) >= 0 ? pageId : 'dashboard');
  }catch(_){}
}
function updatePartnerBreadcrumb(pageId){
  var crumb = document.getElementById('partnerBreadcrumb');
  if(!crumb) return;
  var labels = {
    dashboard:'Visão geral',
    performance:'Performance',
    clientes:'Clientes',
    whitelabel:'White-label',
    resources:'Central digital',
    onboarding:'Onboarding',
    config:'Configurações'
  };
  var current = crumb.querySelector('.crumb-current');
  if(current) current.textContent = labels[pageId] || 'Visão geral';
}
function showPage(id){
  var pageId = getAllowedPartnerPages().indexOf(id) >= 0 ? id : 'dashboard';
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n){
    n.classList.remove('active');
    n.setAttribute('aria-current','false');
  });
  var pg = document.getElementById('page-'+pageId);
  if(pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(function(n){
    if(n.dataset.page === pageId){
      n.classList.add('active');
      n.setAttribute('aria-current','page');
      if(typeof n.scrollIntoView === 'function'){
        n.scrollIntoView({ block:'nearest', inline:'center', behavior:'auto' });
      }
    }
  });
  storePartnerPage(pageId);
  updatePartnerBreadcrumb(pageId);
}

// ── RENDER ───────────────────────────────────────────────────────
function renderAll(){
  renderStats();
  renderDashRiskAlert();
  renderClientsTable();
  renderRecentClients();
  renderResources();
  renderRecentResources();
  renderResourceGrid();
  renderPortfolioAssets();
  renderPerformancePage();
  renderOnboarding();
  loadConfig();
}

function statusBadge(s){
  var map = { active:'<span class="status-badge status-active"><span class="status-dot"></span>Ativo</span>',
              trial:'<span class="status-badge status-trial"><span class="status-dot"></span>Trial</span>',
              inactive:'<span class="status-badge status-inactive"><span class="status-dot"></span>Inativo</span>' };
  return map[s] || s;
}
function createStatusBadge(s){
  var span = document.createElement('span');
  var label = s === 'active' ? 'Ativo' : s === 'trial' ? 'Trial' : s === 'inactive' ? 'Inativo' : String(s || '');
  span.className = 'status-badge ' + (s === 'active' ? 'status-active' : s === 'trial' ? 'status-trial' : s === 'inactive' ? 'status-inactive' : '');
  var dot = document.createElement('span');
  dot.className = 'status-dot';
  span.appendChild(dot);
  span.appendChild(document.createTextNode(label));
  return span;
}
function createEmptyRow(message){
  var tr = document.createElement('tr');
  var td = document.createElement('td');
  td.colSpan = 6;
  td.style.textAlign = 'center';
  td.style.padding = '2rem';
  td.style.color = 'var(--faint)';
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}
function createClientRow(c){
  var tr = document.createElement('tr');
  var tdName = document.createElement('td');
  var name = document.createElement('div');
  name.className = 'client-name';
  name.textContent = c.name;
  var segment = document.createElement('div');
  segment.className = 'client-segment';
  segment.textContent = c.segment + ' · ' + (c.stage || 'Implantação');
  tdName.appendChild(name);
  tdName.appendChild(segment);
  if(c.notes){
    var notePreview = document.createElement('div');
    notePreview.style.cssText = 'font-size:.72rem;color:var(--muted);margin-top:.15rem;font-style:italic;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    notePreview.title = c.notes;
    notePreview.textContent = '📝 ' + c.notes;
    tdName.appendChild(notePreview);
  }
  var tdPlan = document.createElement('td');
  var plan = document.createElement('span');
  plan.className = 'plan-tag';
  plan.textContent = c.plan;
  tdPlan.appendChild(plan);
  var tdChannel = document.createElement('td');
  var channel = document.createElement('span');
  channel.style.fontSize = '.75rem';
  channel.style.color = 'var(--muted)';
  channel.textContent = c.whatsappNumber ? ('WhatsApp · ' + c.whatsappNumber) : 'Aguardando conexão';
  tdChannel.appendChild(channel);
  var tdStatus = document.createElement('td');
  tdStatus.appendChild(createStatusBadge(c.status));
  var tdSince = document.createElement('td');
  tdSince.style.color = 'var(--muted)';
  tdSince.style.fontSize = '.8rem';
  tdSince.textContent = c.since;
  var tdActions = document.createElement('td');
  var actions = document.createElement('div');
  actions.className = 'actions-cell';
  [
    { label:'Editar', cls:'action-btn', fn:function(){ openEditClient(c.id); } },
    { label:'📝 Nota', cls:'action-btn', fn:function(){ openQuickNote(c.id, tr); } },
    { label:'Enviar link', cls:'action-btn', fn:function(){ openConfigClient(c.id); } },
    { label:'Ver FAQ', cls:'action-btn', fn:function(){ openClientFaqById(c.id); } },
    { label:'Remover', cls:'action-btn danger', fn:function(){ removeClient(c.id); } }
  ].forEach(function(item){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = item.cls;
    btn.textContent = item.label;
    btn.addEventListener('click', item.fn);
    actions.appendChild(btn);
  });
  tdActions.appendChild(actions);
  [tdName, tdPlan, tdChannel, tdStatus, tdSince, tdActions].forEach(function(td){ tr.appendChild(td); });
  return tr;
}
function createRecentClientRow(c){
  var tr = document.createElement('tr');
  var tdName = document.createElement('td');
  var name = document.createElement('div');
  name.className = 'client-name';
  name.textContent = c.name;
  var segment = document.createElement('div');
  segment.className = 'client-segment';
  segment.textContent = c.stage || 'Implantação';
  tdName.appendChild(name);
  tdName.appendChild(segment);
  var tdPlan = document.createElement('td');
  var plan = document.createElement('span');
  plan.className = 'plan-tag';
  plan.textContent = c.plan;
  tdPlan.appendChild(plan);
  var tdStatus = document.createElement('td');
  tdStatus.appendChild(createStatusBadge(c.status));
  [tdName, tdPlan, tdStatus].forEach(function(td){ tr.appendChild(td); });
  return tr;
}
function createResourceItem(t, includeDate){
  var wrap = document.createElement('div');
  wrap.className = 'resource-item';
  var prio = document.createElement('div');
  prio.className = 'resource-prio ' + t.prio;
  var info = document.createElement('div');
  info.className = 'resource-info';
  var subject = document.createElement('div');
  subject.className = 'resource-subject';
  subject.textContent = t.subject;
  var meta = document.createElement('div');
  meta.className = 'resource-meta';
  meta.textContent = includeDate ? (t.client + ' · ' + t.date) : t.client;
  info.appendChild(subject);
  info.appendChild(meta);
  if(includeDate && t.detail){
    var detailEl = document.createElement('div');
    detailEl.style.cssText = 'font-size:.88rem;color:var(--faint);margin-top:.2rem;line-height:1.45';
    detailEl.textContent = t.detail;
    info.appendChild(detailEl);
  }
  wrap.appendChild(prio);
  wrap.appendChild(info);
  if(includeDate){
    var status = document.createElement('span');
    var statusCls = t.status==='open'?'open':t.status==='closed'?'closed':'';
    status.className = 'resource-status ' + statusCls;
    status.textContent = ({open:'Em uso',closed:'Concluído',pending:'Pendente'}[t.status] || t.status);
    wrap.appendChild(status);
  }
  return wrap;
}
function createEmptyResource(message, compact){
  var empty = document.createElement('div');
  empty.className = 'empty';
  if(compact) empty.style.padding = '1.5rem';
  var icon = document.createElement('div');
  icon.className = 'empty-icon';
  icon.textContent = '✅';
  var title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = message;
  empty.appendChild(icon);
  empty.appendChild(title);
  return empty;
}

function renderStats(){
  var clients = getClients();
  var active = clients.filter(function(c){ return c.status==='active'; }).length;
  var trial  = clients.filter(function(c){ return c.status==='trial'; }).length;
var openResources = getResources().filter(function(t){ return t.status==='open'; }).length;
  var mrr = clients.filter(function(c){ return c.status==='active'||c.status==='trial'; })
                   .reduce(function(a,c){ return a + (PLAN_PRICES_BRL[c.plan] || PLAN_PRICES_BRL.Starter); },0);
  var statsGrid = document.getElementById('statsGrid');
  if(!statsGrid) return;
  statsGrid.textContent = '';
  [
    { label:'Total de clientes', value:String(clients.length), delta:active+' ativos · '+trial+' em trial' },
    { label:'MRR estimado', value:'R$'+mrr.toLocaleString('pt-BR'), delta:'Receita mensal recorrente' },
{ label:'Itens na central digital', value:String(openResources), delta:'Guias e ações em andamento', color:(openResources>0?'var(--amber)':'var(--green)') },
    { label:'Clientes Pro+', value:String(clients.filter(function(c){ return c.plan==='Pro'||c.plan==='Parceiro'; }).length), delta:'Planos Pro e Parceiro' }
  ].forEach(function(item){
    var card = document.createElement('div');
    card.className = 'stat-card';
    var label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = item.label;
    var value = document.createElement('div');
    value.className = 'stat-value';
    if(item.color) value.style.color = item.color;
    value.textContent = item.value;
    var delta = document.createElement('div');
    delta.className = 'stat-delta';
    delta.textContent = item.delta;
    card.appendChild(label);
    card.appendChild(value);
    card.appendChild(delta);
    statsGrid.appendChild(card);
  });
}

function _renderClientStatsChips(clients){
  var chipsEl = document.getElementById('clientStatsChips');
  if(!chipsEl) return;
  chipsEl.textContent = '';
  var total    = clients.length;
  var active   = clients.filter(function(c){ return c.status === 'active'; }).length;
  var trial    = clients.filter(function(c){ return c.status === 'trial'; }).length;
  var inactive = clients.filter(function(c){ return c.status === 'inactive'; }).length;
  var atRisk   = clients.filter(function(c){ return (c.stage||'').toLowerCase().indexOf('risco') >= 0; }).length;
  var notes    = clients.filter(function(c){ return !!c.notes; }).length;
  var defs = [
    { label:'Total: ' + total,         stage:'',            color:'var(--muted)',    bg:'rgba(255,255,255,.05)' },
    { label:'✅ Ativos: ' + active,     status:'active',     color:'var(--green)',    bg:'rgba(0,230,118,.09)' },
    { label:'⏱ Trial: ' + trial,       status:'trial',      color:'var(--amber)',    bg:'rgba(255,183,77,.09)' },
    { label:'⚠️ Risco: ' + atRisk,     stage:'Risco',       color:'#e53935',         bg:'rgba(229,57,53,.09)' },
    { label:'💤 Inativos: ' + inactive, status:'inactive',   color:'var(--muted)',    bg:'rgba(255,255,255,.04)' }
  ];
  if(notes > 0) defs.push({ label:'📝 Com notas: ' + notes, notesOnly:true, color:'var(--muted)', bg:'rgba(255,255,255,.04)' });
  var stageEl  = document.getElementById('clientStageFilter');
  var statusEl = null; // no dedicated status filter element yet
  var searchEl = document.getElementById('clientSearch');
  defs.forEach(function(d){
    if(!d.label.includes(': 0') || d.label.startsWith('Total')){
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = d.label;
      chip.style.cssText = 'background:'+d.bg+';color:'+d.color+';border:1px solid rgba(255,255,255,.1);border-radius:100px;padding:.22rem .75rem;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s';
      chip.addEventListener('click', function(){
        if(d.stage !== undefined && stageEl){
          stageEl.value = d.stage;
          if(searchEl) searchEl.value = '';
          filterClients('');
        } else if(d.notesOnly){
          // filter in place — show only clients with notes
          var table = document.getElementById('clientsTable');
          if(!table) return;
          table.textContent = '';
          var filtered = clients.filter(function(c){ return !!c.notes; });
          if(!filtered.length) table.appendChild(createEmptyRow('Nenhum cliente com notas.'));
          else filtered.forEach(function(c){ table.appendChild(createClientRow(c)); });
        }
      });
      chipsEl.appendChild(chip);
    }
  });
}

function renderClientsTable(){
  var clients = getClients();
  document.getElementById('clientCountLabel').textContent = clients.length + ' cliente' + (clients.length!==1?'s':'');
  _renderClientStatsChips(clients);
  var table = document.getElementById('clientsTable');
  if(!table) return;
  table.textContent = '';
  if(!clients.length){
    table.appendChild(createEmptyRow('Nenhum cliente ainda. Clique em "+ Adicionar cliente".'));
    return;
  }
  clients.forEach(function(c){ table.appendChild(createClientRow(c)); });
}

function renderRecentClients(){
  var clients = getClients().slice(-4).reverse();
  var recent = document.getElementById('recentClients');
  if(!recent) return;
  recent.textContent = '';
  if(!clients.length){
    recent.appendChild(createEmptyResource('Nenhum cliente adicionado ainda', true));
    return;
  }
  clients.forEach(function(c){ recent.appendChild(createRecentClientRow(c)); });
}

function filterClients(q){
  var stageEl = document.getElementById('clientStageFilter');
  var planEl  = document.getElementById('clientPlanFilter');
  var stage   = stageEl ? stageEl.value : '';
  var plan    = planEl  ? planEl.value  : '';
  var clients = getClients();
  if(q) clients = clients.filter(function(c){ return (c.name||'').toLowerCase().indexOf(q.toLowerCase())>=0 || (c.segment||'').toLowerCase().indexOf(q.toLowerCase())>=0 || (c.email||'').toLowerCase().indexOf(q.toLowerCase())>=0; });
  if(stage) clients = clients.filter(function(c){ return (c.stage||'Implantação') === stage; });
  if(plan)  clients = clients.filter(function(c){ return c.plan === plan; });
  var table = document.getElementById('clientsTable');
  var countEl = document.getElementById('clientCountLabel');
  if(countEl){
    var total = getClients().length;
    countEl.textContent = (q||stage||plan) ? clients.length + ' de ' + total + ' cliente' + (total!==1?'s':'') : total + ' cliente' + (total!==1?'s':'');
  }
  if(!table) return;
  table.textContent = '';
  if(!clients.length){
    table.appendChild(createEmptyRow(q||stage||plan ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado ainda.'));
    return;
  }
  clients.forEach(function(c){ table.appendChild(createClientRow(c)); });
}

function renderPortfolioAssets(){
  var labels = ['Implantação','Em teste','Ativo','Risco'];
  var clients = getClients();
  var tagsEl = document.getElementById('portfolioTags');
  var breakdownEl = document.getElementById('portfolioBreakdown');
  if(tagsEl){
    tagsEl.textContent = '';
    labels.forEach(function(label){
      var chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = label;
      tagsEl.appendChild(chip);
    });
  }
  if(breakdownEl){
    breakdownEl.textContent = '';
    labels.forEach(function(label){
      var total = clients.filter(function(c){ return (c.stage || 'Implantação') === label; }).length;
      var row = document.createElement('div');
      row.className = 'metric-row';
      var left = document.createElement('span');
      left.textContent = label;
      var right = document.createElement('span');
      right.textContent = total+' cliente'+(total!==1?'s':'');
      row.appendChild(left);
      row.appendChild(right);
      breakdownEl.appendChild(row);
    });
  }
}

function renderResources(){
var resources = getResources();
var openCount = resources.filter(function(t){ return t.status==='open'; }).length;
  document.getElementById('openResourceCount').textContent = openCount + ' item' + (openCount!==1?'s':'') + ' em andamento';
  var list = document.getElementById('resourcesList');
  if(!list) return;
  list.textContent = '';
if(!resources.length){
    list.appendChild(createEmptyResource('Nenhum item pendente na central digital', false));
    return;
  }
resources.forEach(function(t){ list.appendChild(createResourceItem(t, true)); });
}

function renderRecentResources(){
var resources = getResources().filter(function(t){ return t.status==='open'; }).slice(0,3);
  var recent = document.getElementById('recentResources');
  if(!recent) return;
  recent.textContent = '';
if(!resources.length){
    recent.appendChild(createEmptyResource('Nenhum item pendente na central digital', true));
    return;
  }
resources.forEach(function(t){ recent.appendChild(createResourceItem(t, false)); });
}

function renderResourceGrid(){
var resources = getResources();
var open = resources.filter(function(t){ return t.status==='open'; }).length;
var closed = resources.filter(function(t){ return t.status==='closed'; }).length;
var totalTracked = open + closed;
var resourceHealth = totalTracked > 0 ? Math.round((closed/totalTracked)*100) : 0;
var resourceGrid = document.getElementById('resourceGrid');
if(!resourceGrid) return;
resourceGrid.textContent = '';
  [
    { value: totalTracked > 0 ? 'Digital' : '—', cls:'ok', label: totalTracked > 0 ? 'Operação guiada por recursos prontos' : 'Nenhum fluxo acompanhado ainda' },
    { value:String(open), cls:(open>2?'bad':open>0?'warn':'ok'), label:'Itens em andamento' },
{ value: totalTracked > 0 ? String(resourceHealth)+'%' : '—', cls:'ok', label:'Fluxos concluídos' }
  ].forEach(function(item){
    var card = document.createElement('div');
card.className = 'resource-card';
    var val = document.createElement('div');
val.className = 'resource-val ' + item.cls;
    val.textContent = item.value;
    var label = document.createElement('div');
label.className = 'resource-label';
    label.textContent = item.label;
    card.appendChild(val);
    card.appendChild(label);
resourceGrid.appendChild(card);
  });
}

function renderOnboarding(){
  var PARTNER_STEPS = [
    { key:'p1', title:'Conta no portal criada', desc:'Acesso ao painel de parceiro configurado com credenciais únicas.' },
    { key:'p2', title:'White-label configurado', desc:'Nome e cor da sua marca definidos e arquivo demo personalizado.' },
    { key:'p3', title:'Domínio próprio apontado', desc:'CNAME configurado e subdomínio ativo.' },
    { key:'p4', title:'Primeiro cliente adicionado', desc:'Cliente cadastrado com número oficial e plano definido.' },
    { key:'p5', title:'Kit de lançamento revisado', desc:'Mensagens de captação personalizadas para o seu nicho.' },
  ];
  var CLIENT_STEPS = [
    { key:'c1', title:'Registrar o número oficial do cliente', desc:'Salvar o número da empresa e preparar a ativação do canal.' },
    { key:'c2', title:'Cadastrar no painel', desc:'Adicionar na aba "Meus Clientes" com dados completos.' },
    { key:'c3', title:'Configurar bot com ativação guiada', desc:'Abrir o configurador guiado e preencher as etapas de onboarding.' },
    { key:'c4', title:'Testar 10 conversas', desc:'Simular cenários reais do negócio do cliente antes de ativar.' },
    { key:'c5', title:'Ativar e monitorar 7 dias', desc:'Acompanhar as primeiras semanas e ajustar a configuração quando necessário.' },
  ];
  var done = LS.get('mb_onboarding') || {};
  function renderList(steps, elId){
    var host = document.getElementById(elId);
    if(!host) return;
    host.textContent = '';
    steps.forEach(function(s){
      var d = done[s.key];
      var item = document.createElement('div');
      item.className = 'check-item' + (d ? ' done' : '');
      item.setAttribute('role','button');
      item.setAttribute('tabindex','0');
      item.setAttribute('aria-label','Alternar checklist: ' + s.title);
      item.addEventListener('click', function(){ toggleCheck(s.key); });
      item.addEventListener('keydown', function(event){ if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCheck(s.key);} });
      var box = document.createElement('div');
      box.className = 'check-box';
      box.textContent = d ? '✓' : '';
      var text = document.createElement('div');
      text.className = 'check-text';
      var title = document.createElement('div');
      title.className = 'check-title';
      title.textContent = s.title;
      var desc = document.createElement('div');
      desc.className = 'check-desc';
      desc.textContent = s.desc;
      text.appendChild(title);
      text.appendChild(desc);
      item.appendChild(box);
      item.appendChild(text);
      host.appendChild(item);
    });
  }
  renderList(PARTNER_STEPS, 'partnerChecklist');
  renderList(CLIENT_STEPS, 'clientChecklist');
}

function toggleCheck(key){
  var done = LS.get('mb_onboarding') || {};
  done[key] = !done[key];
  LS.set('mb_onboarding', done);
  renderOnboarding();
}

function resetChecklist(){
  LS.set('mb_onboarding', {});
  renderOnboarding();
  toast('Checklist reiniciado.');
}

// ── CRUD ─────────────────────────────────────────────────────────
var _editingClientId = null;

function openAddModal(){
  _editingClientId = null;
  document.getElementById('newName').value='';
  document.getElementById('newEmail').value='';
  document.getElementById('newKey').value='';
  document.getElementById('newSegment').value='';
  document.getElementById('newFaqUserId').value='';
  document.getElementById('newPlan').value='';
  document.getElementById('newStage').value='';
  document.getElementById('newStatus').value='';
  var notesEl = document.getElementById('newNotes');
  if(notesEl) notesEl.value='';
  var titleEl = document.getElementById('addClientOverlayTitle');
  var addBtn  = document.getElementById('addClientBtn');
  if(titleEl) titleEl.textContent = 'Quem é o cliente?';
  if(addBtn)  addBtn.textContent  = 'Adicionar cliente ✓';
  openModal('addClientOverlay');
}

function openEditClient(id){
  var c = getClients().find(function(x){ return x.id === id; });
  if(!c) return;
  _editingClientId = id;
  document.getElementById('newName').value    = c.name    || '';
  document.getElementById('newEmail').value   = c.email   || '';
  document.getElementById('newKey').value     = c.whatsappNumber ? formatOfficialNumber(c.whatsappNumber) : '';
  document.getElementById('newSegment').value = c.segment !== '—' ? (c.segment || '') : '';
  document.getElementById('newFaqUserId').value = c.faqUserId || '';
  document.getElementById('newPlan').value    = c.plan    || '';
  document.getElementById('newStage').value   = c.stage   || 'Implantação';
  document.getElementById('newStatus').value  = c.status  || 'trial';
  var notesEl = document.getElementById('newNotes');
  if(notesEl) notesEl.value = c.notes || '';
  // Sync visible plan radio cards
  document.querySelectorAll('[name="newPlanOpt"]').forEach(function(r){ r.checked = r.value === (c.plan||''); });
  document.querySelectorAll('.plan-opt-card').forEach(function(el){ el.classList.toggle('selected', el.dataset.val === (c.plan||'')); });
  var titleEl = document.getElementById('addClientOverlayTitle');
  var addBtn  = document.getElementById('addClientBtn');
  if(titleEl) titleEl.textContent = 'Editar cliente';
  if(addBtn)  addBtn.textContent  = 'Salvar alterações ✓';
  openModal('addClientOverlay');
}

function addClient(){
  var name = document.getElementById('newName').value.trim();
  var email = document.getElementById('newEmail').value.trim();
  var key = document.getElementById('newKey').value.trim();
  var segment = document.getElementById('newSegment').value.trim();
  var plan = document.getElementById('newPlan').value;
  var stage = document.getElementById('newStage').value;
  var status = document.getElementById('newStatus').value;
  var faqUserId = document.getElementById('newFaqUserId').value.trim();
  var notesEl = document.getElementById('newNotes');
  var notes = notesEl ? notesEl.value.trim() : '';
  if(!name){ toast('Informe o nome do cliente.'); return; }
  if(email && !isValidEmail(email)){ toast('Informe um e-mail válido para o cliente.'); return; }
  if(!key){ toast('Informe o número oficial da empresa.'); return; }
  if(!isValidOfficialNumber(key)){ toast('Informe um número oficial válido, com DDI e apenas números quando possível.'); return; }
  if(!plan){ toast('Selecione o plano do cliente antes de continuar.'); return; }
  if(!stage){ toast('Selecione a etapa atual da carteira.'); return; }
  if(!status){ toast('Selecione o status comercial do cliente.'); return; }
  var isEditing = !!_editingClientId;
  setButtonBusy('addClientBtn', true, isEditing ? 'Salvando...' : 'Adicionando...');
  try{
    var clients = getClients();
    var now = new Date().toISOString().slice(0,10);
    if(isEditing){
      clients = clients.map(function(c){
        if(c.id !== _editingClientId) return c;
        var updatedNotes = notes !== (c.notes||'') ? notes : (c.notes||'');
        return Object.assign({}, c, { name:name, email:email, whatsappNumber:normalizePhoneDigits(key), segment:segment||'—', plan:plan, stage:stage||c.stage||'Implantação', status:status, faqUserId:faqUserId||c.faqUserId||'', notes:updatedNotes, notesUpdatedAt: notes !== (c.notes||'') ? now : (c.notesUpdatedAt||'') });
      });
      _editingClientId = null;
    } else {
      clients.push({ id: Date.now(), name:name, email:email, whatsappNumber:normalizePhoneDigits(key), segment:segment||'—', plan:plan, stage:stage || 'Implantação', status:status, faqUserId:faqUserId||'', notes:notes, notesUpdatedAt: notes ? now : '', since:now });
    }
    LS.set('mb_partner_clients', clients);
    scheduleSync();
    closeModal('addClientOverlay');
    renderAll();
    toast(isEditing ? 'Cliente "'+name+'" atualizado.' : 'Cliente "'+name+'" adicionado com sucesso.');
  } finally {
    setButtonBusy('addClientBtn', false);
  }
}

function openQuickNote(id, anchorRow){
  // Remove any existing quick-note row
  var existing = document.getElementById('quickNoteRow');
  if(existing){ existing.remove(); if(existing._forId === id) return; }
  var c = getClients().find(function(x){ return x.id===id; });
  if(!c) return;
  var colCount = anchorRow ? anchorRow.cells.length : 6;
  var noteRow = document.createElement('tr');
  noteRow.id = 'quickNoteRow';
  noteRow._forId = id;
  noteRow.style.background = 'rgba(0,230,118,.04)';
  var td = document.createElement('td');
  td.colSpan = colCount;
  td.style.padding = '.75rem 1rem .75rem 1.2rem';
  var ta = document.createElement('textarea');
  ta.value = c.notes || '';
  ta.placeholder = 'Anotações sobre ' + c.name + '… (próximos passos, contexto, etc.)';
  ta.maxLength = 600;
  ta.rows = 3;
  ta.style.cssText = 'width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.86rem;padding:.55rem .75rem;resize:vertical;line-height:1.55;font-family:inherit';
  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:.5rem;margin-top:.5rem;align-items:center';
  var saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'action-btn';
  saveBtn.textContent = 'Salvar nota';
  saveBtn.style.cssText += ';background:var(--green);color:#080c09;font-weight:700';
  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'action-btn';
  cancelBtn.textContent = 'Cancelar';
  var countEl = document.createElement('span');
  countEl.style.cssText = 'font-size:.75rem;color:var(--muted);margin-left:auto';
  countEl.textContent = (c.notes||'').length + '/600';
  ta.addEventListener('input', function(){ countEl.textContent = ta.value.length + '/600'; });
  saveBtn.addEventListener('click', function(){
    var newNote = ta.value.trim();
    var clients = getClients().map(function(x){
      if(x.id !== id) return x;
      return Object.assign({}, x, { notes: newNote, notesUpdatedAt: new Date().toISOString().slice(0,10) });
    });
    LS.set('mb_partner_clients', clients);
    scheduleSync();
    noteRow.remove();
    renderAll();
    toast('Nota salva.');
  });
  cancelBtn.addEventListener('click', function(){ noteRow.remove(); });
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(countEl);
  td.appendChild(ta);
  td.appendChild(btnRow);
  noteRow.appendChild(td);
  if(anchorRow && anchorRow.parentNode) anchorRow.parentNode.insertBefore(noteRow, anchorRow.nextSibling);
  setTimeout(function(){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
}

function removeClient(id){
  showConfirm('Remover este cliente do painel? O bot não será afetado, apenas o cadastro.', function(){
    var clients = getClients().filter(function(c){ return c.id!==id; });
    LS.set('mb_partner_clients', clients);
    scheduleSync();
    renderAll();
    toast('Cliente removido.');
  }, 'Remover', 'Cancelar');
}

function openConfigClient(id){
  var c = getClients().find(function(x){ return x.id===id; });
  if(!c) return;
  // Copia link de ativação para o clipboard — o parceiro envia ao cliente via WhatsApp
  var activationUrl = 'https://mercabot.com.br/acesso';
  var msg = 'Olá, ' + c.name.split(' ')[0] + '! '
    + 'Aqui está o link para configurar seu atendimento automático no WhatsApp:\n'
    + activationUrl + '\n\n'
    + 'Acesse, salve o número oficial e preencha a base do atendimento. '
    + 'Estou acompanhando e posso ajudar em qualquer etapa.';
  navigator.clipboard.writeText(msg).then(function(){
    toast('✓ Link de ativação copiado para ' + c.name + '. Cole no WhatsApp e envie!');
  }).catch(function(){
    // fallback: abre WhatsApp diretamente se o cliente tem número cadastrado
    if(c.whatsappNumber){
      window.open('https://wa.me/' + c.whatsappNumber + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    } else {
      toast('Informe o número do cliente para enviar o link de ativação.');
    }
  });
}

function openClientFaqById(id){
  var client = getClients().find(function(x){ return x.id===id; });
  if(!client) return;
  if(client.faqUserId){
    window.open('/suporte/?user=' + encodeURIComponent(client.faqUserId), '_blank', 'noopener');
  } else {
    window.open('/suporte/', '_blank', 'noopener');
  }
}

function openResourceModal(){
  document.getElementById('tkSubject').value='';
  document.getElementById('tkPrio').value='';
  document.getElementById('tkDetail').value='';
  openModal('resourceOverlay');
}

function addResource(){
  var subject = document.getElementById('tkSubject').value.trim();
  var prio = document.getElementById('tkPrio').value;
  var detail = document.getElementById('tkDetail').value.trim();
  if(!subject){ toast('Informe o assunto do pedido.'); return; }
  if(!prio){ toast('Selecione a prioridade do pedido.'); return; }
  if(!detail){ toast('Descreva o cenário para abrir o recurso digital correto.'); return; }
  setButtonBusy('addPartnerResourceBtn', true, 'Abrindo...');
  try{
    var route = 'config';
    var context = (subject + ' ' + detail).toLowerCase();
    if(context.indexOf('dom')>=0 || context.indexOf('marca')>=0 || context.indexOf('white')>=0){
      route = 'whitelabel';
    } else if(context.indexOf('cliente')>=0 || context.indexOf('onboard')>=0 || context.indexOf('ativ')>=0){
      route = 'onboarding';
    } else if(context.indexOf('proposta')>=0 || context.indexOf('playbook')>=0 || context.indexOf('kit')>=0){
      route = 'whitelabel';
    }
    var resources = getResources();
    resources.unshift({ id: Date.now(), subject: subject, prio: prio, detail: detail, status:'open', date: new Date().toISOString().slice(0,10), client:'Operação parceira' });
    LS.set('mb_partner_resources', resources.slice(0,12));
    scheduleSync();
    closeModal('resourceOverlay');
    showPage(route);
    renderAll();
    toast('Recurso digital aberto com base no contexto informado.');
  } finally {
    setButtonBusy('addPartnerResourceBtn', false);
  }
}

// ── WHITE-LABEL ──────────────────────────────────────────────────
function updateWlPreview(){
  var brandRaw = document.getElementById('wlBrand').value.trim();
  var brand = brandRaw || 'Sua marca aqui';
  var color = document.getElementById('wlColor').value || '#00e676';
  var prev = document.getElementById('wlLogoPreview');
  prev.textContent = brand;
  prev.style.color = color;
  LS.set('mb_wl', { brand:brandRaw, color:color });
}

function downloadWhitelabel(){
  var brand = (document.getElementById('wlBrand').value || '').trim() || 'Minha Marca';
  var color = (document.getElementById('wlColor').value || '#00e676').trim();
  if(color.charAt(0) !== '#') color = '#' + color;

  // Compute RGB components for rgba() substitutions
  var hex = color.replace('#','');
  if(hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var rr = parseInt(hex.slice(0,2),16);
  var gg = parseInt(hex.slice(2,4),16);
  var bb = parseInt(hex.slice(4,6),16);
  var rgbPrefix = 'rgba('+rr+','+gg+','+bb+',';

  var btn = document.getElementById('downloadWhitelabelBtn');
  setButtonBusy('downloadWhitelabelBtn', true, 'Gerando…');

  fetch('/mercabot-demo.html')
    .then(function(r){ return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function(html){
      // Replace brand name (only visible text — URLs are left intact)
      html = html.split('MercaBot').join(brand);
      // Replace primary color hex and rgba equivalents
      html = html.split('#00e676').join(color);
      html = html.split('rgba(0,230,118,').join(rgbPrefix);
      // Strip SEO/canonical tags irrelevant to a white-label copy
      html = html.replace(/<link rel="canonical"[^>]*>\n?/g,'');
      html = html.replace(/<link rel="alternate"[^>]*>\n?/g,'');
      // Strip meta CSP tag (partner's host sets its own headers)
      html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/g,'');

      var slug = brand.replace(/\s+/g,'-').toLowerCase();
      var blob = new Blob([html], {type:'text/html'});
      var url  = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = slug + '-demo.html';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); document.body.removeChild(a); }, 1500);
      toast('✓ ' + slug + '-demo.html baixado! Faça deploy no Cloudflare Pages ou Netlify.');
    })
    .catch(function(){
      toast('Não foi possível gerar o arquivo. Tente novamente.');
    })
    .finally(function(){
      setButtonBusy('downloadWhitelabelBtn', false);
    });
}

function exportClientsCSV(){
  var clients = getClients();
  if(!clients.length){ toast('Sem clientes para exportar.'); return; }
  var headers = ['Nome','E-mail','WhatsApp','Segmento','Plano','Etapa','Status','Desde','MRR estimado'];
  var planMRR = { starter: 197, pro: 497, parceiro: 997 };
  var rows = [headers].concat(clients.map(function(c){
    return [
      c.name    || '',
      c.email   || '',
      c.whatsappNumber || '',
      c.segment || '',
      c.plan    || '',
      c.stage   || '',
      c.status  || '',
      c.since   || '',
      planMRR[String(c.plan||'').toLowerCase()] || ''
    ];
  }));
  var csv = rows.map(function(r){
    return r.map(function(v){ return '"' + String(v||'').replace(/"/g,'""') + '"'; }).join(',');
  }).join('\r\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'carteira-mercabot-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1200);
  toast('Carteira exportada — verifique seus downloads.');
}

function copyWlInstructions(){
  var brand = document.getElementById('wlBrand').value.trim() || 'sua marca';
  var color = document.getElementById('wlColor').value || '#00e676';
  var txt = 'White-label — Passos:\n1. Clique em "Baixar demo personalizado" para gerar o arquivo pronto com sua marca e cor\n2. Faça deploy no Cloudflare Pages ou Netlify (arraste a pasta ou conecte o repositório)\n3. Aponte seu domínio personalizado para o deploy via CNAME\n\nMarca: ' + brand + '\nCor principal: ' + color;
  copyTextBlock(txt, 'Instruções copiadas!');
}

function saveDomain(){
  var d = document.getElementById('wlDomain').value.trim();
  if(!d){ toast('Informe um domínio.'); return; }
  if(!isValidDomain(d)){ toast('Informe um domínio válido, como bot.suaempresa.com.br.'); return; }
  setButtonBusy('saveDomainBtn', true, 'Salvando...');
  try{
    LS.set('mb_wl_domain', d);
    scheduleSync();
    toast('Domínio "'+d+'" salvo. Configure o CNAME no seu DNS apontando para mercabot.com.br');
  } finally {
    setButtonBusy('saveDomainBtn', false);
  }
}

function copyTextBlock(text, successMsg){
  navigator.clipboard.writeText(text).then(function(){ toast(successMsg); }).catch(function(){
    toast('Não foi possível copiar automaticamente. Tente novamente.');
  });
}

function copyProposalTemplate(){
  var text = 'Proposta MercaBot Parceiro\\n\\nObjetivo: ativar atendimento com IA no WhatsApp oficial da empresa, com implantação guiada e operação simplificada.\\n\\nO que está incluído:\\n- Configuração guiada inicial\\n- Ajuste de linguagem e perguntas frequentes\\n- Ativação no número oficial da empresa\\n- Materiais digitais para implantação e acompanhamento\\n\\nPrazo sugerido:\\n- Kickoff em até 2 dias úteis\\n- Configuração inicial em até 7 dias após recebimento das informações\\n\\nInvestimento:\\n- Implantação: [preencher]\\n- Mensalidade: [preencher]\\n\\nPróximo passo:\\nResponder este documento com o aceite e seguir o onboarding digital.';
  copyTextBlock(text, 'Modelo de proposta copiado.');
}

function copyOnboardingScript(){
  var text = 'Roteiro de onboarding MercaBot\\n\\n1. Qual número oficial a empresa vai usar?\\n2. Qual o horário real de atendimento?\\n3. Quais serviços/produtos mais vendidos?\\n4. Quais dúvidas mais repetidas hoje no WhatsApp?\\n5. O que o bot pode resolver sozinho e o que deve virar retorno interno da equipe?\\n6. Qual tom de voz a empresa quer passar?\\n7. Quem aprova a configuração final antes da ativação?';
  copyTextBlock(text, 'Roteiro de onboarding copiado.');
}

function copyDeliveryChecklist(){
  var text = 'Checklist de entrega MercaBot\\n\\n[ ] Número oficial confirmado\\n[ ] Canal conectado\\n[ ] Horários revisados\\n[ ] Serviços e FAQs preenchidos\\n[ ] 10 testes reais executados\\n[ ] Respostas sensíveis revisadas\\n[ ] Fluxo de retorno interno definido\\n[ ] Cliente orientado sobre ajustes rápidos no painel\\n[ ] Go-live aprovado';
  copyTextBlock(text, 'Checklist de entrega copiado.');
}

function copyNichePlaybook(){
  var text = 'Playbook rápido por nicho\\n\\nClínicas: foco em agenda, convênio, preparo e confirmação.\\nVarejo: foco em preço, estoque, entrega e formas de pagamento.\\nServiços: foco em orçamento, prazo, área atendida e agendamento.\\nImobiliárias: foco em qualificação, faixa de preço, bairro e agendamento de visita.';
  copyTextBlock(text, 'Playbook por nicho copiado.');
}

function copyFollowupMessage(){
  var text = 'Follow-up comercial MercaBot\\n\\nOlá! Passei para retomar nossa conversa sobre a ativação do seu atendimento no WhatsApp. Se fizer sentido, eu te mostro o plano mais adequado e o que já deixamos pronto para você começar sem travar a operação.';
  copyTextBlock(text, 'Mensagem de follow-up copiada.');
}

function copyBillingMessage(){
  var text = 'Mensagem de cobrança MercaBot\\n\\nOlá! Sua renovação está em aberto. Assim que ela for concluída, a operação segue sem interrupção no painel e no número oficial da empresa. Se quiser, posso te reenviar o link de pagamento ou o resumo do plano ativo.';
  copyTextBlock(text, 'Mensagem de cobrança copiada.');
}

// ── HEALTH SCORE & PERFORMANCE PAGE ─────────────────────────────

function calculateHealthScore(c){
  var score = 0;
  // Status: up to 35 pts
  if(c.status === 'active') score += 35;
  else if(c.status === 'trial') score += 15;
  // Stage: up to 35 pts (Risco penalizes)
  var stage = c.stage || 'Implantação';
  if(stage === 'Ativo') score += 35;
  else if(stage === 'Em teste') score += 25;
  else if(stage === 'Implantação') score += 20;
  else if(stage === 'Risco') score -= 10;
  // WhatsApp configured: 30 pts
  if(c.whatsappNumber) score += 30;
  return Math.max(0, Math.min(100, score));
}

function healthColor(score){
  if(score >= 70) return 'var(--green)';
  if(score >= 40) return 'var(--amber)';
  return 'var(--red)';
}

function partnerTier(mrr, activeCount){
  if(activeCount === 0) return { icon:'🌱', title:'Começando a jornada', sub:'Adicione seu primeiro cliente ativo para subir de nível.' };
  if(mrr >= 10000) return { icon:'🏆', title:'Partner Elite', sub:'Carteira premium — top 10% dos parceiros MercaBot.' };
  if(mrr >= 5000)  return { icon:'🥇', title:'Partner Gold', sub:'Operação consolidada com alta receita recorrente.' };
  if(mrr >= 2000)  return { icon:'🥈', title:'Partner Silver', sub:'Crescimento acelerado — quase na elite.' };
  return { icon:'🥉', title:'Partner Bronze', sub:'Boa base — aumente a carteira para o próximo nível.' };
}

// ── Build WhatsApp URL with pre-filled retention message ──────────
function _riskWaUrl(c){
  var name = (c.name || 'cliente').split(' ')[0];
  var score = calculateHealthScore(c);
  var msg;
  if(score < 25){
    msg = 'Olá ' + name + ', tudo bem? Estou revisando a operação da sua conta e quero garantir que está tudo certo. Posso fazer uma ligação rápida com você esta semana para ajustar o que for preciso?';
  } else {
    msg = 'Oi ' + name + '! Passando para saber como está a experiência com o MercaBot. Se tiver alguma dúvida ou precisar de ajuste, é só me chamar — estou aqui 😊';
  }
  if(c.whatsappNumber){
    return 'https://wa.me/' + String(c.whatsappNumber).replace(/\D/g,'') + '?text=' + encodeURIComponent(msg);
  }
  return null;
}

function _buildRiskRow(c){
  var row = document.createElement('div');
  row.className = 'risk-client-row';
  var nameEl = document.createElement('div');
  nameEl.style.flex = '1';
  nameEl.innerHTML = '<strong>' + esc(c.name) + '</strong> <span style="color:var(--muted);font-size:.88rem">· ' + esc(c.stage || 'Implantação') + '</span>';
  var score = calculateHealthScore(c);
  var scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'font-size:.88rem;font-weight:700;color:' + healthColor(score) + ';flex-shrink:0';
  scoreEl.textContent = 'Health ' + score;
  row.appendChild(nameEl);
  row.appendChild(scoreEl);
  var waUrl = _riskWaUrl(c);
  if(waUrl){
    var waBtn = document.createElement('a');
    waBtn.href = waUrl;
    waBtn.target = '_blank';
    waBtn.rel = 'noopener';
    waBtn.title = 'Enviar mensagem de retenção para ' + esc(c.name);
    waBtn.style.cssText = 'flex-shrink:0;font-size:.78rem;padding:.22rem .6rem;border-radius:7px;background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.2);color:var(--green);text-decoration:none;white-space:nowrap;margin-left:.5rem';
    waBtn.textContent = '📩 Msg';
    row.appendChild(waBtn);
  }
  return row;
}

function renderDashRiskAlert(){
  var el = document.getElementById('dashRiskAlert');
  if(!el) return;
  el.textContent = '';
  var atRisk = getClients().filter(function(c){
    return (c.stage || '') === 'Risco' || calculateHealthScore(c) < 40;
  });
  if(!atRisk.length) return;
  var div = document.createElement('div');
  div.className = 'risk-alert';
  var title = document.createElement('div');
  title.className = 'risk-alert-title';
  title.innerHTML = '⚠️ ' + atRisk.length + ' cliente' + (atRisk.length !== 1 ? 's' : '') + ' em risco de churn';
  div.appendChild(title);
  atRisk.slice(0, 4).forEach(function(c){ div.appendChild(_buildRiskRow(c)); });
  if(atRisk.length > 4){
    var more = document.createElement('div');
    more.style.cssText = 'font-size:.88rem;color:var(--muted);padding-top:.55rem;text-align:center';
    more.textContent = '+ ' + (atRisk.length - 4) + ' mais — veja Performance para detalhes completos.';
    div.appendChild(more);
  }
  el.appendChild(div);
}

function renderPerformancePage(){
  var clients = getClients();
  var active   = clients.filter(function(c){ return c.status === 'active'; });
  var withWA   = clients.filter(function(c){ return !!c.whatsappNumber; });
  var atRisk   = clients.filter(function(c){ return (c.stage||'') === 'Risco' || calculateHealthScore(c) < 40; });
  var mrr      = active.reduce(function(a,c){ return a + (PLAN_PRICES_BRL[c.plan] || PLAN_PRICES_BRL.Starter); }, 0);
  var activationRate = clients.length > 0 ? Math.round((active.length  / clients.length) * 100) : 0;
  var avgHealth      = clients.length > 0 ? Math.round(clients.reduce(function(a,c){ return a + calculateHealthScore(c); }, 0) / clients.length) : 0;
  var churnRisk      = clients.length > 0 ? Math.round((atRisk.length  / clients.length) * 100) : 0;

  // ── At-risk alert
  var riskEl = document.getElementById('perfRiskAlert');
  if(riskEl){
    riskEl.textContent = '';
    if(atRisk.length){
      var alertDiv = document.createElement('div');
      alertDiv.className = 'risk-alert';
      var alertTitle = document.createElement('div');
      alertTitle.className = 'risk-alert-title';
      alertTitle.innerHTML = '⚠️ ' + atRisk.length + ' cliente' + (atRisk.length!==1?'s':'')+' em risco de churn';
      alertDiv.appendChild(alertTitle);
      atRisk.forEach(function(c){ alertDiv.appendChild(_buildRiskRow(c)); });
      riskEl.appendChild(alertDiv);
    }
  }

  // ── MRR goal tracker ──────────────────────────────────────────
  (function(){
    var goalCard   = document.getElementById('perfMrrGoalCard');
    var goalInput  = document.getElementById('perfMrrGoalInput');
    var goalSaveBtn= document.getElementById('perfMrrGoalSaveBtn');
    var goalStatus = document.getElementById('perfMrrGoalStatus');
    var goalBar    = document.getElementById('perfMrrGoalBar');
    var goalPct    = document.getElementById('perfMrrGoalPct');
    if(!goalCard) return;
    var savedGoal = parseInt(localStorage.getItem('mb_mrr_goal') || '0', 10) || 0;
    if(goalInput && !goalInput._initDone){
      goalInput._initDone = true;
      goalInput.value = savedGoal || '';
      goalSaveBtn.addEventListener('click', function(){
        var val = parseInt(goalInput.value, 10) || 0;
        localStorage.setItem('mb_mrr_goal', String(val));
        renderPerformancePage();
      });
      goalInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') goalSaveBtn.click(); });
    } else if(goalInput){
      goalInput.value = savedGoal || '';
    }
    goalCard.style.display = '';
    var pct = savedGoal > 0 ? Math.min(Math.round((mrr / savedGoal) * 100), 100) : 0;
    var barColor = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : '#e53935';
    if(goalBar){ goalBar.style.width = pct + '%'; goalBar.style.background = barColor; }
    if(goalPct) goalPct.textContent = savedGoal > 0 ? pct + '% da meta' : 'Defina uma meta de MRR acima';
    if(goalStatus){
      if(!savedGoal){
        goalStatus.textContent = 'MRR atual: R$' + mrr.toLocaleString('pt-BR');
      } else if(pct >= 100){
        goalStatus.textContent = '🎉 Meta atingida! MRR: R$' + mrr.toLocaleString('pt-BR');
        goalStatus.style.color = 'var(--green)';
      } else {
        var gap = savedGoal - mrr;
        goalStatus.textContent = 'R$' + mrr.toLocaleString('pt-BR') + ' de R$' + savedGoal.toLocaleString('pt-BR') + ' — faltam R$' + gap.toLocaleString('pt-BR');
        goalStatus.style.color = '';
      }
    }
  })();

  // ── MRR trend sparkline (built from client since dates) ──────
  (function(){
    var trendWrap  = document.getElementById('perfMrrTrend');
    var chartEl    = document.getElementById('perfMrrTrendChart');
    var labelsEl   = document.getElementById('perfMrrTrendLabels');
    var trendValEl = document.getElementById('perfMrrTrendVal');
    if(!trendWrap || !chartEl || !clients.length) return;
    // Build cumulative MRR by month for last 12 months
    var now = new Date();
    var months = [];
    for(var mi = 11; mi >= 0; mi--){
      var d = new Date(now.getFullYear(), now.getMonth() - mi, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), mrr: 0 });
    }
    clients.forEach(function(c){
      if(c.status !== 'active' || !c.since) return;
      var sinceDate = new Date(c.since);
      var cMrr = PLAN_PRICES_BRL[c.plan] || PLAN_PRICES_BRL.Starter;
      months.forEach(function(mo){
        var moDate = new Date(mo.y, mo.m, 1);
        if(sinceDate <= moDate) mo.mrr += cMrr;
      });
    });
    var maxMrr = Math.max.apply(null, months.map(function(m){ return m.mrr; })) || 1;
    var firstMrr = months[0].mrr || 0;
    var lastMrr  = months[months.length-1].mrr || 0;
    if(lastMrr === 0){ trendWrap.style.display = 'none'; return; }
    trendWrap.style.display = '';
    var growthPct = firstMrr > 0 ? Math.round(((lastMrr - firstMrr) / firstMrr) * 100) : 100;
    if(trendValEl) trendValEl.textContent = 'R$' + lastMrr.toLocaleString('pt-BR') + (growthPct > 0 ? ' ↑' + growthPct + '%' : '');
    chartEl.innerHTML = '';
    labelsEl.innerHTML = '';
    var ptMon = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    months.forEach(function(mo){
      var pct = maxMrr > 0 ? Math.max(Math.round((mo.mrr/maxMrr)*100), mo.mrr > 0 ? 8 : 0) : 0;
      var bar = document.createElement('div');
      bar.style.cssText = 'flex:1;background:' + (mo.key === months[months.length-1].key ? 'var(--green)' : 'rgba(0,230,118,.35)') + ';border-radius:4px 4px 0 0;height:' + pct + '%;transition:height .3s';
      bar.title = 'R$' + mo.mrr.toLocaleString('pt-BR') + ' — ' + ptMon[mo.m] + '/' + mo.y;
      chartEl.appendChild(bar);
      var lbl = document.createElement('div');
      lbl.style.cssText = 'flex:1;text-align:center;font-size:.62rem;color:var(--faint);overflow:hidden;white-space:nowrap';
      lbl.textContent = ptMon[mo.m];
      labelsEl.appendChild(lbl);
    });
  })();

  // ── Tier badge
  var rankEl = document.getElementById('perfRankBadge');
  if(rankEl){
    rankEl.textContent = '';
    var tier = partnerTier(mrr, active.length);
    var badge = document.createElement('div');
    badge.className = 'rank-badge';
    var icon = document.createElement('div');
    icon.className = 'rank-badge-icon';
    icon.textContent = tier.icon;
    var text = document.createElement('div');
    text.className = 'rank-badge-text';
    var t1 = document.createElement('div');
    t1.className = 'rank-badge-title';
    t1.textContent = tier.title;
    var t2 = document.createElement('div');
    t2.className = 'rank-badge-sub';
    t2.textContent = tier.sub;
    text.appendChild(t1);
    text.appendChild(t2);
    badge.appendChild(icon);
    badge.appendChild(text);
    rankEl.appendChild(badge);
  }

  // ── 4 KPI cards
  var kpiGrid = document.getElementById('perfKpiGrid');
  if(kpiGrid){
    kpiGrid.textContent = '';
    [
      { label:'MRR ativo', value:'R$'+mrr.toLocaleString('pt-BR'), sub:'Receita dos clientes com status Ativo',
        color: mrr > 0 ? 'var(--green)' : 'var(--text)' },
      { label:'Taxa de ativação', value:activationRate+'%', sub: active.length+' de '+clients.length+' clientes ativos',
        color: activationRate>=70?'var(--green)':activationRate>=40?'var(--amber)':'var(--red)' },
      { label:'Health médio', value:String(avgHealth), sub:'Score de saúde médio da carteira',
        color: healthColor(avgHealth) },
      { label:'Risco de churn', value:churnRisk+'%', sub: atRisk.length+' cliente'+(atRisk.length!==1?'s':'')+' em alerta',
        color: churnRisk>20?'var(--red)':churnRisk>0?'var(--amber)':'var(--green)' }
    ].forEach(function(item){
      var card = document.createElement('div');
      card.className = 'perf-kpi';
      var lbl = document.createElement('div');
      lbl.className = 'perf-kpi-label';
      lbl.textContent = item.label;
      var val = document.createElement('div');
      val.className = 'perf-kpi-val';
      val.style.color = item.color;
      val.textContent = item.value;
      var sub = document.createElement('div');
      sub.className = 'perf-kpi-sub';
      sub.textContent = item.sub;
      card.appendChild(lbl);
      card.appendChild(val);
      card.appendChild(sub);
      kpiGrid.appendChild(card);
    });
  }

  // ── Activation funnel
  var funnelEl = document.getElementById('perfFunnel');
  if(funnelEl){
    funnelEl.textContent = '';
    var total = clients.length;
    if(!total){
      var fempty = document.createElement('div');
      fempty.className = 'empty';
      fempty.style.padding = '1.5rem';
      fempty.innerHTML = '<div class="empty-icon">👥</div><div class="empty-title">Nenhum cliente adicionado ainda</div><div class="empty-sub">Adicione clientes para ver o funil de ativação.</div>';
      funnelEl.appendChild(fempty);
    } else {
      [
        { icon:'👥', label:'Cadastrados',         count:total,           pct:100 },
        { icon:'📱', label:'WhatsApp configurado', count:withWA.length,   pct:Math.round((withWA.length/total)*100) },
        { icon:'✅', label:'Ativos',               count:active.length,   pct:Math.round((active.length/total)*100) }
      ].forEach(function(step){
        var div = document.createElement('div');
        div.className = 'funnel-step';
        var ficon = document.createElement('div');
        ficon.className = 'funnel-icon';
        ficon.textContent = step.icon;
        var info = document.createElement('div');
        info.className = 'funnel-info';
        var flabel = document.createElement('div');
        flabel.className = 'funnel-label';
        flabel.textContent = step.label + ' (' + step.pct + '%)';
        var barbg = document.createElement('div');
        barbg.className = 'funnel-bar-bg';
        var barfill = document.createElement('div');
        barfill.className = 'funnel-bar-fill';
        barfill.style.width = step.pct + '%';
        barbg.appendChild(barfill);
        info.appendChild(flabel);
        info.appendChild(barbg);
        var num = document.createElement('div');
        num.className = 'funnel-num';
        num.style.color = step.pct>=70?'var(--green)':step.pct>=40?'var(--amber)':'var(--muted)';
        num.textContent = step.count;
        div.appendChild(ficon);
        div.appendChild(info);
        div.appendChild(num);
        funnelEl.appendChild(div);
      });
    }
  }

  // ── Health score per client (sorted lowest first = most critical on top)
  var healthListEl = document.getElementById('perfHealthList');
  if(healthListEl){
    healthListEl.textContent = '';
    if(!clients.length){
      var hempty = document.createElement('div');
      hempty.className = 'empty';
      hempty.style.padding = '1.5rem';
      hempty.innerHTML = '<div class="empty-icon">📊</div><div class="empty-title">Sem dados de saúde ainda</div>';
      healthListEl.appendChild(hempty);
    } else {
      var sorted = clients.slice().sort(function(a,b){ return calculateHealthScore(a) - calculateHealthScore(b); });
      sorted.forEach(function(c){
        var score = calculateHealthScore(c);
        var color = healthColor(score);
        var row = document.createElement('div');
        row.className = 'health-row';
        row.style.cursor = 'pointer';

        // Score breakdown for tooltip
        var pts = [];
        if(c.status === 'active') pts.push('Status ativo +35');
        else if(c.status === 'trial') pts.push('Status trial +15');
        else pts.push('Status inativo +0');
        var stage = c.stage || 'Implantação';
        if(stage === 'Ativo') pts.push('Etapa Ativo +35');
        else if(stage === 'Em teste') pts.push('Etapa Em teste +25');
        else if(stage === 'Implantação') pts.push('Etapa Implantação +20');
        else if(stage === 'Risco') pts.push('Etapa Risco −10');
        else pts.push('Etapa ' + stage + ' +0');
        if(c.whatsappNumber) pts.push('WhatsApp conectado +30');
        else pts.push('WhatsApp não configurado +0');

        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:.92rem;font-weight:600;margin-bottom:.2rem;display:flex;align-items:center;gap:.5rem';
        var nameLbl = document.createElement('span');
        nameLbl.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0';
        nameLbl.textContent = c.name;
        var stagePill = document.createElement('span');
        stagePill.style.cssText = 'flex-shrink:0;font-size:.7rem;padding:.1rem .45rem;border-radius:6px;background:' + (stage === 'Risco' ? 'rgba(239,68,68,.12)' : stage === 'Ativo' ? 'rgba(0,230,118,.1)' : 'rgba(245,158,11,.1)') + ';color:' + (stage === 'Risco' ? '#fca5a5' : stage === 'Ativo' ? 'var(--green)' : '#f59e0b') + ';font-weight:700';
        stagePill.textContent = stage;
        nameDiv.appendChild(nameLbl);
        nameDiv.appendChild(stagePill);

        var barWrap = document.createElement('div');
        barWrap.className = 'health-bar-wrap';
        var barBg = document.createElement('div');
        barBg.className = 'health-bar-bg';
        var barFill = document.createElement('div');
        barFill.className = 'health-bar-fill';
        barFill.style.width = score + '%';
        barFill.style.background = color;
        barFill.style.transition = 'width .4s';
        barBg.appendChild(barFill);
        var numEl = document.createElement('div');
        numEl.className = 'health-num';
        numEl.style.color = color;
        numEl.textContent = score;
        barWrap.appendChild(barBg);
        barWrap.appendChild(numEl);

        // Expandable detail
        var detail = document.createElement('div');
        detail.style.cssText = 'display:none;margin-top:.55rem;font-size:.8rem;color:var(--muted);line-height:1.7;border-top:1px solid var(--border);padding-top:.45rem';
        detail.innerHTML = pts.map(function(p){ return '<span style="margin-right:1rem">· ' + p + '</span>'; }).join('') +
          '<br><span style="color:var(--faint)">Clique na etapa para editar</span>';
        // Stage quick-edit buttons
        var stageRow = document.createElement('div');
        stageRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.45rem';
        ['Implantação','Em teste','Ativo','Risco'].forEach(function(s){
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = s;
          btn.style.cssText = 'font-size:.75rem;padding:.18rem .55rem;border-radius:6px;cursor:pointer;font-family:inherit;' +
            (s === stage ? 'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green);font-weight:700' : 'background:var(--bg3);border:1px solid var(--border);color:var(--muted)');
          btn.addEventListener('click', function(e){
            e.stopPropagation();
            c.stage = s;
            var clients2 = getClients();
            clients2.forEach(function(cl){ if(cl.id === c.id) cl.stage = s; });
            LS.set('mb_partner_clients', clients2);
            scheduleSync();
            renderPerformancePage();
            toast('Etapa de ' + esc(c.name) + ' atualizada para ' + s);
          });
          stageRow.appendChild(btn);
        });
        detail.appendChild(stageRow);

        var expanded = false;
        row.addEventListener('click', function(){
          expanded = !expanded;
          detail.style.display = expanded ? '' : 'none';
        });

        row.appendChild(nameDiv);
        row.appendChild(barWrap);
        row.appendChild(detail);
        healthListEl.appendChild(row);
      });
    }
  }
}

// ── CONFIG ───────────────────────────────────────────────────────
function loadConfig(){
  var cfg = LS.get('mb_partner_config') || {};
  document.getElementById('cfgCompany').value = cfg.company || '';
  document.getElementById('cfgEmail').value = cfg.email || '';
  document.getElementById('cfgWhats').value = formatOfficialNumber(cfg.whats || '');
  var wl = LS.get('mb_wl') || {};
  document.getElementById('wlBrand').value = wl.brand || '';
  document.getElementById('wlColor').value = wl.color || '#00e676';
  updateWlPreview();
  var domain = LS.get('mb_wl_domain');
  if(domain) document.getElementById('wlDomain').value = domain;
  updatePartnerSaveState();
}

function getPartnerConfigDraft(){
  return {
    company: document.getElementById('cfgCompany').value.trim(),
    email: document.getElementById('cfgEmail').value.trim(),
    whats: normalizePhoneDigits(document.getElementById('cfgWhats').value.trim())
  };
}

function getSavedPartnerConfigDraft(){
  var cfg = LS.get('mb_partner_config') || {};
  return {
    company: (cfg.company || '').trim(),
    email: (cfg.email || '').trim(),
    whats: normalizePhoneDigits(cfg.whats || '')
  };
}

function updatePartnerSaveState(){
  var btn = document.getElementById('savePartnerConfigBtn');
  if(!btn) return;
  btn.disabled = JSON.stringify(getPartnerConfigDraft()) === JSON.stringify(getSavedPartnerConfigDraft());
}

function saveConfig(){
  var cfg = getPartnerConfigDraft();
  if(!cfg.company){ toast('Informe o nome da empresa parceira.'); return; }
  if(cfg.email && !isValidEmail(cfg.email)){ toast('Informe um e-mail de contato válido.'); return; }
  if(cfg.whats && !isValidOfficialNumber(cfg.whats)){ toast('Informe um número oficial válido, com DDI e apenas números quando possível.'); return; }
  setButtonBusy('savePartnerConfigBtn', true, 'Salvando...');
  try{
    LS.set('mb_partner_config', cfg);
    scheduleSync();
    updatePartnerSaveState();
    toast('Configurações salvas com sucesso!');
  } finally {
    setButtonBusy('savePartnerConfigBtn', false);
  }
}

// ── MODAL HELPERS ─────────────────────────────────────────────────
function openModal(id){
  var overlay = document.getElementById(id);
  if(!overlay) return;
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
  var firstField = overlay.querySelector('input, textarea, select, button');
  if(firstField && typeof firstField.focus === 'function'){
    setTimeout(function(){ firstField.focus(); }, 20);
  }
}
function closeModal(id){
  var overlay = document.getElementById(id);
  if(!overlay) return;
  overlay.classList.remove('open');
  if(!document.querySelector('.overlay.open')){
    document.body.classList.remove('modal-open');
  }
}

// ── CUSTOM CONFIRM ───────────────────────────────────────────────
var _confirmCallback = null;
function showConfirm(message, onConfirm, confirmLabel, cancelLabel){
  var msgEl = document.getElementById('confirmOverlayMsg');
  var okBtn = document.getElementById('confirmOkBtn');
  var cancelBtn = document.getElementById('confirmCancelBtn');
  if(msgEl) msgEl.textContent = message;
  if(okBtn) okBtn.textContent = confirmLabel || 'Confirmar';
  if(cancelBtn) cancelBtn.textContent = cancelLabel || 'Cancelar';
  _confirmCallback = onConfirm || null;
  openModal('confirmOverlay');
}
(function(){
  var okBtn = document.getElementById('confirmOkBtn');
  var cancelBtn = document.getElementById('confirmCancelBtn');
  if(okBtn) okBtn.addEventListener('click', function(){
    closeModal('confirmOverlay');
    if(typeof _confirmCallback === 'function'){ var cb = _confirmCallback; _confirmCallback = null; cb(); }
  });
  if(cancelBtn) cancelBtn.addEventListener('click', function(){
    _confirmCallback = null;
    closeModal('confirmOverlay');
  });
}());

document.querySelectorAll('.overlay').forEach(function(o){
  o.addEventListener('click', function(e){ if(e.target===o) closeModal(o.id); });
});
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var activeOverlay = document.querySelector('.overlay.open');
  if(activeOverlay) closeModal(activeOverlay.id);
});

// ── TOAST ─────────────────────────────────────────────────────────
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function(){ t.classList.remove('show'); }, 3200);
}

function bindPartnerPanelActions(){
  function bindClick(id, handler){
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', handler);
  }

  bindClick('reloadPartnerAuthBtn', function(){
    window.location.href = '/cdn-cgi/access/login?redirect_url=' + encodeURIComponent(window.location.pathname);
  });
  bindClick('partnerLogoutBtn', doLogout);
  document.querySelectorAll('.nav-item[data-page]').forEach(function(btn){
    btn.addEventListener('click', function(){ showPage(btn.getAttribute('data-page')); });
  });
  bindClick('dashboardAddClientBtn', function(){ showPage('clientes'); openAddModal(); });
  bindClick('viewAllClientsBtn', function(){ showPage('clientes'); });
  bindClick('exportClientsBtn', exportClientsCSV);
  document.querySelectorAll('.copy-followup-btn').forEach(function(btn){ btn.addEventListener('click', copyFollowupMessage); });
  document.querySelectorAll('.copy-billing-btn').forEach(function(btn){ btn.addEventListener('click', copyBillingMessage); });
  bindClick('clientsAddClientBtn', openAddModal);
  var clientSearch = document.getElementById('clientSearch');
  if(clientSearch) clientSearch.addEventListener('input', function(){ filterClients(this.value); });
  var stageFilter = document.getElementById('clientStageFilter');
  if(stageFilter) stageFilter.addEventListener('change', function(){ filterClients(clientSearch ? clientSearch.value : ''); });
  var planFilter = document.getElementById('clientPlanFilter');
  if(planFilter) planFilter.addEventListener('change', function(){ filterClients(clientSearch ? clientSearch.value : ''); });
  ['wlBrand','wlColor'].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('input', updateWlPreview);
    el.addEventListener('input', scheduleSync);
  });
  ['cfgCompany','cfgEmail','cfgWhats'].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('input', function(){
      if(id === 'cfgWhats') el.value = formatOfficialNumber(el.value);
      updatePartnerSaveState();
    });
    el.addEventListener('change', updatePartnerSaveState);
  });
  bindClick('downloadWhitelabelBtn', downloadWhitelabel);
  bindClick('copyWlInstructionsBtn', copyWlInstructions);
  bindClick('saveDomainBtn', saveDomain);
  document.querySelectorAll('.copy-proposal-btn').forEach(function(btn){ btn.addEventListener('click', copyProposalTemplate); });
  document.querySelectorAll('.copy-onboarding-btn').forEach(function(btn){ btn.addEventListener('click', copyOnboardingScript); });
  document.querySelectorAll('.copy-delivery-btn').forEach(function(btn){ btn.addEventListener('click', copyDeliveryChecklist); });
  document.querySelectorAll('.copy-playbook-btn').forEach(function(btn){ btn.addEventListener('click', copyNichePlaybook); });
  bindClick('openPartnerResourceModalBtn', openResourceModal);
  bindClick('resetChecklistBtn', resetChecklist);
  bindClick('savePartnerConfigBtn', saveConfig);
  bindClick('closeAddClientOverlayBtn', function(){ closeModal('addClientOverlay'); });
  (function(){
    var newKeyEl = document.getElementById('newKey');
    if(newKeyEl) newKeyEl.addEventListener('input', function(){ newKeyEl.value = formatOfficialNumber(newKeyEl.value); });
  }());
  bindClick('addClientBtn', addClient);
  bindClick('closePartnerResourceOverlayBtn', function(){ closeModal('resourceOverlay'); });
  bindClick('addPartnerResourceBtn', addResource);
}

bindPartnerPanelActions();
updatePartnerBreadcrumb(getStoredPartnerPage());