const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');
const { applyGold } = require('./economy');

// ── GET /crafting/recipes ─────────────────────────────────────
// Optional query: ?class=warrior&profession=mining&tier=1-6
// Returns only recipes the given character class can use.
router.get('/recipes', async (req, res, next) => {
  try {
    const { class: cls, profession, tier } = req.query;
    const db = getDB();

    let sql    = 'SELECT * FROM crafting_recipes WHERE 1=1';
    const params = [];

    if (cls) {
      sql += ' AND (class_restriction IS NULL OR class_restriction = ?)';
      params.push(cls.toLowerCase());
    }
    if (profession) {
      sql += ' AND (required_profession = ? OR required_profession = "none")';
      params.push(profession.toLowerCase());
    }
    if (tier) {
      sql += ' AND output_tier = ?';
      params.push(Number(tier));
    }
    sql += ' ORDER BY output_item_type ASC, output_tier ASC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /crafting/queue?char_id=X ────────────────────────────
router.get('/queue', async (req, res, next) => {
  try {
    const { char_id } = req.query;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });

    const db = getDB();
    const ownerCheck = req.isInternal
      ? 'SELECT id FROM characters WHERE id = ?'
      : 'SELECT id FROM characters WHERE id = ? AND grudge_id = ?';
    const ownerParams = req.isInternal ? [char_id] : [char_id, req.user.grudge_id];
    const [[char]] = await db.query(ownerCheck, ownerParams);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    const [rows] = await db.query(
      `SELECT cq.*, cr.name AS recipe_name, cr.output_item_key, cr.output_item_type, cr.output_tier
       FROM crafting_queue cq
       JOIN crafting_recipes cr ON cr.recipe_key = cq.recipe_key
       WHERE cq.char_id = ?
       ORDER BY cq.started_at DESC LIMIT 30`,
      [char_id]
    );

    // Annotate ready status
    const now = new Date();
    const annotated = rows.map(r => ({
      ...r,
      is_ready:    r.status === 'queued' && new Date(r.completes_at) <= now,
      time_left_s: r.status === 'queued'
        ? Math.max(0, Math.ceil((new Date(r.completes_at) - now) / 1000))
        : 0,
    }));
    res.json(annotated);
  } catch (err) { next(err); }
});

// ── POST /crafting/start ──────────────────────────────────────
// Body: { char_id, recipe_key }
// Validates class restrictions, profession level, gold, then queues the craft.
router.post('/start', async (req, res, next) => {
  try {
    if (req.isInternal) return res.status(403).json({ error: 'Players only' });
    const { char_id, recipe_key } = req.body;
    if (!char_id || !recipe_key) {
      return res.status(400).json({ error: 'char_id and recipe_key required' });
    }

    const db = getDB();

    // ── Fetch recipe ─────────────────────────────────────────
    const [[recipe]] = await db.query(
      'SELECT * FROM crafting_recipes WHERE recipe_key = ?',
      [recipe_key]
    );
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    // ── Fetch character (with profession levels) ─────────────
    const [[char]] = await db.query(
      'SELECT * FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1',
      [char_id, req.user.grudge_id]
    );
    if (!char) return res.status(403).json({ error: 'Character not found' });

    // ── Class restriction ────────────────────────────────────
    if (recipe.class_restriction && recipe.class_restriction !== char.class) {
      return res.status(400).json({
        error: `This recipe requires class: ${recipe.class_restriction}`,
      });
    }

    // ── Profession level requirement ─────────────────────────
    if (recipe.required_profession && recipe.required_profession !== 'none') {
      const profCol = {
        mining: 'mining_lvl', fishing: 'fishing_lvl',
        woodcutting: 'woodcutting_lvl', farming: 'farming_lvl', hunting: 'hunting_lvl',
      };
      const col = profCol[recipe.required_profession];
      if (col && (char[col] || 0) < recipe.required_level) {
        return res.status(400).json({
          error: `Requires ${recipe.required_profession} level ${recipe.required_level} (you have ${char[col] || 0})`,
        });
      }
    }

    // ── Max concurrent queue per char (5) ───────────────────
    const [[{ queued }]] = await db.query(
      "SELECT COUNT(*) AS queued FROM crafting_queue WHERE char_id = ? AND status = 'queued'",
      [char_id]
    );
    if (queued >= 5) {
      return res.status(400).json({ error: 'Crafting queue full (max 5 concurrent)' });
    }

    // ── Deduct gold ──────────────────────────────────────────
    if (recipe.cost_gold > 0) {
      await applyGold(db, char_id, req.user.grudge_id, -recipe.cost_gold, 'craft_cost', recipe_key);
    }

    // ── Insert queue row ─────────────────────────────────────
    const completesAt = new Date(Date.now() + recipe.craft_time_seconds * 1000);
    const [result] = await db.query(
      `INSERT INTO crafting_queue (grudge_id, char_id, recipe_key, completes_at)
       VALUES (?, ?, ?, ?)`,
      [req.user.grudge_id, char_id, recipe_key, completesAt]
    );

    res.status(201).json({
      id:            result.insertId,
      recipe_key,
      recipe_name:   recipe.name,
      completes_at:  completesAt,
      craft_time_s:  recipe.craft_time_seconds,
      gold_spent:    recipe.cost_gold,
    });
  } catch (err) { next(err); }
});

// ── PATCH /crafting/:id/complete ─────────────────────────────
// Finalises a ready craft — adds item to inventory.
// Can be called by player or internal (game server auto-complete).
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const db = getDB();

    const query = req.isInternal
      ? 'SELECT * FROM crafting_queue WHERE id = ? AND status = "queued"'
      : 'SELECT * FROM crafting_queue WHERE id = ? AND grudge_id = ? AND status = "queued"';
    const params = req.isInternal
      ? [req.params.id]
      : [req.params.id, req.user.grudge_id];

    const [[queueItem]] = await db.query(query, params);
    if (!queueItem) return res.status(404).json({ error: 'Queued craft not found' });

    // Must have passed completes_at
    if (new Date(queueItem.completes_at) > new Date()) {
      const remaining = Math.ceil((new Date(queueItem.completes_at) - Date.now()) / 1000);
      return res.status(400).json({ error: `Not ready yet. ${remaining}s remaining.` });
    }

    // Fetch recipe for output details
    const [[recipe]] = await db.query(
      'SELECT * FROM crafting_recipes WHERE recipe_key = ?',
      [queueItem.recipe_key]
    );
    if (!recipe) return res.status(500).json({ error: 'Recipe not found for queue item' });

    // Add item to inventory
    const [inv] = await db.query(
      `INSERT INTO inventory (grudge_id, char_id, item_type, item_key, tier)
       VALUES (?, ?, ?, ?, ?)`,
      [queueItem.grudge_id, queueItem.char_id, recipe.output_item_type,
       recipe.output_item_key, recipe.output_tier]
    );

    // Mark craft complete
    await db.query(
      'UPDATE crafting_queue SET status = "complete", completed_at = NOW(), output_item_id = ? WHERE id = ?',
      [inv.insertId, queueItem.id]
    );

    res.json({
      success:       true,
      item_id:       inv.insertId,
      item_key:      recipe.output_item_key,
      item_type:     recipe.output_item_type,
      tier:          recipe.output_tier,
    });
  } catch (err) { next(err); }
});

// ── DELETE /crafting/:id — Cancel queued craft ───────────────
// Refunds full gold cost if still queued and not yet started crafting.
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.isInternal) return res.status(403).json({ error: 'Players only' });
    const db = getDB();

    const [[item]] = await db.query(
      'SELECT * FROM crafting_queue WHERE id = ? AND grudge_id = ? AND status = "queued"',
      [req.params.id, req.user.grudge_id]
    );
    if (!item) return res.status(404).json({ error: 'Active craft not found' });

    const [[recipe]] = await db.query(
      'SELECT cost_gold FROM crafting_recipes WHERE recipe_key = ?',
      [item.recipe_key]
    );

    await db.query(
      'UPDATE crafting_queue SET status = "cancelled" WHERE id = ?',
      [req.params.id]
    );

    // Refund gold
    let refunded = 0;
    if (recipe?.cost_gold > 0) {
      await applyGold(db, item.char_id, item.grudge_id, recipe.cost_gold, 'craft_cost',
        `refund:${req.params.id}`, 'Craft cancelled — refund');
      refunded = recipe.cost_gold;
    }

    res.json({ success: true, refunded_gold: refunded });
  } catch (err) { next(err); }
});

module.exports = router;
