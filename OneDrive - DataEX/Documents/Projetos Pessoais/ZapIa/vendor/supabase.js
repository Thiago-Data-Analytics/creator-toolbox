(function(){
  if(window.supabase && (typeof window.supabase.createClient === 'function' || (window.supabase.supabase && typeof window.supabase.supabase.createClient === 'function'))){
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.3/dist/umd/supabase.js';
  script.integrity = 'sha384-jf0E+ifB49yrNJPdqCXKIn61nKYAFnt9/dEuBSmz0oB9GUiGs6hQZjWmf7EfBGzw';
  script.crossOrigin = 'anonymous';
  script.async = false;
  document.head.appendChild(script);
})();
