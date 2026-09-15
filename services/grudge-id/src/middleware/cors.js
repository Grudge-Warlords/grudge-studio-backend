"use strict";

const cors = require("cors");
const cfg = require("../config");

const corsMiddleware = cors({
  origin(origin, cb) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return cb(null, true);
    if (cfg.corsOrigins.includes(origin)) return cb(null, true);
    // Also allow any *.grudge-studio.com or *.grudgewarlords.com subdomain
    if (
      /\.grudge-studio\.com$/.test(origin) ||
      /\.grudgestudio\.com$/.test(origin) ||
      /\.grudgewarlords\.com$/.test(origin) ||
      origin === "https://grudgewarlords.com" ||
      origin === "https://grudge-studio.com" ||
      origin === "https://grudgestudio.com"
    ) {
      return cb(null, true);
    }
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  maxAge: 86400,
});

module.exports = { corsMiddleware };
