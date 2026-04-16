(function(){
  if(window.supabase && (typeof window.supabase.createClient === 'function' || (window.supabase.supabase && typeof window.supabase.supabase.createClient === 'function'))){
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.3/dist/umd/supabase.js';
  script.async = false;
  // TODO: add script.integrity = 'sha384-...' after running:
  // curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.3/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A
  document.head.appendChild(script);
})();
