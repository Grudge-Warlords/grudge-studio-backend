#!/usr/bin/env node
/**
 * Uptime Kuma auto-setup — creates admin + monitors for all Grudge services.
 * Run inside the uptime-kuma container or anywhere that can reach it.
 *
 * Usage: node setup-kuma.js [kuma-url]
 *   Default kuma-url: http://localhost:3001
 */
const { io } = require("socket.io-client");

const KUMA_URL = process.argv[2] || "http://localhost:3001";
const ADMIN_USER = "grudge-admin";
const ADMIN_PASS = process.env.KUMA_PASSWORD || "GrudgeStudio2024!";

const MONITORS = [
  { name: "Grudge ID",       url: "https://id.grudge-studio.com/health",         interval: 60 },
  { name: "Game API",        url: "https://api.grudge-studio.com/health",         interval: 60 },
  { name: "Account API",     url: "https://account.grudge-studio.com/health",     interval: 60 },
  { name: "Launcher API",    url: "https://launcher.grudge-studio.com/health",    interval: 60 },
  { name: "Asset Service",   url: "https://assets-api.grudge-studio.com/health",  interval: 60 },
  { name: "WebSocket",       url: "https://ws.grudge-studio.com/health",          interval: 60 },
  { name: "Uptime Kuma Self", url: "https://status.grudge-studio.com",            interval: 120 },
];

function emit(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 15000);
    socket.emit(event, ...args, (res) => {
      clearTimeout(timeout);
      if (res && res.ok === false) reject(new Error(res.msg || JSON.stringify(res)));
      else resolve(res);
    });
  });
}

async function main() {
  console.log(`Connecting to Uptime Kuma at ${KUMA_URL}...`);
  const socket = io(KUMA_URL, { reconnection: false, timeout: 10000 });

  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", (e) => reject(new Error(`Connection failed: ${e.message}`)));
  });
  console.log("Connected.");

  // Check if setup is needed
  const info = await emit(socket, "needSetup");
  if (info === true || (info && info.needSetup)) {
    console.log("First-time setup — creating admin account...");
    await emit(socket, "setup", ADMIN_USER, ADMIN_PASS);
    console.log(`Admin '${ADMIN_USER}' created.`);
  }

  // Always login (setup doesn't auto-login)
  console.log("Logging in...");
  const loginRes = await emit(socket, "login", {
    username: ADMIN_USER,
    password: ADMIN_PASS,
    token: "",
  });
  if (!loginRes || loginRes.ok === false) {
    console.error("Login failed:", loginRes?.msg || "unknown error");
    console.log("You may need to set KUMA_PASSWORD env to your existing admin password.");
    process.exit(1);
  }
  console.log("Logged in.");

  // Get existing monitors
  const monitorList = await new Promise((resolve) => {
    socket.emit("getMonitorList", (res) => resolve(res));
  });
  const existingNames = Object.values(monitorList || {}).map((m) => m.name);
  console.log(`Existing monitors: ${existingNames.length > 0 ? existingNames.join(", ") : "none"}`);

  // Add missing monitors
  for (const m of MONITORS) {
    if (existingNames.includes(m.name)) {
      console.log(`  ✓ ${m.name} — already exists, skipping`);
      continue;
    }
    try {
      const res = await emit(socket, "add", {
        type: "http",
        name: m.name,
        url: m.url,
        method: "GET",
        interval: m.interval,
        retryInterval: 30,
        maxretries: 3,
        accepted_statuscodes: ["200-299"],
        active: true,
      });
      console.log(`  ✅ ${m.name} — monitor added (id: ${res?.monitorID})`);
    } catch (e) {
      console.log(`  ❌ ${m.name} — failed: ${e.message}`);
    }
  }

  console.log("\nDone! Visit https://status.grudge-studio.com to view your dashboard.");
  socket.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
