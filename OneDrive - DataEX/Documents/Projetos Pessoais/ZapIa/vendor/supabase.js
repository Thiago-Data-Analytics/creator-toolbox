(function(){
  if(window.supabase && (typeof window.supabase.createClient === 'function' || (window.supabase.supabase && typeof window.supabase.supabase.createClient === 'function'))){
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  script.async = false;
  document.head.appendChild(script);
})();
