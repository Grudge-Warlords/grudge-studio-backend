/**
 * Generic AI Chat — /ai/chat
 * Accepts any chat request, injects Grudge game context, returns AI response.
 * Used by: game clients, GDevelop editor, client portal, admin tools
 *
 * POST /ai/chat
 * Body: { message: string, context?: string, provider?: string, history?: Array }
 * Returns: { content: string, provider: string, model: string }
 */
const express = require('express');
const router = express.Router();
const { chat, getGameContext } = require('../llm/provider');

// POST /ai/chat — general purpose chat
router.post('/', async (req, res, next) => {
  try {
    const { message, context, provider, history, temperature, maxTokens } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Build messages array
    const messages = [
      {
        role: 'system',
        content: [
          'You are the Grudge Studio AI assistant for Grudge Warlords.',
          'You help with game development, player support, lore, combat mechanics, and tooling.',
          'Be concise, technical, and production-ready. Use code blocks when appropriate.',
          getGameContext(),
          context || '',
        ].filter(Boolean).join('\n\n'),
      },
      // Include conversation history if provided
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const result = await chat(messages, {
      preferProvider: provider,
      temperature: temperature || 0.7,
      maxTokens: maxTokens || 2048,
    });

    if (result.fallback) {
      return res.json({
        content: 'AI providers are currently unavailable. Please try again later.',
        provider: 'fallback',
        model: 'none',
        fallback: true,
      });
    }

    res.json({
      content: result.content,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    });
  } catch (err) {
    next(err);
  }
});

// POST /ai/chat/json — returns structured JSON
router.post('/json', async (req, res, next) => {
  try {
    const { message, schema, context, provider } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const { chatJSON, getGameContext: gc } = require('../llm/provider');
    const messages = [
      {
        role: 'system',
        content: [
          'You are the Grudge Studio AI. Return ONLY valid JSON matching the requested schema.',
          'No markdown, no explanation, just the JSON object.',
          gc(),
          context || '',
          schema ? `Expected JSON schema: ${JSON.stringify(schema)}` : '',
        ].filter(Boolean).join('\n\n'),
      },
      { role: 'user', content: message },
    ];

    const result = await chatJSON(messages, { preferProvider: provider, temperature: 0.3 });
    res.json({ data: result.data, provider: result.provider, model: result.model });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
