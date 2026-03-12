const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

// ── Atomic gold change helper ─────────────────────────────────
// Uses SELECT FOR UPDATE to prevent race conditions.
// amount: positive = credit, negative = debit
// Returns the updated balance.
async function applyGold(db, charId, grudgeId, amount, type, refId = null, note = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[char]] = await conn.query(
      'SELECT id, grudge_id, gold FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1 FOR UPDATE',
      [charId, grudgeId]
    );
    if (!char) {
      await conn.rollback();
      const err = new Error('Character not found');
      err.status = 404;
      throw err;
    }

    const newBalance = BigInt(char.gold) + BigInt(amount);
    if (newBalance < 0n) {
      await conn.rollback();
      const err = new Error(`Insufficient gold (have ${char.gold}, need ${Math.abs(amount)})`);
      err.status = 400;
      err.code   = 'INSUFFICIENT_GOLD';
      throw err;
    }

    await conn.query(
      'UPDATE characters SET gold = ? WHERE id = ?',
      [newBalance.toString(), charId]
    );
    await conn.query(
      `INSERT INTO gold_transactions
         (grudge_id, char_id, amount, type, ref_id, balance_after, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [grudgeId, charId, amount, type, refId, newBalance.toString(), note]
    );

    await conn.commit();
    return Number(newBalance);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── GET /economy/balance?char_id=X ───────────────────────────
router.get('/balance', async (req, res, next) => {
  try {
    const { char_id } = req.query;
    if (!char_id) return res.status(400).json({ error: 'char_id required' });

    const db = getDB();

    // Ownership check (internal can query any char)
    const query = req.isInternal
      ? 'SELECT id, gold FROM characters WHERE id = ? LIMIT 1'
      : 'SELECT id, gold FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1';
    const params = req.isInternal
      ? [char_id]
      : [char_id, req.user.grudge_id];

    const [[char]] = await db.query(query, params);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    const [txns] = await db.query(
      `SELECT id, amount, type, ref_id, balance_after, note, created_at
       FROM gold_transactions WHERE char_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [char_id]
    );

    res.json({ char_id: Number(char_id), balance: char.gold, transactions: txns });
  } catch (err) { next(err); }
});

// ── POST /economy/award — Internal only ──────────────────────
// Body: { char_id, grudge_id, amount, ref_id?, note? }
router.post('/award', async (req, res, next) => {
  try {
    if (!req.isInternal) return res.status(403).json({ error: 'Internal only' });
    const { char_id, grudge_id, amount, ref_id, note } = req.body;
    if (!char_id || !grudge_id || !amount) {
      return res.status(400).json({ error: 'char_id, grudge_id, and amount required' });
    }
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0 || amt > 1_000_000) {
      return res.status(400).json({ error: 'amount must be a positive integer ≤ 1,000,000' });
    }
    const db = getDB();
    const balance = await applyGold(db, char_id, grudge_id, amt, 'mission_reward', ref_id, note);
    res.json({ success: true, awarded: amt, balance });
  } catch (err) { next(err); }
});

// ── POST /economy/spend ───────────────────────────────────────
// Body: { char_id, amount, type, ref_id?, note? }
// type must be: 'purchase' | 'craft_cost'
router.post('/spend', async (req, res, next) => {
  try {
    const { char_id, amount, type, ref_id, note } = req.body;
    if (!char_id || !amount || !type) {
      return res.status(400).json({ error: 'char_id, amount, and type required' });
    }
    if (!['purchase', 'craft_cost'].includes(type)) {
      return res.status(400).json({ error: 'type must be purchase or craft_cost' });
    }
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      return res.status(400).json({ error: 'amount must be a positive integer' });
    }

    const grudgeId = req.isInternal ? req.body.grudge_id : req.user.grudge_id;
    if (!grudgeId) return res.status(400).json({ error: 'grudge_id required' });

    const db = getDB();
    const balance = await applyGold(db, char_id, grudgeId, -amt, type, ref_id, note);
    res.json({ success: true, spent: amt, balance });
  } catch (err) { next(err); }
});

// ── POST /economy/transfer ────────────────────────────────────
// Player-to-player gold transfer
// Body: { from_char_id, to_char_id, to_grudge_id, amount }
router.post('/transfer', async (req, res, next) => {
  try {
    if (req.isInternal) return res.status(403).json({ error: 'Use /award for internal grants' });
    const { from_char_id, to_char_id, to_grudge_id, amount } = req.body;
    if (!from_char_id || !to_char_id || !to_grudge_id || !amount) {
      return res.status(400).json({ error: 'from_char_id, to_char_id, to_grudge_id, amount required' });
    }
    if (from_char_id === to_char_id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt < 1 || amt > 100_000) {
      return res.status(400).json({ error: 'amount must be 1–100,000' });
    }

    const db = getDB();

    // Verify sender owns the from_char
    const [[fromChar]] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1',
      [from_char_id, req.user.grudge_id]
    );
    if (!fromChar) return res.status(403).json({ error: 'Source character not found' });

    // Verify recipient character exists
    const [[toChar]] = await db.query(
      'SELECT id FROM characters WHERE id = ? AND grudge_id = ? LIMIT 1',
      [to_char_id, to_grudge_id]
    );
    if (!toChar) return res.status(404).json({ error: 'Recipient character not found' });

    const ref = `transfer:${from_char_id}→${to_char_id}`;
    const senderBalance   = await applyGold(db, from_char_id, req.user.grudge_id, -amt, 'transfer_out', ref);
    const receiverBalance = await applyGold(db, to_char_id,   to_grudge_id,        amt, 'transfer_in',  ref);

    res.json({ success: true, sent: amt, your_balance: senderBalance });
  } catch (err) { next(err); }
});

// Export applyGold for use by missions route
module.exports = router;
module.exports.applyGold = applyGold;
