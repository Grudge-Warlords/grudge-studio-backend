const express = require('express');
const router  = express.Router();

const { getDB } = require('../db');
const { syncCnft } = require('../cnft-updater');

// ── Class / weapon restrictions ───────────────────────────────────────────────
const WEAPON_RESTRICTIONS = {
  warrior: ['sword', '2h_sword', '2h_weapon', 'shield'],
  mage:    ['staff', 'tome', 'mace', 'off_hand', 'wand'],
  ranger:  ['bow', 'crossbow', 'gun', 'dagger', '2h_sword', 'spear'],
  worge:   ['staff', 'spear', 'dagger', 'bow', 'hammer', 'mace', 'off_hand'],
};
const ARMOR_RESTRICTIONS = {
  warrior: ['metal'],
  mage:    ['cloth'],
  ranger:  ['leather'],
  worge:   ['cloth', 'leather'],
};
function weaponAllowed(cls, itemKey) {
  return (WEAPON_RESTRICTIONS[cls] || []).some(w => itemKey.toLowerCase().includes(w));
}
function armorAllowed(cls, itemKey) {
  return (ARMOR_RESTRICTIONS[cls] || []).some(m => itemKey.toLowerCase().includes(m));
}

// ── Audit helper ──────────────────────────────────────────────────────────────
async function logInventory(db, action, grudge_id, char_id, instance_id, item_key, meta = {}) {
  try {
    await db.query(
      `INSERT INTO inventory_log (action, grudge_id, char_id, instance_id, item_key, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [action, grudge_id, char_id, instance_id, item_key, JSON.stringify(meta)]
    );
  } catch (_) { /* non-fatal */ }
}

// ── GET /inventory?char_id=X ──────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { char_id } = req.query;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });
    const db = getDB();
    const [chars] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ?',
      [char_id, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });
    // Exclude soft-deleted items
    const [rows] = await db.query(
      'SELECT * FROM inventory WHERE char_id = ? AND deleted = FALSE ORDER BY equipped DESC, acquired_at DESC',
      [char_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /inventory — Add item ────────────────────────────────────────────────
// Idempotent: supply tx_id to avoid duplicates on retry
router.post('/', async (req, res, next) => {
  try {
    const { char_id, item_type, item_key, tier = 1, tx_id } = req.body;
    if (!char_id || !item_type || !item_key) {
      return res.status(400).json({ error: 'char_id, item_type, and item_key required' });
    }
    const db = getDB();

    // Idempotency: if tx_id already used, return the existing item
    if (tx_id) {
      const [existing] = await db.query(
        'SELECT * FROM inventory WHERE tx_id = ?', [tx_id]
      );
      if (existing.length) return res.json(existing[0]);
    }

    const [chars] = await db.query(
      'SELECT id, class FROM characters WHERE id = ? AND grudge_id = ?',
      [char_id, req.user.grudge_id]
    );
    if (!chars.length) return res.status(403).json({ error: 'Character not found' });
    const cls = chars[0].class;

    // Class restrictions
    if (item_type === 'weapon' && !weaponAllowed(cls, item_key))
      return res.status(400).json({ error: `${cls} cannot use this weapon type`, allowed: WEAPON_RESTRICTIONS[cls] });
    if (item_type === 'shield' && cls !== 'warrior')
      return res.status(400).json({ error: 'Only warriors can use shields' });
    if (item_type === 'armor' && !armorAllowed(cls, item_key))
      return res.status(400).json({ error: `${cls} cannot wear this armor type`, allowed: ARMOR_RESTRICTIONS[cls] });
    if (item_type === 'off_hand' && !['mage', 'worge'].includes(cls))
      return res.status(400).json({ error: 'Off-hand relics are for mages and worges only' });

    const instance_id = crypto.randomUUID();
    const [result] = await db.query(
      'INSERT INTO inventory (grudge_id, char_id, item_type, item_key, tier, instance_id, tx_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.grudge_id, char_id, item_type, item_key, Math.min(Math.max(1, tier), 6), instance_id, tx_id || null]
    );

    syncCnft(db, req.user.grudge_id, char_id, 'gain').catch(() => {}); // async
    await logInventory(db, 'gained', req.user.grudge_id, char_id, instance_id, item_key, { source: 'api', tier });

    const [rows] = await db.query('SELECT * FROM inventory WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /inventory/:id/equip ────────────────────────────────────────────────
router.patch('/:id/equip', async (req, res, next) => {
  try {
    const { equipped, slot } = req.body;
    if (equipped === undefined) return res.status(400).json({ error: 'equipped boolean required' });
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM inventory WHERE id = ? AND grudge_id = ? AND deleted = FALSE',
      [req.params.id, req.user.grudge_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    const item = rows[0];

    if (equipped && slot) {
      await db.query(
        'UPDATE inventory SET equipped = FALSE, slot = NULL WHERE char_id = ? AND slot = ? AND id != ? AND deleted = FALSE',
        [item.char_id, slot, item.id]
      );
    }
    await db.query(
      'UPDATE inventory SET equipped = ?, slot = ? WHERE id = ?',
      [equipped, equipped ? (slot || item.slot) : null, item.id]
    );
    syncCnft(db, item.grudge_id, item.char_id, 'equip').catch(() => {}); // async
    await logInventory(db, equipped ? 'equipped' : 'unequipped', item.grudge_id, item.char_id, item.instance_id, item.item_key, { slot });
    res.json({ success: true, equipped, slot: equipped ? (slot || item.slot) : null });
  } catch (err) { next(err); }
});

// ── DELETE /inventory/:id — SOFT delete only ──────────────────────────────────
// Items are NEVER hard-deleted. Marked deleted=true so they can be recovered.
router.delete('/:id', async (req, res, next) => {
  try {
    const db = getDB();
    const [[item]] = await db.query(
      'SELECT * FROM inventory WHERE id = ? AND grudge_id = ? AND deleted = FALSE',
      [req.params.id, req.user.grudge_id]
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });

    await db.query(
      'UPDATE inventory SET deleted = TRUE, equipped = FALSE, slot = NULL WHERE id = ?',
      [item.id]
    );
    await logInventory(db, 'dropped', item.grudge_id, item.char_id, item.instance_id, item.item_key, {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
