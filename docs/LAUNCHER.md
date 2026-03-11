# Grudge Launcher — Integration Guide

This guide explains how the desktop Grudge Launcher client integrates with `launcher-api`.

---

## Flow Overview

```
Launcher starts
    │
    ├─ 1. Check for updates → GET /manifest
    │       if new version available → download + patch
    │
    ├─ 2. User logs in → GET /auth/discord (or Web3Auth)
    │       receives JWT from grudge-id
    │
    ├─ 3. Register this machine → POST /register-computer
    │       sends computer_id (stable UUID stored on disk)
    │
    ├─ 4. Check entitlement → GET /entitlement
    │       { has_access: true } → continue
    │
    ├─ 5. Request launch token → POST /launch-token
    │       receives one-time token (5 min TTL)
    │
    └─ 6. Launch game → pass token as CLI arg or env var
            game client connects to ws.grudgestudio.com
            grudge-headless validates token via internal API
            token is consumed (single use)
```

---

## Step 1 — Check for updates

Call on every launcher startup to detect new versions.

```js
const res = await fetch('https://launcher.grudgestudio.com/manifest?channel=stable');
const manifest = await res.json();
// {
//   version: "1.2.0",
//   channel: "stable",
//   min_version: "1.0.0",
//   patch_notes: "Bug fixes and performance improvements",
//   downloads: {
//     windows: { url: "https://...", sha256: "abc123..." },
//     mac:     { url: "https://...", sha256: "def456..." },
//     linux:   { url: "https://...", sha256: "ghi789..." }
//   }
// }

const currentVersion = readLocalVersion(); // from local version file

if (manifest.version !== currentVersion) {
  // Download from manifest.downloads[platform].url
  // Verify SHA-256 matches manifest.downloads[platform].sha256
  // Apply update
}
```

The download URLs are presigned S3 URLs valid for 24 hours. For CDN URLs they are returned directly.

---

## Step 2 — User authentication

The launcher must obtain a Grudge ID JWT. Recommended flow: open a browser window to Discord OAuth.

```js
// Open system browser to Discord login
const authUrl = 'https://id.grudgestudio.com/auth/discord';
shell.openExternal(authUrl); // Electron: shell.openExternal

// Listen on a local redirect URI (or use a custom scheme like grudge://auth)
// grudge-id returns JWT in the redirect
// e.g.: grudge://auth?jwt=eyJ...

// Store the JWT securely (OS keychain recommended)
keytar.setPassword('grudge-studio', 'jwt', jwt);
```

---

## Step 3 — Register this computer

Run once per machine, then refresh on every launch.

```js
// Generate a stable computer_id and persist it to disk
// (generate once with crypto.randomUUID(), store in AppData/Roaming/grudge/machine_id)
const computerId = getOrCreateComputerUUID();

// Optional: collect a hardware fingerprint
// SHA-256(mac_address + drive_serial + cpu_id)
const fingerprint = await getHardwareFingerprint();

const res = await fetch('https://launcher.grudgestudio.com/register-computer', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    computer_id: computerId,
    fingerprint_hash: fingerprint,
    platform: process.platform,          // 'win32' | 'darwin' | 'linux'
    launcher_version: app.getVersion(),  // Electron: app.getVersion()
    label: os.hostname()                 // e.g. "MARY-GAMING-PC"
  })
});

// { computer_id: "uuid", registered: true }
// or { computer_id: "uuid", refreshed: true }  ← already registered, updated last_seen
```

If the user has 5 registered computers already, the API returns 409. Show a message directing them to revoke a computer from `account.grudgestudio.com/sessions`.

---

## Step 4 — Check entitlement

```js
const res = await fetch('https://launcher.grudgestudio.com/entitlement', {
  headers: { 'Authorization': `Bearer ${jwt}` }
});
const { has_access, tier } = await res.json();

if (!has_access) {
  showError('Your account does not have game access.');
  return;
}
// tier is currently 'player' — will expand to support subscriptions/NFT gating
```

---

## Step 5 — Get a launch token

Request a fresh token immediately before launching. It expires in 5 minutes.

```js
const res = await fetch('https://launcher.grudgestudio.com/launch-token', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ computer_id: computerId })
});

const { token, expires_at } = await res.json();
// token is a short-lived JWT signed with LAUNCH_TOKEN_SECRET
// expires_at: "2026-03-11T08:00:00.000Z"
```

---

## Step 6 — Launch the game

Pass the launch token to the game client. The game connects to `ws.grudgestudio.com` and sends the token for authentication.

```js
// Electron example
const { spawn } = require('child_process');

const gameProcess = spawn(gameBinaryPath, [
  '--launch-token', token,
  '--server', 'wss://ws.grudgestudio.com'
]);
```

**In the game client**, on WebSocket connect:
```json
{ "type": "auth", "token": "<launch_token>" }
```

**grudge-headless** validates it by calling internally:
```
GET http://launcher-api:3006/validate-launch-token?token=<token>
x-internal-key: <INTERNAL_API_KEY>
```

If `{ valid: true }`, the player is authenticated and connected.
If `{ valid: false }`, close the connection — token was already used or expired.

---

## Storing the computer_id

The `computer_id` should be a UUID generated once and stored persistently:

```js
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { app } = require('electron');

function getOrCreateComputerUUID() {
  const file = path.join(app.getPath('userData'), 'machine_id');
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim();
  }
  const id = randomUUID();
  fs.writeFileSync(file, id);
  return id;
}
```

---

## Publishing a new game version

When you release a new build, push it to ObjectStore/S3 and register it:

```bash
curl -X POST https://launcher.grudgestudio.com/versions \
  -H "x-internal-key: YOUR_INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.3.0",
    "channel": "stable",
    "set_current": true,
    "windows_url": "https://assets.grudgestudio.com/releases/GrudgeWarlords-1.3.0-win.exe",
    "windows_sha256": "abc123...",
    "mac_url": "https://assets.grudgestudio.com/releases/GrudgeWarlords-1.3.0-mac.dmg",
    "mac_sha256": "def456...",
    "patch_notes": "New islands, bug fixes, balance changes."
  }'
```

Or use an S3 key instead of a full URL — the API will generate a presigned download URL automatically.
