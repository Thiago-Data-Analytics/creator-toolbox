(function(){
  var SUPABASE_URL='https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY='sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
  var supabaseFactory=
    window.supabase && typeof window.supabase.createClient==='function'
      ? window.supabase.createClient
      : (window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function'
          ? window.supabase.supabase.createClient
          : null);
  var supabaseClient=supabaseFactory ? supabaseFactory(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY) : null;
  var statusEl=document.getElementById('status');
  var primaryActionEl=document.getElementById('primaryAction');
  var AUTH_HANDOFF_KEY='mb_auth_handoff_v1';

  function setStatus(msg,isError){
    statusEl.textContent=msg;
    statusEl.className=isError ? 'status error' : 'status';
  }

  function getDefaultPanelUrl(){
    return '/painel-cliente/app/?continue=1';
  }

  function updatePrimaryAction(url,label){
    if(!primaryActionEl) return;
    primaryActionEl.href=url;
    primaryActionEl.textContent=label || 'Ir para o painel';
  }

  function appendSessionHash(url, session){
    if(!session || !session.access_token || !session.refresh_token) return url;
    var target=String(url || '');
    var hashParts=[
      'access_token=' + encodeURIComponent(session.access_token),
      'refresh_token=' + encodeURIComponent(session.refresh_token)
    ];
    if(session.token_type) hashParts.push('token_type=' + encodeURIComponent(session.token_type));
    if(session.expires_at) hashParts.push('expires_at=' + encodeURIComponent(session.expires_at));
    return target + '#' + hashParts.join('&');
  }

  function persistSessionHandoff(session){
    if(!session || !session.access_token || !session.refresh_token) return;
    try{
      window.localStorage.setItem(AUTH_HANDOFF_KEY, JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: session.token_type || '',
        expires_at: session.expires_at || '',
        stored_at: Date.now()
      }));
    }catch(_){}
  }

  function redirectTo(url, session){
    var target=url || getDefaultPanelUrl();
    updatePrimaryAction(target, target.indexOf('/painel-parceiro') === 0 ? 'Ir para a área do parceiro' : 'Ir para o painel');
    window.location.replace(appendSessionHash(target, session));
  }

  function readHashParams(){
    return new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  }

  function getAuthErrorFromUrl(){
    var hash=readHashParams();
    var error=hash.get('error') || '';
    var code=hash.get('error_code') || '';
    var description=hash.get('error_description') || '';
    if(!error && !code && !description) return '';
    var normalizedDescription=String(description || '').replace(/\+/g,' ').trim();
    if(code === 'otp_expired' || /expired/i.test(normalizedDescription)){
      return 'Este link expirou. Peça um novo link para continuar.';
    }
    if(error === 'access_denied'){
      return normalizedDescription || 'Não foi possível concluir o acesso por este link. Peça um novo link para continuar.';
    }
    return normalizedDescription || 'Não foi possível concluir o acesso agora. Peça um novo link para continuar.';
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
    }

    if(window.location.search || window.location.hash){
      history.replaceState(null,'',window.location.origin + window.location.pathname);
    }
  }

  async function resolveDestination(session){
    if(!session || !session.access_token || !session.user){
      return getDefaultPanelUrl();
    }
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
    }catch(_){ }
    return getDefaultPanelUrl();
  }

  (async function(){
    if(!supabaseClient || !supabaseClient.auth){
      setStatus('A autenticacao nao carregou corretamente. Peca um novo link para continuar.', true);
      return;
    }

    try{
      var authError=getAuthErrorFromUrl();
      if(authError){
        history.replaceState(null,'',window.location.origin + window.location.pathname);
        setStatus(authError, true);
        return;
      }
      await establishSessionFromUrl();
      var sessionResult=await supabaseClient.auth.getSession();
      var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if(session && session.user){
        var destination=await resolveDestination(session);
        persistSessionHandoff(session);
        setStatus('Acesso confirmado. Redirecionando...');
        redirectTo(destination, session);
        return;
      }

      supabaseClient.auth.onAuthStateChange(async function(event,nextSession){
        if((event==='SIGNED_IN' || event==='TOKEN_REFRESHED' || event==='INITIAL_SESSION') && nextSession && nextSession.user){
          var target=await resolveDestination(nextSession);
          persistSessionHandoff(nextSession);
          setStatus('Acesso confirmado. Redirecionando...');
          redirectTo(target, nextSession);
        }
      });

      setStatus('Nao foi possivel concluir o acesso automaticamente por este link. Peca um novo link para continuar.', true);
    }catch(_){
      setStatus('Nao foi possivel concluir o acesso agora. Peca um novo link para continuar.', true);
    }
  })();
})();
