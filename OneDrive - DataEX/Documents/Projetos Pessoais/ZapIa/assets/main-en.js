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
  function readHashParams(){return new URLSearchParams(String(window.location.hash||'').replace(/^#/,''));}
  async function establishSessionFromUrl(){
    var query=new URLSearchParams(window.location.search);
    var hash=readHashParams();
    if(query.get('code')&&supabaseClient.auth.exchangeCodeForSession){
      var r=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
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
  function dismissBar(){var b=document.getElementById('camp-bar');if(b)b.style.display='none';}
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
      if(p){p.style.maxHeight=p.scrollHeight+'px';p.hidden=false;}
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
  var dismissBtn=document.getElementById('dismissBarBtn');
  if(dismissBtn)dismissBtn.addEventListener('click',dismissBar);
  var toggleEl=document.getElementById('toggle-annual-en');
  if(toggleEl)toggleEl.addEventListener('change',function(){togglePricingEn(this.checked);});
})();