/**
 * Grudge Studio — Main Site Worker  v3.0
 * Serves grudge-studio.com — landing, status, docs, tools, admin, sub-pages
 *
 * Public routes:
 *   /           — Landing page with live status
 *   /backend    — Backend Architecture roadmap
 *   /client     — Client Portal (also client.grudge-studio.com)
 *   /infra      — Infrastructure Bible
 *   /systems    — Full Stack Master
 *   /api/status — JSON health data
 *   /tos, /privacy
 *
 * Admin routes (JWT-gated):
 *   /admin           — Dashboard redirect
 *   /admin/status    — Detailed service status
 *   /admin/users     — User management (proxies account API)
 *
 * Subdomains:
 *   client.grudge-studio.com — Client Portal
 *   wallet.grudge-studio.com — Wallet viewer
 *
 * Deploy:  npx wrangler deploy  (from cloudflare/workers/site/)
 */
import backendPage from './pages/backend.html';
import clientPage from './pages/client.html';
import infraPage from './pages/infra.html';
import systemsPage from './pages/systems.html';

const SERVICES = [
  { key: 'id',       label: 'Identity API',   url: 'https://id.grudge-studio.com/health' },
  { key: 'api',      label: 'Game API',        url: 'https://api.grudge-studio.com/health' },
  { key: 'account',  label: 'Account API',     url: 'https://account.grudge-studio.com/health' },
  { key: 'launcher', label: 'Launcher API',    url: 'https://launcher.grudge-studio.com/health' },
  { key: 'ws',       label: 'WebSocket',       url: 'https://ws.grudge-studio.com/health' },
  { key: 'assets',   label: 'Asset CDN',       url: 'https://assets.grudge-studio.com/health' },
];

const KV_STATUS_KEY  = 'status:latest';
const KV_LAST_OK_KEY = 'status:lastAllOk';
const KV_MODE_KEY    = 'status:mode';
const STATUS_TTL     = 300;  // KV expiration (seconds) — safety net if cron stops
const STALE_THRESHOLD = 90;  // if cache older than this, trigger live refresh

// ── Route dispatcher ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;
    const path = url.pathname;

    // Subdomain routing
    if (host === 'client.grudge-studio.com') return Response.redirect('https://id.grudge-studio.com/device', 301);
    if (host === 'wallet.grudge-studio.com') return handleWalletPage(env);

    // CORS preflight
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });

    // ── SSO-based root redirect ─────────────────────────────────────
    // grudge-studio.com/ → logged in → The Engine, not logged in → client portal
    if (path === '/' && host === 'grudge-studio.com') {
      const ssoToken = url.searchParams.get('sso_token');
      const ssoRequired = url.searchParams.get('sso_required');

      if (ssoToken) {
        // User has a valid session → send to The Engine
        return Response.redirect('https://the-engine-grudgenexus.vercel.app', 302);
      }
      if (ssoRequired) {
      // No session → send to device/auth portal for login
        return Response.redirect('https://id.grudge-studio.com/device', 302);
      }
      // First visit — ask grudge-id to check the SSO cookie and redirect back
      return Response.redirect(
        `https://id.grudge-studio.com/auth/sso-check?return=${encodeURIComponent('https://grudge-studio.com/')}`,
        302
      );
    }

    // API routes
    if (path === '/api/status') return handleStatus(env, ctx);
    if (path === '/api/docs.json') return handleDocsJson();
    if (path === '/discord/events') return handleDiscordWebhookEvent(request, env);

    // Admin routes (JWT-gated)
    if (path.startsWith('/admin')) return handleAdmin(request, path, env);

    // Public pages
    if (path === '/tos') return handleTos();
    if (path === '/privacy') return handlePrivacy();
    if (path === '/backend') return serveHTML(backendPage);
    if (path === '/client') return serveHTML(clientPage);
    if (path === '/infra') return serveHTML(infraPage);
    if (path === '/systems') return serveHTML(systemsPage);
    if (path === '/landing') return handlePage(env);  // old landing still accessible
    return handlePage(env);
  },

  // Cron Trigger — runs every minute, refreshes health checks in KV
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshStatus(env));
  },
};

// ── Core health-check runner (used by cron AND fallback) ─────────────────────
async function runHealthChecks() {
  const checks = await Promise.allSettled(
    SERVICES.map(async (svc) => {
      const start = Date.now();
      try {
        const r = await fetch(svc.url, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'GrudgeStudio-StatusCheck/2.0' },
        });
        const body = await r.json().catch(() => ({}));
        return {
          key: svc.key,
          label: svc.label,
          status: r.ok ? 'ok' : 'degraded',
          latency: Date.now() - start,
          code: r.status,
        };
      } catch (e) {
        return {
          key: svc.key,
          label: svc.label,
          status: 'down',
          latency: null,
          code: null,
          error: e?.message || 'timeout',
        };
      }
    })
  );
  return checks.map(r => r.value ?? r.reason);
}

// ── Refresh status and persist to KV ─────────────────────────────────────────
async function refreshStatus(env) {
  const services = await runHealthChecks();
  const allOk = services.every(s => s.status === 'ok');
  const now = new Date().toISOString();

  // Preserve lastAllOk from previous run if not all ok now
  let lastAllOk = null;
  if (allOk) {
    lastAllOk = now;
  } else if (env.STATUS_KV) {
    lastAllOk = await env.STATUS_KV.get(KV_LAST_OK_KEY);
  }

  const payload = {
    ok: allOk,
    mode: 'live',
    services,
    lastChecked: now,
    lastAllOk,
    cached: false,
  };

  if (env.STATUS_KV) {
    await Promise.all([
      env.STATUS_KV.put(KV_STATUS_KEY, JSON.stringify(payload), { expirationTtl: STATUS_TTL }),
      allOk ? env.STATUS_KV.put(KV_LAST_OK_KEY, now) : Promise.resolve(),
    ]);
  }

  return payload;
}

// ── /api/status handler (KV-first, live fallback) ────────────────────────────
async function handleStatus(env, ctx) {
  // Check maintenance mode
  if (env.STATUS_KV) {
    const mode = await env.STATUS_KV.get(KV_MODE_KEY);
    if (mode === 'maintenance') {
      return Response.json(
        {
          ok: false,
          mode: 'maintenance',
          message: 'Scheduled maintenance in progress',
          services: SERVICES.map(s => ({ key: s.key, label: s.label, status: 'maintenance', latency: null })),
          lastChecked: new Date().toISOString(),
          lastAllOk: await env.STATUS_KV.get(KV_LAST_OK_KEY),
          cached: false,
        },
        { headers: statusHeaders() }
      );
    }
  }

  // Serve from KV cache
  if (env.STATUS_KV) {
    const raw = await env.STATUS_KV.get(KV_STATUS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const age = (Date.now() - new Date(data.lastChecked).getTime()) / 1000;

      // If cache is getting stale, trigger a background refresh (non-blocking)
      if (age > STALE_THRESHOLD) {
        ctx.waitUntil(refreshStatus(env));
      }

      data.cached = true;
      data.cacheAge = Math.round(age);
      return Response.json(data, { headers: statusHeaders() });
    }
  }

  // No KV or empty cache — run live (first request after deploy)
  const payload = await refreshStatus(env);
  return Response.json(payload, { headers: statusHeaders() });
}

function statusHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Status-Version': '2.0',
  };
}

// ── Serve static HTML pages (imported as text modules) ────────────────────
function serveHTML(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ── Admin routes (JWT-gated) ─────────────────────────────────────────
async function handleAdmin(request, path, env) {
  // Admin login page (no auth needed)
  if (path === '/admin' || path === '/admin/login') {
    return serveHTML(adminLoginPage());
  }

  // All other /admin/* routes need a valid JWT
  const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                new URL(request.url).searchParams.get('token');

  if (!token) {
    return Response.json({ error: 'Authentication required', login: '/admin/login' }, { status: 401 });
  }

  // Verify JWT via grudge-id
  try {
    const verifyRes = await fetch(`${env.IDENTITY_API || 'https://id.grudge-studio.com'}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!verifyRes.ok) return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    const { payload } = await verifyRes.json();

    // Admin routes
    if (path === '/admin/status') {
      const status = await refreshStatus(env);
      return Response.json({ ...status, admin: true, user: payload.username }, { headers: statusHeaders() });
    }

    if (path === '/admin/dashboard') {
      return serveHTML(adminDashboardPage(payload));
    }

    return Response.json({ error: 'Not found', routes: ['/admin/dashboard', '/admin/status'] }, { status: 404 });
  } catch (e) {
    return Response.json({ error: 'Auth service unavailable' }, { status: 503 });
  }
}

function adminLoginPage() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Grudge Studio</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',sans-serif;background:#0a0a0f;color:#e8e8e8;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .box{background:#12121a;border:1px solid #2a2a3a;border-radius:12px;padding:40px;width:100%;max-width:420px}
  h1{font-family:'Cinzel',serif;color:#d4af37;font-size:20px;margin-bottom:4px;text-align:center}
  .sub{text-align:center;color:#666;font-size:12px;letter-spacing:2px;margin-bottom:32px}
  label{display:block;font-size:11px;color:#666;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px}
  input{width:100%;padding:10px 14px;background:#0a0a12;border:1px solid #2a2a3a;border-radius:6px;color:#e8e8e8;font-size:14px;margin-bottom:16px;outline:none}
  input:focus{border-color:#d4af37}
  .btn{width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#8b7355);color:#000;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:1px}
  .btn:hover{filter:brightness(1.15)}
  .or{text-align:center;color:#444;font-size:11px;margin:16px 0;letter-spacing:2px}
  .oauth{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .oauth a{padding:10px;text-align:center;background:#1a1a25;border:1px solid #2a2a3a;border-radius:6px;color:#888;text-decoration:none;font-size:12px;transition:all .2s}
  .oauth a:hover{border-color:#d4af37;color:#d4af37}
  #err{color:#c33;font-size:12px;text-align:center;margin-top:12px;display:none}
  .back{display:block;text-align:center;color:#555;font-size:12px;margin-top:20px;text-decoration:none}
  .back:hover{color:#d4af37}
</style></head><body>
<div class="box">
  <h1>GRUDGE ADMIN</h1>
  <div class="sub">STUDIO ADMINISTRATION</div>
  <form onsubmit="return doLogin(event)">
    <label>Username / Email</label>
    <input id="user" type="text" placeholder="admin" autocomplete="username">
    <label>Password</label>
    <input id="pass" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password">
    <button class="btn" type="submit">\u2694 SIGN IN</button>
  </form>
  <div class="or">OR SIGN IN WITH</div>
  <div class="oauth">
    <a href="https://id.grudge-studio.com/auth/discord?redirect_uri=https://grudge-studio.com/admin/dashboard">\ud83c\udfae Discord</a>
    <a href="https://id.grudge-studio.com/auth/google?redirect_uri=https://grudge-studio.com/admin/dashboard">\ud83d\udd34 Google</a>
    <a href="https://id.grudge-studio.com/auth/github?redirect_uri=https://grudge-studio.com/admin/dashboard">\ud83d\udc19 GitHub</a>
    <a href="javascript:guestLogin()">\u25b7 Guest</a>
  </div>
  <div id="err"></div>
  <a class="back" href="/">\u2190 grudge-studio.com</a>
</div>
<script>
const ID_API = 'https://id.grudge-studio.com';

// Check for OAuth callback token
const p = new URLSearchParams(location.search);
const t = p.get('token');
if (t) { sessionStorage.setItem('admin_token', t); location.href = '/admin/dashboard?token=' + t; }

async function doLogin(e) {
  e.preventDefault();
  const user = document.getElementById('user').value;
  const pass = document.getElementById('pass').value;
  if (!user || !pass) return showErr('Username and password required');
  try {
    const r = await fetch(ID_API + '/auth/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({identifier: user, password: pass})
    });
    const d = await r.json();
    if (d.token) { sessionStorage.setItem('admin_token', d.token); location.href = '/admin/dashboard?token=' + d.token; }
    else showErr(d.error || 'Login failed');
  } catch(e) { showErr('Connection failed'); }
}
async function guestLogin() {
  try {
    const r = await fetch(ID_API + '/auth/guest', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({deviceId: 'admin_' + Math.random().toString(36).slice(2,8)})
    });
    const d = await r.json();
    if (d.token) { sessionStorage.setItem('admin_token', d.token); location.href = '/admin/dashboard?token=' + d.token; }
    else showErr(d.error || 'Guest login failed');
  } catch(e) { showErr('Connection failed'); }
}
function showErr(m) { const e = document.getElementById('err'); e.textContent = m; e.style.display = 'block'; setTimeout(() => e.style.display = 'none', 4000); }
</script>
</body></html>`;
}

function adminDashboardPage(user) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard — Grudge Studio</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',sans-serif;background:#0a0a0f;color:#e8e8e8;min-height:100vh}
  nav{background:#12121a;border-bottom:1px solid #2a2a3a;padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
  .logo{font-family:'Cinzel',serif;color:#d4af37;font-size:16px;letter-spacing:2px}
  .user{color:#888;font-size:12px;letter-spacing:1px}
  .user strong{color:#d4af37}
  .logout{color:#555;font-size:11px;margin-left:16px;cursor:pointer;text-decoration:underline}
  .logout:hover{color:#c33}
  main{max-width:1100px;margin:0 auto;padding:32px 24px}
  h2{font-family:'Cinzel',serif;color:#d4af37;font-size:18px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:32px}
  .card{background:#12121a;border:1px solid #2a2a3a;border-radius:10px;padding:20px}
  .card h3{color:#d4af37;font-size:14px;margin-bottom:12px;letter-spacing:1px}
  .card p{color:#888;font-size:13px;line-height:1.6}
  .card a{color:#d4af37;text-decoration:none;font-size:12px;display:inline-block;margin-top:10px;padding:6px 14px;border:1px solid #2a2a3a;border-radius:4px}
  .card a:hover{border-color:#d4af37;background:rgba(212,175,55,0.08)}
  .status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
  .s-item{background:#1a1a25;border:1px solid #2a2a3a;border-radius:8px;padding:14px;text-align:center}
  .s-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .s-ok{background:#33aa55;box-shadow:0 0 4px #33aa55}
  .s-down{background:#cc3333;box-shadow:0 0 4px #cc3333}
  .s-label{font-size:12px;color:#888}
  .s-ms{font-size:11px;color:#555;margin-top:4px}
  .links{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
  .links a{padding:8px 16px;background:#1a1a25;border:1px solid #2a2a3a;border-radius:6px;color:#888;text-decoration:none;font-size:12px}
  .links a:hover{border-color:#d4af37;color:#d4af37}
</style></head><body>
<nav>
  <div class="logo">GRUDGE ADMIN</div>
  <div class="user">Signed in as <strong>${user?.username || 'admin'}</strong> <span class="logout" onclick="sessionStorage.removeItem('admin_token');location.href='/admin'">logout</span></div>
</nav>
<main>
  <h2>Service Status</h2>
  <div class="status-grid" id="status-grid">Loading...</div>

  <h2 style="margin-top:32px">Quick Access</h2>
  <div class="grid">
    <div class="card"><h3>\ud83d\udcca Dashboard</h3><p>Full admin dashboard with user management, economy auditing, and service controls.</p><a href="https://dash.grudge-studio.com" target="_blank">Open Dashboard \u2192</a></div>
    <div class="card"><h3>\ud83d\udd27 Backend Docs</h3><p>Architecture roadmap, API patterns, database schema, deployment guide.</p><a href="/backend">View Backend \u2192</a></div>
    <div class="card"><h3>\ud83c\udfd7\ufe0f Infrastructure</h3><p>Docker services, env vars, shared libs, audit checklist.</p><a href="/infra">View Infra \u2192</a></div>
    <div class="card"><h3>\ud83d\udda5\ufe0f Systems</h3><p>Full stack overview, Vercel projects, Puter apps, rendering standards.</p><a href="/systems">View Systems \u2192</a></div>
    <div class="card"><h3>\ud83c\udfae Client Portal</h3><p>Player login, account management, connected services, apps.</p><a href="/client">View Client \u2192</a></div>
    <div class="card"><h3>\ud83d\udcb0 Wallet</h3><p>Server-side Solana wallet viewer and NFT holdings.</p><a href="https://wallet.grudge-studio.com" target="_blank">View Wallet \u2192</a></div>
    <div class="card"><h3>\ud83d\udce6 Assets CDN</h3><p>Browse R2 asset bucket \u2014 textures, models, sprites.</p><a href="https://assets.grudge-studio.com" target="_blank">Browse \u2192</a></div>
    <div class="card"><h3>\ud83d\udcc4 API Spec</h3><p>OpenAPI 3.0 spec for the Game API.</p><a href="/api/docs.json" target="_blank">View Spec \u2192</a></div>
  </div>

  <h2>Pages</h2>
  <div class="links">
    <a href="/">Home</a>
    <a href="/backend">Backend</a>
    <a href="/infra">Infrastructure</a>
    <a href="/systems">Systems</a>
    <a href="/client">Client Portal</a>
    <a href="https://id.grudge-studio.com/device" target="_blank">id.grudge-studio.com/device</a>
    <a href="https://wallet.grudge-studio.com" target="_blank">wallet.grudge-studio.com</a>
    <a href="https://dash.grudge-studio.com" target="_blank">dash.grudge-studio.com</a>
    <a href="/api/status">API Status (JSON)</a>
    <a href="/tos">Terms</a>
    <a href="/privacy">Privacy</a>
  </div>
</main>
<script>
async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const grid = document.getElementById('status-grid');
    grid.innerHTML = d.services.map(s => {
      const ok = s.status === 'ok';
      return '<div class="s-item"><span class="s-dot '+(ok?'s-ok':'s-down')+'"></span><span class="s-label">'+s.label+'</span><div class="s-ms">'+(s.latency?s.latency+'ms':'--')+'</div></div>';
    }).join('');
  } catch(e) { document.getElementById('status-grid').innerHTML = '<div style="color:#c33">Failed to load status</div>'; }
}
loadStatus();
setInterval(loadStatus, 30000);
</script>
</body></html>`;
}

// ── wallet.grudge-studio.com page ─────────────────────────────────────
function handleWalletPage(env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Grudge Studio — Wallet</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0a0f;--bg2:#12121a;--border:#2a2a3a;--gold:#d4af37;--gold-dim:#8b7355;--text:#e8e8e8;--dim:#888;--green:#33aa55;--purple:#8855cc}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px}
  .logo{font-family:'Cinzel',serif;font-size:28px;color:var(--gold);letter-spacing:2px;margin-bottom:8px}
  .sub{color:var(--dim);font-size:14px;letter-spacing:3px;text-transform:uppercase;margin-bottom:48px}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:36px;max-width:500px;width:100%;text-align:center}
  .card h2{font-family:'Cinzel',serif;color:var(--gold);font-size:20px;margin-bottom:16px}
  .card p{color:var(--dim);font-size:14px;line-height:1.7;margin-bottom:28px}
  .wallet-addr{background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:16px;font-family:monospace;font-size:13px;color:var(--purple);word-break:break-all;margin-bottom:20px;display:none}
  .btn{padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all .2s}
  .btn-primary{background:linear-gradient(135deg,var(--gold),var(--gold-dim));color:#000}
  .btn-primary:hover{filter:brightness(1.15);transform:translateY(-2px)}
  .btn-outline{background:transparent;border:1px solid var(--border);color:var(--text);margin-left:12px}
  .btn-outline:hover{border-color:var(--gold);color:var(--gold)}
  .features{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:36px;max-width:500px;width:100%}
  .feat{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:18px;text-align:left}
  .feat h4{color:var(--gold);font-size:13px;margin-bottom:6px}
  .feat p{color:var(--dim);font-size:12px;line-height:1.5}
  .back{color:var(--dim);font-size:13px;margin-top:32px;text-decoration:none}
  .back:hover{color:var(--gold)}
  #status{font-size:12px;color:var(--dim);margin-top:12px}
</style>
</head>
<body>
  <div class="logo">GRUDGE STUDIO</div>
  <div class="sub">Server-Side Wallet</div>
  <div class="card">
    <h2>◎ Solana Wallet</h2>
    <p>Your server-side Solana wallet is managed securely by the Grudge backend. Connect your account to view your wallet address, balance, and transaction history.</p>
    <div class="wallet-addr" id="wallet-addr"></div>
    <div>
      <button class="btn btn-primary" onclick="connectWallet()">Connect Account</button>
      <a href="https://grudge-studio.com" class="btn btn-outline">Back to Studio</a>
    </div>
    <div id="status"></div>
  </div>
  <div class="features">
    <div class="feat"><h4>🔒 Server-Side Custody</h4><p>Your wallet private key is stored securely on the Grudge VPS — never exposed to the browser.</p></div>
    <div class="feat"><h4>💰 GBux Balance</h4><p>View your in-game gold and on-chain token balance in one place.</p></div>
    <div class="feat"><h4>⛓️ NFT Holdings</h4><p>See your minted character and island cNFTs from Grudge Warlords.</p></div>
    <div class="feat"><h4>📊 Transaction History</h4><p>Full ledger of all wallet activity — mints, transfers, and rewards.</p></div>
  </div>
  <a class="back" href="https://grudge-studio.com">← grudge-studio.com</a>
<script>
async function connectWallet() {
  document.getElementById('status').textContent = 'Redirecting to login...';
  // Redirect to id.grudge-studio.com for auth, then back here with JWT
  const redirectUrl = encodeURIComponent('https://wallet.grudge-studio.com');
  window.location.href = 'https://id.grudge-studio.com/auth/web3auth?redirect=' + redirectUrl;
}
// Check if we have a token in the URL hash (returned from auth)
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
if (token) {
  (async () => {
    try {
      const res = await fetch('${env.ACCOUNT_API || 'https://account.grudge-studio.com'}/profile/wallet', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.wallet_address) {
        document.getElementById('wallet-addr').style.display = 'block';
        document.getElementById('wallet-addr').textContent = data.wallet_address;
        document.getElementById('status').textContent = 'Wallet loaded \u2714';
      } else {
        document.getElementById('status').textContent = 'No wallet found — one will be created on first game login.';
      }
    } catch(e) {
      document.getElementById('status').textContent = 'Error loading wallet: ' + e.message;
    }
  })();
}
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

// ── Minimal OpenAPI reference ────────────────────────────────────────────────
function handleDocsJson() {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Grudge Studio API', version: '2.0.0', description: 'Game API for Grudge Warlords' },
    servers: [{ url: 'https://api.grudge-studio.com', description: 'Production' }],
    tags: [
      { name: 'Economy', description: 'Gold balances and transactions' },
      { name: 'Crafting', description: 'Recipes, queue, and completion' },
      { name: 'Combat', description: 'Combat logging and leaderboards' },
      { name: 'Islands', description: 'Island state and claiming' },
      { name: 'Missions', description: 'Mission management' },
      { name: 'Crews', description: 'Crew formation and base claiming' },
      { name: 'Characters', description: 'Character CRUD' },
    ],
    paths: {
      '/economy/balance': {
        get: { tags: ['Economy'], summary: 'Get gold balance', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'char_id', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Balance + last 20 transactions' } } }
      },
      '/economy/spend': {
        post: { tags: ['Economy'], summary: 'Deduct gold', security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            properties: { char_id: { type: 'integer' }, amount: { type: 'integer' }, type: { type: 'string', enum: ['purchase','craft_cost'] } }
          }}}},
          responses: { 200: { description: 'New balance' }, 400: { description: 'Insufficient gold' } } }
      },
      '/economy/transfer': {
        post: { tags: ['Economy'], summary: 'Player-to-player gold transfer', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Transfer confirmed' } } }
      },
      '/crafting/recipes': {
        get: { tags: ['Crafting'], summary: 'List all recipes (optional ?class=warrior&tier=3)',
          responses: { 200: { description: 'Recipe list' } } }
      },
      '/crafting/queue': {
        get: { tags: ['Crafting'], summary: 'Get crafting queue for authenticated user', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Queue items' } } }
      },
      '/crafting/start': {
        post: { tags: ['Crafting'], summary: 'Start crafting an item', security: [{ bearerAuth: [] }],
          responses: { 201: { description: 'Queue entry created' }, 400: { description: 'Requirements not met' } } }
      },
      '/combat/history': {
        get: { tags: ['Combat'], summary: 'Get combat history for a character', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Combat log entries' } } }
      },
      '/combat/leaderboard': {
        get: { tags: ['Combat'], summary: 'Top 25 by kills', responses: { 200: { description: 'Leaderboard' } } }
      },
      '/islands': {
        get: { tags: ['Islands'], summary: 'List all islands and their state', responses: { 200: { description: 'Island list' } } }
      },
      '/missions': {
        get: { tags: ['Missions'], summary: 'List missions for authenticated user', security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Mission list' } } }
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
    }
  };
  return Response.json(spec, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

// ── Main HTML page ───────────────────────────────────────────────────────────
function handlePage(env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Grudge Studio — Game Development Platform</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:        #0a0a0f;
    --bg-panel:  #12121a;
    --bg-card:   #1a1a25;
    --border:    #2a2a3a;
    --gold:      #d4af37;
    --gold-dim:  #8b7355;
    --gold-glow: rgba(212,175,55,0.15);
    --red:       #cc3333;
    --green:     #33aa55;
    --blue:      #3388cc;
    --purple:    #8855cc;
    --text:      #e8e8e8;
    --text-dim:  #888;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{font-family:'Roboto',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}

  /* ── Nav ─────────────────────────────────────── */
  nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,10,15,0.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:60px}
  .nav-logo{font-family:'Cinzel',serif;font-size:20px;color:var(--gold);letter-spacing:2px;text-decoration:none}
  .nav-links{display:flex;gap:4px}
  .nav-links a{padding:8px 16px;color:var(--text-dim);text-decoration:none;border-radius:6px;font-size:14px;transition:all .2s}
  .nav-links a:hover{color:var(--gold);background:var(--gold-glow)}
  .nav-cta{padding:8px 18px;background:linear-gradient(135deg,var(--gold),var(--gold-dim));color:#000;border-radius:6px;font-weight:500;font-size:14px;text-decoration:none;transition:filter .2s}
  .nav-cta:hover{filter:brightness(1.15)}

  /* ── Hero ────────────────────────────────────── */
  .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 32px 80px;position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 50% 30%,rgba(212,175,55,0.06) 0%,transparent 70%);pointer-events:none}
  .hero-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border:1px solid var(--border);border-radius:20px;font-size:12px;color:var(--text-dim);margin-bottom:32px;letter-spacing:1px;text-transform:uppercase}
  .hero-badge span{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .hero h1{font-family:'Cinzel',serif;font-size:clamp(2.5rem,6vw,5rem);font-weight:700;line-height:1.1;margin-bottom:24px;letter-spacing:2px}
  .hero h1 span{background:linear-gradient(135deg,var(--gold),var(--gold-dim));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .hero p{font-size:1.2rem;color:var(--text-dim);max-width:600px;line-height:1.7;margin-bottom:40px}
  .hero-actions{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
  .btn-primary{padding:14px 32px;background:linear-gradient(135deg,var(--gold),var(--gold-dim));color:#000;border-radius:8px;font-weight:600;font-size:16px;text-decoration:none;transition:all .2s;border:none;cursor:pointer}
  .btn-primary:hover{transform:translateY(-2px);filter:brightness(1.1);box-shadow:0 8px 24px rgba(212,175,55,0.3)}
  .btn-outline{padding:14px 32px;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:16px;text-decoration:none;transition:all .2s;cursor:pointer}
  .btn-outline:hover{border-color:var(--gold);color:var(--gold);transform:translateY(-2px)}
  .hero-scroll{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);color:var(--text-dim);font-size:12px;letter-spacing:2px;text-transform:uppercase;display:flex;flex-direction:column;align-items:center;gap:8px}
  .scroll-arrow{width:20px;height:20px;border-right:2px solid var(--text-dim);border-bottom:2px solid var(--text-dim);transform:rotate(45deg);animation:scrollDown 1.6s infinite}
  @keyframes scrollDown{0%,100%{transform:rotate(45deg) translateY(-4px);opacity:.3}50%{transform:rotate(45deg) translateY(4px);opacity:1}}

  /* ── Sections ───────────────────────────────── */
  section{padding:100px 32px;max-width:1200px;margin:0 auto}
  .section-label{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:12px}
  .section-title{font-family:'Cinzel',serif;font-size:clamp(1.8rem,4vw,2.8rem);margin-bottom:16px}
  .section-sub{color:var(--text-dim);font-size:1.05rem;max-width:600px;line-height:1.7;margin-bottom:60px}

  /* ── Feature cards ──────────────────────────── */
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
  .card{background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;padding:28px;transition:all .3s;position:relative;overflow:hidden}
  .card::before{content:'';position:absolute;inset:0;background:var(--gold-glow);opacity:0;transition:opacity .3s}
  .card:hover{border-color:var(--gold-dim);transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,0.4)}
  .card:hover::before{opacity:1}
  .card-icon{font-size:36px;margin-bottom:16px}
  .card h3{font-family:'Cinzel',serif;color:var(--gold);margin-bottom:10px;font-size:1.1rem}
  .card p{color:var(--text-dim);font-size:.9rem;line-height:1.6}
  .card-tag{display:inline-block;padding:3px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;font-size:11px;color:var(--text-dim);margin-top:14px;letter-spacing:1px}

  /* ── Status panel ───────────────────────────── */
  #status-section{background:var(--bg-panel);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  #status-section > .inner{max-width:1200px;margin:0 auto;padding:80px 32px}
  .status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:40px}
  .status-item{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:20px 18px;display:flex;flex-direction:column;gap:10px}
  .status-item .s-label{font-size:13px;color:var(--text-dim)}
  .status-item .s-dot{width:10px;height:10px;border-radius:50%;background:#555;display:inline-block;margin-right:6px;transition:background .4s}
  .status-item .s-dot.ok{background:var(--green);box-shadow:0 0 6px var(--green)}
  .status-item .s-dot.degraded{background:#f90;box-shadow:0 0 6px #f90}
  .status-item .s-dot.down{background:var(--red);box-shadow:0 0 6px var(--red)}
  .status-item .s-status{font-size:13px;font-weight:500;color:var(--text)}
  .status-item .s-latency{font-size:11px;color:var(--text-dim)}
  #overall-status{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--text-dim)}
  #overall-status .big-dot{width:14px;height:14px;border-radius:50%;background:#555;transition:background .4s}
  #overall-status .big-dot.ok{background:var(--green);box-shadow:0 0 10px var(--green)}
  #overall-status .big-dot.maintenance{background:var(--blue);box-shadow:0 0 10px var(--blue)}
  .status-item .s-dot.maintenance{background:var(--blue);box-shadow:0 0 6px var(--blue)}
  .status-meta{font-size:11px;color:var(--text-dim);margin-top:12px;display:flex;gap:16px;flex-wrap:wrap}
  .maintenance-banner{background:rgba(51,136,204,0.1);border:1px solid rgba(51,136,204,0.3);border-radius:8px;padding:14px 20px;margin-bottom:20px;color:var(--blue);font-size:.9rem;display:none}

  /* ── API Docs preview ───────────────────────── */
  .endpoints{display:flex;flex-direction:column;gap:12px}
  .endpoint{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:16px 20px;display:flex;align-items:center;gap:16px;font-size:.9rem;transition:border-color .2s}
  .endpoint:hover{border-color:var(--gold-dim)}
  .method{padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.5px;min-width:44px;text-align:center}
  .GET{background:rgba(51,136,204,.2);color:#7ac;border:1px solid rgba(51,136,204,.3)}
  .POST{background:rgba(51,170,85,.2);color:#7c7;border:1px solid rgba(51,170,85,.3)}
  .PATCH{background:rgba(212,175,55,.15);color:#ca8;border:1px solid rgba(212,175,55,.25)}
  .DELETE{background:rgba(204,51,51,.2);color:#c77;border:1px solid rgba(204,51,51,.3)}
  .endpoint-path{font-family:monospace;color:var(--text);flex:1}
  .endpoint-desc{color:var(--text-dim);font-size:.85rem}
  .docs-link{display:inline-flex;align-items:center;gap:8px;margin-top:28px;color:var(--gold);text-decoration:none;font-size:.9rem;padding:10px 20px;border:1px solid var(--gold-dim);border-radius:6px;transition:all .2s}
  .docs-link:hover{background:var(--gold-glow);transform:translateX(4px)}

  /* ── Tools section ──────────────────────────── */
  .tools-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}
  .tool-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;padding:28px;display:flex;flex-direction:column;gap:12px}
  .tool-card h3{font-family:'Cinzel',serif;color:var(--gold);font-size:1.1rem}
  .tool-card p{color:var(--text-dim);font-size:.9rem;line-height:1.6;flex:1}
  .tool-card a{align-self:flex-start;padding:9px 20px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text);text-decoration:none;font-size:.85rem;transition:all .2s}
  .tool-card a:hover{border-color:var(--gold);color:var(--gold)}

  /* ── Footer ─────────────────────────────────── */
  footer{background:var(--bg-panel);border-top:1px solid var(--border);padding:48px 32px;text-align:center}
  footer .f-logo{font-family:'Cinzel',serif;font-size:22px;color:var(--gold);margin-bottom:16px}
  footer p{color:var(--text-dim);font-size:.85rem;margin-bottom:24px}
  .f-links{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
  .f-links a{color:var(--text-dim);text-decoration:none;font-size:.85rem;transition:color .2s}
  .f-links a:hover{color:var(--gold)}
  .f-divider{width:1px;background:var(--border);align-self:stretch}

  /* ── Divider ─────────────────────────────────── */
  .hr{height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);margin:0 32px}

  @media(max-width:640px){
    nav{padding:0 16px}
    .nav-links{display:none}
    section{padding:70px 20px}
    .hero{padding:100px 20px 60px}
  }
</style>
</head>
<body>

<!-- NAV -->
<nav>
  <a class="nav-logo" href="#">GRUDGE STUDIO</a>
  <div class="nav-links">
    <a href="#platform">Platform</a>
    <a href="#status">Status</a>
    <a href="#api">API</a>
    <a href="#tools">Tools</a>
    <a href="#games">Games & Apps</a>
    <a href="/backend">Backend</a>
    <a href="/infra">Infra</a>
    <a href="/systems">Systems</a>
    <a href="/client">Client</a>
  </div>
    <a class="nav-cta" href="https://id.grudge-studio.com/device" target="_blank">Auth Portal</a>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-badge"><span style="background:#888"></span>Checking status…</div>
  <h1>Build the<br><span>Grudge Universe</span></h1>
  <p>A full-stack game development platform for Grudge Warlords — identity, economy, crafting, combat, islands, and real-time WebSocket infrastructure.</p>
  <div class="hero-actions">
    <a class="btn-primary" href="https://dash.grudge-studio.com" target="_blank">Open Dashboard</a>
    <a class="btn-outline" href="#api">API Reference</a>
  </div>
  <div class="hero-scroll">scroll<div class="scroll-arrow"></div></div>
</div>

<div class="hr"></div>

<!-- PLATFORM -->
<section id="platform">
  <div class="section-label">Platform</div>
  <h2 class="section-title">Everything in one place</h2>
  <p class="section-sub">Six production services, fully containerised, TLS-terminated, and connected through a shared MySQL + Redis layer.</p>
  <div class="cards">
    <div class="card">
      <div class="card-icon">🪪</div>
      <h3>Grudge Identity</h3>
      <p>Web3Auth / Solana wallet login with JWKS verification, Turnstile bot protection, and ban enforcement. Issues signed JWTs consumed by all downstream services.</p>
      <span class="card-tag">id.grudge-studio.com</span>
    </div>
    <div class="card">
      <div class="card-icon">⚔️</div>
      <h3>Game API</h3>
      <p>REST endpoints for economy (gold), crafting queue, combat logging, island state, missions, crew management, and character CRUD — all gated by JWT auth.</p>
      <span class="card-tag">api.grudge-studio.com</span>
    </div>
    <div class="card">
      <div class="card-icon">🔌</div>
      <h3>WebSocket Service</h3>
      <p>Socket.IO server with three namespaces: /game (island rooms), /crew, and /global. Redis pub/sub bridges events across processes. Z-key battle cry broadcast.</p>
      <span class="card-tag">ws.grudge-studio.com</span>
    </div>
    <div class="card">
      <div class="card-icon">🗄️</div>
      <h3>Asset CDN</h3>
      <p>Cloudflare R2-backed CDN serving textures, models, audio, and sprites with smart caching headers and a structured bucket layout per asset type.</p>
      <span class="card-tag">assets.grudge-studio.com</span>
    </div>
    <div class="card">
      <div class="card-icon">🧑‍💼</div>
      <h3>Account Service</h3>
      <p>Player profile management, wallet linking, Discord OAuth, and faction affiliation. Bridges Grudge IDs to in-game character data.</p>
      <span class="card-tag">account.grudge-studio.com</span>
    </div>
    <div class="card">
      <div class="card-icon">🚀</div>
      <h3>Launcher API</h3>
      <p>Patch manifest delivery, version gating, and secure binary download token generation. Supports auto-update workflows for the game client.</p>
      <span class="card-tag">launcher.grudge-studio.com</span>
    </div>
  </div>
</section>

<div class="hr"></div>

<!-- STATUS -->
<div id="status-section">
  <div class="inner">
    <div class="section-label">Live Status</div>
    <h2 class="section-title">Service Health</h2>
    <div class="maintenance-banner" id="maint-banner">🔧 Scheduled maintenance in progress — services will return shortly.</div>
    <div id="overall-status">
      <div class="big-dot" id="overall-dot"></div>
      <span id="overall-text">Checking services…</span>
    </div>
    <div class="status-grid" id="status-grid">
      ${SERVICES.map(s => `
      <div class="status-item" id="s-${s.key}">
        <div class="s-label">${s.label}</div>
        <div><span class="s-dot" id="dot-${s.key}"></span><span class="s-status" id="st-${s.key}">—</span></div>
        <div class="s-latency" id="lat-${s.key}"></div>
      </div>`).join('')}
    </div>
    <div class="status-meta" id="status-meta"></div>
  </div>
</div>

<div class="hr"></div>

<!-- API REFERENCE -->
<section id="api">
  <div class="section-label">API Reference</div>
  <h2 class="section-title">REST Endpoints</h2>
  <p class="section-sub">All endpoints require a Bearer JWT issued by the Identity API unless marked Internal.</p>
  <div class="endpoints">
    <div class="endpoint"><span class="method GET">GET</span><span class="endpoint-path">/economy/balance</span><span class="endpoint-desc">Gold balance + last 20 transactions</span></div>
    <div class="endpoint"><span class="method POST">POST</span><span class="endpoint-path">/economy/spend</span><span class="endpoint-desc">Deduct gold (purchase / craft_cost)</span></div>
    <div class="endpoint"><span class="method POST">POST</span><span class="endpoint-path">/economy/transfer</span><span class="endpoint-desc">Player-to-player gold transfer (max 100k)</span></div>
    <div class="endpoint"><span class="method GET">GET</span><span class="endpoint-path">/crafting/recipes</span><span class="endpoint-desc">All recipes — filter by ?class= &amp; ?tier=</span></div>
    <div class="endpoint"><span class="method POST">POST</span><span class="endpoint-path">/crafting/start</span><span class="endpoint-desc">Start crafting — validates class, prof level, gold</span></div>
    <div class="endpoint"><span class="method PATCH">PATCH</span><span class="endpoint-path">/crafting/:id/complete</span><span class="endpoint-desc">Collect finished item (internal)</span></div>
    <div class="endpoint"><span class="method GET">GET</span><span class="endpoint-path">/combat/leaderboard</span><span class="endpoint-desc">Top 25 players by kills</span></div>
    <div class="endpoint"><span class="method POST">POST</span><span class="endpoint-path">/combat/log</span><span class="endpoint-desc">Record a combat result (internal)</span></div>
    <div class="endpoint"><span class="method GET">GET</span><span class="endpoint-path">/islands</span><span class="endpoint-desc">All island states — current controller + active players</span></div>
    <div class="endpoint"><span class="method PATCH">PATCH</span><span class="endpoint-path">/islands/:key/claim</span><span class="endpoint-desc">Claim island for a crew (internal)</span></div>
    <div class="endpoint"><span class="method GET">GET</span><span class="endpoint-path">/missions</span><span class="endpoint-desc">Active missions for authenticated user</span></div>
    <div class="endpoint"><span class="method POST">POST</span><span class="endpoint-path">/crews/create</span><span class="endpoint-desc">Create a crew (3-5 members)</span></div>
  </div>
  <a class="docs-link" href="/api/docs.json" target="_blank">View full OpenAPI spec →</a>
</section>

<div class="hr"></div>

<!-- TOOLS -->
<section id="tools">
  <div class="section-label">Studio Tools</div>
  <h2 class="section-title">AI-Powered Dev Tools</h2>
  <p class="section-sub">Tools to accelerate content creation, balance testing, and world-building for Grudge Warlords.</p>
  <div class="tools-grid">
    <div class="tool-card">
      <h3>🏝️ Island State Monitor</h3>
      <p>Live view of all 10 islands — controlling crew, active player count, resource levels, and claim history. Pulls from the Game API in real time.</p>
      <a href="${env.DASH_URL || 'https://dash.grudge-studio.com'}#islands" target="_blank">Open monitor →</a>
    </div>
    <div class="tool-card">
      <h3>⚗️ Crafting Recipe Browser</h3>
      <p>Browse all 80+ crafting recipes across weapon types, armor sets, and relics. Filter by class, tier (T1–T6), and profession level requirement.</p>
      <a href="${env.GAME_API || 'https://api.grudge-studio.com'}/crafting/recipes" target="_blank">Browse recipes →</a>
    </div>
    <div class="tool-card">
      <h3>🏆 Combat Leaderboard</h3>
      <p>Live PvP kill rankings for all active characters. Updated on every combat log entry — broken down by faction and class.</p>
      <a href="${env.GAME_API || 'https://api.grudge-studio.com'}/combat/leaderboard" target="_blank">View leaderboard →</a>
    </div>
    <div class="tool-card">
      <h3>📦 Asset Storage</h3>
      <p>Browse and manage the R2 asset bucket — textures, models, audio clips, and UI sprites. Served globally via the Cloudflare CDN edge.</p>
      <a href="${env.CDN_URL || 'https://assets.grudge-studio.com'}" target="_blank">Browse assets →</a>
    </div>
    <div class="tool-card">
      <h3>📊 Studio Dashboard</h3>
      <p>Internal operations hub — user management, economy auditing, crafting queue inspection, island admin controls, and live WebSocket metrics.</p>
      <a href="${env.DASH_URL || 'https://dash.grudge-studio.com'}" target="_blank">Open dashboard →</a>
    </div>
    <div class="tool-card">
      <h3>🔗 WebSocket Playground</h3>
      <p>Connect to the /global namespace to monitor live game events — mission completions, island claims, combat results, and Z-key battle broadcasts.</p>
      <a href="${env.WS_API || 'https://ws.grudge-studio.com'}/health" target="_blank">Check WS status →</a>
    </div>
  </div>
</section>

<div class="hr"></div>

<!-- GAMES & APPS -->
<section id="games">
  <div class="section-label">Ecosystem</div>
  <h2 class="section-title">Games & Apps</h2>
  <p class="section-sub">Live web apps, game clients, and tools — all part of the Grudge Studio ecosystem.</p>
  <div class="tools-grid">
    <div class="tool-card">
      <h3>⚔️ Grudge Warlords</h3>
      <p>The main game client — souls-like MMO RPG with faction warfare, island conquest, permadeath crews, and real-time combat.</p>
      <a href="https://grudge-warlords-game.vercel.app" target="_blank">Play now →</a>
    </div>
    <div class="tool-card">
      <h3>🛠️ Warlord Crafting Suite</h3>
      <p>Browse and craft weapons, armor, shields, and relics. Full recipe database with tier progression and class requirements.</p>
      <a href="https://warlord-crafting-suite.vercel.app" target="_blank">Open crafting →</a>
    </div>
    <div class="tool-card">
      <h3>🎨 Grudge Builder</h3>
      <p>Character, item, and world building tool. Create heroes, design gear loadouts, and plan island layouts.</p>
      <a href="https://grudge-builder-grudgenexus.vercel.app" target="_blank">Open builder →</a>
    </div>
    <div class="tool-card">
      <h3>🎮 Grudge Engine Web</h3>
      <p>BabylonJS-powered 3D editor with PBR materials, GPU particles, combat system, AI auto-rig, and cloud save.</p>
      <a href="https://grudge-engine-web.vercel.app" target="_blank">Open editor →</a>
    </div>
    <div class="tool-card">
      <h3>🏝️ Grudge Islands RTS</h3>
      <p>Real-time strategy with tower defense, naval combat, equipment system, and skill trees across 3 factions.</p>
      <a href="https://swarmrts-master-grudgenexus.vercel.app" target="_blank">Play RTS →</a>
    </div>
    <div class="tool-card">
      <h3>🕹️ Grudge Controller</h3>
      <p>Third-person character controller demo — over-the-shoulder camera, target locking, and combat movement.</p>
      <a href="https://controller-grudge.vercel.app" target="_blank">Try controller →</a>
    </div>
    <div class="tool-card">
      <h3>🎣 Grudge Angeler</h3>
      <p>Pixel art fishing adventure — a relaxing side game set in the Grudge universe.</p>
      <a href="https://grudge-angeler.vercel.app" target="_blank">Play now →</a>
    </div>
    <div class="tool-card">
      <h3>🌐 GrudaChain</h3>
      <p>Free AI node system powered by GRUDA — decentralized compute for the Grudge ecosystem.</p>
      <a href="https://grudachain-rho.vercel.app" target="_blank">Explore →</a>
    </div>
    <div class="tool-card">
      <h3>🚀 StarWay GRUDA</h3>
      <p>Web client for the StarWay GRUDA system — space exploration meets the Grudge universe.</p>
      <a href="https://star-way-gruda-web-client.vercel.app" target="_blank">Launch →</a>
    </div>
    <div class="tool-card">
      <h3>🏗️ GDevelop Assistant</h3>
      <p>The development editor built in Grudge Studio — visual game creation with AI assistance.</p>
      <a href="https://gdevelop-assistant-grudgenexus.vercel.app" target="_blank">Open editor →</a>
    </div>
    <div class="tool-card">
      <h3>🏴 Grudge Factions</h3>
      <p>Minecraft server landing page and modpack distribution — the souls-like MMO Minecraft experience.</p>
      <a href="https://grudge-factions-site.vercel.app" target="_blank">Visit →</a>
    </div>
    <div class="tool-card">
      <h3>📡 Grudge Platform</h3>
      <p>Central platform portal — login, account management, and cross-game progression tracking.</p>
      <a href="https://grudge-platform.vercel.app" target="_blank">Open platform →</a>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div class="f-logo">GRUDGE STUDIO</div>
  <p>Grudge Warlords game backend infrastructure — built for scale, built for battle.</p>
  <div class="f-links">
    <a href="https://id.grudge-studio.com/device" target="_blank">Auth Portal</a>
    <div class="f-divider"></div>
    <a href="https://wallet.grudge-studio.com" target="_blank">Wallet</a>
    <div class="f-divider"></div>
    <a href="https://dash.grudge-studio.com" target="_blank">Dashboard</a>
    <div class="f-divider"></div>
    <a href="https://api.grudge-studio.com/health" target="_blank">API Health</a>
    <div class="f-divider"></div>
    <a href="/api/docs.json" target="_blank">API Spec</a>
    <div class="f-divider"></div>
    <a href="/backend">Architecture</a>
    <div class="f-divider"></div>
    <a href="/infra">Infrastructure</a>
    <div class="f-divider"></div>
    <a href="https://assets.grudge-studio.com" target="_blank">CDN</a>
    <div class="f-divider"></div>
    <a href="https://grudgewarlords.com" target="_blank">Play the Game</a>
    <div class="f-divider"></div>
    <a href="/tos">Terms of Service</a>
    <div class="f-divider"></div>
    <a href="/privacy">Privacy Policy</a>
  </div>
</footer>

<!-- Admin login button — bottom right -->
<a href="/admin" style="position:fixed;bottom:16px;right:16px;padding:8px 16px;background:rgba(18,18,26,0.9);border:1px solid #2a2a3a;border-radius:6px;color:#555;text-decoration:none;font-size:11px;letter-spacing:1px;transition:all .2s;z-index:50;backdrop-filter:blur(8px)" onmouseover="this.style.borderColor='#d4af37';this.style.color='#d4af37'" onmouseout="this.style.borderColor='#2a2a3a';this.style.color='#555'">Admin</a>

<script>
const STATUS_LABELS = { ok: 'Operational', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance' };

async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const data = await r.json();
    const isMaint = data.mode === 'maintenance';

    // Maintenance banner
    const banner = document.getElementById('maint-banner');
    if (banner) banner.style.display = isMaint ? 'block' : 'none';

    // Per-service dots
    data.services.forEach(svc => {
      const dot = document.getElementById('dot-' + svc.key);
      const st  = document.getElementById('st-' + svc.key);
      const lat = document.getElementById('lat-' + svc.key);
      if (!dot) return;
      dot.className = 's-dot ' + svc.status;
      st.textContent = STATUS_LABELS[svc.status] || svc.status;
      lat.textContent = svc.latency ? svc.latency + 'ms' : '';
    });

    // Overall indicator
    const overall = document.getElementById('overall-dot');
    const overallText = document.getElementById('overall-text');
    if (isMaint) {
      overall.className = 'big-dot maintenance';
      overallText.textContent = 'Scheduled maintenance in progress';
    } else if (data.ok) {
      overall.className = 'big-dot ok';
      overallText.textContent = 'All systems operational';
    } else {
      overall.className = 'big-dot';
      const downCount = data.services.filter(s => s.status === 'down').length;
      overallText.textContent = downCount === data.services.length
        ? 'All services unreachable'
        : downCount + ' service' + (downCount !== 1 ? 's' : '') + ' down — check below';
    }

    // Hero badge
    const badge = document.querySelector('.hero-badge');
    if (badge) {
      const span = badge.querySelector('span');
      if (isMaint) {
        span.style.background = 'var(--blue)';
        badge.childNodes[1].textContent = ' Maintenance';
      } else if (data.ok) {
        span.style.background = 'var(--green)';
        badge.childNodes[1].textContent = ' All systems operational';
      } else {
        span.style.background = 'var(--red)';
        badge.childNodes[1].textContent = ' Partial outage';
      }
    }

    // Meta info (timestamps)
    const meta = document.getElementById('status-meta');
    if (meta) {
      let parts = [];
      if (data.lastChecked) parts.push('Last checked: ' + new Date(data.lastChecked).toLocaleTimeString());
      if (data.cacheAge != null) parts.push('Cache age: ' + data.cacheAge + 's');
      if (data.lastAllOk) parts.push('Last all-ok: ' + new Date(data.lastAllOk).toLocaleString());
      meta.textContent = parts.join('  ·  ');
    }
  } catch(e) {
    document.getElementById('overall-text').textContent = 'Status check failed';
  }
}
loadStatus();
setInterval(loadStatus, 30000);
</script>

</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ── Discord Webhook Events endpoint ─────────────────────────────────────────
// Configured under: Developer Portal → (your app) → Webhooks page → Endpoint
// This is SEPARATE from Interactions Endpoint URL and coexists with Gateway bot
async function handleDiscordWebhookEvent(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp  = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) return new Response('Unauthorized', { status: 401 });

  const body      = await request.text();
  const publicKey = env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return new Response('Server misconfigured — DISCORD_PUBLIC_KEY not set', { status: 500 });

  try {
    const valid = await verifyDiscordEd25519(publicKey, signature, timestamp, body);
    if (!valid) return new Response('Invalid signature', { status: 401 });
  } catch {
    return new Response('Signature verification failed', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(body); } catch { return new Response('Bad Request', { status: 400 }); }

  // PING (type 0) — sent by Discord when you save the endpoint URL in the portal
  if (payload.type === 0) return new Response(null, { status: 204 });

  // Webhook Event (type 1) — real application lifecycle events
  if (payload.type === 1 && payload.event) {
    const { type, data } = payload.event;
    switch (type) {
      case 'APPLICATION_AUTHORIZED':
        // Fired when someone installs or authorizes ALE
        console.log(`[ALE] APPLICATION_AUTHORIZED — user: ${data?.user?.id ?? '?'} guild: ${data?.guild?.id ?? 'DM'}`);
        break;
      case 'ENTITLEMENT_CREATE':
        // Fired when a user purchases a SKU (future monetization)
        console.log(`[ALE] ENTITLEMENT_CREATE — sku: ${data?.sku_id}`);
        break;
      case 'QUEST_USER_ENROLLMENT':
        console.log(`[ALE] QUEST_USER_ENROLLMENT`);
        break;
      default:
        console.log(`[ALE] Unhandled webhook event: ${type}`);
    }
  }

  return new Response(null, { status: 204 });
}

async function verifyDiscordEd25519(publicKeyHex, signatureHex, timestamp, body) {
  const enc   = new TextEncoder();
  const pk    = hexToBytes(publicKeyHex);
  const sig   = hexToBytes(signatureHex);
  const msg   = enc.encode(timestamp + body);
  const key   = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, sig, msg);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) out[i >>> 1] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

// ── Terms of Service ─────────────────────────────────────────────────────────
function handleTos() {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — Grudge Studio</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Roboto:wght@300;400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',sans-serif;background:#0a0a0f;color:#e8e8e8;padding:80px 32px;max-width:860px;margin:0 auto;line-height:1.7}
  h1{font-family:'Cinzel',serif;color:#d4af37;font-size:2rem;margin-bottom:8px}
  .subtitle{color:#888;margin-bottom:48px;font-size:.9rem}
  h2{font-family:'Cinzel',serif;color:#d4af37;font-size:1.1rem;margin:36px 0 12px}
  p{color:#ccc;margin-bottom:12px}
  a{color:#d4af37;text-decoration:none}
  a:hover{text-decoration:underline}
  .back{display:inline-block;margin-bottom:40px;color:#888;font-size:.85rem}
</style></head>
<body>
<a class="back" href="/">← grudge-studio.com</a>
<h1>Terms of Service</h1>
<p class="subtitle">Last updated: March 2026</p>

<h2>1. Acceptance</h2>
<p>By accessing or using any Grudge Studio service — including the Grudge Warlords game, the ALE Discord bot, and associated APIs — you agree to be bound by these Terms of Service.</p>

<h2>2. Eligibility</h2>
<p>You must be at least 13 years of age to use Grudge Studio services. By using our services you represent that you meet this requirement.</p>

<h2>3. Game Rules</h2>
<p>You agree not to exploit bugs, use unauthorised third-party tools to gain an advantage, harass other players, or engage in any activity that disrupts the game experience for others. Violations may result in account suspension or permanent ban.</p>

<h2>4. In-Game Economy</h2>
<p>Virtual currency (Gold) and items within Grudge Warlords have no real-world monetary value and cannot be exchanged for real currency. Grudge Studio reserves the right to modify, reset, or remove in-game assets at any time.</p>

<h2>5. NFT &amp; Wallet Features</h2>
<p>Where NFT or Solana wallet features are available, you acknowledge that blockchain transactions are irreversible. Grudge Studio is not liable for lost assets resulting from user error or third-party wallet issues.</p>

<h2>6. Intellectual Property</h2>
<p>All game content, artwork, code, and branding are the property of Grudge Studio. You may not reproduce, distribute, or create derivative works without express written permission.</p>

<h2>7. Modifications</h2>
<p>We reserve the right to update these Terms at any time. Continued use of our services after changes constitutes acceptance of the updated Terms.</p>

<h2>8. Limitation of Liability</h2>
<p>Grudge Studio services are provided "as is." To the maximum extent permitted by law, we disclaim all warranties and limit liability to the fullest extent allowed.</p>

<h2>9. Contact</h2>
<p>Questions? Reach us via the <a href="https://grudgewarlords.com" target="_blank">Grudge Warlords</a> community or through <a href="https://dash.grudge-studio.com" target="_blank">the dashboard</a>.</p>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

// ── Privacy Policy ────────────────────────────────────────────────────────────
function handlePrivacy() {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Grudge Studio</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Roboto:wght@300;400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',sans-serif;background:#0a0a0f;color:#e8e8e8;padding:80px 32px;max-width:860px;margin:0 auto;line-height:1.7}
  h1{font-family:'Cinzel',serif;color:#d4af37;font-size:2rem;margin-bottom:8px}
  .subtitle{color:#888;margin-bottom:48px;font-size:.9rem}
  h2{font-family:'Cinzel',serif;color:#d4af37;font-size:1.1rem;margin:36px 0 12px}
  p{color:#ccc;margin-bottom:12px}
  ul{color:#ccc;margin:0 0 12px 20px}
  li{margin-bottom:6px}
  a{color:#d4af37;text-decoration:none}
  a:hover{text-decoration:underline}
  .back{display:inline-block;margin-bottom:40px;color:#888;font-size:.85rem}
</style></head>
<body>
<a class="back" href="/">← grudge-studio.com</a>
<h1>Privacy Policy</h1>
<p class="subtitle">Last updated: March 2026</p>

<h2>1. Information We Collect</h2>
<p>When you use Grudge Studio services we may collect:</p>
<ul>
  <li>Discord user ID and username (via Discord OAuth or bot interaction)</li>
  <li>Solana wallet address (if you connect a wallet)</li>
  <li>In-game actions: combat logs, crafting history, island activity</li>
  <li>IP address and browser metadata for security and rate-limiting</li>
</ul>

<h2>2. How We Use It</h2>
<p>Collected data is used solely to operate the game, deliver in-game features, prevent abuse, and improve the experience. We do not sell personal data to third parties.</p>

<h2>3. Discord Integration</h2>
<p>The ALE Discord bot reads message content only where the Message Content Intent is active and only to respond to commands or conversation. We do not store message content beyond the duration of a session.</p>

<h2>4. Data Retention</h2>
<p>Account and game data is retained for as long as your account is active. You may request deletion by contacting us. Blockchain data (wallet transactions) is inherently immutable and cannot be deleted.</p>

<h2>5. Third-Party Services</h2>
<p>We use the following third-party services which have their own privacy policies:</p>
<ul>
  <li>Discord — for authentication and bot functionality</li>
  <li>Solana / Web3Auth — for wallet authentication</li>
  <li>Cloudflare — for CDN, DDoS protection, and DNS</li>
</ul>

<h2>6. Security</h2>
<p>We use industry-standard security measures including JWT authentication, TLS encryption, and rate limiting. No security system is perfect; use strong passwords and protect your wallet seed phrases.</p>

<h2>7. Contact</h2>
<p>For privacy requests or questions contact us through <a href="https://dash.grudge-studio.com" target="_blank">the dashboard</a> or the <a href="https://grudgewarlords.com" target="_blank">Grudge Warlords</a> community.</p>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
