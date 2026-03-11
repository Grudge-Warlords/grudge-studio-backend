# Puter Cloud — Integration Guide

Grudge Studio uses **puter.js** for client-side cloud storage. The backend bridges authentication and tracks save metadata.

---

## How it works

```
Client (browser / launcher)
    │
    ├─ 1. GET /puter/link  (account-api)
    │       → get puter_id + your path namespaces
    │
    ├─ 2. puter.auth.signIn()  ← puter.js SDK (client-side)
    │       uses puter_id to scope the user's cloud folder
    │
    ├─ 3. puter.fs.write(path, data)  ← puter.js (client-side)
    │       saves game data to /grudge/{puter_id}/saves/...
    │
    └─ 4. POST /puter/saves  (account-api)
            record the save metadata in our database
            so other devices can discover what's in the cloud
```

The backend **never proxies file bytes** — all Puter FS operations are done directly by the client using the puter.js SDK. The backend only stores metadata (path, size, checksum) for cross-device discovery.

---

## Setup — include puter.js

In your HTML page or web app:
```html
<script src="https://js.puter.com/v2/"></script>
```

Or in a Node/Electron app:
```bash
npm install @puter/sdk
```

---

## Step 1 — Get your Puter namespace

```js
const res = await fetch('https://account.grudgestudio.com/puter/link', {
  headers: { 'Authorization': `Bearer ${grudgeJWT}` }
});

const { puter_id, saves_path, exports_path, screenshots_path } = await res.json();
// {
//   puter_id: "GRUDGE-abc12345",
//   saves_path: "/grudge/GRUDGE-abc12345/saves",
//   exports_path: "/grudge/GRUDGE-abc12345/exports",
//   screenshots_path: "/grudge/GRUDGE-abc12345/screenshots"
// }
```

---

## Step 2 — Sign in to Puter

```js
// puter.js is loaded globally
await puter.auth.signIn();
// User logs in with their Puter account
// Their cloud storage at /grudge/{puter_id}/ is their private namespace
```

---

## Step 3 — Write a game save

```js
const saveData = {
  char_id: 7,
  level: 42,
  position: { island: 'spawn', x: 100, y: 64, z: 200 },
  inventory: [...],
  timestamp: Date.now()
};

const saveJson = JSON.stringify(saveData);
const path = `${saves_path}/${saveData.char_id}/autosave.json`;

// Write to Puter cloud
await puter.fs.write(path, saveJson);

// Record metadata in Grudge backend
await fetch('https://account.grudgestudio.com/puter/saves', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${grudgeJWT}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    char_id: saveData.char_id,
    save_key: 'autosave',
    puter_path: path,
    size_bytes: saveJson.length,
    checksum: await sha256(saveJson)  // optional but recommended
  })
});
```

---

## Step 4 — Read saves on another device

```js
// Get list of cloud saves from Grudge backend
const res = await fetch(`https://account.grudgestudio.com/puter/saves/${charId}`, {
  headers: { 'Authorization': `Bearer ${grudgeJWT}` }
});
const saves = await res.json();
// [{ id, save_key, puter_path, size_bytes, checksum, synced_at }]

// Load a specific save from Puter
const saveKey = saves.find(s => s.save_key === 'autosave');
const content = await puter.fs.read(saveKey.puter_path);
const saveData = JSON.parse(content);
```

---

## Step 5 — Upload a screenshot

```js
const screenshotBlob = await captureScreenshot(); // your game screenshot logic
const path = `${screenshots_path}/${Date.now()}.png`;

await puter.fs.write(path, screenshotBlob);

// Record in backend (account-level save, no char_id)
await fetch('https://account.grudgestudio.com/puter/saves', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${grudgeJWT}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    save_key: `screenshot_${Date.now()}`,
    puter_path: path,
    size_bytes: screenshotBlob.size
  })
});
```

---

## Path conventions

| Type | Path pattern |
|---|---|
| Character autosave | `/grudge/{puter_id}/saves/{char_id}/autosave.json` |
| Character checkpoint | `/grudge/{puter_id}/saves/{char_id}/checkpoint_{n}.json` |
| Character export | `/grudge/{puter_id}/exports/{char_id}_export.json` |
| Account settings | `/grudge/{puter_id}/settings.json` |
| Screenshot | `/grudge/{puter_id}/screenshots/{timestamp}.png` |

---

## AI features via puter.js

The puter.js SDK also exposes AI capabilities you can use in-app:

```js
// Generate a character portrait
const portrait = await puter.ai.txt2img(
  `Fantasy warrior character, ${race} ${charClass}, medieval armor, game art style`,
  { width: 256, height: 256 }
);

// Generate mission flavor text
const lore = await puter.ai.txt2txt(
  `Write a short (2 sentence) quest description for a ${faction} faction mission to defeat pirates on ${island}.`
);
```

---

## Deleting a save record

When the user deletes a save in-game, delete from Puter and remove the record:

```js
// 1. Delete from Puter (client-side)
await puter.fs.delete(puter_path);

// 2. Remove record from Grudge backend
await fetch(`https://account.grudgestudio.com/puter/saves/${saveId}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${grudgeJWT}` }
});
```

---

## puter_id format

Each user's `puter_id` is set to `GRUDGE-{first 8 chars of grudge_id UUID}` at registration time. This is stable and acts as their cloud namespace identifier. It appears in the `users` table and is returned by `GET /puter/link`.
