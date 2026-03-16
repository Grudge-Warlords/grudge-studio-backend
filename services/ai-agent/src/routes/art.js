const express = require('express');
const router  = express.Router();
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

const VALID_CATEGORIES = ['character', 'weapon', 'armor', 'monster', 'environment', 'prop', 'vehicle', 'effect'];
const VALID_SERVICES   = ['meshy', 'tripo', 'text2vox'];

// ── POST /ai/art/prompt ─────────────────────────────────────
// Body: { category: string, description: string, service?: string,
//         race?: string, class?: string, faction?: string, tier?: string, count?: 1-5 }
router.post('/prompt', async (req, res, next) => {
  try {
    const { category, description, service, race, class: cls, faction, tier, count = 1 } = req.body;
    if (!category || !description) return res.status(400).json({ error: 'category and description required' });
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }

    const n = Math.min(Math.max(1, count), 5);
    const svc = service && VALID_SERVICES.includes(service) ? service : 'meshy';

    const contextParts = [
      `Category: ${category}`,
      `Target service: ${svc}`,
      `Description: ${description}`,
      race ? `Race: ${race}` : null,
      cls ? `Class: ${cls}` : null,
      faction ? `Faction: ${faction}` : null,
      tier ? `Quality tier: ${tier}` : null,
    ].filter(Boolean).join('\n');

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.art() },
      { role: 'user', content: `Generate ${n} 3D model prompt(s) for the Grudge Warlords art pipeline.

${contextParts}

Return JSON array of ${n} objects, each with:
{
  "prompt": "detailed text-to-3D prompt optimized for ${svc}",
  "service": "${svc}",
  "style_tags": ["dark_fantasy", "medieval", ...],
  "polycount_target": "low|medium|high",
  "material_notes": "PBR, hand-painted, etc.",
  "pose": "T-pose for rigging / action pose / static",
  "scale_reference": "human-sized / large / small prop",
  "negative_prompt": "things to avoid",
  "notes": "any special instructions"
}` },
    ], { temperature: 0.7 });

    if (result.fallback) {
      return res.json({ prompts: [], fallback: true, message: 'LLM unavailable — cannot generate art prompts' });
    }

    res.json({
      category,
      service: svc,
      prompts: result.data || result.raw,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
