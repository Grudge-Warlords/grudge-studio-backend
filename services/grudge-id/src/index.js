"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cfg = require("./config");
const { corsMiddleware } = require("./middleware/cors");
const { globalLimiter } = require("./middleware/rateLimit");

// Routes
const healthRoute = require("./routes/health");
const discordRoute = require("./routes/discord");
const emailRoute = require("./routes/email");
const walletRoute = require("./routes/wallet");
const guestRoute = require("./routes/guest");
const puterRoute = require("./routes/puter");
const verifyRoute = require("./routes/verify");
const linkRoute = require("./routes/link");
const linksRoute = require("./routes/links");
const googleRoute = require("./routes/google");
const githubRoute = require("./routes/github");
const phoneRoute = require("./routes/phone");
const platformCompatRoute = require("./routes/platform-compat");
const ssoRoute = require("./routes/sso");

const app = express();

/* ── Global middleware ─────────────────────────── */
app.set("trust proxy", 1); // behind Traefik
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: "16kb" }));
app.use(globalLimiter);

/* ── Static auth frontend ──────────────────────── */
app.use("/auth", express.static(path.join(__dirname, "..", "public")));
// Serve auth.html for /auth or /auth/
app.get("/auth", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "auth.html"));
});

/* ── Routes ────────────────────────────────────── */
app.use("/", healthRoute);
app.use("/auth/discord", discordRoute);
app.use("/auth", emailRoute);
app.use("/auth/wallet", walletRoute);
app.use("/auth/guest", guestRoute);
app.use("/auth/puter-bridge", puterRoute);
app.use("/auth", verifyRoute);
app.use("/auth/link", linkRoute);
app.use("/auth/links", linksRoute);
app.use("/auth/google", googleRoute);
app.use("/auth/github", githubRoute);
app.use("/auth/phone", phoneRoute);
app.use("/auth", ssoRoute);

/* ── Platform compat (/api/auth/*) ─────────────── */
// grudge-platform and other React frontends call these endpoints.
// Mounted at /api/auth to match the API_BASE + path pattern.
app.use("/api/auth", platformCompatRoute);

/* ── 404 ───────────────────────────────────────── */
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* ── Error handler ─────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error("[GRUDGE-ID] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ── Start server ──────────────────────────────── */
const server = app.listen(cfg.port, "0.0.0.0", () => {
  console.log(`\n[GRUDGE-ID] ✓ Running on port ${cfg.port} (${cfg.nodeEnv})`);
  console.log(`[GRUDGE-ID] Auth frontend: ${cfg.authFrontendUrl}\n`);
});

/* ── Graceful shutdown ─────────────────────────── */
function shutdown(signal) {
  console.log(`[GRUDGE-ID] ${signal} received — shutting down`);
  server.close(() => {
    console.log("[GRUDGE-ID] HTTP server closed");
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
