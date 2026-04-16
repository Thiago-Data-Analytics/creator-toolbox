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

// ── BACKEND SYNC ─────────────────────────────────────────────────
var _PARTNER_API = (window.__mbConfig || {}).API_BASE_URL || 'https://api.mercabot.com.br';
var _syncTimer = null;

function _getCFToken(){
  var m = document.cookie.match(/CF_Authorization=([^;]+)/);
  return m ? m[1].trim() : null;
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
  fetch(_PARTNER_API + '/partner/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(_collectAllData())
  }).catch(function(){});
}

function _pullFromBackend(onDone){
  var token = _getCFToken();
  if(!token){ onDone && onDone(); return; }
  fetch(_PARTNER_API + '/partner/sync', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(data){
    if(!data || !data.ok){ onDone && onDone(); return; }
    if(Array.isArray(data.clients))  LS.set('mb_partner_clients',  data.clients);
    if(Array.isArray(data.resources)) LS.set('mb_partner_resources', data.resources);
    if(data.config){
      if(data.config.partner    && typeof data.config.partner    === 'object') LS.set('mb_partner_config', data.config.partner);
      if(data.config.whitelabel && typeof data.config.whitelabel === 'object') LS.set('mb_wl',             data.config.whitelabel);
      if(data.config.domain)                                                    LS.set('mb_wl_domain',      data.config.domain);
    }
    onDone && onDone();
  })
  .catch(function(){ onDone && onDone(); });
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
  // Carrega dados do backend primeiro (fallback silencioso para localStorage)
  _pullFromBackend(function(){
    renderAll();
    showPage(getStoredPartnerPage());
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
  return ['dashboard','clientes','whitelabel','resources','onboarding','config'];
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
  renderClientsTable();
  renderRecentClients();
  renderResources();
  renderRecentResources();
  renderResourceGrid();
  renderPortfolioAssets();
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
    { label:'Configurar', cls:'action-btn', fn:function(){ openConfigClient(c.id); } },
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
                   .reduce(function(a,c){ return a + (c.plan==='Pro'?497:c.plan==='Parceiro'?1297:197); },0);
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

function renderClientsTable(){
  var clients = getClients();
  document.getElementById('clientCountLabel').textContent = clients.length + ' cliente' + (clients.length!==1?'s':'');
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
  var clients = getClients();
  if(q) clients = clients.filter(function(c){ return c.name.toLowerCase().indexOf(q.toLowerCase())>=0 || c.segment.toLowerCase().indexOf(q.toLowerCase())>=0; });
  var table = document.getElementById('clientsTable');
  if(!table) return;
  table.textContent = '';
  if(!clients.length){
    table.appendChild(createEmptyRow('Nenhum resultado encontrado.'));
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
function openAddModal(){
  document.getElementById('newName').value='';
  document.getElementById('newEmail').value='';
  document.getElementById('newKey').value='';
  document.getElementById('newSegment').value='';
  document.getElementById('newFaqUserId').value='';
  document.getElementById('newPlan').value='';
  document.getElementById('newStage').value='';
  document.getElementById('newStatus').value='';
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
  if(!name){ toast('Informe o nome do cliente.'); return; }
  if(email && !isValidEmail(email)){ toast('Informe um e-mail válido para o cliente.'); return; }
  if(!key){ toast('Informe o número oficial da empresa.'); return; }
  if(!isValidOfficialNumber(key)){ toast('Informe um número oficial válido, com DDI e apenas números quando possível.'); return; }
  if(!plan){ toast('Selecione o plano do cliente antes de continuar.'); return; }
  if(!stage){ toast('Selecione a etapa atual da carteira.'); return; }
  if(!status){ toast('Selecione o status comercial do cliente.'); return; }
  setButtonBusy('addClientBtn', true, 'Adicionando...');
  try{
    var clients = getClients();
    clients.push({ id: Date.now(), name:name, email:email, whatsappNumber:normalizePhoneDigits(key), segment:segment||'—', plan:plan, stage:stage || 'Implantação', status:status, faqUserId:faqUserId||'', since:new Date().toISOString().slice(0,10) });
    LS.set('mb_partner_clients', clients);
    scheduleSync();
    closeModal('addClientOverlay');
    renderAll();
    toast('Cliente "'+name+'" adicionado com sucesso.');
  } finally {
    setButtonBusy('addClientBtn', false);
  }
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
  var url = '/demo/?source=parceiro&client=' + encodeURIComponent(c.name);
  if(c.whatsappNumber) url += '&num=' + encodeURIComponent(c.whatsappNumber);
  window.open(url, '_blank', 'noopener');
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
    resources.unshift({ id: Date.now(), subject: subject, prio: prio, status:'open', date: new Date().toISOString().slice(0,10), client:'Operação parceira' });
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
  var brand = document.getElementById('wlBrand').value.trim() || 'sua-marca';
  var color = document.getElementById('wlColor').value || '#00e676';
  toast('Para criar o white-label: abra mercabot-demo.html, substitua "MercaBot" por "'+brand+'" e "#00e676" por "'+color+'" com Ctrl+H no editor de texto. Salve como '+brand.replace(/\s+/g,'-').toLowerCase()+'-demo.html');
}

function copyWlInstructions(){
  var brand = document.getElementById('wlBrand').value.trim() || 'sua marca';
  var color = document.getElementById('wlColor').value || '#00e676';
  var txt = 'White-label MercaBot — Instruções:\n1. Abra mercabot-demo.html num editor de texto\n2. Substitua todas as ocorrências de "MercaBot" por "'+brand+'"\n3. Substitua "#00e676" por "'+color+'"\n4. Salve e faça deploy no Cloudflare Pages ou Netlify\n5. Aponte seu domínio personalizado';
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
  document.querySelectorAll('.copy-followup-btn').forEach(function(btn){ btn.addEventListener('click', copyFollowupMessage); });
  document.querySelectorAll('.copy-billing-btn').forEach(function(btn){ btn.addEventListener('click', copyBillingMessage); });
  bindClick('clientsAddClientBtn', openAddModal);
  var clientSearch = document.getElementById('clientSearch');
  if(clientSearch) clientSearch.addEventListener('input', function(){ filterClients(this.value); });
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