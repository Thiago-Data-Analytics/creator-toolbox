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
    // Uses implicit flowType so magic links are sent as ?token_hash= (stateless,
    // works cross-browser) rather than ?code= (PKCE, breaks when opened in a
    // different browser than the one that requested the link).
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

  // Read the email the user typed on /login/ so we can pre-fill it here.
  function readSavedEmail(){
    if(window.__mbAuth && window.__mbAuth.getPendingEmail) return window.__mbAuth.getPendingEmail();
    return '';
  }

  function showOtpFallback(message,isError,prefillEmail){
    if(accessEmailField) accessEmailField.classList.add('show');
    if(accessOtpField) accessOtpField.classList.add('show');
    if(accessOtpBtn) accessOtpBtn.classList.add('show');
    if(primaryActionEl) primaryActionEl.textContent='Ir para o painel';
    var email = prefillEmail || readSavedEmail();
    if(email){
      var emailInput=document.getElementById('accessEmail');
      if(emailInput && !emailInput.value) emailInput.value=String(email).trim().toLowerCase();
    }
    setStatus(message,isError);
    // Focus OTP input directly when email is pre-filled; email field otherwise
    setTimeout(function(){
      var emailInput=document.getElementById('accessEmail');
      var otpInput=document.getElementById('accessOtp');
      var target = (emailInput && emailInput.value && otpInput) ? otpInput : (emailInput || otpInput);
      if(target) target.focus();
    }, 80);
  }

  function normalizeOtpCode(raw){ return _auth.normalizeOtp ? _auth.normalizeOtp(raw) : String(raw||'').replace(/\D/g,'').slice(0,8); }
  function validateAuthEmail(email){ return _auth.validateEmail ? _auth.validateEmail(email) : false; }
  function getDefaultPanelUrl(){ return _auth.getDefaultPanelUrl ? _auth.getDefaultPanelUrl() : '/painel-cliente/app/?continue=1'; }

  function updatePrimaryAction(url,label){
    if(!primaryActionEl) return;
    primaryActionEl.href=url;
    primaryActionEl.textContent=label || 'Ir para o painel';
  }

  function redirectTo(url){
    // Limpar PII do fluxo de autenticação antes de redirecionar
    if(window.__mbAuth && window.__mbAuth.clearPendingEmail) window.__mbAuth.clearPendingEmail();
    var target=url || getDefaultPanelUrl();
    updatePrimaryAction(target, target.indexOf('/painel-parceiro') === 0 ? 'Ir para a área do parceiro' : 'Ir para o painel');
    window.location.replace(target);
  }

  function readHashParams(){
    return new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  }

  // Checks for auth errors in either the hash fragment OR query string
  // (Supabase uses hash for implicit flow errors, query string for some redirect errors)
  function getAuthErrorFromUrl(){
    var hash=readHashParams();
    var query=new URLSearchParams(window.location.search);
    var error=hash.get('error') || query.get('error') || '';
    var code=hash.get('error_code') || query.get('error_code') || '';
    var description=hash.get('error_description') || query.get('error_description') || '';
    if(!error && !code && !description) return '';
    var normalizedDescription=String(description || '').replace(/\+/g,' ').trim();
    if(code === 'otp_expired' || /expired/i.test(normalizedDescription)){
      return 'Este link expirou.';
    }
    if(error === 'access_denied'){
      return normalizedDescription || 'Não foi possível concluir o acesso por este link.';
    }
    return normalizedDescription || 'Não foi possível concluir o acesso agora.';
  }

  /**
   * Tries to establish a session from URL parameters.
   *
   * Handles three Supabase magic-link formats:
   *   1. ?code=...            PKCE — may fail when opened in a different browser
   *   2. ?token_hash=...      Stateless — works cross-browser (modern Supabase)
   *   3. #access_token=...    Implicit — SDK reads hash on init (legacy format)
   *
   * Returns: { session, pkceFailed, tokenHashFailed }
   * - session: the established Session object, or null
   * - pkceFailed: true if PKCE exchange failed (cross-browser)
   * - tokenHashFailed: true if token_hash verification failed (expired/used)
   *
   * URL is cleaned only when we explicitly processed a token from it.
   * The #access_token= hash is NOT cleaned here — the SDK reads it during
   * initialization, and getSession() already awaits that completion.
   */
  async function establishSessionFromUrl(){
    var query=new URLSearchParams(window.location.search);

    // ── PKCE ?code= ─────────────────────────────────────────────────────────────
    if(query.get('code') && supabaseClient.auth.exchangeCodeForSession){
      history.replaceState(null,'',window.location.origin + window.location.pathname);
      try{
        var exchangeResult=await supabaseClient.auth.exchangeCodeForSession(query.get('code'));
        if(exchangeResult && exchangeResult.error){
          return { session: null, pkceFailed: true };
        }
        var session = exchangeResult && exchangeResult.data && exchangeResult.data.session
          ? exchangeResult.data.session : null;
        return { session: session, pkceFailed: false };
      }catch(e){
        return { session: null, pkceFailed: true };
      }
    }

    // ── Token hash ?token_hash= ──────────────────────────────────────────────────
    if(query.get('token_hash') && query.get('type') && supabaseClient.auth.verifyOtp){
      history.replaceState(null,'',window.location.origin + window.location.pathname);
      try{
        var verifyResult=await supabaseClient.auth.verifyOtp({
          token_hash: query.get('token_hash'),
          type: query.get('type')
        });
        if(verifyResult && verifyResult.error){
          return { session: null, tokenHashFailed: true };
        }
        var session = verifyResult && verifyResult.data && verifyResult.data.session
          ? verifyResult.data.session : null;
        return { session: session, tokenHashFailed: false };
      }catch(e){
        return { session: null, tokenHashFailed: true };
      }
    }

    // ── No URL token — clean any stray search/hash that the SDK already consumed ─
    // (Don't clean the hash here — the SDK reads it during init; getSession()
    //  already awaits that initialization before returning.)
    if(window.location.search){
      history.replaceState(null,'',window.location.origin + window.location.pathname);
    }

    return { session: null };
  }

  async function resolveDestination(session){
    try{ return await _auth.resolveDestination(supabaseClient,session); }
    catch(_){ return getDefaultPanelUrl(); }
  }
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
        setStatus('Código inválido. Verifique e tente novamente ou peça um novo acesso.', true);
        return;
      }
      // Use session from verifyOtpCode result when available; fall back to getSession()
      var session = otpResult && otpResult.data && otpResult.data.session ? otpResult.data.session : null;
      if(!session){
        var sessionResult=await supabaseClient.auth.getSession();
        session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
      }
      if(session && session.user){
        setStatus('Acesso confirmado. Redirecionando...', false);
        var target=await resolveDestination(session);
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
    supabaseClient = await waitForSupabaseClient();
    if(!supabaseClient || !supabaseClient.auth){
      setStatus('A autenticação não carregou corretamente. Recarregue e tente novamente.', true);
      showOtpFallback('A autenticação não carregou corretamente. Recarregue e tente novamente.', true);
      return;
    }

    // Register onAuthStateChange BEFORE any awaits so we never miss a session event.
    // This is the fallback path for #access_token= implicit flow (SDK fires SIGNED_IN
    // during initialization, which may complete while we're awaiting establishSessionFromUrl).
    var _redirected = false;
    supabaseClient.auth.onAuthStateChange(async function(event, nextSession){
      if(_redirected) return;
      if((event==='SIGNED_IN' || event==='TOKEN_REFRESHED' || event==='INITIAL_SESSION' || event==='SIGNED_UP') && nextSession && nextSession.user){
        _redirected = true;
        setStatus('Acesso confirmado. Redirecionando...', false);
        var target = await resolveDestination(nextSession);
        redirectTo(target);
      }
    });

    try{
      // Check for error codes in URL (hash or query string)
      var authError=getAuthErrorFromUrl();
      if(authError){
        history.replaceState(null,'',window.location.origin + window.location.pathname);
        showOtpFallback(authError + ' Cole o código do e-mail abaixo ou peça um novo acesso.', true);
        return;
      }

      // Try to establish a session from URL tokens (?code= / ?token_hash= / #access_token=)
      var urlResult = await establishSessionFromUrl();

      if(urlResult.pkceFailed){
        // PKCE link opened in a different browser — the code_verifier is in the
        // browser that requested the link. The OTP code always works cross-browser.
        showOtpFallback('Cole o código de acesso do e-mail abaixo para continuar.', false);
        return;
      }

      if(urlResult.tokenHashFailed){
        // Token hash expired or already used. Ask for the OTP code.
        showOtpFallback('O link expirou. Cole o código do e-mail abaixo ou peça um novo acesso.', true);
        return;
      }

      // Use session extracted directly from the URL exchange/verify result.
      // This avoids the race condition where onAuthStateChange fires before
      // getSession() is called and would cause an OTP-fallback flash.
      var session = urlResult.session;

      if(!session){
        // No URL token — check if the SDK already established a session from the
        // #access_token= hash (implicit flow) or from a stored session.
        // getSession() internally awaits the SDK's initialization promise, so this
        // covers the implicit-flow hash token case without additional await.
        var sessionResult = await supabaseClient.auth.getSession();
        session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
      }

      if(session && session.user && !_redirected){
        _redirected = true;
        setStatus('Acesso confirmado. Redirecionando...', false);
        var destination = await resolveDestination(session);
        redirectTo(destination);
        return;
      }

      // No session established and no URL token handled — user landed here directly
      // or the link was already consumed. Show code entry form.
      if(!_redirected){
        showOtpFallback('Cole o código de acesso do e-mail abaixo para continuar.', false);
      }
    }catch(err){
      report(err, { fn: 'access.init' });
      showOtpFallback('Não foi possível concluir o acesso agora. Cole o código do e-mail ou peça um novo acesso.', true);
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

  var _otpAutoTimer = null;
  var accessOtpInput=document.getElementById('accessOtp');
  if(accessOtpInput) accessOtpInput.addEventListener('input', function(){
    var code=normalizeOtpCode(this.value);
    // Keep displayed value clean (digits only, max 8)
    if(this.value !== code) this.value = code;
    var otpErrEl=document.getElementById('accessOtpError');
    if(code.length >= 6){
      setFieldError(accessOtpField, otpErrEl, false, '', false);
      // Auto-submit 350ms after a complete code is entered (same as login.js)
      clearTimeout(_otpAutoTimer);
      _otpAutoTimer = setTimeout(function(){
        var otpField = document.getElementById('accessOtpField');
        if(otpField && otpField.classList.contains('show')) submitOtpFallback();
      }, 350);
    } else {
      clearTimeout(_otpAutoTimer);
    }
  });
})();
