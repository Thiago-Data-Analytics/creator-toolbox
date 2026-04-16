(function detectLocale(){
        var DEMOS={br:{avatar:'🏪',name:'Loja da Maria',status:'online • pronta para atender',msgs:[
          {t:'recv',m:'Oi! Vocês têm vestido para festa junina? Preciso pra sábado 😅',time:'14:30'},
          {t:'sent',m:'Oi! 😊 Temos várias opções caipira e moderno. Qual você prefere?',time:'14:30'},
          {t:'recv',m:'Moderno! E tem no tamanho M?',time:'14:31'},
          {t:'sent',m:'Perfeito! 3 modelos no M para pronta entrega. Te mando as fotos? 🎀',time:'14:31'},
          {t:'recv',m:'Sim, por favor!',time:'14:31'},
          {t:'sent',m:'Aqui estão! 👗 Xadrez Rosa R$89, Floral Azul R$97 e Brasil R$79. Qual agradou?',time:'14:32'}
        ]},
        mx:{avatar:'👗',name:'Boutique Lupita',status:'en línea • lista para atender',msgs:[
          {t:'recv',m:'Hola! ¿Tienen vestidos para quinceañera? La fiesta es el próximo sábado 🎉',time:'14:30'},
          {t:'sent',m:'¡Hola! 😊 Tenemos corte princesa, moderno y con bordados. ¿Cuál prefieres?',time:'14:30'},
          {t:'recv',m:'El moderno, ¿en talla S?',time:'14:31'},
          {t:'sent',m:'¡Perfecto! 3 modelos en S listos. ¿Te mando fotos? 📸',time:'14:31'},
          {t:'recv',m:'Sí por favor!',time:'14:31'},
          {t:'sent',m:'¡Aquí van! 👗 Rosa Palo $890, Azul Cielo $990, Blanco Perla $850. ¿Cuál te gustó?',time:'14:32'}
        ]},
        ar:{avatar:'🥩',name:'Carnicería El Gaucho',status:'en línea • lista para atender',msgs:[
          {t:'recv',m:'Che, ¿tienen costillas para asado este finde? Para unas 10 personas 🔥',time:'14:30'},
          {t:'sent',m:'¡Hola! Sí, para 10 personas te recomendaría 4 kg de costillas. ¿Te aparto?',time:'14:30'},
          {t:'recv',m:'Sí, ¿y tienen vacío también?',time:'14:31'},
          {t:'sent',m:'¡Tenemos! Vacío $2.400/kg, costillas $1.800/kg. Fresquísimo. ¿A qué hora lo buscás? 🥩',time:'14:31'},
          {t:'recv',m:'El sábado a las 10am',time:'14:31'},
          {t:'sent',m:'Perfecto, te lo aparto. ¿A qué nombre? 😊',time:'14:32'}
        ]},
        es:{avatar:'👠',name:'Boutique Elena',status:'en línea • lista para atender',msgs:[
          {t:'recv',m:'Hola! ¿Tenéis vestidos de rebajas de verano? 😍',time:'14:30'},
          {t:'sent',m:'¡Hola! 😊 Rebajas al 30-50%: fiesta, casual y playa. ¿Qué ocasión buscas?',time:'14:30'},
          {t:'recv',m:'Para una boda, talla 38',time:'14:31'},
          {t:'sent',m:'¡Genial! 4 opciones en talla 38 para bodas. ¿Te mando fotos? 💃',time:'14:31'},
          {t:'recv',m:'Sí, por favor!',time:'14:31'},
          {t:'sent',m:'¡Aquí van! 👗 Azul Medianoche €89, Rosa Champán €95, Esmeralda €79. ¿Cuál te gusta?',time:'14:32'}
        ]},
        co:{avatar:'🌸',name:'Boutique Valentina',status:'en línea • lista para atender',msgs:[
          {t:'recv',m:'Buenas! ¿Tienen vestidos para matrimonio? Lo necesito para este fin de semana 😊',time:'14:30'},
          {t:'sent',m:'¡Hola! 😊 Tenemos largos, cóctel y casuales. ¿Cuál es su talla?',time:'14:30'},
          {t:'recv',m:'Talla M, algo elegante',time:'14:31'},
          {t:'sent',m:'¡5 opciones en talla M! Muy elegantes. ¿Le mando las fotos? 💐',time:'14:31'},
          {t:'recv',m:'Sí, mándeme',time:'14:31'},
          {t:'sent',m:'¡Acá van! 👗 Rojo carmesí $285.000, Azul petróleo $310.000, Dorado $295.000. ¿Cuál le gusta? 😊',time:'14:32'}
        ]}};
        function locale(){
          var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
          var lang=(navigator.language||'pt-BR').toLowerCase();
          if(tz.includes('Bogota')||tz.includes('Colombia'))return'co';
          if(tz.includes('Argentina')||tz.includes('Buenos_Aires'))return'ar';
          if(tz.includes('Mexico')||tz.includes('Mexico_City'))return'mx';
          if(tz.includes('Madrid')||tz.includes('Europe/Madrid'))return'es';
          if(lang.startsWith('es-mx'))return'mx';
          if(lang.startsWith('es-ar'))return'ar';
          if(lang.startsWith('es-co'))return'co';
          if(lang.startsWith('es-es'))return'es';
          if(lang.startsWith('es'))return'mx';
          return'br';
        }
        function render(loc){
          var d=DEMOS[loc]||DEMOS.br;
          var av=document.getElementById('demo-avatar');
          var nm=document.getElementById('demo-name');
          var st=document.getElementById('demo-status');
          var bd=document.getElementById('demo-body');
          if(av)av.textContent=d.avatar;
          if(nm)nm.textContent=d.name;
          if(st)st.textContent=d.status;
          if(bd){
            bd.textContent='';
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
            var typing=document.createElement('div');
            typing.className='typing';
            for(var i=0;i<3;i+=1){typing.appendChild(document.createElement('span'));}
            bd.appendChild(typing);
          }
        }
        document.addEventListener('DOMContentLoaded',function(){render(locale());});
      })();

(function(){
  var SUPABASE_URL='https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY='sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
  var supabaseFactory=
    window.supabase && typeof window.supabase.createClient==='function'
      ? window.supabase.createClient
      : (window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function'
          ? window.supabase.supabase.createClient
          : null);
  if(!supabaseFactory) return;

  var supabaseClient=supabaseFactory(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

  function readHashParams(){
    return new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  }

  function hasAuthCallbackPayload(){
    var query=new URLSearchParams(window.location.search);
    var hash=readHashParams();
    return !!(
      query.get('code') ||
      query.get('token_hash') ||
      hash.get('access_token') ||
      hash.get('refresh_token') ||
      hash.get('error') ||
      hash.get('error_code') ||
      hash.get('error_description')
    );
  }

  function redirectAuthCallbackToAccess(){
    var target='/acesso/';
    var query=window.location.search || '';
    var hash=window.location.hash || '';
    window.location.replace(window.location.origin + target + query + hash);
  }

  async function establishSessionFromUrl(){
    var query=new URLSearchParams(window.location.search);
    var hash=readHashParams();
    if(query.get('code') && supabaseClient.auth.exchangeCodeForSession){
      var exchangeResult=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
      if(exchangeResult && exchangeResult.error) throw exchangeResult.error;
    } else if(query.get('token_hash') && query.get('type') && supabaseClient.auth.verifyOtp){
      var verifyResult=await supabaseClient.auth.verifyOtp({
        token_hash: query.get('token_hash'),
        type: query.get('type')
      });
      if(verifyResult && verifyResult.error) throw verifyResult.error;
    } else if(hash.get('access_token') && hash.get('refresh_token') && supabaseClient.auth.setSession){
      var setResult=await supabaseClient.auth.setSession({
        access_token: hash.get('access_token'),
        refresh_token: hash.get('refresh_token')
      });
      if(setResult && setResult.error) throw setResult.error;
    } else {
      return null;
    }
    history.replaceState(null,'',window.location.origin + '/acesso/');
    return true;
  }

  async function resolveDestination(session){
    if(!session || !session.access_token || !session.user) return '/painel-cliente/app/?continue=1';
    var headers={
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': 'Bearer ' + session.access_token
    };
    try{
      var userId=encodeURIComponent(session.user.id);
      var profileRes=await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + userId + '&select=role&limit=1',{headers:headers});
      var customerRes=await fetch(SUPABASE_URL + '/rest/v1/customers?user_id=eq.' + userId + '&select=plan_code&limit=1',{headers:headers});
      var profileData=profileRes.ok ? await profileRes.json() : [];
      var customerData=customerRes.ok ? await customerRes.json() : [];
      var role=profileData && profileData[0] ? String(profileData[0].role || '').toLowerCase() : '';
      var planCode=customerData && customerData[0] ? String(customerData[0].plan_code || '').toLowerCase() : '';
      if(role === 'partner' || role === 'parceiro' || planCode === 'parceiro'){
        return '/painel-parceiro/';
      }
    }catch(_){}
    return '/painel-cliente/app/?continue=1';
  }

  (async function(){
    try{
      if(hasAuthCallbackPayload()){
        redirectAuthCallbackToAccess();
        return;
      }
      var handled=await establishSessionFromUrl();
      if(!handled) return;
      var sessionResult=await supabaseClient.auth.getSession();
      var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if(!session || !session.user){
        window.location.replace('/acesso/');
        return;
      }
      var destination=await resolveDestination(session);
      window.location.replace(destination);
    }catch(_){
      window.location.replace('/acesso/');
    }
  })();
})();

(function(){
  function dismissBar(){
    var bar = document.getElementById('camp-bar');
    if(bar) bar.style.display = 'none';
  }

  var PRICES = {
    mensal: {
      starter: { val: '197', period: 'por mês' },
      pro: { val: '497', period: 'por mês' },
      parceiro: { val: '1.297', period: 'por mês' }
    },
    anual: {
      starter: { val: '1.968', period: 'por ano', saving: 'Equivale a R$164/mês · Economia de R$396/ano' },
      pro: { val: '4.968', period: 'por ano', saving: 'Equivale a R$414/mês · Economia de R$996/ano' },
      parceiro: { val: '12.972', period: 'por ano', saving: 'Equivale a R$1.081/mês · Economia de R$2.592/ano' }
    }
  };

  window.togglePricing = function(isAnual){
    var prices = isAnual ? PRICES.anual : PRICES.mensal;
    var track = document.getElementById('toggle-track');
    var thumb = document.getElementById('toggle-thumb');
      var lblAnual = document.getElementById('lbl-anual');
      var lblMensal = document.getElementById('lbl-mensal');
      var comparePrice = document.getElementById('compare-price-mercabot');
      var compareNote = document.getElementById('compare-note-mercabot');
    function renderPrice(el, prefix, value){
      if(!el) return;
      el.textContent = '';
      var sup = document.createElement('sup');
      sup.textContent = prefix;
      el.appendChild(sup);
      el.appendChild(document.createTextNode(value));
    }

    if(track) track.style.background = isAnual ? 'var(--green)' : 'var(--border)';
    if(thumb) thumb.style.left = isAnual ? '23px' : '3px';
    if(lblAnual){
      lblAnual.style.color = isAnual ? 'var(--text)' : 'var(--muted)';
      lblAnual.style.fontWeight = isAnual ? '600' : '400';
    }
      if(lblMensal){
        lblMensal.style.color = isAnual ? 'var(--muted)' : 'var(--text)';
        lblMensal.style.fontWeight = isAnual ? '400' : '600';
      }
      if(comparePrice) comparePrice.textContent = isAnual ? 'R$1.968/ano' : 'R$197/mês';
      if(compareNote) compareNote.textContent = isAnual ? 'Equivale a R$164/mês · IA generativa real' : 'IA generativa real';

    ['starter','pro','parceiro'].forEach(function(plan){
      var data = prices[plan];
      var priceEl = document.getElementById('price-' + plan);
      var periodEl = document.getElementById('period-' + plan);
      var savingEl = document.getElementById('saving-' + plan);
      var ctaEl = document.querySelector('#plan-cta-' + plan + ', a[href*="plano=' + plan + '"]');
      if(!data) return;
      if(priceEl) renderPrice(priceEl, 'R$', data.val);
      if(periodEl) periodEl.textContent = data.period;
      if(savingEl){
        savingEl.textContent = data.saving || '';
        savingEl.style.display = isAnual && data.saving ? 'block' : 'none';
      }
      if(ctaEl && ctaEl.href){
        var url = new URL(ctaEl.href, window.location.href);
        if(isAnual) url.searchParams.set('periodo', 'anual');
        else url.searchParams.delete('periodo');
        ctaEl.href = url.toString();
      }
    });
  };

  window.toggleFaq = function(btn){
    var item = btn.closest('.faq-item') || btn.parentElement;
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(el){
      el.classList.remove('open');
      var panel = el.querySelector('.faq-a');
      var trigger = el.querySelector('.faq-q');
      if(panel) panel.style.maxHeight = '0';
      if(panel) panel.hidden = true;
      if(trigger) trigger.setAttribute('aria-expanded', 'false');
    });
    if(!isOpen){
      item.classList.add('open');
      var panel = item.querySelector('.faq-a');
      if(panel) panel.style.maxHeight = panel.scrollHeight + 'px';
      if(panel) panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
  };

  document.querySelectorAll('.faq-item').forEach(function(item, idx){
    var trigger = item.querySelector('.faq-q');
    var panel = item.querySelector('.faq-a');
    if(!trigger || !panel) return;
    var panelId = 'faq-panel-' + (idx + 1);
    trigger.setAttribute('aria-controls', panelId);
    panel.id = panelId;
    panel.hidden = true;
  });

  var dismissBtn = document.getElementById('dismissBarBtn');
  if(dismissBtn) dismissBtn.addEventListener('click', dismissBar);

  var annualToggle = document.getElementById('toggle-anual');
  if(annualToggle) annualToggle.addEventListener('change', function(){ window.togglePricing(this.checked); });

  document.querySelectorAll('.faq-q').forEach(function(btn){
    btn.addEventListener('click', function(){ window.toggleFaq(btn); });
  });

  document.addEventListener('keydown', function(e){
  });
})();

/* ─── Hamburger menu ─────────────────────────────────────── */
(function(){
  var burger = document.getElementById('navBurger');
  var navEl = document.querySelector('nav');
  var links = document.querySelectorAll('.nav-links a');
  if(!burger || !navEl) return;
  function closeMenu(){
    navEl.classList.remove('nav-open');
    burger.setAttribute('aria-expanded','false');
    burger.setAttribute('aria-label','Abrir menu');
  }
  burger.addEventListener('click', function(){
    var open = navEl.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  });
  links.forEach(function(a){ a.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', function(e){
    if(navEl.classList.contains('nav-open') && !navEl.contains(e.target)) closeMenu();
  });
})();

/* STICKY CTA — aparece ao rolar além do hero, some no final CTA */
(function(){
  var btn = document.getElementById('sticky-cta');
  var hero = document.querySelector('.hero');
  var finalCta = document.querySelector('.final-cta');
  if(!btn || !hero) return;
  function update(){
    var heroBottom = hero.getBoundingClientRect().bottom;
    var finalTop = finalCta ? finalCta.getBoundingClientRect().top : Infinity;
    var show = heroBottom < 0 && finalTop > window.innerHeight;
    btn.classList.toggle('show', show);
  }
  window.addEventListener('scroll', update, {passive:true});
  update();
})();

(function(){
  if(!('IntersectionObserver' in window)) {
    document.querySelectorAll('.fade-up').forEach(function(el){ el.classList.add('visible'); });
    return;
  }
  var obs = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, {threshold: 0.1, rootMargin: '0px 0px -40px 0px'});

  /* Auto-animate section titles, steps, cards */
  document.querySelectorAll(
    '.fade-up, .step, .usecase, .testi, .plan, .security-card-hover, .section-title, .section-sub'
  ).forEach(function(el){
    if(!el.classList.contains('fade-up')){
      el.classList.add('fade-up');
    }
    obs.observe(el);
  });
})();