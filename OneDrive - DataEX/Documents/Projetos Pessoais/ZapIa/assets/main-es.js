function togglePricingEs(isAnual) {
  var track = document.getElementById('toggle-track-es');
  var thumb = document.getElementById('toggle-thumb-es');
  var lblA  = document.getElementById('lbl-anual-es');
  var lblM  = document.getElementById('lbl-mensual');
  var comparePrice = document.getElementById('compare-price-mercabot-es');
  var compareNote = document.getElementById('compare-note-mercabot-es');
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
  if (isAnual) {
    track.style.background = 'var(--green)';
    thumb.style.left = '23px';
    lblA.style.color = 'var(--text)'; lblA.style.fontWeight = '600';
    lblM.style.color = 'var(--muted)'; lblM.style.fontWeight = '400';
    if (comparePrice) comparePrice.textContent = '$492 USD/año';
    if (compareNote) compareNote.textContent = 'Equivale a $41/mes · IA generativa real';
    renderPriceWithUnit('price-es-starter', '492', 'USD/año');
    renderPriceWithUnit('price-es-pro', '1.188', 'USD/año');
    renderPriceWithUnit('price-es-parceiro', '2.796', 'USD/año');
    ['starter','pro','parceiro'].forEach(function(p){
      document.getElementById('period-es-'+p).style.display = 'none';
      document.getElementById('saving-es-'+p).style.display = 'block';
    });
  } else {
    track.style.background = 'var(--border)';
    thumb.style.left = '3px';
    lblM.style.color = 'var(--text)'; lblM.style.fontWeight = '600';
    lblA.style.color = 'var(--muted)'; lblA.style.fontWeight = '400';
    if (comparePrice) comparePrice.textContent = '$49 USD/mes';
    if (compareNote) compareNote.textContent = 'IA generativa real';
    renderPriceWithUnit('price-es-starter', '49', 'USD');
    renderPriceWithUnit('price-es-pro', '119', 'USD');
    renderPriceWithUnit('price-es-parceiro', '279', 'USD');
    ['starter','pro','parceiro'].forEach(function(p){
      document.getElementById('period-es-'+p).style.display = 'block';
      document.getElementById('saving-es-'+p).style.display = 'none';
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

  function readHashParams(){
    return new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  }

  async function establishSessionFromUrl(){
    var query=new URLSearchParams(window.location.search);
    var hash=readHashParams();
    if(query.get('code') && supabaseClient.auth.exchangeCodeForSession){
      var exchangeResult=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
      if(exchangeResult && exchangeResult.error) throw exchangeResult.error;
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
    var panelId = 'faq-panel-es-' + (idx + 1);
    trigger.setAttribute('aria-controls', panelId);
    panel.id = panelId;
    panel.hidden = true;
  });

  var dismissBtn = document.getElementById('dismissBarBtn');
  if(dismissBtn) dismissBtn.addEventListener('click', dismissBar);

  var annualToggle = document.getElementById('toggle-anual-es');
  if(annualToggle) annualToggle.addEventListener('change', function(){ togglePricingEs(this.checked); });

  document.querySelectorAll('.faq-q').forEach(function(btn){
    btn.addEventListener('click', function(){ window.toggleFaq(btn); });
  });

})();