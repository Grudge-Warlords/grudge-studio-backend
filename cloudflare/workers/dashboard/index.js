/**
 * Grudge Studio — Backend Dashboard Worker  v2.0
 *
 * Auth: POST /login with API key → sets HttpOnly session cookie (24h KV TTL)
 *       No more ?key= in the URL (security fix)
 *
 * Tabs: Overview · Servers · PvP Arena · Players · Storage · Events · Economy
 *
 * Deploy:  npx wrangler deploy  (from cloudflare/workers/dashboard/)
 * Secret:  npx wrangler secret put DASH_API_KEY
 *          → paste value of INTERNAL_API_KEY from .env
 */

// ── Session helpers ───────────────────────────────────────────
const SESSION_TTL = 86400; // 24 hours

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(env) {
  if (!env.KV) return null;
  const token = randomHex(32);
  await env.KV.put(`dash:session:${token}`, '1', { expirationTtl: SESSION_TTL });
  return token;
}

async function validateSession(env, token) {
  if (!token || !env.KV) return false;
  return (await env.KV.get(`dash:session:${token}`)) === '1';
}

async function deleteSession(env, token) {
  if (token && env.KV) await env.KV.delete(`dash:session:${token}`);
}

function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/grudge_dash=([a-f0-9]{64})/);
  return m?.[1] || null;
}

// ── D1 schema ─────────────────────────────────────────────────
const D1_INIT_SQL = `
CREATE TABLE IF NOT EXISTS dash_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL, event TEXT NOT NULL, payload TEXT,
  ts INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS dash_players (
  grudge_id TEXT PRIMARY KEY, username TEXT, class TEXT,
  faction TEXT, level INTEGER DEFAULT 1, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS dash_metrics (
  key TEXT PRIMARY KEY, value TEXT,
  ts INTEGER NOT NULL DEFAULT (unixepoch())
);`;

async function initD1(env) {
  if (!env.DB) return;
  try {
    for (const s of D1_INIT_SQL.trim().split(';').filter(x => x.trim()))
      await env.DB.prepare(s).run();
  } catch {}
}

// ── Main handler ──────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    ctx.waitUntil(initD1(env));

    // POST /login
    if (url.pathname === '/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!env.DASH_API_KEY || body.key !== env.DASH_API_KEY)
        return json({ error: 'Invalid key' }, 401);
      const token = await createSession(env);
      const cookieName = token ? 'grudge_dash' : 'grudge_dash_key';
      const cookieVal  = token || encodeURIComponent(body.key);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${cookieName}=${cookieVal}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_TTL}`,
        },
      });
    }

    // POST /logout
    if (url.pathname === '/logout' && method === 'POST') {
      await deleteSession(env, getSessionToken(request));
      return new Response('{}', {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'grudge_dash=; Path=/; HttpOnly; Max-Age=0',
        },
      });
    }

    // Auth gate
    let authed = await validateSession(env, getSessionToken(request));
    if (!authed && env.DASH_API_KEY) {
      const cookie = request.headers.get('Cookie') || '';
      const km = cookie.match(/grudge_dash_key=([^;]+)/);
      if (km) try { authed = decodeURIComponent(km[1]) === env.DASH_API_KEY; } catch {}
    }
    if (!authed && url.searchParams.get('key') === env.DASH_API_KEY) authed = true;

    if (!authed) {
      if (url.pathname === '/' && method === 'GET') return loginPage();
      return json({ error: 'Unauthorized' }, 401);
    }

    // API routes
    const p = url.pathname;
    if (p === '/api/health')          return apiHealth(env);
    if (p === '/api/r2')              return apiR2(env);
    if (p === '/api/d1')              return apiD1(env);
    if (p === '/api/players')         return apiPlayers(env);
    if (p === '/api/events')          return apiEvents(env, url);
    if (p === '/api/metrics')         return apiMetrics(env);
    if (p === '/api/pvp/lobbies')     return apiPvpLobbies(env);
    if (p === '/api/pvp/leaderboard') return apiPvpLeaderboard(env, url);
    if (p === '/api/ws/stats')        return apiWsStats(env);
    if (p === '/api/economy')         return apiEconomy(env);
    if (p === '/api/event' && method === 'POST') return apiLogEvent(request, env);

    if (p === '/' || p === '/dashboard') return dashboardPage();
    return new Response('Not Found', { status: 404 });
  },
};

// ── API implementations ───────────────────────────────────────
async function apiHealth(env) {
  const endpoints = {
    'Identity':  env.IDENTITY_API  || 'https://id.grudge-studio.com',
    'Game API':  env.GAME_API      || 'https://api.grudge-studio.com',
    'Account':   env.ACCOUNT_API   || 'https://account.grudge-studio.com',
    'Launcher':  env.LAUNCHER_API  || 'https://launcher.grudge-studio.com',
    'WebSocket': env.WS_API        || 'https://ws.grudge-studio.com',
    'Asset CDN': env.CDN_URL       || 'https://assets.grudge-studio.com',
  };
  const results = await Promise.allSettled(
    Object.entries(endpoints).map(async ([name, base]) => {
      const t = Date.now();
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
        let body = {};
        try { body = await r.json(); } catch {}
        return { name, status: r.ok ? 'up' : 'degraded', code: r.status, ms: Date.now()-t, body };
      } catch (e) { return { name, status: 'down', ms: Date.now()-t, error: e.message }; }
    })
  );
  return json(results.map(r => r.value ?? r.reason));
}

async function apiR2(env) {
  if (!env.ASSETS) return json({ error: 'R2 not bound' }, 503);
  try {
    const listed = await env.ASSETS.list({ limit: 1000 });
    const byPrefix = {};
    let totalSize = 0;
    for (const obj of listed.objects) {
      const pre = obj.key.split('/')[0] || 'root';
      byPrefix[pre] = (byPrefix[pre] || 0) + 1;
      totalSize += obj.size || 0;
    }
    return json({ totalObjects: listed.objects.length, truncated: listed.truncated,
      totalSizeBytes: totalSize, totalSizeMB: (totalSize/1_048_576).toFixed(2), byPrefix });
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiD1(env) {
  if (!env.DB) return json({ error: 'D1 not bound' }, 503);
  try {
    const [p,e2,m] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_players').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_events').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_metrics').first(),
    ]);
    return json({ tables: { players: p?.count??0, events: e2?.count??0, metrics: m?.count??0 } });
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiPlayers(env) {
  if (!env.DB) return json([]);
  try {
    const { results } = await env.DB.prepare('SELECT * FROM dash_players ORDER BY last_seen DESC LIMIT 50').all();
    return json(results || []);
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiEvents(env, url) {
  if (!env.DB) return json([]);
  const svc = url.searchParams.get('service');
  try {
    const { results } = svc
      ? await env.DB.prepare('SELECT * FROM dash_events WHERE service = ? ORDER BY ts DESC LIMIT 100').bind(svc).all()
      : await env.DB.prepare('SELECT * FROM dash_events ORDER BY ts DESC LIMIT 100').all();
    return json(results || []);
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiMetrics(env) {
  if (!env.KV) return json({});
  try {
    const keys = ['active_players','total_logins','total_missions','gbux_circulating'];
    const vals = await Promise.all(keys.map(k => env.KV.get(k)));
    const out  = {};
    keys.forEach((k,i) => { out[k] = vals[i] ?? '0'; });
    return json(out);
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiLogEvent(request, env) {
  if (!env.DB) return json({ error: 'D1 not bound' }, 503);
  try {
    const { service, event, payload } = await request.json();
    if (!service || !event) return json({ error: 'service and event required' }, 400);
    const payloadStr = JSON.stringify(payload ?? null);
    await env.DB.prepare('INSERT INTO dash_events (service, event, payload) VALUES (?, ?, ?)')
      .bind(service, event, payloadStr).run();

    // Forward error/crash events to Discord
    if (env.DISCORD_SYSTEM_WEBHOOK && (event === 'error' || event === 'crash' || event === 'shutdown')) {
      const color = event === 'error' ? 0xe85555 : event === 'crash' ? 0xff0000 : 0xffa500;
      const emoji = event === 'error' ? '⚠️' : event === 'crash' ? '💀' : '🔌';
      const msg = payload?.message || payloadStr?.slice(0, 200) || event;
      fetch(env.DISCORD_SYSTEM_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `${emoji} ${service} — ${event}`,
            color,
            description: msg,
            fields: payload?.stack ? [{ name: 'Stack', value: '```\n' + payload.stack.slice(0, 500) + '\n```' }] : [],
            footer: { text: `Dashboard Event Logger • ${new Date().toISOString().slice(0, 16)}Z` },
          }],
        }),
      }).catch(() => {});
    }

    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiPvpLobbies(env) {
  const base = env.GAME_API || 'https://api.grudge-studio.com';
  try {
    const r = await fetch(`${base}/pvp/lobbies?limit=20`, {
      headers: { 'x-internal-key': env.DASH_API_KEY || '' },
      signal: AbortSignal.timeout(5000),
    });
    return json(await r.json());
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiPvpLeaderboard(env, url) {
  const mode = url.searchParams.get('mode') || 'duel';
  const base = env.GAME_API || 'https://api.grudge-studio.com';
  try {
    const r = await fetch(`${base}/pvp/leaderboard?mode=${mode}&limit=10`, {
      headers: { 'x-internal-key': env.DASH_API_KEY || '' },
      signal: AbortSignal.timeout(5000),
    });
    return json(await r.json());
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiWsStats(env) {
  const base = env.WS_API || 'https://ws.grudge-studio.com';
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    return json(await r.json());
  } catch (e) { return json({ error: e.message }, 500); }
}

async function apiEconomy(env) {
  const base = env.GAME_API || 'https://api.grudge-studio.com';
  try {
    const r = await fetch(`${base}/economy/balance?summary=true`, {
      headers: { 'x-internal-key': env.DASH_API_KEY || '' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return json({ error: `game-api ${r.status}` }, r.status);
    return json(await r.json());
  } catch (e) { return json({ error: e.message }, 500); }
}

// ── Login page ────────────────────────────────────────────────
function loginPage() {
  return html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grudge Studio — Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Spectral+SC:wght@400;600&family=IM+Fell+English+SC&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:hsl(225 30% 8%);font-family:'Spectral SC','Segoe UI',serif;display:flex;align-items:center;justify-content:center;min-height:100vh;
  background-image:radial-gradient(ellipse at top,hsl(225 30% 12%) 0%,transparent 50%),radial-gradient(ellipse at bottom,hsl(225 25% 6%) 0%,transparent 50%),radial-gradient(circle at 25% 25%,rgba(212,175,55,0.06) 0%,transparent 40%),radial-gradient(circle at 75% 75%,rgba(180,130,40,0.04) 0%,transparent 40%);background-attachment:fixed}
.card{position:relative;background:linear-gradient(180deg,hsl(225 25% 14%) 0%,hsl(225 28% 10%) 50%,hsl(225 25% 8%) 100%);
  border:2px solid hsl(43 60% 35%);border-radius:4px;padding:48px 40px 40px;width:380px;text-align:center;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.05),inset 0 -1px 0 rgba(0,0,0,0.3),0 8px 32px rgba(0,0,0,0.6),0 0 0 1px rgba(0,0,0,0.3)}
.card::before{content:'';position:absolute;inset:0;border-radius:2px;padding:1px;
  background:linear-gradient(180deg,rgba(212,175,55,0.3) 0%,rgba(160,120,40,0.1) 50%,rgba(100,80,30,0.2) 100%);
  mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;pointer-events:none}
.corner{position:absolute;font-size:14px;color:hsl(43 70% 50%);text-shadow:0 0 6px rgba(212,175,55,0.5)}
.corner.tl{top:-8px;left:-8px}.corner.tr{top:-8px;right:-8px}.corner.bl{bottom:-8px;left:-8px}.corner.br{bottom:-8px;right:-8px}
.logo{font-family:'Cinzel Decorative',serif;font-size:28px;font-weight:900;letter-spacing:3px;text-transform:uppercase;margin-bottom:4px;
  background:linear-gradient(180deg,hsl(43 90% 75%) 0%,hsl(43 85% 55%) 40%,hsl(35 70% 40%) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))}
.sub{color:hsl(45 15% 50%);font-family:'IM Fell English SC',serif;font-size:12px;margin-bottom:32px;text-transform:uppercase;letter-spacing:2px}
input{width:100%;background:hsl(225 28% 8%);border:1px solid hsl(220 15% 25%);border-radius:2px;color:hsl(43 85% 65%);padding:13px 16px;font-size:14px;font-family:'Spectral SC',serif;margin-bottom:16px;outline:none;
  box-shadow:inset 0 2px 8px rgba(0,0,0,0.5),inset 0 0 0 1px rgba(0,0,0,0.3)}
input:focus{border-color:hsl(43 60% 40%);box-shadow:inset 0 2px 8px rgba(0,0,0,0.5),0 0 8px rgba(212,175,55,0.2)}
input::placeholder{color:hsl(220 15% 35%);font-family:'IM Fell English SC',serif}
button{width:100%;background:linear-gradient(180deg,hsl(43 70% 45%) 0%,hsl(38 65% 35%) 50%,hsl(35 60% 28%) 100%);
  border:2px solid hsl(43 50% 50%);border-radius:4px;padding:14px;font-family:'Cinzel Decorative',serif;font-size:13px;font-weight:700;color:hsl(225 30% 10%);
  cursor:pointer;letter-spacing:2px;text-transform:uppercase;text-shadow:0 1px 0 rgba(255,255,255,0.3);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.3),inset 0 -2px 4px rgba(0,0,0,0.2),0 2px 4px rgba(0,0,0,0.4);transition:all .15s}
button:hover{background:linear-gradient(180deg,hsl(43 80% 55%) 0%,hsl(43 70% 45%) 50%,hsl(38 65% 35%) 100%);
  border-color:hsl(43 60% 60%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.4),0 0 16px rgba(212,175,55,0.4),0 4px 8px rgba(0,0,0,0.4)}
button:active{background:linear-gradient(180deg,hsl(35 60% 30%) 0%,hsl(38 65% 35%) 100%);box-shadow:inset 0 2px 4px rgba(0,0,0,0.4)}
.err{color:hsl(0 65% 55%);font-size:12px;margin-top:12px;display:none;font-family:'IM Fell English SC',serif}
.divider{width:60px;height:2px;background:linear-gradient(90deg,transparent,hsl(43 60% 40%),transparent);margin:0 auto 28px}
</style></head>
<body>
<div class="card">
  <span class="corner tl">◆</span><span class="corner tr">◆</span>
  <span class="corner bl">◆</span><span class="corner br">◆</span>
  <div class="logo">⚔ GRUDGE</div>
  <div class="sub">Backend Dashboard</div>
  <div class="divider"></div>
  <form id="f">
    <input type="password" id="key" placeholder="Enter thy key…" autocomplete="current-password">
    <button type="submit">Enter the Forge</button>
    <div class="err" id="err">Invalid key — the gates remain sealed</div>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const key = document.getElementById('key').value.trim();
  if (!key) return;
  const r = await fetch('/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key}), credentials:'same-origin' });
  if (r.ok) window.location.href = '/';
  else document.getElementById('err').style.display = 'block';
});
</script>
</body></html>`);
}

// ── Dashboard HTML ────────────────────────────────────────────
function dashboardPage() {
  return html(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grudge Studio — Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@400;600;700&family=Spectral+SC:wght@400;600&family=IM+Fell+English+SC&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --gold:hsl(43 85% 55%);--gold-light:hsl(43 90% 70%);--gold-dark:hsl(43 70% 35%);
  --bg:hsl(225 30% 8%);--surface:hsl(225 25% 12%);--surface-raised:hsl(225 25% 14%);
  --border:hsl(43 60% 30%);--border-dim:hsl(225 20% 20%);
  --text:hsl(45 30% 90%);--sub:hsl(45 15% 50%);
  --green:hsl(142 50% 45%);--red:hsl(0 65% 50%);--blue:hsl(220 70% 60%);--purple:hsl(271 70% 60%);
  --obsidian:hsl(225 30% 8%);--stone:hsl(220 15% 25%);--crimson:hsl(0 65% 40%);
  --font-heading:'Cinzel Decorative','Cinzel',serif;--font-body:'Spectral SC','Segoe UI',serif;--font-label:'IM Fell English SC',serif
}
body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:13px;
  background-image:radial-gradient(ellipse at top,hsl(225 30% 12%) 0%,transparent 50%),radial-gradient(ellipse at bottom,hsl(225 25% 6%) 0%,transparent 50%),radial-gradient(circle at 25% 25%,rgba(212,175,55,0.05) 0%,transparent 40%);
  background-attachment:fixed}
header{position:relative;background:linear-gradient(180deg,hsl(225 25% 14%) 0%,hsl(225 28% 10%) 100%);
  border-bottom:2px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10;
  box-shadow:0 4px 16px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)}
.logo{font-family:var(--font-heading);font-size:16px;font-weight:900;letter-spacing:3px;text-transform:uppercase;
  background:linear-gradient(180deg,var(--gold-light) 0%,var(--gold) 40%,var(--gold-dark) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))}
.badge{background:hsl(225 25% 15%);border:1px solid var(--border);border-radius:2px;padding:2px 10px;font-size:9px;font-family:var(--font-label);color:hsl(43 60% 55%);text-transform:uppercase;letter-spacing:1px}
nav{display:flex;gap:3px;margin-left:auto;flex-wrap:wrap}
nav button{background:none;border:1px solid transparent;border-radius:2px;color:var(--sub);padding:5px 11px;cursor:pointer;font-size:10px;font-family:var(--font-label);text-transform:uppercase;letter-spacing:.5px;transition:all .15s}
nav button.active,nav button:hover{background:linear-gradient(180deg,hsl(225 25% 18%) 0%,hsl(225 28% 14%) 100%);border-color:var(--border);color:var(--gold);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.05),0 0 6px rgba(212,175,55,0.15)}
.logout{background:none;border:1px solid var(--stone);border-radius:2px;color:hsl(45 15% 40%);padding:5px 10px;cursor:pointer;font-size:9px;font-family:var(--font-label);margin-left:6px;text-transform:uppercase;letter-spacing:1px;transition:all .15s}
.logout:hover{color:var(--crimson);border-color:var(--crimson);box-shadow:0 0 6px rgba(200,50,50,0.3)}
main{padding:20px;max-width:1440px;margin:0 auto}
h2{font-family:var(--font-heading);color:var(--gold);font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;
  text-shadow:0 1px 2px rgba(0,0,0,0.5)}
.grid{display:grid;gap:12px}
.g4{grid-template-columns:repeat(4,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
@media(max-width:900px){.g4,.g3{grid-template-columns:repeat(2,1fr)}}
@media(max-width:580px){.g4,.g3,.g2{grid-template-columns:1fr}}
.card{position:relative;background:linear-gradient(180deg,var(--surface-raised) 0%,var(--surface) 100%);
  border:1px solid var(--border);border-radius:3px;padding:18px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.04),inset 0 -1px 0 rgba(0,0,0,0.2),0 4px 12px rgba(0,0,0,0.4),0 0 0 1px rgba(0,0,0,0.2)}
.ctitle{font-size:10px;font-family:var(--font-label);color:var(--sub);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}
.cval{font-size:26px;font-weight:700;font-family:'Cinzel',serif;
  background:linear-gradient(180deg,var(--gold-light),var(--gold));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.csub{font-size:10px;color:var(--sub);margin-top:4px;font-family:var(--font-label)}
.row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-dim)}
.row:last-child{border:none}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.up{background:var(--green);box-shadow:0 0 6px var(--green),0 0 12px rgba(76,175,80,0.3)}
.dot.down{background:var(--red);box-shadow:0 0 6px var(--red),0 0 12px rgba(232,85,85,0.3)}
.dot.degraded{background:var(--gold);box-shadow:0 0 6px var(--gold),0 0 12px rgba(212,175,55,0.3)}
.dot.checking{background:var(--stone);animation:p 1.5s infinite}
@keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
.sname{flex:1;font-weight:600;font-size:12px;color:hsl(45 30% 80%)}
.sms{font-size:10px;color:var(--sub);font-family:var(--font-label)}
.stag{font-size:10px;font-weight:700;padding:2px 8px;border-radius:2px;text-transform:uppercase;font-family:var(--font-label);letter-spacing:.5px}
.stag.up{background:hsl(142 40% 12%);color:var(--green);border:1px solid hsl(142 30% 25%)}
.stag.down{background:hsl(0 40% 12%);color:var(--red);border:1px solid hsl(0 30% 25%)}
.stag.degraded{background:hsl(43 40% 12%);color:var(--gold);border:1px solid hsl(43 30% 25%)}
.tc{display:none}.tc.active{display:block}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:10px;font-family:var(--font-label);color:var(--sub);text-transform:uppercase;letter-spacing:1.5px;padding:8px 10px;border-bottom:2px solid var(--border)}
td{padding:8px 10px;border-bottom:1px solid var(--border-dim);font-size:12px}
tr:hover td{background:rgba(212,175,55,0.03)}
.tag{display:inline-block;background:hsl(225 20% 16%);border:1px solid var(--border-dim);border-radius:2px;padding:1px 7px;font-size:10px;color:hsl(45 25% 65%);font-family:var(--font-label)}
.rbtn{background:linear-gradient(180deg,hsl(225 25% 18%) 0%,hsl(225 28% 14%) 100%);border:1px solid var(--border);border-radius:2px;color:var(--sub);padding:5px 12px;cursor:pointer;font-size:9px;font-family:var(--font-label);float:right;text-transform:uppercase;letter-spacing:1px;transition:all .15s}
.rbtn:hover{color:var(--gold);border-color:var(--gold);box-shadow:0 0 8px rgba(212,175,55,0.2)}
.ts{color:hsl(225 15% 30%);font-size:10px;font-family:var(--font-label)}
.empty{color:hsl(225 15% 25%);text-align:center;padding:28px;font-size:12px;font-family:var(--font-label)}
.mtabs{display:flex;gap:4px;margin-bottom:12px}
.mtab{background:hsl(225 20% 16%);border:1px solid var(--border-dim);border-radius:2px;padding:3px 10px;cursor:pointer;font-size:10px;font-family:var(--font-label);color:hsl(45 15% 45%);text-transform:uppercase;letter-spacing:.5px;transition:all .15s}
.mtab.active{border-color:var(--gold);color:var(--gold);box-shadow:0 0 6px rgba(212,175,55,0.15)}
.shead{display:flex;align-items:center;margin-bottom:12px}
.shead h2{margin:0}
::-webkit-scrollbar{width:10px}
::-webkit-scrollbar-track{background:hsl(225 25% 10%);border-left:1px solid hsl(43 40% 25%)}
::-webkit-scrollbar-thumb{background:linear-gradient(180deg,hsl(43 50% 35%),hsl(35 45% 25%));border:1px solid hsl(43 40% 40%);border-radius:2px}
::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,hsl(43 60% 45%),hsl(35 50% 30%))}
</style>
</head>
<body>
<header>
  <div class="logo">⚔ Grudge Studio</div>
  <div class="badge">Backend v2</div>
  <nav>
    <button class="active" onclick="tab('overview',this)">Overview</button>
    <button onclick="tab('servers',this)">Servers</button>
    <button onclick="tab('pvp',this)">PvP Arena</button>
    <button onclick="tab('players',this)">Players</button>
    <button onclick="tab('storage',this)">Storage</button>
    <button onclick="tab('events',this)">Events</button>
    <button onclick="tab('economy',this)">Economy</button>
  </nav>
  <button class="logout" onclick="logout()">Logout</button>
</header>
<main>

<!-- OVERVIEW -->
<div id="tab-overview" class="tc active">
  <div class="shead"><h2>Overview</h2><button class="rbtn" onclick="loadAll()">↻ Refresh</button></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card"><div class="ctitle">Active Players</div><div class="cval" id="m-active">—</div></div>
    <div class="card"><div class="ctitle">Total Logins</div><div class="cval" id="m-logins">—</div></div>
    <div class="card"><div class="ctitle">Total Missions</div><div class="cval" id="m-missions">—</div></div>
    <div class="card"><div class="ctitle">GBUX Circulating</div><div class="cval" id="m-gbux">—</div></div>
  </div>
  <div class="grid g3">
    <div class="card"><div class="ctitle">Service Health</div><div id="health-mini"><div class="empty">Loading…</div></div></div>
    <div class="card"><div class="ctitle">WebSocket</div><div id="ws-mini"><div class="empty">Loading…</div></div></div>
    <div class="card"><div class="ctitle">D1 Database</div><div id="d1-mini"><div class="empty">Loading…</div></div></div>
  </div>
</div>

<!-- SERVERS -->
<div id="tab-servers" class="tc">
  <div class="shead"><h2>Live Services</h2><button class="rbtn" onclick="loadHealth();loadWs()">↻ Refresh</button></div>
  <div class="card" style="margin-bottom:14px" id="health-detail"><div class="empty">Loading…</div></div>
  <div class="card"><div class="ctitle">WebSocket Namespace Breakdown</div><div id="ws-detail"><div class="empty">Loading…</div></div></div>
</div>

<!-- PVP ARENA -->
<div id="tab-pvp" class="tc">
  <div class="shead"><h2>PvP Arena</h2><button class="rbtn" onclick="loadPvp()">↻ Refresh</button></div>
  <div class="grid g3" style="margin-bottom:16px">
    <div class="card"><div class="ctitle">Open Lobbies</div><div class="cval" id="pvp-open">—</div><div class="csub">Waiting</div></div>
    <div class="card"><div class="ctitle">Active Matches</div><div class="cval" id="pvp-active">—</div><div class="csub">In Progress</div></div>
    <div class="card"><div class="ctitle">Queue (Duel)</div><div class="cval" style="color:var(--purple)" id="pvp-queue">—</div><div class="csub">Matchmaking</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="ctitle">Open Lobbies</div><div id="pvp-lobbies"><div class="empty">Loading…</div></div></div>
    <div class="card">
      <div class="ctitle" style="display:flex;align-items:center;gap:8px">ELO Leaderboard
        <div class="mtabs" style="margin:0">
          <span class="mtab active" onclick="switchLB('duel',this)">Duel</span>
          <span class="mtab" onclick="switchLB('crew_battle',this)">Crew</span>
          <span class="mtab" onclick="switchLB('arena_ffa',this)">FFA</span>
        </div>
      </div>
      <div id="pvp-lb"><div class="empty">Loading…</div></div>
    </div>
  </div>
</div>

<!-- PLAYERS -->
<div id="tab-players" class="tc">
  <div class="shead"><h2>Players</h2><button class="rbtn" onclick="loadPlayers()">↻ Refresh</button></div>
  <div class="card">
    <table><thead><tr><th>Grudge ID</th><th>Username</th><th>Class</th><th>Faction</th><th>Level</th><th>Last Seen</th></tr></thead>
    <tbody id="players-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table>
  </div>
</div>

<!-- STORAGE -->
<div id="tab-storage" class="tc">
  <div class="shead"><h2>Storage</h2><button class="rbtn" onclick="loadStorage()">↻ Refresh</button></div>
  <div class="grid g2">
    <div class="card"><div class="ctitle">R2 — grudge-assets</div><div id="r2-full"><div class="empty">Loading…</div></div></div>
    <div class="card"><div class="ctitle">D1 — Dashboard DB</div><div id="d1-full"><div class="empty">Loading…</div></div></div>
  </div>
</div>

<!-- EVENTS -->
<div id="tab-events" class="tc">
  <div class="shead">
    <h2>Event Log</h2>
    <div id="evt-filters" style="display:flex;gap:4px;margin-left:10px;flex-wrap:wrap"></div>
    <button class="rbtn" onclick="loadEvents()">↻ Refresh</button>
  </div>
  <div class="card">
    <table><thead><tr><th>Service</th><th>Event</th><th>Payload</th><th>Time</th></tr></thead>
    <tbody id="events-body"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table>
  </div>
</div>

<!-- ECONOMY -->
<div id="tab-economy" class="tc">
  <div class="shead"><h2>Economy</h2><button class="rbtn" onclick="loadEconomy()">↻ Refresh</button></div>
  <div id="economy-out"><div class="empty" style="padding:40px">Fetching from game-api…</div></div>
</div>

</main>
<script>
const A = (p,o={}) => fetch('/api/'+p,{credentials:'same-origin',...o}).then(r=>r.json());

function tab(name,btn){
  document.querySelectorAll('.tc').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  ({overview:loadAll,servers:()=>{loadHealth();loadWs()},pvp:loadPvp,players:loadPlayers,storage:loadStorage,events:loadEvents,economy:loadEconomy})[name]?.();
}

async function logout(){await fetch('/logout',{method:'POST',credentials:'same-origin'});window.location.href='/';}

async function loadHealth(){
  const d=await A('health');
  if(!Array.isArray(d))return;
  document.getElementById('health-mini').innerHTML=d.map(s=>\`<div class="row"><div class="dot \${s.status}"></div><div class="sname">\${s.name}</div><div class="sms">\${s.ms}ms</div></div>\`).join('');
  document.getElementById('health-detail').innerHTML=\`<table><thead><tr><th>Service</th><th>Status</th><th>Response</th><th>Version</th></tr></thead><tbody>\${
    d.map(s=>\`<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="dot \${s.status}"></div>\${s.name}</div></td><td><span class="stag \${s.status}">\${s.status}</span></td><td>\${s.ms}ms\${s.code?' <span class=\\"tag\\">'+s.code+'</span>':''}</td><td style="color:#555">\${s.body?.version||s.error||'—'}</td></tr>\`).join('')
  }</tbody></table>\`;
}

async function loadWs(){
  const d=await A('ws/stats');const c=d?.connected||{};
  const tot=Object.values(c).reduce((a,b)=>a+(Number(b)||0),0);
  document.getElementById('ws-mini').innerHTML=\`<div class="row"><div class="sname" style="font-weight:700">Total</div><div style="color:var(--gold);font-weight:700">\${tot}</div></div>\`+Object.entries(c).map(([k,v])=>\`<div class="row"><div class="sname" style="color:#888">/\${k}</div><div style="color:var(--blue)">\${v}</div></div>\`).join('');
  document.getElementById('ws-detail').innerHTML=\`<div class="grid g4" style="margin-top:8px">\${Object.entries(c).map(([ns,cnt])=>\`<div style="text-align:center;padding:16px;background:#0d0d18;border-radius:8px"><div style="font-size:22px;font-weight:700;color:var(--blue)">\${cnt}</div><div style="font-size:10px;color:#444;margin-top:4px">/\${ns}</div></div>\`).join('')}</div>\`;
}

async function loadD1(){
  const d=await A('d1');
  if(d.error)return;
  const h=Object.entries(d.tables||{}).map(([k,v])=>\`<div class="row"><div class="sname">\${k}</div><div style="color:var(--gold);font-weight:700">\${v}</div></div>\`).join('');
  document.getElementById('d1-mini').innerHTML=h;
  document.getElementById('d1-full').innerHTML=h;
}

async function loadR2(){
  const d=await A('r2');const el=document.getElementById('r2-full');
  if(d.error){el.innerHTML=\`<div class="empty">\${d.error}</div>\`;return;}
  el.innerHTML=\`<div class="row"><div class="sname">Total Objects</div><div style="color:var(--gold);font-weight:700">\${d.totalObjects}</div></div><div class="row"><div class="sname">Total Size</div><div style="color:var(--gold);font-weight:700">\${d.totalSizeMB} MB</div></div>\${Object.entries(d.byPrefix||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>\`<div class="row"><div class="sname" style="color:#666">\${k}/</div><div style="color:var(--blue)">\${v}</div></div>\`).join('')}\`;
}

async function loadMetrics(){
  const d=await A('metrics');
  document.getElementById('m-active').textContent=d.active_players??'0';
  document.getElementById('m-logins').textContent=d.total_logins??'0';
  document.getElementById('m-missions').textContent=d.total_missions??'0';
  document.getElementById('m-gbux').textContent=d.gbux_circulating??'0';
}

async function loadPlayers(){
  const d=await A('players');const tb=document.getElementById('players-body');
  if(!Array.isArray(d)||!d.length){tb.innerHTML='<tr><td colspan="6" class="empty">No players yet</td></tr>';return;}
  tb.innerHTML=d.map(p=>\`<tr><td><code style="color:#333;font-size:10px">\${p.grudge_id.slice(0,8)}…</code></td><td>\${p.username||'—'}</td><td><span class="tag">\${p.class||'—'}</span></td><td><span class="tag">\${p.faction||'—'}</span></td><td>\${p.level}</td><td class="ts">\${p.last_seen?new Date(p.last_seen*1000).toLocaleString():'—'}</td></tr>\`).join('');
}

let evtSvc='';
const EVT_SVCS=['grudge-id','game-api','account-api','launcher-api','ws-service','ai-agent'];
async function loadEvents(){
  const path=evtSvc?'events?service='+evtSvc:'events';
  const d=await A(path);const tb=document.getElementById('events-body');
  const sf=document.getElementById('evt-filters');
  if(!sf.children.length)sf.innerHTML=\`<span class="mtab active" onclick="fltEvt('',this)">All</span>\`+EVT_SVCS.map(s=>\`<span class="mtab" onclick="fltEvt('\${s}',this)">\${s}</span>\`).join('');
  if(!Array.isArray(d)||!d.length){tb.innerHTML='<tr><td colspan="4" class="empty">No events yet</td></tr>';return;}
  tb.innerHTML=d.map(e=>\`<tr><td style="color:var(--blue)">\${e.service}</td><td>\${e.event}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333;font-size:10px">\${e.payload||''}</td><td class="ts">\${new Date(e.ts*1000).toLocaleString()}</td></tr>\`).join('');
}
function fltEvt(s,btn){evtSvc=s;document.querySelectorAll('#evt-filters .mtab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');loadEvents();}

let lbMode='duel';
async function loadPvp(){
  const [lobbies,lb]=await Promise.all([A('pvp/lobbies'),A('pvp/leaderboard?mode='+lbMode)]);
  const open=Array.isArray(lobbies)?lobbies.filter(l=>l.status==='waiting'):[];
  const active=Array.isArray(lobbies)?lobbies.filter(l=>l.status==='in_progress'):[];
  document.getElementById('pvp-open').textContent=open.length;
  document.getElementById('pvp-active').textContent=active.length;
  document.getElementById('pvp-queue').textContent='—';
  const lt=document.getElementById('pvp-lobbies');
  lt.innerHTML=!open.length?'<div class="empty">No open lobbies</div>':\`<table><thead><tr><th>Code</th><th>Mode</th><th>Island</th><th>Host</th><th>Players</th></tr></thead><tbody>\${open.map(l=>\`<tr><td><code style="color:var(--gold)">\${l.lobby_code}</code></td><td><span class="tag">\${l.mode}</span></td><td><span class="tag">\${l.island}</span></td><td>\${l.host_username||'—'}</td><td>\${l.player_count}/\${l.max_players}</td></tr>\`).join('')}</tbody></table>\`;
  renderLB(lb);
}
function renderLB(data){
  const el=document.getElementById('pvp-lb');const lb=data?.leaderboard||[];
  if(!lb.length){el.innerHTML='<div class="empty">No ranked players yet</div>';return;}
  el.innerHTML=\`<table><thead><tr><th>#</th><th>Player</th><th>ELO</th><th>W/L</th><th>Streak</th><th>Win%</th></tr></thead><tbody>\${lb.map((p,i)=>\`<tr><td style="color:#333">\${i+1}</td><td>\${p.username||'—'}\${p.faction?' <span class=\\"tag\\">\'+p.faction+\'</span>':''}</td><td style="color:var(--gold);font-weight:700">\${p.rating}</td><td><span style="color:var(--green)">\${p.wins}</span>/<span style="color:var(--red)">\${p.losses}</span></td><td style="color:\${p.streak>0?'var(--green)':p.streak<0?'var(--red)':'#555'}">\${p.streak>0?'+':''}\${p.streak}</td><td>\${p.win_rate}%</td></tr>\`).join('')}</tbody></table>\`;
}
async function switchLB(mode,btn){
  lbMode=mode;
  document.querySelectorAll('.mtab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderLB(await A('pvp/leaderboard?mode='+mode));
}

async function loadEconomy(){
  const d=await A('economy');const el=document.getElementById('economy-out');
  if(d.error){el.innerHTML=\`<div class="card"><div class="empty">\${d.error}</div></div>\`;return;}
  el.innerHTML=\`<div class="card"><pre style="color:#666;font-size:11px;overflow:auto;max-height:600px">\${JSON.stringify(d,null,2)}</pre></div>\`;
}

async function loadStorage(){loadR2();loadD1();}

async function loadAll(){
  await Promise.all([loadHealth(),loadMetrics(),loadD1(),loadWs()]);
}

loadAll();
setInterval(loadAll,30000);
</script>
</body></html>`);
}

// ── Helpers ───────────────────────────────────────────────────
const SEC = {
  'Strict-Transport-Security':'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN',
  'Referrer-Policy':'strict-origin-when-cross-origin',
};
function json(data,status=200){
  const h=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  for(const[k,v]of Object.entries(SEC))h.set(k,v);
  return new Response(JSON.stringify(data,null,2),{status,headers:h});
}
function html(content){
  const h=new Headers({'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store'});
  for(const[k,v]of Object.entries(SEC))h.set(k,v);
  return new Response(content,{headers:h});
}
