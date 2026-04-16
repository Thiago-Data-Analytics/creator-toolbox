(function(){
  /**
   * vendor/config.js — MercaBot client-side configuration
   *
   * Single source of truth for all publishable (non-secret) config values.
   * Loaded before any other script that needs these constants.
   *
   * Values here are SAFE to expose in browser code:
   *  - Supabase publishable key is a client anon key protected by RLS policies
   *  - All other values are non-sensitive identifiers
   */
  window.__mbConfig = {
    SUPABASE_URL: 'https://rurnemgzamnfjvmlbdug.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ',
    API_BASE_URL: 'https://api.mercabot.com.br'
  };
})();
