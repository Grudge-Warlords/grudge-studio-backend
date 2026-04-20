"use strict";
/**
 * Platform Compatibility Routes — /api/auth/*
 * Returns { success: true, token, user: UserProfile } shape
 * expected by grudge-platform, WCS, and all React frontends.
 */
const { Router } = require("express");
const router = Router();

// These routes proxy to the existing auth.js routes but reshape the response
// to match the UserProfile interface grudge-platform expects.

const AUTH_BASE = process.env.IDENTITY_API || "http://localhost:3001";

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  try {
    const resp = await fetch(`${AUTH_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    // Reshape to platform format
    res.json({ success: true, token: data.token, user: data.user || data });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

/** POST /api/auth/register */
router.post("/register", async (req, res) => {
  try {
    const resp = await fetch(`${AUTH_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.status(201).json({ success: true, token: data.token, user: data.user || data });
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

/** POST /api/auth/guest */
router.post("/guest", async (req, res) => {
  try {
    const resp = await fetch(`${AUTH_BASE}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.status(201).json({ success: true, token: data.token, user: data.user || data });
  } catch (err) {
    res.status(500).json({ error: "Guest creation failed" });
  }
});

/** GET /api/auth/user — returns current user profile */
router.get("/user", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "No token" });
    const resp = await fetch(`${AUTH_BASE}/identity/me`, {
      headers: { Authorization: auth },
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/** POST /api/auth/verify */
router.post("/verify", async (req, res) => {
  try {
    const resp = await fetch(`${AUTH_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.json({ valid: false });
  }
});

/** POST /api/auth/logout */
router.post("/logout", (_req, res) => res.json({ success: true }));

/** POST /api/auth/web3auth */
router.post("/web3auth", async (req, res) => {
  try {
    const resp = await fetch(`${AUTH_BASE}/auth/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.json({ success: true, token: data.token, user: data.user || data });
  } catch (err) {
    res.status(500).json({ error: "Web3Auth failed" });
  }
});

module.exports = router;
