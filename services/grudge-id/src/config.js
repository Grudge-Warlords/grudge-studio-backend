"use strict";

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME || "grudge_game",
    user: process.env.DB_USER || "grudge",
    password: process.env.DB_PASS || "",
  },

  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION",
    accessExpiresIn: "15m",
    refreshExpiresIn: "7d",
  },

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim()),

  // Discord OAuth
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    redirectUri:
      process.env.DISCORD_REDIRECT_URI ||
      "https://id.grudge-studio.com/auth/discord/callback",
  },

  // Google OAuth (Phase 2)
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "https://id.grudge-studio.com/auth/google/callback",
  },

  // GitHub OAuth (Phase 2)
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    redirectUri:
      process.env.GITHUB_REDIRECT_URI ||
      "https://id.grudge-studio.com/auth/github/callback",
  },

  // Cloudflare Turnstile
  turnstile: {
    secretKey: process.env.CF_TURNSTILE_SECRET_KEY || "",
    siteKey: process.env.CF_TURNSTILE_SITE_KEY || "",
  },

  // Web3Auth (for verifying Web3Auth tokens if needed)
  web3authClientId: process.env.WEB3AUTH_CLIENT_ID || "",

  // Wallet service (internal)
  walletServiceUrl:
    process.env.WALLET_SERVICE_URL || "http://wallet-service:3002",

  // Internal API key for service-to-service calls
  internalApiKey: process.env.INTERNAL_API_KEY || "",

  // Auth frontend URL (where users see the login page)
  authFrontendUrl:
    process.env.AUTH_FRONTEND_URL || "https://grudgewarlords.com/auth",

  // Default redirect after login if none specified
  defaultRedirect: "https://grudgewarlords.com",
};
