"use strict";

const { Router } = require("express");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { findOrCreateByProvider } = require("../services/user");
const { signAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");
const { requireTurnstile } = require("../middleware/turnstile");

const router = Router();

// Nonce store — wallet address -> { nonce, createdAt }
const nonceStore = new Map();

/**
 * POST /auth/wallet/nonce
 * Body: { walletAddress }
 * Returns a nonce the wallet must sign.
 */
router.post("/nonce", authLimiter, (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ error: "Missing walletAddress" });
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  nonceStore.set(walletAddress, { nonce, createdAt: Date.now() });

  // Expire old nonces (lazy cleanup)
  for (const [k, v] of nonceStore) {
    if (Date.now() - v.createdAt > 300_000) nonceStore.delete(k);
  }

  const message = `Sign this message to log in to Grudge Studio.\n\nNonce: ${nonce}`;
  res.json({ ok: true, message, nonce });
});

/**
 * POST /auth/wallet
 * Body: { walletAddress, signature, turnstileToken }
 * Verifies ed25519 signature, returns JWT.
 */
router.post("/", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({ error: "Missing walletAddress or signature" });
    }

    // Retrieve nonce
    const stored = nonceStore.get(walletAddress);
    if (!stored) {
      return res.status(400).json({ error: "No pending nonce — request /nonce first" });
    }
    nonceStore.delete(walletAddress);

    // Check nonce age (5 min max)
    if (Date.now() - stored.createdAt > 300_000) {
      return res.status(400).json({ error: "Nonce expired — request a new one" });
    }

    // Verify signature
    const message = `Sign this message to log in to Grudge Studio.\n\nNonce: ${stored.nonce}`;
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(walletAddress);

    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!valid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Find or create user
    const { user } = await findOrCreateByProvider({
      provider: "wallet",
      providerUid: walletAddress,
      displayName: `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`,
      providerData: { chain: "solana", address: walletAddress },
    });

    const token = signAccess(user);

    console.log(`[AUTH] Wallet login: ${walletAddress.slice(0, 8)}... (${user.grudge_id})`);

    res.json({
      ok: true,
      token,
      grudgeId: user.grudge_id,
      displayName: user.display_name,
      walletAddress,
      provider: "wallet",
    });
  } catch (err) {
    console.error("[WALLET] Auth error:", err);
    res.status(500).json({ error: "Wallet authentication failed" });
  }
});

module.exports = router;
