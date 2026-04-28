var SUPABASE_URL = (window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
var SUPABASE_PUBLISHABLE_KEY = (window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';

// ── i18n GLOBAL HELPER ────────────────────────────────────────────────────
// Lookup com fallback ao texto PT (legado). Usado em tudo que app.js
// renderiza dinamicamente (datas, badges, tooltips, toasts).
// i18n.js carregou ANTES deste arquivo, então window.__mbI18n já existe.
// Atribui-se a window para outros scripts (setup-wizard.js, ux.js) acessarem.
function MB_t(key, fallback) {
  var i18n = window.__mbI18n;
  if (i18n && typeof i18n.t === 'function') {
    var v = i18n.t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}
function MB_lang() {
  return (window.__mbI18n && window.__mbI18n.lang) || 'pt';
}
function MB_locale() {
  return MB_t('date.locale', 'pt-BR');
}
window.MB_t = MB_t;
window.MB_lang = MB_lang;
window.MB_locale = MB_locale;
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
var ACCOUNT_CONVERSATIONS_URL = _API + '/account/conversations';
var ACCOUNT_CONTACTS_URL      = _API + '/account/contacts';
var WHATSAPP_REPLY_URL        = _API + '/whatsapp/reply';
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
  (function(){
    var pb = document.getElementById('planBadge');
    var gn = document.getElementById('greetingName');
    if (pb) { pb.textContent = MB_t('topbar.planBadge', 'Plano'); pb.className = 'plan-badge'; }
    if (gn) gn.textContent = MB_t('topbar.greeting', 'Olá!');
  })();
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
var _aiOnboardText = '';       // texto guardado do atalho IA da tela inicial

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
  // Se veio do atalho IA, auto-gera após mostrar o form
  var autoFill = !!_aiOnboardText;
  setTimeout(function(){
    bpShowFormState(seg);
    if(autoFill){
      // Preenche o bpFreeText com o texto guardado e dispara a IA automaticamente
      var ftEl = document.getElementById('bpFreeText');
      if(ftEl){ ftEl.value = _aiOnboardText; }
      _aiOnboardText = ''; // consome o texto (evita refill ao trocar de segmento)
      // Dispara geração — sem modal de confirmação pois o usuário já pediu
      var loadingEl = document.getElementById('bpAiLoading');
      if(loadingEl) loadingEl.style.display = '';
      var generateBtn = document.getElementById('bpGenerateBtn');
      if(generateBtn) generateBtn.disabled = true;
      bpGenerateWithAI();
    }
  }, 120);
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
    toast('toast.aiGen.needDesc');
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
    if(!jwt){ toast('toast.session.expired'); return; }

    var result = await postAuthorizedJson(
      _API + '/account/workspace/generate',
      jwt,
      { segment: seg.id, freeText: freeText, fields: seg.fields.map(function(f){ return f.id; }) },
      20000
    );

    if(!result.ok || !result.body || !result.body.fields){
      toast((result.body && result.body.error) || MB_t('toast.aiGen.formError', 'Não foi possível gerar o formulário agora. Tente novamente ou preencha manualmente.'));
      return;
    }

    // Fill fields with AI response
    var generated = result.body.fields;
    seg.fields.forEach(function(f){
      var el = document.getElementById('bpf_' + f.id);
      if(el && generated[f.id]) el.value = generated[f.id];
    });
    toast('toast.aiGen.filled');

    // Mark as AI-generated for the save
    var saveBtn = document.getElementById('bpSaveBtn');
    if(saveBtn) saveBtn.setAttribute('data-ai', 'true');

  }catch(err){
    if(window.__mb_report_error) window.__mb_report_error(err, { fn: 'bpGenerateWithAI' });
    toast('toast.aiGen.fail');
  }finally{
    if(loadingEl) loadingEl.style.display = 'none';
    if(generateBtn) generateBtn.disabled = false;
  }
}

function bpBindEvents(){
  var backBtn     = document.getElementById('bpBackBtn');
  var saveBtn     = document.getElementById('bpSaveBtn');
  var editBtn     = document.getElementById('bpEditBtn');
  var genBtn      = document.getElementById('bpGenerateBtn');
  var yesBtn      = document.getElementById('bpAiConfirmYes');
  var noBtn       = document.getElementById('bpAiConfirmNo');
  var aiShortBtn  = document.getElementById('aiOnboardBtn');
  var aiShortInput= document.getElementById('aiOnboardInput');

  if(backBtn)  backBtn.addEventListener('click',  function(){
    _bpFormActive=false; _aiOnboardText='';
    // Restaura visual do atalho IA
    var aiBtn = document.getElementById('aiOnboardBtn');
    var aiHero = document.getElementById('aiOnboardHero');
    if(aiBtn){ aiBtn.disabled=false; aiBtn.textContent=''; aiBtn.style.background=''; aiBtn.style.color='';
      aiBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M3.1 3.1l1.4 1.4M10.5 10.5l1.4 1.4M3.1 11.9l1.4-1.4M10.5 4.5l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Preencher com IA';
    }
    if(aiHero){ aiHero.style.borderColor=''; aiHero.style.background=''; }
    bpRenderSegmentGrid();
    document.getElementById('bpStateEmpty').style.display='';
    document.getElementById('bpStateForm').style.display='none';
    _bpSelectedSegment=null;
  });
  if(saveBtn)  saveBtn.addEventListener('click',  bpSave);
  if(editBtn)  editBtn.addEventListener('click',  bpStartEdit);
  if(genBtn)   genBtn.addEventListener('click',   bpShowAiConfirm);
  if(yesBtn)   yesBtn.addEventListener('click',   bpGenerateWithAI);
  if(noBtn)    noBtn.addEventListener('click',    function(){ document.getElementById('bpAiConfirm').style.display='none'; });

  // ── Atalho IA da tela inicial ────────────────────────────────────────────────
  if(aiShortBtn) aiShortBtn.addEventListener('click', function(){
    var text = aiShortInput ? aiShortInput.value.trim() : '';
    if(!text){
      toast('toast.aiGen.needDesc2');
      if(aiShortInput) aiShortInput.focus();
      return;
    }
    // Guarda o texto para uso quando o segmento for selecionado
    _aiOnboardText = text;

    // Feedback visual no hero: muda aparência para "aguardando segmento"
    var hero = document.getElementById('aiOnboardHero');
    if(hero){
      hero.style.borderColor = 'rgba(0,230,118,.55)';
      hero.style.background  = 'linear-gradient(135deg,rgba(0,230,118,.14),rgba(0,200,83,.07))';
    }
    aiShortBtn.disabled = true;
    aiShortBtn.textContent = '✓ Agora escolha o segmento abaixo';
    aiShortBtn.style.background = '#1a3d28';
    aiShortBtn.style.color = 'var(--green)';

    // Scroll suave até a grade de segmentos
    var grid = document.getElementById('bpSegmentGrid');
    if(grid) setTimeout(function(){ grid.scrollIntoView({ behavior:'smooth', block:'center' }); }, 100);
  });

  // Enter no textarea do atalho IA aciona o botão
  if(aiShortInput) aiShortInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      if(aiShortBtn) aiShortBtn.click();
    }
  });

  // ── Quickstart done strip — dismiss ─────────────────────────────────────
  var qsDismissBtn = document.getElementById('qsDismissBtn');
  if(qsDismissBtn) qsDismissBtn.addEventListener('click', function(){
    var card = document.getElementById('quickstartCard');
    if(card){ card.style.display = 'none'; }
    try{ localStorage.setItem('mb_qs_dismissed','1'); }catch(_){}
  });

  // ── Welcome modal — first-visit logic ────────────────────────────────────
  var welcomeStartBtn  = document.getElementById('welcomeStartBtn');
  var welcomeDismissBtn= document.getElementById('welcomeDismissBtn');
  function _closeWelcomeModal(){
    var ov = document.getElementById('welcomeOverlay');
    if(ov) ov.style.display = 'none';
  }
  if(welcomeStartBtn) welcomeStartBtn.addEventListener('click', function(){
    _closeWelcomeModal();
    // Scroll to first quickstart action
    setTimeout(function(){
      var btn = document.getElementById('qs1ActionBtn');
      if(btn){ btn.scrollIntoView({ behavior:'smooth', block:'center' }); btn.focus({ preventScroll:true }); }
    }, 250);
  });
  if(welcomeDismissBtn) welcomeDismissBtn.addEventListener('click', _closeWelcomeModal);
}
// ─────────────────────────────────────────────────────────────────────────────
// Welcome modal: show once per account when no channel + no workspace is set.
// Uses localStorage key 'mb_welcomed_v2' to avoid repeat.
function maybeShowWelcomeModal(){
  try{ if(localStorage.getItem('mb_welcomed_v2')) return; }catch(_){ return; }
  // Only show for genuinely fresh setups — skip if already partially configured
  if(state.channelConnected || state.channelPending) return;
  if(state.workspace && (state.workspace.notes || (Array.isArray(state.workspace.quickReplies) && state.workspace.quickReplies[0]))) return;
  var overlay = document.getElementById('welcomeOverlay');
  if(!overlay) return;
  overlay.style.display = 'flex';
  try{ localStorage.setItem('mb_welcomed_v2','1'); }catch(_){}
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
  var labels = { dashboard:'Painel', contatos:'Contatos', analise:'Análise', plano:'Plano e cobrança', suporte:'Suporte' };
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
    if(!on && typeof _botPauseUntil !== 'undefined' && _botPauseUntil > Date.now()){
      var _rem = _botPauseUntil - Date.now();
      var _h = Math.floor(_rem / 3600000), _m = Math.floor((_rem % 3600000) / 60000);
      var _ts = _h > 0 ? _h + 'h' + (_m > 0 ? _m + 'min' : '') : (_m > 0 ? _m + 'min' : 'menos de 1min');
      sub.textContent = 'Retoma automaticamente em ' + _ts;
    } else {
      sub.textContent = on ? 'Configurada e pronta para testes reais' : 'Atendimento automático desativado';
    }
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
  // Start always-on background polling + bind notification bell
  _startGlobalPoll();
  _bindNotifBell();
  // Show the notification anchor (was hidden until login)
  var anchor = document.getElementById('notifAnchor');
  if(anchor) anchor.classList.remove('hidden');
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
      var qty = parseInt(query.get('qty') || '1000', 10) || 1000;
      var qtyFormatted = qty.toLocaleString('pt-BR');
      var n = document.createElement('div');
      n.style.cssText = 'position:fixed;top:1.2rem;right:1.2rem;z-index:9999;background:#0d2e18;border:1px solid rgba(0,230,118,.35);color:#e8f0e9;padding:1rem 1.4rem;border-radius:14px;font-size:.97rem;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:320px;line-height:1.5';
      n.innerHTML = '✅ <strong>+' + qtyFormatted + ' respostas de IA adicionadas!</strong><br><span style="font-size:.88rem;color:#9ab09c;font-weight:400">Seu limite foi atualizado. O painel será atualizado em instantes.</span>';
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
  return ['dashboard','conversas','contatos','analise','plano','suporte','configuracoes'];
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
    toast('toast.wiz.needInstruction');
    return;
  }
  if(!(document.getElementById('quickReply1').value || '').trim()){
    focusOperationsBase();
    toast('toast.wiz.needFirstReply');
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
  // Se instrução e frase pronta já estão preenchidas → vai direto para o primeiro teste
  // (independente de channelPending ou channelConnected)
  var opNotesVal = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
  var quickReply1Val = (document.getElementById('quickReply1') && document.getElementById('quickReply1').value || '').trim();
  var configReady = !!(opNotesVal && quickReply1Val);
  if(configReady){
    openGoLiveValidation();
    return;
  }
  // Configuração ainda não preenchida → abre suporte de ativação
  if(!state.channelConnected){
    openChannelSupport();
    return;
  }
  // Canal conectado mas sem configuração → direciona para preencher
  focusOperationsBase();
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
  (function(){
    var greetEl = document.getElementById('greetingName');
    if(!greetEl) return;
    var lang = MB_lang();
    var hello = MB_t('topbar.greeting', 'Olá!');
    var helloName = (lang === 'en') ? 'Hello' : ((lang === 'es') ? '¡Hola' : 'Olá');
    greetEl.textContent = state.company ? (helloName + ', ' + state.company + '!') : hello;
  })();
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
      + '<button onclick="comprarAddon(5,event)" style="background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.3);color:#00e676;font-weight:700;padding:.3rem .75rem;border-radius:8px;cursor:pointer;font-size:.82rem">+5.000 — R$235</button>'
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
    var isAtRisk        = state.customerStatus === 'at_risk';
    var isPastDue       = state.customerStatus === 'past_due';
    var isPendingPayment= state.customerStatus === 'pending_payment';
    var isCanceled      = state.customerStatus === 'canceled';
    if (isCanceled) {
      // Assinatura cancelada — bot suspenso, redirecionar para nova contratação
      banner.style.display = 'flex';
      banner.style.background = 'rgba(239,68,68,.06)';
      banner.style.border = '1px solid rgba(239,68,68,.28)';
      banner.style.borderRadius = '14px';
      if (iconEl) iconEl.textContent = '🔴';
      if (msgEl) msgEl.innerHTML = '<strong style="color:#fca5a5">Assinatura cancelada</strong> — Seu plano foi encerrado e o atendimento automático está pausado. Seus dados ficam salvos por 30 dias. Para reativar, escolha um novo plano.';
      if (portalBtn) {
        portalBtn.style.background = '#6366f1';
        portalBtn.style.color = '#fff';
        portalBtn.textContent = 'Escolher plano →';
        // Para contas canceladas, o billing portal mostra sub inativa — melhor ir para nova contratação
        portalBtn.onclick = function(e){ e.stopImmediatePropagation(); window.location.href = '/cadastro/'; };
      }
    } else if (isPendingPayment) {
      // Boleto gerado mas ainda não compensado — bot continua ativo, aviso informativo
      banner.style.display = 'flex';
      banner.style.background = 'rgba(99,102,241,.06)';
      banner.style.border = '1px solid rgba(99,102,241,.28)';
      banner.style.borderRadius = '14px';
      if (iconEl) iconEl.textContent = '🕐';
      if (msgEl) msgEl.innerHTML = '<strong style="color:#a5b4fc">Boleto em compensação</strong> — Seu boleto foi gerado. A IA <strong>continua ativa</strong> e será confirmada automaticamente assim que o pagamento compensar, em até 3 dias úteis. Prefere confirmar agora? Troque para cartão.';
      if (portalBtn) { portalBtn.style.background = '#6366f1'; portalBtn.style.color = '#fff'; portalBtn.textContent = 'Trocar para cartão →'; }
    } else if (isAtRisk || isPastDue) {
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
  // ── Value savings banner + share bot link ────────────
  (function(){
    var banner = document.getElementById('valueSavingsBanner');
    var hoursEl = document.getElementById('savingsHours');
    var shareLink = document.getElementById('shareBotWaLink');
    if(!banner) return;
    var convs = state.convs || 0;
    if(convs > 0 && state.channelConnected){
      banner.style.display = 'flex';
      var hrs = (convs * 6 / 60).toFixed(1).replace('.', ',');
      if(hoursEl) hoursEl.textContent = '~' + hrs + 'h';
      var waNum = String(state.waNumber || '').replace(/\D/g, '');
      if(shareLink && waNum){
        var company = state.company ? 'Conheça o atendimento automático de ' + state.company : 'Fale com nosso atendimento automático';
        shareLink.href = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent('Olá! ' + company + ' 🤖');
      }
    } else {
      banner.style.display = 'none';
    }
  })();

  // ── Onboarding checklist ──────────────────────────────
  (function(){
    var wrap  = document.getElementById('setupChecklist');
    var steps = document.getElementById('checklistSteps');
    var prog  = document.getElementById('checklistProgress');
    if(!wrap || !steps) return;
    var hasNumber  = !!state.waNumber;
    var hasContext = !!(currentSettings && (currentSettings.prompt || currentSettings.notes || currentSettings.operation_notes));
    var hasReply   = !!(currentSettings && currentSettings.quick_reply_1 && currentSettings.quick_reply_1.trim());
    var hasBotOn   = state.botOn;
    var hasConvs   = state.convs > 0;
    var items = [
      { done: hasNumber,  label: 'Número WhatsApp oficial salvo',     action: 'configuracoes' },
      { done: hasContext, label: 'Contexto da IA preenchido',          action: 'configuracoes' },
      { done: hasReply,   label: 'Pelo menos uma frase pronta salva',  action: 'configuracoes' },
      { done: hasBotOn,   label: 'Atendimento automático ativado',     action: null },
      { done: hasConvs,   label: 'Primeira conversa recebida',         action: null }
    ];
    var doneCount = items.filter(function(i){ return i.done; }).length;
    if(doneCount === items.length){ wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    if(prog) prog.textContent = doneCount + ' de ' + items.length + ' etapas';
    steps.innerHTML = '';
    items.forEach(function(item){
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:.55rem;font-size:.88rem;color:' + (item.done ? 'var(--muted)' : 'var(--text)');
      var icon = document.createElement('span');
      icon.style.cssText = 'flex-shrink:0;font-size:.9rem';
      icon.textContent = item.done ? '✅' : '⬜';
      var lbl = document.createElement('span');
      lbl.style.textDecoration = item.done ? 'line-through' : 'none';
      lbl.textContent = item.label;
      row.appendChild(icon);
      row.appendChild(lbl);
      if(!item.done && item.action){
        var btn = document.createElement('a');
        btn.href = '#';
        btn.textContent = 'Ir →';
        btn.style.cssText = 'margin-left:auto;font-size:.78rem;color:var(--green);text-decoration:none;flex-shrink:0';
        btn.addEventListener('click', function(e){ e.preventDefault(); switchTab(item.action); });
        row.appendChild(btn);
      }
      steps.appendChild(row);
    });
  })();

  renderBotState();
  updateSmartRecs();
  updateAISuggestions();
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
  // Copy bot number button
  var copyWaBtn = document.getElementById('copyWaNumberBtn');
  if(copyWaBtn){
    if(state.waNumber){
      copyWaBtn.style.display = '';
      if(!copyWaBtn._bound){
        copyWaBtn._bound = true;
        copyWaBtn.addEventListener('click', function(){
          var raw = '+' + String(state.waNumber).replace(/\D/g,'');
          function fallback(){ toast('Número: ' + raw); }
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(raw).then(function(){
              copyWaBtn.textContent = '✅';
              setTimeout(function(){ copyWaBtn.textContent = '📋'; }, 1800);
            }).catch(fallback);
          } else { fallback(); }
        });
      }
    } else { copyWaBtn.style.display = 'none'; }
  }
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
  var isCanceledStatus = state.customerStatus === 'canceled';
  if(billingPrimary) billingPrimary.textContent = isCanceledStatus ? 'Escolher novo plano' : (hasBillingPortal ? 'Gerenciar pagamento' : 'Resolver pagamento');
  if(billingSecondary) billingSecondary.textContent = isCanceledStatus ? 'Escolher novo plano' : (hasBillingPortal ? 'Gerenciar pagamento' : 'Resolver pagamento');
  // Oculta "Cancelar plano" para contas já canceladas — ação sem sentido
  if(cancelPrimary){ cancelPrimary.style.display = isCanceledStatus ? 'none' : ''; cancelPrimary.textContent = hasBillingPortal ? 'Cancelar plano' : 'Resolver cancelamento'; }
  if(cancelSecondary){ cancelSecondary.style.display = isCanceledStatus ? 'none' : ''; cancelSecondary.textContent = hasBillingPortal ? 'Cancelar plano' : 'Resolver cancelamento'; }
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
  // Card de perfil do WhatsApp: só quando o canal está efetivamente conectado
  setVisible('whatsappPerfilCard',  channelConnected, '');
  if (channelConnected) { loadWhatsAppPerfil(); }
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
  // Helper i18n: cai pro PT se a chave não existir ou se i18n não carregou
  var _t = function(key, fallback){
    if (window.__mbI18n && window.__mbI18n.t) {
      var v = window.__mbI18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  };
  if(progressCopy){
    progressCopy.textContent = completedSteps === 0
      ? _t('qs.progress.step1', 'Etapa 1 de 3: vamos salvar o WhatsApp da empresa.')
      : completedSteps === 3
        ? (state.channelConnected
            ? _t('qs.progress.step3of3', '3 de 3 — canal conectado e IA no ar. Faça o primeiro teste!')
            : _t('qs.progress.step3pending', '3 de 3 — número salvo, ativação Meta em andamento com a equipe MercaBot.'))
        : completedSteps === 1
          ? (state.channelPending
              ? _t('qs.progress.step1pending', '1 de 3 — número salvo (o bot ainda não responde até a Meta ativar). Etapa 2: configure a operação.')
              : _t('qs.progress.step1of3', '1 de 3 etapas concluídas. Etapa 2: configure a operação.'))
          : _t('qs.progress.step2of3', '2 de 3 etapas concluídas. Etapa 3: fazer o primeiro teste.');
  }
  setQuickstartStep('qs1', {
    index: '1',
    done: channelSaved,
    label: channelDone
      ? _t('qs.state.connected', 'Conectado ✓')
      : (state.channelPending ? _t('qs.state.saved', 'Salvo · Meta pendente') : _t('qs.state.now', 'Agora')),
    variant: channelSaved ? 'done' : 'current',
    actionLabel: channelDone
      ? _t('qs.action.s1.review', 'Revisar WhatsApp')
      : (state.channelPending ? _t('qs.action.s1.savedReview', 'Revisar número salvo') : _t('qs.action.s1.do', 'Informar WhatsApp'))
  });
  setQuickstartStep('qs2', {
    index: '2',
    done: configDone,
    label: configDone
      ? _t('qs.state.done', 'Concluído')
      : (channelSaved ? _t('qs.state.now', 'Agora') : _t('qs.state.next', 'Depois')),
    variant: configDone ? 'done' : (channelSaved ? 'current' : 'pending'),
    actionLabel: configDone ? _t('qs.action.s2.review', 'Revisar operação') : _t('qs.action.s2.do', 'Preencher operação')
  });
  setQuickstartStep('qs3', {
    index: '3',
    done: readyForTest,
    label: readyForTest
      ? _t('qs.state.ready', 'Pronto')
      : (configDone ? _t('qs.state.now', 'Agora') : _t('qs.state.next', 'Depois')),
    variant: readyForTest ? 'done' : (configDone ? 'current' : 'pending'),
    actionLabel: _t('qs.action.s3', 'Fazer primeiro teste'),
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
        ? _t('inactivity.next.s1', 'Próximo: salvar o número oficial.')
        : (!configDone ? _t('inactivity.next.s2', 'Próximo: preencher a base da operação.') : '');
    }
  }
  // ── Estado "concluído" do quickstart ─────────────────────────────────────
  // Quando as 3 etapas estão prontas o card colapsa para uma strip compacta,
  // eliminando o loop de UX onde o usuário não sabe que terminou.
  var qsCard = document.getElementById('quickstartCard');
  var qsList = qsCard ? qsCard.querySelector('.quickstart-list') : null;
  var qsH3   = qsCard ? qsCard.querySelector('h3') : null;
  var qsIntro = document.getElementById('quickstartIntro');
  var qsSetupSecondaryBtn = document.getElementById('setupSecondaryBtn');
  var qsNextNote = document.getElementById('nextStepNote');
  if(completedSteps === 3){
    // Se o usuário já dispensou o card, oculta completamente
    try{
      if(localStorage.getItem('mb_qs_dismissed') === '1'){
        if(qsCard) qsCard.style.display = 'none';
        return;
      }
    }catch(_){}
    // Colapsa para strip compacta
    if(qsCard) qsCard.classList.add('qs-done');
    // Atualiza o sub-texto do strip de acordo com o estado do canal
    var qsDoneSubtext = document.getElementById('qsDoneSubtext');
    if(qsDoneSubtext){
      qsDoneSubtext.textContent = state.channelConnected
        ? 'Canal conectado e IA no ar. Faça um teste antes de divulgar o número.'
        : 'Número salvo e operação configurada. Ativação Meta em andamento com a equipe MercaBot.';
    }
    if(qsNextNote) qsNextNote.style.display = 'none';
    if(qsSetupSecondaryBtn) qsSetupSecondaryBtn.textContent = 'Fazer primeiro teste →';
  } else {
    if(qsCard){
      qsCard.classList.remove('qs-done');
      qsCard.style.display = '';
    }
    if(qsH3)      qsH3.textContent = 'Seu próximo passo está aqui';
    if(qsIntro)   qsIntro.textContent = 'Você só precisa seguir esta ordem: salvar o WhatsApp da empresa, preencher a operação e fazer o primeiro teste. A MercaBot conduz o restante da ativação.';
    if(qsList)    qsList.style.display = '';
    if(qsNextNote) qsNextNote.style.display = '';
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
    var initialTab = hasContinueMode() ? 'dashboard' : (urlTab && ['dashboard','contatos','analise','plano','suporte'].includes(urlTab) ? urlTab : getStoredClientTab());
    switchTab(initialTab, { persist:false, scrollPage:hasContinueMode(), smooth:false });
    clearContinueMode();
    document.querySelectorAll('a[href="/demo/"]').forEach(function(link){
      link.setAttribute('href', buildGuidedConfigLink());
    });
    hydratePanelFragments(session.access_token).then(function(){
      renderState();
      _checkStoredBotPause();
      maybeShowWelcomeModal();
      // Start guided tour for new users (delayed so DOM is fully painted)
      setTimeout(function(){
        if(typeof window._startGuidedTour === 'function') window._startGuidedTour();
      }, 800);
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
    refreshConversas(session.access_token).catch(function(){});
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
  if (!jwt) { toast('toast.auth.needLogin'); return; }
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
      toast((data && data.error) || MB_t('toast.checkout.error', 'Erro ao iniciar checkout. Tente novamente.'));
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  } catch(e) {
    toast('toast.network');
    if (btn) { btn.disabled = false; if (originalText) btn.textContent = originalText; }
  }
}

var _acctSummaryLoaded = false; // tracks first successful load
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
    if(!res.ok || !body || !body.summary){
      if(!_acctSummaryLoaded){
        // First-load failure — no cached data to fall back on → let the user know
        setTimeout(function(){
          toast('toast.loadFailed');
        }, 600);
      }
      return false;
    }
    _acctSummaryLoaded = true;
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
  }catch(err){
    if(!_acctSummaryLoaded){
      var isTimeout = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      setTimeout(function(){
        toast(isTimeout
          ? 'Tempo esgotado ao carregar. Verifique sua conexão e recarregue.'
          : 'Falha ao carregar dados. Recarregue a página ou tente novamente.');
      }, 600);
    }
    return false;
  } finally {
    if(timeoutId) clearTimeout(timeoutId);
  }
}

// ─── DASHBOARD DE CONVERSAS ──────────────────────────────────────────────────
async function refreshConversas(jwt){
  try{
    var res = await fetch(ACCOUNT_CONVERSATIONS_URL + '?limit=30', {
      method:'GET',
      headers:{ 'Authorization':'Bearer ' + jwt }
    });
    var body = await res.json().catch(function(){ return {}; });
    if(!res.ok || !body.ok) return false;
    renderConversas(body.logs || [], body.stats || {});
    return true;
  }catch(_){ return false; }
}

var _lastConvsLogs = [];
var _lastConvsStats = {};
var _convsSearchBound = false;

// ── Conversations timeline renderer (called by renderConversas + search filter) ──
function _renderConvsTimeline(logs){
  var timelineEl = document.getElementById('convsTimeline');
  var emptyEl    = document.getElementById('convsEmpty');
  if(!timelineEl) return;
  timelineEl.innerHTML = '';
  if(!logs || !logs.length){
    if(emptyEl) timelineEl.appendChild(emptyEl);
    return;
  }
  var hasHandoff = false;
  logs.forEach(function(log){
    var item = document.createElement('div');
    item.className = 'convs-item' + (log.needs_human ? ' convs-item-needs-human' : '');
    var rawPhoneForPause = String(log.contact_phone || '');
    if(typeof isContactPaused === 'function' && isContactPaused(rawPhoneForPause)) item.classList.add('convs-item-paused');

    var header = document.createElement('div');
    header.className = 'convs-item-header';

    var phoneWrap = document.createElement('span');
    var phone = document.createElement('span');
    phone.className = 'convs-item-phone';
    var rawPhone = String(log.contact_phone || '');
    phone.textContent = rawPhone.length > 6
      ? rawPhone.slice(0, 4) + '•••' + rawPhone.slice(-2)
      : rawPhone || '—';
    phoneWrap.appendChild(phone);
    if(typeof isContactPaused === 'function' && isContactPaused(rawPhone)){
      var pausedPill = document.createElement('span');
      pausedPill.className = 'paused-pill';
      pausedPill.textContent = '⏸ IA pausada';
      phoneWrap.appendChild(pausedPill);
    }
    if(log.needs_human){
      hasHandoff = true;
      var badge = document.createElement('span');
      badge.className = 'convs-needs-badge';
      badge.textContent = '⚠ Precisa de atenção';
      phoneWrap.appendChild(badge);
    }
    if(log.direction === 'outbound'){
      var outBadge = document.createElement('span');
      outBadge.className = 'convs-needs-badge';
      outBadge.style.color = 'var(--green)';
      outBadge.style.background = 'var(--green-dim)';
      outBadge.style.borderColor = 'var(--green-border)';
      outBadge.textContent = '↑ Enviada';
      phoneWrap.appendChild(outBadge);
    }

    var timeSpan = document.createElement('span');
    timeSpan.className = 'convs-item-time';
    timeSpan.textContent = log.created_at ? _relativeTime(log.created_at) : '';

    header.appendChild(phoneWrap);
    header.appendChild(timeSpan);
    item.appendChild(header);

    if(log.user_text){
      var userP = document.createElement('div');
      userP.className = 'convs-item-msg';
      userP.textContent = '👤 ' + String(log.user_text).slice(0, 90);
      item.appendChild(userP);
    }
    if(log.assistant_text){
      var aiP = document.createElement('div');
      aiP.className = log.direction === 'outbound' ? 'convs-item-msg' : 'convs-item-ai';
      aiP.textContent = (log.direction === 'outbound' ? '✉️ ' : '🤖 ') + String(log.assistant_text).slice(0, 90);
      item.appendChild(aiP);
    }

    if(log.direction !== 'outbound' && rawPhone){
      var replyBtn2 = document.createElement('button');
      replyBtn2.type = 'button';
      replyBtn2.className = 'convs-reply-btn';
      replyBtn2.textContent = '↩ Responder';
      replyBtn2.dataset.phone = rawPhone;
      replyBtn2.addEventListener('click', function(){ openReplyModal(this.dataset.phone); });
      item.appendChild(replyBtn2);
    }

    item.style.cursor = 'pointer';
    (function(rp, dp){
      item.addEventListener('click', function(e){
        if(e.target.closest('.convs-reply-btn')) return;
        openThreadModal(rp, dp);
      });
    }(rawPhone, phone.textContent));
    timelineEl.appendChild(item);
  });

  var handoffBanner = document.getElementById('convsHandoffBanner');
  if(handoffBanner) handoffBanner.style.display = hasHandoff ? '' : 'none';
}

// ── Smart recommendations banner ──────────────────────────────────
function updateAISuggestions(){
  var card    = document.getElementById('aiSuggestionsCard');
  var listEl  = document.getElementById('aiSuggestionsList');
  if(!card || !listEl || !state.channelConnected) return;
  var ws       = state.workspace && typeof state.workspace === 'object' ? state.workspace : {};
  var notes    = (ws.notes || '').trim();
  var qrs      = Array.isArray(ws.quickReplies) ? ws.quickReplies.filter(function(r){ return r && String(r).trim(); }) : [];
  var settings = state.settings || {};
  var suggs = [];
  if(!notes){
    suggs.push({ icon:'✏️', text:'Adicione a instrução principal do bot', desc:'Descreva o tom de voz e como a IA deve atender.', action:'scrollIntoView', target:'opNotes' });
  } else if(notes.length < 80){
    suggs.push({ icon:'📝', text:'Instrução curta — considere detalhar mais', desc:'Quanto mais contexto, mais precisa a resposta da IA. Tente descrever produtos, horários e regras.', action:'scrollIntoView', target:'opNotes' });
  }
  if(!qrs.length){
    suggs.push({ icon:'💬', text:'Adicione frases prontas de resposta', desc:'Frases prontas reduzem o tempo de resposta e padronizam o atendimento.', action:'scrollIntoView', target:'quickReply1' });
  }
  if(!settings.tgHorario){
    suggs.push({ icon:'🕐', text:'Ative o horário comercial', desc:'O bot pode informar automaticamente quando estiver fora do horário de atendimento.' });
  }
  if(!settings.tgLeads){
    suggs.push({ icon:'🎯', text:'Ative a qualificação de leads', desc:'A IA pode coletar nome, e-mail e interesse antes de transferir para a equipe.' });
  }
  if(!settings.tgFollowup){
    suggs.push({ icon:'🔄', text:'Ative o follow-up automático', desc:'Re-engaja contatos que não responderam nas últimas 24h.' });
  }
  if(state.botOn && state.convs === 0){
    suggs.push({ icon:'🧪', text:'Teste o bot agora', desc:'Envie uma mensagem para o número oficial e veja o bot em ação.', action:'copyWa' });
  }
  if(!suggs.length){ card.style.display = 'none'; return; }
  card.style.display = '';
  listEl.innerHTML = '';
  suggs.forEach(function(s){
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:.65rem;padding:.5rem .6rem;background:rgba(0,0,0,.15);border-radius:10px;cursor:' + (s.action ? 'pointer' : 'default');
    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:1rem;flex-shrink:0;margin-top:.05rem';
    icon.textContent = s.icon;
    var body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:.88rem;font-weight:700;color:var(--text)';
    title.textContent = s.text;
    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:.78rem;color:var(--muted);margin-top:.1rem';
    desc.textContent = s.desc;
    body.appendChild(title);
    body.appendChild(desc);
    row.appendChild(icon);
    row.appendChild(body);
    if(s.action === 'scrollIntoView' && s.target){
      row.addEventListener('click', function(){
        var el = document.getElementById(s.target);
        if(el){ el.scrollIntoView({ behavior:'smooth', block:'center' }); el.focus(); }
      });
    } else if(s.action === 'copyWa'){
      row.addEventListener('click', function(){
        var btn = document.getElementById('copyWaNumberBtn');
        if(btn) btn.click();
      });
    }
    listEl.appendChild(row);
  });
}

function updateSmartRecs(){
  var el = document.getElementById('smartRecs');
  if(!el) return;
  var recs = [];
  if(!state.botOn && state.channelConnected){
    recs.push({ icon:'⏸', msg:'Bot pausado. <a href="#" class="srec-action" data-srec="toggleBot" style="color:var(--green)">Ativar agora →</a>' });
  }
  var needsHuman = _lastConvsLogs.filter(function(l){ return l.needs_human; }).length;
  if(needsHuman > 0){
    recs.push({ icon:'⚠️', msg: needsHuman + ' conversa' + (needsHuman !== 1 ? 's' : '') + ' aguardando resposta. <a href="#" class="srec-action" data-srec="conversas" style="color:var(--green)">Ver agora →</a>' });
  }
  if(state.aiMsgsPct >= 80){
    recs.push({ icon:'📊', msg:'Cota de IA a ' + state.aiMsgsPct + '% — considere <a href="/#precos" style="color:var(--green)">fazer upgrade →</a>' });
  }
  var iaRate = _lastAnalyticsStats && typeof _lastAnalyticsStats.iaRate === 'number' ? _lastAnalyticsStats.iaRate : -1;
  var monthMsgs = _lastConvsStats && typeof _lastConvsStats.totalMonth === 'number' ? _lastConvsStats.totalMonth : 0;
  if(iaRate >= 0 && iaRate < 40 && monthMsgs > 5){
    recs.push({ icon:'🤖', msg:'Taxa de IA baixa (' + iaRate + '%). Revise o contexto em <a href="#" class="srec-action" data-srec="configuracoes" style="color:var(--green)">Configurações →</a>' });
  }
  if(!recs.length){ el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div style="font-size:.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.55rem">Próximas ações</div>' +
    recs.map(function(r){
      return '<div style="display:flex;gap:.6rem;align-items:flex-start;padding:.45rem 0;border-bottom:1px solid var(--border)">' +
        '<span style="flex-shrink:0">' + r.icon + '</span>' +
        '<span style="font-size:.91rem;color:var(--text);line-height:1.55">' + r.msg + '</span></div>';
    }).join('');
  el.querySelectorAll('.srec-action').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var srec = this.dataset.srec;
      if(srec === 'toggleBot') toggleBot();
      else switchTab(srec);
    });
  });
}

function renderConversas(logs, stats){
  _lastConvsLogs = logs || [];
  _lastConvsStats = stats || {};
  var todayEl   = document.getElementById('convsTotalToday');
  var weekEl    = document.getElementById('convsTotalWeek');
  var monthEl   = document.getElementById('convsTotalMonth');
  var uniqueEl  = document.getElementById('convsUniqueContacts');
  var badgeEl   = document.getElementById('convsTodayBadge');
  var barsEl    = document.getElementById('convsChartBars');
  var labelsEl  = document.getElementById('convsChartLabels');
  var timelineEl= document.getElementById('convsTimeline');
  var emptyEl   = document.getElementById('convsEmpty');
  if(!timelineEl) return;

  var totalToday  = (stats && typeof stats.totalToday  === 'number') ? stats.totalToday  : 0;
  var totalWeek   = (stats && typeof stats.totalWeek   === 'number') ? stats.totalWeek   : 0;
  var totalMonth  = (stats && typeof stats.totalMonth  === 'number') ? stats.totalMonth  : 0;
  var uniqueCts   = (stats && typeof stats.uniqueContacts === 'number') ? stats.uniqueContacts : 0;
  var daily       = (stats && Array.isArray(stats.daily)) ? stats.daily : [];

  if(todayEl)  todayEl.textContent  = totalToday;
  if(weekEl)   weekEl.textContent   = totalWeek;
  if(monthEl)  monthEl.textContent  = totalMonth;
  if(uniqueEl) uniqueEl.textContent = uniqueCts;
  if(badgeEl)  badgeEl.textContent  = totalToday > 0 ? totalToday + ' hoje' : 'nenhuma hoje';

  // Mini bar chart
  if(barsEl && labelsEl && daily.length){
    var maxCount = Math.max.apply(null, daily.map(function(d){ return d.count; })) || 1;
    var todayStr = new Date().toISOString().slice(0,10);
    var days = ['D','S','T','Q','Q','S','S'];
    barsEl.innerHTML = '';
    labelsEl.innerHTML = '';
    daily.forEach(function(d){
      var pct = Math.max(Math.round((d.count / maxCount) * 100), d.count > 0 ? 4 : 0);
      var bar = document.createElement('div');
      bar.className = 'convs-chart-bar' + (d.date === todayStr ? ' today' : '');
      bar.style.height = pct + '%';
      bar.title = d.date + ': ' + d.count + ' mensagen' + (d.count !== 1 ? 's' : '');
      barsEl.appendChild(bar);
      var lbl = document.createElement('div');
      lbl.className = 'convs-chart-lbl';
      var dow = new Date(d.date + 'T12:00:00').getDay();
      lbl.textContent = days[dow] || '';
      labelsEl.appendChild(lbl);
    });
  }

  // Render timeline using shared helper
  _renderConvsTimeline(_lastConvsLogs);

  // Bind search input once
  if(!_convsSearchBound){
    _convsSearchBound = true;
    var searchEl = document.getElementById('convsSearch');
    if(searchEl){
      searchEl.addEventListener('input', function(){
        var q = this.value.trim().toLowerCase();
        if(!q){ _renderConvsTimeline(_lastConvsLogs); return; }
        var filtered = _lastConvsLogs.filter(function(l){
          return (String(l.contact_phone||'').toLowerCase().indexOf(q) >= 0) ||
                 (String(l.user_text||'').toLowerCase().indexOf(q) >= 0) ||
                 (String(l.assistant_text||'').toLowerCase().indexOf(q) >= 0);
        });
        _renderConvsTimeline(filtered);
      });
    }
  }

  // Update smart recommendations banner
  updateSmartRecs();

  // Needs-human badge on Conversas tab button
  (function(){
    var needsHuman = _lastConvsLogs.filter(function(l){ return l.needs_human; }).length;
    var tabBtn = document.querySelector('.tab-btn[data-tab="conversas"]');
    if(!tabBtn) return;
    var badge = tabBtn.querySelector('.conv-needs-badge');
    if(needsHuman > 0){
      if(!badge){
        badge = document.createElement('span');
        badge.className = 'conv-needs-badge';
        badge.style.cssText = 'display:inline-block;background:#e53935;color:#fff;border-radius:10px;font-size:.62rem;font-weight:700;padding:0 5px;min-width:16px;height:16px;line-height:16px;text-align:center;margin-left:5px;vertical-align:middle;pointer-events:none';
        tabBtn.appendChild(badge);
      }
      badge.textContent = needsHuman > 9 ? '9+' : String(needsHuman);
    } else {
      if(badge) badge.remove();
    }
  })();

  // Sync inbox panel if it exists in DOM
  if(typeof renderInbox === 'function') renderInbox(_lastConvsLogs, _lastConvsStats);

  // Update dashboard ops cockpit and notification badge
  _renderDashboardOps(_lastConvsLogs, _lastConvsStats);
  _updateNeedsHumanBadge((_lastConvsLogs||[]).filter(function(l){ return l.needs_human; }).length);
}

var _replyModalPhone = '';
function openReplyModal(phone){
  _replyModalPhone = phone || '';
  var rawPhone = _replyModalPhone;
  var display = rawPhone.length > 6 ? rawPhone.slice(0,4) + '•••' + rawPhone.slice(-2) : rawPhone;
  var toEl = document.getElementById('replyTo');
  var textEl = document.getElementById('replyText');
  var overlay = document.getElementById('replyModalOverlay');
  if(toEl) toEl.textContent = display || '—';
  if(textEl) textEl.value = '';
  // Populate quick reply chips from workspace settings
  var chipsEl = document.getElementById('replyQuickChips');
  if(chipsEl){
    chipsEl.innerHTML = '';
    var quickReplies = (state.workspace && Array.isArray(state.workspace.quickReplies))
      ? state.workspace.quickReplies.filter(function(r){ return r && String(r).trim(); })
      : [];
    if(quickReplies.length){
      chipsEl.style.display = 'flex';
      quickReplies.forEach(function(r){
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = String(r).trim().length > 40 ? String(r).trim().slice(0,40) + '…' : String(r).trim();
        chip.title = String(r).trim();
        chip.style.cssText = 'background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.25);border-radius:100px;padding:.2rem .7rem;color:var(--green);font-family:inherit;font-size:.78rem;cursor:pointer;white-space:nowrap;transition:background .15s';
        chip.addEventListener('click', function(){
          if(textEl) textEl.value = String(r).trim();
          setTimeout(function(){ if(textEl){ textEl.focus(); textEl.setSelectionRange(textEl.value.length, textEl.value.length); } }, 20);
        });
        chipsEl.appendChild(chip);
      });
    } else { chipsEl.style.display = 'none'; }
  }
  if(overlay) overlay.classList.add('show');
  setTimeout(function(){ if(textEl) textEl.focus(); }, 80);
}

function closeReplyModal(){
  var overlay = document.getElementById('replyModalOverlay');
  if(overlay) overlay.classList.remove('show');
  _replyModalPhone = '';
}

async function sendReply(){
  var phone = _replyModalPhone;
  var textEl = document.getElementById('replyText');
  var sendBtn = document.getElementById('replySendBtn');
  var message = textEl ? textEl.value.trim() : '';
  if(!phone || !message){ toast('toast.msg.fillBeforeSend'); return; }

  var sessionResult = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
  if(!jwt){ toast('toast.session.expired'); return; }

  if(sendBtn){ sendBtn.disabled = true; sendBtn.textContent = 'Enviando…'; }
  try{
    var res = await fetch(_API + '/whatsapp/reply', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, message: message })
    });
    var body = await res.json().catch(function(){ return {}; });
    if(res.ok && body.ok){
      toast('toast.sent');
      closeReplyModal();
      refreshConversas(jwt).catch(function(){});
    } else {
      toast((body && body.error) || MB_t('toast.msg.cantSend', 'Não foi possível enviar. Verifique a configuração do canal.'));
    }
  }catch(_){
    toast('toast.network');
  }finally{
    if(sendBtn){ sendBtn.disabled = false; sendBtn.textContent = 'Enviar ✉️'; }
  }
}

// Init reply modal event listeners (called once on DOM ready)
function initReplyModal(){
  var closeBtn = document.getElementById('replyCloseBtn');
  var sendBtn  = document.getElementById('replySendBtn');
  var overlay  = document.getElementById('replyModalOverlay');
  if(closeBtn) closeBtn.addEventListener('click', closeReplyModal);
  if(sendBtn)  sendBtn.addEventListener('click', sendReply);
  if(overlay)  overlay.addEventListener('click', function(e){ if(e.target === overlay) closeReplyModal(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeReplyModal(); });
}

function _relativeTime(iso){
  try{
    var diff = Date.now() - new Date(iso).getTime();
    if(diff < 60000) return MB_t('time.now', 'agora');
    if(diff < 3600000) return Math.floor(diff/60000) + MB_t('time.minSuffix', 'min');
    if(diff < 86400000) return Math.floor(diff/3600000) + MB_t('time.hourSuffix', 'h');
    if(diff < 7*86400000) return Math.floor(diff/86400000) + MB_t('time.daySuffix', 'd');
    return new Date(iso).toLocaleDateString(MB_locale(),{day:'2-digit',month:'2-digit'});
  }catch(_){ return ''; }
}

async function persistSettings(payload){
  var sessionResult = await supabaseClient.auth.getSession();
  var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
  if(!jwt){
    toast('toast.session.expired');
    return false;
  }
  var result = await postAuthorizedJson(ACCOUNT_SETTINGS_URL, jwt, payload || {}, 5000);
  var body = result.body || {};
  if(!result.ok){
    toast(body.error || MB_t('toast.config.cantSaveAccount', 'Não foi possível salvar as configurações da conta.'));
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
    toast('toast.session.expired');
    return false;
  }
  var result = await postAuthorizedJson(ACCOUNT_WORKSPACE_URL, jwt, {
    mode: mode,
    workspace: workspacePayload || {}
  }, 6000);
  var body = result.body || {};
  if(!result.ok){
    toast(body.error || MB_t('toast.config.cantSaveOperational', 'Não foi possível salvar a configuração operacional.'));
    return false;
  }
  if(body.workspace) state.workspace = body.workspace;
  if(body.summary) applyAccountSummary(body.summary);
  if(successMessage) toast(successMessage);
  return true;
}

// Atualiza apenas os indicadores de progresso e estado dos botões após salvar,
// sem re-renderizar o DOM inteiro (o que causaria scroll para o topo).
function _afterWorkspaceSave(){
  updateClientSaveStates();
  renderQuickstart();
  applyProgressiveDisclosure();
}

async function saveWorkspaceBase(){
  var btn = document.getElementById('saveWorkspaceBaseBtn');
  if(btn && btn.classList.contains('no-changes')) return; // sem alterações pendentes
  setButtonBusy('saveWorkspaceBaseBtn', true, 'Salvando...');
  try{
    await persistWorkspace('base', getBaseWorkspaceDraftFromInputs(), 'Base da operação salva.');
    _afterWorkspaceSave();
  } finally {
    setButtonBusy('saveWorkspaceBaseBtn', false);
  }
}

async function saveWorkspaceAdvanced(){
  var btn = document.getElementById('saveWorkspaceAdvancedBtn');
  if(btn && btn.classList.contains('no-changes')) return; // sem alterações pendentes
  if(state.plan === 'Starter'){
    toast('toast.config.proOnly');
    return;
  }
  setButtonBusy('saveWorkspaceAdvancedBtn', true, 'Salvando...');
  try{
    await persistWorkspace('advanced', getAdvancedWorkspaceDraftFromInputs(), 'Operação avançada salva.');
    _afterWorkspaceSave();
  } finally {
    setButtonBusy('saveWorkspaceAdvancedBtn', false);
  }
}

// ── BOT PAUSE TIMER ──────────────────────────────────────────────────────────
var _botPauseTimer = null;
var _botPauseUntil = 0;

function _clearBotPauseTimer(){
  if(_botPauseTimer){ clearTimeout(_botPauseTimer); _botPauseTimer = null; }
  _botPauseUntil = 0;
  try{ localStorage.removeItem('mb_bot_pause_until'); }catch(_){}
}

function _startBotPauseTimer(ms){
  _clearBotPauseTimer();
  var until = Date.now() + ms;
  _botPauseUntil = until;
  try{ localStorage.setItem('mb_bot_pause_until', String(until)); }catch(_){}
  _botPauseTimer = setTimeout(function(){
    _botPauseTimer = null; _botPauseUntil = 0;
    try{ localStorage.removeItem('mb_bot_pause_until'); }catch(_){}
    if(!state.botOn){
      persistSettings({ bot_enabled: true }).then(function(saved){
        if(saved){ state.botOn = true; renderBotState(); renderState(); toast('toast.bot.reactivated');}
      });
    }
  }, ms);
  renderBotState();
}

function _checkStoredBotPause(){
  try{
    var stored = localStorage.getItem('mb_bot_pause_until');
    if(!stored || state.botOn) return;
    var until = parseInt(stored, 10);
    var remaining = until - Date.now();
    if(remaining <= 0){ localStorage.removeItem('mb_bot_pause_until'); return; }
    _botPauseUntil = until;
    _botPauseTimer = setTimeout(function(){
      _botPauseTimer = null; _botPauseUntil = 0;
      try{ localStorage.removeItem('mb_bot_pause_until'); }catch(_){}
      if(!state.botOn){
        persistSettings({ bot_enabled: true }).then(function(saved){
          if(saved){ state.botOn = true; renderBotState(); renderState(); toast('toast.bot.reactivated');}
        });
      }
    }, remaining);
    renderBotState();
  }catch(_){}
}

function _showPauseDurationPicker(onConfirm){
  var existing = document.getElementById('pauseDurationPicker');
  if(existing) existing.remove();
  var picker = document.createElement('div');
  picker.id = 'pauseDurationPicker';
  picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:1.4rem 1.6rem;min-width:280px;max-width:90vw;box-shadow:0 24px 64px rgba(0,0,0,.7);text-align:center';
  picker.innerHTML =
    '<div style="font-size:.97rem;font-weight:700;margin-bottom:.3rem">⏸ Por quanto tempo pausar?</div>' +
    '<div style="font-size:.82rem;color:var(--muted);margin-bottom:1rem">O atendimento volta automaticamente quando o tempo acabar.</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.55rem">' +
    '<button class="pdp-btn" data-ms="3600000">1 hora</button>' +
    '<button class="pdp-btn" data-ms="14400000">4 horas</button>' +
    '<button class="pdp-btn" data-ms="28800000">8 horas</button>' +
    '<button class="pdp-btn" data-ms="86400000">24 horas</button>' +
    '</div>' +
    '<button class="pdp-btn" data-ms="0" style="width:100%;margin-bottom:.55rem;color:var(--muted)">Pausar indefinidamente</button>' +
    '<button id="pdpCancelBtn" style="width:100%;background:none;border:1px solid var(--border);border-radius:9px;color:var(--muted);padding:.55rem;cursor:pointer;font-size:.85rem">Cancelar</button>';
  picker.querySelectorAll('.pdp-btn').forEach(function(btn){
    btn.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:.55rem .75rem;cursor:pointer;font-size:.88rem;transition:background .15s';
    btn.addEventListener('mouseenter', function(){ btn.style.background='var(--bg4,#1e2e20)'; });
    btn.addEventListener('mouseleave', function(){ btn.style.background='var(--bg3)'; });
  });
  document.body.appendChild(picker);
  picker.querySelectorAll('.pdp-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      picker.remove();
      onConfirm(parseInt(btn.getAttribute('data-ms'), 10));
    });
  });
  document.getElementById('pdpCancelBtn').addEventListener('click', function(){ picker.remove(); });
  setTimeout(function(){
    document.addEventListener('click', function dismiss(e){
      if(!picker.contains(e.target)){ picker.remove(); document.removeEventListener('click', dismiss); }
    });
  }, 100);
}

async function toggleBot(){
  if(!state.channelConnected){
    toast('toast.bot.connectFirst');
    return;
  }
  // Turning ON — clear any pause timer and re-enable immediately
  if(!state.botOn){
    _clearBotPauseTimer();
    state.botOn = true;
    var botToggle = document.getElementById('botToggle');
    if(botToggle) botToggle.setAttribute('aria-pressed', 'true');
    renderBotState();
    var saved = await persistSettings({ bot_enabled: true });
    if(saved){ toast('toast.bot.testReady'); renderState(); return; }
    state.botOn = false;
    if(botToggle) botToggle.setAttribute('aria-pressed', 'false');
    renderBotState();
    return;
  }
  // Turning OFF — show duration picker
  _showPauseDurationPicker(function(ms){
    (async function(){
      state.botOn = false;
      var botToggle = document.getElementById('botToggle');
      if(botToggle) botToggle.setAttribute('aria-pressed', 'false');
      renderBotState();
      var saved = await persistSettings({ bot_enabled: false });
      if(saved){
        if(ms > 0) _startBotPauseTimer(ms);
        var dur = ms >= 86400000 ? '24h' : ms >= 28800000 ? '8h' : ms >= 14400000 ? '4h' : ms >= 3600000 ? '1h' : '';
        toast(dur ? (MB_t('toast.bot.pausedBy', 'Bot pausado por') + ' ' + dur + '. ' + MB_t('toast.bot.willResume', 'Voltará automaticamente.')) : MB_t('toast.bot.pausedDefault', 'Atendimento automático pausado.'));
        renderState(); return;
      }
      state.botOn = true;
      if(botToggle) botToggle.setAttribute('aria-pressed', 'true');
      renderBotState();
    })();
  });
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
    toast('toast.config.updated');
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
  toast('toast.summary.saved');
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
    toast('toast.test.needNumber');
    return;
  }
  if(!(document.getElementById('opNotes').value || '').trim()){
    closeOverlay('channelOverlay');
    focusOperationsBase();
    toast('toast.test.needInstruction');
    return;
  }
  if(!(document.getElementById('quickReply1').value || '').trim()){
    closeOverlay('channelOverlay');
    focusOperationsBase();
    toast('toast.test.needReply');
    return;
  }
  try{
    setButtonBusy('runChannelSelfTestBtn', true, 'Rodando teste...');
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
    if(!jwt){
      toast('toast.test.session');
      return;
    }
    toast('toast.test.running');
    var res = await postAuthorizedJson(WHATSAPP_CHANNEL_SELF_TEST_URL, jwt, {}, 18000);
    var body = res.body || {};
    renderChannelSelfTestResult(body, !res.ok);
    if(!res.ok){
      toast(body.error || MB_t('toast.test.notPassed', 'O primeiro teste ainda não passou.'));
      return;
    }
    toast('toast.test.passed');
    // Fecha o overlay após 3s para o usuário ver o card "Configuração completa ✓"
    setTimeout(function(){
      closeOverlay('channelOverlay');
      renderQuickstart();
      // Garante que o usuário está na seção inicial onde o card de conclusão é visível
      var setupSection = document.getElementById('setupSection') || document.getElementById('quickstartCard');
      if(setupSection && typeof setupSection.scrollIntoView === 'function'){
        setupSection.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    }, 3000);
  }catch(_){
    toast('toast.test.failed');
  } finally {
    setButtonBusy('runChannelSelfTestBtn', false);
  }
}

async function saveChannel(){
  var number = document.getElementById('channelNumber').value.trim();
  var phoneNumberId = document.getElementById('channelPhoneId').value.trim();
  var accessToken = document.getElementById('channelToken').value.trim();
  if(!number){
    toast('toast.channel.needOfficial');
    return;
  }
  if((phoneNumberId && !accessToken) || (!phoneNumberId && accessToken)){
    toast('toast.channel.needBoth');
    return;
  }
  if(phoneNumberId && !/^\d{8,}$/.test(phoneNumberId)){
    toast('toast.channel.codeDigits');
    return;
  }
  if(accessToken && accessToken.length < 20){
    toast('toast.channel.keyShort');
    return;
  }
  try{
    setButtonBusy('saveChannelBtn', true, 'Salvando canal...');
    var sessionResult = await supabaseClient.auth.getSession();
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
    if(!jwt){
      toast('toast.channel.session');
      return;
    }
    var pendingOnly = !phoneNumberId || !accessToken;
    toast(pendingOnly ? MB_t('toast.channel.savingNumber', 'Salvando seu número oficial...') : MB_t('toast.channel.savingFull', 'Validando e salvando o canal oficial...'));
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
      toast(saveBody.error || MB_t('toast.channel.cantSave', 'Não foi possível salvar o canal oficial.'));
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
    toast(state.channelConnected ? MB_t('toast.channel.connected', 'Canal oficial conectado com sucesso.') : MB_t('toast.channel.numberSaved', 'Número salvo. A MercaBot pode seguir com a ativação assistida deste canal.'));
  }catch(_){
    toast('toast.channel.saveFailed');
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
  if(!s){ toast('toast.ticket.needSubject'); return; }
  if(!d){ toast('toast.ticket.needDescription'); return; }
  closeOverlay('requestOverlay');
  var draft = 'Resumo do que precisa ser resolvido\n\nAssunto: ' + s;
  draft += '\nDescrição: ' + d;
  draft += '\n\nAbra a central digital e siga o fluxo mais adequado para cobrança, ativação ou ajustes da conta.';
  saveHelpDraft(draft);
  window.open('/suporte', '_blank');
  toast('toast.ticket.saved');
}

function doUpgrade(){
  var selected = document.querySelector('input[name="planOpt"]:checked');
  closeOverlay('upgradeOverlay');
  if(!selected){
    toast('toast.upgrade.choosePlan');
    return;
  }
  if(String(selected.value || '') === String(state.plan || '')){
    toast('toast.upgrade.alreadyActive');
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
      // Portal indisponível (sem stripe_customer_id sincronizado).
      // Para billing: gera novo checkout para completar o pagamento pendente.
      if(mode === 'billing'){
        var planRaw = String(state.plan || 'Starter').toLowerCase();
        var plano = { starter:'starter', pro:'pro', parceiro:'parceiro' }[planRaw] || 'starter';
        try{
          var chkRes = await fetch(_API + '/criar-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              whats:    state.waNumber || '',
              email:    state.email    || '',
              plano:    plano,
              planName: state.plan     || 'Starter',
              lang:     'pt'
            })
          });
          var chkBody = await chkRes.json().catch(function(){ return {}; });
          if(chkBody && chkBody.url){
            window.location.href = chkBody.url;
            return;
          }
        }catch(_){}
      }
      // Fallback final → central digital
      var draft = mode === 'cancel'
        ? 'Cancelar plano\n\nAbra o fluxo guiado da conta para seguir com o cancelamento.'
        : 'Resolver pagamento\n\nSua assinatura está pendente. Entre em contato para regularizar o pagamento.';
      saveHelpDraft(draft);
      window.open('/suporte', '_blank');
      toast(mode === 'cancel'
        ? 'Portal indisponível. A central digital foi aberta para cancelamento.'
        : 'Não foi possível gerar o link de pagamento. A central digital foi aberta.');
    }catch(err){
      toast('Não foi possível abrir o portal agora. Use a central digital para continuar.');
    } finally {
      setBillingButtonState(false);
    }
  });
}

function toast(msg){
  var el = document.getElementById('toast');
  // Se a mensagem é uma chave i18n conhecida (ex: 'toast.saved'), traduz.
  // Se for texto literal, usa direto. Permite call sites flexíveis.
  if (typeof msg === 'string' && /^[a-z]+\.[a-z]/i.test(msg) && msg.indexOf(' ') === -1) {
    msg = MB_t(msg, msg);
  }
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
  // Contador de caracteres para a Instrução Principal
  var opNotes  = document.getElementById('opNotes');
  var opCounter = document.getElementById('opNotesCounter');
  if(opNotes && opCounter) {
    function updateOpCounter() {
      var len = opNotes.value.length;
      var max = parseInt(opNotes.getAttribute('maxlength') || '4000', 10);
      opCounter.textContent = len.toLocaleString('pt-BR') + ' / ' + max.toLocaleString('pt-BR');
      opCounter.style.color = len >= max * 0.95 ? 'var(--amber)' : 'var(--muted)';
    }
    opNotes.addEventListener('input', updateOpCounter);
    updateOpCounter(); // estado inicial
  }
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

// ── CONFIGURAÇÕES TAB ────────────────────────────────────────────
var _cfgInited = false;
var CFG_LS_KEY = 'mb_client_config_prefs';

function _cfgGetPrefs(){
  try{ return JSON.parse(localStorage.getItem(CFG_LS_KEY)) || {}; }catch(_){ return {}; }
}
function _cfgSavePrefs(patch){
  var prefs = _cfgGetPrefs();
  Object.assign(prefs, patch);
  try{ localStorage.setItem(CFG_LS_KEY, JSON.stringify(prefs)); }catch(_){}
}

function renderConfiguracoes(){
  if(_cfgInited) return;
  _cfgInited = true;
  var prefs = _cfgGetPrefs();

  // ── Notificações desktop toggle ──
  var notifDesktopBtn = document.getElementById('cfgNotifDesktop');
  var notifStatusEl   = document.getElementById('cfgNotifStatus');
  function _syncNotifDesktopBtn(){
    var granted = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
    var enabled = granted && (prefs.notifDesktop !== false);
    if(notifDesktopBtn){
      notifDesktopBtn.classList.toggle('on', enabled);
      notifDesktopBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
    if(notifStatusEl){
      if(typeof Notification === 'undefined' || Notification.permission === 'denied'){
        notifStatusEl.style.display = '';
        notifStatusEl.textContent = '⚠️ Notificações bloqueadas pelo navegador. Clique no cadeado na barra de endereços para liberar.';
      } else {
        notifStatusEl.style.display = 'none';
      }
    }
  }
  _syncNotifDesktopBtn();
  if(notifDesktopBtn) notifDesktopBtn.addEventListener('click', function(){
    if(typeof Notification === 'undefined'){ toast('Seu navegador não suporta notificações.'); return; }
    if(Notification.permission === 'denied'){
      toast('Notificações bloqueadas. Libere pelo cadeado na barra de endereços.');
      return;
    }
    if(Notification.permission === 'default'){
      Notification.requestPermission().then(function(perm){
        prefs.notifDesktop = perm === 'granted';
        _cfgSavePrefs({ notifDesktop: prefs.notifDesktop });
        _syncNotifDesktopBtn();
      });
    } else {
      prefs.notifDesktop = !notifDesktopBtn.classList.contains('on');
      _cfgSavePrefs({ notifDesktop: prefs.notifDesktop });
      _syncNotifDesktopBtn();
    }
  });

  // ── Notificações e-mail toggle ──
  var notifEmailBtn = document.getElementById('cfgNotifEmail');
  function _syncNotifEmailBtn(){
    var enabled = !!prefs.notifEmail;
    if(notifEmailBtn){
      notifEmailBtn.classList.toggle('on', enabled);
      notifEmailBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
  }
  _syncNotifEmailBtn();
  if(notifEmailBtn) notifEmailBtn.addEventListener('click', function(){
    prefs.notifEmail = !notifEmailBtn.classList.contains('on');
    _cfgSavePrefs({ notifEmail: prefs.notifEmail });
    _syncNotifEmailBtn();
    // persist to backend asynchronously
    supabaseClient && supabaseClient.auth.getSession().then(function(sr){
      var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
      if(!jwt) return;
      fetch(ACCOUNT_SETTINGS_URL, {
        method:'PATCH',
        headers:{ 'Authorization':'Bearer '+jwt, 'Content-Type':'application/json' },
        body: JSON.stringify({ email_notifications_enabled: prefs.notifEmail })
      }).catch(function(){});
    });
    toast(prefs.notifEmail ? 'Notificações por e-mail ativadas.' : 'Notificações por e-mail desativadas.');
  });

  // ── Horário de atendimento ──
  var hoursStart = document.getElementById('cfgHoursStart');
  var hoursEnd   = document.getElementById('cfgHoursEnd');
  if(hoursStart && prefs.hoursStart) hoursStart.value = prefs.hoursStart;
  if(hoursEnd   && prefs.hoursEnd)   hoursEnd.value   = prefs.hoursEnd;
  var dayCheckboxes = document.querySelectorAll('#cfgDaysRow input[type=checkbox]');
  if(prefs.days && Array.isArray(prefs.days)){
    dayCheckboxes.forEach(function(chk){ chk.checked = prefs.days.indexOf(chk.value) >= 0; });
  }
  var hoursSaveBtn = document.getElementById('cfgHoursSave');
  if(hoursSaveBtn) hoursSaveBtn.addEventListener('click', function(){
    var start = hoursStart ? hoursStart.value : '08:00';
    var end   = hoursEnd   ? hoursEnd.value   : '18:00';
    var days  = [];
    dayCheckboxes.forEach(function(chk){ if(chk.checked) days.push(chk.value); });
    _cfgSavePrefs({ hoursStart: start, hoursEnd: end, days: days });
    // push to API
    supabaseClient && supabaseClient.auth.getSession().then(function(sr){
      var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
      if(!jwt) return;
      fetch(ACCOUNT_SETTINGS_URL, {
        method:'PATCH',
        headers:{ 'Authorization':'Bearer '+jwt, 'Content-Type':'application/json' },
        body: JSON.stringify({ business_hours_start: start, business_hours_end: end, business_days: days })
      }).catch(function(){});
    });
    toast('Horário salvo ✓');
  });

  // ── Identidade do bot ──
  var botNameEl     = document.getElementById('cfgBotName');
  var botGreetingEl = document.getElementById('cfgBotGreeting');
  if(botNameEl     && prefs.botName)     botNameEl.value     = prefs.botName;
  if(botGreetingEl && prefs.botGreeting) botGreetingEl.value = prefs.botGreeting;
  // pre-fill from workspace if available
  if(botNameEl && !botNameEl.value && state.workspace && state.workspace.botName){
    botNameEl.value = state.workspace.botName;
  }
  var botSaveBtn = document.getElementById('cfgBotSave');
  if(botSaveBtn) botSaveBtn.addEventListener('click', function(){
    var name     = botNameEl     ? botNameEl.value.trim()     : '';
    var greeting = botGreetingEl ? botGreetingEl.value.trim() : '';
    _cfgSavePrefs({ botName: name, botGreeting: greeting });
    supabaseClient && supabaseClient.auth.getSession().then(function(sr){
      var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
      if(!jwt) return;
      fetch(ACCOUNT_WORKSPACE_URL, {
        method:'PATCH',
        headers:{ 'Authorization':'Bearer '+jwt, 'Content-Type':'application/json' },
        body: JSON.stringify({ bot_name: name, greeting: greeting })
      }).catch(function(){});
    });
    toast('Identidade do bot salva ✓');
  });
}

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
  // Lazy-load contacts when tab is first opened
  if(tabId === 'contatos') loadContactsTab();
  // Lazy-load analytics when tab is first opened
  if(tabId === 'analise') loadAnalytics();
  // Init configurações tab on first open
  if(tabId === 'configuracoes') renderConfiguracoes();
  // Manage conversas auto-refresh polling
  if(tabId === 'conversas') _startConvsRefresh(); else _stopConvsRefresh();
}

// ── TEMPLATES DE INSTRUÇÃO IA POR SEGMENTO ──────────────────────────────────
var _PROMPT_TEMPLATES = {
  restaurante: 'Você é o assistente do [Nome do restaurante]. Atendemos pedidos e tiramos dúvidas sobre o cardápio todos os dias das 11h às 23h.\n\nQuando o cliente perguntar sobre pedido: informe que atendemos por delivery e também por retirada no balcão. Para pedidos diretos, peça nome, endereço e itens desejados.\n\nCardápio:\n- [Prato 1]: [descrição e preço]\n- [Prato 2]: [descrição e preço]\n\nPromoções do dia: [informe aqui]\n\nNunca informe tempo de entrega sem certeza. Se o cliente precisar de atendimento humano, avise que vai chamar o responsável.',

  clinica: 'Você é a assistente da [Nome da clínica]. Ajudamos pacientes a marcar consultas e tirar dúvidas sobre nossos serviços.\n\nEspecialidades disponíveis: [liste aqui]\n\nPara agendar, peça: nome completo, convênio (se houver) e preferência de horário. Atendemos [informe dias e horários].\n\nImportante: não forneça diagnósticos ou orientações médicas. Para emergências, oriente a ligar para o SAMU (192) ou ir à UPA mais próxima.\n\nSe o paciente quiser falar diretamente com a recepção, avise que vai conectar com a equipe.',

  loja: 'Você é o assistente de vendas da [Nome da loja]. Ajudamos clientes a encontrar o produto certo e fechar pedidos.\n\nProdutos em destaque:\n- [Produto 1]: [descrição e preço]\n- [Produto 2]: [descrição e preço]\n\nFormas de pagamento: PIX (5% de desconto), cartão de crédito em até 12x, boleto.\n\nPrazo de entrega: [informe aqui]\n\nPolítica de troca: [informe sua política aqui]\n\nSe o cliente quiser um orçamento especial ou tiver dúvida técnica, ofereça para conectar com um vendedor.',

  servicos: 'Você é o assistente de [Seu nome / nome da empresa]. Ofereço serviços de [descreva o que faz].\n\nServiços disponíveis:\n- [Serviço 1]: [descrição e faixa de preço]\n- [Serviço 2]: [descrição e faixa de preço]\n\nDisponibilidade: atendo [informe seus dias e horários].\n\nPara orçamento, peça nome, cidade e uma breve descrição do que o cliente precisa.\n\nMeu diferencial: [escreva o que te diferencia dos concorrentes].',

  imoveis: 'Você é o assistente da [Nome da imobiliária]. Ajudamos clientes a encontrar o imóvel ideal para compra, venda ou locação.\n\nPortfólio: [descreva tipos de imóveis disponíveis, regiões e faixa de preço]\n\nPara compra: pergunte faixa de preço, localização desejada e tipo (casa, apartamento, comercial).\n\nPara locação: pergunte finalidade, bairro desejado e número de quartos.\n\nPara avaliação de imóvel: colete o endereço e avise que um corretor entrará em contato.\n\nNão informe valores específicos sem consultar a equipe. Se quiser falar com um corretor, avise que vai conectar.',

  juridico: 'Você é o assistente do escritório [Nome do escritório]. Atuamos nas áreas de [informe as áreas de atuação].\n\nNosso objetivo é orientar o cliente e agendar uma consulta inicial.\n\nImportante: não forneça orientação jurídica específica pelo WhatsApp. Para casos que precisam de análise, agende uma consulta com o advogado responsável.\n\nPara agendar: peça nome completo, assunto geral (ex: trabalhista, família, contratual) e preferência de horário. Atendemos [informe dias e horários].\n\nValor da consulta inicial: [gratuita / R$ XX,00].'
};

function bindPromptTemplates(){
  var sel = document.getElementById('promptTemplateSelect');
  if(!sel) return;
  sel.addEventListener('change', function(){
    var key = sel.value;
    if(!key) return;
    var template = _PROMPT_TEMPLATES[key];
    if(!template){ sel.value = ''; return; }
    var textarea = document.getElementById('opNotes');
    if(!textarea){ sel.value = ''; return; }
    var label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text.replace(/^[^\w]+/,'').trim() : key;
    if(textarea.value.trim() && !window.confirm('Substituir o texto atual pelo modelo de ' + label + '?')){ sel.value = ''; return; }
    textarea.value = template;
    sel.value = '';
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    toast('Modelo carregado — personalize com as informações do seu negócio.');
  });
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
  bindClick('qs1ActionBtn', function() {
    editChannel();
    // Se ainda não há canal salvo, lança o Embedded Signup automaticamente
    // para evitar que o usuário precise copiar Phone ID e token manualmente.
    if (!state.channelConnected && !state.channelPending) {
      setTimeout(startEmbeddedSignup, 380);
    }
  });
  bindClick('qs2ActionBtn', focusOperationsBase);
  bindClick('qs3ActionBtn', openGoLiveValidation);
  bindClick('inactivityCta', function() {
    var channelSaved = !!(state.channelConnected || state.channelPending);
    var baseInstruction = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
    var baseQuickReply = (document.getElementById('quickReply1') && document.getElementById('quickReply1').value || '').trim();
    var configDone = !!(baseInstruction && baseQuickReply);
    if (!channelSaved) {
      editChannel();
      // Lança Embedded Signup automaticamente — o usuário não precisa copiar tokens
      setTimeout(startEmbeddedSignup, 380);
    } else if (!configDone) { focusOperationsBase(); }
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
bindPromptTemplates();

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
      toast('✅ WhatsApp conectado! Próximo passo: configure a instrução do bot.');
      // Guia automaticamente para a Etapa 2 (instrução + frase pronta)
      // se o usuário ainda não tiver preenchido — elimina o "e agora?" pós-conexão.
      setTimeout(function() {
        var baseInstruction = (document.getElementById('opNotes') && document.getElementById('opNotes').value || '').trim();
        if (!baseInstruction) {
          focusOperationsBase();
        }
      }, 1400);
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

// ── PERFIL DO WHATSAPP ────────────────────────────────────────────────────────

var _waPerfilLoaded = false;

async function _waGetJwt() {
  try {
    var s = await supabaseClient.auth.getSession();
    return s && s.data && s.data.session ? s.data.session.access_token : '';
  } catch(_) { return ''; }
}

// Mapeia name_status da Meta para label legível
function _waNomeStatusLabel(status) {
  var map = {
    'APPROVED':                 { label: '✅ Aprovado',          color: 'var(--green)',  bg: 'rgba(0,230,118,.12)',  border: 'rgba(0,230,118,.22)' },
    'AVAILABLE_WITHOUT_REVIEW': { label: '✅ Ativo',             color: 'var(--green)',  bg: 'rgba(0,230,118,.12)',  border: 'rgba(0,230,118,.22)' },
    'PENDING_REVIEW':           { label: '⏳ Em análise',        color: '#f59e0b',       bg: 'rgba(245,158,11,.1)',  border: 'rgba(245,158,11,.25)' },
    'REJECTED':                 { label: '❌ Recusado pela Meta', color: '#f87171',      bg: 'rgba(248,113,113,.1)', border: 'rgba(248,113,113,.25)' },
    'EXPIRED':                  { label: '⚠️ Expirado',          color: '#f59e0b',       bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.18)' },
  };
  return map[status] || { label: status || '—', color: 'var(--muted)', bg: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.18)' };
}

async function loadWhatsAppPerfil() {
  if (_waPerfilLoaded) return;

  // Pré-preenche com dados do state enquanto aguarda a API
  var nomeEl = document.getElementById('waNomeDisplay');
  var numEl  = document.getElementById('waNumeroDisplay');
  if (nomeEl) nomeEl.textContent = state.channelVerifiedName || state.company || '—';
  if (numEl)  numEl.textContent  = state.waNumber ? '+' + state.waNumber.replace(/\D/g,'') : '';

  var jwt = await _waGetJwt();
  if (!jwt) return;

  try {
    var res  = await fetch(_API + '/whatsapp/perfil', {
      headers: { 'Authorization': 'Bearer ' + jwt }
    });
    var data = await res.json();

    // ── Avatar ──────────────────────────────────────────
    var profile = data.profile || {};
    if (profile.profile_picture_url) {
      var img  = document.getElementById('waAvatarImg');
      var fall = document.getElementById('waAvatarFallback');
      if (img)  { img.src = profile.profile_picture_url; img.style.display = 'block'; }
      if (fall) fall.style.display = 'none';
    }

    // ── About ───────────────────────────────────────────
    var aboutEl = document.getElementById('waAbout');
    if (aboutEl && profile.about && !aboutEl.value) aboutEl.value = profile.about;

    // ── Nome / name_status ─────────────────────────────
    var nameInfo = data.nameInfo || {};
    var verifiedName = nameInfo.verified_name || state.channelVerifiedName || state.company || '—';
    if (nomeEl) nomeEl.textContent = verifiedName;
    var nomeAtualEl = document.getElementById('waNomeAtual');
    if (nomeAtualEl) nomeAtualEl.textContent = verifiedName;

    var pill = document.getElementById('waNomeStatusPill');
    if (pill && nameInfo.name_status) {
      var st = _waNomeStatusLabel(nameInfo.name_status);
      pill.textContent = st.label;
      pill.style.color = st.color;
      pill.style.background = st.bg;
      pill.style.borderColor = st.border;
    } else if (pill) {
      pill.textContent = verifiedName !== '—' ? '✅ Ativo' : '—';
    }

    // ── Solicitação de nome pendente ───────────────────
    var pending = data.pendingNameRequest;
    if (pending && pending.status === 'pending') {
      _waShowPendingRequest(pending.requested_name);
    }

    // Badge "Conectado"
    var badge = document.getElementById('waPerfilStatusBadge');
    if (badge) badge.style.display = '';

    _waPerfilLoaded = true;
  } catch (_) {}

  _waBindPerfilEvents();
}

// Mostra o box de solicitação pendente
function _waShowPendingRequest(name) {
  var box = document.getElementById('waNomePendingBox');
  var form = document.getElementById('waNomeRequestForm');
  var nameEl = document.getElementById('waNomeSolicitado');
  if (box) box.style.display = '';
  if (form) form.style.display = 'none';
  if (nameEl) nameEl.textContent = name || '—';
}

// Gera texto "Sobre" automático a partir dos dados da conta
function _waGerarAbout() {
  var empresa = state.company || '';
  var horas   = (document.getElementById('specialHours') || {}).value
             || (state.workspace && state.workspace.specialHours) || '';
  var parts   = [];
  if (empresa) parts.push(empresa);
  if (horas)   parts.push(horas);
  var about = parts.join(' · ');
  if (about.length > 139) about = about.slice(0, 136) + '…';
  return about || 'Atendimento automatizado. Respondo 24h pelo WhatsApp.';
}

// Wire eventos (uma única vez)
function _waBindPerfilEvents() {
  // Contador do "about"
  var aboutEl  = document.getElementById('waAbout');
  var countEl  = document.getElementById('waAboutCounter');
  if (aboutEl && countEl && !aboutEl._waCounted) {
    aboutEl._waCounted = true;
    function _updateAboutCount() {
      countEl.textContent = aboutEl.value.length + ' / 139';
      countEl.style.color = aboutEl.value.length >= 125 ? 'var(--amber)' : 'var(--muted)';
    }
    aboutEl.addEventListener('input', _updateAboutCount);
    _updateAboutCount();
  }

  // Botão "Preencher com meus dados"
  var autoBtn = document.getElementById('waAboutAutoBtn');
  if (autoBtn && !autoBtn._waWired) {
    autoBtn._waWired = true;
    autoBtn.addEventListener('click', function() {
      if (aboutEl) { aboutEl.value = _waGerarAbout(); aboutEl.dispatchEvent(new Event('input')); }
    });
  }

  // Upload de foto
  var fotoInput = document.getElementById('waFotoInput');
  if (fotoInput && !fotoInput._waWired) {
    fotoInput._waWired = true;
    fotoInput.addEventListener('change', function() {
      var file = fotoInput.files && fotoInput.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('A foto não pode ultrapassar 5 MB.'); return; }
      // Preview imediato
      var reader = new FileReader();
      reader.onload = function(e) {
        var img  = document.getElementById('waAvatarImg');
        var fall = document.getElementById('waAvatarFallback');
        if (img)  { img.src = e.target.result; img.style.display = 'block'; }
        if (fall) fall.style.display = 'none';
      };
      reader.readAsDataURL(file);
      uploadWhatsAppFoto(file);
    });
  }

  // Botão salvar perfil (about)
  var salvarBtn = document.getElementById('waSalvarPerfilBtn');
  if (salvarBtn && !salvarBtn._waWired) {
    salvarBtn._waWired = true;
    salvarBtn.addEventListener('click', salvarWhatsAppPerfil);
  }

  // Botão solicitar nome
  var solBtn = document.getElementById('waSolicitarNomeBtn');
  if (solBtn && !solBtn._waWired) {
    solBtn._waWired = true;
    solBtn.addEventListener('click', solicitarNomeWhatsApp);
  }
}

async function uploadWhatsAppFoto(file) {
  var progress = document.getElementById('waFotoProgress');
  var success  = document.getElementById('waFotoSuccess');
  if (progress) progress.style.display = '';
  if (success)  success.style.display  = 'none';
  var jwt = await _waGetJwt();
  if (!jwt) { if (progress) progress.style.display = 'none'; toast('Sessão inválida.'); return; }
  try {
    var buffer = await file.arrayBuffer();
    var bytes  = new Uint8Array(buffer);
    var binary = '';
    var chunk  = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    var base64   = btoa(binary);
    var mimeType = file.type || 'image/jpeg';

    var res  = await fetch(_API + '/whatsapp/perfil/foto', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_base64: base64, mime_type: mimeType })
    });
    var data = await res.json();
    if (data.ok) {
      if (success) { success.style.display = ''; setTimeout(function(){ success.style.display='none'; }, 4000); }
    } else {
      toast('Erro ao enviar foto: ' + (data.error || 'Tente novamente.'));
    }
  } catch (_) {
    toast('Falha ao enviar foto. Verifique sua conexão.');
  } finally {
    if (progress) progress.style.display = 'none';
  }
}

async function salvarWhatsAppPerfil() {
  var jwt = await _waGetJwt();
  if (!jwt) { toast('Sessão inválida.'); return; }
  var btn       = document.getElementById('waSalvarPerfilBtn');
  var statusEl  = document.getElementById('waSalvarStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  var about = (document.getElementById('waAbout') || {}).value || '';
  try {
    var res  = await fetch(_API + '/whatsapp/perfil', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ about: about })
    });
    var data = await res.json();
    if (data.ok) {
      if (statusEl) { statusEl.style.display = ''; setTimeout(function(){ statusEl.style.display='none'; }, 4000); }
    } else {
      toast('Erro: ' + (data.error || 'Tente novamente.'));
    }
  } catch (_) {
    toast('Falha ao salvar. Verifique sua conexão.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar perfil no WhatsApp'; }
  }
}

async function solicitarNomeWhatsApp() {
  var input  = document.getElementById('waNomeDesejado');
  var solBtn = document.getElementById('waSolicitarNomeBtn');
  var nome   = input ? input.value.trim() : '';
  if (!nome || nome.length < 2) {
    toast('Digite o nome desejado antes de solicitar.');
    if (input) input.focus();
    return;
  }
  var jwt = await _waGetJwt();
  if (!jwt) { toast('Sessão inválida.'); return; }
  if (solBtn) { solBtn.disabled = true; solBtn.textContent = 'Enviando…'; }
  try {
    var res  = await fetch(_API + '/whatsapp/nome/solicitar', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested_name: nome })
    });
    var data = await res.json();
    if (data.ok) {
      _waShowPendingRequest(nome);
      toast('✅ Solicitação registrada! A Meta analisa em 1 a 3 dias úteis.');
    } else {
      toast('Erro: ' + (data.error || 'Tente novamente.'));
    }
  } catch (_) {
    toast('Falha ao enviar solicitação. Verifique sua conexão.');
  } finally {
    if (solBtn) { solBtn.disabled = false; solBtn.textContent = 'Solicitar'; }
  }
}
initReplyModal();

// ─── CRM DE CONTATOS ──────────────────────────────────────────────────────────
var _contactsLoaded = false;
var _contactsData   = [];
var _selectedContacts = new Set();

function updateBulkBar(){
  var bar    = document.getElementById('contactsBulkBar');
  var countEl= document.getElementById('contactsBulkCount');
  if(!bar) return;
  var n = _selectedContacts.size;
  if(n === 0){ bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  if(countEl) countEl.textContent = n + ' selecionado' + (n !== 1 ? 's' : '');
}

async function bulkUpdateStatus(newStatus){
  if(!_selectedContacts.size) return;
  var phones = Array.from(_selectedContacts);
  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  // Optimistic update
  phones.forEach(function(phone){
    _contactsData.forEach(function(c){ if(c.phone === phone) c.status = newStatus; });
  });
  _selectedContacts.clear();
  renderContacts(_contactsData, {});
  updateBulkBar();
  toast('✓ ' + phones.length + ' contato' + (phones.length !== 1 ? 's' : '') + ' atualizados.');
  // Fire PATCH calls in the background (best-effort)
  if(jwt){
    phones.forEach(function(phone){
      fetch(_API + '/account/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+jwt },
        body: JSON.stringify({ phone: phone, status: newStatus })
      }).catch(function(){});
    });
  }
}

function exportContactsCSV(){
  if(!_contactsData.length){ toast('Sem contatos para exportar.'); return; }
  var headers = ['Telefone','Nome','Status','Mensagens 30d','Anotações','Última atualização'];
  var rows = [headers].concat(_contactsData.map(function(c){
    return [
      c.phone || '',
      c.name  || '',
      c.status || 'novo',
      c.msgs30d || 0,
      (c.notes || '').replace(/\r?\n/g,' '),
      c.updated_at ? String(c.updated_at).slice(0,10) : ''
    ];
  }));
  var csv = rows.map(function(r){
    return r.map(function(v){ return '"' + String(v||'').replace(/"/g,'""') + '"'; }).join(',');
  }).join('\r\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'contatos-mercabot-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1200);
  toast('CSV gerado — verifique seus downloads.');
}
// ── CONTACT CSV IMPORT ───────────────────────────────────────────────────────
function _parseContactCSV(text){
  var lines = text.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
  if(!lines.length) return [];
  // Detect header: first row may have 'phone','telefone','number' etc.
  var header = lines[0].toLowerCase().replace(/['"]/g,'');
  var hasHeader = /phone|telefone|numero|name|nome|status/.test(header);
  var rows = hasHeader ? lines.slice(1) : lines;
  return rows.map(function(line){
    // Split on comma but respect quoted fields
    var cols = [];
    var cur = ''; var inQ = false;
    for(var i=0; i<line.length; i++){
      var ch = line[i];
      if(ch==='"'){ inQ = !inQ; }
      else if(ch===',' && !inQ){ cols.push(cur.trim()); cur=''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    var phone  = (cols[0] || '').replace(/[^0-9+]/g,'');
    var name   = (cols[1] || '').replace(/^"|"$/g,'').trim();
    var status = (cols[2] || '').replace(/^"|"$/g,'').trim().toLowerCase() || 'novo';
    var notes  = (cols[3] || '').replace(/^"|"$/g,'').trim();
    return { phone, name, status, notes };
  }).filter(function(r){ return r.phone && r.phone.replace(/\D/g,'').length >= 7; });
}

async function importContactsFromCSV(file){
  var VALID_STATUSES = ['novo','em_andamento','qualificado','convertido','arquivado'];
  var text;
  try{ text = await file.text(); }catch(_){ toast('Não foi possível ler o arquivo.'); return; }
  var rows = _parseContactCSV(text);
  if(!rows.length){ toast('Nenhum contato válido encontrado no CSV.'); return; }
  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if(!jwt){ toast('toast.session.expired'); return; }
  var btn = document.getElementById('importContactsBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Importando…'; }
  var done = 0; var errors = 0;
  // Process in batches of 4 concurrent requests
  for(var i=0; i<rows.length; i+=4){
    var batch = rows.slice(i, i+4);
    await Promise.all(batch.map(function(r){
      var status = VALID_STATUSES.includes(r.status) ? r.status : 'novo';
      return fetch(ACCOUNT_CONTACTS_URL, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: r.phone, name: r.name, notes: r.notes, status: status })
      }).then(function(res){ return res.json().catch(function(){ return {}; }); })
        .then(function(body){ if(body.ok || body.contact) done++; else errors++; })
        .catch(function(){ errors++; });
    }));
    if(btn) btn.textContent = '⏳ ' + Math.min(i+4, rows.length) + '/' + rows.length + '…';
  }
  if(btn){ btn.disabled = false; btn.textContent = '⬆ Importar CSV'; }
  toast((done > 0 ? done + ' contato' + (done!==1?'s':'') + ' importado' + (done!==1?'s':'') : '') + (errors > 0 ? (done?', ':'') + errors + ' com erro' : '') + '.');
  if(done > 0) loadContactsTab(true);
}

function _bindContactImport(){
  var btn  = document.getElementById('importContactsBtn');
  var file = document.getElementById('importContactsFile');
  if(!btn || !file || btn._importBound) return;
  btn._importBound = true;
  btn.addEventListener('click', function(){ file.value=''; file.click(); });
  file.addEventListener('change', function(){
    if(file.files && file.files[0]) importContactsFromCSV(file.files[0]);
  });
}

var _drawerPhone    = '';
var _STATUS_META = {
  novo:        { label:'Novo',         cls:'novo' },
  em_andamento:{ label:'Em andamento', cls:'em_andamento' },
  qualificado: { label:'Qualificado',  cls:'qualificado' },
  convertido:  { label:'Convertido',   cls:'convertido' },
  arquivado:   { label:'Arquivado',    cls:'arquivado' },
};

async function loadContactsTab(force){
  if(_contactsLoaded && !force) return;
  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if(!jwt) return;
  try{
    var res = await fetch(ACCOUNT_CONTACTS_URL + '?limit=100', {
      headers: { 'Authorization': 'Bearer ' + jwt }
    });
    var body = await res.json().catch(function(){ return {}; });
    if(!res.ok || !body.ok) return;
    _contactsData = body.contacts || [];
    _contactsLoaded = true;
    renderContacts(_contactsData, body.stats || {});
    bindContactFilters(jwt);
    _bindContactImport();
  }catch(_){}
}

function renderContacts(contacts, stats){
  // Stats strip
  var strip = document.getElementById('contactsStatsStrip');
  if(strip){
    strip.innerHTML = '';
    var total = stats.total || 0;
    var byStatus = stats.byStatus || {};
    var items = [{ label: 'Total', val: total, color: 'var(--text)' }];
    if(byStatus.convertido)  items.push({ label:'Convertidos',  val: byStatus.convertido,  color:'var(--green)' });
    if(byStatus.qualificado) items.push({ label:'Qualificados', val: byStatus.qualificado, color:'#f59e0b' });
    if(byStatus.em_andamento)items.push({ label:'Em andamento', val: byStatus.em_andamento,color:'#60a5fa' });
    if(byStatus.novo)        items.push({ label:'Novos',        val: byStatus.novo,        color:'var(--muted)' });
    items.forEach(function(it){
      var el = document.createElement('div');
      el.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:.4rem .85rem;font-size:.88rem;display:flex;align-items:center;gap:.4rem';
      el.innerHTML = '<strong style="color:'+it.color+'">'+it.val+'</strong><span style="color:var(--faint)">'+it.label+'</span>';
      strip.appendChild(el);
    });
  }

  // List
  var listEl  = document.getElementById('contactsList');
  var emptyEl = document.getElementById('contactsListEmpty');
  if(!listEl) return;
  listEl.innerHTML = '';
  if(!contacts || !contacts.length){
    if(emptyEl) listEl.appendChild(emptyEl);
    return;
  }
  contacts.forEach(function(c){
    var card = document.createElement('div');
    card.className = 'contact-card';
    card.dataset.phone = c.phone || '';
    if(_selectedContacts.has(c.phone)) card.style.outline = '2px solid rgba(0,230,118,.4)';

    var rawPhone = String(c.phone || '');
    var displayPhone = rawPhone.length > 6 ? rawPhone.slice(0,4)+'•••'+rawPhone.slice(-2) : rawPhone;
    var meta = _STATUS_META[c.status] || _STATUS_META.novo;

    // Checkbox
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = _selectedContacts.has(c.phone);
    cb.style.cssText = 'flex-shrink:0;width:16px;height:16px;accent-color:var(--green);cursor:pointer;margin-top:2px';
    cb.setAttribute('aria-label', 'Selecionar ' + (c.name || displayPhone));
    cb.addEventListener('click', function(e){
      e.stopPropagation();
      if(cb.checked){ _selectedContacts.add(c.phone); card.style.outline='2px solid rgba(0,230,118,.4)'; }
      else { _selectedContacts.delete(c.phone); card.style.outline=''; }
      updateBulkBar();
    });

    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML =
      '<div class="contact-card-left">' +
        '<div class="contact-card-phone">' + displayPhone +
          '<span class="status-pill ' + meta.cls + '" style="margin-left:.5rem">' + meta.label + '</span>' +
          (c.needsHuman ? '<span class="convs-needs-badge" style="margin-left:.35rem">⚠ Atenção</span>' : '') +
        '</div>' +
        (c.name ? '<div class="contact-card-name">' + _esc(c.name) + '</div>' : '') +
        (c.notes ? '<div class="contact-card-preview">' + _esc(c.notes.slice(0, 60)) + '</div>' : '') +
      '</div>';

    var right = document.createElement('div');
    right.innerHTML =
      '<div class="contact-card-right">' +
        '<div class="contact-card-msgs">' + (c.msgs30d || 0) + ' msg' + (c.msgs30d !== 1 ? 's' : '') + '</div>' +
        '<div class="contact-card-time">' + _relativeTime(c.updated_at) + '</div>' +
      '</div>';

    card.style.display = 'flex';
    card.style.alignItems = 'flex-start';
    card.style.gap = '.6rem';
    card.appendChild(cb);
    card.appendChild(info);
    card.appendChild(right);
    card.addEventListener('click', function(e){ if(e.target === cb) return; openContactDrawer(c); });
    listEl.appendChild(card);
  });
}

function _esc(s){ var d=document.createElement('div'); d.textContent=String(s||''); return d.innerHTML; }

function bindContactFilters(jwt){
  var searchEl  = document.getElementById('contactSearch');
  var filterEl  = document.getElementById('contactStatusFilter');
  var countEl   = document.getElementById('contactsCount');
  var exportBtn = document.getElementById('exportContactsBtn');
  if(exportBtn) exportBtn.addEventListener('click', exportContactsCSV);

  // Bulk action bar
  var bulkBar = document.getElementById('contactsBulkBar');
  if(bulkBar){
    bulkBar.querySelectorAll('[data-bulk-status]').forEach(function(btn){
      btn.addEventListener('click', function(){ bulkUpdateStatus(this.dataset.bulkStatus); });
    });
  }
  var clearBtn = document.getElementById('contactsBulkClear');
  if(clearBtn) clearBtn.addEventListener('click', function(){
    _selectedContacts.clear();
    renderContacts(_contactsData, {});
    updateBulkBar();
  });

  function applyFilter(){
    var q  = (searchEl ? searchEl.value.trim().toLowerCase() : '');
    var st = (filterEl ? filterEl.value : '');
    var filtered = _contactsData.filter(function(c){
      var matchQ  = !q  || (c.phone||'').includes(q) || (c.name||'').toLowerCase().includes(q);
      var matchSt = !st || c.status === st;
      return matchQ && matchSt;
    });
    renderContacts(filtered, {});
    if(countEl){
      if(q || st){
        countEl.textContent = filtered.length + ' de ' + _contactsData.length + ' contato' + (_contactsData.length !== 1 ? 's' : '') + ' encontrado' + (filtered.length !== 1 ? 's' : '');
        countEl.style.display = '';
      } else {
        countEl.style.display = 'none';
      }
    }
  }
  if(searchEl)  searchEl.addEventListener('input',  applyFilter);
  if(filterEl)  filterEl.addEventListener('change', applyFilter);
}

function openContactDrawer(contact){
  _drawerPhone = contact.phone || '';
  var rawPhone = _drawerPhone;
  var displayPhone = rawPhone.length > 6 ? rawPhone.slice(0,4)+'•••'+rawPhone.slice(-2) : rawPhone;

  var phoneEl  = document.getElementById('drawerPhone');
  var nameEl   = document.getElementById('drawerName');
  var notesEl  = document.getElementById('drawerNotes');
  var historyEl= document.getElementById('drawerHistory');
  var pillsEl  = document.getElementById('drawerStatusPills');
  var drawer   = document.getElementById('contactDrawer');
  var overlay  = document.getElementById('contactDrawerOverlay');

  if(phoneEl)  phoneEl.textContent    = displayPhone;
  if(nameEl)   nameEl.textContent     = contact.name || '';
  if(notesEl)  notesEl.value          = contact.notes || '';
  if(historyEl) historyEl.innerHTML   = '<div style="color:var(--faint);font-size:.88rem">Carregando histórico…</div>';

  // Status pills
  if(pillsEl){
    pillsEl.innerHTML = '';
    var currentStatus = contact.status || 'novo';
    Object.keys(_STATUS_META).forEach(function(key){
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'status-pill ' + _STATUS_META[key].cls + (key === currentStatus ? ' selected' : '');
      pill.textContent = _STATUS_META[key].label;
      if(key === currentStatus) pill.style.fontWeight = '800';
      pill.addEventListener('click', function(){
        pillsEl.querySelectorAll('.status-pill').forEach(function(p){ p.style.fontWeight=''; });
        pill.style.fontWeight = '800';
        contact.status = key;
        // Update card in list
        _contactsData.forEach(function(c){ if(c.phone===contact.phone) c.status = key; });
      });
      pillsEl.appendChild(pill);
    });
  }

  if(drawer){
    drawer.classList.add('open');
    drawer.dataset.rawPhone = rawPhone;
  }
  if(overlay){ overlay.style.display = ''; overlay.addEventListener('click', closeContactDrawer, { once: true }); }
  // Set pause toggle initial state
  var togEl = document.getElementById('drawerPauseToggle');
  if(togEl) togEl.checked = !isContactPaused(rawPhone);

  // Load conversation history for this contact
  loadContactHistory(rawPhone);
}

async function loadContactHistory(phone){
  var historyEl = document.getElementById('drawerHistory');
  if(!historyEl) return;
  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if(!jwt) return;
  try{
    var res = await fetch(ACCOUNT_CONVERSATIONS_URL + '?limit=40&contact=' + encodeURIComponent(phone), {
      headers: { 'Authorization': 'Bearer ' + jwt }
    });
    var body = await res.json().catch(function(){ return {}; });
    var logs = (body.ok && Array.isArray(body.logs)) ? body.logs : [];
    historyEl.innerHTML = '';
    if(!logs.length){
      historyEl.innerHTML = '<div style="color:var(--faint);font-size:.88rem">Nenhuma mensagem registrada ainda.</div>';
      return;
    }
    // Show in chronological order (reverse since API returns desc)
    logs.slice().reverse().forEach(function(log){
      if(log.user_text){
        var m = document.createElement('div');
        m.className = 'drawer-msg user';
        m.innerHTML = '<div>' + _esc(log.user_text) + '</div><div class="drawer-msg-time">👤 ' + _relativeTime(log.created_at) + '</div>';
        historyEl.appendChild(m);
      }
      if(log.assistant_text){
        var cls = log.direction === 'outbound' ? 'out' : 'ai';
        var prefix = log.direction === 'outbound' ? '✉️ Você' : '🤖 Bot';
        var m2 = document.createElement('div');
        m2.className = 'drawer-msg ' + cls;
        m2.innerHTML = '<div>' + _esc(log.assistant_text) + '</div><div class="drawer-msg-time">' + prefix + ' · ' + _relativeTime(log.created_at) + '</div>';
        historyEl.appendChild(m2);
      }
    });
    historyEl.scrollTop = historyEl.scrollHeight;
  }catch(_){
    historyEl.innerHTML = '<div style="color:var(--faint);font-size:.88rem">Erro ao carregar histórico.</div>';
  }
}

function closeContactDrawer(){
  var drawer  = document.getElementById('contactDrawer');
  var overlay = document.getElementById('contactDrawerOverlay');
  if(drawer)  drawer.classList.remove('open');
  if(overlay) overlay.style.display = 'none';
  _drawerPhone = '';
}

async function saveContactDrawer(){
  if(!_drawerPhone) return;
  var nameEl  = document.getElementById('drawerName');
  var notesEl = document.getElementById('drawerNotes');
  var pillsEl = document.getElementById('drawerStatusPills');
  var saveBtn = document.getElementById('drawerSaveBtn');

  var name  = nameEl  ? (nameEl.textContent  || '').trim() : '';
  var notes = notesEl ? (notesEl.value       || '').trim() : '';
  // Find selected status from contact data
  var contact = _contactsData.find(function(c){ return c.phone === _drawerPhone; });
  var status  = (contact && contact.status) || 'novo';

  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if(!jwt){ toast('Sessão expirada.'); return; }

  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Salvando…'; }
  try{
    var res = await fetch(ACCOUNT_CONTACTS_URL, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: _drawerPhone, name, notes, status })
    });
    var body = await res.json().catch(function(){ return {}; });
    if(res.ok && body.ok){
      // Update local data
      _contactsData.forEach(function(c){
        if(c.phone === _drawerPhone){ c.name = name; c.notes = notes; c.status = status; }
      });
      renderContacts(_contactsData, {});
      toast('Contato salvo.');
    } else {
      toast((body && body.error) || 'Erro ao salvar. Tente novamente.');
    }
  }catch(_){ toast('Erro de conexão.'); }
  finally{ if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; } }
}

async function sendDrawerReply(){
  var phone = _drawerPhone;
  var textEl = document.getElementById('drawerReplyText');
  var btn    = document.getElementById('drawerReplyBtn');
  var message = textEl ? textEl.value.trim() : '';
  if(!phone || !message){ toast('Preencha a mensagem.'); return; }

  var session = supabaseClient ? await supabaseClient.auth.getSession() : null;
  var jwt = session && session.data && session.data.session ? session.data.session.access_token : '';
  if(!jwt){ toast('Sessão expirada.'); return; }

  if(btn){ btn.disabled = true; btn.textContent = 'Enviando…'; }
  try{
    var res = await fetch(WHATSAPP_REPLY_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, message })
    });
    var body = await res.json().catch(function(){ return {}; });
    if(res.ok && body.ok){
      toast('Mensagem enviada.');
      if(textEl) textEl.value = '';
      loadContactHistory(phone);
    } else {
      toast((body && body.error) || 'Erro ao enviar.');
    }
  }catch(_){ toast('Erro de conexão.'); }
  finally{ if(btn){ btn.disabled = false; btn.textContent = 'Enviar ↗'; } }
}

// Bind drawer buttons (called once on load)
(function initContactsModule(){
  var closeBtn = document.getElementById('drawerClose');
  var saveBtn  = document.getElementById('drawerSaveBtn');
  var replyBtn = document.getElementById('drawerReplyBtn');
  if(closeBtn) closeBtn.addEventListener('click', closeContactDrawer);
  if(saveBtn)  saveBtn.addEventListener('click',  saveContactDrawer);
  if(replyBtn) replyBtn.addEventListener('click',  sendDrawerReply);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeContactDrawer(); });
}());

// ══════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ══════════════════════════════════════════════════════════════
var _analyticsLoaded = false;
var _lastAnalyticsStats    = null;
var _lastAnalyticsContacts = [];
var _lastAnalyticsUsage    = null;

function exportAnalyticsCSV(){
  var stats = _lastAnalyticsStats;
  if(!stats){ toast('Abra a aba Análise primeiro para carregar os dados.'); return; }
  var today = new Date().toISOString().slice(0,10);
  var month = (stats.totalMonth || 0);
  var used  = (_lastAnalyticsUsage && _lastAnalyticsUsage.used) || month;
  var limit = (_lastAnalyticsUsage && _lastAnalyticsUsage.limit) || 1000;
  var iaRate = month > 0 ? Math.min(100, Math.round((used / Math.max(month,1)) * 100)) : 0;

  var summaryRows = [
    ['Período','Conversas','Taxa IA (%)','Msgs IA usadas','Limite do plano','Exportado em'],
    ['Mês atual', month, iaRate + '%', used, limit, today]
  ];
  var dailyRows = [['Data','Conversas']];
  if(stats.dailyBreakdown && stats.dailyBreakdown.length){
    stats.dailyBreakdown.forEach(function(d){ dailyRows.push([d.date, d.count||0]); });
  }
  var contactRows = [['Telefone','Nome','Status']];
  _lastAnalyticsContacts.forEach(function(c){ contactRows.push([c.phone||'', c.name||'', c.status||'novo']); });

  function toCSV(rows){ return rows.map(function(r){ return r.map(function(v){ return '"'+String(v||'')+'"'; }).join(','); }).join('\r\n'); }
  var content = '# RESUMO\r\n' + toCSV(summaryRows) + '\r\n\r\n# VOLUME DIÁRIO\r\n' + toCSV(dailyRows) + '\r\n\r\n# PIPELINE DE CONTATOS\r\n' + toCSV(contactRows);
  var blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'analytics-mercabot-' + today + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1200);
  toast('Relatório exportado — verifique seus downloads.');
}

function loadAnalytics(){
  if(_analyticsLoaded) return; // cache for session

  // Use already-loaded state if available
  var convStats  = state.convStats  || null;
  var contacts   = state.contacts   || null;
  var usage      = state.usage      || null;

  if(convStats) _renderAnalytics(convStats, contacts, usage);

  // Fetch fresh data
  supabaseClient.auth.getSession().then(function(sessionResult){
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session
      ? sessionResult.data.session.access_token : '';
    if(!jwt) return;

    Promise.all([
      fetch(_API + '/account/conversations?limit=30', { headers:{ 'Authorization':'Bearer ' + jwt } }).then(function(r){ return r.json(); }).catch(function(){ return null; }),
      fetch(_API + '/account/contacts?limit=200',      { headers:{ 'Authorization':'Bearer ' + jwt } }).then(function(r){ return r.json(); }).catch(function(){ return null; }),
      fetch(_API + '/account/usage',                   { headers:{ 'Authorization':'Bearer ' + jwt } }).then(function(r){ return r.json(); }).catch(function(){ return null; })
    ]).then(function(results){
      var convData    = results[0];
      var contactData = results[1];
      var usageData   = results[2];
      var stats = convData && convData.stats ? convData.stats : null;
      var conts = contactData && Array.isArray(contactData.contacts) ? contactData.contacts : (Array.isArray(contactData) ? contactData : []);
      _renderAnalytics(stats, conts, usageData);
      _analyticsLoaded = true;
    });
  });
}

function _renderAnalytics(stats, contacts, usage){
  // Cache for export
  _lastAnalyticsStats    = stats;
  _lastAnalyticsContacts = Array.isArray(contacts) ? contacts : [];
  _lastAnalyticsUsage    = usage || null;
  // Wire export button (safe to call multiple times — addEventListener is idempotent per func ref)
  var expBtn = document.getElementById('exportAnalyticsBtn');
  if(expBtn && !expBtn._exportBound){ expBtn.addEventListener('click', exportAnalyticsCSV); expBtn._exportBound = true; }

  // ── KPIs ────────────────────────────────────────────
  var today   = (stats && typeof stats.totalToday  === 'number') ? stats.totalToday  : 0;
  var week    = (stats && typeof stats.totalWeek   === 'number') ? stats.totalWeek   : 0;
  var month   = (stats && typeof stats.totalMonth  === 'number') ? stats.totalMonth  : 0;
  var usedMsg = (usage && typeof usage.used  === 'number') ? usage.used  : month;
  var limitMsg= (usage && typeof usage.limit === 'number') ? usage.limit : 1000;

  var todayEl    = document.getElementById('anToday');
  var todaySubEl = document.getElementById('anTodaySub');
  var iaRateEl   = document.getElementById('anIaRate');
  var roiEl      = document.getElementById('anRoi');
  if(todayEl)    todayEl.textContent  = today;
  if(todaySubEl) todaySubEl.textContent = week + ' esta semana · ' + month + ' este mês';
  var aiHandled = (stats && typeof stats.aiHandled === 'number') ? stats.aiHandled : usedMsg;
  var iaRate = month > 0 ? Math.min(100, Math.round((aiHandled / Math.max(month, 1)) * 100)) : 0;
  if(iaRateEl)   iaRateEl.textContent  = iaRate + '%';

  // ROI: assume R$4/conversation saved vs human agent (R$25/h, 6 min avg)
  var roiVal = month * 4;
  if(roiEl) roiEl.textContent = 'R$ ' + roiVal.toLocaleString('pt-BR');

  // ── Bar chart (7-day) ─────────────────────────────
  var chartEl = document.getElementById('anBarChart');
  if(chartEl && stats && Array.isArray(stats.dailyBreakdown) && stats.dailyBreakdown.length){
    var daily = stats.dailyBreakdown;
    var maxVal = Math.max.apply(null, daily.map(function(d){ return d.count || 0; })) || 1;
    chartEl.innerHTML = '';
    var todayDate = new Date().toISOString().slice(0,10);
    daily.forEach(function(d){
      var pct  = Math.round(((d.count || 0) / maxVal) * 100);
      var isToday = (d.date === todayDate);
      var col  = document.createElement('div');
      col.className = 'an-bar-col';
      var fill = document.createElement('div');
      fill.className = 'an-bar-fill' + (isToday ? ' is-today' : '');
      fill.style.height = pct + '%';
      fill.title = (d.count || 0) + ' ' + MB_t('chart.tooltip.suffix', 'conversas em') + ' ' + d.date;
      var lbl = document.createElement('div');
      lbl.className = 'an-bar-lbl';
      try {
        var dt = new Date(d.date + 'T12:00:00');
        lbl.textContent = isToday ? MB_t('date.today', 'Hoje') : dt.toLocaleDateString(MB_locale(),{weekday:'short'}).replace('.','');
      } catch(_){ lbl.textContent = d.date.slice(5); }
      col.appendChild(fill);
      col.appendChild(lbl);
      chartEl.appendChild(col);
    });
  } else if(chartEl){
    chartEl.innerHTML = '<div style="color:var(--muted);font-size:.85rem;align-self:center">' + MB_t('chart.empty', 'Sem dados ainda') + '</div>';
  }

  // ── Pipeline funnel ─────────────────────────────────
  var pipeEl = document.getElementById('anPipeline');
  if(pipeEl && Array.isArray(contacts) && contacts.length){
    var statusMap   = { novo:'#64748b', em_andamento:'#3b82f6', qualificado:'#8b5cf6', convertido:'#00e676', arquivado:'#374151' };
    var statusLabel = { novo:'Novo', em_andamento:'Em andamento', qualificado:'Qualificado', convertido:'Convertido', arquivado:'Arquivado' };
    var counts = {};
    contacts.forEach(function(c){
      var s = c.status || 'novo';
      counts[s] = (counts[s] || 0) + 1;
    });
    var total = contacts.length || 1;
    pipeEl.innerHTML = '';
    ['novo','em_andamento','qualificado','convertido','arquivado'].forEach(function(s){
      var n = counts[s] || 0;
      if(!n && s === 'arquivado') return;
      var row = document.createElement('div');
      row.className = 'an-pipe-row';
      var lbl = document.createElement('div');
      lbl.className = 'an-pipe-lbl';
      lbl.textContent = statusLabel[s] || s;
      var track = document.createElement('div');
      track.className = 'an-pipe-track';
      var fill = document.createElement('div');
      fill.className = 'an-pipe-fill';
      fill.style.width = Math.round((n / total) * 100) + '%';
      fill.style.background = statusMap[s] || '#64748b';
      fill.style.opacity = '.75';
      track.appendChild(fill);
      var num = document.createElement('div');
      num.className = 'an-pipe-n';
      num.textContent = n;
      row.appendChild(lbl);
      row.appendChild(track);
      row.appendChild(num);
      pipeEl.appendChild(row);
    });
  } else if(pipeEl){
    pipeEl.innerHTML = '<div style="color:var(--muted);font-size:.85rem">Sem contatos ainda</div>';
  }

  // ── Week insights ───────────────────────────────────
  var insightsWrap = document.getElementById('anWeekInsights');
  var insightsBody = document.getElementById('anWeekInsightsBody');
  if(insightsBody && stats && Array.isArray(stats.dailyBreakdown) && stats.dailyBreakdown.length){
    var daily7 = stats.dailyBreakdown;
    var counts7 = daily7.map(function(d){ return d.count || 0; });
    var total7  = counts7.reduce(function(a,b){ return a+b; }, 0);
    var avg7    = total7 / (counts7.length || 1);
    var maxD    = daily7.reduce(function(a,b){ return (b.count||0) > (a.count||0) ? b : a; });
    var minD    = daily7.reduce(function(a,b){ return (b.count||0) < (a.count||0) ? b : a; });
    var todayCount = today;
    var trendIcon  = avg7 > 0 ? (todayCount >= avg7 ? '📈' : '📉') : '';

    var insights = [
      { label: 'Dia de pico', val: (maxD.count||0) + ' conversas', sub: (function(){ try{ return new Date(maxD.date+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'}); }catch(_){ return maxD.date; } })() },
      { label: 'Média diária', val: Math.round(avg7) + '/dia', sub: '7 dias' },
      { label: 'Hoje vs média', val: trendIcon + ' ' + todayCount + ' hoje', sub: avg7 > 0 ? (todayCount >= avg7 ? '+' + Math.round(((todayCount - avg7)/Math.max(avg7,1))*100) + '% acima da média' : Math.round(((avg7 - todayCount)/Math.max(avg7,1))*100) + '% abaixo da média') : '—' },
      { label: 'Taxa IA', val: iaRate + '%', sub: 'automação este mês' }
    ];
    insightsBody.innerHTML = insights.map(function(ins){
      return '<div style="min-width:130px">' +
        '<div style="font-size:.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.2rem">' + ins.label + '</div>' +
        '<div style="font-size:1.35rem;font-weight:800;color:var(--text);letter-spacing:-.03em;line-height:1.1">' + ins.val + '</div>' +
        '<div style="font-size:.78rem;color:var(--faint);margin-top:.15rem">' + ins.sub + '</div>' +
      '</div>';
    }).join('');
    if(insightsWrap) insightsWrap.style.display = '';
  }

  // ── Top contacts by conversation count ─────────────
  (function(){
    var card    = document.getElementById('anTopContactsCard');
    var listEl  = document.getElementById('anTopContacts');
    if(!card || !listEl) return;
    // Group _lastConvsLogs by contact_phone
    var countMap = {};
    _lastConvsLogs.forEach(function(l){
      var ph = l.contact_phone || l.phone || '';
      if(!ph) return;
      countMap[ph] = (countMap[ph] || 0) + 1;
    });
    var sorted = Object.keys(countMap).sort(function(a,b){ return countMap[b] - countMap[a]; }).slice(0,7);
    if(!sorted.length){ card.style.display = 'none'; return; }
    card.style.display = '';
    var maxCount = countMap[sorted[0]] || 1;
    var contactNameMap = {};
    if(Array.isArray(contacts)){
      contacts.forEach(function(c){ if(c.phone) contactNameMap[c.phone] = c.name || ''; });
    }
    listEl.innerHTML = '';
    sorted.forEach(function(ph, idx){
      var cnt  = countMap[ph];
      var name = contactNameMap[ph] || ('···' + ph.slice(-4));
      var pct  = Math.round((cnt / maxCount) * 100);
      var row  = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:.55rem;align-items:center';
      var rank = document.createElement('div');
      rank.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--muted);width:14px;text-align:right';
      rank.textContent = (idx+1) + '.';
      var barWrap = document.createElement('div');
      barWrap.style.cssText = 'position:relative;height:20px;background:var(--bg3);border-radius:4px;overflow:hidden';
      var bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;top:0;left:0;height:100%;background:rgba(0,230,118,.22);border-radius:4px;width:' + pct + '%';
      var nameEl = document.createElement('div');
      nameEl.style.cssText = 'position:absolute;left:.4rem;top:50%;transform:translateY(-50%);font-size:.78rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 1rem)';
      nameEl.textContent = name;
      barWrap.appendChild(bar);
      barWrap.appendChild(nameEl);
      var cntEl = document.createElement('div');
      cntEl.style.cssText = 'font-size:.78rem;font-weight:700;color:var(--muted);white-space:nowrap;min-width:40px;text-align:right';
      cntEl.textContent = cnt + ' msg' + (cnt!==1?'s':'');
      row.appendChild(rank);
      row.appendChild(barWrap);
      row.appendChild(cntEl);
      listEl.appendChild(row);
    });
  })();

  // ── ROI detail ─────────────────────────────────────
  var roiDetailEl = document.getElementById('anRoiDetail');
  if(roiDetailEl){
    var avgMinutes  = 6;
    var hourlyRate  = 25;
    var costPerConv = (avgMinutes / 60) * hourlyRate;
    var rows = [
      ['Conversas automatizadas este mês', month + ' conversas'],
      ['Tempo médio por atendimento manual', avgMinutes + ' minutos'],
      ['Custo hora de atendente', 'R$ ' + hourlyRate + ',00/h'],
      ['Custo por conversa (sem IA)', 'R$ ' + costPerConv.toFixed(2).replace('.',',')],
      ['Economia total estimada', '<strong style="color:var(--green)">R$ ' + (month * costPerConv).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '</strong>']
    ];
    roiDetailEl.innerHTML = rows.map(function(r){
      return '<div class="an-roi-row"><span class="an-roi-lbl">' + r[0] + '</span><span class="an-roi-val">' + r[1] + '</span></div>';
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════
// CONVERSATION THREAD MODAL
// ══════════════════════════════════════════════════════════════
var _threadPhone = null;

function openThreadModal(rawPhone, displayPhone){
  _threadPhone = rawPhone;
  var overlay = document.getElementById('threadOverlay');
  var titleEl = document.getElementById('threadTitle');
  var subEl   = document.getElementById('threadSub');
  var bodyEl  = document.getElementById('threadBody');
  if(!overlay) return;
  titleEl.textContent = 'Conversa com ' + (displayPhone || rawPhone);
  subEl.textContent   = 'Carregando histórico...';
  bodyEl.innerHTML    = '<div class="thread-loading">⏳ Carregando...</div>';
  overlay.classList.add('open');
  document.body.classList.add('modal-open');

  supabaseClient.auth.getSession().then(function(sessionResult){
    var jwt = sessionResult && sessionResult.data && sessionResult.data.session
      ? sessionResult.data.session.access_token : '';
    if(!jwt){ bodyEl.innerHTML = '<div class="thread-loading">Sessão expirada.</div>'; return; }

    fetch(_API + '/account/conversations?limit=40&contact=' + encodeURIComponent(rawPhone), {
      headers: { 'Authorization': 'Bearer ' + jwt }
    }).then(function(r){ return r.json(); })
    .then(function(data){
      var logs = data.conversations || data.logs || (Array.isArray(data) ? data : []);
      subEl.textContent = logs.length + ' mensagens encontradas';
      if(!logs.length){
        bodyEl.innerHTML = '<div class="thread-loading">Nenhuma conversa ainda.</div>';
        return;
      }
      bodyEl.innerHTML = '';
      var sorted = logs.slice().sort(function(a,b){ return new Date(a.created_at) - new Date(b.created_at); });
      sorted.forEach(function(log){
        if(log.user_text){
          var m = document.createElement('div');
          m.className = 'th-msg th-user';
          var ts = log.created_at ? new Date(log.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
          m.innerHTML = '<div class="th-bubble">' + _escThread(log.user_text) + '</div><div class="th-meta">👤 Cliente · ' + ts + '</div>';
          bodyEl.appendChild(m);
        }
        if(log.assistant_text){
          var isHuman = log.direction === 'outbound' && log.source === 'human';
          var m2 = document.createElement('div');
          m2.className = 'th-msg ' + (isHuman ? 'th-human' : 'th-bot');
          var ts2 = log.created_at ? new Date(log.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
          var tag  = isHuman ? '<span class="th-tag human">Humano</span>' : '<span class="th-tag ai">IA</span>';
          m2.innerHTML = '<div class="th-bubble">' + _escThread(log.assistant_text) + '</div><div class="th-meta">' + tag + ' · ' + ts2 + '</div>';
          bodyEl.appendChild(m2);
        }
      });
      bodyEl.scrollTop = bodyEl.scrollHeight;
    })
    .catch(function(){ bodyEl.innerHTML = '<div class="thread-loading">Erro ao carregar. Tente novamente.</div>'; });
  });
}

function _escThread(str){
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function closeThreadModal(){
  var overlay = document.getElementById('threadOverlay');
  if(overlay) overlay.classList.remove('open');
  document.body.classList.remove('modal-open');
  _threadPhone = null;
}

// Thread modal event bindings
(function(){
  var closeBtn = document.getElementById('threadCloseBtn');
  if(closeBtn) closeBtn.addEventListener('click', closeThreadModal);
  var overlay = document.getElementById('threadOverlay');
  if(overlay) overlay.addEventListener('click', function(e){ if(e.target === overlay) closeThreadModal(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && _threadPhone) closeThreadModal(); });

  var sendBtn = document.getElementById('threadSendBtn');
  var inputEl = document.getElementById('threadInput');
  if(sendBtn && inputEl){
    sendBtn.addEventListener('click', function(){
      var msg = inputEl.value.trim();
      if(!msg || !_threadPhone) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Enviando...';
      supabaseClient.auth.getSession().then(function(sessionResult){
        var jwt = sessionResult && sessionResult.data && sessionResult.data.session
          ? sessionResult.data.session.access_token : '';
        if(!jwt){ sendBtn.disabled = false; sendBtn.textContent = 'Enviar ↗'; return; }
        fetch(_API + '/whatsapp/reply', {
          method:'POST',
          headers:{ 'Authorization':'Bearer ' + jwt, 'Content-Type':'application/json' },
          body: JSON.stringify({ to: _threadPhone, message: msg })
        }).then(function(r){ return r.json(); })
        .then(function(d){
          if(d.ok || d.success){
            inputEl.value = '';
            var bodyEl = document.getElementById('threadBody');
            var m = document.createElement('div');
            m.className = 'th-msg th-human';
            var ts = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
            m.innerHTML = '<div class="th-bubble">' + _escThread(msg) + '</div><div class="th-meta"><span class="th-tag human">Você</span> · ' + ts + '</div>';
            if(bodyEl){ bodyEl.appendChild(m); bodyEl.scrollTop = bodyEl.scrollHeight; }
            toast('Mensagem enviada ✓');
          } else {
            toast('Erro ao enviar: ' + (d.error || 'tente novamente'));
          }
        })
        .catch(function(){ toast('Erro de conexão'); })
        .finally(function(){ sendBtn.disabled = false; sendBtn.textContent = 'Enviar ↗'; });
      });
    });
    inputEl.addEventListener('input', function(){
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px';
    });
  }
}());

// ══════════════════════════════════════════════════════════════
// PAUSAR IA PER CONTACT
// ══════════════════════════════════════════════════════════════
var _pausedContacts = {};

function loadPausedContacts(){
  try{ _pausedContacts = JSON.parse(localStorage.getItem('mb_paused_contacts') || '{}'); }catch(_){ _pausedContacts = {}; }
}

function savePausedContacts(){
  try{ localStorage.setItem('mb_paused_contacts', JSON.stringify(_pausedContacts)); }catch(_){}
}

function isContactPaused(phone){ return !!_pausedContacts[phone]; }

function setContactPaused(phone, paused){
  if(paused){ _pausedContacts[phone] = Date.now(); }
  else { delete _pausedContacts[phone]; }
  savePausedContacts();
  // Re-render conversation timeline to update pause badges
  if(typeof renderConversas === 'function') renderConversas(_lastConvsLogs, _lastConvsStats);
}

loadPausedContacts();

// Wire up the drawer pause toggle
(function(){
  var tog = document.getElementById('drawerPauseToggle');
  if(!tog) return;
  tog.addEventListener('change', function(){
    var drawer = document.getElementById('contactDrawer');
    var rawPhone = drawer ? (drawer.dataset.rawPhone || '') : '';
    if(!rawPhone) return;
    setContactPaused(rawPhone, !tog.checked);
    toast(tog.checked ? '✅ IA reativada para este contato' : '⏸ IA pausada — responda manualmente');
  });
}());

// ── GUIDED TOUR ───────────────────────────────────────────────────────────────
(function(){
  var TOUR_KEY = 'mb_tour_done_v1';
  var _tourIdx  = 0;
  var _tourRaf  = null;

  var STEPS = [
    {
      sel: '[data-tab="dashboard"]',
      title: 'Seu painel de controle',
      body:  'Aqui você acompanha tudo da operação: ativação, contatos de hoje, mensagens e saúde do bot em tempo real.',
      pos: 'bottom'
    },
    {
      sel: '#quickstartCard',
      title: 'Ativação em 3 etapas',
      body:  'Este card guia você do zero à operação completa. Comece informando o número oficial do WhatsApp — o restante a MercaBot conduz.',
      pos: 'bottom'
    },
    {
      sel: '[data-tab="contatos"]',
      title: 'Contatos e conversas',
      body:  'Veja todos os leads que chegaram pelo WhatsApp. Clique em qualquer contato para ver o histórico completo e pausar a IA quando quiser assumir pessoalmente.',
      pos: 'bottom'
    },
    {
      sel: '[data-tab="analise"]',
      title: 'Análise de performance',
      body:  'Acompanhe volume diário, taxa de automação da IA e ROI estimado. Tudo atualizado a cada acesso.',
      pos: 'bottom'
    },
    {
      sel: '[data-tab="plano"]',
      title: 'Seu plano',
      body:  'Veja os detalhes do plano ativo, uso do mês e faça upgrade quando precisar de mais capacidade.',
      pos: 'bottom'
    }
  ];

  function tourDone(){
    try{ localStorage.setItem(TOUR_KEY, '1'); }catch(_){}
  }
  function isTourDone(){
    try{ return !!localStorage.getItem(TOUR_KEY); }catch(_){ return true; }
  }

  function getRect(sel){
    var el = document.querySelector(sel);
    if(!el) return null;
    return el.getBoundingClientRect();
  }

  function buildDots(){
    var dotsEl = document.getElementById('tourDots');
    if(!dotsEl) return;
    dotsEl.innerHTML = '';
    STEPS.forEach(function(_, i){
      var d = document.createElement('div');
      d.className = 'tour-dot' + (i === _tourIdx ? ' t-active' : '');
      dotsEl.appendChild(d);
    });
  }

  // Cut a rectangular hole in the backdrop so the highlighted element
  // appears at FULL brightness (not dimmed), while everything else stays dark.
  // Uses CSS clip-path polygon(evenodd): a region enclosed by an even number
  // of path contours is treated as "outside" the clip-path → transparent.
  function _setBackdropClip(rect, pad){
    var bd = document.getElementById('tourBackdrop');
    if(!bd) return;
    if(!rect){ bd.style.clipPath = ''; return; }
    var l  = Math.round(rect.left   - pad);
    var t  = Math.round(rect.top    - pad);
    var r  = Math.round(rect.right  + pad);
    var b  = Math.round(rect.bottom + pad);
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    // Outer rectangle (fills viewport) + inner rectangle (hole at target)
    // evenodd rule: inner area has 2 crossings → treated as outside → not rendered
    bd.style.clipPath =
      'polygon(evenodd,' +
      '0px 0px,' + vw + 'px 0px,' + vw + 'px ' + vh + 'px,0px ' + vh + 'px,' +
      l + 'px ' + t + 'px,' + r + 'px ' + t + 'px,' + r + 'px ' + b + 'px,' + l + 'px ' + b + 'px' +
      ')';
  }

  function positionTip(rect, pos){
    var tip  = document.getElementById('tourTip');
    var spot = document.getElementById('tourSpotlight');
    if(!tip || !spot || !rect) return;

    var pad = 10; // spotlight padding around target
    spot.style.display = 'block'; // make visible now that we have dimensions
    spot.style.left   = (rect.left   - pad) + 'px';
    spot.style.top    = (rect.top    - pad) + 'px';
    spot.style.width  = (rect.width  + pad*2) + 'px';
    spot.style.height = (rect.height + pad*2) + 'px';

    // Punch a hole in the backdrop — target element appears at full brightness
    _setBackdropClip(rect, pad);

    var tw = tip.offsetWidth || 290; // tip width (prefer actual rendered width)
    var th = tip.offsetHeight || 160;
    var margin = 14;

    var tipLeft, tipTop;

    if(pos === 'bottom'){
      tipTop  = rect.bottom + pad + margin;
      tipLeft = rect.left + rect.width/2 - tw/2;
    } else if(pos === 'top'){
      tipTop  = rect.top - pad - margin - th;
      tipLeft = rect.left + rect.width/2 - tw/2;
    } else if(pos === 'right'){
      tipLeft = rect.right + pad + margin;
      tipTop  = rect.top + rect.height/2 - th/2;
    } else {
      tipLeft = rect.left - pad - margin - tw;
      tipTop  = rect.top + rect.height/2 - th/2;
    }

    // Clamp inside viewport
    var vw = window.innerWidth, vh = window.innerHeight;
    tipLeft = Math.max(10, Math.min(tipLeft, vw - tw - 10));
    tipTop  = Math.max(10, Math.min(tipTop,  vh - th - 10));

    tip.style.left = tipLeft + 'px';
    tip.style.top  = tipTop  + 'px';
  }

  function showStep(idx){
    _tourIdx = idx;
    var step = STEPS[idx];
    if(!step){ finishTour(); return; }

    var rect = getRect(step.sel);
    // If target not visible, scroll it into view first
    var el = document.querySelector(step.sel);
    if(el && typeof el.scrollIntoView === 'function'){
      el.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }

    // Allow scroll to settle then position
    cancelAnimationFrame(_tourRaf);
    _tourRaf = requestAnimationFrame(function(){
      rect = getRect(step.sel);

      document.getElementById('tourBadge').textContent = 'Passo ' + (idx+1) + ' de ' + STEPS.length;
      document.getElementById('tourTitle').textContent = step.title;
      document.getElementById('tourBody').textContent  = step.body;

      var nextBtn = document.getElementById('tourNextBtn');
      if(nextBtn) nextBtn.textContent = idx === STEPS.length-1 ? 'Concluir ✓' : 'Próximo →';

      buildDots();

      var tip = document.getElementById('tourTip');
      if(tip) tip.style.display = 'block';

      if(rect) positionTip(rect, step.pos);
    });
  }

  function nextStep(){
    if(_tourIdx >= STEPS.length - 1){ finishTour(); return; }
    showStep(_tourIdx + 1);
  }

  function finishTour(){
    tourDone();
    var overlay  = document.getElementById('tourOverlay');
    var tip      = document.getElementById('tourTip');
    var spot     = document.getElementById('tourSpotlight');
    var backdrop = document.getElementById('tourBackdrop');
    if(overlay)  { overlay.classList.remove('tour-active'); }
    if(tip)      { tip.style.display = 'none'; }
    if(spot)     { spot.style.cssText = 'display:none'; }
    if(backdrop) { backdrop.style.clipPath = ''; }  // restore full backdrop
  }

  function startTour(){
    if(isTourDone()) return;
    var overlay = document.getElementById('tourOverlay');
    if(!overlay) return;
    overlay.classList.add('tour-active');
    showStep(0);
  }

  // Bind controls
  document.addEventListener('DOMContentLoaded', function(){
    var nextBtn = document.getElementById('tourNextBtn');
    var skipBtn = document.getElementById('tourSkipBtn');
    if(nextBtn) nextBtn.addEventListener('click', nextStep);
    if(skipBtn) skipBtn.addEventListener('click', finishTour);
    // ESC closes the tour
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Escape') return;
      var overlay = document.getElementById('tourOverlay');
      if(overlay && overlay.classList.contains('tour-active')) finishTour();
    });
    // Re-position on resize
    window.addEventListener('resize', function(){
      if(!document.getElementById('tourOverlay').classList.contains('tour-active')) return;
      var step = STEPS[_tourIdx];
      if(step){ var rect = getRect(step.sel); if(rect) positionTip(rect, step.pos); }
    }, { passive:true });
  });

  function restartTour(){
    try{ localStorage.removeItem(TOUR_KEY); }catch(_){}
    var overlay = document.getElementById('tourOverlay');
    if(!overlay) return;
    overlay.classList.add('tour-active');
    showStep(0);
  }

  // Expose so app can start tour after user logs in and restart it on demand
  window._startGuidedTour   = startTour;
  window._restartGuidedTour = restartTour;
}());

// ══════════════════════════════════════════════════════════════
// CONVERSATIONS AUTO-REFRESH (30s polling when tab is active)
// ══════════════════════════════════════════════════════════════
var _convsRefreshInterval = null;
var _lastNeedsHumanCount  = -1; // -1 = not yet known

function _requestDesktopNotifPermission(){
  if(typeof Notification === 'undefined') return;
  if(Notification.permission === 'default'){
    Notification.requestPermission().catch(function(){});
  }
}

function _maybeNotifyNeedsHuman(newCount){
  _updateNeedsHumanBadge(newCount); // always sync badge/title
  if(typeof Notification === 'undefined') return;
  if(Notification.permission !== 'granted') return;
  if(_lastNeedsHumanCount < 0){ _lastNeedsHumanCount = newCount; return; } // first run — baseline
  var added = newCount - _lastNeedsHumanCount;
  if(added <= 0){ _lastNeedsHumanCount = newCount; return; }
  _lastNeedsHumanCount = newCount;
  // In-app: chime + bell alert
  _playNeedsHumanChime();
  _addNotifAlert(
    added + ' nova' + (added!==1?'s':'') + ' conversa' + (added!==1?'s':'') + ' aguardando',
    newCount + ' no total precisando de resposta humana'
  );
  if(document.visibilityState === 'visible') return; // tab focused — in-app is enough
  try{
    var n = new Notification('MercaBot — ' + added + ' nova' + (added!==1?'s':'') + ' conversa' + (added!==1?'s':'') + ' aguardando', {
      body: newCount + ' conversa' + (newCount!==1?'s':'') + ' aguardando resposta humana. Clique para ver.',
      icon: '/logo-whatsapp-640.png',
      tag: 'mercabot-needs-human'
    });
    n.addEventListener('click', function(){ window.focus(); n.close(); });
  }catch(_){}
}

function _startConvsRefresh(){
  _requestDesktopNotifPermission();
  if(_convsRefreshInterval) return;
  _convsRefreshInterval = setInterval(function(){
    var tab = document.getElementById('tab-conversas');
    if(!tab || !tab.classList.contains('active')){ _stopConvsRefresh(); return; }
    if(!supabaseClient) return;
    supabaseClient.auth.getSession().then(function(sr){
      var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
      if(!jwt) return;
      refreshConversas(jwt).then(function(){
        var needsHuman = (_lastConvsLogs||[]).filter(function(l){ return l.needs_human; }).length;
        _maybeNotifyNeedsHuman(needsHuman);
        _renderDashboardOps(_lastConvsLogs, _lastConvsStats);
      });
    });
  }, 8000);
}
function _stopConvsRefresh(){
  if(_convsRefreshInterval){ clearInterval(_convsRefreshInterval); _convsRefreshInterval = null; }
}

// ══════════════════════════════════════════════════════════════
// GLOBAL BACKGROUND POLL (30s — always on, regardless of tab)
// ══════════════════════════════════════════════════════════════
var _globalPollInterval = null;
function _startGlobalPoll(){
  if(_globalPollInterval) return;
  _globalPollInterval = setInterval(function(){
    // Conversas tab handles its own 8s refresh — skip to avoid double call
    var convsTab = document.getElementById('tab-conversas');
    if(convsTab && convsTab.classList.contains('active')) return;
    if(!supabaseClient) return;
    supabaseClient.auth.getSession().then(function(sr){
      var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
      if(!jwt) return;
      refreshConversas(jwt).then(function(){
        var count = (_lastConvsLogs||[]).filter(function(l){ return l.needs_human; }).length;
        _updateNeedsHumanBadge(count);
        _maybeNotifyNeedsHuman(count);
        _renderDashboardOps(_lastConvsLogs, _lastConvsStats);
      }).catch(function(){});
    });
  }, 30000);
}

// ══════════════════════════════════════════════════════════════
// ONLINE / OFFLINE AWARENESS
// ══════════════════════════════════════════════════════════════
(function(){
  var banner = document.getElementById('offlineBanner');
  function _syncOfflineBanner(){
    if(!banner) return;
    if(navigator.onLine){ banner.classList.remove('ob-visible'); }
    else { banner.classList.add('ob-visible'); }
  }
  window.addEventListener('offline', function(){
    _syncOfflineBanner();
    toast('Sem conexão — você está offline. As ações serão retomadas automaticamente.');
  });
  window.addEventListener('online', function(){
    _syncOfflineBanner();
    toast('Conexão restaurada! Atualizando dados…');
    // Immediate re-fetch on reconnect
    if(supabaseClient){
      supabaseClient.auth.getSession().then(function(sr){
        var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
        if(!jwt) return;
        refreshConversas(jwt).then(function(){
          _renderDashboardOps(_lastConvsLogs, _lastConvsStats);
        }).catch(function(){});
      });
    }
  });
  _syncOfflineBanner(); // apply correct state on initial load
}());

// ══════════════════════════════════════════════════════════════
// NOTIFICATION BELL — topbar alert system
// ══════════════════════════════════════════════════════════════
var _notifAlerts  = [];
var _notifOpen    = false;

function _playNeedsHumanChime(){
  try{
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var freqs = [880, 1108, 1320];
    freqs.forEach(function(freq, i){
      var t = i * 0.13;
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0,   ctx.currentTime + t);
      gain.gain.linearRampToValueAtTime(0.13, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.38);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime  + t + 0.4);
    });
  }catch(e){}
}

function _nbTimeAgo(date){
  var s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if(s < 60)    return MB_t('time.now', 'agora');
  if(s < 3600)  return Math.floor(s/60)   + MB_t('time.minSuffix', 'min');
  if(s < 86400) return Math.floor(s/3600) + MB_t('time.hourSuffix', 'h');
  return Math.floor(s/86400) + MB_t('time.daySuffix', 'd');
}

function _updateNeedsHumanBadge(count){
  // Bell badge
  var badge = document.getElementById('notifBellBadge');
  var bell  = document.getElementById('notifBell');
  if(badge){
    if(count > 0){
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
      if(bell){ bell.classList.add('nb-alert'); bell.setAttribute('aria-expanded', _notifOpen ? 'true':'false'); }
    } else {
      badge.style.display = 'none';
      if(bell) bell.classList.remove('nb-alert');
    }
  }
  // Document title
  var base = 'Painel do Cliente — MercaBot';
  document.title = count > 0 ? '(' + count + ') ' + base : base;
  // Inbox tab badge
  var inboxBtn = document.querySelector('[data-tab="conversas"]');
  if(inboxBtn){
    var existing = inboxBtn.querySelector('.tab-nh-badge');
    if(count > 0){
      if(!existing){ var b = document.createElement('span'); b.className = 'tab-nh-badge'; inboxBtn.appendChild(b); existing = b; }
      existing.textContent = count > 9 ? '9+' : String(count);
    } else {
      if(existing) existing.remove();
    }
  }
}

function _addNotifAlert(title, sub){
  _notifAlerts.unshift({ title:title, sub:sub||'', time: new Date() });
  if(_notifAlerts.length > 20) _notifAlerts.pop();
  if(_notifOpen) _renderNotifList();
}

function _renderNotifList(){
  var list  = document.getElementById('notifList');
  var empty = document.getElementById('notifEmpty');
  if(!list) return;
  if(_notifAlerts.length === 0){
    if(empty) empty.style.display = 'block';
    Array.from(list.querySelectorAll('.notif-item')).forEach(function(el){ el.remove(); });
    return;
  }
  if(empty) empty.style.display = 'none';
  list.innerHTML = '';
  _notifAlerts.slice(0, 10).forEach(function(a){
    var item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML =
      '<div class="notif-dot"></div>' +
      '<div class="notif-body">' +
        '<div class="notif-body-title">' + a.title + '</div>' +
        (a.sub ? '<div class="notif-body-sub">' + a.sub + '</div>' : '') +
      '</div>' +
      '<div class="notif-item-time">' + _nbTimeAgo(a.time) + '</div>';
    item.addEventListener('click', function(){
      _closeNotifDropdown();
      switchTab('conversas', {persist:true, scrollPage:true, smooth:true});
    });
    list.appendChild(item);
  });
}

function _openNotifDropdown(){
  var dd = document.getElementById('notifDropdown');
  if(!dd) return;
  _notifOpen = true;
  _renderNotifList();
  dd.classList.add('nd-open');
  var bell = document.getElementById('notifBell');
  if(bell) bell.setAttribute('aria-expanded','true');
}

function _closeNotifDropdown(){
  var dd = document.getElementById('notifDropdown');
  if(dd) dd.classList.remove('nd-open');
  _notifOpen = false;
  var bell = document.getElementById('notifBell');
  if(bell) bell.setAttribute('aria-expanded','false');
}

function _bindNotifBell(){
  var bell     = document.getElementById('notifBell');
  var clearBtn = document.getElementById('notifClearBtn');
  var goInbox  = document.getElementById('notifGoInbox');

  if(bell){
    bell.addEventListener('click', function(e){
      e.stopPropagation();
      if(_notifOpen) _closeNotifDropdown(); else _openNotifDropdown();
    });
  }
  if(clearBtn){
    clearBtn.addEventListener('click', function(e){
      e.stopPropagation();
      _notifAlerts = [];
      _renderNotifList();
    });
  }
  if(goInbox){
    goInbox.addEventListener('click', function(){
      _closeNotifDropdown();
      switchTab('conversas', {persist:true, scrollPage:true, smooth:true});
    });
  }
  document.addEventListener('click', function(e){
    if(!_notifOpen) return;
    var dd   = document.getElementById('notifDropdown');
    var bell2 = document.getElementById('notifBell');
    if(dd && !dd.contains(e.target) && bell2 && !bell2.contains(e.target)){
      _closeNotifDropdown();
    }
  });
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD OPERATIONAL COCKPIT
// ══════════════════════════════════════════════════════════════
function _renderDashboardOps(logs, stats){
  var container = document.getElementById('dashOpsPanel');
  if(!container) return;
  logs  = logs  || [];
  stats = stats || {};

  if(logs.length === 0){ container.style.display = 'none'; return; }

  // ── Derived metrics ────────────────────────────────────────
  var todayStr     = new Date().toISOString().slice(0, 10);
  var todayLogs    = logs.filter(function(l){ return (l.created_at||'').slice(0,10) === todayStr; });
  var needsHumanLogs = logs.filter(function(l){ return l.needs_human; });
  var autoToday    = todayLogs.filter(function(l){ return !l.needs_human && l.assistant_text; }).length;
  var autoRate     = todayLogs.length > 0 ? Math.round(autoToday / todayLogs.length * 100) : 0;
  var totalToday   = stats.totalToday  || todayLogs.length;
  var uniqueConts  = stats.uniqueContacts || (function(){
    var s = new Set(); logs.forEach(function(l){ s.add(l.contact_phone); }); return s.size;
  }());
  var needsCount   = needsHumanLogs.length;

  // ── Bot online status ──────────────────────────────────────
  var sorted       = logs.slice().sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });
  var lastBotLog   = sorted.find(function(l){ return l.assistant_text; });
  var botOnline    = lastBotLog && (Date.now() - new Date(lastBotLog.created_at).getTime() < 7200000);
  var lastRespTxt  = lastBotLog
    ? MB_t('dashOps.lastReply', 'Última resposta') + ' ' + _relativeTime(lastBotLog.created_at)
    : MB_t('dashOps.awaitingFirst', 'Aguardando primeiras conversas');

  // ── Needs-human chips (max 4 most recent) ─────────────────
  var nhSorted = needsHumanLogs.slice().sort(function(a,b){
    return new Date(b.created_at) - new Date(a.created_at);
  });
  var nhHtml = '';
  if(needsCount > 0){
    var chips = nhSorted.slice(0,4).map(function(l){
      var cData = (_contactsData||[]).find(function(c){ return c.phone === l.contact_phone; });
      var name  = (cData && cData.name) ? cData.name : l.contact_phone.replace(/\D/g,'').slice(-8);
      return '<button class="dash-ops-nh-chip" data-phone="'+_esc(l.contact_phone)+'" type="button">'+_esc(name)+'</button>';
    }).join('');
    var moreHtml = needsCount > 4
      ? ' <span class="dash-ops-nh-more" id="dashOpsMoreNH">+' + (needsCount-4) + ' ' + MB_t('dashOps.more', 'mais') + '</span>'
      : '';
    var needsTitleWord = (needsCount === 1)
      ? MB_t('dashOps.needsTitle1', 'conversa aguardando resposta humana')
      : MB_t('dashOps.needsTitleN', 'conversas aguardando resposta humana');
    nhHtml =
      '<div class="dash-ops-nh-bar">' +
        '<div class="dash-ops-nh-title">⚡ ' + needsCount + ' ' + needsTitleWord + '</div>' +
        '<div class="dash-ops-nh-chips">' + chips + moreHtml + '</div>' +
      '</div>';
  }

  // ── Recent activity (last 5 unique contacts) ───────────────
  var seen = new Set(); var recentRows = [];
  sorted.forEach(function(l){
    if(!seen.has(l.contact_phone) && recentRows.length < 5){
      seen.add(l.contact_phone); recentRows.push(l);
    }
  });
  var actHtml = recentRows.map(function(l){
    var cData   = (_contactsData||[]).find(function(c){ return c.phone === l.contact_phone; });
    var name    = (cData && cData.name) ? cData.name : l.contact_phone.replace(/\D/g,'').slice(-8);
    var initials= _inboxAvatarInitials(name);
    var color   = _inboxAvatarColor(l.contact_phone);
    var preview = _esc((l.user_text || l.assistant_text || '').slice(0,54));
    var nhTag   = l.needs_human ? '<span class="dash-ops-nh-tag">' + MB_t('dashOps.needsTag', '⚡ Aguardando') + '</span>' : '';
    return '<div class="dash-ops-row" data-phone="'+_esc(l.contact_phone)+'">' +
      '<div class="dash-ops-av" style="background:'+color+'22;color:'+color+'">'+_esc(initials)+'</div>' +
      '<div class="dash-ops-row-body">' +
        '<div class="dash-ops-row-name">'+_esc(name)+' '+nhTag+'</div>' +
        '<div class="dash-ops-row-preview">'+preview+'</div>' +
      '</div>' +
      '<div class="dash-ops-row-time">'+_relativeTime(l.created_at)+'</div>' +
    '</div>';
  }).join('');

  // ── Render ─────────────────────────────────────────────────
  container.innerHTML =
    // Bot status bar
    '<div class="dash-ops-bot-bar">' +
      '<div class="dash-ops-bot-left">' +
        '<div class="dash-ops-status-dot '+(botOnline?'online':'offline')+'"></div>' +
        '<div>' +
          '<div class="dash-ops-bot-label">' + (botOnline ? MB_t('dashOps.botOnline','Bot online') : MB_t('dashOps.botOffline','Bot offline')) + '</div>' +
          '<div class="dash-ops-bot-sub">'+lastRespTxt+'</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="btn-primary" style="font-size:.82rem;padding:.48rem .95rem;flex-shrink:0" id="dashOpsInboxBtn">' +
        (needsCount > 0 ? MB_t('dashOps.viewNeeds','⚡ Ver conversas') + ' ('+needsCount+') →' : MB_t('dashOps.openInbox','Abrir Inbox →')) +
      '</button>' +
    '</div>' +
    // KPI row
    '<div class="dash-ops-metrics">' +
      '<div class="dash-ops-kpi"><div class="dash-ops-kpi-val">'+totalToday+'</div><div class="dash-ops-kpi-lbl">' + MB_t('dashOps.kpi.today','Conversas hoje') + '</div></div>' +
      '<div class="dash-ops-kpi"><div class="dash-ops-kpi-val kv-green">'+autoRate+'%</div><div class="dash-ops-kpi-lbl">' + MB_t('dashOps.kpi.autoRate','Auto-resolução') + '</div></div>' +
      '<div class="dash-ops-kpi"><div class="dash-ops-kpi-val '+(needsCount>0?'kv-amber':'kv-green')+'">'+needsCount+'</div><div class="dash-ops-kpi-lbl">' + MB_t('dashOps.kpi.needsHuman','Atenção humana') + '</div></div>' +
      '<div class="dash-ops-kpi"><div class="dash-ops-kpi-val">'+uniqueConts+'</div><div class="dash-ops-kpi-lbl">' + MB_t('dashOps.kpi.unique','Contatos únicos') + '</div></div>' +
    '</div>' +
    // Bot quality insight bar
    (function(){
      if(todayLogs.length < 3) return ''; // not enough data today
      var barColor = autoRate >= 80 ? 'var(--green)' : autoRate >= 60 ? '#f59e0b' : '#ef4444';
      var qualityKey = autoRate >= 80 ? 'dashOps.qualityHigh' : (autoRate >= 60 ? 'dashOps.qualityMid' : 'dashOps.qualityLow');
      var qualityFb = autoRate >= 80
        ? '🎯 Ótimo! Bot resolvendo {pct}% das conversas de hoje sem intervenção humana.'
        : autoRate >= 60
          ? '📈 Bot resolvendo {pct}% autonomamente — adicione frases prontas para melhorar.'
          : '💡 Taxa de auto-resolução de {pct}% hoje — revisar a instrução principal pode ajudar.';
      var msg = MB_t(qualityKey, qualityFb).replace('{pct}', autoRate);
      return '<div style="background:rgba(234,242,235,.03);border:1px solid var(--border);border-radius:10px;padding:.65rem .95rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.75rem">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem">'+
            '<span style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--faint)">' + MB_t('dashOps.qualityTitle', 'Qualidade do bot hoje') + '</span>'+
            '<span style="font-size:.82rem;font-weight:700;color:'+barColor+'">'+autoRate+'%</span>'+
          '</div>'+
          '<div style="height:5px;background:rgba(234,242,235,.08);border-radius:999px;overflow:hidden">'+
            '<div style="height:100%;width:'+autoRate+'%;background:'+barColor+';border-radius:999px;transition:width .5s"></div>'+
          '</div>'+
          '<div style="font-size:.8rem;color:var(--muted);margin-top:.35rem;line-height:1.5">'+_esc(msg)+'</div>'+
        '</div>'+
      '</div>';
    }()) +
    // Needs human
    nhHtml +
    // Activity feed
    (recentRows.length > 0
      ? '<div class="dash-ops-activity">' +
          '<div class="dash-ops-activity-hdr">' + MB_t('dashOps.recentTitle', 'Atividade recente') + '</div>' +
          actHtml +
        '</div>'
      : '');

  container.style.display = 'block';

  // ── Bind events ────────────────────────────────────────────
  var inboxBtn = document.getElementById('dashOpsInboxBtn');
  if(inboxBtn) inboxBtn.addEventListener('click', function(){
    switchTab('conversas', {persist:true, scrollPage:true, smooth:true});
  });
  var moreBtn = document.getElementById('dashOpsMoreNH');
  if(moreBtn) moreBtn.addEventListener('click', function(){
    switchTab('conversas', {persist:true, scrollPage:true, smooth:true});
  });
  container.querySelectorAll('[data-phone]').forEach(function(el){
    el.addEventListener('click', function(){
      var phone = el.dataset.phone;
      if(!phone) return;
      switchTab('conversas', {persist:true, scrollPage:true, smooth:true});
      setTimeout(function(){
        if(typeof _inboxOpenThread === 'function') _inboxOpenThread(phone);
      }, 350);
    });
  });
}

// tiny HTML-escape helper used by ops cockpit
function _esc(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════
// INBOX — WhatsApp-style two-panel conversation view
// ══════════════════════════════════════════════════════════════
var _inboxCurrentPhone = null;
var _inboxFilter = 'all';
var _inboxSearchQ = '';
var _inboxSending = false;
var _INBOX_AVATAR_COLORS = ['#00c853','#0091ea','#aa00ff','#ff6d00','#c51162','#00bcd4','#8d6e63','#546e7a'];

function _inboxAvatarColor(phone){
  var n = 0; var s = String(phone||'');
  for(var i=0;i<s.length;i++) n += s.charCodeAt(i);
  return _INBOX_AVATAR_COLORS[n % _INBOX_AVATAR_COLORS.length];
}

function _inboxAvatarInitials(name){
  var parts = String(name||'?').trim().split(/\s+/);
  if(parts.length >= 2) return (parts[0][0]+(parts[parts.length-1][0]||'')).toUpperCase();
  return String(parts[0]||'?').slice(0,2).toUpperCase();
}

function _inboxEsc(s){
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

function _inboxDisplayName(phone){
  if(typeof _contactsData !== 'undefined' && Array.isArray(_contactsData)){
    var d = String(phone||'').replace(/\D/g,'');
    var ct = _contactsData.find(function(c){
      var cp = String(c.phone||'').replace(/\D/g,'');
      return cp === d || c.phone === phone;
    });
    if(ct && ct.name && ct.name !== phone && ct.name.trim()){
      return ct.name.trim();
    }
  }
  var digits = String(phone||'').replace(/\D/g,'');
  if(digits.length === 13 && digits.startsWith('55')){
    return '+55 ('+digits.slice(2,4)+') '+digits.slice(4,9)+'-'+digits.slice(9);
  }
  if(digits.length === 12 && digits.startsWith('55')){
    return '+55 ('+digits.slice(2,4)+') '+digits.slice(4,8)+'-'+digits.slice(8);
  }
  return phone || '—';
}

function _inboxFormatTime(ts){
  if(!ts) return '';
  var d = new Date(ts);
  var now = new Date();
  var diffMs = now - d;
  var diffDays = Math.floor(diffMs / 86400000);
  var loc = MB_locale();
  if(diffDays === 0) return d.toLocaleTimeString(loc,{hour:'2-digit',minute:'2-digit'});
  if(diffDays === 1) return MB_t('date.yesterday', 'Ontem');
  if(diffDays < 7) return d.toLocaleDateString(loc,{weekday:'short'});
  return d.toLocaleDateString(loc,{day:'2-digit',month:'2-digit'});
}

function _inboxFormatDateSep(ts){
  var d = new Date(ts);
  var now = new Date();
  var today = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var msgDay = new Date(d.getFullYear(),d.getMonth(),d.getDate());
  var diff = Math.round((today - msgDay) / 86400000);
  if(diff === 0) return MB_t('date.today', 'Hoje');
  if(diff === 1) return MB_t('date.yesterday', 'Ontem');
  return d.toLocaleDateString(MB_locale(),{day:'2-digit',month:'long',year:'numeric'});
}

function _inboxGroupByContact(logs){
  var map = {};
  (logs||[]).forEach(function(log){
    var p = log.contact_phone;
    if(!p) return;
    if(!map[p]) map[p] = {phone:p,logs:[],needsHuman:false,lastAt:0};
    map[p].logs.push(log);
    if(log.needs_human) map[p].needsHuman = true;
    var t = new Date(log.created_at||0).getTime();
    if(t > map[p].lastAt) map[p].lastAt = t;
  });
  return Object.values(map).sort(function(a,b){ return b.lastAt - a.lastAt; });
}

function renderInbox(logs, stats){
  if(!document.getElementById('inboxContactList')) return;
  _renderInboxSidebar();
  if(_inboxCurrentPhone) _renderInboxThread(_inboxCurrentPhone);
}

function _inboxGetFiltered(){
  var contacts = _inboxGroupByContact(_lastConvsLogs);
  if(_inboxFilter === 'needs_human'){
    contacts = contacts.filter(function(c){ return c.needsHuman; });
  } else if(_inboxFilter === 'paused'){
    contacts = contacts.filter(function(c){ return isContactPaused(c.phone); });
  } else if(_inboxFilter === 'today'){
    var todayStr = new Date().toISOString().slice(0,10);
    contacts = contacts.filter(function(c){
      return c.lastAt && new Date(c.lastAt).toISOString().slice(0,10) === todayStr;
    });
  }
  if(_inboxSearchQ){
    var q = _inboxSearchQ;
    contacts = contacts.filter(function(c){
      if(String(c.phone||'').toLowerCase().indexOf(q) >= 0) return true;
      var dn = _inboxDisplayName(c.phone).toLowerCase();
      if(dn.indexOf(q) >= 0) return true;
      return c.logs.some(function(l){
        return String(l.user_text||'').toLowerCase().indexOf(q) >= 0 ||
               String(l.assistant_text||'').toLowerCase().indexOf(q) >= 0;
      });
    });
  }
  return contacts;
}

function _renderInboxSidebar(){
  var list = document.getElementById('inboxContactList');
  var emptyEl = document.getElementById('inboxSidebarEmpty');
  var pill = document.getElementById('inboxTotalPill');
  if(!list) return;

  var all = _inboxGroupByContact(_lastConvsLogs);
  var contacts = _inboxGetFiltered();

  if(pill){
    var n = all.length;
    var word = (n === 1)
      ? MB_t('empty.contactPlural1', 'contato')
      : MB_t('empty.contactPluralN', 'contatos');
    pill.textContent = n + ' ' + word;
  }

  // Remove old items but keep the empty-state div
  Array.from(list.querySelectorAll('.inbox-contact-item')).forEach(function(el){ el.remove(); });

  if(contacts.length === 0){
    if(emptyEl){
      emptyEl.style.display = '';
      // Contextual message based on WhatsApp + filter state
      var isFiltered = _inboxFilter !== 'all' || (document.getElementById('inboxSearch') && document.getElementById('inboxSearch').value.trim());
      var hasAnyConvs = all.length > 0;
      var waConnected = !!(state && state.channelConnected);
      if(isFiltered && hasAnyConvs){
        emptyEl.querySelector('span').innerHTML = 'Nenhuma conversa com este filtro.<br><span style="font-size:.88rem">Remova o filtro para ver todas.</span>';
      } else if(!waConnected){
        emptyEl.querySelector('span').innerHTML = 'Seu WhatsApp ainda não está conectado.<br><button type="button" id="inboxGoConfigBtn" style="margin-top:.5rem;background:var(--green);color:#080c09;border:none;padding:.4rem .9rem;border-radius:8px;font-family:inherit;font-size:.85rem;font-weight:700;cursor:pointer">Conectar WhatsApp →</button>';
        var goBtn = emptyEl.querySelector('#inboxGoConfigBtn');
        if(goBtn) goBtn.onclick = function(){ switchTab('configuracoes'); };
      } else {
        emptyEl.querySelector('span').innerHTML = 'Tudo pronto! Nenhuma mensagem recebida ainda.<br><span style="font-size:.88rem;opacity:.75">Envie uma mensagem de teste para o número cadastrado para ver o bot em ação.</span>';
      }
    }
    return;
  }
  if(emptyEl) emptyEl.style.display = 'none';

  contacts.forEach(function(contact){
    var name = _inboxDisplayName(contact.phone);
    var color = _inboxAvatarColor(contact.phone);
    var initials = _inboxAvatarInitials(name);
    var lastLog = contact.logs[contact.logs.length-1] || {};
    var preview = lastLog.user_text || lastLog.assistant_text || '';
    if(preview.length > 44) preview = preview.slice(0,44)+'…';
    var isPaused = isContactPaused(contact.phone);
    var isActive = contact.phone === _inboxCurrentPhone;

    var badgeHtml = '';
    if(contact.needsHuman){
      badgeHtml = '<span class="inbox-count-badge ib-amber" title="Requer atenção humana">!</span>';
    } else if(isPaused){
      badgeHtml = '<span class="inbox-count-badge ib-red" style="font-size:.6rem;padding:0 5px">⏸</span>';
    }

    var nameTagsHtml = '';
    if(contact.needsHuman) nameTagsHtml += '<span class="paused-pill" style="color:var(--amber);background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.25)">!</span>';
    if(isPaused && !contact.needsHuman) nameTagsHtml += '<span class="paused-pill">II</span>';

    var item = document.createElement('div');
    item.className = 'inbox-contact-item' +
      (isActive ? ' ib-active' : '') +
      (contact.needsHuman ? ' needs-human' : '');
    item.dataset.phone = contact.phone;
    item.setAttribute('role','listitem');
    item.setAttribute('tabindex','0');
    item.setAttribute('aria-label','Conversa com '+name+(contact.needsHuman?' — requer atenção':''));
    item.innerHTML =
      '<div class="inbox-avatar" style="width:42px;height:42px;font-size:.86rem;background:'+color+'18;color:'+color+';border:1.5px solid '+color+'2e" aria-hidden="true">'+initials+'</div>'+
      '<div class="inbox-contact-info">'+
        '<div class="inbox-contact-name">'+_inboxEsc(name)+nameTagsHtml+'</div>'+
        '<div class="inbox-contact-preview">'+_inboxEsc(preview)+'</div>'+
      '</div>'+
      '<div class="inbox-contact-meta">'+
        '<span class="inbox-contact-time">'+_inboxFormatTime(contact.lastAt)+'</span>'+
        badgeHtml+
      '</div>';

    item.addEventListener('click', function(){ _openInboxContact(contact.phone); });
    item.addEventListener('keydown', function(e){
      if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _openInboxContact(contact.phone); }
    });
    list.appendChild(item);
  });
}

function _openInboxContact(phone){
  _inboxCurrentPhone = phone;
  // Signal that the next render for this contact should scroll to bottom (user just opened it)
  _inboxScrollOnOpen = phone;
  // Force re-render on open (clear cached key so content is always rebuilt fresh)
  _inboxContentKey[phone] = '';

  // Highlight in sidebar
  document.querySelectorAll('.inbox-contact-item').forEach(function(el){
    el.classList.toggle('ib-active', el.dataset.phone === phone);
  });

  // On mobile: slide in thread pane
  var thread = document.getElementById('inboxThread');
  if(thread) thread.classList.add('ib-thread-open');

  // Hide no-selection placeholder
  var noSel = document.getElementById('inboxNoSelection');
  if(noSel) noSel.style.display = 'none';

  // Show thread elements
  var ids = ['inboxThreadHdr','inboxThreadBody','inboxChipsRow','inboxThreadFooter'];
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = '';
  });

  // Update header
  var name = _inboxDisplayName(phone);
  var color = _inboxAvatarColor(phone);
  var initials = _inboxAvatarInitials(name);
  var hdrAvatar = document.getElementById('inboxHdrAvatar');
  var hdrName   = document.getElementById('inboxHdrName');
  var hdrSub    = document.getElementById('inboxHdrSub');
  if(hdrAvatar){
    hdrAvatar.style.background = color+'18';
    hdrAvatar.style.color = color;
    hdrAvatar.style.border = '1.5px solid '+color+'2e';
    hdrAvatar.textContent = initials;
  }
  if(hdrName) hdrName.textContent = name;
  if(hdrSub)  hdrSub.textContent  = (name !== phone) ? phone : '';

  _updateInboxAiPill(phone);
  _renderInboxThread(phone);
  _renderInboxChips();

  // Enable compose
  var compose = document.getElementById('inboxCompose');
  var sendBtn  = document.getElementById('inboxSendBtn');
  if(compose){ compose.disabled = false; }
  if(sendBtn)  sendBtn.disabled = !(compose && compose.value.trim());
}

// Content key: "<count>:<lastCreatedAt>" — only re-render when this changes
var _inboxContentKey  = {};  // phone -> last rendered key
// Set to phone when user opens contact — triggers scroll-to-bottom on that render only
var _inboxScrollOnOpen = '';

function _renderInboxThread(phone){
  var bodyEl     = document.getElementById('inboxThreadBody');
  var needsBnr   = document.getElementById('inboxNeedsBanner');
  if(!bodyEl) return;

  var contacts = _inboxGroupByContact(_lastConvsLogs);
  var contact  = contacts.find(function(c){ return c.phone === phone; });
  var logs     = contact ? contact.logs : [];

  // Needs-human banner
  if(needsBnr) needsBnr.style.display = (contact && contact.needsHuman) ? '' : 'none';

  if(logs.length === 0){
    bodyEl.innerHTML = '<div class="inbox-thread-spinner">Nenhuma mensagem registrada</div>';
    _inboxContentKey[phone] = '';
    return;
  }

  // Build a deterministic content key from count + last-message timestamp.
  // If it hasn't changed since last render, skip entirely — zero DOM touch = zero scroll disturbance.
  var lastLog    = logs[logs.length - 1];
  var contentKey = logs.length + ':' + (lastLog.created_at || '');
  var prevKey    = _inboxContentKey[phone] || '';

  if(prevKey && contentKey === prevKey) return;  // nothing changed — leave scroll alone

  // We are about to re-render. Decide scroll behaviour:
  //   • User just opened this contact (_inboxScrollOnOpen) → scroll to bottom
  //   • New messages arrived AND user was ≤120px from bottom → scroll to bottom
  //   • User scrolled up to read history → restore saved position after innerHTML swap
  var openScroll = (_inboxScrollOnOpen === phone);
  var atBottom   = (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight) < 120;
  var shouldScroll = openScroll || atBottom;

  // Clear the open-scroll flag before any async work
  if(openScroll) _inboxScrollOnOpen = '';

  _inboxContentKey[phone] = contentKey;

  var html = '';
  var lastDateStr = null;

  logs.forEach(function(log){
    var ts = log.created_at ? new Date(log.created_at) : null;
    var dateStr = ts ? ts.toISOString().slice(0,10) : '';
    if(dateStr && dateStr !== lastDateStr){
      html += '<div class="inbox-date-sep" aria-label="'+_inboxFormatDateSep(ts)+'"><span class="inbox-date-sep-lbl">'+_inboxFormatDateSep(ts)+'</span></div>';
      lastDateStr = dateStr;
    }
    var timeStr = ts ? ts.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';

    // Incoming: customer message
    if(log.user_text){
      html += '<div class="inbox-msg-row ib-in">'+
        '<div class="inbox-bubble">'+
          _inboxEsc(log.user_text)+
          '<div class="inbox-bubble-foot">'+
            '<span class="inbox-bubble-time">'+timeStr+'</span>'+
          '</div>'+
        '</div>'+
      '</div>';
    }
    // Outgoing: bot or human response
    if(log.assistant_text){
      var isHuman = log.source === 'human';
      html += '<div class="inbox-msg-row ib-out">'+
        '<div class="inbox-bubble">'+
          _inboxEsc(log.assistant_text)+
          '<div class="inbox-bubble-foot">'+
            '<span class="inbox-bubble-time">'+timeStr+'</span>'+
            (isHuman ? '<span class="inbox-bubble-src src-human">você</span>' : '')+
          '</div>'+
        '</div>'+
      '</div>';
    }
  });

  // Capture scroll position before replacing DOM
  var savedScroll = bodyEl.scrollTop;
  bodyEl.innerHTML = html;

  if(shouldScroll){
    requestAnimationFrame(function(){ bodyEl.scrollTop = bodyEl.scrollHeight; });
  } else {
    // Restore the position the user was reading — innerHTML resets scrollTop to 0
    bodyEl.scrollTop = savedScroll;
  }
}

function _renderInboxChips(){
  var chipsEl = document.getElementById('inboxChipsRow');
  if(!chipsEl) return;
  // Use workspace quick replies if available, otherwise fallback defaults
  var chips = [];
  if(state.workspace && Array.isArray(state.workspace.quickReplies) && state.workspace.quickReplies.length){
    chips = state.workspace.quickReplies.filter(function(r){ return r && String(r).trim(); }).slice(0,8);
  }
  if(!chips.length){
    chips = [
      'Olá! Como posso ajudar? 😊',
      'Um momento, por favor',
      'Entendido! Vou verificar',
      'Pode confirmar seu pedido?',
      'Seu pedido foi confirmado ✓',
      'Obrigado pelo contato!'
    ];
  }
  chipsEl.innerHTML = chips.map(function(c){
    return '<button type="button" class="inbox-chip">'+_inboxEsc(c)+'</button>';
  }).join('');
  chipsEl.querySelectorAll('.inbox-chip').forEach(function(btn){
    btn.addEventListener('click', function(){
      var compose = document.getElementById('inboxCompose');
      if(!compose) return;
      compose.value = btn.textContent;
      _inboxAutoResize(compose);
      compose.dispatchEvent(new Event('input'));
      compose.focus();
    });
  });
}

function _updateInboxAiPill(phone){
  var pill  = document.getElementById('inboxAiPill');
  var label = document.getElementById('inboxAiPillLabel');
  if(!pill || !label) return;
  var paused = isContactPaused(phone || _inboxCurrentPhone);
  pill.className = 'inbox-ai-pill ' + (paused ? 'ai-off' : 'ai-on');
  label.textContent = paused
    ? MB_t('inbox.aiPaused', 'IA pausada')
    : MB_t('inbox.aiOn', 'IA ativa');
  pill.title = paused ? 'Clique para retomar a IA' : 'Clique para pausar a IA';
}

async function _inboxSendMessage(){
  if(_inboxSending || !_inboxCurrentPhone) return;
  var compose = document.getElementById('inboxCompose');
  var sendBtn  = document.getElementById('inboxSendBtn');
  var msg = compose ? compose.value.trim() : '';
  if(!msg) return;

  _inboxSending = true;
  if(sendBtn)  sendBtn.disabled  = true;
  if(compose)  compose.disabled  = true;

  try{
    if(!supabaseClient) throw new Error('Sessão não disponível');
    var sr  = await supabaseClient.auth.getSession();
    var jwt = sr && sr.data && sr.data.session ? sr.data.session.access_token : '';
    if(!jwt) throw new Error('Sessão expirada — faça login novamente');

    var res = await fetch(WHATSAPP_REPLY_URL, {
      method: 'POST',
      headers: {'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
      body: JSON.stringify({to: _inboxCurrentPhone, message: msg})
    });
    var body = await res.json().catch(function(){ return {}; });
    // DEBUG: surface full reply payload in console so we can see log_status / log_error
    console.log('[mb-reply]', { httpStatus: res.status, body: body });
    if(!res.ok || !body.ok){
      toast('Erro ao enviar: '+(body.error || 'HTTP '+res.status));
      return;
    }
    if(body.warning === 'message_sent_but_not_logged'){
      toast('⚠️ Mensagem enviada mas NÃO salva: '+(body.log_status || '?')+' — veja console');
      console.error('[mb-reply] INSERT failed', body);
    }

    // Auto-pause AI (human took over)
    if(!isContactPaused(_inboxCurrentPhone)){
      setContactPaused(_inboxCurrentPhone, true);
    }

    // Optimistic UI: inject message locally before next poll
    var now = new Date().toISOString();
    _lastConvsLogs.push({
      contact_phone: _inboxCurrentPhone,
      user_text:     null,
      assistant_text: msg,
      created_at:    now,
      needs_human:   false,
      direction:     'outbound',
      source:        'human'
    });

    if(compose){ compose.value = ''; _inboxAutoResize(compose); }
    _renderInboxThread(_inboxCurrentPhone);
    _updateInboxAiPill(_inboxCurrentPhone);
    _renderInboxSidebar();
    toast('✓ Mensagem enviada');

  }catch(err){
    toast('Erro ao enviar: '+String(err));
  }finally{
    _inboxSending = false;
    if(sendBtn) sendBtn.disabled = !(compose && compose.value.trim());
    if(compose){ compose.disabled = false; compose.focus(); }
  }
}

function _inboxAutoResize(el){
  if(!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 110)+'px';
}

function _initInbox(){
  // Search input
  var searchEl = document.getElementById('inboxSearch');
  if(searchEl){
    searchEl.addEventListener('input', function(){
      _inboxSearchQ = this.value.trim().toLowerCase();
      _renderInboxSidebar();
    });
    searchEl.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ this.value = ''; _inboxSearchQ = ''; _renderInboxSidebar(); }
    });
  }

  // Filter buttons
  var filterRow = document.getElementById('inboxFilterRow');
  if(filterRow){
    filterRow.addEventListener('click', function(e){
      var btn = e.target.closest('.inbox-filter-btn');
      if(!btn) return;
      _inboxFilter = btn.dataset.ibfilter || 'all';
      filterRow.querySelectorAll('.inbox-filter-btn').forEach(function(b){ b.classList.remove('ib-active'); });
      btn.classList.add('ib-active');
      _renderInboxSidebar();
    });
  }

  // Back button (mobile)
  var backBtn = document.getElementById('inboxBackBtn');
  if(backBtn){
    backBtn.addEventListener('click', function(){
      _inboxCurrentPhone = null;
      var thread = document.getElementById('inboxThread');
      if(thread) thread.classList.remove('ib-thread-open');
      // Hide thread elements
      ['inboxThreadHdr','inboxNeedsBanner','inboxThreadBody','inboxChipsRow','inboxThreadFooter'].forEach(function(id){
        var el = document.getElementById(id); if(el) el.style.display = 'none';
      });
      // Show placeholder
      var noSel = document.getElementById('inboxNoSelection');
      if(noSel) noSel.style.display = '';
      // Clear active in sidebar
      document.querySelectorAll('.inbox-contact-item').forEach(function(el){ el.classList.remove('ib-active'); });
    });
  }

  // AI pill — toggle pause/resume
  var aiPill = document.getElementById('inboxAiPill');
  if(aiPill){
    aiPill.addEventListener('click', function(){
      if(!_inboxCurrentPhone) return;
      var paused = isContactPaused(_inboxCurrentPhone);
      setContactPaused(_inboxCurrentPhone, !paused);
      _updateInboxAiPill(_inboxCurrentPhone);
      _renderInboxSidebar();
      toast(paused ? '✅ IA reativada para este contato' : '⏸ IA pausada — responda manualmente');
    });
  }

  // Compose textarea — auto-resize + keyboard shortcut
  var compose = document.getElementById('inboxCompose');
  var sendBtn  = document.getElementById('inboxSendBtn');
  if(compose){
    compose.addEventListener('input', function(){
      _inboxAutoResize(this);
      if(sendBtn) sendBtn.disabled = !this.value.trim();
    });
    compose.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        if(sendBtn && !sendBtn.disabled) _inboxSendMessage();
      }
    });
  }
  if(sendBtn){
    sendBtn.addEventListener('click', function(){
      if(!this.disabled) _inboxSendMessage();
    });
  }
}

// Init inbox event bindings when DOM is ready
(function(){
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _initInbox);
  } else {
    _initInbox();
  }
}());

// ══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
(function(){
  var _shortcuts = [
    { key:'c', desc:'Ir para Conversas',      action:function(){ switchTab('conversas'); } },
    { key:'k', desc:'Ir para Contatos',        action:function(){ switchTab('contatos'); } },
    { key:'a', desc:'Ir para Análise',         action:function(){ switchTab('analise'); } },
    { key:'s', desc:'Ir para Configurações',   action:function(){ switchTab('configuracoes'); } },
    { key:'p', desc:'Ir para Plano',           action:function(){ switchTab('plano'); } },
    { key:'b', desc:'Alternar bot on/off',     action:function(){ toggleBot(); } },
    { key:'/', desc:'Mostrar atalhos',         action:function(){ showShortcutsHelp(); } },
    { key:'?', desc:'Mostrar atalhos',         action:function(){ showShortcutsHelp(); } }
  ];

  function showShortcutsHelp(){
    var existing = document.getElementById('kbShortcutsModal');
    if(existing){ existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'kbShortcutsModal';
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:1.5rem 1.75rem;min-width:320px;max-width:92vw;box-shadow:0 24px 64px rgba(0,0,0,.7)';
    modal.innerHTML = '<div style="font-size:1rem;font-weight:700;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between">⌨ Atalhos do teclado <button id="kbShortcutsClose" style="background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;line-height:1">✕</button></div>' +
      _shortcuts.filter(function(s){ return s.key !== '?'; }).map(function(s){
        return '<div style="display:flex;justify-content:space-between;gap:2rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.88rem"><span style="color:var(--muted)">' + s.desc + '</span><kbd style="background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:.1rem .45rem;font-family:monospace;font-size:.82rem;color:var(--text)">' + s.key.toUpperCase() + '</kbd></div>';
      }).join('');
    document.body.appendChild(modal);
    var closeBtn = document.getElementById('kbShortcutsClose');
    if(closeBtn) closeBtn.addEventListener('click', function(){ modal.remove(); });
    setTimeout(function(){ document.addEventListener('click', function dismiss(e){ if(!modal.contains(e.target)){ modal.remove(); document.removeEventListener('click', dismiss); } }); }, 100);
  }

  document.addEventListener('keydown', function(e){
    // Ignore when typing in inputs/textareas
    if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
    // Ignore with modifiers
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    // Ignore if any modal/overlay is open
    if(document.querySelector('.overlay.open, .thread-overlay.open, .contact-drawer.open, [id$="Overlay"].show')) return;
    var s = _shortcuts.find(function(x){ return x.key === e.key.toLowerCase(); });
    if(s){ e.preventDefault(); s.action(); }
  });
}());
