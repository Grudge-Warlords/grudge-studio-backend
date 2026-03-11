const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── Class / weapon restrictions (per game design rules) ───────
// Warriors:  shield, sword, 2h_sword, 2h_weapon
// Mages:     staff, tome, mace, off_hand, wand
// Rangers:   bow, crossbow, gun, dagger, 2h_sword, spear
// Worge:     staff, spear, dagger, bow, hammer, mace, off_hand
const WEAPON_RESTRICTIONS = {
  warrior: ['sword', '2h_sword', '2h_weapon', 'shield'],
  mage:    ['staff', 'tome', 'mace', 'off_hand', 'wand'],
  ranger:  ['bow', 'crossbow', 'gun', 'dagger', '2h_sword', 'spear'],
  worge:   ['staff', 'spear', 'dagger', 'bow', 'hammer', 'mace', 'off_hand'],
};
// Armor material per class
const ARMOR_RESTRICTIONS = {
  warrior: ['metal'],
  mage:    ['cloth'],
  ranger:  ['leather'],
  worge:   ['cloth', 'leather'],
};

function weaponAllowed(cls, itemKey) {
  const allowed = WEAPON_RESTRICTIONS[cls] || [];
  return allowed.some(w => itemKey.toLowerCase().includes(w));
}

function armorAllowed(cls, itemKey) {
  const allowed = ARMOR_RESTRICTIONS[cls] || [];
  return allowed.some(m => itemKey.toLowerCase().includes(m));
}

// ── GET /inventory?char_id=X ──────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { char_id } = req.query;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });
    const db = getDB();
    // Ownership check
    const [chars] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ?',
      [char_id, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });
    const [rows] = await db.query(
      'SELECT * FROM inventory WHERE char_id = ? ORDER BY equipped DESC, acquired_at DESC',
      [char_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /inventory — Add item to character ───────────────────
router.post('/', async (req, res, next) => {
  try {
    const { char_id, item_type, item_key, tier = 1 } = req.body;
    if (!char_id || !item_type || !item_key) {
      return res.status(400).json({ error: 'char_id, item_type, and item_key required' });
    }
    const db = getDB();
    const [chars] = await db.query(
      'SELECT id, class FROM characters WHERE id = ? AND grudge_id = ?',
      [char_id, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });
    const cls = chars[0].class;

    // Enforce class restrictions
    if (item_type === 'weapon' && !weaponAllowed(cls, item_key)) {
      return res.status(400).json({
        error: `${cls} cannot use this weapon type`,
        allowed: WEAPON_RESTRICTIONS[cls],
      });
    }
    if (item_type === 'shield' && cls !== 'warrior') {
      return res.status(400).json({ error: 'Only warriors can use shields' });
    }
    if (item_type === 'armor' && !armorAllowed(cls, item_key)) {
      return res.status(400).json({
        error: `${cls} cannot wear this armor type`,
        allowed: ARMOR_RESTRICTIONS[cls],
      });
    }
    // Capes have active effects + cooldowns (no restriction on class)
    // Relics are for all classes; off_hand is mage/worge only
    if (item_type === 'off_hand' && !['mage', 'worge'].includes(cls)) {
      return res.status(400).json({ error: 'Off-hand relics are for mages and worges only' });
    }

    const [result] = await db.query(
      'INSERT INTO inventory (grudge_id, char_id, item_type, item_key, tier) VALUES (?, ?, ?, ?, ?)',
      [req.user.grudge_id, char_id, item_type, item_key, Math.min(Math.max(1, tier), 6)]
    );
    const [rows] = await db.query('SELECT * FROM inventory WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /inventory/:id/equip ────────────────────────────────
// Body: { equipped: bool, slot?: string }
// Capes enforce no mid-combat swap (handled client-side; API records cooldown_until)
router.patch('/:id/equip', async (req, res, next) => {
  try {
    const { equipped, slot } = req.body;
    if (equipped === undefined) return res.status(400).json({ error: 'equipped boolean required' });
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM inventory WHERE id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    const item = rows[0];

    if (equipped && slot) {
      // Unequip any existing item in the same slot for this character
      await db.query(
        'UPDATE inventory SET equipped = FALSE, slot = NULL WHERE char_id = ? AND slot = ? AND id != ?',
        [item.char_id, slot, item.id]
      );
    }
    await db.query(
      'UPDATE inventory SET equipped = ?, slot = ? WHERE id = ?',
      [equipped, equipped ? (slot || item.slot) : null, item.id]
    );
    res.json({ success: true, equipped, slot: equipped ? (slot || item.slot) : null });
  } catch (err) { next(err); }
});

// ── DELETE /inventory/:id — Drop item ────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [result] = await db.query(
      'DELETE FROM inventory WHERE id = ? AND grudge_id = ?',
      [req.params.id, req.user.grudge_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
