/* ── Auth callback redirect ─────────────────────────── */
(function(){
  function hasAuthCallbackPayload(){
    var query=new URLSearchParams(window.location.search);
    var hash=new URLSearchParams(String(window.location.hash||'').replace(/^#/,''));
    return !!(query.get('code')||query.get('token_hash')||hash.get('access_token')||hash.get('refresh_token')||hash.get('error')||hash.get('error_code'));
  }
  function redirectAuthCallbackToAccess(){
    window.location.replace(window.location.origin+'/acesso/'+window.location.search+window.location.hash);
  }
  if(hasAuthCallbackPayload()) redirectAuthCallbackToAccess();
})();

(function(){
  var DEMOS=[
    {avatar:'🍕',name:"Tony's Pizzeria",status:'online • ready to serve',msgs:[
      {t:'recv',m:'Are you still open? I really want a pizza 🙏',time:'11:02 PM'},
      {t:'sent',m:"We're open until midnight! 🍕 Pepperoni, BBQ Chicken, Margherita or Four Cheese — what's your pick?",time:'11:02 PM'},
      {t:'recv',m:'BBQ Chicken, large please',time:'11:03 PM'},
      {t:'sent',m:'Large is $18. Want stuffed crust for +$3? 🧀',time:'11:03 PM'},
      {t:'recv',m:'Yes! 123 Maple Street',time:'11:04 PM'},
      {t:'sent',m:'Order confirmed! Delivery in ~40 min. Cash, card or Apple Pay?',time:'11:04 PM'}
    ]},
    {avatar:'🦷',name:'SmileCare Dental',status:'online • ready to serve',msgs:[
      {t:'recv',m:'Do you do teeth whitening? How much does it cost?',time:'11:08 AM'},
      {t:'sent',m:'We do! 😁 Laser whitening $350 or custom tray $190. Want quick results or a lower cost?',time:'11:08 AM'},
      {t:'recv',m:'Quicker. But is it painful?',time:'11:09 AM'},
      {t:'sent',m:"Most patients feel no pain — we use topical anesthetic gel. Want a free evaluation before you decide?",time:'11:09 AM'},
      {t:'recv',m:'Free? Yes, I want that!',time:'11:10 AM'},
      {t:'sent',m:'Great! Thursday at 3 PM or Friday at 9 AM — which works for you? 🦷',time:'11:10 AM'}
    ]},
    {avatar:'💪',name:'FitZone Gym',status:'online • ready to serve',msgs:[
      {t:'recv',m:'Hi! Can you tell me about your membership plans?',time:'7:31 AM'},
      {t:'sent',m:'Good morning! 💪 Monthly $49 · Quarterly $39/mo · Annual $29/mo. Weights, classes & pool included. Any specific goal?',time:'7:31 AM'},
      {t:'recv',m:'I want to lose weight. Which plan do you recommend?',time:'7:32 AM'},
      {t:'sent',m:'For weight loss the Quarterly plan is ideal — enough time to see real results plus a personal trainer included. Want a free trial class first?',time:'7:32 AM'},
      {t:'recv',m:'Sure! When can I come in?',time:'7:33 AM'},
      {t:'sent',m:'Today at 6 PM or tomorrow at 7 AM. No commitment needed 😊',time:'7:33 AM'}
    ]}
  ];
  var cur=0,timer=null,paused=false;
  function render(idx){
    var d=DEMOS[idx];
    var av=document.getElementById('demo-avatar');
    var nm=document.getElementById('demo-name');
    var st=document.getElementById('demo-status');
    var bd=document.getElementById('demo-body');
    if(!bd)return;
    bd.style.opacity='0';
    setTimeout(function(){
      if(av)av.textContent=d.avatar;
      if(nm)nm.textContent=d.name;
      if(st)st.textContent=d.status;
      bd.innerHTML='';
      d.msgs.forEach(function(m){
        var msg=document.createElement('div');
        msg.className='wamsg '+m.t;
        msg.appendChild(document.createTextNode(m.m+' '));
        var time=document.createElement('span');
        time.className='time';
        time.textContent=m.time;
        msg.appendChild(time);
        bd.appendChild(msg);
      });
      var typ=document.createElement('div');
      typ.className='typing';
      for(var i=0;i<3;i++)typ.appendChild(document.createElement('span'));
      bd.appendChild(typ);
      bd.scrollTop=0;
      bd.style.opacity='1';
      document.querySelectorAll('.demo-dot').forEach(function(dot,i){dot.classList.toggle('active',i===idx);});
    },220);
  }
  function next(){cur=(cur+1)%DEMOS.length;render(cur);}
  function tick(){if(!paused)next();}
  function goTo(idx){cur=idx;render(cur);clearInterval(timer);timer=setInterval(tick,6000);}
  function init(){
    var bd=document.getElementById('demo-body');
    if(bd)bd.style.transition='opacity .22s';
    var dots=document.getElementById('demo-dots');
    if(dots){
      dots.innerHTML='';
      DEMOS.forEach(function(_,i){
        var btn=document.createElement('button');
        btn.type='button';btn.className='demo-dot'+(i===0?' active':'');
        btn.setAttribute('aria-label','Demo '+(i+1));
        btn.addEventListener('click',function(){goTo(i);});
        dots.appendChild(btn);
      });
    }
    var phone=document.querySelector('.hero-phone-right .phone')||document.querySelector('.phone-wrap .phone');
    if(phone){
      phone.addEventListener('mouseenter',function(){paused=true;});
      phone.addEventListener('mouseleave',function(){paused=false;});
    }
    render(0);
    timer=setInterval(tick,6000);
  }
  document.addEventListener('DOMContentLoaded',init);
})();

function togglePricingEn(isAnnual) {
  var track = document.getElementById('toggle-track-en');
  var thumb = document.getElementById('toggle-thumb-en');
  var lblA  = document.getElementById('lbl-annual-en');
  var lblM  = document.getElementById('lbl-monthly');
  var comparePrice = document.getElementById('compare-price-mercabot-en');
  var compareNote = document.getElementById('compare-note-mercabot-en');
  function renderPriceWithUnit(id, value, unit) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    var sup = document.createElement('sup');
    sup.textContent = '$';
    var small = document.createElement('small');
    small.style.fontSize = '.9rem';
    small.textContent = unit;
    el.appendChild(sup);
    el.appendChild(document.createTextNode(value + ' '));
    el.appendChild(small);
  }
  if (isAnnual) {
    track.style.background = 'var(--green)';
    thumb.style.left = '23px';
    lblA.style.color = 'var(--text)'; lblA.style.fontWeight = '600';
    lblM.style.color = 'var(--muted)'; lblM.style.fontWeight = '400';
    if (comparePrice) comparePrice.textContent = '$492 USD/year';
    if (compareNote) compareNote.textContent = 'Equals $41/mo · Real generative AI';
    renderPriceWithUnit('price-en-starter', '492', 'USD/year');
    renderPriceWithUnit('price-en-pro', '1,188', 'USD/year');
    renderPriceWithUnit('price-en-partner', '2,796', 'USD/year');
    ['starter','pro','partner'].forEach(function(p){
      document.getElementById('period-en-'+p).style.display = 'none';
      document.getElementById('saving-en-'+p).style.display = 'block';
    });
  } else {
    track.style.background = 'var(--border)';
    thumb.style.left = '3px';
    lblM.style.color = 'var(--text)'; lblM.style.fontWeight = '600';
    lblA.style.color = 'var(--muted)'; lblA.style.fontWeight = '400';
    if (comparePrice) comparePrice.textContent = '$49 USD/mo';
    if (compareNote) compareNote.textContent = 'Real generative AI';
    renderPriceWithUnit('price-en-starter', '49', 'USD');
    renderPriceWithUnit('price-en-pro', '119', 'USD');
    renderPriceWithUnit('price-en-partner', '279', 'USD');
    ['starter','pro','partner'].forEach(function(p){
      document.getElementById('period-en-'+p).style.display = 'block';
      document.getElementById('saving-en-'+p).style.display = 'none';
    });
  }
}

(function(){
  var SUPABASE_URL=(window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY=(window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
  var supabaseFactory=
    window.supabase && typeof window.supabase.createClient==='function'
      ? window.supabase.createClient
      : (window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function'
          ? window.supabase.supabase.createClient
          : null);
  if(!supabaseFactory) return;
  var supabaseClient=supabaseFactory(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  function readHashParams(){return new URLSearchParams(String(window.location.hash||'').replace(/^#/,''));}
  async function establishSessionFromUrl(){
    var query=new URLSearchParams(window.location.search);
    var hash=readHashParams();
    if(query.get('code')&&supabaseClient.auth.exchangeCodeForSession){
      var r=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
      if(r&&r.error)throw r.error;
    } else if(query.get('token_hash')&&query.get('type')&&supabaseClient.auth.verifyOtp){
      var r=await supabaseClient.auth.verifyOtp({token_hash:query.get('token_hash'),type:query.get('type')});
      if(r&&r.error)throw r.error;
    }else if(hash.get('access_token')&&hash.get('refresh_token')&&supabaseClient.auth.setSession){
      var r=await supabaseClient.auth.setSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token')});
      if(r&&r.error)throw r.error;
    }else{return null;}
    history.replaceState(null,'',window.location.origin+'/acesso/');
    return true;
  }
  async function resolveDestination(session){
    if(!session||!session.access_token||!session.user)return'/painel-cliente/app/?continue=1';
    var headers={'apikey':SUPABASE_PUBLISHABLE_KEY,'Authorization':'Bearer '+session.access_token};
    try{
      var uid=encodeURIComponent(session.user.id);
      var pRes=await fetch(SUPABASE_URL+'/rest/v1/profiles?id=eq.'+uid+'&select=role&limit=1',{headers:headers});
      var cRes=await fetch(SUPABASE_URL+'/rest/v1/customers?user_id=eq.'+uid+'&select=plan_code&limit=1',{headers:headers});
      var pData=pRes.ok?await pRes.json():[];
      var cData=cRes.ok?await cRes.json():[];
      var role=pData&&pData[0]?String(pData[0].role||'').toLowerCase():'';
      var plan=cData&&cData[0]?String(cData[0].plan_code||'').toLowerCase():'';
      if(role==='partner'||role==='parceiro'||plan==='parceiro')return'/painel-parceiro/';
    }catch(_){}
    return'/painel-cliente/app/?continue=1';
  }
  (async function(){
    try{
      var handled=await establishSessionFromUrl();
      if(!handled)return;
      var sr=await supabaseClient.auth.getSession();
      var session=sr&&sr.data?sr.data.session:null;
      if(!session||!session.user){window.location.replace('/acesso/');return;}
      window.location.replace(await resolveDestination(session));
    }catch(_){window.location.replace('/acesso/');}
  })();
})();

(function(){

  window.toggleFaq=function(btn){
    var item=btn.closest('.faq-item')||btn.parentElement;
    var isOpen=item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(el){
      el.classList.remove('open');
      var p=el.querySelector('.faq-a');var t=el.querySelector('.faq-q');
      if(p){p.style.maxHeight='0';p.hidden=true;}
      if(t)t.setAttribute('aria-expanded','false');
    });
    if(!isOpen){
      item.classList.add('open');
      var p=item.querySelector('.faq-a');
      if(p){p.hidden=false;p.style.maxHeight=p.scrollHeight+'px';}
      btn.setAttribute('aria-expanded','true');
    }
  };
  document.querySelectorAll('.faq-item').forEach(function(item,idx){
    var trigger=item.querySelector('.faq-q');
    var panel=item.querySelector('.faq-a');
    if(!trigger||!panel)return;
    var panelId='faq-panel-en-'+(idx+1);
    trigger.setAttribute('aria-controls',panelId);
    panel.id=panelId;
    panel.hidden=true;
    trigger.addEventListener('click',function(){window.toggleFaq(this);});
  });

  var toggleEl=document.getElementById('toggle-annual-en');
  if(toggleEl)toggleEl.addEventListener('change',function(){togglePricingEn(this.checked);});
})();

/* ── Hamburger menu ───────────────────────────────── */
(function(){
  var burger=document.getElementById('navBurger');
  var navEl=document.querySelector('nav');
  var links=document.querySelectorAll('.nav-links a');
  if(!burger||!navEl)return;
  function closeMenu(){navEl.classList.remove('nav-open');burger.setAttribute('aria-expanded','false');burger.setAttribute('aria-label','Open menu');}
  burger.addEventListener('click',function(){
    var open=navEl.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded',open?'true':'false');
    burger.setAttribute('aria-label',open?'Close menu':'Open menu');
  });
  links.forEach(function(a){a.addEventListener('click',closeMenu);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenu();});
  document.addEventListener('click',function(e){if(navEl.classList.contains('nav-open')&&!navEl.contains(e.target))closeMenu();});
})();

/* ── Sticky CTA ───────────────────────────────────── */
(function(){
  var btn=document.getElementById('sticky-cta');
  var hero=document.querySelector('.hero');
  var finalCta=document.querySelector('.final-cta');
  if(!btn||!hero)return;
  function update(){
    var heroBottom=hero.getBoundingClientRect().bottom;
    var finalTop=finalCta?finalCta.getBoundingClientRect().top:Infinity;
    btn.classList.toggle('show',heroBottom<0&&finalTop>window.innerHeight);
  }
  window.addEventListener('scroll',update,{passive:true});
  update();
})();

/* ── Fade-up animations ───────────────────────────── */
(function(){
  if(!('IntersectionObserver' in window)){document.querySelectorAll('.fade-up').forEach(function(el){el.classList.add('visible');});return;}
  var obs=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('visible');obs.unobserve(entry.target);}});},{threshold:0.1,rootMargin:'0px 0px -40px 0px'});
  document.querySelectorAll('.fade-up,.step,.usecase,.plan,.security-card-hover,.section-title,.section-sub').forEach(function(el){if(!el.classList.contains('fade-up'))el.classList.add('fade-up');obs.observe(el);});
})();