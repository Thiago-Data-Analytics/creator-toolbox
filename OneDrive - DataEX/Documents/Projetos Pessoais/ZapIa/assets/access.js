(function(){
  var SUPABASE_URL=(window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY=(window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
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

  // Delegate shared helpers to vendor/auth-utils.js (window.__mbAuth)
  var _auth=window.__mbAuth||{};
  function report(err,ctx){ _auth.report ? _auth.report(err,ctx) : (window.__mb_report_error && window.__mb_report_error(err,ctx)); }

  function setStatus(msg,isError){
    if(!statusEl) return;
    statusEl.textContent=msg;
    statusEl.className=isError ? 'status error' : 'status';
  }

  function setFieldError(fieldEl,errorEl,hasError,message,focusInput){
    if(fieldEl) fieldEl.classList.toggle('has-error', !!hasError);
    if(errorEl) errorEl.textContent = message || '';
    if(hasError && focusInput){
      var input = fieldEl ? fieldEl.querySelector('input') : null;
      if(input) input.focus();
    }
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
    // Move focus to OTP input so keyboard users land in the right place
    setTimeout(function(){
      var otpInput=document.getElementById('accessOtp');
      if(otpInput) otpInput.focus();
    }, 80);
  }

  function normalizeOtpCode(raw){ return _auth.normalizeOtp ? _auth.normalizeOtp(raw) : String(raw||'').replace(/\D/g,'').slice(0,6); }
  function validateAuthEmail(email){ return _auth.validateEmail ? _auth.validateEmail(email) : false; }
  function getDefaultPanelUrl(){ return _auth.getDefaultPanelUrl ? _auth.getDefaultPanelUrl() : '/painel-cliente/app/?continue=1'; }

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

  async function resolveDestination(session){ return _auth.resolveDestination(supabaseClient,session); }
  async function verifyOtpCode(email,token){ return _auth.verifyOtpCode(supabaseClient,email,token); }

  async function submitOtpFallback(){
    var emailInput=document.getElementById('accessEmail');
    var otpInput=document.getElementById('accessOtp');
    var email=emailInput ? emailInput.value.trim().toLowerCase() : '';
    var token=normalizeOtpCode(otpInput ? otpInput.value : '');
    var emailErrEl=document.getElementById('accessEmailError');
    var otpErrEl=document.getElementById('accessOtpError');

    if(!email){
      setFieldError(accessEmailField, emailErrEl, true, 'Informe o e-mail da sua conta.', true);
      setStatus('Informe o e-mail usado para receber o código.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setFieldError(accessEmailField, emailErrEl, true, 'Informe um e-mail válido.', true);
      setStatus('Use o mesmo e-mail que recebeu o código.', true);
      return;
    }
    if(!token || token.length < 6){
      setFieldError(accessOtpField, otpErrEl, true, 'Informe o código enviado por e-mail.', true);
      setStatus('Cole o código de acesso para continuar.', true);
      return;
    }
    setFieldError(accessEmailField, emailErrEl, false, '', false);
    setFieldError(accessOtpField, otpErrEl, false, '', false);
    if(accessOtpBtn){
      accessOtpBtn.disabled=true;
      accessOtpBtn.style.opacity='.7';
      accessOtpBtn.textContent='Entrando...';
    }
    try{
      var otpResult=await verifyOtpCode(email, token);
      if(otpResult && otpResult.error){
        setFieldError(accessOtpField, otpErrEl, true, 'Código inválido. Peça um novo link.', true);
        setStatus('Não foi possível validar esse código. Peça um novo acesso e tente novamente.', true);
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
      setStatus('O código foi aceito, mas a sessão não ficou disponível. Peça um novo acesso.', true);
    }catch(err){
      report(err, { fn: 'submitOtpFallback' });
      setStatus('Falha temporária ao validar o código. Tente novamente ou peça um novo acesso.', true);
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
      setStatus('A autenticação não carregou corretamente. Peça um novo link para continuar.', true);
      showOtpFallback('A autenticação não carregou corretamente. Peça um novo link para continuar.', true);
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

      showOtpFallback('Não foi possível concluir o acesso automaticamente por este link. Cole o código do e-mail ou peça um novo link.', true);
    }catch(err){
      report(err, { fn: 'access.init' });
      showOtpFallback('Não foi possível concluir o acesso agora. Cole o código do e-mail ou peça um novo link.', true);
    }
  })();

  // Form submit handler — Enter key or button click both route through here
  var accessFormEl = document.getElementById('accessForm');
  if(accessFormEl) accessFormEl.addEventListener('submit', function(e){
    e.preventDefault();
    submitOtpFallback();
  });

  var accessEmailInput=document.getElementById('accessEmail');
  if(accessEmailInput) accessEmailInput.addEventListener('input', function(){
    var emailErrEl=document.getElementById('accessEmailError');
    if(validateAuthEmail(this.value)) setFieldError(accessEmailField, emailErrEl, false, '', false);
  });
  var accessOtpInput=document.getElementById('accessOtp');
  if(accessOtpInput) accessOtpInput.addEventListener('input', function(){
    var code=normalizeOtpCode(this.value);
    // Keep displayed value clean (digits only, max 6)
    if(this.value !== code) this.value = code;
    var otpErrEl=document.getElementById('accessOtpError');
    if(code.length >= 6) setFieldError(accessOtpField, otpErrEl, false, '', false);
  });
})();
