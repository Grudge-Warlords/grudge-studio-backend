/**
 * Grudge Studio — Main Site Worker
 * Serves grudge-studio.com — landing page, API status, docs, tools
 */

const SERVICES = [
  { key: 'id',       label: 'Identity API',   url: 'https://id.grudge-studio.com/health' },
  { key: 'api',      label: 'Game API',        url: 'https://api.grudge-studio.com/health' },
  { key: 'account',  label: 'Account API',     url: 'https://account.grudge-studio.com/health' },
  { key: 'launcher', label: 'Launcher API',    url: 'https://launcher.grudge-studio.com/health' },
  { key: 'ws',       label: 'WebSocket',       url: 'https://ws.grudge-studio.com/health' },
  { key: 'assets',   label: 'Asset CDN',       url: 'https://assets.grudge-studio.com/health' },
];

// ── Route dispatcher ────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/status') return handleStatus(request);
    if (path === '/api/docs.json') return handleDocsJson();
    return handlePage(env);
  },
};

// ── Live service status (parallel health checks) ────────────────────────────
async function handleStatus(request) {
  const checks = await Promise.allSettled(
    SERVICES.map(async (svc) => {
      const start = Date.now();
      try {
        const r = await fetch(svc.url, { signal: AbortSignal.timeout(4000) });
        const body = await r.json().catch(() => ({}));
        return { key: svc.key, label: svc.label, status: r.ok ? 'ok' : 'degraded', latency: Date.now() - start, detail: body };
      } catch {
        return { key: svc.key, label: svc.label, status: 'down', latency: null, detail: null };
      }
    })
  );

  const results = checks.map(r => r.value ?? r.reason);
  const allOk = results.every(r => r.status === 'ok');
  return Response.json(
    { ok: allOk, services: results, ts: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } }
  );
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
  </div>
  <a class="nav-cta" href="https://dash.grudge-studio.com" target="_blank">Dashboard</a>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="hero-badge"><span></span>All systems operational</div>
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

<!-- FOOTER -->
<footer>
  <div class="f-logo">GRUDGE STUDIO</div>
  <p>Grudge Warlords game backend infrastructure — built for scale, built for battle.</p>
  <div class="f-links">
    <a href="https://dash.grudge-studio.com" target="_blank">Dashboard</a>
    <div class="f-divider"></div>
    <a href="https://api.grudge-studio.com/health" target="_blank">API Health</a>
    <div class="f-divider"></div>
    <a href="/api/docs.json" target="_blank">API Spec</a>
    <div class="f-divider"></div>
    <a href="https://assets.grudge-studio.com" target="_blank">CDN</a>
    <div class="f-divider"></div>
    <a href="https://grudgewarlords.com" target="_blank">Play the Game</a>
  </div>
</footer>

<script>
async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const data = await r.json();
    data.services.forEach(svc => {
      const dot = document.getElementById('dot-' + svc.key);
      const st  = document.getElementById('st-' + svc.key);
      const lat = document.getElementById('lat-' + svc.key);
      if (!dot) return;
      dot.className = 's-dot ' + svc.status;
      st.textContent = svc.status === 'ok' ? 'Operational' : svc.status === 'degraded' ? 'Degraded' : 'Down';
      lat.textContent = svc.latency ? svc.latency + 'ms' : '';
    });
    const allOk = data.services.every(s => s.status === 'ok');
    const overall = document.getElementById('overall-dot');
    const overallText = document.getElementById('overall-text');
    overall.className = 'big-dot ' + (allOk ? 'ok' : '');
    overallText.textContent = allOk
      ? 'All systems operational'
      : 'Some services degraded — check below';
    // Update hero badge
    const badge = document.querySelector('.hero-badge');
    if (badge) badge.childNodes[1].textContent = allOk ? ' All systems operational' : ' Partial outage';
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
