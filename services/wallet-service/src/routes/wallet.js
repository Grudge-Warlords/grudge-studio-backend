const express = require('express');
const router = express.Router();
const { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { mnemonicToSeedSync } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { getDB } = require('../db');

// ── HD wallet derivation ──────────────────────
// BIP44 path: m/44'/501'/{index}'/0'  (Solana = coin 501)
function deriveKeypair(masterSeed, index) {
  const path = `m/44'/501'/${index}'/0'`;
  const seed = mnemonicToSeedSync(masterSeed);
  const { key } = derivePath(path, seed.toString('hex'));
  return Keypair.fromSeed(key);
}

// ── POST /wallet/create ───────────────────────
// Called internally by grudge-id when a new user is created
router.post('/create', async (req, res, next) => {
  try {
    const { grudge_id } = req.body;
    if (!grudge_id) return res.status(400).json({ error: 'grudge_id required' });

    const db = getDB();

    // Check if wallet already exists
    const [existing] = await db.query(
      'SELECT server_wallet_address, server_wallet_index FROM users WHERE grudge_id = ? LIMIT 1',
      [grudge_id]
    );
    if (existing.length && existing[0].server_wallet_address) {
      return res.json({
        address: existing[0].server_wallet_address,
        index: existing[0].server_wallet_index,
        existing: true,
      });
    }

    // Get next derivation index (atomic increment)
    await db.query('UPDATE wallet_index SET next_index = next_index + 1 WHERE id = 1');
    const [idxRow] = await db.query('SELECT next_index FROM wallet_index WHERE id = 1');
    const index = idxRow[0].next_index;

    // Derive keypair
    const keypair = deriveKeypair(process.env.WALLET_MASTER_SEED, index);
    const address = keypair.publicKey.toBase58();

    // Persist to users table
    await db.query(
      'UPDATE users SET server_wallet_address = ?, server_wallet_index = ? WHERE grudge_id = ?',
      [address, index, grudge_id]
    );

    res.json({ address, index, existing: false });
  } catch (err) {
    next(err);
  }
});

// ── GET /wallet/:grudge_id ────────────────────
// Get wallet address for a Grudge ID
router.get('/:grudge_id', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT server_wallet_address, server_wallet_index FROM users WHERE grudge_id = ? LIMIT 1',
      [req.params.grudge_id]
    );
    if (!rows.length || !rows[0].server_wallet_address) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    res.json({ address: rows[0].server_wallet_address, index: rows[0].server_wallet_index });
  } catch (err) {
    next(err);
  }
});

// ── GET /wallet/:grudge_id/balance ────────────
// Check on-chain SOL balance
router.get('/:grudge_id/balance', async (req, res, next) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT server_wallet_address FROM users WHERE grudge_id = ? LIMIT 1',
      [req.params.grudge_id]
    );
    if (!rows.length || !rows[0].server_wallet_address) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
    const pubkey = new PublicKey(rows[0].server_wallet_address);
    const lamports = await connection.getBalance(pubkey);

    res.json({
      address: rows[0].server_wallet_address,
      balance_sol: lamports / LAMPORTS_PER_SOL,
      balance_lamports: lamports,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
