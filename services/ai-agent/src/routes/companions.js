const express = require('express');
const router  = express.Router();
const { assignProfile, getAvailableStyles, PROFILES } = require('../data/behaviorProfiles');

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

module.exports = router;
