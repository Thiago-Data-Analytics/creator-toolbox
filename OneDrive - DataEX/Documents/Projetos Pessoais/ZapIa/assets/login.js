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
  var lastRequestedEmail='';

  function getDefaultPanelUrl(){
    return window.location.origin + '/painel-cliente/app/?continue=1';
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

  function setOtpFieldState(hasError, message){
    var field = document.getElementById('otpField');
    var error = document.getElementById('authOtpError');
    if(field) field.classList.toggle('has-error', !!hasError);
    if(error && message) error.textContent = message;
  }

  function normalizeOtpCode(raw){
    return String(raw || '').replace(/\D/g,'').trim();
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
        var rawMsg = (otpResult.error.message || '').toLowerCase();
        // Rate-limit and invalid-format errors are safe to surface specifically.
        // For all other errors (including "signups not allowed" = email not found)
        // we show the same success-like message to prevent email enumeration.
        if(rawMsg.indexOf('rate limit') >= 0 || rawMsg.indexOf('too many') >= 0){
          showEmailEntry('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.', true);
          return;
        }
        if(rawMsg.indexOf('invalid email') >= 0){
          showEmailEntry('E-mail inválido. Verifique o endereço e tente novamente.', true);
          return;
        }
        // Anti-enumeration: treat all remaining errors as "sent" to avoid revealing registration status.
        // Users who are not registered will not receive the email — they can check /cadastro/.
        showOtpEntry(email,'Se este e-mail estiver cadastrado, você receberá o link e o código em instantes. Não chegou? Confirme o endereço ou acesse /cadastro/ para criar uma conta.', false);
        return;
      }
      showOtpEntry(email,'Enviamos o link e o código de acesso. Se o link falhar, cole o código abaixo.', false);
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
    lastRequestedEmail='';
    document.getElementById('authOtp').value='';
    setOtpFieldState(false,'');
    history.replaceState(null,'',window.location.origin + '/painel-cliente/app/');
    showEmailEntry('Sessão encerrada. Agora você pode entrar com outro e-mail.', false);
  }

  async function signInWithOtpCode(){
    var email=document.getElementById('authEmail').value.trim().toLowerCase();
    var token=normalizeOtpCode(document.getElementById('authOtp').value);
    var btn=document.getElementById('otpBtn');
    if(!email){
      setEmailFieldState(true,'Informe o e-mail da sua conta.');
      showOtpEntry(lastRequestedEmail,'Informe o e-mail usado para receber o código.', true);
      return;
    }
    if(!validateAuthEmail(email)){
      setEmailFieldState(true,'Informe um e-mail válido para continuar.');
      showOtpEntry(email,'Use o mesmo e-mail que recebeu o código.', true);
      return;
    }
    if(!token || token.length < 6){
      setOtpFieldState(true,'Informe o código numérico enviado por e-mail.');
      showOtpEntry(email,'Cole o código de acesso do e-mail para continuar.', true);
      return;
    }
    setEmailFieldState(false,'');
    setOtpFieldState(false,'');
    btn.disabled=true;
    btn.style.opacity='.7';
    btn.textContent='Entrando...';
    showOtpEntry(email,'Validando seu código de acesso...', false);
    try{
      var otpResult=await verifyOtpCode(email, token);
      if(otpResult && otpResult.error){
        showOtpEntry(email,'Não foi possível validar esse código. Peça um novo acesso e tente novamente.', true);
        return;
      }
      await openPanelWithValidatedSession();
    }catch(_){
      showOtpEntry(email,'Falha temporária ao validar o código. Tente novamente ou peça um novo acesso.', true);
    }finally{
      btn.disabled=false;
      btn.style.opacity='1';
      btn.textContent='Entrar com código';
    }
  }

  async function openPanelWithValidatedSession(){
    if(!supabaseClient || !supabaseClient.auth){
      showEmailEntry('Sessão indisponível nesta página. Atualize e tente novamente.', true);
      return;
    }
    setStatus('Validando seu acesso antes de abrir o painel...', false);
    try{
      var userResult=await supabaseClient.auth.getUser();
      var user=userResult && userResult.data ? userResult.data.user : null;
      if(userResult && userResult.error || !user){
        await supabaseClient.auth.signOut();
        showEmailEntry('Sua sessão expirou. Peça um novo link para continuar.', true);
        return;
      }
      window.location.replace(getDefaultPanelUrl());
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
  var otpBtnEl = document.getElementById('otpBtn');
  if(otpBtnEl) otpBtnEl.addEventListener('click', signInWithOtpCode);
  var otpAutoTimer = null;
  var authOtpEl = document.getElementById('authOtp');
  if(authOtpEl) authOtpEl.addEventListener('input', function(){
    var code = normalizeOtpCode(this.value);
    if(code.length >= 6){
      setOtpFieldState(false,'');
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
