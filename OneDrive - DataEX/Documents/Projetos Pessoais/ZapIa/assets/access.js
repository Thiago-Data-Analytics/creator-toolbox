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
  var accessEmailField=document.getElementById('accessEmailField');
  var accessOtpField=document.getElementById('accessOtpField');
  var accessOtpBtn=document.getElementById('accessOtpBtn');

  function setStatus(msg,isError){
    statusEl.textContent=msg;
    statusEl.className=isError ? 'status error' : 'status';
  }

  function setFieldError(fieldEl,errorEl,hasError,message){
    if(fieldEl) fieldEl.classList.toggle('has-error', !!hasError);
    if(errorEl && message) errorEl.textContent=message;
  }

  function showOtpFallback(message,isError,prefillEmail){
    if(accessEmailField) accessEmailField.classList.add('show');
    if(accessOtpField) accessOtpField.classList.add('show');
    if(accessOtpBtn) accessOtpBtn.classList.add('show');
    if(primaryActionEl) primaryActionEl.textContent='Ir para o painel';
    if(prefillEmail){
      var emailInput=document.getElementById('accessEmail');
      if(emailInput && !emailInput.value) emailInput.value=String(prefillEmail || '').trim().toLowerCase();
    }
    setStatus(message,isError);
  }

  function normalizeOtpCode(raw){
    return String(raw || '').replace(/\D/g,'').trim();
  }

  function validateAuthEmail(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());
  }

  function getDefaultPanelUrl(){
    return '/painel-cliente/app/?continue=1';
  }

  function updatePrimaryAction(url,label){
    if(!primaryActionEl) return;
    primaryActionEl.href=url;
    primaryActionEl.textContent=label || 'Ir para o painel';
  }

  function redirectTo(url){
    var target=url || getDefaultPanelUrl();
    updatePrimaryAction(target, target.indexOf('/painel-parceiro') === 0 ? 'Ir para a área do parceiro' : 'Ir para o painel');
    window.location.replace(target);
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
    var shouldCleanUrl = false;

    if(query.get('code') && supabaseClient.auth.exchangeCodeForSession){
      var exchangeResult=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
      if(exchangeResult && exchangeResult.error) throw exchangeResult.error;
      shouldCleanUrl = true;
    } else if(query.get('token_hash') && query.get('type') && supabaseClient.auth.verifyOtp){
      var verifyResult=await supabaseClient.auth.verifyOtp({
        token_hash: query.get('token_hash'),
        type: query.get('type')
      });
      if(verifyResult && verifyResult.error) throw verifyResult.error;
      shouldCleanUrl = true;
    }

    if(shouldCleanUrl || window.location.search || window.location.hash){
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

  async function verifyOtpCode(email, token){
    var attempt=await supabaseClient.auth.verifyOtp({
      email: email,
      token: token,
      type: 'email'
    });
    if(!attempt || !attempt.error) return attempt;
    return await supabaseClient.auth.verifyOtp({
      email: email,
      token: token,
      type: 'magiclink'
    });
  }

  async function submitOtpFallback(){
    var emailInput=document.getElementById('accessEmail');
    var otpInput=document.getElementById('accessOtp');
    var email=emailInput ? emailInput.value.trim().toLowerCase() : '';
    var token=normalizeOtpCode(otpInput ? otpInput.value : '');
    if(!email){
      setFieldError(accessEmailField, document.getElementById('accessEmailError'), true, 'Informe o e-mail da sua conta.');
      showOtpFallback('Informe o e-mail usado para receber o código.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setFieldError(accessEmailField, document.getElementById('accessEmailError'), true, 'Informe um e-mail válido.');
      showOtpFallback('Use o mesmo e-mail que recebeu o código.', true);
      return;
    }
    if(!token || token.length < 6){
      setFieldError(accessOtpField, document.getElementById('accessOtpError'), true, 'Informe o código enviado por e-mail.');
      showOtpFallback('Cole o código de acesso para continuar.', true, email);
      return;
    }
    setFieldError(accessEmailField, document.getElementById('accessEmailError'), false, '');
    setFieldError(accessOtpField, document.getElementById('accessOtpError'), false, '');
    if(accessOtpBtn){
      accessOtpBtn.disabled=true;
      accessOtpBtn.style.opacity='.7';
      accessOtpBtn.textContent='Entrando...';
    }
    try{
      var otpResult=await verifyOtpCode(email, token);
      if(otpResult && otpResult.error){
        showOtpFallback('Não foi possível validar esse código. Peça um novo acesso e tente novamente.', true, email);
        return;
      }
      var sessionResult=await supabaseClient.auth.getSession();
      var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if(session && session.user){
        var target=await resolveDestination(session);
        setStatus('Acesso confirmado. Redirecionando...');
        redirectTo(target);
        return;
      }
      showOtpFallback('O código foi aceito, mas a sessão não ficou disponível. Peça um novo acesso.', true, email);
    }catch(_){
      showOtpFallback('Falha temporária ao validar o código. Tente novamente ou peça um novo acesso.', true, email);
    }finally{
      if(accessOtpBtn){
        accessOtpBtn.disabled=false;
        accessOtpBtn.style.opacity='1';
        accessOtpBtn.textContent='Entrar com código';
      }
    }
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
        showOtpFallback(authError + ' Você também pode colar o código do e-mail abaixo.', true);
        return;
      }
      await establishSessionFromUrl();
      var sessionResult=await supabaseClient.auth.getSession();
      var session=sessionResult && sessionResult.data ? sessionResult.data.session : null;
      if(session && session.user){
        var destination=await resolveDestination(session);
        setStatus('Acesso confirmado. Redirecionando...');
        redirectTo(destination);
        return;
      }

      supabaseClient.auth.onAuthStateChange(async function(event,nextSession){
        if((event==='SIGNED_IN' || event==='TOKEN_REFRESHED' || event==='INITIAL_SESSION') && nextSession && nextSession.user){
          var target=await resolveDestination(nextSession);
          setStatus('Acesso confirmado. Redirecionando...');
          redirectTo(target);
        }
      });

      showOtpFallback('Nao foi possivel concluir o acesso automaticamente por este link. Cole o codigo do e-mail ou peca um novo link.', true);
    }catch(_){
      showOtpFallback('Nao foi possivel concluir o acesso agora. Cole o codigo do e-mail ou peca um novo link.', true);
    }
  })();

  if(accessOtpBtn) accessOtpBtn.addEventListener('click', submitOtpFallback);
  var accessEmailInput=document.getElementById('accessEmail');
  if(accessEmailInput) accessEmailInput.addEventListener('input', function(){
    if(validateAuthEmail(this.value)) setFieldError(accessEmailField, document.getElementById('accessEmailError'), false, '');
  });
  var accessOtpInput=document.getElementById('accessOtp');
  if(accessOtpInput) accessOtpInput.addEventListener('input', function(){
    if(normalizeOtpCode(this.value).length >= 6) setFieldError(accessOtpField, document.getElementById('accessOtpError'), false, '');
  });
})();
