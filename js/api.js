// ──────────────────────────────────────────────────────────────────
//  api.js v3 — REST API helpers (replaces GAS JSONP)
//
//  Authentication model (v3):
//    Instructor: POST /auth/login {email, password}
//                → access_token (short JWT, kept in sessionStorage)
//                + refresh_token (opaque 64-byte hex, kept in localStorage)
//    Student:    POST /auth/student-otp {email, course_id}
//                POST /auth/verify-otp  {email, code, course_id}
//                → access_token (1-hour JWT, kept in sessionStorage)
// ──────────────────────────────────────────────────────────────────

// ── API base URL ──────────────────────────────────────────────────
// Override for local dev via ?api=http://localhost:8000
var _apiParam = new URLSearchParams(location.search).get('api');
var API_BASE  = _apiParam
  ? decodeURIComponent(_apiParam).replace(/\/$/, '')
  : 'https://querydesk.onrender.com';  // ← replace with your Render URL

// ── Token storage ─────────────────────────────────────────────────
var QD_TOKEN_KEY   = 'qd_admin_token';    // instructor JWT (sessionStorage)
var QD_REFRESH_KEY = 'qd_refresh_token';  // refresh token (localStorage)
var QD_STUDENT_KEY = 'qd_student_token';  // student JWT  (sessionStorage)

function getToken()          { return sessionStorage.getItem(QD_TOKEN_KEY)   || ''; }
function setToken(t)         { sessionStorage.setItem(QD_TOKEN_KEY, t); }
function clearToken()        { sessionStorage.removeItem(QD_TOKEN_KEY); }
function hasValidToken()     { return !!getToken(); }

function getRefreshToken()   { return localStorage.getItem(QD_REFRESH_KEY)   || ''; }
function setRefreshToken(t)  { localStorage.setItem(QD_REFRESH_KEY, t); }
function clearRefreshToken() { localStorage.removeItem(QD_REFRESH_KEY); }

function getStudentToken()   { return sessionStorage.getItem(QD_STUDENT_KEY) || ''; }
function setStudentToken(t)  { sessionStorage.setItem(QD_STUDENT_KEY, t); }
function clearStudentToken() { sessionStorage.removeItem(QD_STUDENT_KEY); }

// ── Core fetch helper ─────────────────────────────────────────────
/**
 * apiFetch(method, path, body?, token?)
 *  - token='' → unauthenticated (public)
 *  - token=undefined → use instructor JWT from sessionStorage
 */
function apiFetch(method, path, body, token) {
  var headers = {};
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  var useToken = (token !== undefined) ? token : getToken();
  if (useToken) headers['Authorization'] = 'Bearer ' + useToken;

  return fetch(API_BASE + path, {
    method:  method,
    headers: headers,
    body:    (body !== undefined && body !== null) ? JSON.stringify(body) : undefined
  }).then(function(res) {
    if (res.status === 204) return null;
    return res.json().then(function(data) {
      if (!res.ok) {
        var err = new Error((data && data.detail) ? data.detail : 'Request failed');
        err.status = res.status;
        err.data   = data;
        throw err;
      }
      return data;
    });
  });
}

// ── Convenience wrappers ──────────────────────────────────────────
function apiGet(path, params) {
  var qs = '';
  if (params) {
    var parts = Object.keys(params)
      .filter(function(k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
      .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (parts.length) qs = '?' + parts.join('&');
  }
  return apiFetch('GET', path + qs);
}

function apiPost(path, body)      { return apiFetch('POST',   path, body); }
function apiPatch(path, body)     { return apiFetch('PATCH',  path, body); }
function apiDelete(path)          { return apiFetch('DELETE', path); }

// Public (no token) versions
function publicGet(path, params) {
  var qs = '';
  if (params) {
    var parts = Object.keys(params)
      .filter(function(k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
      .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (parts.length) qs = '?' + parts.join('&');
  }
  return apiFetch('GET', path + qs, undefined, '');
}
function publicPost(path, body)   { return apiFetch('POST', path, body, ''); }

// ── Auth helpers ──────────────────────────────────────────────────
function doApiLogin(email, password) {
  return publicPost('/auth/login', { email: email, password: password });
}

function doApiLogout() {
  var rt = getRefreshToken();
  return apiPost('/auth/logout', { refresh_token: rt });
}

function doApiStudentOtp(email, courseId) {
  return publicPost('/auth/student-otp', { email: email, course_id: courseId });
}

function doApiVerifyOtp(email, code, courseId) {
  return publicPost('/auth/verify-otp', { email: email, code: code, course_id: courseId });
}

// ── Binary download (CSV export) ─────────────────────────────────
function apiDownload(path, filename) {
  var headers = { 'Authorization': 'Bearer ' + getToken() };
  return fetch(API_BASE + path, { headers: headers })
    .then(function(res) {
      if (!res.ok) throw new Error('Export failed');
      return res.blob();
    })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a   = document.createElement('a');
      a.href  = url;
      a.download = filename || 'export.csv';
      a.click();
      setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
    });
}
