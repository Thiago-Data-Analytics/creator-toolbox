/**
 * vendor/auth-utils.js — shared auth helpers for MercaBot
 *
 * Exposes window.__mbAuth with pure, side-effect-free utilities
 * used by both assets/login.js and assets/access.js.
 *
 * Load order (in every auth page):
 *   vendor/config.js       → window.__mbConfig
 *   vendor/sentry.js       → window.__mb_report_error
 *   vendor/supabase.js     → window.supabase
 *   vendor/auth-utils.js   → window.__mbAuth      ← this file
 *   assets/login.js  (or access.js)
 */
(function(){
  'use strict';

  var utils = window.__mbAuth = window.__mbAuth || {};

  // ── Error reporting ──────────────────────────────────────────────────────────
  /**
   * Report an error via the Sentry wrapper.
   * Safe to call even before the Sentry SDK loads.
   */
  utils.report = function(err, ctx){
    if(window.__mb_report_error) window.__mb_report_error(err, ctx);
  };

  // ── Validation ───────────────────────────────────────────────────────────────
  /**
   * Returns true when the e-mail string has a plausible format.
   * Does not check domain existence — just structure (a@b.c).
   */
  utils.validateEmail = function(email){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim().toLowerCase());
  };

  /**
   * Strips non-digit characters and truncates to 8.
   * Supabase generates 8-digit OTP codes; supports 6-digit codes as well.
   * Prevents clipboard pastes like "12345678 válido por 1h" → "1234567801".
   */
  utils.normalizeOtp = function(raw){
    return String(raw || '').replace(/\D/g, '').slice(0, 8);
  };

  // ── Client factory ───────────────────────────────────────────────────────────
  /**
   * Waits for the Supabase CDN bundle to finish loading (injected dynamically by
   * vendor/supabase.js), then creates and returns a Supabase client.
   * Resolves to null after 6 s if the CDN never arrives.
   *
   * @param {string} supabaseUrl
   * @param {string} supabaseKey
   * @param {object} [options]  Passed directly to createClient (e.g. {auth:{flowType:'implicit'}})
   * @returns {Promise<object|null>}
   */
  utils.waitForSupabaseClient = function(supabaseUrl, supabaseKey, options){
    return new Promise(function(resolve){
      var maxWait=6000, interval=50, elapsed=0;
      (function check(){
        var f=null;
        if(window.supabase && typeof window.supabase.createClient==='function') f=window.supabase.createClient;
        else if(window.supabase && window.supabase.supabase && typeof window.supabase.supabase.createClient==='function') f=window.supabase.supabase.createClient;
        if(f){ try{ resolve(f(supabaseUrl, supabaseKey, options||{})); }catch(e){ resolve(null); } return; }
        elapsed+=interval;
        if(elapsed>=maxWait){ resolve(null); return; }
        setTimeout(check,interval);
      })();
    });
  };

  // ── Routing ──────────────────────────────────────────────────────────────────
  /** Default post-login destination for regular customers. */
  utils.getDefaultPanelUrl = function(){
    return '/painel-cliente/app/?continue=1';
  };

  // ── Supabase helpers (require a client instance) ─────────────────────────────
  /**
   * Verify a 6-digit OTP code.
   * Tries type='email' first; falls back to type='magiclink' to cover
   * both Supabase OTP and magic-link token formats.
   *
   * @param {object} client  Supabase client
   * @param {string} email
   * @param {string} token   6-digit numeric code
   * @returns {Promise}      Supabase verifyOtp response
   */
  utils.verifyOtpCode = async function(client, email, token){
    var attempt = await client.auth.verifyOtp({ email: email, token: token, type: 'email' });
    if(!attempt || !attempt.error) return attempt;
    return await client.auth.verifyOtp({ email: email, token: token, type: 'magiclink' });
  };

  /**
   * Resolve post-login destination based on the user's role / plan.
   * Returns '/painel-parceiro/' for partner accounts;
   * falls back to getDefaultPanelUrl() for all others.
   *
   * @param {object} client   Supabase client
   * @param {object} session  Supabase session (must have .access_token + .user.id)
   * @returns {Promise<string>} URL to redirect to
   */
  utils.resolveDestination = async function(client, session){
    if(!session || !session.access_token || !session.user){
      return utils.getDefaultPanelUrl();
    }
    var cfg     = window.__mbConfig || {};
    var apiUrl  = cfg.SUPABASE_URL  || 'https://rurnemgzamnfjvmlbdug.supabase.co';
    var apiKey  = cfg.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';
    var headers = { 'apikey': apiKey, 'Authorization': 'Bearer ' + session.access_token };
    try{
      var uid         = encodeURIComponent(session.user.id);
      var profileRes  = await fetch(apiUrl + '/rest/v1/profiles?id=eq.'      + uid + '&select=role&limit=1',      { headers: headers });
      var customerRes = await fetch(apiUrl + '/rest/v1/customers?user_id=eq.' + uid + '&select=plan_code&limit=1', { headers: headers });
      var profileData  = profileRes.ok  ? await profileRes.json()  : [];
      var customerData = customerRes.ok ? await customerRes.json() : [];
      var role     = (profileData[0]  || {}).role       ? String(profileData[0].role).toLowerCase()       : '';
      var planCode = (customerData[0] || {}).plan_code  ? String(customerData[0].plan_code).toLowerCase() : '';
      if(role === 'partner' || role === 'parceiro' || planCode === 'parceiro'){
        return '/painel-parceiro/';
      }
    }catch(err){ utils.report(err, { fn: 'resolveDestination' }); }
    return utils.getDefaultPanelUrl();
  };

})();
