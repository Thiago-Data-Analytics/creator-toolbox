(function(){
  var SUPABASE_URL=(window.__mbConfig||{}).SUPABASE_URL||'https://rurnemgzamnfjvmlbdug.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY=(window.__mbConfig||{}).SUPABASE_PUBLISHABLE_KEY||'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
  // supabaseClient is null until the CDN script finishes loading (race-condition fix)
  var supabaseClient=null;
  function _getSupabaseFactory(){
    if(window.supabase && typeof window.supabase.createClient==='function') return window.supabase.createClient;
    if(window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function') return window.supabase.supabase.createClient;
    return null;
  }
  function waitForSupabaseClient(){
    // Use shared helper when available; inline fallback for resilience.
    // implicit flowType ensures sent magic links work cross-browser.
    if(window.__mbAuth && typeof window.__mbAuth.waitForSupabaseClient==='function'){
      return window.__mbAuth.waitForSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{flowType:'implicit'}});
    }
    return new Promise(function(resolve){
      var maxWait=6000, interval=50, elapsed=0;
      (function check(){
        var f=_getSupabaseFactory();
        if(f){ try{ resolve(f(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:'implicit'}})); }catch(e){ resolve(null); } return; }
        elapsed+=interval;
        if(elapsed>=maxWait){ resolve(null); return; }
        setTimeout(check,interval);
      })();
    });
  }
  var lastRequestedEmail='';

  // Delegate shared helpers to vendor/auth-utils.js (window.__mbAuth)
  var _auth=window.__mbAuth||{};
  function report(err,ctx){ _auth.report ? _auth.report(err,ctx) : (window.__mb_report_error && window.__mb_report_error(err,ctx)); }
  function getDefaultPanelUrl(){ return _auth.getDefaultPanelUrl ? _auth.getDefaultPanelUrl() : '/painel-cliente/app/?continue=1'; }

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
    document.getElementById('otpField').classList.remove('show');
    document.getElementById('otpBtn').classList.remove('show');
    document.getElementById('sessionActions').classList.remove('show');
    setStatus(message||'',!!isError);
  }

  function showOtpEntry(email,message,isError){
    lastRequestedEmail=String(email || '').trim().toLowerCase();
    document.getElementById('emailField').style.display='flex';
    document.getElementById('authBtn').style.display='inline-flex';
    document.getElementById('otpField').classList.add('show');
    document.getElementById('otpBtn').classList.add('show');
    document.getElementById('sessionActions').classList.remove('show');
    setStatus(message||'',!!isError);
    // Move focus to OTP field so keyboard users don't have to Tab to it
    setTimeout(function(){
      var otpEl=document.getElementById('authOtp');
      if(otpEl) otpEl.focus();
    }, 50);
  }

  function validateAuthEmail(email){ return _auth.validateEmail ? _auth.validateEmail(email) : false; }

  function setEmailFieldState(hasError, message, focusField){
    var field = document.getElementById('emailField');
    var error = document.getElementById('authEmailError');
    if(field) field.classList.toggle('has-error', !!hasError);
    if(error) error.textContent = message || '';
    if(hasError && focusField !== false){
      var input = document.getElementById('authEmail');
      if(input) input.focus();
    }
  }

  function setOtpFieldState(hasError, message, focusField){
    var field = document.getElementById('otpField');
    var error = document.getElementById('authOtpError');
    if(field) field.classList.toggle('has-error', !!hasError);
    if(error) error.textContent = message || '';
    if(hasError && focusField !== false){
      var input = document.getElementById('authOtp');
      if(input) input.focus();
    }
  }

  function normalizeOtpCode(raw){ return _auth.normalizeOtp ? _auth.normalizeOtp(raw) : String(raw||'').replace(/\D/g,'').slice(0,8); }
  async function verifyOtpCode(email,token){ return _auth.verifyOtpCode(supabaseClient,email,token); }

  async function sendMagicLink(){
    var email=document.getElementById('authEmail').value.trim().toLowerCase();
    var btn=document.getElementById('authBtn');
    if(!email){
      setEmailFieldState(true, 'Informe o e-mail da sua conta.');
      setStatus('Informe o e-mail da sua conta.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setEmailFieldState(true, 'Informe um e-mail válido para continuar.');
      setStatus('Use um e-mail válido para receber o link de acesso.', true);
      return;
    }
    setEmailFieldState(false, '');
    if(!supabaseClient || !supabaseClient.auth){
      setStatus('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
      return;
    }
    btn.disabled=true;
    btn.style.opacity='.7';
    btn.textContent='Enviando...';
    setStatus('Enviando link de acesso...', false);
    try{
      var otpResult=await supabaseClient.auth.signInWithOtp({
        email: email,
        options:{
          emailRedirectTo: window.location.origin + '/acesso/',
          shouldCreateUser: false
        }
      });
      if(otpResult && otpResult.error){
        var rawMsg = (otpResult.error.message || '').toLowerCase();
        if(rawMsg.indexOf('rate limit') >= 0 || rawMsg.indexOf('too many') >= 0){
          setStatus('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.', true);
          return;
        }
        if(rawMsg.indexOf('invalid email') >= 0){
          setEmailFieldState(true, 'E-mail inválido. Verifique o endereço e tente novamente.');
          setStatus('E-mail inválido. Verifique o endereço e tente novamente.', true);
          return;
        }
        // Anti-enumeration: treat all remaining errors as "sent" to avoid revealing registration status.
        if(window.__mbAuth && window.__mbAuth.setPendingEmail) window.__mbAuth.setPendingEmail(email);
        showOtpEntry(email,'Se este e-mail estiver cadastrado, você receberá o link e o código em instantes. Não chegou? Confirme o endereço ou acesse /cadastro/ para criar uma conta.', false);
        return;
      }
      if(window.__mbAuth && window.__mbAuth.setPendingEmail) window.__mbAuth.setPendingEmail(email);
      showOtpEntry(email,'Enviamos o link e o código de acesso. Se o link falhar, cole o código abaixo.', false);
    }catch(err){
      report(err, { fn: 'sendMagicLink', email: email.slice(0,3) + '***' });
      setStatus('Falha temporária ao solicitar o acesso. Tente novamente em alguns minutos.', true);
    }finally{
      btn.disabled=false;
      btn.style.opacity='1';
      btn.textContent='Enviar link de acesso';
    }
  }

  async function useAnotherAccount(){
    if(!supabaseClient || !supabaseClient.auth){
      setStatus('Sessão indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    try{ await supabaseClient.auth.signOut(); }catch(err){ report(err, { fn: 'signOut' }); }
    lastRequestedEmail='';
    document.getElementById('authOtp').value='';
    setOtpFieldState(false,'', false);
    history.replaceState(null,'',window.location.origin + '/painel-cliente/app/');
    showEmailEntry('Sessão encerrada. Agora você pode entrar com outro e-mail.', false);
  }

  async function signInWithOtpCode(){
    var email=document.getElementById('authEmail').value.trim().toLowerCase();
    var token=normalizeOtpCode(document.getElementById('authOtp').value);
    var btn=document.getElementById('otpBtn');
    if(!email){
      setEmailFieldState(true,'Informe o e-mail da sua conta.');
      setStatus('Informe o e-mail usado para receber o código.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setEmailFieldState(true,'Informe um e-mail válido para continuar.');
      setStatus('Use o mesmo e-mail que recebeu o código.', true);
      return;
    }
    if(!token || token.length < 6){
      setOtpFieldState(true,'Informe o código numérico enviado por e-mail.');
      setStatus('Cole o código de acesso do e-mail para continuar.', true);
      return;
    }
    setEmailFieldState(false,'', false);
    setOtpFieldState(false,'', false);
    btn.disabled=true;
    btn.style.opacity='.7';
    btn.textContent='Entrando...';
    setStatus('Validando seu código de acesso...', false);
    try{
      var otpResult=await verifyOtpCode(email, token);
      if(otpResult && otpResult.error){
        setOtpFieldState(true,'Código inválido. Peça um novo link e tente novamente.');
        setStatus('Não foi possível validar esse código. Peça um novo acesso e tente novamente.', true);
        return;
      }
      await openPanelWithValidatedSession();
    }catch(err){
      report(err, { fn: 'signInWithOtpCode' });
      setOtpFieldState(false,'', false);
      setStatus('Falha temporária ao validar o código. Tente novamente ou peça um novo acesso.', true);
    }finally{
      btn.disabled=false;
      btn.style.opacity='1';
      btn.textContent='Entrar com código';
    }
  }

  async function openPanelWithValidatedSession(){
    if(!supabaseClient || !supabaseClient.auth){
      setStatus('Sessão indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    setStatus('Validando seu acesso antes de abrir o painel...', false);
    try{
      var userResult=await supabaseClient.auth.getUser();
      var user=userResult && userResult.data ? userResult.data.user : null;
      if(userResult && userResult.error || !user){
        try{ await supabaseClient.auth.signOut(); }catch(_){}
        showEmailEntry('Sua sessão expirou. Peça um novo link para continuar.', true);
        return;
      }
      window.location.replace(getDefaultPanelUrl());
    }catch(err){
      report(err, { fn: 'openPanelWithValidatedSession' });
      try{ await supabaseClient.auth.signOut(); }catch(_){}
      showEmailEntry('Não foi possível validar sua sessão agora. Peça um novo link para continuar.', true);
    }
  }

  async function init(){
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Biblioteca de autenticação não carregada corretamente. Recarregue a página para continuar.', true);
      return;
    }
    try{
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
        }catch(err){ report(err, { fn: 'init.getUser' }); }
        try{ await supabaseClient.auth.signOut(); }catch(_){}
      }
    }catch(err){ report(err, { fn: 'init.getSession' }); }
    showEmailEntry('', false);
  }

  (async function(){
    supabaseClient = await waitForSupabaseClient();
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
  })();

  // Form submit handler — routes to correct action based on current visible state
  var authFormEl = document.getElementById('authForm');
  if(authFormEl) authFormEl.addEventListener('submit', function(e){
    e.preventDefault();
    var otpVisible = document.getElementById('otpField');
    if(otpVisible && otpVisible.classList.contains('show')){
      signInWithOtpCode();
    } else {
      sendMagicLink();
    }
  });

  var useAnotherAccountBtnEl = document.getElementById('useAnotherAccountBtn');
  if(useAnotherAccountBtnEl) useAnotherAccountBtnEl.addEventListener('click', useAnotherAccount);
  var openPanelBtnEl = document.getElementById('openPanelBtn');
  if(openPanelBtnEl) openPanelBtnEl.addEventListener('click', function(e){ e.preventDefault(); openPanelWithValidatedSession(); });
  var otpBtnEl = document.getElementById('otpBtn');
  if(otpBtnEl) otpBtnEl.addEventListener('click', signInWithOtpCode);

  var authEmailEl = document.getElementById('authEmail');
  if(authEmailEl) authEmailEl.addEventListener('input', function(){
    if(validateAuthEmail(this.value)) setEmailFieldState(false, '', false);
  });

  var otpAutoTimer = null;
  var authOtpEl = document.getElementById('authOtp');
  if(authOtpEl) authOtpEl.addEventListener('input', function(){
    var code = normalizeOtpCode(this.value);
    // Keep displayed value clean (digits only, max 8)
    if(this.value !== code) this.value = code;
    if(code.length >= 6){
      setOtpFieldState(false,'', false);
      clearTimeout(otpAutoTimer);
      otpAutoTimer = setTimeout(function(){
        var otpVisible = document.getElementById('otpField');
        if(otpVisible && otpVisible.classList.contains('show')) signInWithOtpCode();
      }, 350);
    } else {
      clearTimeout(otpAutoTimer);
    }
  });
})();
