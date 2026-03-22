/**
 * GRUDA Legion AI Hub — Cloudflare Worker
 *
 * Centralized AI gateway for all Grudge Studio apps.
 * Workers AI (edge) with VPS ai-agent fallback/escalation.
 *
 * Routes:
 *   GET    /health                  Health check (public)
 *   GET    /v1/agents               List agent roles (public)
 *   POST   /v1/chat                 General chat (auth)
 *   POST   /v1/agents/:role/chat    Role-specialized chat (auth)
 *   POST   /v1/image/generate       Image generation (auth)
 *   POST   /v1/embed                Text embeddings (auth)
 *   GET    /v1/admin/usage          Usage analytics (admin)
 *   GET    /v1/admin/health         Provider diagnostics (admin)
 *   GET    /v1/admin/config         Agent role config (admin)
 *   PUT    /v1/admin/config/:role   Update role config (admin)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const origin = request.headers.get('Origin') || '';
    const requestId = crypto.randomUUID();

    // ── CORS preflight ─────────────────────────────────────────
    if (method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }), origin);
    }

    try {
      // ── Maintenance mode check ─────────────────────────────────
      const maintenance = await env.KV.get('flag:maintenance');
      if (maintenance === 'true' && !url.pathname.startsWith('/v1/admin')) {
        return corsResponse(json({ error: 'AI Hub is under maintenance', retry_after: 60 }, 503), origin);
      }

      // ── Router ─────────────────────────────────────────────────

      // Public routes
      if (url.pathname === '/health' || url.pathname === '/v1/health') {
        return corsResponse(await handleHealth(env), origin);
      }
      if (url.pathname === '/v1/agents' && method === 'GET') {
        return corsResponse(await handleListAgents(env), origin);
      }

      // ── Payload size guard ───────────────────────────────────
      const maxBytes = parseInt(env.MAX_PAYLOAD_BYTES || '65536', 10);
      if (method === 'POST') {
        const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
        if (contentLength > maxBytes) {
          return corsResponse(json({ error: `Payload too large (max ${maxBytes} bytes)` }, 413), origin);
        }
      }

      // ── Auth required beyond this point ────────────────────────
      const auth = await authenticate(request, env);
      if (auth.error) {
        return corsResponse(json({ error: auth.error }, 401), origin);
      }

      // ── Rate limiting ──────────────────────────────────────────
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateKey = auth.keyId ? `rl:key:${auth.keyId}` : `rl:ip:${ip}`;
      const rpm = auth.scope === 'admin'
        ? parseInt(env.RATE_LIMIT_RPM_ADMIN || '300', 10)
        : (auth.rpmLimit || parseInt(env.RATE_LIMIT_RPM || '60', 10));

      const limited = await checkRateLimit(env.KV, rateKey, rpm);
      if (limited) {
        await logRequest(env, { requestId, apiKeyId: auth.keyId, role: null, provider: 'none', model: null, status: 'rate-limited', latencyMs: 0 });
        return corsResponse(json({ error: 'Rate limit exceeded', retry_after: 60 }, 429), origin);
      }

      // ── Authenticated routes ───────────────────────────────────

      // POST /v1/chat
      if (url.pathname === '/v1/chat' && method === 'POST') {
        return corsResponse(await handleChat(request, env, auth, requestId, 'general'), origin);
      }

      // POST /v1/agents/:role/chat
      const roleMatch = url.pathname.match(/^\/v1\/agents\/([a-z]+)\/chat$/);
      if (roleMatch && method === 'POST') {
        return corsResponse(await handleChat(request, env, auth, requestId, roleMatch[1]), origin);
      }

      // POST /v1/image/generate
      if (url.pathname === '/v1/image/generate' && method === 'POST') {
        return corsResponse(await handleImageGenerate(request, env, auth, requestId), origin);
      }

      // POST /v1/embed
      if (url.pathname === '/v1/embed' && method === 'POST') {
        return corsResponse(await handleEmbed(request, env, auth, requestId), origin);
      }

      // ── Admin routes ───────────────────────────────────────────
      if (url.pathname.startsWith('/v1/admin')) {
        if (auth.scope !== 'admin') {
          return corsResponse(json({ error: 'Admin access required' }, 403), origin);
        }

        if (url.pathname === '/v1/admin/usage' && method === 'GET') {
          return corsResponse(await handleAdminUsage(url, env), origin);
        }
        if (url.pathname === '/v1/admin/health' && method === 'GET') {
          return corsResponse(await handleAdminHealth(env), origin);
        }
        if (url.pathname === '/v1/admin/config' && method === 'GET') {
          return corsResponse(await handleAdminConfig(env), origin);
        }
        const configMatch = url.pathname.match(/^\/v1\/admin\/config\/([a-z]+)$/);
        if (configMatch && method === 'PUT') {
          return corsResponse(await handleAdminUpdateConfig(request, env, configMatch[1]), origin);
        }
      }

      return corsResponse(json({ error: 'Not found' }, 404), origin);
    } catch (err) {
      console.error('Unhandled error:', err);
      return corsResponse(json({ error: 'Internal server error', request_id: requestId }, 500), origin);
    }
  },
};


// ════════════════════════════════════════════════════════════════
//  Authentication
// ════════════════════════════════════════════════════════════════

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const apiKey = header.startsWith('Bearer ') ? header.slice(7) : header;

  if (!apiKey) {
    return { error: 'Missing Authorization header (Bearer <api-key>)' };
  }

  // Hash the key and look up in D1
  const keyHash = await sha256(apiKey);

  try {
    const row = await env.DB.prepare(
      'SELECT id, name, scope, tier, rpm_limit, enabled FROM api_keys WHERE key_hash = ?'
    ).bind(keyHash).first();

    if (!row) {
      return { error: 'Invalid API key' };
    }
    if (!row.enabled) {
      return { error: 'API key disabled' };
    }

    // Update last_used (fire and forget)
    env.DB.prepare('UPDATE api_keys SET last_used = datetime(\'now\') WHERE id = ?')
      .bind(row.id).run().catch(() => {});

    return { keyId: row.id, name: row.name, scope: row.scope, tier: row.tier, rpmLimit: row.rpm_limit };
  } catch (err) {
    // D1 unavailable — allow with default limits if key matches env fallback
    console.warn('D1 auth lookup failed, checking env fallback:', err.message);
    const fallbackKey = env.VPS_INTERNAL_KEY;
    if (fallbackKey && apiKey === fallbackKey) {
      return { keyId: 'env-fallback', name: 'internal', scope: 'admin', tier: 'internal', rpmLimit: 300 };
    }
    return { error: 'Authentication service unavailable' };
  }
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}


// ════════════════════════════════════════════════════════════════
//  Rate Limiting (KV-based sliding window)
// ════════════════════════════════════════════════════════════════

async function checkRateLimit(kv, key, maxRpm) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `${key}:${Math.floor(now / 60)}`;
    const count = parseInt(await kv.get(windowKey) || '0', 10);

    if (count >= maxRpm) return true;

    // Increment (fire and forget, async — doesn't block response)
    kv.put(windowKey, String(count + 1), { expirationTtl: 120 }).catch(() => {});
    return false;
  } catch {
    // KV unavailable — fail open
    return false;
  }
}


// ════════════════════════════════════════════════════════════════
//  Handlers
// ════════════════════════════════════════════════════════════════

/** GET /health */
async function handleHealth(env) {
  let vpsStatus = 'unknown';
  try {
    const resp = await fetch(`${env.VPS_AI_AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    vpsStatus = resp.ok ? 'healthy' : `error-${resp.status}`;
  } catch {
    vpsStatus = 'unreachable';
  }

  return json({
    status: 'ok',
    service: 'grudge-ai-hub',
    version: '1.0.0',
    environment: env.ENVIRONMENT,
    providers: {
      workers_ai: 'available',
      vps_ai_agent: vpsStatus,
    },
    timestamp: new Date().toISOString(),
  });
}

/** GET /v1/agents */
async function handleListAgents(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT role, display_name, description, model, escalate_to_vps, enabled FROM agent_roles ORDER BY role'
    ).all();

    return json({
      agents: results.map(r => ({
        role: r.role,
        name: r.display_name,
        description: r.description,
        model: r.model,
        escalates_to_vps: !!r.escalate_to_vps,
        enabled: !!r.enabled,
        endpoint: `/v1/agents/${r.role}/chat`,
      })),
      count: results.length,
    });
  } catch (err) {
    // D1 unavailable — return static fallback
    const roles = ['general', 'dev', 'balance', 'lore', 'art', 'mission', 'companion', 'faction'];
    return json({
      agents: roles.map(r => ({ role: r, endpoint: `/v1/agents/${r}/chat` })),
      count: roles.length,
      note: 'Static fallback — D1 unavailable',
    });
  }
}

/** POST /v1/chat and POST /v1/agents/:role/chat */
async function handleChat(request, env, auth, requestId, role) {
  const start = Date.now();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { message, messages, model, temperature, max_tokens } = body;

  // Accept either a single message string or a messages array
  let chatMessages;
  if (messages && Array.isArray(messages)) {
    chatMessages = messages;
  } else if (message) {
    chatMessages = [{ role: 'user', content: message }];
  } else {
    return json({ error: 'Provide "message" (string) or "messages" (array)' }, 400);
  }

  // Get role config from D1
  let roleConfig = null;
  try {
    roleConfig = await env.DB.prepare(
      'SELECT * FROM agent_roles WHERE role = ? AND enabled = 1'
    ).bind(role).first();
  } catch {
    // D1 unavailable — use inline defaults
  }

  if (!roleConfig) {
    // Inline fallback for known roles
    roleConfig = {
      role,
      system_prompt: `You are the GRUDA Legion AI assistant for Grudge Studio. Role: ${role}.`,
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.7,
      max_tokens: 1024,
      escalate_to_vps: 0,
    };
  }

  // Build full messages array with system prompt
  const fullMessages = [
    { role: 'system', content: roleConfig.system_prompt },
    ...chatMessages,
  ];

  const useModel = model || roleConfig.model;
  const useTemp = temperature ?? roleConfig.temperature;
  const useMaxTokens = max_tokens || roleConfig.max_tokens;

  // ── Escalation check: if role requires VPS, go straight there ──
  if (roleConfig.escalate_to_vps) {
    const vpsResult = await escalateToVps(env, role, fullMessages, useTemp, useMaxTokens, requestId);
    const latency = Date.now() - start;
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role, provider: vpsResult.provider,
      model: vpsResult.model, status: vpsResult.error ? 'error' : 'escalated',
      latencyMs: latency, tokensIn: vpsResult.usage?.input, tokensOut: vpsResult.usage?.output,
      error: vpsResult.error,
    });
    if (vpsResult.error) {
      return json({ error: vpsResult.error, provider: 'vps', request_id: requestId }, 502);
    }
    return json({
      response: vpsResult.content,
      provider: vpsResult.provider,
      model: vpsResult.model,
      role,
      usage: vpsResult.usage,
      request_id: requestId,
    });
  }

  // ── Primary: Workers AI ───────────────────────────────────────
  try {
    const aiResult = await env.AI.run(useModel, {
      messages: fullMessages,
      temperature: useTemp,
      max_tokens: useMaxTokens,
    });

    const latency = Date.now() - start;
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role, provider: 'workers-ai',
      model: useModel, status: 'ok', latencyMs: latency,
    });

    return json({
      response: aiResult.response,
      provider: 'workers-ai',
      model: useModel,
      role,
      request_id: requestId,
    });
  } catch (aiErr) {
    console.warn(`Workers AI failed for ${role}:`, aiErr.message);

    // ── Fallback: escalate to VPS ─────────────────────────────
    const vpsResult = await escalateToVps(env, role, fullMessages, useTemp, useMaxTokens, requestId);
    const latency = Date.now() - start;
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role,
      provider: vpsResult.error ? 'fallback' : vpsResult.provider,
      model: vpsResult.model, status: vpsResult.error ? 'error' : 'escalated',
      latencyMs: latency, tokensIn: vpsResult.usage?.input, tokensOut: vpsResult.usage?.output,
      error: vpsResult.error || `workers-ai-failed: ${aiErr.message}`,
    });

    if (vpsResult.error) {
      return json({
        error: 'All AI providers unavailable',
        details: { workers_ai: aiErr.message, vps: vpsResult.error },
        request_id: requestId,
      }, 503);
    }

    return json({
      response: vpsResult.content,
      provider: vpsResult.provider,
      model: vpsResult.model,
      role,
      fallback: true,
      request_id: requestId,
    });
  }
}

/** POST /v1/image/generate */
async function handleImageGenerate(request, env, auth, requestId) {
  const start = Date.now();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { prompt, num_steps, guidance } = body;
  if (!prompt) return json({ error: '"prompt" is required' }, 400);

  try {
    const result = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
      prompt,
      num_steps: num_steps || 20,
      guidance: guidance || 7.5,
    });

    const latency = Date.now() - start;
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role: 'image', provider: 'workers-ai',
      model: '@cf/stabilityai/stable-diffusion-xl-base-1.0', status: 'ok', latencyMs: latency,
    });

    // Result is a ReadableStream of PNG bytes
    return new Response(result, {
      headers: {
        'Content-Type': 'image/png',
        'X-Request-Id': requestId,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role: 'image', provider: 'workers-ai',
      model: '@cf/stabilityai/stable-diffusion-xl-base-1.0', status: 'error',
      latencyMs: Date.now() - start, error: err.message,
    });
    return json({ error: 'Image generation failed', details: err.message, request_id: requestId }, 502);
  }
}

/** POST /v1/embed */
async function handleEmbed(request, env, auth, requestId) {
  const start = Date.now();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { text, texts } = body;
  const input = texts || (text ? [text] : null);
  if (!input || input.length === 0) return json({ error: '"text" (string) or "texts" (array) is required' }, 400);
  if (input.length > 100) return json({ error: 'Max 100 texts per request' }, 400);

  try {
    const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: input,
    });

    const latency = Date.now() - start;
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role: 'embed', provider: 'workers-ai',
      model: '@cf/baai/bge-base-en-v1.5', status: 'ok', latencyMs: latency,
    });

    return json({
      embeddings: result.data,
      model: '@cf/baai/bge-base-en-v1.5',
      count: input.length,
      request_id: requestId,
    });
  } catch (err) {
    await logRequest(env, {
      requestId, apiKeyId: auth.keyId, role: 'embed', provider: 'workers-ai',
      model: '@cf/baai/bge-base-en-v1.5', status: 'error',
      latencyMs: Date.now() - start, error: err.message,
    });
    return json({ error: 'Embedding failed', details: err.message, request_id: requestId }, 502);
  }
}


// ════════════════════════════════════════════════════════════════
//  VPS Escalation (circuit breaker)
// ════════════════════════════════════════════════════════════════

const VPS_ROLE_MAP = {
  general: '/api/chat',
  dev:     '/ai/dev/review',
  balance: '/ai/balance/analyze',
  lore:    '/ai/lore/generate',
  art:     '/ai/art/prompt',
  mission: '/ai/mission/generate',
  companion: '/ai/companion/interact',
  faction: '/ai/faction/intel',
};

async function escalateToVps(env, role, messages, temperature, maxTokens, requestId) {
  const vpsUrl = env.VPS_AI_AGENT_URL;
  const internalKey = env.VPS_INTERNAL_KEY;

  // For general chat, use the simple /api/chat endpoint
  const endpoint = VPS_ROLE_MAP[role] || '/api/chat';
  const isAiRoute = endpoint.startsWith('/ai/');

  try {
    // Build request body based on endpoint type
    let body;
    const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

    if (isAiRoute) {
      // VPS ai-agent routes expect role-specific payloads
      body = JSON.stringify({
        messages,
        content: userMessage,
        description: userMessage,
        temperature,
        maxTokens,
      });
    } else {
      body = JSON.stringify({
        message: userMessage,
        model: 'auto',
        temperature,
      });
    }

    const resp = await fetch(`${vpsUrl}${endpoint}`, {
      method: endpoint === '/ai/faction/intel' ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': internalKey || '',
        'X-Request-Id': requestId,
      },
      body: endpoint === '/ai/faction/intel' ? undefined : body,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      return { error: `VPS returned ${resp.status}: ${errText}` };
    }

    const data = await resp.json();
    return {
      content: data.data?.content || data.response || data.raw || JSON.stringify(data),
      provider: `vps-${data.provider || 'unknown'}`,
      model: data.model || 'unknown',
      usage: data.usage || {},
    };
  } catch (err) {
    return { error: `VPS unreachable: ${err.message}` };
  }
}


// ════════════════════════════════════════════════════════════════
//  Admin Handlers
// ════════════════════════════════════════════════════════════════

/** GET /v1/admin/usage?hours=24&role=dev */
async function handleAdminUsage(url, env) {
  const hours = parseInt(url.searchParams.get('hours') || '24', 10);
  const role = url.searchParams.get('role');
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  try {
    let sql = `SELECT
      provider,
      role,
      status,
      COUNT(*) as count,
      AVG(latency_ms) as avg_latency_ms,
      SUM(tokens_in) as total_tokens_in,
      SUM(tokens_out) as total_tokens_out
    FROM request_logs
    WHERE created_at >= ?`;
    const params = [since];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    sql += ' GROUP BY provider, role, status ORDER BY count DESC';

    const { results } = await env.DB.prepare(sql).bind(...params).all();

    // Total counts
    const totalResult = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM request_logs WHERE created_at >= ?'
    ).bind(since).first();

    return json({
      period_hours: hours,
      total_requests: totalResult?.total || 0,
      breakdown: results,
      since,
    });
  } catch (err) {
    return json({ error: 'Usage query failed', details: err.message }, 500);
  }
}

/** GET /v1/admin/health */
async function handleAdminHealth(env) {
  // Check Workers AI
  let workersAiStatus = 'unknown';
  try {
    const test = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    workersAiStatus = test.response ? 'healthy' : 'degraded';
  } catch (err) {
    workersAiStatus = `error: ${err.message}`;
  }

  // Check VPS
  let vpsStatus = 'unknown';
  try {
    const resp = await fetch(`${env.VPS_AI_AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json().catch(() => ({}));
    vpsStatus = resp.ok ? 'healthy' : `error-${resp.status}`;
  } catch (err) {
    vpsStatus = `unreachable: ${err.message}`;
  }

  // Check D1
  let d1Status = 'unknown';
  try {
    await env.DB.prepare('SELECT 1').first();
    d1Status = 'healthy';
  } catch (err) {
    d1Status = `error: ${err.message}`;
  }

  // Check KV
  let kvStatus = 'unknown';
  try {
    await env.KV.put('health:check', 'ok', { expirationTtl: 60 });
    kvStatus = 'healthy';
  } catch (err) {
    kvStatus = `error: ${err.message}`;
  }

  return json({
    workers_ai: workersAiStatus,
    vps_ai_agent: vpsStatus,
    d1: d1Status,
    kv: kvStatus,
    timestamp: new Date().toISOString(),
  });
}

/** GET /v1/admin/config */
async function handleAdminConfig(env) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM agent_roles ORDER BY role').all();
    return json({ roles: results });
  } catch (err) {
    return json({ error: 'Config query failed', details: err.message }, 500);
  }
}

/** PUT /v1/admin/config/:role */
async function handleAdminUpdateConfig(request, env, role) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { system_prompt, model, temperature, max_tokens, escalate_to_vps, enabled } = body;

  try {
    // Check role exists
    const existing = await env.DB.prepare('SELECT role FROM agent_roles WHERE role = ?').bind(role).first();
    if (!existing) {
      return json({ error: `Role "${role}" not found` }, 404);
    }

    // Build dynamic update
    const updates = [];
    const params = [];

    if (system_prompt !== undefined) { updates.push('system_prompt = ?'); params.push(system_prompt); }
    if (model !== undefined)         { updates.push('model = ?'); params.push(model); }
    if (temperature !== undefined)   { updates.push('temperature = ?'); params.push(temperature); }
    if (max_tokens !== undefined)    { updates.push('max_tokens = ?'); params.push(max_tokens); }
    if (escalate_to_vps !== undefined) { updates.push('escalate_to_vps = ?'); params.push(escalate_to_vps ? 1 : 0); }
    if (enabled !== undefined)       { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }

    if (updates.length === 0) {
      return json({ error: 'No fields to update' }, 400);
    }

    updates.push("updated_at = datetime('now')");
    params.push(role);

    await env.DB.prepare(
      `UPDATE agent_roles SET ${updates.join(', ')} WHERE role = ?`
    ).bind(...params).run();

    const updated = await env.DB.prepare('SELECT * FROM agent_roles WHERE role = ?').bind(role).first();
    return json({ updated: true, role: updated });
  } catch (err) {
    return json({ error: 'Config update failed', details: err.message }, 500);
  }
}


// ════════════════════════════════════════════════════════════════
//  D1 Logging (fire and forget)
// ════════════════════════════════════════════════════════════════

async function logRequest(env, { requestId, apiKeyId, role, provider, model, status, latencyMs, tokensIn, tokensOut, error }) {
  try {
    await env.DB.prepare(
      `INSERT INTO request_logs (request_id, api_key_id, role, provider, model, status, latency_ms, tokens_in, tokens_out, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(requestId, apiKeyId || null, role || null, provider, model || null, status, latencyMs || null, tokensIn || null, tokensOut || null, error || null).run();
  } catch (err) {
    console.warn('Failed to log request:', err.message);
  }
}


// ════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://grudgewarlords.com',
  'https://www.grudgewarlords.com',
  'https://grudge-studio.com',
  'https://grudgestudio.com',
  'https://dash.grudge-studio.com',
  'https://gdevelop-assistant.vercel.app',
  'https://warlord-crafting-suite.vercel.app',
  'https://grudge-engine-web.vercel.app',
  'https://gruda-wars.vercel.app',
  'https://nexus-nemesis-game.vercel.app',
  'https://grudge-angeler.vercel.app',
  'https://grudge-rts.vercel.app',
  'https://app.puter.com',
  'https://molochdagod.github.io',
];

function corsResponse(response, origin) {
  const headers = new Headers(response.headers);

  // Allow any *.vercel.app or *.grudge-studio.com or explicit origins
  const allowed = ALLOWED_ORIGINS.includes(origin)
    || origin.endsWith('.vercel.app')
    || origin.endsWith('.grudge-studio.com')
    || origin.endsWith('.grudgestudio.com');

  headers.set('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
