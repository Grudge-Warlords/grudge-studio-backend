const express = require('express');
const router  = express.Router();
const { generateMission, TEMPLATES } = require('../data/missionTemplates');
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

const MISSION_TYPES = ['harvesting', 'fighting', 'sailing', 'competing'];

// ── Template fallback (original deterministic logic) ────────
function templateFallback(character, type, count) {
  const seed = Date.now();
  const missions = [];
  if (type) {
    const n = Math.min(Math.max(1, count), 11);
    for (let i = 0; i < n; i++) {
      missions.push(generateMission(character, type, seed + i * 7919));
    }
  } else {
    MISSION_TYPES.forEach((t, i) => {
      missions.push(generateMission(character, t, seed + i * 7919));
    });
  }
  return missions;
}

// ── POST /ai/mission/generate ─────────────────────────────────
// Body: { character: { level, faction, class? }, type?, count?, useLLM?: true }
// useLLM=true uses AI generation with template examples as few-shot.
// useLLM=false (default) uses fast deterministic templates.
router.post('/generate', async (req, res, next) => {
  try {
    const { character, type, count = 1, useLLM = false } = req.body;
    if (!character) return res.status(400).json({ error: 'character required' });

    if (type && !MISSION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MISSION_TYPES.join(', ')}` });
    }

    // Fast path: deterministic templates (no API cost, instant)
    if (!useLLM) {
      return res.json({ missions: templateFallback(character, type, count), source: 'template', generated_at: new Date().toISOString() });
    }

    // LLM path: use templates as few-shot examples
    const n = type ? Math.min(Math.max(1, count), 11) : 4;
    const examples = templateFallback(character, type, 2);

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.mission() },
      { role: 'user', content: `Generate ${n} unique missions for a level ${character.level || 1} ${character.class || 'warrior'} in the ${character.faction || 'pirate'} faction.${type ? ` Type: ${type}` : ' Generate one per type: harvesting, fighting, sailing, competing.'}

Here are example missions for reference (match this format but make yours unique):
${JSON.stringify(examples, null, 2)}

Return a JSON array of ${n} mission objects.` },
    ], { temperature: 0.8 });

    if (result.fallback) {
      return res.json({ missions: templateFallback(character, type, count), source: 'template_fallback', generated_at: new Date().toISOString() });
    }

    const missions = Array.isArray(result.data) ? result.data : [result.data];
    res.json({ missions, source: 'llm', provider: result.provider, model: result.model, usage: result.usage, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
