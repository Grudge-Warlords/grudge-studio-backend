/**
 * GRUDGE SDK — Universal Browser Client
 * Drop this into ANY Grudge Studio frontend for instant auth + API + AI.
 *
 * Usage:
 *   <script src="https://js.puter.com/v2/"></script>
 *   <script src="grudge-sdk.js"></script>
 *   <script>
 *     await Grudge.auth.login('user', 'pass');
 *     const user = Grudge.auth.user();
 *     const recipes = await Grudge.api.get('/crafting/recipes');
 *     const ai = await Grudge.ai.chat('Generate a quest for a level 5 warrior');
 *   </script>
 *
 * All auth flows go through id.grudge-studio.com
 * All game data goes through api.grudge-studio.com
 * AI uses Puter.js (free, client-side) with backend fallback
 * NO direct database connections. Ever.
 *
 * @version 1.0.0
 * @license Grudge Studio — Racalvin The Pirate King
 */

(function(global) {
  'use strict';

  const ID_API = 'https://id.grudge-studio.com';
  const GAME_API = 'https://api.grudge-studio.com';
  const ACCOUNT_API = 'https://account.grudge-studio.com';
  const WS_URL = 'wss://ws.grudge-studio.com';
  const ASSETS_URL = 'https://assets.grudge-studio.com';
  const TOKEN_KEY = 'grudge_token';

  let _token = null;
  let _user = null;

  // ── Token management ────────────────────────────────────────
  function getToken() { return _token || sessionStorage.getItem(TOKEN_KEY); }
  function setToken(t) { _token = t; if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); }

  // ── HTTP helpers ────────────────────────────────────────────
  async function post(baseUrl, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  async function get(baseUrl, path) {
    const headers = {};
    const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(baseUrl + path, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  // ── Auth ─────────────────────────────────────────────────────
  const auth = {
    /** Login with username/email + password */
    async login(identifier, password) {
      const d = await post(ID_API, '/auth/login', { identifier, password });
      setToken(d.token); _user = d.user || d; return d;
    },

    /** Register new account */
    async register(username, password, email) {
      const d = await post(ID_API, '/auth/register', { username, password, email: email || undefined });
      setToken(d.token); _user = d.user || d; return d;
    },

    /** Guest login (instant, no credentials) */
    async guest() {
      const id = 'web_' + (crypto.randomUUID ? crypto.randomUUID().slice(0,12) : Math.random().toString(36).slice(2,14));
      const d = await post(ID_API, '/auth/guest', { deviceId: id });
      setToken(d.token); _user = d.user || d; return d;
    },

    /** Puter cloud login */
    async puter() {
      if (typeof puter === 'undefined' || !puter.auth) throw new Error('Puter SDK not loaded');
      await puter.auth.signIn();
      const pu = await puter.auth.getUser();
      const d = await post(ID_API, '/auth/puter', { puterUuid: pu.uuid, puterUsername: pu.username });
      setToken(d.token); _user = d.user || d; return d;
    },

    /** OAuth redirect (Discord, Google, GitHub) */
    oauth(provider, redirectUri) {
      const redir = redirectUri || window.location.origin + window.location.pathname;
      window.location.href = ID_API + '/auth/' + provider + '?redirect_uri=' + encodeURIComponent(redir);
    },
    discord(r) { auth.oauth('discord', r); },
    google(r) { auth.oauth('google', r); },
    github(r) { auth.oauth('github', r); },

    /** Wallet login (Phantom/Web3Auth) */
    async wallet(walletAddress, web3authToken) {
      const d = await post(ID_API, '/auth/wallet', { wallet_address: walletAddress, web3auth_token: web3authToken });
      setToken(d.token); _user = d.user || d; return d;
    },

    /** Get current user profile from token */
    async getUser() {
      if (!getToken()) return null;
      try {
        const d = await get(ID_API, '/auth/user');
        _user = d; return d;
      } catch { setToken(null); _user = null; return null; }
    },

    /** Return cached user (call getUser() first for fresh data) */
    user() { return _user; },

    /** Is user logged in? */
    isLoggedIn() { return !!getToken(); },

    /** Get the raw JWT token */
    token() { return getToken(); },

    /** Logout */
    async logout() {
      try { await post(ID_API, '/auth/logout', {}); } catch {}
      setToken(null); _user = null;
    },

    /** Check URL for OAuth callback token and initialize */
    async init() {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token') || params.get('sso_token');
      if (t) {
        setToken(t);
        window.history.replaceState({}, '', window.location.pathname);
      }
      if (getToken()) {
        try { await auth.getUser(); return true; } catch { return false; }
      }
      // Try Puter auto-login
      try {
        if (typeof puter !== 'undefined' && puter.auth && puter.auth.isSignedIn()) {
          const pu = await puter.auth.getUser();
          if (pu) { await auth.puter(); return true; }
        }
      } catch {}
      return false;
    },
  };

  // ── Game API ────────────────────────────────────────────────
  const api = {
    get(path) { return get(GAME_API, path); },
    post(path, body) { return post(GAME_API, path, body); },

    // Shortcuts
    async recipes(classFilter, tier) {
      let q = '/crafting/recipes?';
      if (classFilter) q += 'class=' + classFilter + '&';
      if (tier) q += 'tier=' + tier;
      return get(GAME_API, q);
    },
    leaderboard() { return get(GAME_API, '/combat/leaderboard'); },
    islands() { return get(GAME_API, '/islands'); },
    missions() { return get(GAME_API, '/missions'); },
    balance(charId) { return get(GAME_API, '/economy/balance?char_id=' + charId); },
  };

  // ── Account API ─────────────────────────────────────────────
  const account = {
    get(path) { return get(ACCOUNT_API, path); },
    post(path, body) { return post(ACCOUNT_API, path, body); },
    profile() { return get(ACCOUNT_API, '/profile'); },
  };

  // ── AI (Puter.js free + backend fallback) ───────────────────
  const ai = {
    /** Chat with AI — uses Puter.js (free) first, falls back to backend */
    async chat(message, opts) {
      // Try Puter.js first (FREE — user pays)
      if (typeof puter !== 'undefined' && puter.ai) {
        try {
          const resp = await puter.ai.chat(message, opts || {});
          return typeof resp === 'string' ? resp : (resp?.message?.content || resp?.toString() || '');
        } catch {}
      }
      // Fallback to backend AI proxy
      try {
        const d = await post(GAME_API, '/ai/chat', { message });
        return d.content || d.error || '';
      } catch (e) { return 'AI unavailable: ' + e.message; }
    },

    /** Stream AI response (Puter.js only) */
    async *stream(message, opts) {
      if (typeof puter !== 'undefined' && puter.ai) {
        const resp = await puter.ai.chat(message, { ...(opts || {}), stream: true });
        for await (const part of resp) {
          if (part?.text) yield part.text;
        }
      }
    },

    /** Generate image from text (Puter.js) */
    async image(prompt) {
      if (typeof puter !== 'undefined' && puter.ai) {
        return puter.ai.txt2img(prompt);
      }
      throw new Error('Puter SDK required for image generation');
    },
  };

  // ── Cloud storage via Puter.js ──────────────────────────────
  const cloud = {
    /** Save data to user's Puter cloud KV */
    async save(key, value) {
      if (typeof puter !== 'undefined' && puter.kv) {
        await puter.kv.set('grudge_' + key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
      }
      return false;
    },

    /** Load data from user's Puter cloud KV */
    async load(key) {
      if (typeof puter !== 'undefined' && puter.kv) {
        const v = await puter.kv.get('grudge_' + key);
        try { return JSON.parse(v); } catch { return v; }
      }
      return null;
    },

    /** Save file to user's Puter cloud */
    async saveFile(name, data) {
      if (typeof puter !== 'undefined' && puter.fs) {
        return puter.fs.write('grudge-studio/' + name, data, { createMissingParents: true });
      }
      throw new Error('Puter SDK required for cloud file storage');
    },
  };

  // ── Constants ───────────────────────────────────────────────
  const config = { ID_API, GAME_API, ACCOUNT_API, WS_URL, ASSETS_URL };

  // ── Export ──────────────────────────────────────────────────
  global.Grudge = { auth, api, account, ai, cloud, config };

})(typeof window !== 'undefined' ? window : globalThis);
