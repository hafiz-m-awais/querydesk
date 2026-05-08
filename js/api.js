// ──────────────────────────────────────────────────────────────────
//  api.js — Shared API helpers (loaded by both student and admin pages)
// ──────────────────────────────────────────────────────────────────

var _gsParam   = new URLSearchParams(location.search).get('gs');
var SCRIPT_URL = _gsParam
  ? decodeURIComponent(_gsParam)
  : 'https://script.google.com/a/macros/isb.nu.edu.pk/s/AKfycbyObo6628vqIzHgnNgdvqX2dM2QDaCu9QY3yRsZOx-hSuZIom_0I15VLvExeQZPnpKA/exec';

// JSONP GET — bypasses CORS on GAS deployments
function jsonpGet(url) {
  return new Promise(function(resolve, reject) {
    var cbName = '__gasJp' + Date.now() + Math.random().toString(36).slice(2, 7);
    var script = null;
    var timer  = setTimeout(function() { cleanup(); reject(new Error('Timeout')); }, 15000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function(data) { cleanup(); resolve(data); };
    script = document.createElement('script');
    script.onerror = function() { cleanup(); reject(new Error('Script load failed')); };
    script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cbName;
    document.head.appendChild(script);
  });
}

// no-cors POST — fire-and-forget write operations
function gasPost(payload) {
  return fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
