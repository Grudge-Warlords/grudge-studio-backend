/**
 * Phantom Server SDK Routes
 *
 * Server-side wallet operations using Phantom Connect's managed infrastructure.
 * Used for game rewards, NFT minting, and server-initiated transactions.
 *
 * These complement the existing HD wallet routes (wallet.js) which handle
 * deterministic server-side wallets derived from the master seed.
 *
 * Environment variables required:
 *   PHANTOM_ORGANIZATION_ID — From Phantom Portal
 *   PHANTOM_APP_ID          — 656b4ef2-7acc-44fe-bec7-4b288cfdd2e9
 *   PHANTOM_API_PRIVATE_KEY — Server API key from Phantom Portal
 */

const express = require('express');
const router = express.Router();

let ServerSDK, NetworkId;
let phantomSdk = null;

// Lazy-init to avoid crashing if keys aren't set
function getPhantomSdk() {
  if (phantomSdk) return phantomSdk;

  if (!ServerSDK) {
    const phantom = require('@phantom/server-sdk');
    ServerSDK = phantom.ServerSDK;
    NetworkId = phantom.NetworkId;
  }

  const orgId = process.env.PHANTOM_ORGANIZATION_ID;
  const appId = process.env.PHANTOM_APP_ID;
  const privateKey = process.env.PHANTOM_API_PRIVATE_KEY;

  if (!orgId || !appId || !privateKey) {
    return null;
  }

  phantomSdk = new ServerSDK({
    organizationId: orgId,
    appId: appId,
    apiPrivateKey: privateKey,
  });

  console.log('[phantom] Server SDK initialized');
  return phantomSdk;
}

// ── GET /phantom/status ──
router.get('/status', (req, res) => {
  const sdk = getPhantomSdk();
  res.json({
    available: !!sdk,
    appId: process.env.PHANTOM_APP_ID || null,
    hint: sdk ? 'Phantom Server SDK ready' : 'Set PHANTOM_ORGANIZATION_ID, PHANTOM_APP_ID, PHANTOM_API_PRIVATE_KEY',
  });
});

// ── POST /phantom/create-wallet ──
// Create a Phantom-managed wallet for a user (game treasury, reward pool, etc.)
router.post('/create-wallet', async (req, res, next) => {
  try {
    const sdk = getPhantomSdk();
    if (!sdk) return res.status(503).json({ error: 'Phantom SDK not configured' });

    const { name } = req.body;
    const wallet = await sdk.createWallet(name || 'Grudge Game Wallet');

    res.json({
      walletId: wallet.walletId,
      name: wallet.name || name,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /phantom/sign-message ──
// Sign a message server-side (for verification, rewards claims, etc.)
router.post('/sign-message', async (req, res, next) => {
  try {
    const sdk = getPhantomSdk();
    if (!sdk) return res.status(503).json({ error: 'Phantom SDK not configured' });

    const { walletId, message, network } = req.body;
    if (!walletId || !message) {
      return res.status(400).json({ error: 'walletId and message required' });
    }

    const result = await sdk.signMessage({
      walletId,
      message,
      networkId: network || NetworkId.SOLANA_MAINNET,
    });

    res.json({ signature: result.signature || result });
  } catch (err) {
    next(err);
  }
});

// ── POST /phantom/send-transaction ──
// Sign and send a transaction server-side (game rewards, airdrops, etc.)
router.post('/send-transaction', async (req, res, next) => {
  try {
    const sdk = getPhantomSdk();
    if (!sdk) return res.status(503).json({ error: 'Phantom SDK not configured' });

    const { walletId, transaction, network } = req.body;
    if (!walletId || !transaction) {
      return res.status(400).json({ error: 'walletId and transaction required' });
    }

    const result = await sdk.signAndSendTransaction({
      walletId,
      transaction,
      networkId: network || NetworkId.SOLANA_MAINNET,
    });

    res.json({
      hash: result.hash,
      rawTransaction: result.rawTransaction,
      blockExplorer: result.blockExplorer,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
