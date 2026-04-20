/**
 * GRUDGE STUDIO — Legion AI Chat Worker
 * Puter Serverless Worker (runs on puter.com infrastructure)
 *
 * ═══════════════════════════════════════════════════════════════
 *  DEPLOYMENT
 * ═══════════════════════════════════════════════════════════════
 *  1. Upload this file to your GRUDACHAIN Puter account
 *  2. Right-click → "Publish as Worker" in Puter desktop
 *  3. Choose URL: grudge-legion-chat  (or similar)
 *  4. Worker is live at: https://grudge-legion-chat.puter.site/api/chat
 *
 *  Or via CLI:
 *    puter-cli worker deploy legion-chat.js --name grudge-legion-chat
 *
 * ═══════════════════════════════════════════════════════════════
 *  THE PIP REVENUE MODEL
 * ═══════════════════════════════════════════════════════════════
 *  - `me`   = GRUDACHAIN context (our account) → analytics/admin KV
 *  - `user` = calling player's context → AI calls charged to THEM
 *
 *  Every user.puter.ai.chat() call:
 *    → Charges the PLAYER'S Puter account (they pay)
 *    → GRUDGE STUDIO earns Puter Incentive Program (PIP) revenue
 *    → We pay $0 for the AI call
 *
 * ═══════════════════════════════════════════════════════════════
 *  API
 * ═══════════════════════════════════════════════════════════════
 *  POST /api/chat
 *  Body: {
 *    message:     string    — user's message (required)
 *    core:        string    — GRD-17 core ID (default: 'grd17')
 *    history:     Array     — prior messages [{role,content}] (optional)
 *    grudgeId:    string    — player's Grudge ID (optional, for analytics)
 *    stream:      boolean   — stream response (default: false)
 *  }
 *
 *  GET /api/status
 *  Returns worker health and GRD-17 model map
 *
 *  GET /api/cores
 *  Returns all GRD-17 core definitions
 */

// ── GRD-17 Core definitions ───────────────────────────────────────────────────

const PUTER_MODELS = {
  grd17:            'claude-sonnet-4-5',
  grd27:            'gpt-5.2',
  dangrd:           'gpt-5.4',
  grdviz:           'gpt-5.4-nano',
  norightanswergrd: 'deepseek/deepseek-r1',
  grdsprint:        'gpt-5-nano',
  aleofthought:     'claude-sonnet-4-5',
  ale:              'gpt-5-nano',
  aleboss:          'gpt-5.2-chat',
};

const SYSTEM_PROMPTS = {
  grd17:            'You are GRD1.7, the System Core of the GRUDA AI Legion (GRUDGE STUDIO). Precise, structured, production-quality.',
  grd27:            'You are GRD2.7, the Deep Logic Core. Think step-by-step from first principles before answering.',
  dangrd:           'You are DANGRD, the Chaos Engineer. Bold, creative, unconventional. Challenge all assumptions.',
  grdviz:           'You are GRDVIZ, the Visual Core. Aesthetic, precise, design-driven. Make everything beautiful and clear.',
  norightanswergrd: 'You are NoRightAnswerGRD, the Paradox Core. Explore multiple perspectives. Thrive in ambiguity.',
  grdsprint:        'You are GRDSPRINT, the Speed Core. Fast, efficient, minimal. Every word counts.',
  aleofthought:     'You are ALEofThought, the Reasoning Chain Core. Show your full reasoning before conclusions.',
  ale:              'You are ALE, the Rapid Response Core. Direct, urgent, decisive. Critical info first.',
  aleboss:          'You are ALEBOSS, the Boss Coordinator. Strategic, commanding, big-picture oversight.',
};

const CORE_INFO = {
  grd17:            { name: 'GRD1.7 System Core',       bestAt: 'Architecture, security, foundation logic' },
  grd27:            { name: 'GRD2.7 Deep Logic',        bestAt: 'Complex reasoning, multi-step inference' },
  dangrd:           { name: 'DANGRD Chaos Engine',      bestAt: 'Creative disruption, unconventional solutions' },
  grdviz:           { name: 'GRDVIZ Visual Core',       bestAt: 'UI/UX, data visualization, design' },
  norightanswergrd: { name: 'NoRightAnswerGRD Paradox', bestAt: 'Edge cases, paradox resolution' },
  grdsprint:        { name: 'GRDSPRINT Speed Core',     bestAt: 'Performance optimization, rapid output' },
  aleofthought:     { name: 'ALEofThought Reasoning',   bestAt: 'Reasoning chains, decision logic' },
  ale:              { name: 'ALE Rapid Response',       bestAt: 'Emergency processing, instant answers' },
  aleboss:          { name: 'ALEBOSS Coordinator',      bestAt: 'Strategic oversight, multi-agent coordination' },
};

// ── Route handlers ────────────────────────────────────────────────────────────

// POST /api/chat
// The core PIP revenue route — AI runs on USER's Puter account
router.post('/api/chat', async ({ request, user, me }) => {
  const body = await request.json().catch(() => ({}));
  const { message, core = 'grd17', history = [], grudgeId, stream = false } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const model        = PUTER_MODELS[core]       || PUTER_MODELS.grd17;
  const systemPrompt = SYSTEM_PROMPTS[core]     || SYSTEM_PROMPTS.grd17;

  // Build messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user',   content: message },
  ];

  try {
    // ✅ KEY: user.puter.ai.chat() — charged to PLAYER's account → PIP revenue
    // If user context unavailable (direct call without auth), fall back to me.puter
    const puterCtx = user?.puter || me.puter;
    const isPIP    = !!(user?.puter);  // true = player paying → we earn

    let responseText;

    if (stream) {
      // Streaming response
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const resp = await puterCtx.ai.chat(messages, { model, stream: true });
            for await (const chunk of resp) {
              if (chunk?.text) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ text: chunk.text })}\n\n`
                ));
              }
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ error: err.message })}\n\n`
            ));
            controller.close();
          }
        },
      });

      // Track in analytics (async, non-blocking)
      trackEngagement(me.puter, grudgeId, core, isPIP).catch(() => {});

      return new Response(readable, {
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Core':        core,
          'X-Model':       model,
          'X-PIP':         String(isPIP),
        },
      });
    }

    // Non-streaming
    const resp = await puterCtx.ai.chat(messages, { model });
    const content = resp?.message?.content ?? resp;
    if (typeof content === 'string') {
      responseText = content;
    } else if (Array.isArray(content)) {
      responseText = content.map(c => c.text ?? '').join('');
    } else {
      responseText = String(content ?? '');
    }

    // Track in analytics (async)
    trackEngagement(me.puter, grudgeId, core, isPIP).catch(() => {});

    return {
      response:  responseText,
      core,
      model,
      source:    isPIP ? 'user-puter-pip' : 'grudachain-puter',
      pipActive: isPIP,
      timestamp: new Date().toISOString(),
    };

  } catch (err) {
    console.error('[legion-worker] Chat error:', err.message);
    return new Response(
      JSON.stringify({ error: 'AI chat failed', details: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

// GET /api/status
router.get('/api/status', ({ me }) => ({
  status:   'online',
  worker:   'grudge-legion-chat',
  version:  '1.0.0',
  cores:    Object.keys(PUTER_MODELS).length,
  models:   PUTER_MODELS,
  pip: {
    active: true,
    description: 'Every user.puter.ai call generates PIP revenue for GRUDGE STUDIO',
  },
}));

// GET /api/cores
router.get('/api/cores', () => ({
  cores: Object.entries(CORE_INFO).map(([id, info]) => ({
    id,
    ...info,
    model: PUTER_MODELS[id],
  })),
}));

// ── Analytics helper ──────────────────────────────────────────────────────────
// Store lightweight engagement data in GRUDACHAIN's own KV (me.puter)
// Used to verify monthly PIP payments against actual engagement

async function trackEngagement(mePuter, grudgeId, coreId, isPIP) {
  if (!mePuter) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const key   = `grudge_pip_engagement_${today}`;

    const raw = await mePuter.kv.get(key).catch(() => null);
    const stats = raw ? JSON.parse(raw) : { total: 0, byCore: {}, pipCount: 0 };

    stats.total += 1;
    if (isPIP) stats.pipCount += 1;
    stats.byCore[coreId] = (stats.byCore[coreId] || 0) + 1;

    await mePuter.kv.set(key, JSON.stringify(stats), { ttl: 32 * 24 * 3600 });
  } catch { /* analytics failures are silent */ }
}
