// ──────────────────────────────────────────────────────────────────
//  api.js v2 — Shared API helpers
//
//  Authentication model (v2):
//    1. doLogin() calls apiGetPublic('login', {password}) ONCE.
//    2. Server verifies password and returns a random session token.
//    3. Token is stored in sessionStorage (cleared on tab close).
//    4. All subsequent admin requests call apiGet(action, params),
//       which appends the token automatically.
//    5. Password is NEVER stored client-side after login completes.
// ──────────────────────────────────────────────────────────────────

var _gsParam   = new URLSearchParams(location.search).get('gs');
var SCRIPT_URL = _gsParam
  ? decodeURIComponent(_gsParam)
  : 'https://script.google.com/a/macros/isb.nu.edu.pk/s/AKfycbyObo6628vqIzHgnNgdvqX2dM2QDaCu9QY3yRsZOx-hSuZIom_0I15VLvExeQZPnpKA/exec';

// ── Token storage (sessionStorage — cleared when tab closes) ──────
var QD_TOKEN_KEY = 'qd_admin_token';
function getToken()       { return sessionStorage.getItem(QD_TOKEN_KEY) || ''; }
function setToken(t)      { sessionStorage.setItem(QD_TOKEN_KEY, t); }
function clearToken()     { sessionStorage.removeItem(QD_TOKEN_KEY); }
function hasValidToken()  { return !!getToken(); }

// ── JSONP core ────────────────────────────────────────────────────
function jsonpGet(url) {
  return new Promise(function(resolve, reject) {
    var cbName = '__gasJp' + Date.now() + Math.random().toString(36).slice(2, 7);
    var script = null;
    var timer  = setTimeout(function() { cleanup(); reject(new Error('Timeout')); }, 20000);
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

// ── Admin GET — token appended automatically ─────────────────────
function apiGet(action, params) {
  var url = SCRIPT_URL + '?action=' + encodeURIComponent(action)
          + '&token=' + encodeURIComponent(getToken());
  if (params) {
    Object.keys(params).forEach(function(k) {
      var v = (params[k] === null || params[k] === undefined) ? '' : params[k];
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
  }
  return jsonpGet(url);
}

// ── Public GET — no token ─────────────────────────────────────────
function apiGetPublic(action, params) {
  var url = SCRIPT_URL + '?action=' + encodeURIComponent(action);
  if (params) {
    Object.keys(params).forEach(function(k) {
      var v = (params[k] === null || params[k] === undefined) ? '' : params[k];
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
  }
  return jsonpGet(url);
}

// ── Legacy POST — kept ONLY for attachment uploads ────────────────
function gasPost(payload) {
  return fetch(SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
}
