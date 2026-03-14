/**
 * Grudge Studio — Health Ping Worker
 *
 * External cron monitor (every 5 min) that pings all public service endpoints.
 * - Writes results to D1 dash_events table (shared with dashboard worker)
 * - Tracks consecutive failures in KV
 * - Alerts Discord after 2+ consecutive failures
 * - Sends recovery notification when a service comes back up
 *
 * Deploy:  cd cloudflare/workers/health-ping && npx wrangler deploy
 * Secret:  npx wrangler secret put DISCORD_SYSTEM_WEBHOOK
 */

const ENDPOINTS = {
  'grudge-id':    'https://id.grudge-studio.com/health',
  'game-api':     'https://api.grudge-studio.com/health',
  'account-api':  'https://account.grudge-studio.com/health',
  'launcher-api': 'https://launcher.grudge-studio.com/health',
  'ws-service':   'https://ws.grudge-studio.com/health',
  'asset-cdn':    'https://assets.grudge-studio.com/health',
};

const ALERT_THRESHOLD = 2;   // consecutive failures before alerting
const TIMEOUT_MS      = 8000;
const KV_PREFIX       = 'hp:fail:';

// ── Main cron handler ─────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    const results = await checkAll(env);
    ctx.waitUntil(recordResults(env, results));
  },

  // Also allow manual trigger via HTTP for testing
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const results = await checkAll(env);
      ctx.waitUntil(recordResults(env, results));
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Grudge Health Ping — use /run to trigger manually', { status: 200 });
  },
};

// ── Ping all endpoints ────────────────────────────────────────────────────────
async function checkAll(env) {
  const checks = Object.entries(ENDPOINTS).map(async ([name, url]) => {
    const t = Date.now();
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'GrudgeHealthPing/1.0' },
      });
      const ms = Date.now() - t;
      let body = {};
      try { body = await r.json(); } catch {}
      return {
        name,
        url,
        status: r.ok ? 'up' : 'degraded',
        code: r.status,
        ms,
        version: body?.version || null,
      };
    } catch (e) {
      return {
        name,
        url,
        status: 'down',
        code: 0,
        ms: Date.now() - t,
        error: e.message,
      };
    }
  });
  return Promise.all(checks);
}

// ── Record to D1, check thresholds, alert ─────────────────────────────────────
async function recordResults(env, results) {
  const now = Math.floor(Date.now() / 1000);
  const alerts = [];
  const recoveries = [];

  // Process each result
  for (const r of results) {
    const kvKey = `${KV_PREFIX}${r.name}`;

    if (r.status === 'down' || r.status === 'degraded') {
      // Increment consecutive failure count
      const prev = parseInt(await env.KV.get(kvKey) || '0', 10);
      const count = prev + 1;
      await env.KV.put(kvKey, String(count), { expirationTtl: 3600 });

      if (count === ALERT_THRESHOLD) {
        alerts.push(r);
      }
    } else {
      // Check if recovering from failure
      const prev = parseInt(await env.KV.get(kvKey) || '0', 10);
      if (prev >= ALERT_THRESHOLD) {
        recoveries.push({ ...r, downFor: prev });
      }
      await env.KV.delete(kvKey);
    }
  }

  // Write to D1
  if (env.DB) {
    try {
      // Ensure table exists
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS health_pings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service TEXT NOT NULL,
          status TEXT NOT NULL,
          code INTEGER,
          ms INTEGER,
          error TEXT,
          ts INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `).run();

      // Batch insert
      const stmt = env.DB.prepare(
        'INSERT INTO health_pings (service, status, code, ms, error, ts) VALUES (?, ?, ?, ?, ?, ?)'
      );
      await env.DB.batch(
        results.map(r => stmt.bind(r.name, r.status, r.code, r.ms, r.error || null, now))
      );

      // Also log to dash_events for dashboard visibility
      const evtStmt = env.DB.prepare(
        'INSERT INTO dash_events (service, event, payload, ts) VALUES (?, ?, ?, ?)'
      );
      const downServices = results.filter(r => r.status !== 'up');
      if (downServices.length > 0) {
        await env.DB.batch(
          downServices.map(r =>
            evtStmt.bind('health-ping', `service_${r.status}`, JSON.stringify(r), now)
          )
        );
      }

      // Prune old pings (keep 7 days)
      const cutoff = now - (7 * 86400);
      await env.DB.prepare('DELETE FROM health_pings WHERE ts < ?').bind(cutoff).run();
    } catch (e) {
      console.error('D1 write failed:', e.message);
    }
  }

  // Discord alerts
  if (env.DISCORD_SYSTEM_WEBHOOK) {
    for (const r of alerts) {
      await sendDiscordAlert(env, {
        title: `🚨 Service DOWN: ${r.name}`,
        color: 0xe85555,
        fields: [
          { name: 'Endpoint', value: r.url, inline: false },
          { name: 'Status', value: `${r.status} (${r.code})`, inline: true },
          { name: 'Response', value: `${r.ms}ms`, inline: true },
          { name: 'Error', value: r.error || 'HTTP error', inline: false },
        ],
        footer: `Alert after ${ALERT_THRESHOLD} consecutive failures`,
      });
    }

    for (const r of recoveries) {
      await sendDiscordAlert(env, {
        title: `✅ Service RECOVERED: ${r.name}`,
        color: 0x4caf7d,
        fields: [
          { name: 'Endpoint', value: r.url, inline: false },
          { name: 'Response', value: `${r.ms}ms`, inline: true },
          { name: 'Was down for', value: `${r.downFor} checks (~${r.downFor * 5}min)`, inline: true },
        ],
        footer: 'Service is back online',
      });
    }

    // Summary if everything is healthy (once per hour at :00)
    const allUp = results.every(r => r.status === 'up');
    const minute = new Date().getMinutes();
    if (allUp && minute < 5) {
      const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
      await sendDiscordAlert(env, {
        title: '⚔ Grudge Studio — All Systems Operational',
        color: 0x4caf7d,
        fields: results.map(r => ({
          name: r.name,
          value: `${r.ms}ms`,
          inline: true,
        })),
        footer: `Avg response: ${avg}ms`,
      });
    }
  }
}

// ── Discord webhook helper ────────────────────────────────────────────────────
async function sendDiscordAlert(env, { title, color, fields, footer }) {
  try {
    await fetch(env.DISCORD_SYSTEM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          color,
          fields,
          footer: { text: `Health Ping • ${new Date().toISOString().slice(0, 16)}Z — ${footer}` },
        }],
      }),
    });
  } catch (e) {
    console.error('Discord alert failed:', e.message);
  }
}
