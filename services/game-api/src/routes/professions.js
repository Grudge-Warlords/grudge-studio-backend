const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

const PROFESSIONS = ['mining', 'fishing', 'woodcutting', 'farming', 'hunting'];
// Maps profession name → characters table column (kept in sync for fast reads)
const PROF_COL = {
  mining: 'mining_lvl', fishing: 'fishing_lvl',
  woodcutting: 'woodcutting_lvl', farming: 'farming_lvl', hunting: 'hunting_lvl',
};
const XP_PER_LEVEL = 1000; // 1000 XP per level, 100 levels = 100,000 total XP
// Milestones unlock higher-tier resource harvesting (matching 02-game-systems.sql comments)
const MILESTONES = [
  { min_level: 0,   milestone: 0,   tier: 1, title: 'Apprentice'   },
  { min_level: 25,  milestone: 25,  tier: 2, title: 'Journeyman'   },
  { min_level: 50,  milestone: 50,  tier: 3, title: 'Expert'       },
  { min_level: 75,  milestone: 75,  tier: 4, title: 'Master'       },
  { min_level: 100, milestone: 100, tier: 5, title: 'Grandmaster'  },
];

function getMilestone(level) {
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (level >= MILESTONES[i].min_level) return MILESTONES[i];
  }
  return MILESTONES[0];
}

async function ensureProfessionRows(db, charId, grudgeId) {
  for (const prof of PROFESSIONS) {
    await db.query(
      `INSERT IGNORE INTO profession_progress (char_id, grudge_id, profession) VALUES (?, ?, ?)`,
      [charId, grudgeId, prof]
    );
  }
}

// ── GET /professions/:charId ──────────────────────────────────
router.get('/:charId', async (req, res, next) => {
  try {
    const db = getDB();
    const [chars] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ?',
      [req.params.charId, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });

    await ensureProfessionRows(db, req.params.charId, req.user.grudge_id);
    const [rows] = await db.query(
      'SELECT * FROM profession_progress WHERE char_id = ? ORDER BY profession ASC',
      [req.params.charId]
    );
    const result = rows.map(r => ({
      ...r,
      milestone_info:    getMilestone(r.level),
      xp_to_next_level:  r.level >= 100 ? 0 : XP_PER_LEVEL - (r.xp % XP_PER_LEVEL),
    }));
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /professions/:charId/xp ─────────────────────────────
// Body: { profession, xp }
// Adds XP, recalculates level, checks for milestone unlock.
router.post('/:charId/xp', async (req, res, next) => {
  try {
    const { profession, xp } = req.body;
    if (!profession || !xp) return res.status(400).json({ error: 'profession and xp required' });
    if (!PROFESSIONS.includes(profession)) {
      return res.status(400).json({ error: `profession must be one of: ${PROFESSIONS.join(', ')}` });
    }
    const xpNum = Number(xp);
    if (!xpNum || xpNum < 1 || xpNum > 10000) {
      return res.status(400).json({ error: 'xp must be between 1 and 10000' });
    }

    const db = getDB();
    const [chars] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ?',
      [req.params.charId, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });

    // Upsert row, add XP
    await db.query(
      `INSERT INTO profession_progress (char_id, grudge_id, profession, xp)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE xp = xp + VALUES(xp)`,
      [req.params.charId, req.user.grudge_id, profession, xpNum]
    );

    // Fetch updated row and recalculate
    const [rows] = await db.query(
      'SELECT * FROM profession_progress WHERE char_id = ? AND profession = ?',
      [req.params.charId, profession]
    );
    const row        = rows[0];
    const prevLevel  = row.level;
    const newLevel   = Math.min(Math.floor(row.xp / XP_PER_LEVEL), 100);
    const milestone  = getMilestone(newLevel);
    const leveledUp  = newLevel > prevLevel;
    const newMilestone = leveledUp && milestone.milestone > row.milestone;

    // Persist updated level + milestone
    await db.query(
      `UPDATE profession_progress
       SET level = ?, milestone = ?, unlocked_tier = ?
       WHERE char_id = ? AND profession = ?`,
      [newLevel, milestone.milestone, milestone.tier, req.params.charId, profession]
    );
    // Sync back to characters table (fast-read columns)
    await db.query(
      `UPDATE characters SET ${PROF_COL[profession]} = ? WHERE id = ?`,
      [newLevel, req.params.charId]
    );

    res.json({
      profession,
      total_xp:        row.xp,
      level:           newLevel,
      leveled_up:      leveledUp,
      milestone_unlocked: newMilestone ? milestone : null,
      milestone:       milestone,
      xp_to_next_level: newLevel >= 100 ? 0 : XP_PER_LEVEL - (row.xp % XP_PER_LEVEL),
    });
  } catch (err) { next(err); }
});

module.exports = router;
