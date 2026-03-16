const express = require('express');
const router  = express.Router();
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

const VALID_TYPES = ['quest', 'npc_dialogue', 'item_description', 'boss_intro', 'location', 'event'];

// ── POST /ai/lore/generate ──────────────────────────────────
// Body: { type: "quest"|"npc_dialogue"|"item_description"|"boss_intro"|"location"|"event",
//         faction?: string, tier?: string, context?: string, count?: 1-5 }
router.post('/generate', async (req, res, next) => {
  try {
    const { type, faction, tier, context, count = 1 } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const n = Math.min(Math.max(1, count), 5);
    const factionCtx = faction ? `Faction: ${faction}` : 'Faction: any';
    const tierCtx = tier ? `Tier: ${tier}` : '';
    const extraCtx = context ? `Additional context: ${context}` : '';

    const typeInstructions = {
      quest: 'Generate quest content with: title, hook (why the player should care), objective, stakes, completion_text, reward_flavor',
      npc_dialogue: 'Generate NPC dialogue lines. Include: npc_name, npc_class, greeting, idle_lines[], quest_offer, quest_complete, farewell',
      item_description: 'Generate item flavor text. Include: item_name, item_type, rarity, description (1-3 sentences, evocative)',
      boss_intro: 'Generate a dramatic boss introduction. Include: boss_name, title, entrance_text, taunt_lines[], death_text',
      location: 'Generate a location description. Include: name, region, description, atmosphere, notable_features[], dangers[]',
      event: 'Generate a world event description. Include: event_name, trigger, description, phases[], rewards_flavor',
    };

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.lore() },
      { role: 'user', content: `Generate ${n} ${type.replace('_', ' ')} entries.
${factionCtx}
${tierCtx}
${extraCtx}

${typeInstructions[type]}

Return JSON array of ${n} objects. Each must include a "word_count" field.` },
    ], { temperature: 0.8 });

    if (result.fallback) {
      return res.json({ content: [], fallback: true, message: 'LLM unavailable — cannot generate lore' });
    }

    res.json({
      type,
      content: result.data || result.raw,
      faction: faction || 'any',
      tier: tier || 'any',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
