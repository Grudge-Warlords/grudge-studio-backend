const express = require('express');
const router  = express.Router();
const { generateMission } = require('../data/missionTemplates');

const MISSION_TYPES = ['harvesting', 'fighting', 'sailing', 'competing'];

// ── POST /ai/mission/generate ─────────────────────────────────
// Body: { character: { level, faction }, type?, count? }
// Returns one mission per type if type omitted; up to 11 of a specific type.
router.post('/generate', (req, res) => {
  const { character, type, count = 1 } = req.body;
  if (!character) return res.status(400).json({ error: 'character required' });

  const seed = Date.now();
  const missions = [];

  if (type) {
    if (!MISSION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MISSION_TYPES.join(', ')}` });
    }
    const n = Math.min(Math.max(1, count), 11);
    for (let i = 0; i < n; i++) {
      missions.push(generateMission(character, type, seed + i * 7919));
    }
  } else {
    // Generate one mission per type (full daily set)
    MISSION_TYPES.forEach((t, i) => {
      missions.push(generateMission(character, t, seed + i * 7919));
    });
  }

  res.json({ missions, generated_at: new Date().toISOString() });
});

module.exports = router;
