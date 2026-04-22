var SUPABASE_URL = (window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
var SUPABASE_PUBLISHABLE_KEY = (window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
// supabaseClient is null until the CDN finishes loading.
// Async bootstrap (below) sets it via waitForSupabaseClient().
var supabaseClient = null;

var state = {
  plan: '',
  botOn: false,
  settings: { tgHorario:false, tgLeads:false, tgFollowup:false, tgHuman:false },
  convs: 0,
  leads: 0,
  activatedDate: new Date().toISOString().slice(0,10),
  waNumber: '',
  company: '',
  email: '',
  workspace: {},
    summary: null,
    billingHistory: [],
    billingStatusLabel: 'Configuração em andamento',
    checkoutReadiness: {
      pt: { ready:false, currency:'BRL', note:'Aguardando validação do checkout em reais.', missing:[] },
      es: { ready:false, currency:'USD', note:'Aguardando validação do checkout em espanhol.', missing:[] },
      branding: { ready:false, note:'Revise no painel Stripe a marca exibida no checkout.' }
    },
  conversationLimit: 0,
  channelsConnected: 0,
  featureUsageEnabled: 0,
  featureUsageTotal: 0,
  billingPortalAvailable: false,
  billingPortalReason: '',
  customerStatus: 'active',
  upgrade: { shouldUpgrade:false, targetPlan:'', title:'Seu plano atual está adequado.', reason:'Quando o uso ou a configuração da operação pedirem mais estrutura, a MercaBot mostra a recomendação certa.' },
  // Cota de mensagens IA
  aiMsgsUsed: 0,
  aiMsgsLimit: 1000,
  aiMsgsPct: 0,
  aiMsgsResetAt: null,
};
var currentUser = null;
var currentCustomer = null;
var currentSettings = null;
var _API = (window.__mbConfig||{}).API_BASE_URL||'https://api.mercabot.com.br';
var WHATSAPP_CHANNEL_SAVE_URL = _API + '/whatsapp/salvar-canal';
var WHATSAPP_CHANNEL_SELF_TEST_URL = _API + '/whatsapp/autoteste';
var EMBEDDED_SIGNUP_URL = _API + '/whatsapp/embedded-signup';
// Meta App ID público — Embedded Signup (WhatsApp Business)
// Documentação: developers.facebook.com/docs/whatsapp/embedded-signup
var META_APP_ID = '944330984843885';
var META_CONFIG_ID = '1310522417846062';
var BILLING_PORTAL_URL = _API + '/billing/portal';
var ACCOUNT_SUMMARY_URL = _API + '/account/summary';
var ADDON_CHECKOUT_URL  = _API + '/criar-checkout-addon';
var ACCOUNT_SETTINGS_URL = _API + '/account/settings';
var ACCOUNT_WORKSPACE_URL = _API + '/account/workspace';
function buildEmptyUpgrade(){
  return {
    shouldUpgrade:false,
    targetPlan:'',
    title:'Seu plano atual está adequado.',
    reason:'Quando o uso ou a configuração da operação pedirem mais estrutura, a MercaBot mostra a recomendação certa.'
  };
}

var authLoadNonce = 0;
var authBootstrapDone = false;
// auth handoff via URL hash removed — session persisted by Supabase client internally

function resetClientState(){
  state.plan = '';
  state.botOn = false;
  state.settings = { tgHorario:false, tgLeads:false, tgFollowup:false, tgHuman:false };
  state.convs = 0;
  state.leads = 0;
  state.activatedDate = new Date().toISOString().slice(0,10);
  state.waNumber = '';
  state.company = '';
  state.email = '';
  state.workspace = {};
  state.summary = null;
  state.billingHistory = [];
  state.billingStatusLabel = 'Aguardando carregamento';
  state.checkoutReadiness = {
    pt: { ready:false, currency:'BRL', note:'', missing:[] },
    es: { ready:false, currency:'USD', note:'', missing:[] },
    branding: { ready:false, note:'' }
  };
  state.conversationLimit = 0;
  state.channelsConnected = 0;
  state.featureUsageEnabled = 0;
  state.featureUsageTotal = 0;
  state.billingPortalAvailable = false;
  state.billingPortalReason = '';
  state.upgrade = buildEmptyUpgrade();
  state.channelProvider = 'meta';
  state.channelPhoneNumberId = '';
  state.channelTokenMasked = '';
  state.channelVerifiedName = '';
  state.channelConnected = false;
  state.channelPending = false;
  currentUser = null;
  currentCustomer = null;
  currentSettings = null;
  document.getElementById('planBadge').textContent = 'Plano';
  document.getElementById('planBadge').className = 'plan-badge';
  document.getElementById('greetingName').textContent = 'Olá!';
  document.getElementById('planNameBig').textContent = 'Plano atual';
  document.getElementById('planPriceSmall').textContent = 'Carregando assinatura...';
  var planNameBigSecondary = document.getElementById('planNameBigSecondary');
  var planPriceSmallSecondary = document.getElementById('planPriceSmallSecondary');
  if(planNameBigSecondary) planNameBigSecondary.textContent = 'Plano atual';
  if(planPriceSmallSecondary) planPriceSmallSecondary.textContent = 'Carregando assinatura...';
}

function setTopbarAuthState(isAuthenticated){
  var badge = document.getElementById('planBadge');
  var greeting = document.getElementById('greetingName');
  var logoutBtn = document.getElementById('logoutBtn');
  if(badge) badge.classList.toggle('hidden', !isAuthenticated);
  if(greeting) greeting.classList.toggle('hidden', !isAuthenticated);
  if(logoutBtn) logoutBtn.classList.toggle('hidden', !isAuthenticated);
}

function showBoot(message){
  document.getElementById('authShell').classList.remove('hidden');
  document.getElementById('appWrap').classList.add('hidden');
  setTopbarAuthState(false);
  document.getElementById('authSessionActions').classList.remove('show');
  document.getElementById('authEmail').closest('.form-group').classList.add('hidden');
  document.getElementById('authBtn').classList.add('hidden');
  var status = document.getElementById('authStatus');
  status.className = 'auth-status show';
  status.textContent = message || 'Verificando seu acesso...';
}
// ── Circuit breaker ───────────────────────────────────────────────────────────
// After FAILURE_THRESHOLD consecutive API failures the circuit OPENS for
// OPEN_DURATION_MS, returning an instant error instead of burning retries.
// After the cool-down one probe request is allowed through (HALF_OPEN).
// Any success resets the counter and closes the circuit.
var _apiCircuit = (function(){
  var FAILURE_THRESHOLD = 3;
  var OPEN_DURATION_MS  = 30000; // 30 s
  var state    = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  var failures = 0;
  var openUntil = 0;
  return {
    isAllowed: function(){
      if(state === 'CLOSED') return true;
      if(state === 'OPEN'){
        if(Date.now() >= openUntil){ state = 'HALF_OPEN'; return true; }
        return false;
      }
      return true; // HALF_OPEN: allow the probe through
    },
    recordSuccess: function(){
      failures = 0;
      state = 'CLOSED';
    },
    recordFailure: function(){
      failures++;
      if(failures >= FAILURE_THRESHOLD){
        state = 'OPEN';
        openUntil = Date.now() + OPEN_DURATION_MS;
        if(window.__mb_report_error) window.__mb_report_error(
          new Error('API circuit breaker opened after ' + failures + ' consecutive failures'),
          { fn: '_apiCircuit', state: state }
        );
      }
    },
    openResponse: function(){
      var secs = Math.ceil(Math.max(0, openUntil - Date.now()) / 1000);
      return { ok: false, status: 503, body: { error: 'Serviço temporariamente indisponível. Tente novamente em ' + secs + 's.' }, circuitOpen: true };
    }
  };
})();

async function fetchAuthorizedJson(url, jwt, timeoutMs, maxRetries){
  if(!_apiCircuit.isAllowed()) return _apiCircuit.openResponse();
  var retries = (typeof maxRetries === 'number') ? maxRetries : 2;
  var backoff = 600;
  for(var attempt = 0; attempt <= retries; attempt++){
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, timeoutMs || 3500) : null;
    try{
      var res = await fetch(url, {
        method:'GET',
        headers:{ 'Authorization':'Bearer ' + jwt },
        signal: controller ? controller.signal : undefined
      });
      if(timeoutId) clearTimeout(timeoutId);
      var body = await res.json().catch(function(){ return {}; });
      // 4xx = client error, don't retry; 2xx/3xx = success
      if(res.ok || (res.status >= 400 && res.status < 500)){
        _apiCircuit.recordSuccess();
        return { ok: res.ok, status: res.status, body: body || {} };
      }
      // 5xx — retry with backoff
      if(attempt < retries){
        await new Promise(function(r){ setTimeout(r, backoff); });
        backoff *= 2;
        continue;
      }
      _apiCircuit.recordFailure();
      return { ok: false, status: res.status, body: body || {} };
    }catch(_){
      if(timeoutId) clearTimeout(timeoutId);
      if(attempt < retries){
        await new Promise(function(r){ setTimeout(r, backoff); });
        backoff *= 2;
        continue;
      }
      _apiCircuit.recordFailure();
      return { ok: false, status: 0, body: {} };
    }
  }
  return { ok: false, status: 0, body: {} };
}
async function postAuthorizedJson(url, jwt, payload, timeoutMs, maxRetries){
  if(!_apiCircuit.isAllowed()) return _apiCircuit.openResponse();
  var retries = (typeof maxRetries === 'number') ? maxRetries : 2;
  var backoff = 600;
  for(var attempt = 0; attempt <= retries; attempt++){
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, timeoutMs || 5000) : null;
    try{
      var res = await fetch(url, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer ' + jwt
        },
        body: JSON.stringify(payload || {}),
        signal: controller ? controller.signal : undefined
      });
      if(timeoutId) clearTimeout(timeoutId);
      var body = await res.json().catch(function(){ return {}; });
      // 4xx = client error, don't retry; 2xx = success
      if(res.ok || (res.status >= 400 && res.status < 500)){
        _apiCircuit.recordSuccess();
        return { ok: res.ok, status: res.status, body: body || {} };
      }
      // 5xx — retry with backoff
      if(attempt < retries){
        await new Promise(function(r){ setTimeout(r, backoff); });
        backoff *= 2;
        continue;
      }
      _apiCircuit.recordFailure();
      return { ok: false, status: res.status, body: body || {} };
    }catch(err){
      if(timeoutId) clearTimeout(timeoutId);
      if(window.__mb_report_error) window.__mb_report_error(err, { fn: 'postAuthorizedJson', url: url, attempt: attempt });
      if(attempt < retries){
        await new Promise(function(r){ setTimeout(r, backoff); });
        backoff *= 2;
        continue;
      }
      _apiCircuit.recordFailure();
      if(err && err.name === 'AbortError'){
        return { ok: false, status: 504, body: { error: 'A operação demorou mais do que o esperado. Tente novamente.' } };
      }
      return { ok: false, status: 0, body: { error: 'Falha ao comunicar com o painel agora.' } };
    }
  }
  return { ok: false, status: 0, body: {} };
}
function applySettingsPayload(payload){
  if(!payload || typeof payload !== 'object') return;
  state.settings = {
    tgHorario: !!payload.business_hours_enabled,
    tgLeads: !!payload.lead_qualification_enabled,
    tgFollowup: !!payload.followup_enabled,
    tgHuman: !!payload.human_handoff_enabled
  };
  if(typeof payload.bot_enabled === 'boolean'){
    state.botOn = !!payload.bot_enabled;
  }
  currentSettings = Object.assign({}, currentSettings || {}, payload);
}
async function hydratePanelFragments(jwt){
  var tasks = await Promise.allSettled([
    fetchAuthorizedJson(ACCOUNT_SETTINGS_URL, jwt, 3000),
    fetchAuthorizedJson(ACCOUNT_WORKSPACE_URL, jwt, 3000),
    fetchAuthorizedJson(BILLING_PORTAL_URL, jwt, 3000)
  ]);
  var settingsResult = tasks[0].status === 'fulfilled' ? tasks[0].value : null;
  if(settingsResult && settingsResult.ok && settingsResult.body && settingsResult.body.settings){
    applySettingsPayload(settingsResult.body.settings);
    if(settingsResult.body.plan && !currentCustomer){
      currentCustomer = { plan_code: String(settingsResult.body.plan || '').trim().toLowerCase() };
    }
  }
  var workspaceResult = tasks[1].status === 'fulfilled' ? tasks[1].value : null;
  if(workspaceResult && workspaceResult.ok && workspaceResult.body && workspaceResult.body.workspace){
    state.workspace = Object.assign(getDefaultWorkspace(state.plan), workspaceResult.body.workspace || {});
  }
  var billingResult = tasks[2].status === 'fulfilled' ? tasks[2].value : null;
  if(billingResult && billingResult.ok && billingResult.body){
    state.billingPortalAvailable = !!billingResult.body.available;
    state.billingPortalReason = billingResult.body.reason || '';
    currentCustomer = Object.assign({}, currentCustomer || {}, {
      stripe_customer_id: state.billingPortalAvailable ? (billingResult.body.customerId || 'ready') : ''
    });
  }
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
function extractStoredBundle(rawValue){
  if(!rawValue || typeof rawValue !== 'string') return {};
  try{
    var parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }catch(_){
    return {};
  }
}
function getDefaultWorkspace(plan){
  var base = {
    notes:'O MercaBot usa o próprio WhatsApp para vender o produto. Priorize clareza, diagnóstico rápido do cenário do lead e recomendação objetiva do plano certo.',
    specialHours:'Se a pergunta exigir implantação técnica, integração com Meta ou revisão comercial mais específica, encaminhe para a equipe humana no próximo passo.',
    quickReplies:[
      'Posso te indicar o plano mais alinhado ao seu momento em menos de 1 minuto.',
      'Se você me disser como atende hoje, eu comparo com Starter, Pro e Parceiro sem enrolação.',
      'Se fizer mais sentido, eu encaminho sua conversa para a equipe comercial do MercaBot.'
    ],
    goal:'vender',
    leadLabels:'novo lead, qualificado, comparando opções, pronto para ativar',
    priorityReplies:'1. identificar perfil do lead e volume de atendimento\n2. explicar valor do MercaBot com clareza e sem jargão\n3. recomendar Starter, Pro ou Parceiro com justificativa objetiva\n4. encaminhar para a equipe quando houver dúvida técnica, integração ou negociação',
    followupReminder:'Se o lead parar de responder, retome com uma mensagem curta, útil e orientada a próximo passo, sem parecer cobrança.'
  };
  if(plan === 'Starter') base.leadLabels = 'novo lead, aguardando retorno, pronto para ativar';
  return base;
}
function getEmptyWorkspace(){
  return {
    notes:'',
    specialHours:'',
    quickReplies:['','',''],
    goal:'',
    leadLabels:'',
    priorityReplies:'',
    followupReminder:'',
    faq:'',
    businessProfile:{ segment:'', fields:{}, freeText:'', aiGenerated:false }
  };
}

// ── Business Profile ─────────────────────────────────────────────────────────
var BP_SEGMENTS = [
  { id:'loja', icon:'🛍️', label:'Loja e e-commerce',
    hint:'Catálogo, pedidos e fechamento de venda pelo WhatsApp',
    fields:[
      { id:'produtos',   label:'Principais produtos ou categorias', type:'textarea', maxlen:500, placeholder:'Ex: camisetas, calças e acessórios. Preços de R$ 60 a R$ 350.' },
      { id:'entrega',    label:'Política de entrega',               type:'input',    maxlen:200, placeholder:'Ex: até 5 dias úteis, frete grátis acima de R$ 200' },
      { id:'troca',      label:'Troca e devolução',                 type:'input',    maxlen:200, placeholder:'Ex: troca em até 30 dias com nota fiscal' },
      { id:'pagamento',  label:'Formas de pagamento',               type:'input',    maxlen:200, placeholder:'Ex: Pix, cartão até 12x, boleto' }
    ]
  },
  { id:'restaurante', icon:'🍕', label:'Restaurante e delivery',
    hint:'Pedidos, confirmações e horários de entrega',
    fields:[
      { id:'cardapio',      label:'Cardápio resumido',                    type:'textarea', maxlen:600, placeholder:'Ex: pizzas (R$ 45–90), massas (R$ 38–65), bebidas (R$ 8–15)' },
      { id:'area_entrega',  label:'Área de entrega',                      type:'input',    maxlen:200, placeholder:'Ex: bairros Centro, Jardins e Pinheiros' },
      { id:'tempo_entrega', label:'Tempo médio de entrega',               type:'input',    maxlen:100, placeholder:'Ex: 35 a 50 minutos' },
      { id:'taxa_entrega',  label:'Taxa de entrega e pedido mínimo',      type:'input',    maxlen:150, placeholder:'Ex: R$ 6, grátis acima de R$ 80. Mínimo R$ 30.' }
    ]
  },
  { id:'clinica', icon:'🏥', label:'Clínica e saúde',
    hint:'Agendamentos, especialidades e orientação inicial',
    fields:[
      { id:'especialidades', label:'Especialidades ou serviços',   type:'textarea', maxlen:400, placeholder:'Ex: dermatologia, botox, limpeza de pele, consultas estéticas' },
      { id:'convenios',      label:'Convênios aceitos',             type:'input',    maxlen:200, placeholder:'Ex: Unimed, Bradesco Saúde — ou "Particular"' },
      { id:'agendamento',    label:'Como o cliente agenda',         type:'input',    maxlen:200, placeholder:'Ex: WhatsApp, site ou ligação para (11) 9999-9999' }
    ]
  },
  { id:'salao', icon:'✂️', label:'Salão e estética',
    hint:'Agendamentos, serviços e lista de espera automática',
    fields:[
      { id:'servicos',      label:'Serviços e preços',            type:'textarea', maxlen:400, placeholder:'Ex: corte (R$ 60), escova (R$ 80), progressiva (R$ 200)' },
      { id:'duracao',       label:'Duração média dos serviços',   type:'input',    maxlen:150, placeholder:'Ex: corte 40 min, escova 1h, progressiva 3h' },
      { id:'cancelamento',  label:'Política de cancelamento',     type:'input',    maxlen:200, placeholder:'Ex: cancelar com pelo menos 4h de antecedência' }
    ]
  },
  { id:'imobiliaria', icon:'🏠', label:'Imobiliária',
    hint:'Qualificação de leads, visitas e follow-up automático',
    fields:[
      { id:'imoveis',        label:'Tipos de imóvel e regiões',           type:'textarea', maxlen:400, placeholder:'Ex: apartamentos e casas na Zona Sul, R$ 400 mil a R$ 1,2 mi' },
      { id:'visita',         label:'Como agendar uma visita',             type:'input',    maxlen:200, placeholder:'Ex: cliente escolhe o imóvel e a IA agenda com o corretor' },
      { id:'docs',           label:'Documentos exigidos para fechamento', type:'input',    maxlen:200, placeholder:'Ex: RG, CPF, comprovante de renda, 3 últimos holerites' }
    ]
  },
  { id:'cursos', icon:'📚', label:'Cursos e infoprodutos',
    hint:'Qualificação, nutrição de leads e fechamento no chat',
    fields:[
      { id:'oferta',      label:'Produto ou curso principal',  type:'textarea', maxlen:400, placeholder:'Ex: curso online de marketing digital, 8 semanas, R$ 497' },
      { id:'plataforma',  label:'Plataforma e acesso',         type:'input',    maxlen:150, placeholder:'Ex: Hotmart, acesso vitalício' },
      { id:'garantia',    label:'Garantia e suporte',          type:'input',    maxlen:200, placeholder:'Ex: 7 dias de garantia, suporte via Telegram' }
    ]
  },
  { id:'autopecas', icon:'🚗', label:'Autopeças e oficina',
    hint:'Consulta de peças, orçamentos e status do serviço',
    fields:[
      { id:'marcas',       label:'Marcas e modelos atendidos',  type:'input',    maxlen:200, placeholder:'Ex: Chevrolet, Ford, VW, Toyota' },
      { id:'orcamento',    label:'Processo de orçamento',       type:'input',    maxlen:200, placeholder:'Ex: cliente informa a peça e o modelo, equipe responde em até 1h' },
      { id:'entrega_peca', label:'Entrega de peças',            type:'input',    maxlen:150, placeholder:'Ex: entrega em todo o estado, frete R$ 15' }
    ]
  },
  { id:'academia', icon:'💪', label:'Academia e bem-estar',
    hint:'Boas-vindas, renovação de matrícula e retenção',
    fields:[
      { id:'planos',      label:'Planos e mensalidades',        type:'textarea', maxlen:300, placeholder:'Ex: Básico R$ 89/mês, Completo R$ 149/mês, Anual R$ 999' },
      { id:'modalidades', label:'Modalidades oferecidas',       type:'input',    maxlen:200, placeholder:'Ex: musculação, funcional, yoga, spinning' },
      { id:'trial',       label:'Avaliação gratuita ou trial',  type:'input',    maxlen:150, placeholder:'Ex: 3 dias grátis para novos alunos' }
    ]
  },
  { id:'outros', icon:'⚡', label:'Outro segmento',
    hint:'Advocacia, contabilidade, pet shop, turismo e mais',
    fields:[
      { id:'descricao',   label:'O que sua empresa oferece',     type:'textarea', maxlen:600, placeholder:'Descreva os principais serviços, produtos e como seu cliente chega até você' },
      { id:'diferencial', label:'Principal diferencial',         type:'input',    maxlen:200, placeholder:'Ex: atendimento 24h, especialização em pequenas empresas' },
      { id:'processo',    label:'Processo de contratação',       type:'input',    maxlen:200, placeholder:'Ex: consulta inicial gratuita, orçamento em 24h, contrato digital' }
    ]
  }
];

var _bpSelectedSegment = null; // segment object currently being edited
var _bpFormActive = false;     // true while user is in the form state (State B)

function bpFindSegment(id){
  return BP_SEGMENTS.find(function(s){ return s.id === id; }) || null;
}

function bpRenderSegmentGrid(){
  var grid = document.getElementById('bpSegmentGrid');
  if(!grid) return;
  grid.innerHTML = '';
  BP_SEGMENTS.forEach(function(seg){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bp-seg';
    btn.setAttribute('role','option');
    btn.setAttribute('aria-selected','false');
    btn.setAttribute('data-seg', seg.id);
    btn.innerHTML =
      '<span class="bp-seg-icon" aria-hidden="true">' + seg.icon + '</span>' +
      '<span class="bp-seg-name">' + seg.label + '</span>' +
      '<span class="bp-seg-hint">' + seg.hint + '</span>';
    btn.addEventListener('click', function(){ bpSelectSegment(seg); });
    grid.appendChild(btn);
  });
}

function bpSelectSegment(seg){
  _bpSelectedSegment = seg;
  // Mark selected in grid
  document.querySelectorAll('.bp-seg').forEach(function(b){
    var isThis = b.getAttribute('data-seg') === seg.id;
    b.classList.toggle('selected', isThis);
    b.setAttribute('aria-selected', isThis ? 'true' : 'false');
  });
  // Transition to form state
  setTimeout(function(){ bpShowFormState(seg); }, 120);
}

function bpShowFormState(seg){
  _bpFormActive = true;
  document.getElementById('bpStateEmpty').style.display = 'none';
  document.getElementById('bpStateForm').style.display  = '';
  document.getElementById('bpStateDone').style.display  = 'none';

  // Active segment pill
  var pill = document.getElementById('bpActiveSegmentPill');
  if(pill){
    pill.setAttribute('data-seg-id', seg.id);
    pill.innerHTML =
      '<div class="bp-active-pill"><span class="bp-active-pill-icon" aria-hidden="true">' +
      seg.icon + '</span>' + seg.label + '</div>';
  }

  // Render manual fields
  var wrap = document.getElementById('bpManualFields');
  if(wrap){
    wrap.innerHTML = '';
    seg.fields.forEach(function(f){
      var fieldDiv = document.createElement('div');
      fieldDiv.className = 'stack-field';
      var label = '<label class="stack-label" for="bpf_' + f.id + '">' + f.label + '</label>';
      var input;
      if(f.type === 'textarea'){
        input = '<textarea id="bpf_' + f.id + '" class="stack-input" maxlength="' + f.maxlen + '" rows="3" placeholder="' + f.placeholder.replace(/"/g,'&quot;') + '"></textarea>';
      } else {
        input = '<input id="bpf_' + f.id + '" type="text" class="stack-input" maxlength="' + f.maxlen + '" placeholder="' + f.placeholder.replace(/"/g,'&quot;') + '">';
      }
      fieldDiv.innerHTML = label + input;
      wrap.appendChild(fieldDiv);
    });
  }

  // Pre-fill from saved profile if same segment
  var saved = state.workspace && state.workspace.businessProfile;
  if(saved && saved.segment === seg.id){
    seg.fields.forEach(function(f){
      var el = document.getElementById('bpf_' + f.id);
      if(el && saved.fields && saved.fields[f.id]) el.value = saved.fields[f.id];
    });
    var freeEl = document.getElementById('bpFreeText');
    if(freeEl) freeEl.value = saved.freeText || '';
  }

  // Reset AI confirm
  var confirm = document.getElementById('bpAiConfirm');
  var loading = document.getElementById('bpAiLoading');
  if(confirm) confirm.style.display = 'none';
  if(loading) loading.style.display = 'none';

  // Focus first field
  setTimeout(function(){
    var firstInput = wrap && wrap.querySelector('input,textarea');
    if(firstInput) firstInput.focus();
  }, 80);
}

function bpShowDoneState(){
  _bpFormActive = false;
  document.getElementById('bpStateEmpty').style.display = 'none';
  document.getElementById('bpStateForm').style.display  = 'none';
  document.getElementById('bpStateDone').style.display  = '';

  var bp = (state.workspace && state.workspace.businessProfile) || {};
  var seg = bpFindSegment(bp.segment);

  // Edit button
  var editBtn = document.getElementById('bpEditBtn');
  var pill    = document.getElementById('bpStatusPill');
  if(editBtn) editBtn.style.display = '';
  if(pill)    pill.style.display    = '';

  if(!seg) return;

  // Segment pill
  var segPill = document.getElementById('bpDoneSegPill');
  if(segPill) segPill.innerHTML =
    '<span aria-hidden="true">' + seg.icon + '</span> ' + seg.label;

  // AI badge
  var aiBadge = document.getElementById('bpDoneAiBadge');
  if(aiBadge){
    aiBadge.textContent = bp.aiGenerated ? '✨ Gerado com IA' : '';
    aiBadge.style.display = bp.aiGenerated ? '' : 'none';
  }

  // Fields summary
  var grid = document.getElementById('bpDoneGrid');
  if(!grid) return;
  grid.innerHTML = '';
  var hasAnyField = false;
  seg.fields.forEach(function(f){
    var val = bp.fields && bp.fields[f.id];
    if(!val || !val.trim()) return;
    hasAnyField = true;
    var div = document.createElement('div');
    div.className = 'bp-done-field';
    div.innerHTML =
      '<span class="bp-done-field-label">' + escText(f.label) + '</span>' +
      '<span class="bp-done-field-value">' + escText(val) + '</span>';
    grid.appendChild(div);
  });
  if(bp.freeText && bp.freeText.trim()){
    var div = document.createElement('div');
    div.className = 'bp-done-field bp-done-free';
    div.style.gridColumn = '1 / -1';
    div.innerHTML =
      '<span class="bp-done-field-label">Descrição livre</span>' +
      '<span class="bp-done-field-value">' + escText(bp.freeText) + '</span>';
    grid.appendChild(div);
  }
  if(!hasAnyField && (!bp.freeText || !bp.freeText.trim())){
    grid.innerHTML = '<span style="font-size:.9rem;color:var(--muted)">Perfil salvo. Clique em Editar para adicionar mais detalhes.</span>';
  }
}

function bpHydrate(){
  // Don't interrupt an active form session — the user is in the middle of filling fields
  if(_bpFormActive) return;
  bpRenderSegmentGrid();
  var bp = state.workspace && state.workspace.businessProfile;
  if(bp && bp.segment){
    bpShowDoneState();
  } else {
    document.getElementById('bpStateEmpty').style.display = '';
    document.getElementById('bpStateForm').style.display  = 'none';
    document.getElementById('bpStateDone').style.display  = 'none';
    document.getElementById('bpEditBtn').style.display    = 'none';
    document.getElementById('bpStatusPill').style.display = 'none';
  }
}

async function bpSave(){
  if(!_bpSelectedSegment) return;
  var seg = _bpSelectedSegment;
  var fields = {};
  seg.fields.forEach(function(f){
    var el = document.getElementById('bpf_' + f.id);
    if(el) fields[f.id] = el.value.trim();
  });
  var freeEl = document.getElementById('bpFreeText');
  var freeText = freeEl ? freeEl.value.trim() : '';

  var btn = document.getElementById('bpSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }

  var profile = { segment: seg.id, fields: fields, freeText: freeText, aiGenerated: false };
  // Merge into workspace and persist
  var currentWs = Object.assign({}, state.workspace || {});
  currentWs.businessProfile = profile;

  var ok = await persistWorkspace('business_profile', currentWs, 'Perfil do negócio salvo.');
  if(ok){
    state.workspace = Object.assign(state.workspace || {}, { businessProfile: profile });
    bpShowDoneState();
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Salvar perfil'; }
}

function bpStartEdit(){
  var bp = state.workspace && state.workspace.businessProfile;
  var seg = bp && bp.segment ? bpFindSegment(bp.segment) : null;
  if(seg){
    _bpSelectedSegment = seg;
    bpShowFormState(seg);
  } else {
    document.getElementById('bpStateEmpty').style.display = '';
    document.getElementById('bpStateForm').style.display  = 'none';
    document.getElementById('bpStateDone').style.display  = 'none';
    document.getElementById('bpEditBtn').style.display    = 'none';
    document.getElementById('bpStatusPill').style.display = 'none';
  }
}

function bpShowAiConfirm(){
  var freeText = (document.getElementById('bpFreeText') || {}).value || '';
  if(!freeText.trim()){
    toast('Cole uma descrição do seu negócio antes de gerar com IA.');
    var el = document.getElementById('bpFreeText');
    if(el) el.focus();
    return;
  }
  var confirmEl = document.getElementById('bpAiConfirm');
  if(confirmEl){ confirmEl.style.display = ''; }
  var yesBtn = document.getElementById('bpAiConfirmYes');
  if(yesBtn) setTimeout(function(){ yesBtn.focus(); }, 50);
}

async function bpGenerateWithAI(){
  var confirmEl = document.getElementById('bpAiConfirm');
  var loadingEl = document.getElementById('bpAiLoading');
  if(confirmEl) confirmEl.style.display = 'none';
  if(loadingEl) loadingEl.style.display = '';

  var generateBtn = document.getElementById('bpGenerateBtn');
  if(generateBtn) generateBtn.disabled = true;

  var freeText = (document.getElementById('bpFreeText') || {}).value || '';
  var seg = _bpSelectedSegment;
  if(!seg){ if(loadingEl) loadingEl.style.display = 'none'; return; }

  try{
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session
      ? sessionResult.data.session.access_token : '';
    if(!jwt){ toast('Sessão expirada. Entre novamente.'); return; }

    var API_BASE = (window.__mbConfig||{}).API_BASE_URL || 'https://api.mercabot.com.br';
    var result = await postAuthorizedJson(
      API_BASE + '/account/workspace/generate',
      jwt,
      { segment: seg.id, freeText: freeText, fields: seg.fields.map(function(f){ return f.id; }) },
      20000
    );

    if(!result.ok || !result.body || !result.body.fields){
      toast((result.body && result.body.error) || 'Não foi possível gerar o formulário agora. Tente novamente ou preencha manualmente.');
      return;
    }

    // Fill fields with AI response
    var generated = result.body.fields;
    seg.fields.forEach(function(f){
      var el = document.getElementById('bpf_' + f.id);
      if(el && generated[f.id]) el.value = generated[f.id];
    });
    toast('Campos preenchidos pela IA. Revise e salve.');

    // Mark as AI-generated for the save
    var saveBtn = document.getElementById('bpSaveBtn');
    if(saveBtn) saveBtn.setAttribute('data-ai', 'true');

  }catch(err){
    if(window.__mb_report_error) window.__mb_report_error(err, { fn: 'bpGenerateWithAI' });
    toast('Falha temporária ao gerar com IA. Tente novamente.');
  }finally{
    if(loadingEl) loadingEl.style.display = 'none';
    if(generateBtn) generateBtn.disabled = false;
  }
}

function bpBindEvents(){
  var backBtn  = document.getElementById('bpBackBtn');
  var saveBtn  = document.getElementById('bpSaveBtn');
  var editBtn  = document.getElementById('bpEditBtn');
  var genBtn   = document.getElementById('bpGenerateBtn');
  var yesBtn   = document.getElementById('bpAiConfirmYes');
  var noBtn    = document.getElementById('bpAiConfirmNo');

  if(backBtn)  backBtn.addEventListener('click',  function(){ _bpFormActive=false; bpRenderSegmentGrid(); document.getElementById('bpStateEmpty').style.display=''; document.getElementById('bpStateForm').style.display='none'; _bpSelectedSegment=null; });
  if(saveBtn)  saveBtn.addEventListener('click',  bpSave);
  if(editBtn)  editBtn.addEventListener('click',  bpStartEdit);
  if(genBtn)   genBtn.addEventListener('click',   bpShowAiConfirm);
  if(yesBtn)   yesBtn.addEventListener('click',   bpGenerateWithAI);
  if(noBtn)    noBtn.addEventListener('click',    function(){ document.getElementById('bpAiConfirm').style.display='none'; });
}
// ─────────────────────────────────────────────────────────────────────────────
function getBaseWorkspaceDraftFromInputs(){
  return {
    notes: document.getElementById('opNotes').value.trim(),
    specialHours: document.getElementById('specialHours').value.trim(),
    quickReplies: Array.from(document.querySelectorAll('#replyGrid .quick-reply-input'))
      .map(function(el){ return el.value.trim(); })
  };
}
function getAdvancedWorkspaceDraftFromInputs(){
  return {
    goal: document.getElementById('operationGoal').value,
    leadLabels: document.getElementById('leadLabels').value.trim(),
    priorityReplies: document.getElementById('priorityReplies').value.trim(),
    followupReminder: document.getElementById('followupReminder').value.trim()
  };
}
function getSavedBaseWorkspaceDraft(){
  var workspace = state.workspace && typeof state.workspace === 'object' ? state.workspace : {};
  return {
    notes: workspace.notes || '',
    specialHours: workspace.specialHours || '',
    quickReplies: Array.isArray(workspace.quickReplies) ? workspace.quickReplies.map(function(item){ return String(item || '').trim(); }) : ['','','']
  };
}
function getSavedAdvancedWorkspaceDraft(){
  var workspace = state.workspace && typeof state.workspace === 'object' ? state.workspace : {};
  return {
    goal: workspace.goal || '',
    leadLabels: workspace.leadLabels || '',
    priorityReplies: workspace.priorityReplies || '',
    followupReminder: workspace.followupReminder || ''
  };
}
function getChannelDraftFromInputs(){
  return {
    display_phone_number: keepOnlyDigits(document.getElementById('channelNumber').value.trim()),
    phone_number_id: keepOnlyDigits(document.getElementById('channelPhoneId').value.trim()),
    has_token: !!document.getElementById('channelToken').value.trim()
  };
}
function getSavedChannelDraft(){
  return {
    display_phone_number: keepOnlyDigits(state.waNumber || ''),
    phone_number_id: keepOnlyDigits(state.channelPhoneNumberId || ''),
    has_token: false
  };
}
function escText(s){ return String(s||'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function updateClientBreadcrumb(tabId){
  var crumb = document.getElementById('clientBreadcrumb');
  if(!crumb) return;
  var labels = { dashboard:'Painel', plano:'Plano e cobrança', suporte:'Suporte' };
  var tabLabel = labels[tabId] || labels.dashboard;
  var raw = state && (state.company || state.email) ? String(state.company || state.email).slice(0, 40) : '';
  var prefix = raw ? (escText(raw) + ' <span aria-hidden="true">/</span> ') : ('Painel <span aria-hidden="true">/</span> ');
  crumb.innerHTML = prefix + '<span class="crumb-current">' + tabLabel + '</span>';
}
function updateClientSaveStates(){
  var baseBtn = document.getElementById('saveWorkspaceBaseBtn');
  var advancedBtn = document.getElementById('saveWorkspaceAdvancedBtn');
  var channelBtn = document.getElementById('saveChannelBtn');
  if(baseBtn){
    // Usa classe .no-changes em vez de disabled — mantém pointer-events para onclick funcionar
    var baseSame = JSON.stringify(getBaseWorkspaceDraftFromInputs()) === JSON.stringify(getSavedBaseWorkspaceDraft());
    baseBtn.classList.toggle('no-changes', baseSame);
  }
  if(advancedBtn){
    var activePlan = normalizePlan(state.plan);
    var advancedAllowed = !!activePlan && activePlan !== 'Starter';
    var advancedSame = JSON.stringify(getAdvancedWorkspaceDraftFromInputs()) === JSON.stringify(getSavedAdvancedWorkspaceDraft());
    advancedBtn.classList.toggle('no-changes', !advancedAllowed || advancedSame);
    advancedBtn.disabled = !advancedAllowed; // plano não permite: verdadeiramente desabilitado
  }
  if(channelBtn){
    channelBtn.disabled = JSON.stringify(getChannelDraftFromInputs()) === JSON.stringify(getSavedChannelDraft());
  }
  syncChannelActionButtons();
}
function syncChannelActionButtons(){
  var selfTestBtn = document.getElementById('runChannelSelfTestBtn');
  var supportBtn = document.getElementById('openChannelSupportBtn');
  var toggleBtn = document.getElementById('toggleManualChannelBtn');
  var saveBtn = document.getElementById('saveChannelBtn');
  var advancedBox = document.getElementById('advancedChannelFields');
  var numberValue = document.getElementById('channelNumber') ? document.getElementById('channelNumber').value.trim() : '';
  var phoneNumberId = keepOnlyDigits(document.getElementById('channelPhoneId') && document.getElementById('channelPhoneId').value.trim());
  var accessToken = document.getElementById('channelToken') ? document.getElementById('channelToken').value.trim() : '';
  var advancedOpen = !!advancedBox && advancedBox.style.display !== 'none';
  var hasTechnicalData = !!(phoneNumberId && accessToken);
  // Botão de autoteste: visível quando canal pendente (número salvo), conectado, ou dados técnicos preenchidos.
  // Com channelPending, o autoteste valida a IA — a conexão Meta é um processo assistido em paralelo.
  var canTest = state.channelConnected || state.channelPending || hasTechnicalData;
  if(selfTestBtn){
    selfTestBtn.disabled = !canTest;
    selfTestBtn.style.display = canTest ? '' : 'none';
  }
  if(supportBtn){
    supportBtn.textContent = 'Quero ajuda da MercaBot';
  }
  if(toggleBtn){
    toggleBtn.textContent = advancedOpen ? 'Ocultar campos manuais' : 'Prefiro inserir os dados manualmente';
  }
  if(saveBtn){
    // Habilita o botão salvar canal apenas quando há um número digitado
    saveBtn.disabled = !numberValue;
    saveBtn.textContent = hasTechnicalData ? 'Conectar e continuar' : 'Salvar número e continuar';
  }
}
function getWorkspaceBundle(){
  var bundle = extractStoredBundle(currentSettings && currentSettings.api_key_masked);
  if(!bundle.workspace || typeof bundle.workspace !== 'object') bundle.workspace = {};
  return bundle;
}
var toastTimer;

function getPlanLimits(plan){
  var planLimits = { Starter:{convs:500,price:'R$197/mês'}, Pro:{convs:1500,price:'R$497/mês'}, Parceiro:{convs:3000,price:'R$1.297/mês'} };
  return planLimits[plan] || planLimits.Starter;
}

function getPlanCapabilities(plan){
  var map = {
    Starter: { advancedOps:false, followup:false, total:3 },
    Pro: { advancedOps:true, followup:true, total:4 },
    Parceiro: { advancedOps:true, followup:true, total:4 }
  };
  return map[plan] || map.Starter;
}

function normalizePlan(plan){
  return ({ Starter:'Starter', Pro:'Pro', Parceiro:'Parceiro' }[String(plan || '').trim()] || '');
}

function maskOfficialNumber(raw){
  var digits = String(raw || '').replace(/\D+/g,'');
  if(!digits) return 'Ainda não informado';
  if(digits.length <= 4) return 'Final ' + digits;
  return 'Final ' + digits.slice(-4);
}

function syncToggleAvailability(){
  var caps = getPlanCapabilities(state.plan);
  var followupBtn = document.getElementById('tgFollowup');
  if(followupBtn){
    followupBtn.disabled = !caps.followup;
    followupBtn.style.opacity = caps.followup ? '1' : '.35';
    followupBtn.style.pointerEvents = caps.followup ? 'auto' : 'none';
    if(!caps.followup){
      state.settings.tgFollowup = false;
      followupBtn.classList.remove('on');
      followupBtn.setAttribute('aria-pressed','false');
      followupBtn.setAttribute('title','Disponível no plano Pro ou superior');
    } else {
      followupBtn.setAttribute('title','Ativar ou pausar retomada automática');
    }
  }
}

function fillList(el, items){
  if(!el) return;
  el.textContent = '';
  (items || []).forEach(function(item){
    var li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}
function fillInvoices(el, invoices){
  if(!el) return;
  el.textContent = '';
   if(!(invoices || []).length){
    var empty = document.createElement('div');
    empty.className = 'helper-note';
    empty.textContent = 'A cobrança real da sua conta aparece aqui assim que a assinatura estiver sincronizada.';
    el.appendChild(empty);
    return;
  }
  (invoices || []).forEach(function(i){
    var row = document.createElement('div');
    row.className = 'invoice-row';
    var left = document.createElement('div');
    var desc = document.createElement('div');
    desc.style.fontSize = '.85rem';
    desc.style.fontWeight = '500';
    desc.textContent = i.desc;
    var date = document.createElement('div');
    date.style.fontSize = '.75rem';
    date.style.color = 'var(--muted)';
    date.textContent = i.date;
    left.appendChild(desc);
    left.appendChild(date);
    var right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '.75rem';
    var val = document.createElement('span');
    val.style.fontSize = '.88rem';
    val.style.fontWeight = '600';
    val.textContent = i.val;
    var status = document.createElement('span');
    status.className = 'invoice-status ' + i.status;
    status.textContent = i.status === 'paid' ? 'Pago' : 'Pendente';
    right.appendChild(val);
    right.appendChild(status);
    row.appendChild(left);
    row.appendChild(right);
    el.appendChild(row);
  });
}

function applyAccountSummary(summary){
  if(!summary) return;
  state.summary = summary;
  state.plan = summary.plan && summary.plan.label ? summary.plan.label : state.plan;
  state.convs = summary.usage && typeof summary.usage.conversations === 'number' ? summary.usage.conversations : 0;
  state.leads = summary.usage && typeof summary.usage.uniqueContacts === 'number' ? summary.usage.uniqueContacts : 0;
  state.conversationLimit = summary.plan && summary.plan.limits ? summary.plan.limits.conversations : getPlanLimits(state.plan).convs;
  state.channelsConnected = summary.usage && typeof summary.usage.channelsConnected === 'number' ? summary.usage.channelsConnected : (state.channelConnected ? 1 : 0);
  state.featureUsageEnabled = summary.usage && summary.usage.featureUsage ? summary.usage.featureUsage.enabled : 0;
  state.featureUsageTotal = summary.usage && summary.usage.featureUsage ? summary.usage.featureUsage.total : getPlanCapabilities(state.plan).total;
  state.billingHistory = summary.billing && Array.isArray(summary.billing.history) ? summary.billing.history : [];
  state.billingStatusLabel = summary.billing && summary.billing.status ? summary.billing.status : 'Configuração em andamento';
  state.checkoutReadiness = summary.checkout || state.checkoutReadiness;
  state.upgrade = summary.recommendation || state.upgrade;
  if(summary.usage && summary.usage.daysActive) state.activatedDate = new Date(Date.now() - (Math.max(summary.usage.daysActive,1) * 86400000)).toISOString().slice(0,10);
  // Cota de mensagens IA
  if(summary.usage) {
    state.aiMsgsUsed    = typeof summary.usage.aiMsgsUsed  === 'number' ? summary.usage.aiMsgsUsed  : 0;
    state.aiMsgsLimit   = typeof summary.usage.aiMsgsLimit === 'number' ? summary.usage.aiMsgsLimit : 1000;
    state.aiMsgsPct     = typeof summary.usage.aiMsgsPct   === 'number' ? summary.usage.aiMsgsPct   : 0;
    state.aiMsgsResetAt = summary.usage.aiMsgsResetAt || null;
  }
}
function renderSetupBannerCopy(el, isPending){
  if(!el) return;
  el.textContent = '';
  if(isPending){
    el.textContent = 'Seu WhatsApp já foi salvo. A MercaBot pode seguir com a ativação enquanto você conclui o restante do cadastro.';
    return;
  }
  el.appendChild(document.createTextNode('Informe o WhatsApp principal da empresa, deixe a MercaBot seguir com a ativação e depois revise a operação com calma.'));
}

function renderBotState(){
  var ready = !!state.channelConnected;
  var on = ready && state.botOn;
  var dot = document.getElementById('botDot');
  var lbl = document.getElementById('botLabel');
  var sub = document.getElementById('botSub');
  var tog = document.getElementById('botToggle');
  dot.className = 'bot-dot '+(on?'on':'off');
  if(!ready){
    lbl.textContent = 'Aguardando WhatsApp';
    sub.textContent = 'Salve o número oficial para continuar a ativação do atendimento';
  } else {
    lbl.textContent = on ? 'IA pronta para atender' : 'IA pausada';
    sub.textContent = on ? 'Configurada e pronta para testes reais' : 'Atendimento automático desativado';
  }
  if(on) tog.classList.add('on'); else tog.classList.remove('on');
}
function showAuth(message, isError){
  document.getElementById('authShell').classList.remove('hidden');
  document.getElementById('appWrap').classList.add('hidden');
  setTopbarAuthState(false);
  document.getElementById('authSessionActions').classList.remove('show');
  document.getElementById('authEmail').closest('.form-group').classList.remove('hidden');
  document.getElementById('authBtn').classList.remove('hidden');
  var status = document.getElementById('authStatus');
  status.className = 'auth-status' + (message ? ' show' : '') + (isError ? ' error' : '');
  status.textContent = message || '';
}

var _bpEventsBound = false;
function showApp(){
  document.getElementById('authShell').classList.add('hidden');
  document.getElementById('appWrap').classList.remove('hidden');
  setTopbarAuthState(true);
  if(!_bpEventsBound){ bpBindEvents(); _bpEventsBound = true; }
  // Limpar PII do fluxo de autenticação — email armazenado durante o OTP não é mais necessário
  try{ localStorage.removeItem('mb_pending_otp_email'); }catch(_){}
}

function showSessionChoice(email){
  showAuth('Você já está conectado' + (email ? ' como ' + email : '') + '. Abra o painel ou entre com outro e-mail.', false);
  document.getElementById('authSessionActions').classList.add('show');
  document.getElementById('authEmail').closest('.form-group').classList.add('hidden');
  document.getElementById('authBtn').classList.add('hidden');
}

function hasContinueMode(){
  return new URLSearchParams(window.location.search).get('continue') === '1';
}


function isClientAppRoute(){
  return /^\/painel-cliente\/app\/?$/i.test(window.location.pathname);
}

// readStoredAuthHandoff / clearStoredAuthHandoff / appendSessionHash removed
// Session is established by Supabase client's own storage after OTP verification

async function establishSessionFromUrl(){
  if(!supabaseClient || !supabaseClient.auth){
    return;
  }
  var query = new URLSearchParams(window.location.search);
  var shouldCleanUrl = false;
  // Retorno do checkout de add-on
  if (query.get('addon') === 'success') {
    shouldCleanUrl = true;
    setTimeout(function() {
      var n = document.createElement('div');
      n.style.cssText = 'position:fixed;top:1.2rem;right:1.2rem;z-index:9999;background:#0d2e18;border:1px solid rgba(0,230,118,.35);color:#e8f0e9;padding:1rem 1.4rem;border-radius:14px;font-size:.97rem;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:320px;line-height:1.5';
      n.innerHTML = '✅ <strong>+1.000 respostas de IA adicionadas!</strong><br><span style="font-size:.88rem;color:#9ab09c;font-weight:400">Seu limite foi atualizado. O painel será atualizado em instantes.</span>';
      document.body.appendChild(n);
      setTimeout(function(){ n.remove(); }, 6000);
    }, 800);
  }
  var existingSessionResult = await supabaseClient.auth.getSession();
  var existingSession = existingSessionResult && existingSessionResult.data ? existingSessionResult.data.session : null;
  if(existingSession && existingSession.user && typeof supabaseClient.auth.getUser === 'function'){
    try{
      var existingUserResult = await supabaseClient.auth.getUser();
      var existingUser = existingUserResult && existingUserResult.data ? existingUserResult.data.user : null;
      if(existingUserResult && existingUserResult.error || !existingUser){
        try{ await supabaseClient.auth.signOut(); }catch(__){}
        existingSession = null;
      }
    }catch(_){
      try{ await supabaseClient.auth.signOut(); }catch(__){}
      existingSession = null;
    }
  }

  if(query.get('code') && typeof supabaseClient.auth.exchangeCodeForSession === 'function'){
    var exchangeResult = await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
    if(exchangeResult && exchangeResult.error){
      throw exchangeResult.error;
    }
    shouldCleanUrl = true;
  } else if(query.get('token_hash') && query.get('type') && typeof supabaseClient.auth.verifyOtp === 'function'){
    var verifyResult = await supabaseClient.auth.verifyOtp({
      token_hash: query.get('token_hash'),
      type: query.get('type')
    });
    if(verifyResult && verifyResult.error){
      throw verifyResult.error;
    }
    shouldCleanUrl = true;
  }

  if(shouldCleanUrl || window.location.hash){
    var target = window.location.origin + window.location.pathname + (hasContinueMode() ? '?continue=1' : '');
    history.replaceState(null, '', target);
  }
}

  function clearContinueMode(){
    var target = '/painel-cliente/app/';
    history.replaceState(null, '', window.location.origin + target);
  }

var ACTIVE_CLIENT_TAB_KEY = 'mb_client_active_tab';

function getAllowedClientTabs(){
  return ['dashboard','plano','suporte'];
}

function getStoredClientTab(){
  try{
    var stored = localStorage.getItem(ACTIVE_CLIENT_TAB_KEY) || '';
    return getAllowedClientTabs().indexOf(stored) >= 0 ? stored : 'dashboard';
  }catch(_){
    return 'dashboard';
  }
}

function storeClientTab(tabId){
  try{
    localStorage.setItem(ACTIVE_CLIENT_TAB_KEY, tabId);
  }catch(_){}
}

async function continueExistingSession(){
  if(!supabaseClient || !supabaseClient.auth){
    showAuth('Sessão indisponível nesta página. Atualize e tente novamente.', true);
    return;
  }
  try{
    var sessionResult = await supabaseClient.auth.getSession();
    var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
    if(!session || !session.user){
      showAuth('Sua sessão expirou. Peça um novo link para continuar.', true);
      return;
    }
    window.location.replace(window.location.origin + '/painel-cliente/app/?continue=1');
  }catch(_){
    showAuth('Não foi possível continuar sua sessão agora. Peça um novo link para continuar.', true);
  }
}

async function useAnotherAccount(){
  await signOut(true);
}

  async function sendMagicLink(){
    var email = document.getElementById('authEmail').value.trim().toLowerCase();
    if(!email){
      showAuth('Informe o e-mail da sua conta.', true);
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      showAuth('Informe um e-mail válido para continuar.', true);
      return;
    }
    if(!supabaseClient || !supabaseClient.auth){
      showAuth('Autenticação indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    var authBtn = document.getElementById('authBtn');
    authBtn.disabled = true;
    authBtn.style.opacity = '.7';
    authBtn.textContent = 'Enviando...';
    showAuth('Enviando link de acesso...', false);
    try {
      var otpResult = await supabaseClient.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: window.location.origin + '/acesso/',
          shouldCreateUser: false
        }
      });
      if(otpResult && otpResult.error){
        var rawMsg = (otpResult.error.message || '').toLowerCase();
        var friendlyMsg = rawMsg.indexOf('signups not allowed') >= 0
          ? 'E-mail não encontrado. Verifique o endereço ou acesse /cadastro/ para criar sua conta.'
          : rawMsg.indexOf('rate limit') >= 0 || rawMsg.indexOf('too many') >= 0
            ? 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
            : rawMsg.indexOf('invalid email') >= 0
              ? 'E-mail inválido. Verifique o endereço e tente novamente.'
              : 'Não foi possível enviar o link agora. Tente novamente em alguns minutos.';
        showAuth(friendlyMsg, true);
        return;
      }
      showAuth('Se o endereço informado puder receber acesso, enviaremos o link em instantes.', false);
  } catch (err) {
    showAuth('Falha temporária ao solicitar o acesso. Tente novamente em alguns minutos.', true);
  } finally {
    authBtn.disabled = false;
    authBtn.style.opacity = '1';
authBtn.textContent = 'Receber link de acesso';
  }
}

async function signOut(silent){
  if(!silent){
    showClientConfirm('Deseja sair do painel agora?', function(){ _doSignOut(); }, 'Sair', 'Cancelar');
    return;
  }
  await _doSignOut();
}
async function _doSignOut(){
  if(!supabaseClient || !supabaseClient.auth){
    showAuth('Sessão indisponível nesta página. Atualize e tente novamente.', true);
    return;
  }
  await supabaseClient.auth.signOut();
  authBootstrapDone = true;
  resetClientState();
  history.replaceState(null, '', window.location.origin + '/painel-cliente/app/');
  showAuth('Sessão encerrada.', false);
}

function hydrateState(profile, customer, settings){
  var bundle = getWorkspaceBundle();
  state.email = (profile && profile.email) || '';
  state.company = (customer && customer.company_name) || '';
  state.waNumber = (settings && settings.whatsapp_display_number) || (customer && customer.whatsapp_number) || '';
  state.channelProvider = 'meta';
  state.channelPhoneNumberId = '';
  state.channelTokenMasked = '';
  state.channelVerifiedName = '';
  state.channelConnected = false;
  state.channelPending = !!state.waNumber;
  state.botOn = settings ? !!settings.bot_enabled : false;
  state.customerStatus = (customer && customer.status) || 'active';
  state.settings = {
    tgHorario: settings ? !!settings.business_hours_enabled : false,
    tgLeads: settings ? !!settings.lead_qualification_enabled : false,
    tgFollowup: settings ? !!settings.followup_enabled : false,
    tgHuman: settings ? !!settings.human_handoff_enabled : false
  };
  state.plan = customer && customer.plan_code ? normalizePlan({starter:'Starter',pro:'Pro',parceiro:'Parceiro'}[customer.plan_code]) : '';
  state.activatedDate = (customer && (customer.activated_at || customer.created_at)) ? String(customer.activated_at || customer.created_at).slice(0,10) : new Date().toISOString().slice(0,10);
  state.convs = 0;
  state.leads = 0;
  state.workspace = (bundle.workspace && typeof bundle.workspace === 'object') ? bundle.workspace : {};
}

function handleSetupAction(){
  switchTab('dashboard', { persist:true, scrollPage:true, smooth:true });
  if(state.channelConnected){
    window.location.href = buildGuidedConfigLink();
    return;
  }
  if(state.channelPending){
    editChannel();
    return;
  }
  editChannel();
}

function scrollClientSectionIntoView(sectionId, focusId){
  switchTab('dashboard', { persist:true, scrollPage:true, smooth:true });
  setTimeout(function(){
    var section = document.getElementById(sectionId);
    if(section && typeof section.scrollIntoView === 'function'){
      section.scrollIntoView({ block:'start', behavior:'smooth' });
    }
    if(focusId){
      setTimeout(function(){
        var field = document.getElementById(focusId);
        if(field && typeof field.focus === 'function'){
          field.focus({ preventScroll:true });
        }
      }, 180);
    }
  }, 80);
}

function focusOperationsBase(){
  scrollClientSectionIntoView('instructionCard', 'opNotes');
}

function openGoLiveValidation(){
  // Sem número salvo → abre overlay para cadastrar número (Etapa 1 incompleta)
  if(!state.channelConnected && !state.channelPending){
    editChannel();
    setTimeout(function(){
      var numberField = document.getElementById('channelNumber');
      if(numberField && typeof numberField.focus === 'function'){
        numberField.focus({ preventScroll:false });
      }
    }, 120);
    return;
  }
  // Número salvo (pending) ou canal conectado → valida configuração base (Etapa 2)
  if(!(document.getElementById('opNotes').value || '').trim()){
    focusOperationsBase();
    toast('Escreva a instrução principal antes de prosseguir.');
    return;
  }
  if(!(document.getElementById('quickReply1').value || '').trim()){
    focusOperationsBase();
    toast('Salve pelo menos a primeira frase pronta antes de prosseguir.');
    return;
  }
  // Canal conectado: rola até connectionsCard (visível) antes de abrir o overlay.
  // Canal pendente: abre o overlay direto — connectionsCard ainda não está visível.
  var delay = 0;
  if(state.channelConnected){
    scrollClientSectionIntoView('connectionsCard');
    delay = 160;
  }
  setTimeout(function(){
    editChannel();
    setTimeout(function(){
      var result = document.getElementById('channelSelfTestResult');
      if(result){ result.style.display = 'block'; }
      var summary = document.getElementById('channelSelfTestSummary');
      if(summary){
        summary.textContent = state.channelConnected
          ? 'Passo 1: confirme o número oficial. Passo 2: conclua a conexão Meta se ainda não fez. Passo 3: clique abaixo para a MercaBot validar a IA e o canal.'
          : 'Sua instrução e frases prontas já estão configuradas. Clique em "Rodar primeiro teste" para ver como a IA vai responder. A ativação no WhatsApp segue com o apoio da MercaBot.';
      }
      var testBtn = document.getElementById('runChannelSelfTestBtn');
      if(testBtn && typeof testBtn.focus === 'function'){
        testBtn.focus({ preventScroll:false });
      }
    }, 120);
  }, delay);
}

function handleSetupSecondaryAction(){
  if(!state.channelConnected){
    openChannelSupport();
    return;
  }
  if(!((document.getElementById('opNotes').value || '').trim() && (document.getElementById('quickReply1').value || '').trim())){
    focusOperationsBase();
    return;
  }
  openGoLiveValidation();
}

function setQuickstartStep(stepId, config){
  var dot = document.getElementById(stepId);
  var badge = document.getElementById(stepId + 'State');
  var action = document.getElementById(stepId + 'ActionBtn');
  if(dot){
    dot.className = 'quickstart-dot' + (config.done ? ' done' : '');
    dot.textContent = config.done ? '✓' : config.index;
  }
  if(badge){
    badge.textContent = config.label;
    badge.className = 'quickstart-state ' + config.variant;
  }
  if(action){
    action.textContent = config.actionLabel;
    action.disabled = !!config.actionDisabled;
    action.className = config.variant === 'current' ? 'btn-primary' : 'btn-soft';
  }
}

function renderState(){
  var activePlan = normalizePlan(state.plan);
  var planKnown = !!activePlan;
  var pl = getPlanLimits(activePlan || 'Starter');
  var caps = getPlanCapabilities(activePlan || 'Starter');
  var effectiveConversationLimit = planKnown ? Math.max(state.conversationLimit || pl.convs, 1) : 0;
  var effectiveFeatureUsageTotal = planKnown ? Math.max(state.featureUsageTotal || caps.total, 1) : 0;
  var hasBillingPortal = typeof state.billingPortalAvailable === 'boolean'
    ? state.billingPortalAvailable
    : !!(currentCustomer && currentCustomer.stripe_customer_id);
  var setupBanner = document.getElementById('setupBanner');
  var setupBannerTitle = document.getElementById('setupBannerTitle');
  var setupBannerCopy = document.getElementById('setupBannerCopy');
  var setupActionBtn = document.getElementById('setupActionBtn');
  var setupSecondaryBtn = document.getElementById('setupSecondaryBtn');
  var nextStepNote = document.getElementById('nextStepNote');
  var channelActionLabel = state.channelConnected ? 'Revisar WhatsApp' : (state.channelPending ? 'Revisar número salvo' : 'Informar WhatsApp');
  document.getElementById('planBadge').textContent = activePlan || 'Plano';
  document.getElementById('planBadge').className = 'plan-badge' + (activePlan==='Starter' ? ' trial' : '');
  document.getElementById('greetingName').textContent = state.company ? 'Olá, '+state.company+'!' : 'Olá!';
  document.getElementById('statConv').textContent = state.convs;
  document.getElementById('statLimit').textContent = !planKnown ? 'Aguardando plano da conta' : (activePlan==='Starter' ? 'Operação inicial' : (activePlan==='Pro' ? 'Operação em crescimento' : 'Operação multi-cliente'));
  document.getElementById('statRate').textContent = state.channelConnected ? (state.botOn ? 'Em teste' : 'Canal conectado') : (state.channelPending ? 'Número salvo' : 'Pendente');
  document.getElementById('statRate').style.color = state.channelConnected ? 'var(--green)' : 'var(--amber)';
  document.getElementById('statRateSub').textContent = state.channelConnected
    ? (state.botOn ? 'Agora valide respostas reais no seu número oficial' : 'Ative o atendimento automático quando quiser testar')
    : (state.channelPending ? 'A MercaBot está seguindo com a ativação desse número' : 'Informe o número oficial para começar');
  document.getElementById('statLeads').textContent = state.channelConnected ? state.leads : '—';
  document.getElementById('statDays').textContent = Math.max(Math.floor((new Date() - new Date(state.activatedDate)) / 86400000),1);
  document.getElementById('convLabel').textContent = planKnown ? (state.convs + ' / ' + effectiveConversationLimit) : '—';
  document.getElementById('convBar').style.width = planKnown ? (Math.min(Math.round((state.convs/effectiveConversationLimit)*100),100) + '%') : '0%';
  // Barra de cota de mensagens IA
  (function(){
    var aiUsed  = state.aiMsgsUsed  || 0;
    var aiLimit = state.aiMsgsLimit || 1000;
    var aiPct   = aiLimit > 0 ? aiUsed / aiLimit : 0;
    var aiPct100 = Math.min(Math.round(aiPct * 100), 100);
    var isDanger = aiPct >= 1.0;
    var isWarn   = aiPct >= 0.8 && !isDanger;
    var isHint   = aiPct >= 0.7 && !isWarn && !isDanger;
    var labelEl  = document.getElementById('aiMsgsLabel');
    var barEl    = document.getElementById('aiMsgsBar');
    var resetEl  = document.getElementById('aiQuotaResetLine');
    var alertEl  = document.getElementById('aiQuotaAlert');
    if(labelEl) labelEl.textContent = aiUsed.toLocaleString('pt-BR') + ' / ' + aiLimit.toLocaleString('pt-BR');
    if(barEl) {
      barEl.style.width = aiPct100 + '%';
      barEl.style.background = isDanger ? '#ef4444' : (isWarn ? '#f59e0b' : 'var(--green)');
    }
    if(resetEl && state.aiMsgsResetAt) {
      var d = new Date(state.aiMsgsResetAt);
      resetEl.textContent = 'Renova em ' + d.toLocaleDateString('pt-BR', {day:'2-digit',month:'long'});
      resetEl.style.display = 'block';
    }
    // Seletor de pacotes extra (reutilizado nos 3 níveis de alerta)
    var addonBtns = '<span style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem">'
      + '<button onclick="comprarAddon(1,event)" style="background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.3);color:#00e676;font-weight:700;padding:.3rem .75rem;border-radius:8px;cursor:pointer;font-size:.82rem">+1.000 — R$47</button>'
      + '<button onclick="comprarAddon(5,event)" style="background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.3);color:#00e676;font-weight:700;padding:.3rem .75rem;border-radius:8px;cursor:pointer;font-size:.82rem">+5.000 — R$235 <span style="font-size:.75rem;opacity:.75">(economize 0%)</span></button>'
      + '<button onclick="comprarAddon(10,event)" style="background:rgba(0,230,118,.18);border:1px solid rgba(0,230,118,.45);color:#00e676;font-weight:700;padding:.3rem .75rem;border-radius:8px;cursor:pointer;font-size:.82rem">+10.000 — R$470 <span style="font-size:.75rem;opacity:.75">✦ mais popular</span></button>'
      + '</span>';
    if(alertEl) {
      if(isDanger) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(239,68,68,.08)';
        alertEl.style.border = '1px solid rgba(239,68,68,.25)';
        alertEl.style.color = '#fca5a5';
        alertEl.style.borderRadius = '10px';
        alertEl.style.padding = '.75rem 1rem';
        alertEl.innerHTML = '🚫 <strong>Cota esgotada</strong> — o atendimento automático está pausado. Seus clientes não estão recebendo resposta. Escolha um pacote para retomar agora:'
          + addonBtns;
      } else if(isWarn) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(245,158,11,.07)';
        alertEl.style.border = '1px solid rgba(245,158,11,.25)';
        alertEl.style.color = '#fbbf24';
        alertEl.style.borderRadius = '10px';
        alertEl.style.padding = '.75rem 1rem';
        alertEl.innerHTML = '⚠️ Você já usou <strong>' + aiPct100 + '%</strong> das respostas de IA deste mês. Amplie a cota para não interromper o atendimento:'
          + addonBtns;
      } else if(isHint) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(99,102,241,.06)';
        alertEl.style.border = '1px solid rgba(99,102,241,.2)';
        alertEl.style.color = '#a5b4fc';
        alertEl.style.borderRadius = '10px';
        alertEl.style.padding = '.6rem 1rem';
        alertEl.innerHTML = '💡 Você usou <strong>' + aiPct100 + '%</strong> das respostas de IA. Se o volume aumentar, um pacote extra garante continuidade:'
          + addonBtns;
      } else {
        alertEl.style.display = 'none';
      }
    }
  })();
  // ── Dunning banner — pagamento pendente / bot suspenso ───────────
  (function(){
    var banner   = document.getElementById('dunningBanner');
    var msgEl    = document.getElementById('dunningMsg');
    var iconEl   = document.getElementById('dunningIcon');
    var portalBtn= document.getElementById('dunningPortalBtn');
    if (!banner) return;
    var isAtRisk  = state.customerStatus === 'at_risk';
    var isPastDue = state.customerStatus === 'past_due';
    if (isAtRisk || isPastDue) {
      banner.style.display = 'flex';
      if (isAtRisk || (isPastDue && state.botOn)) {
        // Grace period: bot ainda ativo (at_risk = 1ª/2ª falha de pagamento)
        banner.style.background = 'rgba(245,158,11,.06)';
        banner.style.border = '1px solid rgba(245,158,11,.28)';
        banner.style.borderRadius = '14px';
        if (iconEl) iconEl.textContent = '⚠️';
        if (msgEl) msgEl.innerHTML = '<strong style="color:#fcd34d">Pagamento pendente</strong> — Tivemos um problema com seu cartão. Seu bot <strong>continua ativo por enquanto</strong>, mas atualize o método de pagamento para evitar a suspensão.';
        if (portalBtn) { portalBtn.style.background = '#f59e0b'; portalBtn.style.color = '#080c09'; portalBtn.textContent = 'Atualizar cartão →'; }
      } else {
        // Bot suspenso (past_due após 3ª+ falha)
        banner.style.background = 'rgba(239,68,68,.06)';
        banner.style.border = '1px solid rgba(239,68,68,.28)';
        banner.style.borderRadius = '14px';
        if (iconEl) iconEl.textContent = '🚫';
        if (msgEl) msgEl.innerHTML = '<strong style="color:#fca5a5">Bot suspenso</strong> — Seu atendimento automático está pausado por falta de pagamento. Atualize o cartão para <strong>reativar imediatamente</strong>.';
        if (portalBtn) { portalBtn.style.background = '#ef4444'; portalBtn.style.color = '#fff'; portalBtn.textContent = 'Reativar bot →'; }
      }
    } else {
      banner.style.display = 'none';
    }
  })();
  document.getElementById('numLabel').textContent = state.channelConnected ? 'Conectado' : (state.channelPending ? 'Em preparação' : 'Pendente');
  document.getElementById('numBar').style.width = state.channelConnected ? '100%' : (state.channelPending ? '45%' : '10%');
  document.getElementById('attLabel').textContent = planKnown ? (state.featureUsageEnabled + ' / ' + effectiveFeatureUsageTotal) : '—';
  document.getElementById('attBar').style.width = planKnown ? (Math.min(Math.round((state.featureUsageEnabled/effectiveFeatureUsageTotal)*100),100) + '%') : '0%';
  document.getElementById('planNameLabel').textContent = activePlan || 'Plano';
  var planFeatures = ({
    Starter: ['1 operação principal no número oficial','IA generativa premium com contexto real','Catálogo de produtos','FAQ pronto para editar','Notas internas da operação','Respostas rápidas editáveis','Horários especiais simples','Central digital da conta'],
    Pro: ['IA treinada no seu negócio','Painel da operação para decidir melhor','Objetivo da operação no painel','Etiquetas internas de lead','Respostas prioritárias','Lembrete de retorno configurável','Qualificação de leads no próprio atendimento','Central digital de ajuda'],
    Parceiro: ['White-label guiado com a sua marca','Painel multi-cliente para organizar a carteira','Biblioteca comercial de revenda','Checklist de ativação por cliente','Etiquetas de carteira por cliente','Playbooks de onboarding por nicho','Domínio próprio com ativação guiada','Central digital para parceiros']
  }[activePlan] || []);
  document.getElementById('planNameBig').textContent = activePlan || 'Plano atual';
  document.getElementById('planPriceSmall').textContent = planKnown ? (pl.price + ' · ' + state.billingStatusLabel) : 'Carregando assinatura...';
  fillList(document.getElementById('planFeatures'), planFeatures);
  var planNameBigSecondary = document.getElementById('planNameBigSecondary');
  var planPriceSmallSecondary = document.getElementById('planPriceSmallSecondary');
  var planFeaturesSecondary = document.getElementById('planFeaturesSecondary');
  if(planNameBigSecondary) planNameBigSecondary.textContent = activePlan || 'Plano atual';
  if(planPriceSmallSecondary) planPriceSmallSecondary.textContent = planKnown ? (pl.price + ' · ' + state.billingStatusLabel) : 'Carregando assinatura...';
  if(planFeaturesSecondary) fillList(planFeaturesSecondary, planFeatures);
  renderBotState();
  syncToggleAvailability();
  Object.keys(state.settings).forEach(function(k){
    var el = document.getElementById(k);
    if(el) { if(state.settings[k]) el.classList.add('on'); else el.classList.remove('on'); }
  });
  document.getElementById('keyDisplay').textContent = 'IA premium inclusa · pronta no backend';
  var keyDisplaySecondary = document.getElementById('keyDisplaySecondary');
  if(keyDisplaySecondary) keyDisplaySecondary.textContent = 'IA premium inclusa · pronta no backend';
  setupBanner.style.display = state.channelConnected ? 'none' : 'flex';
  if(state.channelConnected){
    nextStepNote.textContent = 'Seu WhatsApp já está conectado. Agora revise a operação e faça um teste curto antes de divulgar.';
    if(setupSecondaryBtn) setupSecondaryBtn.textContent = 'Fazer primeiro teste';
  } else if(state.channelPending){
    setupBannerTitle.textContent = 'Seu WhatsApp já foi salvo';
    renderSetupBannerCopy(setupBannerCopy, true);
    setupActionBtn.textContent = 'Revisar número salvo →';
    nextStepNote.textContent = 'Seu número já está salvo. Agora você pode continuar o cadastro enquanto a ativação segue com apoio da MercaBot.';
    if(setupSecondaryBtn) setupSecondaryBtn.textContent = 'Entender a ativação';
  } else {
    setupBannerTitle.textContent = 'Falta informar o WhatsApp da empresa';
    renderSetupBannerCopy(setupBannerCopy, false);
    setupActionBtn.textContent = 'Informar WhatsApp →';
    nextStepNote.textContent = 'Seu próximo passo é informar o número oficial da empresa. Depois disso, você segue com o cadastro e a MercaBot cuida da ativação.';
    if(setupSecondaryBtn) setupSecondaryBtn.textContent = 'Como funciona';
  }
  var maskedWaNumber = maskOfficialNumber(state.waNumber);
  document.getElementById('waNumber').textContent = maskedWaNumber;
  var waNumberSecondary = document.getElementById('waNumberSecondary');
  if(waNumberSecondary) waNumberSecondary.textContent = maskedWaNumber;
var waStatus = state.channelConnected ? 'Canal conectado' : (state.channelPending ? 'Número salvo' : 'Canal em preparação');
  var waStatusColor = state.channelConnected ? 'var(--green)' : 'var(--amber)';
  document.getElementById('waStatus').textContent = waStatus;
  document.getElementById('waStatus').style.color = waStatusColor;
  var waStatusSecondary = document.getElementById('waStatusSecondary');
  if(waStatusSecondary){
    waStatusSecondary.textContent = waStatus;
    waStatusSecondary.style.color = waStatusColor;
  }
  var waChannelText = state.channelConnected
    ? ((state.channelVerifiedName ? (state.channelVerifiedName + ' · ') : '') + 'Canal oficial ativo no ' + maskedWaNumber)
    : (state.channelPending
        ? ('Número salvo: ' + maskedWaNumber + ' · ativação em andamento')
        : 'Informe o WhatsApp da empresa para começar. A MercaBot conduz a ativação e mostra só o que precisar da sua aprovação.');
  document.getElementById('waChannelDisplay').textContent = waChannelText;
  var waChannelDisplaySecondary = document.getElementById('waChannelDisplaySecondary');
  if(waChannelDisplaySecondary) waChannelDisplaySecondary.textContent = waChannelText;
  var channelActionBtn = document.getElementById('channelActionBtn');
  var channelActionBtnSecondary = document.getElementById('channelActionBtnSecondary');
  if(channelActionBtn) channelActionBtn.textContent = channelActionLabel;
  if(channelActionBtnSecondary) channelActionBtnSecondary.textContent = channelActionLabel;
  renderWorkspaceFields();
  renderQuickstart();
  fillInvoices(document.getElementById('invoiceList'), state.billingHistory);
  var invoiceListSecondary = document.getElementById('invoiceListSecondary');
  if(invoiceListSecondary) fillInvoices(invoiceListSecondary, state.billingHistory);
  var upgradeSuggestionTitle = document.getElementById('upgradeSuggestionTitle');
  var upgradeSuggestionCopy = document.getElementById('upgradeSuggestionCopy');
  var upgradeSuggestionBtn = document.getElementById('upgradeSuggestionBtn');
  var usageHelperNote = document.getElementById('usageHelperNote');
  if(upgradeSuggestionTitle) upgradeSuggestionTitle.textContent = state.upgrade && state.upgrade.title ? state.upgrade.title : 'Seu plano atual está adequado.';
  if(upgradeSuggestionCopy) upgradeSuggestionCopy.textContent = state.upgrade && state.upgrade.reason ? state.upgrade.reason : 'Quando o uso ou a configuração da operação pedirem mais estrutura, a MercaBot mostra a recomendação certa.';
  if(upgradeSuggestionBtn){
    upgradeSuggestionBtn.textContent = state.upgrade && state.upgrade.shouldUpgrade && state.upgrade.targetPlan ? ('Ver upgrade para ' + state.upgrade.targetPlan + ' →') : 'Ver planos →';
  }
  if(usageHelperNote){
    usageHelperNote.textContent = state.channelConnected
      ? 'Esse bloco mostra o uso real do seu canal e ajuda a indicar upgrade só quando a operação pedir mais estrutura.'
      : 'Esse bloco passa a refletir uso real assim que o WhatsApp estiver conectado e começar a receber mensagens.';
  }
  var billingPrimary = document.getElementById('billingBtn');
  var billingSecondary = document.getElementById('billingBtnSecondary');
  var cancelPrimary = document.getElementById('cancelBtn');
  var cancelSecondary = document.getElementById('cancelBtnSecondary');
  var billingHelpText = document.getElementById('billingHelpText');
  if(billingPrimary) billingPrimary.textContent = hasBillingPortal ? 'Gerenciar pagamento' : 'Resolver pagamento';
  if(billingSecondary) billingSecondary.textContent = hasBillingPortal ? 'Gerenciar pagamento' : 'Resolver pagamento';
  if(cancelPrimary) cancelPrimary.textContent = hasBillingPortal ? 'Cancelar plano' : 'Resolver cancelamento';
  if(cancelSecondary) cancelSecondary.textContent = hasBillingPortal ? 'Cancelar plano' : 'Resolver cancelamento';
  if(billingHelpText){
    billingHelpText.textContent = hasBillingPortal
      ? 'Os botões acima abrem o portal seguro da sua conta para atualizar pagamento, revisar cobranças e cancelar o plano quando necessário.'
      : (state.billingPortalReason || 'Se o portal ainda não estiver disponível, a MercaBot leva você direto para o fluxo certo de suporte.');
  }
  updateClientSaveStates();
  bpHydrate();
  applyProgressiveDisclosure();
}

// ── Divulgação progressiva ────────────────────────────────────────────────────
// Controla quais seções do painel são visíveis de acordo com a etapa atual do
// usuário, evitando sobrecarga de informação durante o onboarding.
//
//  Fase 1 — sem WhatsApp salvo:
//    Mostra apenas o quickstart e o setup banner.
//  Fase 2 — WhatsApp salvo (pending), sem instrução preenchida:
//    Mostra também o card de instrução principal.
//  Fase 3 — WhatsApp salvo + instrução salva, canal ainda não conectado:
//    Mantém quickstart + setup banner + instrução (para revisão/edição).
//  Fase 4 — canal WhatsApp conectado (channelConnected):
//    Libera o painel completo.
function applyProgressiveDisclosure(){
  var channelSaved    = !!(state.channelConnected || state.channelPending);
  var channelConnected = !!state.channelConnected;
  var baseInstruction  = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
  var baseQuickReply   = (document.getElementById('quickReply1') && document.getElementById('quickReply1').value || '').trim();
  var configDone = !!(baseInstruction && baseQuickReply);
  // Painel completo liberado quando:
  //   a) canal realmente conectado (channelConnected), OU
  //   b) número salvo (pending ou conectado) + instrução + frase pronta preenchidas
  // Isso permite que usuários com channelPending + configDone acessem as seções
  // de operação, plano e conexões sem precisar aguardar a ativação Meta completa.
  var panelUnlocked = channelConnected || (channelSaved && configDone);

  function setVisible(id, visible, activeDisplay){
    var el = document.getElementById(id);
    if(!el) return;
    el.style.display = visible ? (activeDisplay || '') : 'none';
  }

  // Seção de instrução principal: aparece quando o WhatsApp está salvo (fase 2+)
  setVisible('instructionSection', channelSaved,    'grid');

  // Estatísticas, toggles, uso, perfil, plano e conexões:
  // liberados quando o painel estiver desbloqueado (fase 3+ ou canal conectado)
  setVisible('stats',               panelUnlocked, 'grid');
  setVisible('mainContentGrid',     panelUnlocked, 'grid');
  setVisible('businessProfileCard', panelUnlocked, '');
  setVisible('planBillingGrid',     panelUnlocked, 'grid');
  setVisible('connectionsCard',     panelUnlocked, '');
}
// ─────────────────────────────────────────────────────────────────────────────

function renderQuickstart(){
  var channelDone  = !!state.channelConnected;
  var channelSaved = !!(state.channelConnected || state.channelPending);
  var baseInstruction = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
  var baseQuickReply  = (document.getElementById('quickReply1') && document.getElementById('quickReply1').value || '').trim();
  var configDone = !!(baseInstruction && baseQuickReply);
  // readyForTest: número salvo (pending ou conectado) + instrução + frase pronta
  // A Etapa 3 é completável sem Meta conectada — o autoteste valida a IA independentemente.
  // A conexão Meta é um processo assistido que acontece em paralelo.
  var readyForTest = !!(channelSaved && configDone);
  var completedSteps = (channelSaved ? 1 : 0) + (configDone ? 1 : 0) + (readyForTest ? 1 : 0);
  var progressFill = document.getElementById('quickstartProgressFill');
  var progressCopy = document.getElementById('quickstartProgressCopy');
  if(progressFill){
    progressFill.style.width = (completedSteps / 3 * 100) + '%';
  }
  if(progressCopy){
    progressCopy.textContent = completedSteps === 0
      ? 'Etapa 1 de 3: vamos salvar o WhatsApp da empresa.'
      : completedSteps === 3
        ? '3 de 3 etapas concluídas — operação pronta para o primeiro teste.'
        : (completedSteps + ' de 3 etapas concluídas');
  }
  setQuickstartStep('qs1', {
    index: '1',
    done: channelSaved,
    label: channelSaved ? 'Concluído' : 'Agora',
    variant: channelSaved ? 'done' : 'current',
    actionLabel: channelDone ? 'Revisar WhatsApp' : (state.channelPending ? 'Revisar número salvo' : 'Informar WhatsApp')
  });
  setQuickstartStep('qs2', {
    index: '2',
    done: configDone,
    label: configDone ? 'Concluído' : (channelSaved ? 'Agora' : 'Depois'),
    variant: configDone ? 'done' : (channelSaved ? 'current' : 'pending'),
    actionLabel: configDone ? 'Revisar operação' : 'Preencher operação'
  });
  setQuickstartStep('qs3', {
    index: '3',
    done: readyForTest,
    label: readyForTest ? 'Pronto' : (configDone ? 'Agora' : 'Depois'),
    variant: readyForTest ? 'done' : (configDone ? 'current' : 'pending'),
    actionLabel: 'Fazer primeiro teste',
    actionDisabled: !readyForTest
  });
  document.getElementById('qs1Copy').textContent = channelDone
    ? 'Seu WhatsApp principal já está conectado. Agora falta revisar a operação e fazer o primeiro teste antes de divulgar.'
    : (state.channelPending
        ? 'Seu WhatsApp já foi salvo. A MercaBot pode seguir com a ativação enquanto você termina o cadastro.'
        : 'Comece salvando o WhatsApp principal da empresa. Essa é a primeira etapa para colocar a operação no ar.');
  document.getElementById('qs2Copy').textContent = configDone
    ? 'A base do atendimento já está salva. A IA já tem o contexto mínimo para começar bem.'
    : (channelSaved
        ? 'Agora preencha só o básico: como a IA deve atender e a primeira resposta rápida.'
        : 'Depois do WhatsApp, diga como a IA deve atender e salve a primeira resposta rápida.');
  document.getElementById('qs3Copy').textContent = readyForTest
    ? (channelDone
        ? 'Canal conectado e operação configurada. Faça um teste para validar a primeira resposta antes de divulgar.'
        : 'Número salvo e operação configurada. Rode o teste para ver a IA em ação. A ativação no WhatsApp segue com o apoio da MercaBot.')
    : (configDone
        ? 'Você já tem canal e contexto. O próximo passo é fazer o primeiro teste e validar a primeira resposta.'
        : 'O teste entra por último, quando o WhatsApp estiver salvo e a base do atendimento estiver preenchida.');
  // Inactivity banner: show while setup not complete, hide when all done
  var inactivityBanner = document.getElementById('inactivityBanner');
  if (inactivityBanner) {
    var allDone = channelSaved && configDone;
    inactivityBanner.style.display = allDone ? 'none' : 'flex';
    var inactivityStep = document.getElementById('inactivityStep');
    if (inactivityStep) {
      inactivityStep.textContent = !channelSaved
        ? 'Próximo: salvar o número oficial.'
        : (!configDone ? 'Próximo: preencher a base da operação.' : '');
    }
  }
}

function renderWorkspaceFields(){
  var activePlan = normalizePlan(state.plan);
  var rawWorkspace = state.workspace && typeof state.workspace === 'object' ? state.workspace : {};
  var hasSavedWorkspace = Object.keys(rawWorkspace).length > 0;
  var workspaceBase = (!activePlan && !hasSavedWorkspace) ? getEmptyWorkspace() : getDefaultWorkspace(activePlan || 'Starter');
  var workspace = Object.assign(workspaceBase, rawWorkspace);
  state.workspace = workspace;
  document.getElementById('opNotes').value = workspace.notes || '';
  document.getElementById('specialHours').value = workspace.specialHours || '';
  document.getElementById('quickReply1').value = (workspace.quickReplies && workspace.quickReplies[0]) || '';
  document.getElementById('quickReply2').value = (workspace.quickReplies && workspace.quickReplies[1]) || '';
  document.getElementById('quickReply3').value = (workspace.quickReplies && workspace.quickReplies[2]) || '';
  // Remove extras anteriores e repopula do workspace salvo
  var replyGrid = document.getElementById('replyGrid');
  if(replyGrid){
    replyGrid.querySelectorAll('.quick-reply-extra').forEach(function(el){ el.remove(); });
    if(Array.isArray(workspace.quickReplies)){
      for(var qi = 3; qi < workspace.quickReplies.length; qi++){
        if(workspace.quickReplies[qi]) addQuickReplyField(workspace.quickReplies[qi], true);
      }
    }
  }
  document.getElementById('operationGoal').value = workspace.goal || '';
  document.getElementById('leadLabels').value = workspace.leadLabels || '';
  document.getElementById('priorityReplies').value = workspace.priorityReplies || '';
  document.getElementById('followupReminder').value = workspace.followupReminder || '';
  var advancedEnabled = !!activePlan && activePlan !== 'Starter';
  document.getElementById('advancedOpsCard').style.display = advancedEnabled ? '' : 'none';
  document.getElementById('advancedOpsBadge').textContent = advancedEnabled ? 'Pro+' : (activePlan || 'Plano');
  document.getElementById('advancedOpsHint').textContent = advancedEnabled
    ? 'Esses ajustes refinam a operação quando você quiser ganhar mais controle.'
    : 'Os ajustes avançados aparecem automaticamente quando sua conta sobe para o plano Pro.';
}

function buildGuidedConfigLink(){
  var cfg = {
    nome: state.company || 'Meu negócio',
    nia: 'Atendente MercaBot',
    human: state.waNumber || '',
    seg: 'Atendimento comercial',
    hr: state.settings.tgHorario ? 'Seg–Sex 8h–18h' : 'Atendimento flexível',
    desc: state.company ? ('Atendimento da empresa ' + state.company + ' via WhatsApp com ativação digital.') : 'Atendimento via WhatsApp com ativação digital.',
    faq: 'P: O que a MercaBot faz? R: A MercaBot transforma o WhatsApp em um canal de atendimento e vendas com IA, qualificação de leads e ativação guiada.\nP: Qual plano é melhor para mim? R: Starter é para operação inicial, Pro para controle comercial e qualificação, Parceiro para revenda e carteira multi-cliente.\nP: Preciso de equipe técnica para começar? R: Não. A ativação é guiada e a equipe do MercaBot entra quando o contexto pedir.\nP: Funciona para atendimento e vendas? R: Sim. O foco é responder rápido, organizar a conversa e levar o cliente ao próximo passo com clareza.\nP: Posso revender? R: Sim. O plano Parceiro foi desenhado para white-label e operação com vários clientes.',
    deve: 'Entender o perfil do lead rapidamente, explicar o produto em linguagem simples, mostrar por que o MercaBot é uma opção mais organizada e recomendar o plano com justificativa clara. Sempre convidar para seguir no WhatsApp quando isso acelerar a decisão.',
    nunca: 'Prometer integração ou prazo sem contexto, inventar funcionalidade, empurrar o plano mais caro sem motivo, usar jargão técnico desnecessário ou insistir quando a dúvida precisa de alguém da equipe.',
    tom: 'amigavel',
    gen: 'feminino',
    tamv: 1,
    forv: 1,
    emov: 1
  };
  try{
    var str = JSON.stringify(cfg);
    var encoded = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(_, p1){ return String.fromCharCode('0x'+p1); }));
    return '/demo?cfg=' + encoded;
  }catch(_){
    return '/demo';
  }
}

async function loadAuthenticatedState(){
  var nonce = ++authLoadNonce;
  if(!supabaseClient || !supabaseClient.auth){
    showAuth('Biblioteca de autenticação indisponível. Atualize a página para continuar.', true);
    return;
  }
  try{
    await establishSessionFromUrl();
    if(nonce !== authLoadNonce) return;
    var sessionResult = await supabaseClient.auth.getSession();
    if(nonce !== authLoadNonce) return;
    var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
    if(!session || !session.user){
      authBootstrapDone = true;
      showAuth('', false);
      return;
    }
    if(!isClientAppRoute()){
      window.location.replace('/painel-cliente/app/?continue=1');
      return;
    }
    currentUser = session.user;
    var fallbackProfile = {
      id: currentUser.id,
      email: currentUser.email || '',
      full_name: (currentUser.user_metadata && (currentUser.user_metadata.full_name || currentUser.user_metadata.name)) || '',
      role: (currentUser.user_metadata && currentUser.user_metadata.role) || ''
    };
    var fallbackCustomer = {
      user_id: currentUser.id,
      company_name: (fallbackProfile.full_name || currentUser.email || '').split('@')[0] || 'Nova conta',
      whatsapp_number: '',
      plan_code: 'starter',
      status: 'trial',
      stripe_customer_id: ''
    };
    var resolvedProfile = fallbackProfile;
    var resolvedCustomer = fallbackCustomer;
    try{
      // Promise.allSettled garante que uma falha isolada não descarta o resultado da outra query
      var panelTasks = await Promise.allSettled([
        supabaseClient.from('profiles').select('id,email,full_name,role').eq('id', currentUser.id).limit(1),
        supabaseClient.from('customers').select('*').eq('user_id', currentUser.id).limit(1)
      ]);
      var profileResult  = panelTasks[0].status === 'fulfilled' ? panelTasks[0].value : null;
      var customerResult = panelTasks[1].status === 'fulfilled' ? panelTasks[1].value : null;
      var profileCandidate  = profileResult  && !profileResult.error  && Array.isArray(profileResult.data)  ? profileResult.data[0]  : null;
      var customerCandidate = customerResult && !customerResult.error && Array.isArray(customerResult.data) ? customerResult.data[0] : null;
      if(profileCandidate && typeof profileCandidate === 'object'){
        resolvedProfile = Object.assign({}, fallbackProfile, profileCandidate);
      }
      if(customerCandidate && typeof customerCandidate === 'object'){
        resolvedCustomer = Object.assign({}, fallbackCustomer, customerCandidate);
      }
    }catch(_){}
    if(nonce !== authLoadNonce) return;
    currentCustomer = resolvedCustomer;
    currentSettings = null;
    hydrateState(resolvedProfile, currentCustomer, currentSettings);
    renderState();
    showApp();
    authBootstrapDone = true;
    var urlTab = new URLSearchParams(window.location.search).get('tab');
    var initialTab = hasContinueMode() ? 'dashboard' : (urlTab && ['dashboard','plano','suporte'].includes(urlTab) ? urlTab : getStoredClientTab());
    switchTab(initialTab, { persist:false, scrollPage:hasContinueMode(), smooth:false });
    clearContinueMode();
    document.querySelectorAll('a[href="/demo/"]').forEach(function(link){
      link.setAttribute('href', buildGuidedConfigLink());
    });
    hydratePanelFragments(session.access_token).then(function(){
      renderState();
      if(window.MBWizard){
        var hasExistingSetup = !!(
          state.workspace &&
          (state.workspace.notes || (Array.isArray(state.workspace.quickReplies) && state.workspace.quickReplies[0]))
        );
        window.MBWizard.init({
          hasExistingSetup: hasExistingSetup,
          onComplete: function(){
            if(typeof renderState === 'function') renderState();
            setTimeout(function(){
              var btn = document.getElementById('channelActionBtn');
              if(btn) btn.click();
            }, 400);
          },
          onSkip: function(){
            if(typeof renderState === 'function') renderState();
          }
        });
      }
    }).catch(function(){});
    refreshAccountSummary(session.access_token).then(function(){
      renderState();
    }).catch(function(){});
    return;
  }catch(_){
    authBootstrapDone = true;
    showAuth('Não foi possível concluir o acesso automaticamente por este link. Peça um novo link para continuar.', true);
  }
}

async function comprarAddon(qty, evt) {
  var quantity = Math.min(Math.max(parseInt(qty || 1, 10), 1), 10);
  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if (!jwt) { toast('Faça login para continuar.'); return; }
  var btn = (evt && evt.target) ? evt.target : null;
  var originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Aguarde...'; }
  try {
    var res = await fetch(ADDON_CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'pt', quantity: quantity }),
    });
    var data = await res.json();
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      toast((data && data.error) || 'Erro ao iniciar checkout. Tente novamente.');
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  } catch(e) {
    toast('Erro de conexão. Tente novamente.');
    if (btn) { btn.disabled = false; if (originalText) btn.textContent = originalText; }
  }
}

async function refreshAccountSummary(jwt){
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, 4500) : null;
  try{
    var res = await fetch(ACCOUNT_SUMMARY_URL, {
      method:'GET',
      headers:{ 'Authorization':'Bearer ' + jwt },
      signal: controller ? controller.signal : undefined
    });
    var body = await res.json().catch(function(){ return {}; });
    if(!res.ok || !body || !body.summary) return false;
    if(body.customer) currentCustomer = Object.assign({}, currentCustomer || {}, body.customer);
    if(body.settings) currentSettings = Object.assign({}, currentSettings || {}, body.settings);
    if(body.workspace) state.workspace = body.workspace;
    if(body.channel && typeof body.channel === 'object'){
      state.channelProvider = body.channel.provider || 'meta';
      state.channelPhoneNumberId = body.channel.phone_number_id || '';
      state.channelTokenMasked = body.channel.access_token_masked || '';
      state.channelVerifiedName = body.channel.verified_name || '';
      state.waNumber = body.channel.display_phone_number || state.waNumber || '';
      state.channelConnected = !!(state.channelPhoneNumberId && state.channelTokenMasked);
      state.channelPending = !state.channelConnected && !!state.waNumber;
    }
    applyAccountSummary(body.summary);
    return true;
  }catch(_){
    return false;
  } finally {
    if(timeoutId) clearTimeout(timeoutId);
  }
}

async function persistSettings(payload){
  var sessionResult = await supabaseClient.auth.getSession();
  var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
  if(!jwt){
    toast('Sua sessão expirou. Entre novamente para continuar.');
    return false;
  }
  var result = await postAuthorizedJson(ACCOUNT_SETTINGS_URL, jwt, payload || {}, 5000);
  var body = result.body || {};
  if(!result.ok){
    toast(body.error || 'Não foi possível salvar as configurações da conta.');
    return false;
  }
  if(body.settings) applySettingsPayload(body.settings);
  if(body.summary) applyAccountSummary(body.summary);
  return true;
}

async function persistWorkspace(mode, workspacePayload, successMessage){
  var sessionResult = await supabaseClient.auth.getSession();
  var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
  if(!jwt){
    toast('Sua sessão expirou. Entre novamente para continuar.');
    return false;
  }
  var result = await postAuthorizedJson(ACCOUNT_WORKSPACE_URL, jwt, {
    mode: mode,
    workspace: workspacePayload || {}
  }, 6000);
  var body = result.body || {};
  if(!result.ok){
    toast(body.error || 'Não foi possível salvar a configuração operacional.');
    return false;
  }
  if(body.workspace) state.workspace = body.workspace;
  if(body.summary) applyAccountSummary(body.summary);
  if(successMessage) toast(successMessage);
  return true;
}

async function saveWorkspaceBase(){
  var btn = document.getElementById('saveWorkspaceBaseBtn');
  if(btn && btn.classList.contains('no-changes')) return; // sem alterações pendentes
  setButtonBusy('saveWorkspaceBaseBtn', true, 'Salvando...');
  try{
    await persistWorkspace('base', getBaseWorkspaceDraftFromInputs(), 'Base da operação salva.');
    renderState();
  } finally {
    setButtonBusy('saveWorkspaceBaseBtn', false);
  }
}

async function saveWorkspaceAdvanced(){
  var btn = document.getElementById('saveWorkspaceAdvancedBtn');
  if(btn && btn.classList.contains('no-changes')) return; // sem alterações pendentes
  if(state.plan === 'Starter'){
    toast('Os recursos avançados aparecem quando sua operação sobe para o plano Pro.');
    return;
  }
  setButtonBusy('saveWorkspaceAdvancedBtn', true, 'Salvando...');
  try{
    await persistWorkspace('advanced', getAdvancedWorkspaceDraftFromInputs(), 'Operação avançada salva.');
    renderState();
  } finally {
    setButtonBusy('saveWorkspaceAdvancedBtn', false);
  }
}

async function toggleBot(){
  if(!state.channelConnected){
    toast('Conecte o WhatsApp oficial da sua empresa antes de ativar o atendimento automático.');
    return;
  }
  var previousState = !!state.botOn;
  state.botOn = !state.botOn;
  var botToggle = document.getElementById('botToggle');
  if(botToggle) botToggle.setAttribute('aria-pressed', state.botOn ? 'true' : 'false');
  renderBotState();
  var saved = await persistSettings({ bot_enabled: state.botOn });
  if(saved){
    toast(state.botOn ? 'Atendimento automático pronto para os próximos testes.' : 'Atendimento automático pausado.');
    renderState();
    return;
  }
  state.botOn = previousState;
  if(botToggle) botToggle.setAttribute('aria-pressed', state.botOn ? 'true' : 'false');
  renderBotState();
}

async function toggleSetting(id){
  var el = document.getElementById(id);
  if(!el) return;
  var previousState = !!state.settings[id];
  state.settings[id] = !state.settings[id];
  if(state.settings[id]) el.classList.add('on'); else el.classList.remove('on');
  if(el) el.setAttribute('aria-pressed', state.settings[id] ? 'true' : 'false');
  var payload = {};
  if(id === 'tgHorario') payload.business_hours_enabled = state.settings[id];
  if(id === 'tgLeads') payload.lead_qualification_enabled = state.settings[id];
  if(id === 'tgFollowup') payload.followup_enabled = state.settings[id];
  if(id === 'tgHuman') payload.human_handoff_enabled = state.settings[id];
  var saved = await persistSettings(payload);
  if(saved){
    toast('Configuração atualizada.');
    renderState();
    return;
  }
  state.settings[id] = previousState;
  if(state.settings[id]) el.classList.add('on'); else el.classList.remove('on');
  el.setAttribute('aria-pressed', state.settings[id] ? 'true' : 'false');
}

function editChannel(){
  document.getElementById('channelNumber').value = state.waNumber || '';
  document.getElementById('channelPhoneId').value = state.channelPhoneNumberId || '';
  document.getElementById('channelToken').value = '';
  var showAdvanced = !!state.channelPhoneNumberId;
  document.getElementById('advancedChannelFields').style.display = showAdvanced ? 'block' : 'none';
  var toggleBtn = document.getElementById('toggleManualChannelBtn');
  if(toggleBtn){
    toggleBtn.textContent = showAdvanced ? 'Ocultar campos manuais' : 'Prefiro inserir os dados manualmente';
  }
  syncChannelActionButtons();
  openOverlay('channelOverlay');
}

function toggleAdvancedChannel(){
  var box = document.getElementById('advancedChannelFields');
  var open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  box.setAttribute('aria-hidden', open ? 'false' : 'true');
  syncChannelActionButtons();
}

function saveHelpDraft(text){
  try { localStorage.setItem('mb_help_draft', text); } catch(_) {}
}

function openChannelSupport(){
  var number = document.getElementById('channelNumber').value.trim() || state.waNumber || '';
  var phoneNumberId = document.getElementById('channelPhoneId').value.trim() || state.channelPhoneNumberId || '';
  var draft = 'Pedido de ativação assistida do canal oficial\n\n';
  draft += 'Empresa: ' + (state.company || 'não informada') + '\n';
  if(number){
    draft += 'Número informado: ' + number + '\n';
  }
  if(phoneNumberId){
    draft += 'Phone number ID: ' + phoneNumberId + '\n';
  }
  draft += '\nA MercaBot deve conduzir a ativação oficial do canal e orientar apenas as aprovações necessárias do cliente.';
  saveHelpDraft(draft);
  window.open('/suporte/', '_blank');
  toast('Resumo salvo. A central digital foi aberta para seguir com a ativação assistida.');
}

function renderChannelSelfTestResult(data, isError){
  var wrap = document.getElementById('channelSelfTestResult');
  var summary = document.getElementById('channelSelfTestSummary');
  var preview = document.getElementById('channelSelfTestPreview');
  if(!wrap || !summary || !preview) return;
  var readiness = data && data.readiness ? data.readiness : {};
  var checks = [
    'IA premium: ' + (readiness.anthropic ? 'ok' : 'pendente'),
    'Número oficial salvo: ' + (readiness.displayPhone ? 'ok' : 'pendente'),
    'Phone number ID: ' + (readiness.phoneNumberId ? 'ok' : 'pendente'),
    'Token do canal: ' + (readiness.accessToken ? 'ok' : 'pendente')
  ];
  if(readiness.verifiedName){
    checks.push('Nome verificado: ok');
  }
  // Diagnóstico de estado: se a IA está ok mas as credenciais Meta estão pendentes,
  // mostramos uma mensagem encorajadora em vez de erro — o usuário não pode resolver isso sozinho.
  var aiOk = !!(readiness.anthropic);
  var channelCredentialsPending = !readiness.phoneNumberId || !readiness.accessToken;
  var pendingChannelOnly = isError && aiOk && channelCredentialsPending;
  var displayLabel = pendingChannelOnly
    ? 'IA configurada e pronta. '
    : (isError ? 'O primeiro teste guiado ainda não passou. ' : 'Primeiro teste guiado concluído. ');
  wrap.style.display = 'block';
  wrap.style.borderColor = pendingChannelOnly ? 'rgba(0,230,118,.35)' : (isError ? 'rgba(255,184,0,.35)' : 'var(--green-border)');
  summary.textContent = displayLabel + checks.join(' · ')
    + (pendingChannelOnly ? ' · A ativação no WhatsApp segue com o apoio da MercaBot.' : '');
  if(data && data.preview){
    preview.style.display = 'block';
    preview.style.borderColor = isError ? 'rgba(255,184,0,.35)' : 'var(--green-border)';
    preview.style.background = isError ? 'rgba(255,184,0,.06)' : 'rgba(0,255,136,.06)';
      preview.textContent = 'Prévia da resposta da IA:\n' + data.preview;
  } else {
    preview.style.display = data && data.error ? 'block' : 'none';
    preview.style.borderColor = 'rgba(255,184,0,.35)';
    preview.style.background = 'rgba(255,184,0,.06)';
    preview.textContent = data && data.error ? data.error : '';
  }
}

async function runChannelSelfTest(){
  var number = document.getElementById('channelNumber').value.trim() || state.waNumber || '';
  if(!number){
    toast('Salve o número oficial antes de rodar o primeiro teste.');
    return;
  }
  if(!(document.getElementById('opNotes').value || '').trim()){
    closeOverlay('channelOverlay');
    focusOperationsBase();
    toast('Escreva a instrução principal antes de rodar o primeiro teste. Role até "Instrução principal do bot".');
    return;
  }
  if(!(document.getElementById('quickReply1').value || '').trim()){
    closeOverlay('channelOverlay');
    focusOperationsBase();
    toast('Salve pelo menos a primeira frase pronta antes de rodar o primeiro teste.');
    return;
  }
  try{
    setButtonBusy('runChannelSelfTestBtn', true, 'Rodando teste...');
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
    if(!jwt){
      toast('Sua sessão expirou. Entre novamente para rodar o autoteste.');
      return;
    }
    toast('Rodando o primeiro teste guiado da IA e do canal...');
    var res = await postAuthorizedJson(WHATSAPP_CHANNEL_SELF_TEST_URL, jwt, {}, 18000);
    var body = res.body || {};
    renderChannelSelfTestResult(body, !res.ok);
    if(!res.ok){
      toast(body.error || 'O primeiro teste ainda não passou.');
      return;
    }
    toast('Primeiro teste aprovado. A IA respondeu como esperado.');
  }catch(_){
    toast('O primeiro teste falhou. Revise o número e a conexão técnica e tente novamente.');
  } finally {
    setButtonBusy('runChannelSelfTestBtn', false);
  }
}

async function saveChannel(){
  var number = document.getElementById('channelNumber').value.trim();
  var phoneNumberId = document.getElementById('channelPhoneId').value.trim();
  var accessToken = document.getElementById('channelToken').value.trim();
  if(!number){
    toast('Informe o número oficial da sua empresa.');
    return;
  }
  if((phoneNumberId && !accessToken) || (!phoneNumberId && accessToken)){
    toast('Para concluir a conexão, informe o código do número e a chave de acesso juntos.');
    return;
  }
  if(phoneNumberId && !/^\d{8,}$/.test(phoneNumberId)){
    toast('O código do número deve conter apenas dígitos. Verifique no painel da Meta.');
    return;
  }
  if(accessToken && accessToken.length < 20){
    toast('A chave de acesso precisa ter pelo menos 20 caracteres. Verifique no painel da Meta.');
    return;
  }
  try{
    setButtonBusy('saveChannelBtn', true, 'Salvando canal...');
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
    if(!jwt){
      toast('Sua sessão expirou. Entre novamente para salvar o canal.');
      return;
    }
    var pendingOnly = !phoneNumberId || !accessToken;
    toast(pendingOnly ? 'Salvando seu número oficial...' : 'Validando e salvando o canal oficial...');
    var saveRes = await postAuthorizedJson(WHATSAPP_CHANNEL_SAVE_URL, jwt, {
      channel: {
        provider: 'meta',
        display_phone_number: number,
        phone_number_id: phoneNumberId,
        access_token: accessToken
      }
    }, 12000);
    var saveBody = saveRes.body || {};
    if(!saveRes.ok){
      toast(saveBody.error || 'Não foi possível salvar o canal oficial.');
      return;
    }
    state.waNumber = saveBody.channel && saveBody.channel.display_phone_number ? saveBody.channel.display_phone_number : number;
    state.channelProvider = saveBody.channel && saveBody.channel.provider ? saveBody.channel.provider : (pendingOnly ? 'pending' : 'meta');
    state.channelPhoneNumberId = saveBody.channel && saveBody.channel.phone_number_id ? saveBody.channel.phone_number_id : phoneNumberId;
    state.channelTokenMasked = saveBody.channel && saveBody.channel.access_token_masked ? saveBody.channel.access_token_masked : 'Token salvo';
    state.channelVerifiedName = saveBody.channel && saveBody.channel.verified_name ? saveBody.channel.verified_name : '';
    state.channelConnected = !(saveBody.channel && saveBody.channel.pending);
    state.channelPending = !state.channelConnected && !!state.waNumber;
    closeOverlay('channelOverlay');
    renderState();
    toast(state.channelConnected ? 'Canal oficial conectado com sucesso.' : 'Número salvo. A MercaBot pode seguir com a ativação assistida deste canal.');
  }catch(_){
    toast('Falha ao salvar o canal oficial. Tente novamente.');
  } finally {
    setButtonBusy('saveChannelBtn', false);
  }
}

function openRequest(){ openOverlay('requestOverlay'); }
function openUpgrade(){
  document.querySelectorAll('input[name="planOpt"]').forEach(function(radio){
    radio.checked = false;
  });
  var currentPlanRadio = document.querySelector('input[name="planOpt"][value="' + state.plan + '"]');
  if(currentPlanRadio) currentPlanRadio.checked = true;
  syncUpgradeOptions();
  openOverlay('upgradeOverlay');
}
function syncUpgradeOptions(){
  document.querySelectorAll('.plan-option').forEach(function(option){
    option.classList.remove('active');
  });
  var selected = document.querySelector('input[name="planOpt"]:checked');
  if(!selected) return;
  var selectedOption = selected.closest('.plan-option');
  if(selectedOption) selectedOption.classList.add('active');
}
var _overlayPrevFocus = null;
var _overlayFocusTrap = null;
var _overlayTrapTarget = null;
var FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
function openOverlay(id){
  var overlay = document.getElementById(id);
  if(!overlay) return;
  _overlayPrevFocus = document.activeElement;
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
  var firstField = overlay.querySelector(FOCUSABLE_SEL);
  if(firstField && typeof firstField.focus === 'function'){
    setTimeout(function(){ firstField.focus(); }, 20);
  }
  // Focus trap — keeps Tab cycling inside the open modal
  if(_overlayFocusTrap && _overlayTrapTarget){
    _overlayTrapTarget.removeEventListener('keydown', _overlayFocusTrap);
  }
  _overlayTrapTarget = overlay;
  _overlayFocusTrap = function(e){
    if(e.key !== 'Tab') return;
    var focusable = Array.from(overlay.querySelectorAll(FOCUSABLE_SEL)).filter(function(el){ return el.offsetParent !== null; });
    if(!focusable.length){ e.preventDefault(); return; }
    var first = focusable[0], last = focusable[focusable.length - 1];
    if(e.shiftKey){ if(document.activeElement === first){ e.preventDefault(); last.focus(); } }
    else          { if(document.activeElement === last ){ e.preventDefault(); first.focus(); } }
  };
  overlay.addEventListener('keydown', _overlayFocusTrap);
}
function closeOverlay(id){
  var overlay = document.getElementById(id);
  if(!overlay) return;
  if(_overlayFocusTrap && _overlayTrapTarget === overlay){
    overlay.removeEventListener('keydown', _overlayFocusTrap);
    _overlayFocusTrap = null;
    _overlayTrapTarget = null;
  }
  overlay.classList.remove('open');
  if(!document.querySelector('.overlay.open')){
    document.body.classList.remove('modal-open');
    if(_overlayPrevFocus && typeof _overlayPrevFocus.focus === 'function'){
      _overlayPrevFocus.focus();
      _overlayPrevFocus = null;
    }
  }
}

// ── CUSTOM CONFIRM ───────────────────────────────────────────────
var _clientConfirmCb = null;
function showClientConfirm(message, onConfirm, confirmLabel, cancelLabel){
  var msgEl = document.getElementById('clientConfirmMsg');
  var okBtn = document.getElementById('clientConfirmOkBtn');
  var cancelBtn = document.getElementById('clientConfirmCancelBtn');
  if(msgEl) msgEl.textContent = message;
  if(okBtn) okBtn.textContent = confirmLabel || 'Confirmar';
  if(cancelBtn) cancelBtn.textContent = cancelLabel || 'Cancelar';
  _clientConfirmCb = onConfirm || null;
  openOverlay('clientConfirmOverlay');
}
(function(){
  var okBtn = document.getElementById('clientConfirmOkBtn');
  var cancelBtn = document.getElementById('clientConfirmCancelBtn');
  if(okBtn) okBtn.addEventListener('click', function(){
    closeOverlay('clientConfirmOverlay');
    if(typeof _clientConfirmCb === 'function'){ var cb = _clientConfirmCb; _clientConfirmCb = null; cb(); }
  });
  if(cancelBtn) cancelBtn.addEventListener('click', function(){
    _clientConfirmCb = null;
    closeOverlay('clientConfirmOverlay');
  });
  var overlay = document.getElementById('clientConfirmOverlay');
  if(overlay) overlay.addEventListener('click', function(e){ if(e.target === overlay){ _clientConfirmCb = null; closeOverlay('clientConfirmOverlay'); }});
}());

function submitRequest(){
  var s = document.getElementById('tkSubject').value.trim();
  var d = document.getElementById('tkDetail').value.trim();
  if(!s){ toast('Informe o assunto.'); return; }
  if(!d){ toast('Descreva o problema para a equipe entender o contexto.'); return; }
  closeOverlay('requestOverlay');
  var draft = 'Resumo do que precisa ser resolvido\n\nAssunto: ' + s;
  draft += '\nDescrição: ' + d;
  draft += '\n\nAbra a central digital e siga o fluxo mais adequado para cobrança, ativação ou ajustes da conta.';
  saveHelpDraft(draft);
  window.open('/suporte', '_blank');
  toast('Resumo salvo. A central digital foi aberta em outra aba.');
}

function doUpgrade(){
  var selected = document.querySelector('input[name="planOpt"]:checked');
  closeOverlay('upgradeOverlay');
  if(!selected){
    toast('Escolha o plano desejado para continuar.');
    return;
  }
  if(String(selected.value || '') === String(state.plan || '')){
    toast('Esse já é o plano ativo da sua conta.');
    return;
  }
  var planMap = { Starter:'starter', Pro:'pro', Parceiro:'parceiro' };
window.location.href = '/cadastro?plano=' + (planMap[selected.value] || 'pro');
}

function setBillingButtonState(loading){
  ['billingBtn','cancelBtn','billingBtnSecondary','cancelBtnSecondary'].forEach(function(id){
    var btn = document.getElementById(id);
    if(!btn) return;
    btn.disabled = !!loading;
    btn.style.opacity = loading ? '.65' : '1';
    btn.style.pointerEvents = loading ? 'none' : 'auto';
  });
}

function openBillingPortal(mode){
  setBillingButtonState(true);
  supabaseClient.auth.getSession().then(async function(sessionResult){
    try{
      var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
      if(!jwt){
        throw new Error('Sua sessão expirou. Entre novamente para continuar.');
      }
      var portalRes = await postAuthorizedJson(BILLING_PORTAL_URL, jwt, { mode: mode }, 8000);
      var portalBody = portalRes.body || {};
      if(portalRes.ok && portalBody && portalBody.url){
        window.open(portalBody.url, '_blank');
        toast(mode === 'cancel'
          ? 'Portal aberto para cancelar o plano.'
          : 'Portal aberto para gerenciar pagamento.');
        return;
      }
      var draft = mode === 'cancel'
        ? 'Cancelar plano\n\nAbra o fluxo guiado da conta para seguir com o cancelamento.'
        : 'Gerenciar pagamento\n\nAbra o fluxo guiado da conta para seguir com cobrança e forma de pagamento.';
      saveHelpDraft(draft);
      window.open('/suporte', '_blank');
      toast(mode === 'cancel'
        ? 'Portal indisponível agora. A central digital foi aberta para seguir com o cancelamento.'
        : 'Portal indisponível agora. A central digital foi aberta para seguir com pagamento e cobrança.');
    }catch(err){
      toast('Não foi possível abrir o portal agora. Use a central digital para continuar.');
    } finally {
      setBillingButtonState(false);
    }
  });
}

function toast(msg){
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); },4000);
}

function keepOnlyDigits(value){
  return String(value || '').replace(/\D+/g, '');
}

function formatOfficialNumber(value){
  var digits = keepOnlyDigits(value).slice(0, 15);
  if(!digits) return '';
  if(digits.length <= 2) return '+' + digits;
  var country = digits.slice(0, 2);
  var rest = digits.slice(2);
  if(rest.length <= 2) return '+' + country + ' ' + rest;
  if(rest.length <= 7) return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2);
  if(rest.length <= 11) return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2, rest.length - 4) + '-' + rest.slice(rest.length - 4);
  return '+' + country + ' ' + rest.slice(0, 2) + ' ' + rest.slice(2, 7) + '-' + rest.slice(7, 11);
}

function bindChannelFieldFormatting(){
  var numberField = document.getElementById('channelNumber');
  var phoneIdField = document.getElementById('channelPhoneId');
  var tokenField = document.getElementById('channelToken');
  if(numberField){
    numberField.addEventListener('input', function(){
      numberField.value = formatOfficialNumber(numberField.value);
      syncChannelActionButtons();
    });
  }
  if(phoneIdField){
    phoneIdField.addEventListener('input', function(){
      phoneIdField.value = keepOnlyDigits(phoneIdField.value).slice(0, 24);
      syncChannelActionButtons();
    });
  }
  if(tokenField){
    tokenField.addEventListener('input', syncChannelActionButtons);
  }
}

// Cria um campo de frase pronta adicional dinamicamente.
// silent=true ao repopular do workspace salvo (não foca nem dispara updateClientSaveStates imediato)
function addQuickReplyField(value, silent){
  var replyGrid = document.getElementById('replyGrid');
  if(!replyGrid) return;
  var idx = replyGrid.querySelectorAll('.quick-reply-input').length + 1;

  var wrap = document.createElement('div');
  wrap.className = 'quick-reply-extra';
  wrap.style.cssText = 'display:flex;gap:6px;align-items:center';

  var inp = document.createElement('input');
  inp.type = 'text';
  inp.maxLength = 220;
  inp.className = 'quick-reply-input';
  inp.style.cssText = 'flex:1;min-width:0';
  inp.placeholder = 'Opcional — Escreva mais uma frase pronta';
  inp.value = value || '';
  inp.setAttribute('aria-label', 'Frase pronta ' + idx + ' (opcional)');
  inp.addEventListener('input', updateClientSaveStates);
  inp.addEventListener('change', updateClientSaveStates);

  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remover esta frase';
  removeBtn.setAttribute('aria-label', 'Remover frase pronta ' + idx);
  removeBtn.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:.85rem;padding:.35rem .5rem;flex-shrink:0;border-radius:6px;line-height:1;transition:color .15s';
  removeBtn.addEventListener('mouseenter', function(){ this.style.color = '#ef4444'; });
  removeBtn.addEventListener('mouseleave', function(){ this.style.color = 'var(--muted)'; });
  removeBtn.addEventListener('click', function(){
    wrap.remove();
    updateClientSaveStates();
  });

  wrap.appendChild(inp);
  wrap.appendChild(removeBtn);
  replyGrid.appendChild(wrap);

  if(!silent){
    inp.focus();
    updateClientSaveStates();
  }
}

function bindClientDirtyTracking(){
  ['opNotes','specialHours','quickReply1','quickReply2','quickReply3','operationGoal','leadLabels','priorityReplies','followupReminder','channelNumber','channelPhoneId','channelToken'].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.addEventListener('input', updateClientSaveStates);
    el.addEventListener('change', updateClientSaveStates);
  });
  // Botão para adicionar nova frase pronta
  var addBtn = document.getElementById('addQuickReplyBtn');
  if(addBtn) addBtn.addEventListener('click', function(){ addQuickReplyField('', false); });
}

document.querySelectorAll('.overlay').forEach(function(o){
  o.addEventListener('click',function(e){ if(e.target===o) closeOverlay(o.id); });
});
document.addEventListener('keydown', function(event){
  if(event.key !== 'Escape') return;
  var opened = document.querySelector('.overlay.open');
  if(opened) closeOverlay(opened.id);
});

// Show loading state immediately (synchronous) while the CDN bundle loads.
showBoot('Verificando seu acesso...');

// Async bootstrap — waits for vendor/supabase.js CDN to finish injecting,
// then creates the client and starts the auth flow.
(async function(){
  // Delegate to auth-utils helper (loaded before this script).
  supabaseClient = (window.__mbAuth && typeof window.__mbAuth.waitForSupabaseClient === 'function')
    ? await window.__mbAuth.waitForSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{flowType:'implicit'}})
    : null;

  if(supabaseClient && supabaseClient.auth){
    supabaseClient.auth.onAuthStateChange(function(event, session){
      if((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session && session.user){
        loadAuthenticatedState();
      }
      if(event === 'SIGNED_OUT'){
        authBootstrapDone = true;
        storeClientTab('dashboard');
        resetClientState();
        showAuth('Sessão encerrada.', false);
      }
    });
    loadAuthenticatedState();
  } else {
    showAuth('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
  }
})();

// ── TABS ─────────────────────────────────────────────────────────
function switchTab(id, options) {
  var cfg = Object.assign({ persist:true, scrollPage:false, smooth:false }, options || {});
  var tabId = getAllowedClientTabs().indexOf(id) >= 0 ? id : 'dashboard';
  var tabPage = document.getElementById('tab-' + tabId);
  if(!tabPage) return;
  document.querySelectorAll('.tab-btn').forEach(function(b){
    b.classList.remove('active');
    b.setAttribute('aria-selected','false');
  });
  document.querySelectorAll('.tab-page').forEach(function(p){ p.classList.remove('active'); });
  tabPage.classList.add('active');
  var activeBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if(activeBtn){
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected','true');
    if(typeof activeBtn.scrollIntoView === 'function'){
      activeBtn.scrollIntoView({ block:'nearest', inline:'center', behavior: cfg.smooth ? 'smooth' : 'auto' });
    }
  }
  if(cfg.persist){
    storeClientTab(tabId);
  }
  if(cfg.scrollPage && typeof tabPage.scrollIntoView === 'function'){
    tabPage.scrollIntoView({ block:'start', behavior: cfg.smooth ? 'smooth' : 'auto' });
  }
  updateClientBreadcrumb(tabId);
}

function bindClientPanelActions(){
  function bindClick(id, handler){
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', handler);
  }
  function bindOverlayOpeners(selector, opener){
    document.querySelectorAll(selector).forEach(function(el){
      el.addEventListener('click', opener);
      el.addEventListener('keydown', function(event){
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();
          opener();
        }
      });
    });
  }

bindClick('logoutBtn', function(){ signOut(); });
  bindClick('authBtn', sendMagicLink);
bindClick('continueSessionBtn', continueExistingSession);
bindClick('useAnotherAccountBtn', useAnotherAccount);
bindChannelFieldFormatting();
  bindClientDirtyTracking();
  document.querySelectorAll('.tab-btn[data-tab]').forEach(function(btn){
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
    btn.addEventListener('click', function(){ switchTab(btn.getAttribute('data-tab'), { persist:true, scrollPage:true, smooth:true }); });
  });
  bindClick('setupActionBtn', handleSetupAction);
  bindClick('setupSecondaryBtn', handleSetupSecondaryAction);
  bindClick('qs1ActionBtn', editChannel);
  bindClick('qs2ActionBtn', focusOperationsBase);
  bindClick('qs3ActionBtn', openGoLiveValidation);
  bindClick('inactivityCta', function() {
    var channelSaved = !!(state.channelConnected || state.channelPending);
    var baseInstruction = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
    var baseQuickReply = (document.getElementById('quickReply1') && document.getElementById('quickReply1').value || '').trim();
    var configDone = !!(baseInstruction && baseQuickReply);
    if (!channelSaved) { editChannel(); }
    else if (!configDone) { focusOperationsBase(); }
    else { openGoLiveValidation(); }
  });
  bindClick('inactivityDismiss', function() {
    var banner = document.getElementById('inactivityBanner');
    if (banner) banner.style.display = 'none';
  });
  bindClick('botToggle', toggleBot);
  document.querySelectorAll('[data-setting-toggle]').forEach(function(btn){
    btn.addEventListener('click', function(){ toggleSetting(btn.getAttribute('data-setting-toggle')); });
  });
bindOverlayOpeners('[data-open-request]', openRequest);
  bindClick('saveWorkspaceBaseBtn', saveWorkspaceBase);
  bindClick('saveWorkspaceAdvancedBtn', saveWorkspaceAdvanced);
  document.querySelectorAll('.open-upgrade-btn').forEach(function(btn){
    btn.addEventListener('click', openUpgrade);
  });
  bindClick('billingBtn', function(){ openBillingPortal('billing'); });
  bindClick('cancelBtn', function(){ openBillingPortal('cancel'); });
  bindClick('billingBtnSecondary', function(){ openBillingPortal('billing'); });
  bindClick('cancelBtnSecondary', function(){ openBillingPortal('cancel'); });
  document.querySelectorAll('.open-help-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ window.open('/suporte','_blank'); });
  });
  bindClick('channelActionBtn', editChannel);
  bindClick('channelActionBtnSecondary', editChannel);
  bindClick('closeRequestOverlayBtn', function(){ closeOverlay('requestOverlay'); });
  bindClick('submitRequestBtn', submitRequest);
  bindClick('closeUpgradeOverlayBtn', function(){ closeOverlay('upgradeOverlay'); });
  bindClick('confirmUpgradeBtn', doUpgrade);
  document.querySelectorAll('input[name="planOpt"]').forEach(function(radio){
    radio.addEventListener('change', syncUpgradeOptions);
  });
  syncUpgradeOptions();
  bindClick('toggleManualChannelBtn', toggleAdvancedChannel);
  bindClick('closeChannelOverlayBtn', function(){ closeOverlay('channelOverlay'); });
  bindClick('openChannelSupportBtn', openChannelSupport);
  bindClick('runChannelSelfTestBtn', runChannelSelfTest);
  bindClick('saveChannelBtn', saveChannel);
}

bindClientPanelActions();
updateClientBreadcrumb(getStoredClientTab());
updateClientSaveStates();

// ── Meta FB SDK — fbAsyncInit MUST be defined before the SDK script is injected
// so it is available immediately when the SDK loads (even from cache).
var _fbReady = false;
window.fbAsyncInit = function() {
  if (!META_APP_ID || _fbReady) return;
  FB.init({ appId: META_APP_ID, version: 'v21.0', xfbml: false, cookie: false });
  _fbReady = true;
};

(function(d, s, id) {
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) {
    // SDK script already in DOM (e.g. SPA re-render): ensure FB is initialized
    if (typeof FB !== 'undefined' && typeof FB.init === 'function' && META_APP_ID && !_fbReady) {
      FB.init({ appId: META_APP_ID, version: 'v21.0', xfbml: false, cookie: false });
      _fbReady = true;
    }
    return;
  }
  js = d.createElement(s); js.id = id;
  js.src = 'https://connect.facebook.net/pt_BR/sdk.js';
  js.async = true;
  // NOTE: crossOrigin must NOT be set — connect.facebook.net does not return
  // Access-Control-Allow-Origin headers, so 'anonymous' mode silently blocks
  // the script execution and FB never becomes defined.
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'facebook-jssdk'));

// ── Meta Embedded Signup ──────────────────────────────────────────
var _embeddedSignupCode = null; // guarda código para re-uso na seleção de número
var _embeddedSignupTimeout = null;
var _popupCheckTimer = null;

function _ensureFBInit() {
  // Re-initialize FB if SDK loaded before fbAsyncInit was assigned (e.g. cached SDK)
  if (typeof FB !== 'undefined' && typeof FB.init === 'function' && META_APP_ID && !_fbReady) {
    try { FB.init({ appId: META_APP_ID, version: 'v21.0', xfbml: false, cookie: false }); _fbReady = true; } catch(_) {}
  }
}

function startEmbeddedSignup() {
  if (!META_APP_ID || !META_CONFIG_ID) {
    toast('Conexão automática ainda não disponível. Salve o número e peça ativação assistida.');
    return;
  }
  var _btn = document.getElementById('metaEmbeddedSignupBtn');
  _ensureFBInit();
  if (typeof FB === 'undefined' || typeof FB.login !== 'function') {
    setMetaSignupStatus('Carregando SDK da Meta... aguarde um instante e clique novamente.', 'loading');
    if (_btn) { _btn.disabled = true; _btn.textContent = 'Carregando...'; }
    // Retry automatically once the SDK arrives
    var retryCount = 0;
    var retryTimer = setInterval(function() {
      _ensureFBInit();
      if (typeof FB !== 'undefined' && typeof FB.login === 'function') {
        clearInterval(retryTimer);
        if (_btn) { _btn.disabled = false; _btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.507 14.307l-.009.075c-.083.459-.261.88-.55 1.222-.374.45-.872.675-1.482.675-.595 0-1.058-.2-1.383-.6-.32-.4-.444-.945-.37-1.619.075-.674.315-1.185.721-1.538.406-.35.9-.527 1.484-.527.612 0 1.088.185 1.43.554.34.368.462.876.388 1.526l-.23.232zM12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.11c-.57.67-1.386 1.01-2.44 1.01-1.05 0-1.88-.33-2.48-.99l-.02.83H10.2V6.5h2.4v3.93c.62-.63 1.43-.95 2.42-.95.99 0 1.79.35 2.4 1.06.6.7.9 1.65.9 2.84 0 1.2-.3 2.13-.8 2.73z"/></svg> Conectar com WhatsApp Business'; }
        setMetaSignupStatus('', '');
        startEmbeddedSignup();
      }
      if (++retryCount >= 80) {
        clearInterval(retryTimer);
        if (_btn) { _btn.disabled = false; _btn.textContent = 'Conectar com WhatsApp Business'; }
        setMetaSignupStatus('Não foi possível carregar o SDK da Meta. Verifique sua conexão e tente novamente.', 'error');
      }
    }, 50);
    return;
  }
  setMetaSignupStatus('Aguardando autorização na janela da Meta...', 'loading');
  document.getElementById('metaPhoneSelection').style.display = 'none';

  // Detect popup blocked: if FB.login callback fires immediately with no authResponse
  // AND the popup was never opened, show a helpful message.
  var _callbackFired = false;
  if (_popupCheckTimer) clearTimeout(_popupCheckTimer);
  _popupCheckTimer = setTimeout(function() {
    if (!_callbackFired) {
      setMetaSignupStatus('O popup da Meta foi bloqueado pelo browser. Clique no ícone de popup bloqueado na barra de endereço, permita popups para mercabot.com.br e tente novamente.', 'error');
    }
  }, 4000);

  if (_embeddedSignupTimeout) clearTimeout(_embeddedSignupTimeout);
  _embeddedSignupTimeout = setTimeout(function() {
    _embeddedSignupTimeout = null;
    if (!_callbackFired) {
      setMetaSignupStatus('A janela da Meta não respondeu. Permita popups para mercabot.com.br e tente novamente.', 'error');
    }
  }, 120000);

  FB.login(function(response) {
    _callbackFired = true;
    if (_popupCheckTimer) { clearTimeout(_popupCheckTimer); _popupCheckTimer = null; }
    if (_embeddedSignupTimeout) { clearTimeout(_embeddedSignupTimeout); _embeddedSignupTimeout = null; }
    var code = response && response.authResponse && response.authResponse.code
      ? response.authResponse.code : null;
    if (code) {
      _embeddedSignupCode = code;
      handleEmbeddedSignupCode(code, null);
    } else {
      setMetaSignupStatus('Autorização cancelada ou popup bloqueado. Permita popups para mercabot.com.br e tente novamente.', 'error');
    }
  }, {
    config_id: META_CONFIG_ID,
    response_type: 'code',
    override_default_response_type: true,
    extras: { sessionInfoVersion: 2 }
  });
}

async function handleEmbeddedSignupCode(code, selectedPhoneId) {
  setMetaSignupStatus('Conectando sua conta WhatsApp Business...', 'loading');
  document.getElementById('metaPhoneSelection').style.display = 'none';

  try {
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session
      ? sessionResult.data.session.access_token : '';
    if (!jwt) {
      setMetaSignupStatus('Sua sessão expirou. Faça login novamente para continuar.', 'error');
      return;
    }

    var payload = { code: code };
    if (selectedPhoneId) payload.phone_number_id = selectedPhoneId;

    var res = await postAuthorizedJson(EMBEDDED_SIGNUP_URL, jwt, payload, 20000);
    var data = res.body || {};

    if (!res.ok) {
      setMetaSignupStatus(data.error || 'Falha ao conectar com a Meta. Tente novamente ou peça ativação assistida.', 'error');
      return;
    }

    // Múltiplos números — mostrar seleção
    if (data.needsSelection && Array.isArray(data.phones) && data.phones.length > 1) {
      renderPhoneSelection(data.phones, code);
      return;
    }

    // Sucesso — atualizar estado e fechar modal
    if (data.ok && data.channel) {
      state.waNumber           = data.channel.display_phone_number || '';
      state.channelPhoneNumberId = data.channel.phone_number_id || '';
      state.channelTokenMasked  = data.channel.access_token_masked || 'Conectado via Meta';
      state.channelVerifiedName = data.channel.verified_name || '';
      state.channelConnected    = true;
      state.channelPending      = false;
      state.channelProvider     = 'meta';
      closeOverlay('channelOverlay');
      renderState();
      toast('✅ WhatsApp Business conectado com sucesso!');
    } else {
      setMetaSignupStatus('Resposta inesperada. Tente novamente ou peça ativação assistida.', 'error');
    }
  } catch(err) {
    setMetaSignupStatus('Erro inesperado. Tente novamente ou peça ativação assistida.', 'error');
  }
}

function renderPhoneSelection(phones, code) {
  var list = document.getElementById('metaPhoneList');
  var section = document.getElementById('metaPhoneSelection');
  if (!list || !section) return;

  list.innerHTML = '';
  phones.forEach(function(p) {
    var phoneId = p.id || '';
    var display = p.display_phone_number || phoneId;
    var name    = p.verified_name || '';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'meta-phone-option';
    btn.addEventListener('click', function() { handleEmbeddedSignupCode(code, phoneId); });
    var strong = document.createElement('strong');
    strong.textContent = display;
    btn.appendChild(strong);
    if (name) {
      var span = document.createElement('span');
      span.textContent = name;
      btn.appendChild(span);
    }
    list.appendChild(btn);
  });

  section.style.display = 'block';
  setMetaSignupStatus('Selecione o número que será conectado:', 'info');
}

function setMetaSignupStatus(msg, type) {
  var el = document.getElementById('metaSignupStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'meta-signup-status ' + (type || '');
  el.style.display = 'block';
}