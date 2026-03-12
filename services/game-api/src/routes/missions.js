const express = require('express');
const router = require('express').Router();
const { getDB } = require('../db');
const { applyGold } = require('./economy');
let _redis;
function getRedis() {
  if (!_redis) {
    try { _redis = require('../redis').getRedis(); } catch {}
  }
  return _redis;
}

const MISSION_TYPES = ['harvesting', 'fighting', 'sailing', 'competing'];

// ── GET /missions ─────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM missions WHERE grudge_id = ? ORDER BY started_at DESC LIMIT 50`,
      [req.user.grudge_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /missions ────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { title, type, reward_gold = 0, reward_xp = 0 } = req.body;
    if (!title || !type) return res.status(400).json({ error: 'title and type required' });
    if (!MISSION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MISSION_TYPES.join(', ')}` });
    }

    // Limit: max 4 active missions per day (one per type)
    const db = getDB();
    const [active] = await db.query(
      `SELECT COUNT(*) as count FROM missions
       WHERE grudge_id = ? AND type = ? AND status = 'active'
         AND DATE(started_at) = CURDATE()`,
      [req.user.grudge_id, type]
    );
    if (active[0].count >= 11) {
      return res.status(429).json({ error: 'Daily mission limit reached for this type' });
    }

    const [result] = await db.query(
      `INSERT INTO missions (grudge_id, title, type, reward_gold, reward_xp) VALUES (?, ?, ?, ?, ?)`,
      [req.user.grudge_id, title, type, reward_gold, reward_xp]
    );
    const [rows] = await db.query('SELECT * FROM missions WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /missions/:id/complete ──────────────
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT * FROM missions WHERE id = ? AND grudge_id = ? AND status = 'active'`,
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Active mission not found' });

    await db.query(
      `UPDATE missions SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    const mission = rows[0];
    let xp_applied = [];

    if (mission.reward_xp > 0) {
      const [chars] = await db.query(
        'SELECT id FROM characters WHERE grudge_id = ? ORDER BY id ASC LIMIT 1',
        [req.user.grudge_id]
      );
      if (chars.length) {
        const charId = chars[0].id;

        if (mission.type === 'harvesting') {
          // Split XP evenly across all 5 harvesting professions
          const profXP = Math.max(1, Math.floor(mission.reward_xp / 5));
          const professions = ['mining', 'fishing', 'woodcutting', 'farming', 'hunting'];
          for (const prof of professions) {
            await db.query(
              `INSERT INTO profession_progress (char_id, grudge_id, profession, xp)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE xp = xp + VALUES(xp)`,
              [charId, req.user.grudge_id, prof, profXP]
            );
            // Recalculate and sync level
            const [pr] = await db.query(
              'SELECT xp FROM profession_progress WHERE char_id = ? AND profession = ?',
              [charId, prof]
            );
            const newLevel = Math.min(Math.floor(pr[0].xp / 1000), 100);
            const colMap = { mining:'mining_lvl', fishing:'fishing_lvl',
                             woodcutting:'woodcutting_lvl', farming:'farming_lvl', hunting:'hunting_lvl' };
            await db.query(
              `UPDATE profession_progress SET level = ?, milestone = FLOOR(? / 25) * 25, unlocked_tier = LEAST(FLOOR(? / 25) + 1, 5)
               WHERE char_id = ? AND profession = ?`,
              [newLevel, newLevel, newLevel, charId, prof]
            );
            await db.query(`UPDATE characters SET ${colMap[prof]} = ? WHERE id = ?`, [newLevel, charId]);
          }
          xp_applied = professions.map(p => ({ profession: p, xp: profXP }));
        } else {
          // fighting / sailing / competing: accumulate combat XP, raise character level
          const [totRow] = await db.query(
            `SELECT COALESCE(SUM(reward_xp), 0) AS total FROM missions
             WHERE grudge_id = ? AND status = 'completed' AND type != 'harvesting'`,
            [req.user.grudge_id]
          );
          const newLevel = Math.min(Math.floor(totRow[0].total / 5000) + 1, 100);
          await db.query(
            'UPDATE characters SET level = GREATEST(level, ?) WHERE id = ?',
            [newLevel, charId]
          );
          xp_applied = [{ type: 'combat_level', new_level: newLevel }];
        }
      }
    }

    // ── Award gold ────────────────────────────────────────
    let gold_balance = null;
    if (mission.reward_gold > 0) {
      const [chars] = await db.query(
        'SELECT id FROM characters WHERE grudge_id = ? ORDER BY id ASC LIMIT 1',
        [req.user.grudge_id]
      );
      if (chars.length) {
        try {
          gold_balance = await applyGold(
            db, chars[0].id, req.user.grudge_id,
            mission.reward_gold, 'mission_reward',
            String(mission.id), mission.title
          );
        } catch (e) {
          console.warn('[missions] gold award failed:', e.message);
        }
      }
    }

    // ── Publish real-time event ─────────────────────────
    try {
      const redis = getRedis();
      if (redis) {
        await redis.publish('grudge:event:mission', JSON.stringify({
          grudge_id:   req.user.grudge_id,
          mission_id:  mission.id,
          type:        mission.type,
          reward_gold: mission.reward_gold,
          reward_xp:   mission.reward_xp,
          ts:          Date.now(),
        }));
      }
    } catch {}

    res.json({
      success:      true,
      reward_gold:  mission.reward_gold,
      reward_xp:    mission.reward_xp,
      gold_balance,
      xp_applied,
    });
  } catch (err) { next(err); }
});

// ── PATCH /missions/:id/fail ────────────────
router.patch('/:id/fail', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT id FROM missions WHERE id = ? AND grudge_id = ? AND status = 'active'`,
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Active mission not found' });
    await db.query(
      `UPDATE missions SET status = 'failed', completed_at = NOW() WHERE id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
