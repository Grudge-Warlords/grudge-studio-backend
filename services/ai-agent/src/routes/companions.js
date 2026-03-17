const express = require('express');
const router  = express.Router();
const { assignProfile, getAvailableStyles, PROFILES } = require('../data/behaviorProfiles');
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

const VALID_CLASSES = ['warrior', 'mage', 'ranger', 'worge'];

// ── POST /ai/companion/assign ─────────────────────────────────
// Body: { class, style?, faction, gouldstone_id? }
router.post('/assign', (req, res) => {
  const { class: cls, style = 'balanced', faction, gouldstone_id } = req.body;
  if (!cls) return res.status(400).json({ error: 'class required' });

  const normalized = cls.toLowerCase();
  if (!VALID_CLASSES.includes(normalized)) {
    return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(', ')}` });
  }

  const profile = assignProfile(normalized, style, faction);
  res.json({
    gouldstone_id: gouldstone_id || null,
    profile,
    available_styles: getAvailableStyles(normalized),
  });
});

// ── GET /ai/companion/profiles/:class ────────────────────────
// Returns all available behavior profiles for a given class.
router.get('/profiles/:cls', (req, res) => {
  const cls = req.params.cls.toLowerCase();
  if (!VALID_CLASSES.includes(cls)) {
    return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(', ')}` });
  }
  res.json({
    class:    cls,
    profiles: PROFILES[cls],
    styles:   getAvailableStyles(cls),
  });
});

// ── POST /ai/companion/interact ──────────────────────────────
// LLM-powered companion dialogue generation.
// Body: { class, style?, faction?, situation: "combat"|"idle"|"harvesting"|"sailing"|"travel",
//         context?: "fighting a troll", player_name?: "Grimjaw" }
router.post('/interact', async (req, res, next) => {
  try {
    const { class: cls, style = 'balanced', faction, situation = 'idle', context, player_name } = req.body;
    if (!cls) return res.status(400).json({ error: 'class required' });

    const normalized = cls.toLowerCase();
    if (!VALID_CLASSES.includes(normalized)) {
      return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(', ')}` });
    }

    // Get the static profile for context
    const profile = assignProfile(normalized, style, faction);

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.companion() },
      { role: 'user', content: `Generate dialogue for a Gouldstone companion.

Companion profile:
- Class: ${normalized}
- Style: ${style}
- Faction: ${faction || 'pirate'}
- Combat style: ${profile.combat_style}
- Dialogue tone: ${profile.dialogue_tone}
- Faction prefix: ${profile.faction_dialogue.prefix}

Situation: ${situation}
${context ? `Context: ${context}` : ''}
${player_name ? `Player name: ${player_name}` : ''}

Return JSON:
{
  "dialogue": "what the companion says",
  "action_hint": "optional tactical suggestion",
  "emote": "optional emote/animation trigger",
  "context": "${situation}"
}` },
    ], { temperature: 0.9 });

    if (result.fallback) {
      // Deterministic fallback dialogue
      const fallbackLines = {
        combat: "I've got your back!",
        idle: "Ready when you are.",
        harvesting: "This spot looks promising.",
        sailing: "Steady as she goes.",
        travel: "The road ahead looks clear.",
      };
      return res.json({
        dialogue: `${profile.faction_dialogue.prefix} ${fallbackLines[situation] || fallbackLines.idle}`.trim(),
        action_hint: null,
        emote: null,
        context: situation,
        profile,
        source: 'fallback',
      });
    }

    res.json({
      ...(result.data || { dialogue: result.raw }),
      profile,
      source: 'llm',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    });
  } catch (err) { next(err); }
});

module.exports = router;
