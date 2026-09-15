"use strict";

/**
 * Platform Compatibility Routes
 *
 * grudge-platform (and other React/TS frontends) call endpoints at
 * /api/auth/login, /api/auth/register, /api/auth/guest, /api/auth/user,
 * /api/auth/verify, /api/auth/logout, /api/auth/web3auth
 *
 * These routes wrap the core grudge-id logic and return the
 * { success: true, token, user: UserProfile } shape expected by
 * src/lib/api.ts in grudge-platform.
 */

const { Router } = require("express");
const bcrypt = require("bcrypt");
const cfg = require("../config");
const {
  findByEmail,
  findByUsername,
  findById,
  findOrCreateByProvider,
  createWithProvider,
  getProviders,
  toUserProfile,
} = require("../services/user");
const { signAccess, verifyAccess } = require("../services/jwt");
const { authLimiter } = require("../middleware/rateLimit");
const { requireTurnstile } = require("../middleware/turnstile");
const { requireAuth } = require("../middleware/auth");

const router = Router();
const SALT_ROUNDS = 12;

/* ── Helper: build standard platform response ──────── */
async function buildResponse(user) {
  const providers = await getProviders(user.id);
  const profile = toUserProfile(user, providers);

  // If wallet provider exists, set walletAddress from provider data
  const walletProv = providers.find((p) => p.provider === "wallet");
  if (walletProv && walletProv.provider_data) {
    try {
      const data =
        typeof walletProv.provider_data === "string"
          ? JSON.parse(walletProv.provider_data)
          : walletProv.provider_data;
      profile.walletAddress = data.address || walletProv.provider_uid;
    } catch {
      profile.walletAddress = walletProv.provider_uid;
    }
  }

  const token = signAccess(user);
  return { success: true, token, user: profile };
}

/**
 * POST /api/auth/login
 * Body: { username, password } — matches grudge-platform's auth.login()
 * Also accepts { email, password } for backward compat.
 */
router.post("/login", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const identifier = username || email;

    if (!identifier || !password) {
      return res.status(400).json({ error: "Username/email and password are required" });
    }

    // Try username first, then email
    let user = await findByUsername(identifier);
    if (!user) user = await findByEmail(identifier.toLowerCase());
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const data = await buildResponse(user);
    console.log(`[API] Login: ${user.display_name} (${user.grudge_id})`);
    res.json(data);
  } catch (err) {
    console.error("[API] Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/register
 * Body: { username, password, email? }
 */
router.post("/register", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Check if username or email is taken
    const existingName = await findByUsername(username);
    if (existingName) {
      return res.status(409).json({ error: "Username already taken" });
    }
    if (email) {
      const existingEmail = await findByEmail(email.toLowerCase());
      if (existingEmail) {
        return res.status(409).json({ error: "Email already registered" });
      }
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { user } = await findOrCreateByProvider({
      provider: "email",
      providerUid: email ? email.toLowerCase() : `user:${username}`,
      username,
      displayName: username,
      email: email ? email.toLowerCase() : null,
      passwordHash,
    });

    const data = await buildResponse(user);
    console.log(`[API] Register: ${user.display_name} (${user.grudge_id})`);
    res.status(201).json(data);
  } catch (err) {
    console.error("[API] Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /api/auth/guest
 * Creates an anonymous guest account.
 */
router.post("/guest", authLimiter, requireTurnstile, async (req, res) => {
  try {
    const { nanoid } = require("nanoid");
    const guestTag = nanoid(8);
    const user = await createWithProvider({
      provider: "guest",
      providerUid: `guest-${guestTag}`,
      username: `Guest_${guestTag}`,
      displayName: `Guest_${guestTag}`,
      isGuest: true,
    });

    const data = await buildResponse(user);
    console.log(`[API] Guest: ${user.display_name} (${user.grudge_id})`);
    res.status(201).json(data);
  } catch (err) {
    console.error("[API] Guest error:", err);
    res.status(500).json({ error: "Guest account creation failed" });
  }
});

/**
 * GET /api/auth/user
 * Returns the current user's profile. Used by auth.me() in grudge-platform.
 */
router.get("/user", requireAuth, async (req, res) => {
  try {
    const user = await findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const providers = await getProviders(user.id);
    const profile = toUserProfile(user, providers);

    const walletProv = providers.find((p) => p.provider === "wallet");
    if (walletProv) {
      try {
        const data =
          typeof walletProv.provider_data === "string"
            ? JSON.parse(walletProv.provider_data)
            : walletProv.provider_data;
        profile.walletAddress = data?.address || walletProv.provider_uid;
      } catch {
        profile.walletAddress = walletProv.provider_uid;
      }
    }

    res.json(profile);
  } catch (err) {
    console.error("[API] User profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * POST /api/auth/verify
 * Body: { token } — verifies a JWT and returns the user.
 */
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ valid: false, error: "Missing token" });

    const payload = verifyAccess(token);
    const user = await findById(payload.sub);
    if (!user) return res.json({ valid: false });

    const providers = await getProviders(user.id);
    const profile = toUserProfile(user, providers);
    res.json({ valid: true, user: { userId: String(user.id), username: user.username || user.display_name, grudgeId: user.grudge_id, isGuest: Boolean(user.is_guest) } });
  } catch {
    res.json({ valid: false });
  }
});

/**
 * POST /api/auth/logout
 * Clears server-side session (stateless JWT — best effort).
 */
router.post("/logout", (_req, res) => {
  res.json({ success: true });
});

/**
 * POST /api/auth/web3auth
 * Body: { idToken, walletAddress, email? }
 * For Web3Auth embedded wallet login from grudge-platform.
 */
router.post("/web3auth", authLimiter, async (req, res) => {
  try {
    const { idToken, walletAddress, email } = req.body;

    if (!idToken || !walletAddress) {
      return res.status(400).json({ error: "Missing idToken or walletAddress" });
    }

    // TODO: Verify idToken against Web3Auth JWKS in production.
    // For now we trust the token since the frontend validates it via Web3Auth SDK.

    const { user } = await findOrCreateByProvider({
      provider: "wallet",
      providerUid: walletAddress,
      displayName: `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`,
      email: email || null,
      providerData: { chain: "solana", address: walletAddress, method: "web3auth" },
    });

    const data = await buildResponse(user);
    console.log(`[API] Web3Auth login: ${walletAddress.slice(0, 8)}... (${user.grudge_id})`);
    res.json(data);
  } catch (err) {
    console.error("[API] Web3Auth error:", err);
    res.status(500).json({ error: "Web3Auth authentication failed" });
  }
});

module.exports = router;
