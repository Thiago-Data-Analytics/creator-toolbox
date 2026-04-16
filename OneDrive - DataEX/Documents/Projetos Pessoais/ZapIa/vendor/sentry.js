/**
 * vendor/sentry.js — MercaBot error observability
 *
 * Setup:
 *  1. Create a project at https://sentry.io
 *  2. Replace SENTRY_DSN below with your project's DSN
 *     (Project Settings → Client Keys → DSN)
 *  3. Done — all catch blocks already call window.__mb_report_error(err)
 *
 * The wrapper is safe to call even before Sentry loads:
 *   window.__mb_report_error(err)          — report error
 *   window.__mb_report_error(err, {ctx})   — report with extra context
 */
(function(){
  // ── Configuration ──────────────────────────────────────────────────────────
  var SENTRY_DSN = 'https://6caef45e81310d37f65f07604d8c488c@o4511230300848128.ingest.us.sentry.io/4511230315200512'; // e.g. 'https://abc123@o000000.ingest.sentry.io/000000'
  var SENTRY_CDN = 'https://browser.sentry-cdn.com/8.28.0/bundle.min.js';
  // SRI hash for Sentry SDK v8.28.0 — regenerate if CDN URL / version changes
  var SENTRY_CDN_INTEGRITY = 'sha384-UEYQHY4EIgg590E479enuYMIM2UcRnHwxOvFJXKPSZgRV7QWrgjHQLjjwKlToWHT';
  var RELEASE    = 'mercabot@__COMMIT_SHA__';
  // ── Safe wrapper (works before Sentry loads) ───────────────────────────────
  var _queue = [];
  window.__mb_report_error = function(err, context){
    if(window.Sentry && window.Sentry.captureException){
      if(context){
        window.Sentry.withScope(function(scope){
          scope.setExtras(context);
          window.Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
      } else {
        window.Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      _queue.push([err, context]);
    }
    if(typeof console !== 'undefined' && console.error){
      console.error('[MercaBot]', err, context || '');
    }
  };
  // Global unhandled error + promise rejection catching
  window.addEventListener('error', function(e){
    window.__mb_report_error(e.error || new Error(e.message), {
      source: e.filename, line: e.lineno, col: e.colno
    });
  });
  window.addEventListener('unhandledrejection', function(e){
    window.__mb_report_error(e.reason || new Error('Unhandled promise rejection'));
  });
  // ── Load Sentry SDK only when DSN is configured ────────────────────────────
  if(!SENTRY_DSN) return;
  var script = document.createElement('script');
  script.src = SENTRY_CDN;
  script.integrity = SENTRY_CDN_INTEGRITY;
  script.crossOrigin = 'anonymous';
  script.onerror = function(){
    // SRI mismatch or network failure — log to console, do not rethrow
    if(typeof console !== 'undefined' && console.warn){
      console.warn('[MercaBot] Sentry SDK failed to load (SRI mismatch or network error). Error reporting unavailable.');
    }
  };
  script.onload = function(){
    if(!window.Sentry || !window.Sentry.init) return;
    window.Sentry.init({
      dsn: SENTRY_DSN,
      release: RELEASE,
      environment: window.location.hostname === 'mercabot.com.br' ? 'production' : 'preview',
      tracesSampleRate: 0.1,
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error exception captured',
        /^Loading chunk \d+ failed/,
        'AbortError'
      ]
    });
    // Drain queue captured before SDK loaded
    _queue.forEach(function(item){ window.__mb_report_error(item[0], item[1]); });
    _queue = [];
  };
  document.head.appendChild(script);
})();
