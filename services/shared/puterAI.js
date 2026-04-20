/**
 * GRUDGE STUDIO — Shared Puter AI Provider
 * Server-side Node.js Puter AI using GRUDACHAIN account.
 *
 * Usage in any service (ai-agent, game-api, etc.):
 *   const { puterChat, PUTER_MODELS } = require('../../shared/puterAI');
 *   const text = await puterChat('Design a quest', { core: 'grd17' });
 *
 * Provider chain:
 *   Puter AI (GRUDACHAIN) → existing LLM providers (Anthropic, OpenAI, etc.)
 *
 * Env var: PUTER_AUTH_TOKEN  (get from puter.com/dashboard as GRUDACHAIN)
 */

'use strict';

// ── GRD-17 Core → Puter model map ────────────────────────────────────────────

const PUTER_MODELS = {
  grd17:            'claude-sonnet-4-5',   // System Core & Foundation Logic
  grd27:            'gpt-5.2',             // Deep Logic & Advanced Reasoning
  dangrd:           'gpt-5.4',             // Chaos Engineering & Creative
  grdviz:           'gpt-5.4-nano',        // Visual Design & Data Presentation
  norightanswergrd: 'deepseek/deepseek-r1',// Paradox Resolution
  grdsprint:        'gpt-5-nano',          // Performance & Speed (fastest)
  aleofthought:     'claude-sonnet-4-5',   // Reasoning Chains
  ale:              'gpt-5-nano',          // Rapid Response (ultra-low latency)
  aleboss:          'gpt-5.2-chat',        // Strategic Coordination
  // Generic aliases
  auto:             'claude-sonnet-4-5',
  default:          'gpt-5-nano',
};

// ── System prompts per GRD-17 core ───────────────────────────────────────────

const SYSTEM_PROMPTS = {
  grd17: 'You are GRD1.7, the System Core of the GRUDA AI Legion (GRUDGE STUDIO). Precise, structured, production-quality responses only.',
  grd27: 'You are GRD2.7, the Deep Logic Core of the GRUDA AI Legion. Think step-by-step from first principles before answering.',
  dangrd: 'You are DANGRD, the Chaos Engineer of the GRUDA AI Legion. Bold, creative, unconventional. Challenge all assumptions.',
  grdviz: 'You are GRDVIZ, the Visual Core of the GRUDA AI Legion. Aesthetic, precise, design-driven. Make everything beautiful and clear.',
  norightanswergrd: 'You are NoRightAnswerGRD, the Paradox Core. Explore multiple perspectives simultaneously. Thrive in ambiguity.',
  grdsprint: 'You are GRDSPRINT, the Speed Core. Fast, efficient, minimal. Every word counts. No padding.',
  aleofthought: 'You are ALEofThought, the Reasoning Chain Core. Show your full reasoning chain explicitly before conclusions.',
  ale: 'You are ALE, the Rapid Response Core. Direct, urgent, decisive. No fluff. Most critical information first.',
  aleboss: 'You are ALEBOSS, the Boss-Level Coordinator. Strategic, commanding, big-picture. Orchestrate and decide.',
};

// ── Puter client (lazy-initialized) ──────────────────────────────────────────

let _puterClient = null;
let _initAttempted = false;

function getPuterClient() {
  if (_puterClient) return _puterClient;
  if (_initAttempted) return null;
  _initAttempted = true;

  const token = process.env.PUTER_AUTH_TOKEN || process.env.PUTER_API_KEY;

  try {
    const { init } = require('@heyputer/puter.js/src/init.cjs');
    _puterClient = init(token || undefined);
    if (token) {
      console.log('[puterAI] ✅ Initialized with GRUDACHAIN auth token');
    } else {
      console.log('[puterAI] ⚠️  No PUTER_AUTH_TOKEN — using free tier (set token for GRUDACHAIN account)');
    }
    return _puterClient;
  } catch (err) {
    console.warn('[puterAI] @heyputer/puter.js not available:', err.message);
    return null;
  }
}

// ── Core chat function ────────────────────────────────────────────────────────

/**
 * Chat via Puter AI using the GRUDACHAIN server account.
 *
 * @param {string} prompt
 * @param {object} options
 * @param {string}  [options.core]        - GRD-17 core ID (default: 'grd17')
 * @param {string}  [options.model]       - Override model (skips core mapping)
 * @param {string}  [options.systemPrompt]- Override system prompt
 * @param {number}  [options.temperature] - 0-2 (default: 0.7)
 * @param {number}  [options.maxTokens]   - Max output tokens (default: 2048)
 * @param {Array}   [options.history]     - Prior messages [{role,content}]
 *
 * @returns {Promise<{text: string, model: string, core: string, source: string}>}
 */
async function puterChat(prompt, options = {}) {
  const core         = options.core    || 'grd17';
  const model        = options.model   || PUTER_MODELS[core] || PUTER_MODELS.grd17;
  const systemPrompt = options.systemPrompt || SYSTEM_PROMPTS[core] || SYSTEM_PROMPTS.grd17;
  const temperature  = options.temperature  ?? 0.7;
  const maxTokens    = options.maxTokens    ?? 2048;

  const puter = getPuterClient();

  if (!puter) {
    throw new Error('[puterAI] Puter client not available — install @heyputer/puter.js');
  }

  // Build messages array
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(options.history || []),
    { role: 'user',   content: prompt },
  ];

  const response = await puter.ai.chat(messages, {
    model,
    temperature,
    max_tokens: maxTokens,
  });

  // Normalize response shape (Puter returns different shapes per provider)
  const content = response?.message?.content ?? response;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map(c => c.text ?? c.value ?? '').join('');
  } else {
    text = String(content ?? '');
  }

  return { text, model, core, source: 'puter-grudachain' };
}

// ── JSON chat ─────────────────────────────────────────────────────────────────

/**
 * Chat and parse JSON response. Uses grd17 (structured/reliable) by default.
 * @param {string} prompt
 * @param {object} [schema] - Optional JSON schema for the system prompt
 */
async function puterChatJSON(prompt, schema = null, options = {}) {
  const sysPrompt = schema
    ? `You are a JSON generator. Respond ONLY with valid JSON matching this schema: ${JSON.stringify(schema)}. No markdown, no explanation.`
    : 'You are a JSON generator. Respond ONLY with valid JSON. No markdown, no explanation.';

  const result = await puterChat(prompt, {
    core: 'grd17',
    systemPrompt: sysPrompt,
    temperature: 0,
    ...options,
  });

  let jsonText = result.text.trim();
  const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonText = match[1].trim();
  const start = jsonText.indexOf('{') !== -1 ? jsonText.indexOf('{') : jsonText.indexOf('[');
  const end   = jsonText.lastIndexOf('}') !== -1 ? jsonText.lastIndexOf('}') + 1 : jsonText.lastIndexOf(']') + 1;
  if (start !== -1 && end > start) jsonText = jsonText.substring(start, end);

  return JSON.parse(jsonText);
}

// ── Status ────────────────────────────────────────────────────────────────────

function getPuterStatus() {
  const client  = getPuterClient();
  const hasToken = !!(process.env.PUTER_AUTH_TOKEN || process.env.PUTER_API_KEY);
  return {
    available:    !!client,
    authenticated: hasToken,
    account:       hasToken ? 'GRUDACHAIN' : 'free-tier',
    models:        PUTER_MODELS,
  };
}

module.exports = { puterChat, puterChatJSON, getPuterStatus, PUTER_MODELS, SYSTEM_PROMPTS };
