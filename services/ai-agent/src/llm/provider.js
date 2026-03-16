// ─────────────────────────────────────────────────────────────
// GRUDGE STUDIO — LLM Provider with Fallback Chain
// Anthropic → OpenAI → DeepSeek → template fallback
//
// Every AI route calls llm.chat() instead of a specific SDK.
// If the primary provider fails, it cascades to the next.
// If ALL providers fail, returns { fallback: true } so the
// caller can use deterministic templates as a last resort.
// ─────────────────────────────────────────────────────────────
const { SYSTEM_CONTEXT } = require('../data/systemContext');

// ── Provider configurations ─────────────────────────────────
const PROVIDERS = [
  {
    name: 'anthropic',
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    call: async (messages, opts) => {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      // Anthropic uses system as a top-level param, not in messages
      const systemMsg = messages.find(m => m.role === 'system')?.content || '';
      const chatMsgs = messages.filter(m => m.role !== 'system');

      const resp = await client.messages.create({
        model: opts.model || PROVIDERS[0].model(),
        max_tokens: opts.maxTokens || PROVIDERS[0].maxTokens,
        system: systemMsg,
        messages: chatMsgs,
        temperature: opts.temperature ?? 0.7,
      });

      return {
        content: resp.content[0]?.text || '',
        provider: 'anthropic',
        model: opts.model || PROVIDERS[0].model(),
        usage: { input: resp.usage?.input_tokens, output: resp.usage?.output_tokens },
      };
    },
  },
  {
    name: 'openai',
    enabled: () => !!process.env.OPENAI_API_KEY,
    model: () => process.env.OPENAI_MODEL || 'gpt-4o',
    maxTokens: 4096,
    call: async (messages, opts) => {
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const resp = await client.chat.completions.create({
        model: opts.model || PROVIDERS[1].model(),
        messages,
        max_tokens: opts.maxTokens || PROVIDERS[1].maxTokens,
        temperature: opts.temperature ?? 0.7,
      });

      const choice = resp.choices[0];
      return {
        content: choice?.message?.content || '',
        provider: 'openai',
        model: opts.model || PROVIDERS[1].model(),
        usage: { input: resp.usage?.prompt_tokens, output: resp.usage?.completion_tokens },
      };
    },
  },
  {
    name: 'deepseek',
    enabled: () => !!process.env.DEEPSEEK_API_KEY,
    model: () => process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    maxTokens: 4096,
    call: async (messages, opts) => {
      // DeepSeek uses OpenAI-compatible API
      const OpenAI = require('openai');
      const client = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com/v1',
      });

      const resp = await client.chat.completions.create({
        model: opts.model || PROVIDERS[2].model(),
        messages,
        max_tokens: opts.maxTokens || PROVIDERS[2].maxTokens,
        temperature: opts.temperature ?? 0.7,
      });

      const choice = resp.choices[0];
      return {
        content: choice?.message?.content || '',
        provider: 'deepseek',
        model: opts.model || PROVIDERS[2].model(),
        usage: { input: resp.usage?.prompt_tokens, output: resp.usage?.completion_tokens },
      };
    },
  },
];

// ── Core chat function with fallback ────────────────────────
/**
 * Send a chat completion through the provider chain.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} [opts]
 * @param {string} [opts.preferProvider] - Force a specific provider ('anthropic'|'openai'|'deepseek')
 * @param {number} [opts.temperature=0.7]
 * @param {number} [opts.maxTokens=4096]
 * @param {string} [opts.model] - Override the default model
 * @returns {Promise<{content: string, provider: string, model: string, usage: object, fallback?: boolean}>}
 */
async function chat(messages, opts = {}) {
  // Build provider order: preferred first, then the rest
  let chain = [...PROVIDERS];
  if (opts.preferProvider) {
    const preferred = chain.find(p => p.name === opts.preferProvider);
    if (preferred) {
      chain = [preferred, ...chain.filter(p => p.name !== opts.preferProvider)];
    }
  }

  // Filter to enabled providers only
  chain = chain.filter(p => p.enabled());

  if (chain.length === 0) {
    console.warn('[llm] No API keys configured — returning fallback');
    return { content: '', provider: 'none', model: 'none', usage: {}, fallback: true };
  }

  // Try each provider in order
  for (const provider of chain) {
    try {
      const result = await provider.call(messages, opts);
      return result;
    } catch (err) {
      console.warn(`[llm] ${provider.name} failed: ${err.message}`);
      continue;
    }
  }

  // All providers failed
  console.error('[llm] All providers exhausted — returning fallback');
  return { content: '', provider: 'none', model: 'none', usage: {}, fallback: true };
}

// ── JSON extraction helper ──────────────────────────────────
/**
 * Ask the LLM for structured JSON output.
 * Wraps the response extraction so routes don't have to parse.
 */
async function chatJSON(messages, opts = {}) {
  const result = await chat(messages, { ...opts, temperature: opts.temperature ?? 0.3 });
  if (result.fallback) return { data: null, ...result };

  try {
    // Try to extract JSON from the response (handles ```json blocks)
    let text = result.content.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();

    // Try to find JSON object or array
    const start = text.indexOf('{') !== -1 ? text.indexOf('{') : text.indexOf('[');
    const end = text.lastIndexOf('}') !== -1 ? text.lastIndexOf('}') + 1 : text.lastIndexOf(']') + 1;
    if (start !== -1 && end > start) {
      text = text.substring(start, end);
    }

    const data = JSON.parse(text);
    return { data, ...result };
  } catch (parseErr) {
    console.warn('[llm] JSON parse failed, returning raw content');
    return { data: null, raw: result.content, ...result };
  }
}

// ── Status/diagnostics ──────────────────────────────────────
function getProviderStatus() {
  return PROVIDERS.map(p => ({
    name: p.name,
    enabled: p.enabled(),
    model: p.enabled() ? p.model() : null,
  }));
}

// ── Grudge game context string (for system prompts) ─────────
function getGameContext() {
  const s = SYSTEM_CONTEXT.gameSystems;
  return `GRUDGE WARLORDS GAME CONTEXT:
Classes: ${s.classes.join(', ')}
Factions: ${s.factions.join(', ')}
Mission types: ${s.missionTypes.join(', ')} (max ${s.maxMissionsPerDay}/day)
Max Gouldstones: ${s.maxGouldstones}
Warrior: ${s.mechanics.warrior}
Mage: ${s.mechanics.mage}
Ranger: ${s.mechanics.ranger}
Worge: ${s.mechanics.worge}
Gouldstone: ${s.mechanics.gouldstone}
Z-Key: ${s.mechanics.zKey}
Hotbar: ${s.mechanics.hotbar}`;
}

module.exports = { chat, chatJSON, getProviderStatus, getGameContext, PROVIDERS };
