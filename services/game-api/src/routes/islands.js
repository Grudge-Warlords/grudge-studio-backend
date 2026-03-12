const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── GET /islands — All island states ─────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      `SELECT s.*, c.name AS controlling_crew_name, c.faction AS controlling_faction
       FROM island_state s
       LEFT JOIN crews c ON c.id = s.controlling_crew_id
       ORDER BY s.island_key ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /islands/:key — Single island ────────────────────────
router.get('/:key', async (req, res, next) => {
  try {
    const db = getDB();
    const [[island]] = await db.query(
      `SELECT s.*, c.name AS controlling_crew_name, c.faction AS controlling_faction
       FROM island_state s
       LEFT JOIN crews c ON c.id = s.controlling_crew_id
       WHERE s.island_key = ?`,
      [req.params.key]
    );
    if (!island) return res.status(404).json({ error: 'Island not found' });
    res.json(island);
  } catch (err) { next(err); }
});

// ── PATCH /islands/:key/claim — Internal only ────────────────
// Called by crews claim-base route after a crew plants their flag.
router.patch('/:key/claim', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });
    const { crew_id } = req.body;
    if (!crew_id) return res.status(400).json({ error: 'crew_id required' });

    const db = getDB();
    await db.query(
      `INSERT INTO island_state (island_key, controlling_crew_id, claim_flag_planted_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         controlling_crew_id = VALUES(controlling_crew_id),
         claim_flag_planted_at = NOW()`,
      [req.params.key, crew_id]
    );

    // Broadcast island state change
    try {
      const redis = require('../redis').getRedis();
      if (redis) {
        await redis.publish('grudge:event:island', JSON.stringify({
          island: req.params.key, crew_id, event: 'claimed', ts: Date.now(),
        }));
      }
    } catch {}

    res.json({ success: true, island: req.params.key, controlling_crew_id: crew_id });
  } catch (err) { next(err); }
});

// ── PATCH /islands/:key/players — Internal only ──────────────
// Game server updates who is on the island.
// Body: { action: 'join'|'leave', grudge_id }
router.patch('/:key/players', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });
    const { action, grudge_id } = req.body;
    if (!action || !grudge_id) return res.status(400).json({ error: 'action and grudge_id required' });

    const db = getDB();

    // Upsert island row if needed
    await db.query(
      `INSERT IGNORE INTO island_state (island_key) VALUES (?)`,
      [req.params.key]
    );

    if (action === 'join') {
      await db.query(
        `UPDATE island_state
         SET active_players = JSON_ARRAY_APPEND(
           COALESCE(active_players, JSON_ARRAY()),
           '$', ?
         )
         WHERE island_key = ?
           AND NOT JSON_CONTAINS(COALESCE(active_players, JSON_ARRAY()), JSON_QUOTE(?))`,
        [grudge_id, req.params.key, grudge_id]
      );
    } else if (action === 'leave') {
      // Remove from JSON array — use path-based removal
      await db.query(
        `UPDATE island_state
         SET active_players = JSON_REMOVE(
           active_players,
           REPLACE(
             JSON_UNQUOTE(JSON_SEARCH(COALESCE(active_players, JSON_ARRAY()), 'one', ?)),
             '$', '$'
           )
         )
         WHERE island_key = ?
           AND JSON_SEARCH(COALESCE(active_players, JSON_ARRAY()), 'one', ?) IS NOT NULL`,
        [grudge_id, req.params.key, grudge_id]
      );
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PATCH /islands/:key/resources — Internal only ────────────
// Merge resource updates. Body: { resources: { iron_ore: 50, ... } }
router.patch('/:key/resources', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });
    const { resources } = req.body;
    if (!resources || typeof resources !== 'object') {
      return res.status(400).json({ error: 'resources object required' });
    }

    const db = getDB();
    await db.query(
      `INSERT INTO island_state (island_key, resources) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE resources = JSON_MERGE_PATCH(COALESCE(resources, '{}'), VALUES(resources))`,
      [req.params.key, JSON.stringify(resources)]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
