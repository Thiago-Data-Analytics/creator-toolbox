// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
const SUPABASE_URL='https://rurnemgzamnfjvmlbdug.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
const AI_PROXY_URL='https://api.mercabot.com.br/ia/messages';
const AI_RUNTIME_URL='https://api.mercabot.com.br/ia/atender';
const AI_SAVE_CONFIG_URL='https://api.mercabot.com.br/ia/salvar-config';
const TURNSTILE_SITE_KEY='';
const supabaseFactory=
  window.supabase && typeof window.supabase.createClient==='function'
    ? window.supabase.createClient
    : (window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function'
        ? window.supabase.supabase.createClient
        : null);
const supabaseClient=supabaseFactory ? supabaseFactory(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY) : null;
const DEFAULT_MERCABOT_OB={
  nome:'MercaBot',
  seg:'Automação de atendimento e vendas no WhatsApp',
  cidade:'Belo Horizonte, MG',
  regiao:'Brasil',
  desc:'A MercaBot ajuda empresas a organizar atendimento, qualificar leads e vender melhor no WhatsApp com IA e ativação guiada.',
  hr:'Seg–Sex 8h–18h',
  dono:'Time comercial MercaBot',
  entrega:'Ativação guiada digital',
  frete:'',
  pag:['Pix','Cartão de crédito','Boleto'],
  prod:'Starter — R$197/mês — para operação inicial com respostas rápidas e base organizada.\nPro — R$497/mês — para controle comercial, qualificação de leads e mais contexto operacional.\nParceiro — R$1.297/mês — para revenda, white-label e carteira multi-cliente.',
  best:'Plano Pro',
  promo:'Ativação guiada com clareza comercial desde o primeiro contato.',
  indisp:'Integrações ou promessas fora do que foi configurado no momento.',
  prazo:'Ativação digital em etapas guiadas',
  tkt:'150a500',
  faq:'P: O que a MercaBot faz? R: Transforma o WhatsApp em um canal de atendimento e vendas com IA, organização comercial e ativação guiada.\nP: Qual plano é ideal para quem está começando? R: O Starter atende a operação inicial com mais clareza.\nP: Quando vale ir para o Pro? R: Quando você precisa qualificar leads, organizar melhor a operação e ter mais controle comercial.\nP: Quem deve escolher Parceiro? R: Agências, consultores e operações que querem revender ou atender vários clientes.\nP: Preciso de equipe técnica para começar? R: Não. A ativação é guiada e o próximo passo fica claro.',
  obj:'"Está caro" → comparar com custo de atendimento manual perdido e mostrar ganho de velocidade.\n"Vou pensar" → resumir o plano certo e convidar para ativar com clareza.\n"Não sei qual plano escolher" → diagnosticar volume, objetivo e estrutura antes de recomendar.\n"Já uso WhatsApp hoje" → mostrar que a diferença está em organização, consistência e próximo passo claro.',
  deve:'Diagnosticar o perfil do lead antes de indicar plano.\nExplicar a diferença entre Starter, Pro e Parceiro sem jargão.\nDestacar clareza operacional, rapidez de resposta e ativação guiada.\nConvidar para avançar no plano mais adequado ao contexto.',
  nunca:'Inventar integração, prometer prazo sem contexto, empurrar plano mais caro sem justificativa, usar linguagem técnica desnecessária ou ocultar limitações reais.',
  script:'1. Entender como o lead atende hoje.\n2. Identificar volume, objetivo e equipe.\n3. Recomendar o plano mais adequado e explicar por quê.\n4. Confirmar o melhor próximo passo: cadastro, WhatsApp ou equipe comercial.\n5. Encerrar com CTA claro.',
  saud:'Olá! Eu sou a assistente da MercaBot. Posso entender seu cenário e indicar o plano mais certo para você.',
  enc:'Perfeito. Se quiser, eu já deixo o próximo passo pronto para você seguir com clareza.',
  troca:'Se a dúvida exigir análise específica de implantação, a equipe humana assume o próximo passo.',
  conf:'Tokens, credenciais, margens internas, detalhes sensíveis de arquitetura ou promessas fora do escopo configurado.',
  trans:['Integração Meta/WhatsApp','Negociação de preço','Operação multi-cliente','Dúvida técnica específica','Quando solicitar'],
  nia:'Atendente MercaBot',
  gen:'feminino',
  tom:'amigavel',
  emov:1,
  forv:1,
  tamv:1,
  pers:'Consultiva, objetiva e clara.',
  expr:'posso te indicar o plano certo, vamos simplificar isso, próximo passo claro'
};
let step=0, ob={};
let hist=[], busy=false, sat=0;
const HUMAN_TAKEOVER_KEY = 'mercabot_human_takeover';

// ── PROTEÇÃO ANTI-ABUSO ──────────────────────────────────────────
const PROT = {
  // Rate limiting
  MIN_INTERVAL_MS: 1500,      // mínimo 1,5s entre mensagens
  lastSendTime: 0,

  // Daily cap por usuário premium (resetado à meia-noite)
  DAILY_LIMIT: 200,            // 200 msgs/dia por usuário = ~R$0,50/dia máx
  getToday(){ return new Date().toISOString().slice(0,10); },
  getDailyCount(){
    const k='mb_daily_'+this.getToday()+'_premium';
    return parseInt(localStorage.getItem(k)||'0');
  },
  incDaily(){
    const k='mb_daily_'+this.getToday()+'_premium';
    const n=(this.getDailyCount()+1);
    localStorage.setItem(k,n);
    return n;
  },

  // Session cap (por sessão de browser — resetado ao fechar/reabrir)
  SESSION_LIMIT: 80,           // 80 msgs por sessão
  sessionCount: 0,

  // Honeypot — campo oculto preenchido = bot
  honeypotTriggered: false,

  // Cooldown progressivo após mensagens rápidas demais
  burstCount: 0,
  burstWindow: 10000,          // 10s window
  burstMax: 8,                 // máx 8 msgs em 10s
  burstTimestamps: [],
  checkBurst(){
    const now=Date.now();
    this.burstTimestamps=this.burstTimestamps.filter(t=>now-t<this.burstWindow);
    this.burstTimestamps.push(now);
    return this.burstTimestamps.length>this.burstMax;
  },

  // Verifica todas as proteções — retorna null se ok, string de erro se bloqueado
  check(){
    if(this.honeypotTriggered) return 'blocked';
    const now=Date.now();
    if(now-this.lastSendTime<this.MIN_INTERVAL_MS)
      return 'Aguarde '+Math.ceil((this.MIN_INTERVAL_MS-(now-this.lastSendTime))/1000)+'s antes de enviar outra mensagem.';
    if(this.getDailyCount()>=this.DAILY_LIMIT)
      return 'Limite diário de conversas atingido. Seu limite renova à meia-noite. Se precisar continuar, siga pela central digital da conta.';
    if(this.sessionCount>=this.SESSION_LIMIT)
      return 'Limite de mensagens desta sessão atingido. Recarregue a página para continuar.';
    if(this.checkBurst())
      return 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.';
    return null;
  },

  // Registra envio bem-sucedido
  record(){
    this.lastSendTime=Date.now();
    this.sessionCount++;
    this.incDaily();
  }
};

function getTodayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function getEndOfDayLabel(){
  return new Date(new Date().setHours(23,59,0,0)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

function getHumanTakeover(){
  try {
    return JSON.parse(localStorage.getItem(HUMAN_TAKEOVER_KEY) || 'null');
  } catch(e) {
    return null;
  }
}

function isHumanTakeoverActive(){
  const state = getHumanTakeover();
  return !!(state && state.date === getTodayKey() && state.active);
}

function setHumanTakeover(active){
  if(active){
    localStorage.setItem(HUMAN_TAKEOVER_KEY, JSON.stringify({ active:true, date:getTodayKey() }));
  } else {
    localStorage.removeItem(HUMAN_TAKEOVER_KEY);
  }
}

function addSystemNote(txt){
  const el=document.createElement('div');
  el.className='sys-note';
  el.textContent=txt;
  document.getElementById('wam').appendChild(el);
  sb();
}

function renderHumanTakeoverState(showToast){
  const raw = getHumanTakeover();
  if(raw && raw.date !== getTodayKey()){
    setHumanTakeover(false);
  }
  const active = isHumanTakeoverActive();
  const banner = document.getElementById('manualBanner');
  const bannerText = document.getElementById('manualBannerText');
  const btn = document.getElementById('humanTakeoverBtn');
  const input = document.getElementById('wai');
  if(banner && bannerText){
    banner.style.display = active ? 'flex' : 'none';
    bannerText.textContent = active ? 'A conversa fica com a equipe até ' + getEndOfDayLabel() + '. Amanhã a IA pode voltar automaticamente.' : '';
  }
  if(btn){
    btn.textContent = active ? '🤖 Retomar IA' : '🧑 Assumir pela equipe';
    btn.style.borderColor = active ? 'rgba(59,130,246,.3)' : 'var(--br)';
    btn.style.color = active ? '#93c5fd' : 'var(--mu)';
  }
  if(input){
    input.placeholder = active ? 'Controle manual ativo nesta conversa' : 'Mensagem';
  }
  updateWaHdr();
  if(showToast){
    toast(active ? 'Controle manual ativado até o fim do dia.' : 'IA retomada para novas interações.');
  }
}

function toggleHumanTakeover(forceState){
  const next = typeof forceState === 'boolean' ? forceState : !isHumanTakeoverActive();
  setHumanTakeover(next);
  renderHumanTakeoverState(true);
  addSystemNote(next
    ? 'A equipe da empresa assumiu esta conversa até o fim do dia. A partir daqui, a responsabilidade operacional é da própria operação.'
    : 'A IA voltou a assumir novas interações desta conversa.');
}

function shouldOfferHumanHandoff(message){
  const txt = (message || '').trim().toLowerCase();
  if(!txt) return false;
  if(/atendente|humano|pessoa|suporte/.test(txt)) return true;
  const recentUsers = hist.filter(function(m){ return m.role === 'user'; }).slice(-3).map(function(m){
    return (m.content || '').trim().toLowerCase();
  });
  const repeated = recentUsers.filter(function(m){ return m === txt; }).length >= 1;
  const lowSignalTurns = recentUsers.length >= 3 && recentUsers.every(function(m){
    return m.length < 35 && !/comprar|fechar|pagar|pedido|reserva|hor[aá]rio|pre[cç]o/.test(m);
  });
  return repeated || lowSignalTurns;
}

// Honeypot: campo oculto no formulário — bot preenche, humano não vê
(function setupHoneypot(){
  const hp=document.createElement('input');
  hp.type='text'; hp.name='website'; hp.tabIndex=-1; hp.autocomplete='off';
  hp.setAttribute('aria-hidden','true');
  hp.style.cssText='position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  hp.addEventListener('input',()=>{ PROT.honeypotTriggered=true; });
  document.addEventListener('DOMContentLoaded',()=>{
    const form=document.querySelector('form, .chat-input, #wai')?.closest('form')||document.body;
    form.appendChild(hp);
  });
})();

// Cloudflare Turnstile — widget invisível para proteger a ativação guiada
function loadTurnstile(){
  if(!hasRealTurnstile()) return;
  if(document.getElementById('cf-turnstile-script')) return;
  const s=document.createElement('script');
  s.id='cf-turnstile-script';
  s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async=true; s.defer=true;
  document.head.appendChild(s);
}
let stats={msgs:0,ms:0,rc:0,tk:0,in:0,tu:0};

const STEPS=[
  {lbl:'Seu negócio',ico:'👋',title:'Olá! Vamos desenhar o atendimento do <em>seu negócio</em>',sub:'Comece pelo contexto essencial. A ideia aqui é transformar o que você já sabe em um atendimento claro, confiável e fácil de operar.'},
  {lbl:'O que você oferece',ico:'💡',title:'Agora me conte o que você <em>vende e resolve</em>',sub:'Quanto mais claro estiver o catálogo, as regras e as objeções, mais naturais e úteis ficam as respostas desde a primeira conversa.'},
  {lbl:'Personalidade',ico:'😊',title:'Como seu assistente deve <em>falar pela marca</em>?',sub:'Aqui você define tom, ritmo e postura para que cada resposta pareça coerente com o jeito real do seu negócio atender.'},
  {lbl:'Revisar e testar',ico:'🚀',title:'<em>Tudo alinhado.</em> Agora transforme contexto em conversa real.',sub:'Revise a configuração, ajuste os detalhes finais e valide um primeiro atendimento com muito mais segurança.'},
];

const AV={loja:'🛍️',restaurante:'🍕',clinica:'🏥',salao:'💇',imoveis:'🏠',cursos:'🎓',servicos:'⚙️',outro:'🏪'};
const CH_MAP={
  loja:['Ver produtos','Tem no meu tamanho?','Prazo de entrega','Pagamento','Tem promoção?'],
  restaurante:['Ver cardápio','Fazer pedido','Tempo de entrega','Taxa de entrega','Horário'],
  clinica:['Agendar consulta','Especialidades','Convênios','Valores','Localização'],
  salao:['Agendar horário','Serviços e preços','Horários','Como chegar','Promoções'],
  imoveis:['Ver imóveis','Agendar visita','Filtrar preço','Documentação','Financiamento'],
  cursos:['Ver cursos','Preços','Como funciona','Certificado','Suporte'],
  servicos:['Orçamento','Serviços','Prazo','Pagamento','Área de atendimento'],
  outro:['Saber mais','Preços','Horário','Contato','Como funciona']
};

// ═══════════════════════════════════════
// RENDER STEPS
// ═══════════════════════════════════════
function appendTrustedStepMarkup(host, markup){
  const parser = new DOMParser();
  const doc = parser.parseFromString('<div id="step-root">' + markup + '</div>', 'text/html');
  const root = doc.getElementById('step-root');
  if(!root) return;
  Array.from(root.childNodes).forEach(node => {
    host.appendChild(document.importNode(node, true));
  });
}

function renderStep(i){
  const s=STEPS[i];
  const c=document.getElementById('card');
  c.textContent='';
  c.style.animation='none';
  requestAnimationFrame(()=>c.style.animation='');

  // progress
  const prog=document.getElementById('prog');
  prog.textContent='';
  STEPS.forEach((st,idx)=>{
    if(idx>0){
      const line=document.createElement('div');
      line.className='pl' + (idx<=i?' done':'');
      prog.appendChild(line);
    }
    const step=document.createElement('div');
    step.className='ps' + (idx<i?' done':idx===i?' active':'');
    const dot=document.createElement('div');
    dot.className='pd';
    dot.textContent=idx<i?'✓':String(idx+1);
    step.appendChild(dot);
    prog.appendChild(step);
  });
  document.getElementById('steplbl').textContent=`Etapa ${i+1} de ${STEPS.length}`;

  const slabel=document.createElement('div');
  slabel.className='slabel';
  slabel.textContent=`${s.ico} ${s.lbl}`;
  const h1=document.createElement('h1');
  renderTrustedEmphasis(h1, s.title);
  const p=document.createElement('p');
  p.className='ob-sub';
  p.textContent=s.sub;
  c.appendChild(slabel);
  c.appendChild(h1);
  c.appendChild(p);
  const body=document.createElement('div');
  appendTrustedStepMarkup(body, [rs1,rs2,rs3,rs4][i]());
  while(body.firstChild) c.appendChild(body.firstChild);

  bindStepInteractiveControls();
  attach(i);
  updateNav(i);
  restore(i);
}

function bindStepInteractiveControls(){
  [
    ['f-desc','ccd'],
    ['f-prod','ccp'],
    ['f-faq','ccfaq'],
    ['f-obj','ccobj'],
    ['f-deve','ccde'],
    ['f-nunca','ccnu'],
    ['f-script','ccscript']
  ].forEach(function(pair){
    var field=document.getElementById(pair[0]);
    if(field) field.addEventListener('input', function(){ cc(field, pair[1]); });
  });

  [
    ['f-emo','sv-emo',['Nunca','Com moderação','Frequente','Muito frequente']],
    ['f-for','sv-for',['Muito informal','Informal','Formal','Muito formal']],
    ['f-tam','sv-tam',['1 linha','2-3 linhas','4-5 linhas','Longa se necessário']]
  ].forEach(function(pair){
    var range=document.getElementById(pair[0]);
    if(range) range.addEventListener('input', function(){ us(range, pair[1], pair[2]); });
  });

  document.querySelectorAll('.rev-edit[data-step]').forEach(function(editBtn){
    var stepIndex=Number(editBtn.getAttribute('data-step'));
    var goToStep=function(){ gs(stepIndex); };
    editBtn.addEventListener('click', goToStep);
    editBtn.addEventListener('keydown', function(event){
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        goToStep();
      }
    });
  });
}

function renderTrustedEmphasis(target, text){
  target.textContent = '';
  const normalized = String(text || '');
  const parts = normalized.split(/(<em>.*?<\/em>)/g).filter(Boolean);
  if(!parts.length){
    target.textContent = normalized;
    return;
  }
  parts.forEach(part => {
    if(part.startsWith('<em>') && part.endsWith('</em>')){
      const em=document.createElement('em');
      em.textContent=part.slice(4,-5);
      target.appendChild(em);
      return;
    }
    target.appendChild(document.createTextNode(part));
  });
}

function rs1(){return`<div class="fields">
<div class="row2">
  <div class="fg"><label for="f-nome">Qual é o nome do seu negócio? <span class="req">*</span></label><input class="fi" id="f-nome" placeholder="Ex: Pizzaria Bella Napoli" maxlength="60" aria-label="Nome do negócio"></div>
  <div class="fg"><label for="f-seg">Qual é o principal tipo de operação? <span class="req">*</span></label>
    <select class="fs" id="f-seg"><option value="">Selecione...</option>
    <option value="loja">Loja / E-commerce</option><option value="restaurante">Restaurante / Delivery</option>
    <option value="clinica">Clínica / Saúde</option><option value="salao">Salão / Estética</option>
    <option value="imoveis">Imobiliária</option><option value="cursos">Cursos / Infoprodutos</option>
    <option value="servicos">Serviços Gerais</option><option value="outro">Outro</option></select>
  </div>
</div>
<div class="row2">
  <div class="fg"><label for="f-cidade">Onde fica? <span class="req">*</span></label><input class="fi" id="f-cidade" placeholder="Ex: Belo Horizonte, MG" aria-label="Cidade do negócio"></div>
  <div class="fg"><label for="f-regiao">Você entrega em quais bairros ou regiões?</label><input class="fi" id="f-regiao" placeholder="Ex: Savassi, Lourdes, Centro" aria-label="Bairros ou regiões atendidas"></div>
</div>
<div class="fg"><label for="f-desc">Em uma frase, o que faz seu negócio valer a escolha do cliente? <span class="req">*</span> <span class="hint">— diferenciais, especialidades e contexto</span></label>
  <div class="fw"><textarea class="ft sm" id="f-desc" placeholder="Ex: Boutique feminina com curadoria de peças para trabalho, eventos e fim de semana, atendimento consultivo e entrega rápida em Belo Horizonte." maxlength="350" aria-label="Descrição do negócio"></textarea><span class="cc" id="ccd">0/350</span></div>
</div>
<div class="row2">
  <div class="fg"><label for="f-hr">Quando o cliente pode contar com resposta? <span class="req">*</span></label><input class="fi" id="f-hr" placeholder="Ex: Seg-Sex 9h–18h · Sáb 9h–13h" aria-label="Horário de atendimento"></div>
  <div class="fg"><label for="f-dono">Seu nome ou do responsável <span class="hint">— opcional</span></label><input class="fi" id="f-dono" placeholder="Ex: Ana Souza" aria-label="Nome do responsável"></div>
</div>
<div class="fg"><label id="tg-pag-label">Quais formas de pagamento a conversa pode oferecer? <span class="req">*</span></label>
  <div class="tg" id="tg-pag" aria-labelledby="tg-pag-label">
    ${['Pix','Cartão crédito','Cartão débito','Boleto','Dinheiro','Parcelamento','Transferência bancária','Convênio'].map(p=>`<div class="tc" data-val="${p}">${p}</div>`).join('')}
  </div>
</div>
<div class="row2">
  <div class="fg"><label for="f-entrega">Como esse pedido chega ao cliente? <span class="req">*</span></label>
    <select class="fs" id="f-entrega"><option value="">Selecione...</option>
    <option value="entrega_propria">Entrega própria</option><option value="motoboy">Via motoboy</option>
    <option value="correios">Pelos Correios</option><option value="presencial">Apenas presencial / retirada</option><option value="digital">Produto digital / online</option><option value="nao">Sem entrega</option></select>
  </div>
  <div class="fg"><label for="f-frete">Tem frete grátis a partir de algum valor?</label><input class="fi" id="f-frete" placeholder="Ex: R$150 — deixe vazio se não houver" aria-label="Frete grátis a partir de algum valor"></div>
</div>
</div>`}

// ─── ETAPA 2: INTELIGÊNCIA DO NEGÓCIO ───
function rs2(){return`<div class="fields">

<div id="live-score-bar" style="background:var(--bg2);border:1px solid var(--br);border-radius:10px;padding:.75rem 1rem;margin-bottom:.5rem;display:flex;align-items:center;gap:12px">
<span style="font-size:.96rem;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.07em;white-space:nowrap">Qualidade ao vivo</span>
  <div style="flex:1;height:6px;background:var(--bg3);border-radius:100px"><div id="lsb-fill" style="height:6px;border-radius:100px;background:var(--g);width:0%;transition:width .4s ease"></div></div>
  <span id="lsb-pct" style="font-family:'Clash Display',sans-serif;font-size:1rem;font-weight:700;color:var(--g);min-width:36px;text-align:right">0%</span>
  <span id="lsb-msg" style="font-size:.92rem;color:var(--mu);min-width:120px">Preencha os campos</span>
</div>

<div class="sdiv" style="margin-top:0;padding-top:0;border-top:none;margin-bottom:.25rem">📦 Catálogo</div>
<div class="fg"><label for="f-prod">O que a IA pode oferecer com segurança? <span class="req">*</span> <span class="hint">— nome, opções, preço e contexto</span></label>
  <div class="fw"><textarea class="ft lg" id="f-prod" placeholder="Liste um por linha. Exemplos:&#10;Vestido floral (P / M / G / GG) → R$89&#10;Blusa linho (M / G) → R$69&#10;Shorts jeans (36 ao 44) → R$79&#10;Macacão crepe (P ao GG) → R$129&#10;&#10;Pizza Margherita (M / G / GG) → R$45 / R$59 / R$72&#10;Consulta clínica geral → R$180&#10;Corte feminino → R$80" maxlength="900" aria-label="Catálogo com produtos e preços"></textarea><span class="cc" id="ccp">0/900</span></div>
</div>
<p style="font-size:1rem;color:var(--mu);margin-bottom:.375rem;opacity:.82">💡 Liste só o que realmente pode ser prometido agora. Se algo estiver fora do ar, marque abaixo para a IA não criar expectativa errada.</p>
<div class="row2">
  <div class="fg"><label for="f-best">Qual é seu carro-chefe? <span class="hint">— a IA vai sugerir ele primeiro</span></label><input class="fi" id="f-best" placeholder="Ex: Vestido floral ou Pizza Calabresa" aria-label="Produto carro-chefe"></div>
  <div class="fg"><label for="f-promo">Tem alguma promoção ativa?</label><input class="fi" id="f-promo" placeholder="Ex: 10% off no Pix · Frete grátis essa semana" aria-label="Promoção ativa"></div>
</div>
<div class="fg"><label for="f-indisp">Algo fora de estoque no momento? <span class="hint">— a IA avisa o cliente automaticamente</span></label>
  <input class="fi" id="f-indisp" placeholder="Ex: Vestido preto P e M · Pizza de frango (falta ingrediente) · Consulta dermatologia (sem horário esta semana)" aria-label="Itens temporariamente indisponíveis">
</div>
<div class="row2">
  <div class="fg"><label for="f-prazo">Quanto tempo demora a entrega ou execução?</label><input class="fi" id="f-prazo" placeholder="Ex: 2–3 dias úteis · 45 min · na hora" aria-label="Prazo de entrega ou execução"></div>
  <div class="fg"><label for="f-tkt">Quanto seu cliente costuma gastar?</label>
    <select class="fs" id="f-tkt"><option value="">Não informar</option><option value="ate50">Até R$50</option><option value="50a150">R$50–R$150</option><option value="150a500">R$150–R$500</option><option value="500a2k">R$500–R$2.000</option><option value="acima2k">Acima de R$2.000</option></select>
  </div>
</div>

<div class="sdiv">🙋 Perguntas que seus clientes fazem</div>
<div class="fg"><label for="f-faq">Quais perguntas aparecem em quase toda conversa? <span class="req">*</span> <span class="hint">— e quais respostas são seguras</span></label>
  <div class="fw"><textarea class="ft md" id="f-faq" placeholder="Uma por linha. Exemplos:&#10;P: Tem troca? R: Sim, em até 30 dias com nota fiscal&#10;P: Entrega no mesmo dia? R: Sim, para pedidos até 14h&#10;P: Tem estacionamento? R: Sim, gratuito no subsolo&#10;P: Aceita pedido pelo WhatsApp? R: Sim, é por aqui mesmo&#10;P: Tem nota fiscal? R: Sim, emitimos NFe para pessoa física e jurídica" maxlength="700" aria-label="Perguntas frequentes e respostas"></textarea><span class="cc" id="ccfaq">0/700</span></div>
</div>

<div class="sdiv">💬 Quando o cliente hesita — como contornar</div>
<div class="fg"><label for="f-obj">Quando o cliente hesita, o que ele costuma dizer? <span class="hint">— e como a marca responde</span></label>
  <div class="fw"><textarea class="ft sm" id="f-obj" placeholder="Exemplos:&#10;'Tá caro' → Ressaltar qualidade, exclusividade e parcelamento em até 10x&#10;'Vou pensar' → Mencionar que o estoque é limitado e oferecer reserva&#10;'Tem em outro lugar mais barato' → Destacar diferencial: consultoria grátis, troca fácil, atendimento rápido&#10;'Não conheço a loja' → Mencionar anos no mercado e avaliações 5 estrelas no Google" maxlength="600" aria-label="Objeções e como contornar"></textarea><span class="cc" id="ccobj">0/600</span></div>
</div>

<div class="sdiv">🎯 Como o assistente deve se comportar</div>
<div class="row2">
<div class="fg"><label for="f-deve">O que o assistente deve sempre fazer? <span class="req">*</span></label>
  <div class="fw"><textarea class="ft sm" id="f-deve" placeholder="- Perguntar tamanho antes de sugerir peça&#10;- Mencionar frete grátis acima de R$150&#10;- Confirmar endereço antes de fechar pedido&#10;- Oferecer 5% de desconto para Pix&#10;- Mencionar promoção ativa" maxlength="450" aria-label="Regras do que o assistente deve fazer"></textarea><span class="cc" id="ccde">0/450</span></div>
</div>
<div class="fg"><label for="f-nunca">O que o assistente NUNCA pode fazer? <span class="req">*</span></label>
  <div class="fw"><textarea class="ft sm" id="f-nunca" placeholder="- Nunca dar desconto acima de 10%&#10;- Nunca prometer entrega em menos de 48h&#10;- Nunca mencionar concorrentes&#10;- Nunca inventar produtos fora do catálogo&#10;- Nunca revelar fornecedores ou margens" maxlength="450" aria-label="Regras do que o assistente nunca pode fazer"></textarea><span class="cc" id="ccnu">0/450</span></div>
</div>
</div>

<div class="sdiv">🛒 Como fechar vendas e se comunicar</div>
<div class="fg"><label for="f-script">Quando o cliente decide comprar, qual é o caminho ideal? <span class="hint">— os passos que a IA deve seguir</span></label>
  <div class="fw"><textarea class="ft sm" id="f-script" placeholder="Ex:&#10;1. Confirmar produto, tamanho e cor&#10;2. Perguntar nome completo&#10;3. Solicitar endereço de entrega completo (rua, número, bairro, cidade, CEP)&#10;4. Confirmar forma de pagamento&#10;5. Informar total com frete&#10;6. Enviar resumo do pedido para confirmação final" maxlength="500" aria-label="Etapas para fechar uma venda"></textarea><span class="cc" id="ccscript">0/500</span></div>
</div>
<div class="row2">
  <div class="fg"><label for="f-saud">Como o assistente se apresenta?</label><input class="fi" id="f-saud" placeholder="Ex: Olá! Seja bem-vindo à Boutique Ana! 😊 Como posso ajudar?" aria-label="Mensagem de apresentação do assistente"></div>
  <div class="fg"><label for="f-enc">Como ele se despede?</label><input class="fi" id="f-enc" placeholder="Ex: Foi um prazer! Qualquer dúvida, é só chamar 😊" aria-label="Mensagem de despedida do assistente"></div>
</div>

<div class="sdiv">🔒 Políticas do negócio</div>
<div class="row2">
  <div class="fg"><label for="f-troca">Tem política de troca ou devolução?</label><input class="fi" id="f-troca" placeholder="Ex: Troca em até 30 dias com NF. Produtos em promoção sem troca." aria-label="Política de troca ou devolução"></div>
  <div class="fg"><label for="f-conf">O que o assistente não pode revelar jamais?</label><input class="fi" id="f-conf" placeholder="Ex: Fornecedores, margem de lucro, sistema usado" aria-label="Informações confidenciais"></div>
</div>
        <div class="fg"><label id="tg-trans-label">Quando devolver para a equipe da empresa?</label>
  <div class="tg" id="tg-trans" aria-labelledby="tg-trans-label">
    ${['Reclamação grave','Pedido acima de R$1.000','Devolução / reembolso','Negociação de preço','Situação de emergência','Cliente insatisfeito','Quando solicitar','Nunca transferir'].map(t=>`<div class="tc" data-val="${t}">${t}</div>`).join('')}
  </div>
</div>

</div>`}

function rs3(){return`<div class="fields">
<div class="row2">
<div class="fg"><label for="f-nia">Como o cliente vai conhecer seu assistente? <span class="req">*</span></label><input class="fi" id="f-nia" placeholder="Ex: Bia, Carlos, Sofia, Luna..." aria-label="Nome do assistente"></div>
  <div class="fg"><label for="f-gen">Gênero do assistente</label>
    <select class="fs" id="f-gen"><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="neutro">Neutro</option></select>
  </div>
</div>
<div class="fg"><label id="rg-tom-label">Qual o estilo de comunicação? <span class="req">*</span></label>
  <div class="rg" id="rg-tom" aria-labelledby="rg-tom-label">
    <div class="rc" data-val="amigavel"><div class="ri">😊</div><div class="rl">Amigável e descontraído</div></div>
    <div class="rc" data-val="profissional"><div class="ri">👔</div><div class="rl">Profissional e formal</div></div>
    <div class="rc" data-val="jovem"><div class="ri">🔥</div><div class="rl">Jovem e animado</div></div>
    <div class="rc" data-val="luxo"><div class="ri">💎</div><div class="rl">Sofisticado e elegante</div></div>
    <div class="rc" data-val="tecnico"><div class="ri">🔧</div><div class="rl">Técnico e objetivo</div></div>
  </div>
</div>
<div class="fg"><label for="f-emo">Usar emojis nas mensagens?</label>
  <div class="sw"><div class="sr"><input type="range" id="f-emo" min="0" max="3" step="1" value="1" aria-label="Nível de uso de emojis"><span class="sv" id="sv-emo">Com moderação</span></div><div class="sl"><span>Nunca</span><span>Muito frequente</span></div></div>
</div>
<div class="fg"><label for="f-for">Tom das mensagens</label>
  <div class="sw"><div class="sr"><input type="range" id="f-for" min="0" max="3" step="1" value="1" aria-label="Tom das mensagens"><span class="sv" id="sv-for">Informal</span></div><div class="sl"><span>Muito informal</span><span>Muito formal</span></div></div>
</div>
<div class="fg"><label for="f-tam">Mensagens curtas ou detalhadas?</label>
  <div class="sw"><div class="sr"><input type="range" id="f-tam" min="0" max="3" step="1" value="1" aria-label="Tamanho das mensagens"><span class="sv" id="sv-tam">2-3 linhas</span></div><div class="sl"><span>Muito curto</span><span>Longo</span></div></div>
</div>
<div class="row2">
  <div class="fg"><label for="f-pers">Como você descreveria o assistente?</label><input class="fi" id="f-pers" placeholder="Ex: Animada, empática, apaixonada por moda" aria-label="Descrição da personalidade do assistente"></div>
  <div class="fg"><label for="f-expr">Tem frases ou expressões típicas da sua marca?</label><input class="fi" id="f-expr" placeholder="Ex: 'ótima escolha!', 'com certeza!'" aria-label="Frases ou expressões da marca"></div>
</div>
</div>`}

function rs4(){
  const sc=calcScore();
  const prv=buildPrompt().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const nome = escHtml(ob.nome||'—');
  const seg = escHtml(ob.seg||'—');
  const cidade = escHtml(ob.cidade||'—');
  const regiao = ob.regiao ? ' · ' + escHtml(ob.regiao) : '';
  const horario = escHtml(ob.hr||'—');
  const pagamento = escHtml((ob.pag||[]).join(', ')||'—');
  const entrega = escHtml(ob.entrega||'—');
  const frete = ob.frete ? ' · Grátis: ' + escHtml(ob.frete) : '';
  const best = escHtml(ob.best||'');
  const promo = escHtml(ob.promo||'');
  const obj = escHtml(ob.obj||'');
  const nia = escHtml(ob.nia||'—');
  const gen = escHtml(ob.gen||'—');
  const tom = escHtml(ob.tom||'—');
  const emo = escHtml(ob.emo||'—');
  const formt = escHtml(ob.formt||'—');
  const tam = escHtml(ob.tam||'—');
  const prodShort = escHtml((ob.prod||'—').substring(0,200)) + ((ob.prod||'').length>200?'…':'');
  return`<div class="rev-grid">
<div class="qbw">
<h4>Qualidade da configuração — impacto direto na clareza das respostas</h4>
  ${[['Identidade do negócio',ss('id')],['Catálogo & contexto',ss('prod')],['Regras & scripts',ss('rules')],['Personalidade da IA',ss('pers')]].map(([l,s])=>`
  <div class="qr"><div class="ql">${l}</div>
  <div class="qb"><div class="qf" style="width:${s}%;background:${s>70?'var(--g)':s>40?'var(--amber)':'var(--red)'}"></div></div>
  <div class="qs" style="color:${s>70?'var(--g)':s>40?'var(--amber)':'var(--red)'}">${s}%</div></div>`).join('')}
<div class="qt"><span>Qualidade geral da configuração</span><strong>${sc}%</strong></div>
</div>
<div class="rev-s">
  <h4>Identidade <span class="rev-edit" data-step="0" role="button" tabindex="0" aria-label="Editar identidade">✏ editar</span></h4>
  <div class="rev-row"><span class="rev-k">Negócio</span><span class="rev-v">${nome} (${seg})</span></div>
  <div class="rev-row"><span class="rev-k">Cidade</span><span class="rev-v">${cidade}${regiao}</span></div>
  <div class="rev-row"><span class="rev-k">Horário</span><span class="rev-v">${horario}</span></div>
  <div class="rev-row"><span class="rev-k">Pagamento</span><span class="rev-v">${pagamento}</span></div>
  <div class="rev-row"><span class="rev-k">Entrega</span><span class="rev-v">${entrega}${frete}</span></div>
</div>
<div class="rev-s">
  <h4>Inteligência do negócio <span class="rev-edit" data-step="1" role="button" tabindex="0" aria-label="Editar inteligência do negócio">✏ editar</span></h4>
  <div class="rev-row"><span class="rev-k">Catálogo</span><span class="rev-v" style="white-space:pre-wrap;font-size:.73rem">${prodShort}</span></div>
  ${ob.best?`<div class="rev-row"><span class="rev-k">Mais vendido</span><span class="rev-v">${best}</span></div>`:''}
  ${ob.promo?`<div class="rev-row"><span class="rev-k">Promoção</span><span class="rev-v">${promo}</span></div>`:''}
  ${ob.obj?`<div class="rev-row"><span class="rev-k">Objeções</span><span class="rev-v">${escHtml((ob.obj||'').substring(0,80))}${ob.obj.length>80?'…':''}</span></div>`:''}
  ${ob.script?`<div class="rev-row"><span class="rev-k">Script venda</span><span class="rev-v">✓ configurado</span></div>`:''}
</div>
<div class="rev-s">
  <h4>Personalidade <span class="rev-edit" data-step="2" role="button" tabindex="0" aria-label="Editar personalidade">✏ editar</span></h4>
  <div class="rev-row"><span class="rev-k">Agente</span><span class="rev-v">${nia} (${gen})</span></div>
  <div class="rev-row"><span class="rev-k">Tom</span><span class="rev-v">${tom} · Emojis: ${emo} · Formalidade: ${formt}</span></div>
  <div class="rev-row"><span class="rev-k">Mensagens</span><span class="rev-v">${tam}</span></div>
</div>
<div class="rev-s"><h4>Resumo interno da configuração pronta</h4><div class="pp">${prv}</div></div>
</div>`}

// ═══════════════════════════════════════
// SCORING
// ═══════════════════════════════════════
function ss(sec){
  if(sec==='id'){let s=0;if(ob.nome)s+=20;if(ob.seg)s+=15;if(ob.desc&&ob.desc.length>50)s+=20;if(ob.hr)s+=15;if(Array.isArray(ob.pag)&&ob.pag.length>1)s+=15;if(ob.cidade)s+=10;if(ob.entrega)s+=5;return Math.min(s,100)}
  if(sec==='prod'){let s=0;if(ob.prod&&ob.prod.length>50)s+=20;if(ob.prod&&ob.prod.length>200)s+=15;if(ob.faq&&ob.faq.length>50)s+=20;if(ob.obj&&ob.obj.length>30)s+=20;if(ob.best)s+=10;if(ob.promo)s+=10;if(ob.script&&ob.script.length>30)s+=5;if(ob.indisp)s+=0;return Math.min(s,100)}
  if(sec==='rules'){let s=0;if(ob.deve&&ob.deve.length>30)s+=25;if(ob.nunca&&ob.nunca.length>30)s+=25;if(ob.saud)s+=15;if(ob.enc)s+=10;if(Array.isArray(ob.trans)&&ob.trans.length>0)s+=15;if(ob.troca)s+=10;return Math.min(s,100)}
  if(sec==='pers'){let s=0;if(ob.nia)s+=25;if(ob.tom)s+=30;if(ob.pers)s+=20;if(ob.expr)s+=15;if(ob.gen)s+=10;return Math.min(s,100)}
  return 0;
}
function calcScore(){return Math.round((ss('id')+ss('prod')+ss('rules')+ss('pers'))/4)}


// ═══════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════
function buildPrompt(){
  const tom={amigavel:'amigável, caloroso e descontraído',profissional:'profissional e formal',jovem:'jovem, animado e moderno',luxo:'sofisticado, elegante e exclusivo',tecnico:'técnico, direto e objetivo'};
  const emoj={0:'nunca use emojis',1:'use emojis com moderação',2:'use emojis com frequência',3:'use emojis em quase todas as mensagens'};
  const form={0:'escreva de forma muito informal, como conversa entre amigos',1:'escreva de forma informal mas respeitosa',2:'escreva de forma formal e profissional',3:'escreva de forma muito formal e rebuscada'};
  const tam={0:'máximo 1 linha por resposta',1:'máximo 2-3 linhas por resposta',2:'máximo 4-5 linhas por resposta',3:'use o tamanho necessário para ser completo e claro'};
  const ev=ob.emov??1,fv=ob.forv??1,tv=ob.tamv??1;
  let p=`Você é ${ob.nia||'Bia'}, assistente virtual ${ob.gen==='masculino'?'do':'da'} ${ob.nome||'empresa'}.

NEGÓCIO:
- Nome: ${ob.nome||'—'}
- Segmento: ${ob.seg||'—'}
- Cidade: ${ob.cidade||'—'}${ob.regiao?'\n- Região: '+ob.regiao:''}
- Horário: ${ob.hr||'—'}${ob.desc?'\n- Sobre nós: '+ob.desc:''}`;
  if(Array.isArray(ob.pag)&&ob.pag.length)p+=`\n- Pagamento: ${ob.pag.join(', ')}`;
  if(ob.entrega)p+=`\n- Entrega: ${ob.entrega}${ob.frete?' · Frete grátis a partir de: '+ob.frete:''}`;
  if(ob.prazo)p+=`\n- Prazo: ${ob.prazo}`;
if(ob.human)p+=`\n- Retorno da equipe: ${ob.human}`;
  if(ob.prod)p+=`\n\nCATÁLOGO COMPLETO DE PRODUTOS/SERVIÇOS:\n${ob.prod}`;
  if(ob.best)p+=`\n\nDESTAQUE / MAIS VENDIDO: ${ob.best} — priorize ao recomendar`;
  if(ob.promo)p+=`\n\nPROMOÇÕES ATIVAS (mencione proativamente): ${ob.promo}`;
  if(ob.indisp)p+=`\n\nPRODUTOS/SERVIÇOS TEMPORARIAMENTE INDISPONÍVEIS (informe ao cliente que não temos no momento e ofereça alternativa se houver): ${ob.indisp}`;
  if(ob.troca)p+=`\n\nPOLÍTICA DE TROCA/DEVOLUÇÃO: ${ob.troca}`;
  if(ob.faq)p+=`\n\nPERGUNTAS FREQUENTES E RESPOSTAS CORRETAS:\n${ob.faq}`;
  if(ob.obj)p+=`\n\nOBJEÇÕES COMUNS E COMO CONTORNAR:\n${ob.obj}`;
  if(ob.script)p+=`\n\nSCRIPT DE FECHAMENTO DE VENDA (siga esta ordem quando cliente quiser comprar):\n${ob.script}`;
  if(ob.deve)p+=`\n\nSEMPRE FAÇA:\n${ob.deve}`;
  if(ob.nunca)p+=`\n\nNUNCA FAÇA:\n${ob.nunca}`;
if(Array.isArray(ob.trans)&&ob.trans.length)p+=`\n\nDEVOLVER PARA A EQUIPE (diga: 'vou encaminhar para a equipe da empresa'): ${ob.trans.join(', ')}`;
  if(ob.conf)p+=`\n\nINFORMAÇÕES CONFIDENCIAIS (nunca revelar): ${ob.conf}`;
  if(ob.enc)p+=`\n\nENCERRAMENTO DA CONVERSA: "${ob.enc}"`;
  if(ob.dono)p+=`\n\nRESPONSÁVEL: ${ob.dono} (mencione apenas se perguntado diretamente)`;
  p+=`\n\nPERSONALIDADE:
- Tom: ${tom[ob.tom]||tom.amigavel}
- Emojis: ${emoj[ev]}
- Formalidade: ${form[fv]}
- Tamanho: ${tam[tv]}`;
  if(ob.pers)p+=`\n- Características: ${ob.pers}`;
  if(ob.expr)p+=`\n- Use expressões como: ${ob.expr}`;
  p+=`\n\nREGRAS ABSOLUTAS:
- Responda SEMPRE em português do Brasil
- Seja CONCISO: responda só o perguntado, sem repetir o que já foi dito na conversa
- ANTI-REPETIÇÃO: Se o cliente já perguntou algo parecido antes nesta conversa, NÃO repita a mesma resposta. Diga algo como "Como mencionei antes, [resumo curto]" ou acrescente uma informação nova. Nunca copie e cole sua própria resposta anterior.
- Se perceber que o cliente está confuso ou repetindo a pergunta, pergunte o que não ficou claro.
- Nunca invente informações não fornecidas — se não souber, diga que vai verificar
- Nunca mencione Claude, Anthropic ou qualquer IA subjacente
- Mantenha o personagem em todas as situações
- Evite saudações longas em respostas de continuação de conversa`;
  return p;
}

// ═══════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════
function updateNav(i){
  document.getElementById('btnbk').style.display=i===0?'none':'';
  const nx=document.getElementById('btnnx');
  if(i===STEPS.length-1){nx.textContent='🚀 Ir para o primeiro teste';nx.style.fontSize='.875rem';}
  else{nx.textContent='Continuar →';}
  const msgs=[
    'Campos com <strong>*</strong> são obrigatórios',
    '💡 Quanto mais claro estiver o contexto, mais natural tende a ficar a resposta',
    'A personalidade define como o cliente percebe a sua marca na conversa',
`Qualidade da configuração: <strong>${calcScore()}%</strong> — ${calcScore()>=80?'🎉 pronta para um bom primeiro teste':calcScore()>=60?'boa, mas ainda vale completar mais contexto':calcScore()>=40?'média — complete mais campos antes de testar':'preencha mais para o teste sair melhor'}`
  ];
  const navinfo=document.getElementById('navinfo');
  if(!navinfo) return;
  navinfo.textContent='';
  if(i===0){
    navinfo.appendChild(document.createTextNode('Campos com '));
    const strong=document.createElement('strong');
    strong.textContent='*';
    navinfo.appendChild(strong);
    navinfo.appendChild(document.createTextNode(' são obrigatórios'));
    return;
  }
  if(i===3){
    navinfo.appendChild(document.createTextNode('Qualidade da configuração: '));
    const strong=document.createElement('strong');
    strong.textContent=`${calcScore()}%`;
    navinfo.appendChild(strong);
    navinfo.appendChild(document.createTextNode(` — ${calcScore()>=80?'🎉 pronta para um bom primeiro teste':calcScore()>=60?'boa, mas ainda vale completar mais contexto':calcScore()>=40?'média — complete mais campos antes de testar':'preencha mais para o teste sair melhor'}`));
    return;
  }
  navinfo.textContent=msgs[i]||'';
}

function next(){if(!validate(step))return;save(step);if(step===STEPS.length-1){launch();return;}step++;renderStep(step);document.querySelector('.ob-main').scrollTop=0;}
function prev(){if(step===0)return;save(step);step--;renderStep(step);document.querySelector('.ob-main').scrollTop=0;}
function gs(i){save(step);step=i;renderStep(step);}

// ═══════════════════════════════════════
// SAVE / RESTORE
// ═══════════════════════════════════════
function save(i){
  if(i===0){ob.nome=gv('f-nome');ob.seg=gv('f-seg');ob.cidade=gv('f-cidade');ob.regiao=gv('f-regiao');ob.desc=gv('f-desc');ob.hr=gv('f-hr');ob.dono=gv('f-dono');ob.pag=gtog('tg-pag');ob.entrega=gv('f-entrega');ob.frete=gv('f-frete');}
  else if(i===1){ob.prod=gv('f-prod');ob.best=gv('f-best');ob.promo=gv('f-promo');ob.indisp=gv('f-indisp');ob.prazo=gv('f-prazo');ob.tkt=gv('f-tkt');ob.faq=gv('f-faq');ob.obj=gv('f-obj');ob.deve=gv('f-deve');ob.nunca=gv('f-nunca');ob.script=gv('f-script');ob.saud=gv('f-saud');ob.enc=gv('f-enc');ob.troca=gv('f-troca');ob.conf=gv('f-conf');ob.trans=gtog('tg-trans');}
  else if(i===2){ob.nia=gv('f-nia');ob.gen=gv('f-gen');ob.tom=grad('rg-tom');ob.emov=parseInt(document.getElementById('f-emo')?.value??1);ob.emo=['Nunca','Com moderação','Frequente','Muito frequente'][ob.emov];ob.forv=parseInt(document.getElementById('f-for')?.value??1);ob.formt=['Muito informal','Informal','Formal','Muito formal'][ob.forv];ob.tamv=parseInt(document.getElementById('f-tam')?.value??1);ob.tam=['1 linha','2-3 linhas','4-5 linhas','Longa se necessário'][ob.tamv];ob.pers=gv('f-pers');ob.expr=gv('f-expr');}
  localStorage.setItem('mercabot_ob',JSON.stringify(ob));
}

function restore(i){
  if(i===0){sv('f-nome',ob.nome);sv('f-seg',ob.seg);sv('f-cidade',ob.cidade);sv('f-regiao',ob.regiao);sv('f-desc',ob.desc);sv('f-hr',ob.hr);sv('f-dono',ob.dono);sv('f-entrega',ob.entrega);sv('f-frete',ob.frete);if(Array.isArray(ob.pag))ob.pag.forEach(p=>stog('tg-pag',p));if(ob.desc)cc({value:ob.desc,maxLength:350},'ccd');}
  else if(i===1){sv('f-prod',ob.prod);sv('f-best',ob.best);sv('f-promo',ob.promo);sv('f-indisp',ob.indisp);sv('f-prazo',ob.prazo);sv('f-tkt',ob.tkt);sv('f-faq',ob.faq);sv('f-obj',ob.obj);sv('f-deve',ob.deve);sv('f-nunca',ob.nunca);sv('f-script',ob.script);sv('f-saud',ob.saud);sv('f-enc',ob.enc);sv('f-troca',ob.troca);sv('f-conf',ob.conf);if(Array.isArray(ob.trans))ob.trans.forEach(t=>stog('tg-trans',t));if(ob.prod)cc({value:ob.prod,maxLength:900},'ccp');if(ob.faq)cc({value:ob.faq,maxLength:700},'ccfaq');if(ob.obj)cc({value:ob.obj,maxLength:600},'ccobj');if(ob.deve)cc({value:ob.deve,maxLength:450},'ccde');if(ob.nunca)cc({value:ob.nunca,maxLength:450},'ccnu');if(ob.script)cc({value:ob.script,maxLength:500},'ccscript');}
  else if(i===2){sv('f-nia',ob.nia);sv('f-gen',ob.gen);sv('f-pers',ob.pers);sv('f-expr',ob.expr);if(ob.tom)srad('rg-tom',ob.tom);['emo','for','tam'].forEach(k=>{const el=document.getElementById('f-'+k);if(el&&ob[k+'v']!=null){el.value=ob[k+'v'];const lbls={emo:['Nunca','Com moderação','Frequente','Muito frequente'],for:['Muito informal','Informal','Formal','Muito formal'],tam:['1 linha','2-3 linhas','4-5 linhas','Longa se necessário']};us(el,'sv-'+k,lbls[k]);}});}
}

// ═══════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════
function validate(i){
  if(i===0){
    if(!gv('f-nome')){shk('f-nome');return false;}
    if(!gv('f-seg')){shk('f-seg');return false;}
    if(!gv('f-desc')||gv('f-desc').length<20){shk('f-desc');return false;}
    if(!gv('f-hr')){shk('f-hr');return false;}
    if(!gtog('tg-pag').length){toast('Selecione ao menos uma forma de pagamento');return false;}
    if(!gv('f-entrega')){shk('f-entrega');return false;}
  }
  if(i===1){
    if(!gv('f-prod')||gv('f-prod').length<20){shk('f-prod');return false;}
    if(!gv('f-faq')||gv('f-faq').length<20){shk('f-faq');return false;}
    if(!gv('f-deve')||gv('f-deve').length<10){shk('f-deve');return false;}
    if(!gv('f-nunca')||gv('f-nunca').length<10){shk('f-nunca');return false;}
  }
  if(i===2){
    if(!gv('f-nia')){shk('f-nia');return false;}
    if(!grad('rg-tom')){toast('Selecione um tom de voz');return false;}
  }
  return true;
}
function shk(id){const e=document.getElementById(id);if(!e)return;e.style.borderColor='var(--red)';e.style.animation='none';e.offsetHeight;e.style.animation='shake .3s ease';setTimeout(()=>{e.style.borderColor='';e.style.animation='';},1000);e.focus();toast('Preencha o campo destacado');}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function attach(i){
  document.querySelectorAll('.tc').forEach(c=>c.addEventListener('click',()=>{c.classList.toggle('on');if(i===1)updateLiveScore();}));
  document.querySelectorAll('.rc').forEach(c=>c.addEventListener('click',()=>{c.closest('.rg').querySelectorAll('.rc').forEach(r=>r.classList.remove('on'));c.classList.add('on');}));
  document.querySelectorAll('input[type=range]').forEach(r=>{r.style.setProperty('--pct',(r.value/r.max*100)+'%');});
  if(i===1){
    ['f-prod','f-faq','f-obj','f-deve','f-nunca','f-script','f-saud','f-enc','f-troca'].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener('input',updateLiveScore);
    });
    updateLiveScore();
  }
}

function updateLiveScore(){
  // Read current field values without saving to ob
  const tmp={
    prod:document.getElementById('f-prod')?.value.trim()||'',
    faq:document.getElementById('f-faq')?.value.trim()||'',
    obj:document.getElementById('f-obj')?.value.trim()||'',
    best:document.getElementById('f-best')?.value.trim()||'',
    promo:document.getElementById('f-promo')?.value.trim()||'',
    script:document.getElementById('f-script')?.value.trim()||'',
    deve:document.getElementById('f-deve')?.value.trim()||'',
    nunca:document.getElementById('f-nunca')?.value.trim()||'',
    saud:document.getElementById('f-saud')?.value.trim()||'',
    enc:document.getElementById('f-enc')?.value.trim()||'',
    troca:document.getElementById('f-troca')?.value.trim()||'',
    indisp:document.getElementById('f-indisp')?.value.trim()||'',
  };
  let s=0;
  if(tmp.prod.length>50)s+=18;if(tmp.prod.length>200)s+=12;
  if(tmp.faq.length>50)s+=18;if(tmp.faq.length>150)s+=7;
  if(tmp.obj.length>30)s+=18;
  if(tmp.best)s+=5;if(tmp.promo)s+=5;
  if(tmp.script.length>30)s+=7;
  if(tmp.deve.length>20)s+=5;if(tmp.nunca.length>20)s+=5;
  const score=Math.min(s,100);
  const fill=document.getElementById('lsb-fill');
  const pct=document.getElementById('lsb-pct');
  const msg=document.getElementById('lsb-msg');
  if(!fill)return;
  fill.style.width=score+'%';
  fill.style.background=score>70?'var(--g)':score>40?'var(--amber)':'var(--red)';
  pct.style.color=score>70?'var(--g)':score>40?'var(--amber)':'var(--red)';
  pct.textContent=score+'%';
  const msgs=['Comece pelo catálogo 👆','Ótimo começo! Continue…','Ficando muito bom 👍','Quase pronto para validar 🎉','Excelente — pronto para um teste forte ✨'];
  msg.textContent=msgs[Math.floor(score/25)]||msgs[4];
}
function gv(id){const e=document.getElementById(id);return e?e.value.trim():'';}
function sv(id,val){const e=document.getElementById(id);if(e&&val!=null)e.value=val;}
function gtog(gid){const g=document.getElementById(gid);if(!g)return[];return[...g.querySelectorAll('.tc.on')].map(c=>c.dataset.val);}
function stog(gid,val){const g=document.getElementById(gid);if(!g)return;g.querySelectorAll('.tc').forEach(c=>{if(c.dataset.val===val)c.classList.add('on');});}
function grad(gid){const g=document.getElementById(gid);if(!g)return'';const e=g.querySelector('.rc.on');return e?e.dataset.val:'';}
function srad(gid,val){const g=document.getElementById(gid);if(!g)return;g.querySelectorAll('.rc').forEach(c=>c.classList.toggle('on',c.dataset.val===val));}
function cc(el,oid){const o=document.getElementById(oid);if(o)o.textContent=`${el.value.length}/${el.maxLength}`;}
function us(el,oid,lbls){const o=document.getElementById(oid);if(o)o.textContent=lbls[el.value];el.style.setProperty('--pct',(el.value/el.max*100)+'%');}

// ═══════════════════════════════════════
// LAUNCH
// ═══════════════════════════════════════
async function launch(){
  save(3);
  await persistRuntimeConfig();
  const ls=document.getElementById('launch');const lb=document.getElementById('lb');const lm=document.getElementById('lmsg');
  ls.style.display='flex';
const msgs=['Analisando informações do negócio...','Ajustando o estilo de atendimento...','Organizando o contexto da operação...','Preparando a primeira conversa guiada...'];
  for(let i=0;i<msgs.length;i++){lm.textContent=msgs[i];await abar(lb,i*25,(i+1)*25);await slp(400);}
  ls.style.display='none';
  document.getElementById('onboarding').style.display='none';
  initApp();
}
function abar(bar,from,to){return new Promise(r=>{let v=from;const iv=setInterval(()=>{v++;bar.style.width=v+'%';if(v>=to){clearInterval(iv);r();}},10);});}
function slp(ms){return new Promise(r=>setTimeout(r,ms));}

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
function initApp(){
  document.getElementById('mainapp').style.display='flex';
  updateKeyBadge();buildSummary();updateWaHdr();updateChips();startChat();renderHumanTakeoverState(false);updStats();
  // Aplicar idioma salvo
  setDemoLang(demoLang);
}

function escHtml(value){
  if(value == null) return '';
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function buildSummary(){
  const sc=calcScore();
  const nome = ob.nome || '—';
  const seg = ob.seg || '—';
  const cidade = ob.cidade || '—';
  const regiao = ob.regiao ? ' · ' + ob.regiao : '';
  const horario = ob.hr || '—';
  const pagamento = Array.isArray(ob.pag) ? ob.pag.join(', ') : (ob.pag || '—');
  const nia = ob.nia || '—';
  const tom = ob.tom || '—';
  const tam = ob.tam || '—';
  const cfgs=document.getElementById('cfgs');
  if(!cfgs) return;
  cfgs.textContent='';
  function appendRow(host, key, value){
    const row=document.createElement('div');
    row.className='cr';
    const left=document.createElement('span');
    left.className='ck';
    left.textContent=key;
    const right=document.createElement('span');
    right.className='cv';
    right.textContent=value;
    row.appendChild(left);
    row.appendChild(right);
    host.appendChild(row);
  }
  function createCard(title){
    const card=document.createElement('div');
    card.className='cb';
    const header=document.createElement('div');
    header.className='cbt';
    header.textContent=title;
    card.appendChild(header);
    return card;
  }
  const identity=createCard('Identidade');
  const edit=document.createElement('span');
  edit.className='cedit';
  edit.setAttribute('role','button');
  edit.setAttribute('tabindex','0');
  edit.setAttribute('aria-label','Editar dados do negócio');
  edit.textContent='✏ editar';
  edit.addEventListener('click', function(){ editOb(); });
  edit.addEventListener('keydown', function(event){ if(event.key==='Enter'||event.key===' '){event.preventDefault();editOb();} });
  identity.firstChild.appendChild(document.createTextNode(' '));
  identity.firstChild.appendChild(edit);
  appendRow(identity,'Negócio',nome);
  appendRow(identity,'Segmento',seg);
  appendRow(identity,'Cidade',cidade + regiao);
  appendRow(identity,'Horário',horario);
  appendRow(identity,'Pagamento',pagamento);
  const agent=createCard('Agente IA');
  appendRow(agent,'Nome',nia);
  appendRow(agent,'Tom',tom);
  appendRow(agent,'Mensagens',tam);
  const quality=createCard('Qualidade da configuração');
  const qmini=document.createElement('div');
  qmini.className='qmini';
  const qlabel=document.createElement('span');
  qlabel.textContent='Qualidade';
  const qmb=document.createElement('div');
  qmb.className='qmb';
  const qmf=document.createElement('div');
  qmf.className='qmf';
  qmf.style.width=`${sc}%`;
  qmb.appendChild(qmf);
  const qstrong=document.createElement('strong');
  qstrong.textContent=`${sc}%`;
  qmini.appendChild(qlabel);
  qmini.appendChild(qmb);
  qmini.appendChild(qstrong);
  const qnote=document.createElement('div');
  qnote.style.fontSize='.67rem';
  qnote.style.color='var(--mu)';
  qnote.style.marginTop='.4rem';
  qnote.textContent=sc>=80?'🎉 Excelente — pronto para um teste forte':sc>=60?'✓ Bom — pode melhorar mais':'⚠ Incompleto — volte e preencha mais';
  quality.appendChild(qmini);
  quality.appendChild(qnote);
  cfgs.appendChild(identity);
  cfgs.appendChild(agent);
  cfgs.appendChild(quality);
}

function updateWaHdr(){
  document.getElementById('waav').textContent=AV[ob.seg]||'🏪';
  const host = document.getElementById('wacn');
  if(!host) return;
  host.textContent='';
  host.appendChild(document.createTextNode(ob.nome || 'Negócio'));
  const badge=document.createElement('span');
  badge.className='ait';
  badge.textContent=isHumanTakeoverActive()?'● equipe no controle':'● IA ativa';
  host.appendChild(document.createTextNode(' '));
  host.appendChild(badge);
}

function updateChips(){
  const bar=document.getElementById('chbar');
  const list=CH_MAP[ob.seg]||CH_MAP.outro;
  bar.textContent='';
  list.forEach(c=>{
    const chip=document.createElement('div');
    chip.className='ch';
    chip.setAttribute('role','button');
    chip.setAttribute('tabindex','0');
    chip.setAttribute('aria-label',`Selecionar sugestão: ${c}`);
    chip.textContent=c;
    chip.addEventListener('click', function(){ sch(chip); });
    chip.addEventListener('keydown', function(event){ if(event.key==='Enter'||event.key===' '){event.preventDefault();sch(chip);} });
    bar.appendChild(chip);
  });
}

function startChat(){
  const s=ob.saud||`Olá! 👋 Seja bem-vind${ob.gen==='masculino'?'o ao':'a à'} *${ob.nome||'nossa empresa'}*! Sou ${ob.nia||'seu assistente'}, aqui para te ajudar. Como posso te ajudar hoje? 😊`;
  addMsg(s,'r');
  hist=[{role:'assistant',content:s.replace(/\*/g,'')}];
}

function gt(){return new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
function appendFormattedMessage(host, text){
  const input=String(text||'');
  const lines=input.split('\n');
  lines.forEach((line, lineIndex)=>{
    const parts=line.split(/(\*\*.*?\*\*|\*.*?\*)/g).filter(Boolean);
    parts.forEach(part=>{
      const boldMatch=part.match(/^\*\*(.*?)\*\*$/) || part.match(/^\*(.*?)\*$/);
      if(boldMatch){
        const strong=document.createElement('strong');
        strong.textContent=boldMatch[1];
        host.appendChild(strong);
      } else {
        host.appendChild(document.createTextNode(part));
      }
    });
    if(lineIndex < lines.length - 1) host.appendChild(document.createElement('br'));
  });
}

function addMsg(txt,type){
  const el=document.createElement('div');el.className=`msg ${type}`;
  appendFormattedMessage(el, txt);
  const meta=document.createElement('div');
  meta.className='mt';
  meta.textContent=`${gt()}${type==='s'?' ✓✓':''}`;
  el.appendChild(meta);
  document.getElementById('wam').appendChild(el);sb();
  if(type==='s')document.getElementById('chbar').style.display='none';
  const li=document.createElement('div');li.className='li';
  const badge=document.createElement('span');
  badge.className=`lr ${type==='s'?'u':'a'}`;
  badge.textContent=type==='s'?'cli':'ia';
  const label=document.createElement('span');
  label.className='lt';
  const plainTxt=txt.replace(/<[^>]+>/g,'');
  label.textContent=`${plainTxt.substring(0,52)}${plainTxt.length>52?'…':''}`;
  li.appendChild(badge);
  li.appendChild(label);
  document.getElementById('ll').appendChild(li);
  document.getElementById('ll').scrollTop=99999;
  // Show mystery button after 4+ exchanges
  if(hist.length>=4){const mb=document.getElementById('mystery-btn');if(mb)mb.style.opacity='1';}
  else{const mb=document.getElementById('mystery-btn');if(mb)mb.style.opacity='.4';}
}

function sb(){const m=document.getElementById('wam');m.scrollTop=m.scrollHeight;}

async function send(txt){
  const inp=document.getElementById('wai');
  const t=txt||inp.value.trim();
  if(!t||busy)return;
  renderHumanTakeoverState(false);

  // ── Verificação anti-abuso ───────────────────────────────────
  const protErr=PROT.check();
  if(protErr){
    if(protErr!=='blocked'){
      serr(protErr);
      // Feedback visual no input
      inp.classList.add('rate-limited');
      setTimeout(()=>inp.classList.remove('rate-limited'),2000);
    }
    return;
  }
  if(isHumanTakeoverActive()){
    inp.value='';busy=true;stats.msgs++;
    PROT.record();
    addMsg(t,'s');hist.push({role:'user',content:t});
    stats.tu++;
    updStats();
addSystemNote('Mensagem recebida. Controle manual ativo: a próxima resposta depende da equipe da empresa até o fim do dia.');
    busy=false;
    return;
  }
  PROT.record();
  // ────────────────────────────────────────────────────────────

  inp.value='';busy=true;stats.msgs++;

  // Atualiza badge de uso diário
  const dailyUsed=PROT.getDailyCount();
  const dailyPct=Math.round(dailyUsed/PROT.DAILY_LIMIT*100);
  if(dailyPct>=80){
    const warn=document.getElementById('daily-warn');
    if(warn){ warn.style.display='flex'; warn.querySelector('span').textContent=`${dailyUsed}/${PROT.DAILY_LIMIT} msgs hoje`; }
  }
  addMsg(t,'s');hist.push({role:'user',content:t});

  // ── Detecção de pergunta repetida ─────────────────────────────
  checkRepeatedQuestion(t);

  if(shouldOfferHumanHandoff(t)){
const handoffReply = 'Posso devolver esta conversa para a equipe da empresa se preferir. Se o responsável assumir agora, o controle fica manual até o fim do dia.';
    hist.push({role:'assistant',content:handoffReply});
    addMsg(handoffReply,'r');
    stats.rc++;stats.tu++;updStats();
    busy=false;
    return;
  }
  const iw=['comprar','quero','pegar','fechar','reservar','finalizar','pagar','pedido','encomendar','quanto fica','vou levar','manda o link'];
  if(iw.some(w=>t.toLowerCase().includes(w))){stats.in++;document.getElementById('mi2').textContent=stats.in;const ia=document.getElementById('ial');ia.classList.add('on');setTimeout(()=>ia.classList.remove('on'),5000);}
  st(true);const t0=Date.now();await slp(600+Math.random()*900);
  try{
    const res=await fetch(AI_RUNTIME_URL,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({config:ob,messages:hist.slice(-20)})});
    st(false);
    if(!res.ok){const e=await res.json().catch(()=>({}));if(res.status===429){serr('Limite de requisições atingido. Aguarde alguns segundos e tente novamente.');}else if(res.status===500||res.status===529){serr('Serviço temporariamente indisponível. Tente novamente em alguns instantes.');}else{serr(e.error?.message||`Erro ${res.status} — tente novamente`);}busy=false;return;}
    const data=await res.json();const reply=data.content[0]?.text||'Desculpe, não entendi. Pode repetir?';
    const tk=(data.usage?.input_tokens||0)+(data.usage?.output_tokens||0);
    hist.push({role:'assistant',content:reply});addMsg(reply,'r');pnotif();
    stats.rc++;stats.ms+=Date.now()-t0;stats.tk+=tk;stats.tu++;updStats();
  }catch(e){st(false);serr('Erro de conexão.');console.error(e);}
  busy=false;
}

function sch(el){send(el.textContent);}
function hk(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}
function st(on){const t=document.getElementById('ti');t.classList.toggle('on',on);if(on)sb();}

// ── Detecção de pergunta repetida ──────────────────────────────
// Normaliza texto: lowercase, sem pontuação, sem stopwords
function normalizeQ(t){
  return t.toLowerCase()
    .replace(/[?!.,;:\-]/g,'')
    .replace(/\b(o|a|os|as|um|uma|de|do|da|em|no|na|e|é|que|tem|tem|qual|quais|me|meu|minha|você|vc|pra|para|com|por)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}
// Calcula similaridade simples por palavras em comum (Jaccard)
function similarity(a, b){
  const sa = new Set(a.split(' ').filter(w=>w.length>2));
  const sb = new Set(b.split(' ').filter(w=>w.length>2));
  if(!sa.size || !sb.size) return 0;
  let inter = 0;
  sa.forEach(w=>{ if(sb.has(w)) inter++; });
  return inter / (sa.size + sb.size - inter);
}
function checkRepeatedQuestion(newMsg){
  // Só verifica perguntas (contêm "?" ou palavras interrogativas)
  const isQ = /\?|quanto|qual|tem|tem|existe|posso|como|quando|onde|aceita|faz|traz|tem/i.test(newMsg);
  if(!isQ || hist.length < 3) return;
  const normNew = normalizeQ(newMsg);
  // Busca nas últimas 10 mensagens do usuário (excluindo a atual)
  const userMsgs = hist.filter(m=>m.role==='user').slice(0,-1).slice(-10);
  const hasSimilar = userMsgs.some(m => similarity(normNew, normalizeQ(m.content)) > 0.55);
  if(hasSimilar){
    const banner = document.getElementById('repeatBanner');
    const txt = document.getElementById('repeatBannerText');
    if(banner && txt){
      txt.textContent = '⚠ Pergunta similar já feita nesta conversa — a IA foi instruída a complementar, não repetir.';
      banner.classList.add('on');
      setTimeout(()=>banner.classList.remove('on'), 8000);
    }
  }
}

function updStats(){
  document.getElementById('mm').textContent=stats.msgs;
  // Update daily usage display
  try{
    const used=PROT.getDailyCount();
    const pct=Math.round(used/PROT.DAILY_LIMIT*100);
    const el=document.getElementById('daily-counter');
    if(el) el.textContent=used+'/'+PROT.DAILY_LIMIT;
    const bar=document.getElementById('daily-bar');
    if(bar){ bar.style.width=Math.min(pct,100)+'%'; bar.style.background=pct>80?'#f59e0b':'#00e676'; }
  }catch(e){}
  document.getElementById('mmt').textContent=stats.msgs+' trocas';
  if(stats.rc>0){const a=Math.round(stats.ms/stats.rc/100)/10;document.getElementById('mr').textContent=a+'s';document.getElementById('mrt').textContent=a<2?'⬆ rápido':'média';}
  document.getElementById('mtu').textContent=stats.tu;
  const c=stats.tk*0.0000024*5.7;
  document.getElementById('ctk').textContent=stats.tk.toLocaleString('pt-BR');
  document.getElementById('cv2').textContent=`R$ ${c.toFixed(4)}`;
  document.getElementById('cbf').style.width=Math.min(c/0.5*100,100)+'%';
}

function pnotif(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(880,ctx.currentTime);o.frequency.setValueAtTime(1100,ctx.currentTime+0.05);g.gain.setValueAtTime(0.1,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.14);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.14);}catch(e){}}

function rat(n){sat=n;const l=['','Péssimo 😞','Ruim 😕','Ok 😐','Bom 😊','Excelente! 🤩'];document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('lit',i<n));document.getElementById('satl').textContent=l[n]||'';toast(`Avaliação: ${n}/5 ⭐`);}

function resetChat(){hist=[];stats={msgs:0,ms:0,rc:0,tk:0,in:0,tu:0};const mp=document.getElementById('mystery-panel');if(mp)mp.style.display='none';const mb=document.getElementById('mystery-btn');if(mb){mb.style.opacity='.4';mb.textContent='🕵️ Revisar qualidade da resposta';}  ['mm','mr','mi2','mtu'].forEach(id=>document.getElementById(id).textContent=id==='mr'?'—':'0');document.getElementById('ctk').textContent='0';document.getElementById('cv2').textContent='R$ 0,0000';document.getElementById('cbf').style.width='0%';document.getElementById('daily-bar').style.width='0%';document.getElementById('ll').textContent='';const wam=document.getElementById('wam');wam.textContent='';const wad=document.createElement('div');wad.className='wadd';const wadb=document.createElement('div');wadb.className='wadb';wadb.textContent='HOJE';wad.appendChild(wadb);wam.appendChild(wad);document.getElementById('chbar').style.display='flex';document.querySelectorAll('.star').forEach(s=>s.classList.remove('lit'));document.getElementById('satl').textContent='Avalie o atendimento';sat=0;startChat();renderHumanTakeoverState(false);updStats();toast('Conversa reiniciada para um novo teste.');}

function exportChat(){if(!hist.length){toast('Nenhuma conversa ainda.');return;}const lines=[`CONVERSA — ${ob.nome||'Negócio'} × Cliente`,`Data: ${new Date().toLocaleString('pt-BR')}`,`Agente: ${ob.nia||'IA'} · Qualidade da configuração: ${calcScore()}%`,`Satisfação: ${sat?sat+'/5 ⭐':'Não avaliado'}`,'─'.repeat(50),''];hist.forEach(m=>lines.push(`[${m.role==='user'?'CLIENTE':'IA'}] ${m.content}`,''));lines.push('─'.repeat(50));lines.push(`Tokens: ${stats.tk} · Sessão leve estimada: R$${(stats.tk*0.0000024*5.7).toFixed(5)} (Haiku 4.5)`);const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`mercabot-${(ob.nome||'agente').replace(/\s+/g,'-').replace(/[^a-z0-9-]/gi,'').toLowerCase()||'agente'}-${Date.now()}.txt`;a.click();toast('✓ Exportado!');}

function serr(msg){const b=document.getElementById('ebar');b.textContent='⚠ '+msg;b.classList.add('on');setTimeout(()=>b.classList.remove('on'),7000);}

function openKey(){document.getElementById('mov').style.display='flex';document.getElementById('me').classList.remove('on');}
function buildRuntimeConfig(){
  return {
    nome: ob.nome||'',
    segmento: ob.seg||'',
    cidade: ob.cidade||'',
    horario: ob.hr||'',
    descricao: ob.desc||'',
    faq: ob.faq||'',
    deve: ob.deve||'',
    nunca: ob.nunca||'',
    human: ob.human||ob.whatsapp_number||'',
    whatsapp_number: ob.whatsapp_number||ob.human||'',
    tom: ob.tom||'',
    nia: ob.nia||''
  };
}
async function getSessionJwt(){
  if(!supabaseClient || !supabaseClient.auth) return '';
  try{
    const sessionResult=await supabaseClient.auth.getSession();
    return sessionResult && sessionResult.data && sessionResult.data.session ? sessionResult.data.session.access_token : '';
  }catch(_){
    return '';
  }
}
async function persistRuntimeConfig(){
  const jwt=await getSessionJwt();
  if(!jwt) return false;
  try{
    const res=await fetch(AI_SAVE_CONFIG_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
      body:JSON.stringify({config:buildRuntimeConfig()})
    });
    return res.ok;
  }catch(_){
    return false;
  }
}
async function saveKey(){
  const token=document.querySelector('[name="cf-turnstile-response"]')?.value||'';
  if(hasRealTurnstile() && !token){document.getElementById('me').textContent='Complete a verificação de segurança abaixo.';document.getElementById('me').classList.add('on');return;}
  const jwt=await getSessionJwt();
  if(jwt){
    try{ await persistRuntimeConfig(); }catch(_){}
  }
document.getElementById('mov').style.display='none';updateKeyBadge();toast('IA premium pronta para o primeiro teste.');
}
function updateKeyBadge(){document.getElementById('kico').textContent='🟢';document.getElementById('klbl').textContent='IA premium inclusa';document.getElementById('akb').className='akb on';}

function editOb(){document.getElementById('onboarding').style.display='flex';document.getElementById('mainapp').style.display='none';step=0;renderStep(0);}
function togglePres(){document.getElementById('app').classList.toggle('pres');const on=document.getElementById('app').classList.contains('pres');toast(on?'Modo apresentação ativado.':'Modo apresentação desativado.');}

// ═══════════════════════════════════════
// MYSTERY SHOPPER
// ═══════════════════════════════════════
async function runMystery(){
  if(hist.length<4){toast('Converse mais um pouco antes de avaliar');return;}
  const btn=document.getElementById('mystery-btn');
  btn.textContent='⏳ Avaliando...';btn.disabled=true;
  const conv=hist.slice(-16).map(m=>`[${m.role==='user'?'CLIENTE':'IA'}] ${m.content}`).join('\n');
  const evalPrompt=`Você é um avaliador especialista em atendimento ao cliente via WhatsApp. Analise a conversa abaixo e avalie a performance do agente de IA.

CONVERSA:
${conv}

Retorne APENAS um JSON válido neste formato exato:
{"score":85,"pontos_fortes":["ponto 1","ponto 2","ponto 3"],"melhorias":["melhoria 1","melhoria 2"],"resumo":"frase curta de avaliação geral"}

Avalie de 0-100 considerando: clareza das respostas, velocidade na solução, simpatia, conhecimento do produto, condução para fechamento.`;
  try{
    const res=await fetch(AI_PROXY_URL,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:350,messages:[{role:'user',content:evalPrompt}]})});
    const data=await res.json();
    const text=data.content[0]?.text||'{}';
    const match=text.match(/\{[\s\S]*\}/);
    if(match){
      let r;
      try{r=JSON.parse(match[0]);}catch(je){toast('Erro ao processar avaliação');btn.textContent='🕵️ Reavaliar';btn.disabled=false;return;}
      const panel=document.getElementById('mystery-panel');
      const result=document.getElementById('mystery-result');
      const bar=document.getElementById('mystery-bar');
      const scoreEl=document.getElementById('mystery-score');
      panel.style.display='block';
      const sc=parseInt(r.score)||0;bar.style.width=sc+'%';
      bar.style.background=sc>=70?'var(--g)':sc>=40?'var(--amber)':'var(--red)';
      scoreEl.textContent=sc+'/100';
      scoreEl.style.color=sc>=70?'var(--g)':sc>=40?'var(--amber)':'var(--red)';
      result.textContent='';
      if(r.resumo){
        const em=document.createElement('em');
        em.style.color='var(--tx)';
        em.textContent=`"${String(r.resumo)}"`;
        result.appendChild(em);
        result.appendChild(document.createElement('br'));
        result.appendChild(document.createElement('br'));
      }
      if(r.pontos_fortes?.length){
        const strong=document.createElement('strong');
        strong.style.color='var(--g)';
        strong.style.fontSize='.65rem';
        strong.textContent='✓ PONTOS FORTES';
        result.appendChild(strong);
        result.appendChild(document.createElement('br'));
        r.pontos_fortes.forEach(p=>{
          result.appendChild(document.createTextNode(`· ${String(p)}`));
          result.appendChild(document.createElement('br'));
        });
      }
      if(r.melhorias?.length){
        result.appendChild(document.createElement('br'));
        const strong=document.createElement('strong');
        strong.style.color='var(--amber)';
        strong.style.fontSize='.65rem';
        strong.textContent='↑ MELHORIAS';
        result.appendChild(strong);
        result.appendChild(document.createElement('br'));
        r.melhorias.forEach(m=>{
          result.appendChild(document.createTextNode(`· ${String(m)}`));
          result.appendChild(document.createElement('br'));
        });
      }
    }
  }catch(e){toast('Erro na avaliação');}
  btn.textContent='🕵️ Reavaliar';btn.disabled=false;
}

// ═══════════════════════════════════════
// SHARE CONFIG LINK
// ═══════════════════════════════════════
function shareConfig(){
  try{
    const str=JSON.stringify(ob);
    const encoded=btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,(_,p1)=>String.fromCharCode('0x'+p1)));
    const url=window.location.href.split('?')[0]+'?cfg='+encoded;
    navigator.clipboard.writeText(url).then(()=>toast('✓ Link copiado! Qualquer pessoa pode abrir com esta configuração')).catch(()=>{
      prompt('Copie o link abaixo:',url);
    });
  }catch(e){toast('Erro ao gerar link');}
}

// ═══════════════════════════════════════
// LOAD CONFIG FROM URL
// ═══════════════════════════════════════
function loadFromURL(){
  const params=new URLSearchParams(window.location.search);
  const cfg=params.get('cfg');
  if(cfg){
    try{
      // Safe UTF-8 decode from base64
      const bytes=atob(cfg);
      const decoded=JSON.parse(decodeURIComponent(bytes.split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
      if(!decoded||typeof decoded!=='object')throw new Error('invalid');
      ob=decoded;
      localStorage.setItem('mercabot_ob',JSON.stringify(ob));
      document.getElementById('onboarding').style.display='none';
      initApp();
      return true;
    }catch(e){
      // Malformed URL param — fall back to normal onboarding
      console.error('MercaBot: invalid cfg param, falling back to onboarding');
    }
  }
  return false;
}

// ═══════════════════════════════════════
// TOAST
// ═══════════════════════════════════════
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),3000);}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
// ── INTERNACIONALIZAÇÃO DO DEMO ──
const I18N = {
  pt: {
    editBusiness: '✏ Editar negócio',
    profileTitle: 'Perfil do Negócio',
    profileSub: 'Resumo da configuração e qualidade do atendimento',
    restartChat: '↺ Reiniciar conversa',
    exportChat: '↓ Exportar conversa',
    panelTitle: 'Painel do teste',
    panelSub: 'Indicadores desta sessão guiada',
    msgs: 'Mensagens', resp: 'Tempo resp.', intents: 'Intenções', turns: 'Turnos',
    intentAlert: '🛒 <strong>Intenção de compra detectada</strong> — direcione para fechar',
    msgPlaceholder: 'Mensagem',
    send: 'Enviar',
    satisfaction: 'Satisfação',
    satLabel: 'Avalie o atendimento',
    chatLog: 'Resumo da conversa',
    exportBtn: 'Exportar conversa (.txt)',
    mysteryBtn: '🕵️ Revisar qualidade da resposta',
    mysteryTitle: '🕵️ Avaliação guiada',
    mysteryLoading: 'Avaliação da IA em andamento...',
    mysteryBtnRe: '🕵️ Reavaliar',
    mysteryEval: '⏳ Avaliando...',
    shareBtn: '🔗 Compartilhar',
    presBtn: '▶ Apresentação',
    aiNotice: '⚡ Esta plataforma utiliza Inteligência Artificial para gerar respostas automáticas',
    qualityScore: 'Qualidade da configuração',
    excellent: '🎉 Excelente — pronto para um teste forte',
    good: '✓ Bom — pode melhorar mais',
    incomplete: '⚠ Incompleto — volte e preencha mais',
    costs: 'Eficiência da sessão',
    tokensUsed: 'Tokens usados',
    sessionCost: 'Leveza da sessão',
    costNote: 'Resposta rápida, contexto consistente e operação leve para o primeiro teste útil.',
  },
  es: {
    editBusiness: '✏ Editar negocio',
    profileTitle: 'Perfil del negocio',
    profileSub: 'Resumen de la configuración y calidad de la atención',
    restartChat: '↺ Reiniciar conversación',
    exportChat: '↓ Exportar conversación',
    panelTitle: 'Panel de prueba',
    panelSub: 'Indicadores de esta sesión guiada',
    msgs: 'Mensajes', resp: 'T. respuesta', intents: 'Intenciones', turns: 'Turnos',
    intentAlert: '🛒 <strong>Intención de compra detectada</strong> — dirígelo al cierre',
    msgPlaceholder: 'Mensaje',
    send: 'Enviar',
    satisfaction: 'Satisfacción',
    satLabel: 'Califica la atención',
    chatLog: 'Resumen de la conversación',
    exportBtn: 'Exportar conversación (.txt)',
    mysteryBtn: '🕵️ Revisar calidad de la respuesta',
    mysteryTitle: '🕵️ Evaluación guiada',
    mysteryLoading: 'Evaluación de la IA en curso...',
    mysteryBtnRe: '🕵️ Re-evaluar',
    mysteryEval: '⏳ Evaluando...',
    shareBtn: '🔗 Compartir',
    presBtn: '▶ Presentación',
    aiNotice: '⚡ Esta plataforma utiliza Inteligencia Artificial para generar respuestas automáticas',
    qualityScore: 'Calidad de la configuración',
    excellent: '🎉 Excelente — listo para una prueba fuerte',
    good: '✓ Bueno — todavía puede quedar mejor',
    incomplete: '⚠ Incompleto — vuelve y completa más',
    costs: 'Eficiencia de la sesión',
    tokensUsed: 'Tokens usados',
    sessionCost: 'Ligereza de la sesión',
    costNote: 'Respuesta rápida, contexto consistente y operación ligera para la primera prueba útil.',
  }
};
let demoLang = localStorage.getItem('mercabot_demo_lang') || 'pt';

function toggleDemoLang() {
  const drop = document.getElementById('demoLangDrop');
  const open = drop.style.display === 'flex';
  drop.style.display = open ? 'none' : 'flex';
  document.getElementById('demoLangBtn').setAttribute('aria-expanded', !open ? 'true' : 'false');
}
function setDemoLang(lang) {
  demoLang = lang;
  localStorage.setItem('mercabot_demo_lang', lang);
  document.getElementById('demoLangDrop').style.display = 'none';
  document.getElementById('demoLangFlag').textContent = lang === 'pt' ? '🇧🇷' : '🌎';
  document.getElementById('demoLangLabel').textContent = lang.toUpperCase();
  document.getElementById('dlopt-pt').style.background = lang==='pt'?'var(--gd)':'transparent';
  document.getElementById('dlopt-pt').style.color = lang==='pt'?'var(--g)':'var(--mu)';
  document.getElementById('dlopt-es').style.background = lang==='es'?'var(--gd)':'transparent';
  document.getElementById('dlopt-es').style.color = lang==='es'?'var(--g)':'var(--mu)';
  applyI18N();
}
function applyI18N() {
  const t = I18N[demoLang];
  const q = (id, txt) => { const el=document.getElementById(id); if(el) el.textContent=txt; };
const setIntentAlert = (el, text) => {
  if(!el) return;
  el.textContent = '';
  const match = text.match(/^(.*?)(<strong>)(.*?)(<\/strong>)(.*)$/);
  if(!match){
    el.textContent = text;
    return;
  }
  if(match[1]) el.appendChild(document.createTextNode(match[1]));
  const strong = document.createElement('strong');
  strong.textContent = match[3];
  el.appendChild(strong);
  if(match[5]) el.appendChild(document.createTextNode(match[5]));
};
  // Static UI text updates
  const rph = document.querySelector('.rph h3'); if(rph) rph.textContent = t.panelTitle;
  const rpp = document.querySelector('.rph p'); if(rpp) rpp.textContent = t.panelSub;
  const lph = document.querySelector('.lph h3'); if(lph) lph.textContent = t.profileTitle;
  const lpp = document.querySelector('.lph p'); if(lpp) lpp.textContent = t.profileSub;
  const wai = document.getElementById('wai'); if(wai) wai.placeholder = t.msgPlaceholder;
  const ial = document.getElementById('ial'); if(ial) setIntentAlert(ial, t.intentAlert);
  const satw = document.querySelector('.satw h4'); if(satw) satw.textContent = t.satisfaction;
  const satl = document.getElementById('satl'); if(satl) satl.textContent = t.satLabel;
  const clog = document.querySelector('.clog h4'); if(clog) clog.textContent = t.chatLog;
  const aiBar = document.querySelector('[role="note"]'); if(aiBar) {
    aiBar.textContent = aiBar.textContent.replace(/⚡.*?automáticas/s, t.aiNotice + ' · ');
  }
  // Metric labels
  document.querySelectorAll('.ml').forEach((el,i) => {
    const labels = [t.msgs, t.resp, t.intents, t.turns];
    if(labels[i]) el.textContent = labels[i];
  });
  // Cost section
  const cbwh = document.querySelector('.cbw h4'); if(cbwh) cbwh.textContent = t.costs;
  document.querySelectorAll('.crow span:first-child').forEach((el,i) => {
    if(i===0) el.textContent = t.tokensUsed;
    if(i===1) el.textContent = t.sessionCost;
  });
  const cn = document.querySelector('.cn'); if(cn) cn.textContent = t.costNote;
  // Mystery
  const mpanel = document.querySelector('#mystery-panel h4'); if(mpanel) mpanel.textContent = t.mysteryTitle;
  const mres = document.getElementById('mystery-result'); if(mres && mres.textContent.includes('andamento') || mres?.textContent.includes('curso')) mres.textContent = t.mysteryLoading;
  const mbtn = document.getElementById('mystery-btn'); if(mbtn && !mbtn.disabled) mbtn.textContent = t.mysteryBtn;
}
document.addEventListener('click', e => {
  const sw = document.getElementById('demoLangSw');
  if(sw && !sw.contains(e.target)) document.getElementById('demoLangDrop').style.display='none';
});

function bindStaticDemoActions(){
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', handler);
  };

  bindClick('btnbk', () => prev());
  bindClick('btnnx', () => next());
  bindClick('togglePresentationBtn', () => togglePres());
  bindClick('editBusinessBtn', () => editOb());
  bindClick('demoLangBtn', () => toggleDemoLang());
  bindClick('dlopt-pt', () => setDemoLang('pt'));
  bindClick('dlopt-es', () => setDemoLang('es'));
  bindClick('humanTakeoverBtn', () => toggleHumanTakeover());
  bindClick('shareConfigBtn', () => shareConfig());
  bindClick('resetChatBtn', () => resetChat());
  bindClick('exportChatBtn', () => exportChat());
  bindClick('resumeAiBtn', () => toggleHumanTakeover(false));
  bindClick('closeRepeatBannerBtn', () => {
    const banner = document.getElementById('repeatBanner');
    if(banner) banner.classList.remove('on');
  });
  bindClick('sendMessageBtn', () => send());
  bindClick('mystery-btn', () => runMystery());
  bindClick('exportChatSecondaryBtn', () => exportChat());
  bindClick('closeMovementOverlayBtn', () => {
    const overlay = document.getElementById('mov');
    if(overlay) overlay.style.display='none';
  });

  const input = document.getElementById('wai');
  if(input) input.addEventListener('keydown', hk);

  document.querySelectorAll('.star[data-rating]').forEach(star => {
    const rating = Number(star.getAttribute('data-rating'));
    star.addEventListener('click', () => rat(rating));
    star.addEventListener('keydown', event => {
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        rat(rating);
      }
    });
  });
}

const saved=localStorage.getItem('mercabot_ob');
if(saved)try{ob=Object.assign({}, DEFAULT_MERCABOT_OB, JSON.parse(saved));}catch(e){ob=Object.assign({}, DEFAULT_MERCABOT_OB);}
else ob=Object.assign({}, DEFAULT_MERCABOT_OB);
bindStaticDemoActions();
document.getElementById('mov').addEventListener('click',function(e){if(e.target===this)this.style.display='none';});
if(!loadFromURL())renderStep(0);

// ── Cloudflare Turnstile callbacks ──────────────────────────────
var turnstileToken = null;
var turnstileVerified = false;

function hasRealTurnstile(){
  return !!(TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY.trim());
}

function onTurnstileSuccess(token){
  turnstileToken = token;
  turnstileVerified = true;
}

function onTurnstileError(){
  // Don't block — fall back to rate limiting only
}

// Load Turnstile script for the guided activation flow
function initTurnstile(){
  if(!hasRealTurnstile()){
    var container=document.getElementById('turnstile-container');
    if(container) container.style.display='none';
    return;
  }
  var widget=document.querySelector('.cf-turnstile');
  if(widget) widget.setAttribute('data-sitekey', TURNSTILE_SITE_KEY);
  if(document.getElementById('cf-turnstile-script')) return;
  const s=document.createElement('script');
  s.id='cf-turnstile-script';
  s.src='https://challenges.cloudflare.com/turnstile/v0/api.js';
  s.async=true; s.defer=true;
  document.head.appendChild(s);
}