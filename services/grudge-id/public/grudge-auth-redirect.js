/**
 * Grudge Studio — Auth Redirect SDK v1.0.0
 * Drop this into any Grudge app: <script src="https://id.grudge-studio.com/auth/grudge-auth-redirect.js" data-app="APP_SLUG"></script>
 */
(function(root) {
  "use strict";
  var AUTH_PAGE = "https://id.grudge-studio.com/auth";
  var API_URL = "https://id.grudge-studio.com";
  var KEYS = { token: "grudge_auth_token", grudgeId: "grudge_id", username: "grudge_username", provider: "grudge_auth_provider" };

  function consumeHash() {
    if (!location.hash || location.hash.length < 2) return false;
    var hash = new URLSearchParams(location.hash.slice(1));
    var token = hash.get("token");
    if (!token) return false;
    localStorage.setItem(KEYS.token, token);
    if (hash.get("grudgeId")) localStorage.setItem(KEYS.grudgeId, hash.get("grudgeId"));
    if (hash.get("name")) localStorage.setItem(KEYS.username, hash.get("name"));
    if (hash.get("provider")) localStorage.setItem(KEYS.provider, hash.get("provider"));
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }

  function getToken() { return localStorage.getItem(KEYS.token) || null; }
  function isLoggedIn() { return !!getToken(); }
  function getUser() {
    if (!isLoggedIn()) return null;
    return { token: getToken(), grudgeId: localStorage.getItem(KEYS.grudgeId), username: localStorage.getItem(KEYS.username), provider: localStorage.getItem(KEYS.provider) };
  }
  function requireAuth(appSlug) {
    if (isLoggedIn()) return true;
    var slug = appSlug || (document.querySelector("script[data-app]") ? document.querySelector("script[data-app]").getAttribute("data-app") : "");
    location.href = AUTH_PAGE + "?redirect=" + encodeURIComponent(location.href) + "&app=" + encodeURIComponent(slug);
    return false;
  }
  function logout() {
    Object.values(KEYS).forEach(function(k) { localStorage.removeItem(k); });
    localStorage.removeItem("grudge_session_token");
  }
  function logoutAndRedirect(appSlug) { logout(); requireAuth(appSlug); }
  async function verifyToken() {
    var token = getToken();
    if (!token) return null;
    try {
      var resp = await fetch(API_URL + "/auth/verify", { headers: { Authorization: "Bearer " + token } });
      if (!resp.ok) { logout(); return null; }
      return await resp.json();
    } catch { return null; }
  }

  consumeHash();

  var GrudgeAuth = { AUTH_PAGE:AUTH_PAGE, API_URL:API_URL, KEYS:KEYS, consumeHash:consumeHash, getToken:getToken, isLoggedIn:isLoggedIn, getUser:getUser, requireAuth:requireAuth, verifyToken:verifyToken, logout:logout, logoutAndRedirect:logoutAndRedirect };
  if (typeof module !== "undefined" && module.exports) module.exports = GrudgeAuth;
  else root.GrudgeAuth = GrudgeAuth;
})(typeof globalThis !== "undefined" ? globalThis : this);
