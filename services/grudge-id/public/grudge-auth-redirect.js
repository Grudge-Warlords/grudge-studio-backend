/**
 * Grudge Studio — Auth Redirect SDK v1.0.0
 *
 * Drop this script into any Grudge app to enable unified auth.
 * It handles:
 *   1. Reading returning auth tokens from the URL hash (after login redirect)
 *   2. Redirecting unauthenticated users to the Grudge auth page
 *   3. Verifying stored tokens against the backend
 *   4. Logout
 *
 * Usage:
 *   <script src="https://grudgewarlords.com/auth/grudge-auth-redirect.js"
 *           data-app="wcs"></script>
 *
 * Or import and call manually:
 *   import { requireAuth, getToken, logout } from './grudge-auth-redirect.js';
 */
(function (root) {
  "use strict";

  const AUTH_PAGE = "https://grudgewarlords.com/auth";
  const API_URL = "https://id.grudge-studio.com";

  /* ── Shared localStorage keys (matches authConstants.js) ── */
  const KEYS = {
    token: "grudge_auth_token",
    grudgeId: "grudge_id",
    userId: "grudge_user_id",
    username: "grudge_username",
    provider: "grudge_auth_provider",
    isPuter: "grudge_puter_auth",
  };

  /* ── Read returning token from hash fragment ── */
  function consumeHash() {
    if (!location.hash || location.hash.length < 2) return false;
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("token");
    if (!token) return false;

    localStorage.setItem(KEYS.token, token);
    if (hash.get("grudgeId")) localStorage.setItem(KEYS.grudgeId, hash.get("grudgeId"));
    if (hash.get("name")) localStorage.setItem(KEYS.username, hash.get("name"));
    if (hash.get("provider")) localStorage.setItem(KEYS.provider, hash.get("provider"));

    // Clean up URL
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }

  /* ── Check if user has a stored token ── */
  function getToken() {
    return localStorage.getItem(KEYS.token) || null;
  }

  function isLoggedIn() {
    return !!getToken();
  }

  /* ── Get current user info from localStorage ── */
  function getUser() {
    if (!isLoggedIn()) return null;
    return {
      token: getToken(),
      grudgeId: localStorage.getItem(KEYS.grudgeId),
      username: localStorage.getItem(KEYS.username),
      provider: localStorage.getItem(KEYS.provider),
    };
  }

  /* ── Redirect to auth page if not logged in ── */
  function requireAuth(appSlug) {
    if (isLoggedIn()) return true;
    const slug = appSlug || getAppSlug();
    const redirect = encodeURIComponent(location.href);
    location.href = `${AUTH_PAGE}?redirect=${redirect}&app=${slug}`;
    return false;
  }

  /* ── Verify token against backend ── */
  async function verifyToken() {
    const token = getToken();
    if (!token) return null;
    try {
      const resp = await fetch(`${API_URL}/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        logout();
        return null;
      }
      return await resp.json();
    } catch {
      return null; // Network error — don't log out, might be offline
    }
  }

  /* ── Logout ── */
  function logout() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    // Also clear legacy keys
    localStorage.removeItem("grudge_session_token");
    localStorage.removeItem("grudge_studio_session");
    localStorage.removeItem("grudge_studio_user");
  }

  /* ── Logout and redirect to auth page ── */
  function logoutAndRedirect(appSlug) {
    logout();
    requireAuth(appSlug);
  }

  /* ── Get app slug from script tag data attribute ── */
  function getAppSlug() {
    const script = document.querySelector('script[data-app]');
    return script ? script.getAttribute("data-app") : "";
  }

  /* ── Auto-consume hash on load ── */
  consumeHash();

  /* ── Export ── */
  const GrudgeAuth = {
    AUTH_PAGE,
    API_URL,
    KEYS,
    consumeHash,
    getToken,
    isLoggedIn,
    getUser,
    requireAuth,
    verifyToken,
    logout,
    logoutAndRedirect,
  };

  // UMD export
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GrudgeAuth;
  } else {
    root.GrudgeAuth = GrudgeAuth;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
