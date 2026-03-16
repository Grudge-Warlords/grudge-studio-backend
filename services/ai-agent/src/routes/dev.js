const express = require('express');
const router  = express.Router();
const { chat, chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

// ── POST /ai/dev/review ─────────────────────────────────────
// Body: { code: "string of C# code", filename?: "Script.cs", context?: "what this does" }
// Returns: { review, issues[], suggestions[], provider, model }
router.post('/review', async (req, res, next) => {
  try {
    const { code, filename, context } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.dev() },
      { role: 'user', content: `Review this uMMORPG C# script${filename ? ` (${filename})` : ''}${context ? `\nContext: ${context}` : ''}:

\`\`\`csharp
${code}
\`\`\`

Return JSON:
{
  "summary": "one-line summary of what the code does",
  "issues": [{ "severity": "error|warning|info", "line": null, "description": "..." }],
  "suggestions": ["actionable improvement"],
  "score": 0-100,
  "compiles": true/false
}` },
    ], { temperature: 0.2 });

    if (result.fallback) {
      return res.json({ review: 'LLM unavailable — manual review required', issues: [], suggestions: [], fallback: true });
    }

    res.json({ review: result.data || result.raw, provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) { next(err); }
});

// ── POST /ai/dev/generate ───────────────────────────────────
// Body: { type: "addon"|"partial"|"database"|"ui"|"npc", name: "FeatureName",
//         description: "what it should do", references?: ["GuildWarehouse","CraftingExtended"] }
// Returns: { files: [{ filename, content, description }], provider, model }
router.post('/generate', async (req, res, next) => {
  try {
    const { type, name, description, references } = req.body;
    if (!name || !description) return res.status(400).json({ error: 'name and description required' });

    const refText = references?.length ? `\nReference these existing addons for patterns: ${references.join(', ')}` : '';

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.dev() },
      { role: 'user', content: `Generate a complete uMMORPG ${type || 'addon'} called "${name}".

Description: ${description}${refText}

Requirements:
- Place files in Assets/uMMORPG/Scripts/Addons/!custom/${name}/
- Include all necessary partial class extensions (Player, NetworkManagerMMO, Database)
- Include #if preprocessor guards where needed
- Include both MySQL and SQLite database branches if DB is involved
- Include proper Mirror networking attributes
- Each file must be complete and compilable

Return JSON:
{
  "files": [
    { "filename": "FeatureName.cs", "path": "Assets/uMMORPG/Scripts/Addons/!custom/${name}/", "content": "full C# source", "description": "what this file does" }
  ],
  "defines_needed": ["_iMMOFEATURENAME"],
  "setup_instructions": ["step 1...", "step 2..."]
}` },
    ], { maxTokens: 8192, temperature: 0.3 });

    if (result.fallback) {
      return res.json({ files: [], fallback: true, message: 'LLM unavailable — cannot generate code' });
    }

    res.json({ ...result.data, provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) { next(err); }
});

module.exports = router;
