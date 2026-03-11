/**
 * Grudge Studio — Backend Dashboard Worker
 *
 * Free Cloudflare services:
 *  ✅ Workers   — 100K req/day
 *  ✅ D1        — 5M reads / 100K writes / day
 *  ✅ R2        — zero egress, native binding
 *  ✅ KV        — session store
 *
 * Access: https://dash.grudge-studio.com
 * Auth:   x-dash-key header OR ?key= query param = INTERNAL_API_KEY
 *
 * Deploy:  npx wrangler deploy  (from cloudflare/workers/dashboard/)
 * Secret:  npx wrangler secret put DASH_API_KEY
 */

// ─── D1 schema (auto-init on first request) ───────────────────────────────────
const D1_INIT_SQL = `
CREATE TABLE IF NOT EXISTS dash_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  service   TEXT    NOT NULL,
  event     TEXT    NOT NULL,
  payload   TEXT,
  ts        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS dash_players (
  grudge_id TEXT PRIMARY KEY,
  username  TEXT,
  class     TEXT,
  faction   TEXT,
  level     INTEGER DEFAULT 1,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS dash_metrics (
  key   TEXT PRIMARY KEY,
  value TEXT,
  ts    INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

// ─── VPS services to health-check ─────────────────────────────────────────────
const SERVICES = [
  { name: 'grudge-id',     label: 'Identity',   url: null, port: 3001 },
  { name: 'game-api',      label: 'Game API',    url: null, port: 3003 },
  { name: 'account-api',   label: 'Account',     url: null, port: 3005 },
  { name: 'launcher-api',  label: 'Launcher',    url: null, port: 3006 },
  { name: 'ai-agent',      label: 'AI Agent',    url: null, port: 3004 },
];

// ─── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // ── Auth gate ──────────────────────────────────────────────────────────────
    const key = request.headers.get('x-dash-key') || url.searchParams.get('key') || '';
    if (!env.DASH_API_KEY || key !== env.DASH_API_KEY) {
      if (url.pathname === '/' && method === 'GET' && !key) {
        return loginPage();
      }
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Init D1 schema ────────────────────────────────────────────────────────
    ctx.waitUntil(initD1(env));

    // ── API routes ────────────────────────────────────────────────────────────
    if (url.pathname === '/api/health')   return apiHealth(env);
    if (url.pathname === '/api/r2')       return apiR2(env);
    if (url.pathname === '/api/d1')       return apiD1(env);
    if (url.pathname === '/api/players')  return apiPlayers(env);
    if (url.pathname === '/api/events')   return apiEvents(env);
    if (url.pathname === '/api/metrics')  return apiMetrics(env);

    // ── POST: log event ───────────────────────────────────────────────────────
    if (url.pathname === '/api/event' && method === 'POST') {
      return apiLogEvent(request, env);
    }

    // ── Dashboard HTML ────────────────────────────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return dashboardPage(env, key);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ─── D1 init ──────────────────────────────────────────────────────────────────
async function initD1(env) {
  if (!env.DB) return;
  try {
    for (const stmt of D1_INIT_SQL.trim().split(';').filter(s => s.trim())) {
      await env.DB.prepare(stmt).run();
    }
  } catch (e) {
    console.error('[dashboard] D1 init error:', e.message);
  }
}

// ─── API: VPS service health checks ──────────────────────────────────────────
async function apiHealth(env) {
  const vpsIp = env.VPS_IP || '74.208.155.229';
  const publicEndpoints = {
    'Identity':  env.IDENTITY_API  || 'https://id.grudge-studio.com',
    'Game API':  env.GAME_API      || 'https://api.grudge-studio.com',
    'Account':   env.ACCOUNT_API   || 'https://account.grudge-studio.com',
    'Launcher':  env.LAUNCHER_API  || 'https://launcher.grudge-studio.com',
    'CDN':       env.CDN_URL       || 'https://assets.grudge-studio.com',
  };

  const results = await Promise.allSettled(
    Object.entries(publicEndpoints).map(async ([name, base]) => {
      const start = Date.now();
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
        const ms = Date.now() - start;
        let body = {};
        try { body = await r.json(); } catch {}
        return { name, status: r.ok ? 'up' : 'degraded', code: r.status, ms, body };
      } catch (e) {
        return { name, status: 'down', ms: Date.now() - start, error: e.message };
      }
    })
  );

  const health = results.map(r => r.value ?? r.reason);
  return json(health);
}

// ─── API: R2 bucket stats ─────────────────────────────────────────────────────
async function apiR2(env) {
  if (!env.ASSETS) return json({ error: 'R2 not bound' }, 503);
  try {
    const listed = await env.ASSETS.list({ limit: 1000 });
    const byPrefix = {};
    let totalSize = 0;
    for (const obj of listed.objects) {
      const prefix = obj.key.split('/')[0] || 'root';
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
      totalSize += obj.size || 0;
    }
    return json({
      totalObjects: listed.objects.length,
      truncated: listed.truncated,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / 1_048_576).toFixed(2),
      byPrefix,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── API: D1 database stats ───────────────────────────────────────────────────
async function apiD1(env) {
  if (!env.DB) return json({ error: 'D1 not bound' }, 503);
  try {
    const [players, events, metrics] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_players').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_events').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM dash_metrics').first(),
    ]);
    return json({
      tables: {
        players: players?.count ?? 0,
        events:  events?.count  ?? 0,
        metrics: metrics?.count ?? 0,
      },
      database_id: '8fcb111b-fcee-4f4e-b0d5-59ad416ee3b9',
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── API: recent players ──────────────────────────────────────────────────────
async function apiPlayers(env) {
  if (!env.DB) return json([]);
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM dash_players ORDER BY last_seen DESC LIMIT 50'
    ).all();
    return json(results || []);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── API: recent events ───────────────────────────────────────────────────────
async function apiEvents(env) {
  if (!env.DB) return json([]);
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM dash_events ORDER BY ts DESC LIMIT 100'
    ).all();
    return json(results || []);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── API: metrics from KV ─────────────────────────────────────────────────────
async function apiMetrics(env) {
  if (!env.KV) return json({});
  try {
    const keys = ['active_players', 'total_logins', 'total_missions', 'gbux_circulating'];
    const vals = await Promise.all(keys.map(k => env.KV.get(k)));
    const out = {};
    keys.forEach((k, i) => { out[k] = vals[i] ?? '0'; });
    return json(out);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── API: log event (POST from VPS services) ─────────────────────────────────
async function apiLogEvent(request, env) {
  if (!env.DB) return json({ error: 'D1 not bound' }, 503);
  try {
    const { service, event, payload } = await request.json();
    if (!service || !event) return json({ error: 'service and event required' }, 400);
    await env.DB.prepare(
      'INSERT INTO dash_events (service, event, payload) VALUES (?, ?, ?)'
    ).bind(service, event, JSON.stringify(payload ?? null)).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ─── Login page ───────────────────────────────────────────────────────────────
function loginPage() {
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Grudge Studio — Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0f;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#12121a;border:1px solid #2a2a3a;border-radius:12px;padding:40px;width:340px;text-align:center}
    .logo{font-size:28px;font-weight:800;letter-spacing:2px;color:#e8c96f;text-transform:uppercase;margin-bottom:6px}
    .sub{color:#666;font-size:13px;margin-bottom:28px}
    input{width:100%;background:#0a0a0f;border:1px solid #2a2a3a;border-radius:8px;color:#e8c96f;padding:12px 14px;font-size:14px;margin-bottom:14px;outline:none}
    input:focus{border-color:#e8c96f}
    button{width:100%;background:#e8c96f;color:#0a0a0f;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
    button:hover{background:#f0d880}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚔ GRUDGE</div>
    <div class="sub">Backend Dashboard</div>
    <form onsubmit="login(event)">
      <input type="password" id="key" placeholder="API Key" autocomplete="current-password">
      <button type="submit">Enter</button>
    </form>
  </div>
  <script>
    function login(e) {
      e.preventDefault();
      const key = document.getElementById('key').value.trim();
      if (key) window.location.href = '/?key=' + encodeURIComponent(key);
    }
  </script>
</body>
</html>`);
}

// ─── Main dashboard page ──────────────────────────────────────────────────────
function dashboardPage(env, key) {
  const k = encodeURIComponent(key);
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Grudge Studio — Dashboard</title>
  <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token":"grudge-studio"}'></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--gold:#e8c96f;
    body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
    header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:16px}
    .logo{font-size:20px;font-weight:800;color:var(--gold);letter-spacing:2px;text-transform:uppercase}
    .badge{background:#1e1e2e;border:1px solid var(--border);border-radius:20px;padding:3px 12px;font-size:11px;color:#888}
    nav{display:flex;gap:4px;margin-left:auto}
    nav button{background:none;border:1px solid transparent;border-radius:6px;color:#888;padding:6px 14px;cursor:pointer;font-size:12px;transition:all .15s}
    nav button.active,nav button:hover{background:#1e1e2e;border-color:var(--border);color:var(--gold)}
    main{padding:24px;max-width:1400px;margin:0 auto}
    h2{color:var(--gold);font-size:15px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px}
    .grid{display:grid;gap:16px}
    .grid-4{grid-template-columns:repeat(4,1fr)}
    .grid-3{grid-template-columns:repeat(3,1fr)}
    .grid-2{grid-template-columns:repeat(2,1fr)}
    @media(max-width:900px){.grid-4,.grid-3{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:600px){.grid-4,.grid-3,.grid-2{grid-template-columns:1fr}}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px}
    .card-title{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .card-value{font-size:28px;font-weight:700;color:var(--gold)}
    .card-sub{font-size:11px;color:#666;margin-top:4px}
    .service-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
    .service-row:last-child{border-bottom:none}
    .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .dot.up{background:var(--green);box-shadow:0 0 6px var(--green)}
    .dot.down{background:var(--red);box-shadow:0 0 6px var(--red)}
    .dot.degraded{background:var(--yellow);box-shadow:0 0 6px var(--yellow)}
    .dot.checking{background:#555;animation:pulse 1s infinite}
    @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
    .svc-name{flex:1;font-weight:600;color:#ddd}
    .svc-ms{font-size:11px;color:#666;margin-left:auto}
    .svc-code{font-size:11px;color:#888;background:#1a1a2a;border-radius:4px;padding:1px 6px}
    .tab-content{display:none}
    .tab-content.active{display:block}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;border-bottom:1px solid var(--border)}
    td{padding:8px 12px;border-bottom:1px solid #0f0f1a;font-size:13px}
    tr:hover td{background:#0f0f1a}
    .tag{display:inline-block;background:#1e1e2e;border-radius:4px;padding:1px 8px;font-size:11px;color:#aaa}
    .refresh-btn{background:none;border:1px solid var(--border);border-radius:6px;color:#888;padding:5px 12px;cursor:pointer;font-size:11px;float:right}
    .refresh-btn:hover{color:var(--gold);border-color:var(--gold)}
    .empty{color:#555;text-align:center;padding:32px;font-size:13px}
    .r2-bar{background:#1e1e2e;border-radius:4px;height:6px;margin-top:6px;overflow:hidden}
    .r2-fill{background:var(--gold);height:100%;border-radius:4px;transition:width .5s}
    .event-service{color:var(--blue);font-size:12px}
    .ts{color:#555;font-size:11px}
  </style>
</head>
<body>
  <header>
    <div class="logo">⚔ Grudge Studio</div>
    <div class="badge">Backend Dashboard</div>
    <nav>
      <button class="active" onclick="showTab('overview',this)">Overview</button>
      <button onclick="showTab('services',this)">Services</button>
      <button onclick="showTab('storage',this)">Storage</button>
      <button onclick="showTab('players',this)">Players</button>
      <button onclick="showTab('events',this)">Events</button>
    </nav>
  </header>
  <main>

    <!-- OVERVIEW TAB -->
    <div id="tab-overview" class="tab-content active">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Overview</h2>
        <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
      </div>
      <div class="grid grid-4" style="margin-bottom:24px" id="metric-cards">
        <div class="card"><div class="card-title">Active Players</div><div class="card-value" id="m-active">—</div></div>
        <div class="card"><div class="card-title">Total Logins</div><div class="card-value" id="m-logins">—</div></div>
        <div class="card"><div class="card-title">Total Missions</div><div class="card-value" id="m-missions">—</div></div>
        <div class="card"><div class="card-title">GBUX Circulating</div><div class="card-value" id="m-gbux">—</div></div>
      </div>
      <div class="grid grid-3">
        <div class="card">
          <div class="card-title">Service Health</div>
          <div id="health-mini">
            ${SERVICES.map(s => `<div class="service-row"><div class="dot checking" id="dot-${s.name}"></div><div class="svc-name">${s.label}</div><div class="svc-ms" id="ms-${s.name}">—</div></div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-title">D1 Database</div>
          <div id="d1-stats"><div class="empty">Loading…</div></div>
        </div>
        <div class="card">
          <div class="card-title">R2 Assets Bucket</div>
          <div id="r2-mini"><div class="empty">Loading…</div></div>
        </div>
      </div>
    </div>

    <!-- SERVICES TAB -->
    <div id="tab-services" class="tab-content">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Services</h2>
        <button class="refresh-btn" onclick="loadHealth()">↻ Refresh</button>
      </div>
      <div class="card">
        <div id="health-detail"><div class="empty">Loading…</div></div>
      </div>
    </div>

    <!-- STORAGE TAB -->
    <div id="tab-storage" class="tab-content">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Storage</h2>
        <button class="refresh-btn" onclick="loadR2()">↻ Refresh</button>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">R2 — grudge-assets</div>
          <div id="r2-full"><div class="empty">Loading…</div></div>
        </div>
        <div class="card">
          <div class="card-title">D1 — grudge-studio-db</div>
          <div id="d1-full"><div class="empty">Loading…</div></div>
        </div>
      </div>
    </div>

    <!-- PLAYERS TAB -->
    <div id="tab-players" class="tab-content">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Players</h2>
        <button class="refresh-btn" onclick="loadPlayers()">↻ Refresh</button>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Grudge ID</th><th>Username</th><th>Class</th><th>Faction</th><th>Level</th><th>Last Seen</th></tr></thead>
          <tbody id="players-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- EVENTS TAB -->
    <div id="tab-events" class="tab-content">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">Event Log</h2>
        <button class="refresh-btn" onclick="loadEvents()">↻ Refresh</button>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Service</th><th>Event</th><th>Payload</th><th>Time</th></tr></thead>
          <tbody id="events-body"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

  </main>

  <script>
    const KEY = '${k}';
    const api = path => fetch('/api/' + path + '?key=' + KEY).then(r => r.json());

    function showTab(name, btn) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      btn.classList.add('active');
      if (name === 'services') loadHealth();
      if (name === 'storage')  loadR2(), loadD1();
      if (name === 'players')  loadPlayers();
      if (name === 'events')   loadEvents();
    }

    async function loadHealth() {
      const data = await api('health');
      const mini = document.getElementById('health-mini');
      const det  = document.getElementById('health-detail');
      if (!Array.isArray(data)) return;
      mini.innerHTML = data.map(s => \`
        <div class="service-row">
          <div class="dot \${s.status}" id="dot-\${s.name}"></div>
          <div class="svc-name">\${s.name}</div>
          <div class="svc-ms">\${s.ms}ms</div>
          \${s.code ? \`<div class="svc-code">\${s.code}</div>\` : ''}
        </div>\`).join('');
      det.innerHTML = data.map(s => \`
        <div class="service-row" style="padding:14px 0">
          <div class="dot \${s.status}"></div>
          <div class="svc-name" style="font-size:15px">\${s.name}</div>
          <div style="flex:1"></div>
          <div class="svc-ms" style="font-size:13px;color:\${s.status==='up'?'#4caf7d':s.status==='down'?'#e85555':'#e8c96f'}">\${s.status.toUpperCase()}</div>
          <div class="svc-ms">&nbsp;•&nbsp;\${s.ms}ms</div>
          \${s.code ? \`<div class="svc-code" style="margin-left:10px">HTTP \${s.code}</div>\` : ''}
        </div>\`).join('');
    }

    async function loadD1() {
      const data = await api('d1');
      const mini = document.getElementById('d1-stats');
      const full = document.getElementById('d1-full');
      if (data.error) { mini.innerHTML = \`<div class="empty">\${data.error}</div>\`; return; }
      const html = \`
        <div class="service-row"><div class="svc-name">Players</div><div style="color:var(--gold);font-weight:700">\${data.tables?.players ?? 0}</div></div>
        <div class="service-row"><div class="svc-name">Events</div><div style="color:var(--gold);font-weight:700">\${data.tables?.events ?? 0}</div></div>
        <div class="service-row"><div class="svc-name">Metrics</div><div style="color:var(--gold);font-weight:700">\${data.tables?.metrics ?? 0}</div></div>
        <div style="margin-top:8px;font-size:11px;color:#555">ID: \${data.database_id}</div>\`;
      mini.innerHTML = html;
      if (full) full.innerHTML = html;
    }

    async function loadR2() {
      const data = await api('r2');
      const mini = document.getElementById('r2-mini');
      const full = document.getElementById('r2-full');
      if (data.error) { mini.innerHTML = \`<div class="empty">\${data.error}</div>\`; return; }
      const prefixes = Object.entries(data.byPrefix || {}).map(([k,v]) =>
        \`<div class="service-row"><div class="svc-name">\${k}/</div><div style="color:var(--gold);\${''}">\${v} files</div></div>\`
      ).join('');
      const html = \`
        <div class="service-row"><div class="svc-name">Total Objects</div><div style="color:var(--gold);font-weight:700">\${data.totalObjects}</div></div>
        <div class="service-row"><div class="svc-name">Total Size</div><div style="color:var(--gold);font-weight:700">\${data.totalSizeMB} MB</div></div>
        <hr style="border-color:#1e1e2e;margin:8px 0">
        \${prefixes || '<div class="empty">No objects</div>'}\`;
      mini.innerHTML = html;
      if (full) full.innerHTML = html;
    }

    async function loadMetrics() {
      const data = await api('metrics');
      document.getElementById('m-active').textContent    = data.active_players ?? '0';
      document.getElementById('m-logins').textContent    = data.total_logins   ?? '0';
      document.getElementById('m-missions').textContent  = data.total_missions ?? '0';
      document.getElementById('m-gbux').textContent      = data.gbux_circulating ?? '0';
    }

    async function loadPlayers() {
      const data = await api('players');
      const tbody = document.getElementById('players-body');
      if (!Array.isArray(data) || !data.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No players tracked yet</td></tr>';
        return;
      }
      tbody.innerHTML = data.map(p => \`<tr>
        <td><code>\${p.grudge_id}</code></td>
        <td>\${p.username || '—'}</td>
        <td><span class="tag">\${p.class || '—'}</span></td>
        <td><span class="tag">\${p.faction || '—'}</span></td>
        <td>\${p.level}</td>
        <td class="ts">\${p.last_seen ? new Date(p.last_seen*1000).toLocaleString() : '—'}</td>
      </tr>\`).join('');
    }

    async function loadEvents() {
      const data = await api('events');
      const tbody = document.getElementById('events-body');
      if (!Array.isArray(data) || !data.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No events logged yet</td></tr>';
        return;
      }
      tbody.innerHTML = data.map(e => \`<tr>
        <td><span class="event-service">\${e.service}</span></td>
        <td>\${e.event}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#666;font-size:11px">\${e.payload ?? ''}</td>
        <td class="ts">\${new Date(e.ts*1000).toLocaleString()}</td>
      </tr>\`).join('');
    }

    async function loadAll() {
      loadHealth();
      loadMetrics();
      loadD1();
      loadR2();
    }

    loadAll();
    // Auto-refresh every 30s
    setInterval(loadAll, 30000);
  </script>
</body>
</html>`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// ─── Security headers applied to every response ──────────────────────────────
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'SAMEORIGIN',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Content-Security-Policy':   [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://assets.grudge-studio.com",
    "connect-src 'self' https://cloudflareinsights.com https://*.grudge-studio.com https://*.grudgestudio.com",
    "frame-ancestors 'none'",
  ].join('; '),
};

function applySecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
}

function json(data, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function html(content) {
  const headers = new Headers({
    'Content-Type': 'text/html;charset=UTF-8',
    'Cache-Control': 'no-store',
  });
  applySecurityHeaders(headers);
  return new Response(content, { headers });
}
