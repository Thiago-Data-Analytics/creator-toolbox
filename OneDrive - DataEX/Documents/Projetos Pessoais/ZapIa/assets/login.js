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
  var AUTH_HANDOFF_KEY='mb_auth_handoff_v1';

  function getDefaultPanelUrl(){
    return window.location.origin + '/painel-cliente/app/?continue=1';
  }

  function appendSessionHash(url, session){
    if(!session || !session.access_token || !session.refresh_token) return url;
    var target = String(url || '');
    var hashParts = [
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

  function setStatus(message,isError){
    var el=document.getElementById('authStatus');
    el.textContent=message||'';
    el.className='status' + (message ? ' show' : '') + (isError ? ' error' : '');
  }

  function showSessionChoice(email){
    document.getElementById('emailField').style.display='none';
    document.getElementById('authBtn').style.display='none';
    document.getElementById('sessionActions').classList.add('show');
    setStatus('Você já está conectado' + (email ? ' como ' + email : '') + '. Abra o painel ou entre com outro e-mail.', false);
  }

  function showEmailEntry(message,isError){
    document.getElementById('emailField').style.display='flex';
    document.getElementById('authBtn').style.display='inline-flex';
    document.getElementById('sessionActions').classList.remove('show');
    setStatus(message||'',!!isError);
  }

  function validateAuthEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());
  }

  function setEmailFieldState(hasError, message){
    var field = document.getElementById('emailField');
    var error = document.getElementById('authEmailError');
    if(field) field.classList.toggle('has-error', !!hasError);
    if(error && message) error.textContent = message;
  }

  async function sendMagicLink(){
    var email=document.getElementById('authEmail').value.trim().toLowerCase();
    var btn=document.getElementById('authBtn');
    if(!email){
      setEmailFieldState(true, 'Informe o e-mail da sua conta.');
      showEmailEntry('Informe o e-mail da sua conta.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setEmailFieldState(true, 'Informe um e-mail válido para continuar.');
      showEmailEntry('Use um e-mail válido para receber o link de acesso.', true);
      return;
    }
    setEmailFieldState(false, '');
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
      return;
    }
    btn.disabled=true;
    btn.style.opacity='.7';
    btn.textContent='Enviando...';
    showEmailEntry('Enviando link de acesso...', false);
    try{
      var otpResult=await supabaseClient.auth.signInWithOtp({
        email: email,
        options:{
          emailRedirectTo: window.location.origin + '/acesso/',
          shouldCreateUser: false
        }
      });
      if(otpResult && otpResult.error){
        showEmailEntry(otpResult.error.message || 'Não foi possível iniciar o acesso agora. Tente novamente em alguns minutos.', true);
        return;
      }
      showEmailEntry('Se o endereço informado puder receber acesso, enviaremos o link em instantes.', false);
    }catch(_err){
      showEmailEntry('Falha temporária ao solicitar o acesso. Tente novamente em alguns minutos.', true);
    }finally{
      btn.disabled=false;
      btn.style.opacity='1';
      btn.textContent='Enviar link de acesso';
    }
  }

  async function useAnotherAccount(){
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Sessão indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    await supabaseClient.auth.signOut();
    history.replaceState(null,'',window.location.origin + '/painel-cliente/app/');
    showEmailEntry('Sessão encerrada. Agora você pode entrar com outro e-mail.', false);
  }

  async function openPanelWithValidatedSession(){
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Sessão indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    setStatus('Validando seu acesso antes de abrir o painel...', false);
    try{
      var sessionResult=await supabaseClient.auth.getSession();
      var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if(!session || !session.user){
        await supabaseClient.auth.signOut();
        showEmailEntry('Sua sessão não estava válida. Peça um novo link para continuar.', true);
        return;
      }
      var userResult=await supabaseClient.auth.getUser();
      var user=userResult && userResult.data ? userResult.data.user : null;
      if(userResult && userResult.error || !user){
        await supabaseClient.auth.signOut();
        showEmailEntry('Sua sessão expirou. Peça um novo link para continuar.', true);
        return;
      }
      persistSessionHandoff(session);
      window.location.replace(appendSessionHash(getDefaultPanelUrl(), session));
    }catch(_){
      try{ await supabaseClient.auth.signOut(); }catch(__){}
      showEmailEntry('Não foi possível validar sua sessão agora. Peça um novo link para continuar.', true);
    }
  }

  async function init(){
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
      return;
    }
    var sessionResult=await supabaseClient.auth.getSession();
    var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
    if(session && session.user){
      try{
        var userResult = await supabaseClient.auth.getUser();
        var user = userResult && userResult.data ? userResult.data.user : null;
        if(user && !userResult.error){
          showSessionChoice(user.email || session.user.email || '');
          return;
        }
      }catch(_){}
      await supabaseClient.auth.signOut();
    }
    showEmailEntry('', false);
  }

  if(supabaseClient && supabaseClient.auth){
    supabaseClient.auth.onAuthStateChange(function(event, session){
      if(event === 'SIGNED_OUT'){
        showEmailEntry('Sessão encerrada. Agora você pode entrar com outro e-mail.', false);
        return;
      }
      if((event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && session.user){
        showSessionChoice(session.user.email || '');
      }
    });
    init();
  }else{
    showEmailEntry('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
  }

  var authBtnEl = document.getElementById('authBtn');
  if(authBtnEl) authBtnEl.addEventListener('click', sendMagicLink);
  var authEmailEl = document.getElementById('authEmail');
  if(authEmailEl) authEmailEl.addEventListener('input', function(){
    if(validateAuthEmail(this.value)) setEmailFieldState(false, '');
  });
  var useAnotherAccountBtnEl = document.getElementById('useAnotherAccountBtn');
  if(useAnotherAccountBtnEl) useAnotherAccountBtnEl.addEventListener('click', useAnotherAccount);
  var openPanelBtnEl = document.getElementById('openPanelBtn');
  if(openPanelBtnEl) openPanelBtnEl.addEventListener('click', openPanelWithValidatedSession);
})();
