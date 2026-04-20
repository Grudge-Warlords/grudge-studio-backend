#!/usr/bin/env node
/**
 * sync-vercel-env.js
 *
 * Syncs the canonical shared VITE_* environment variables to every
 * Grudge-related Vercel project in the grudgenexus team.
 *
 * Required env vars:
 *   VERCEL_TOKEN    – API token from https://vercel.com/account/tokens
 *                     Needs permissions: "Read & Write" on "Environment Variables"
 *   VERCEL_TEAM_ID  – Team ID for grudgenexus (get from vercel team ls or dashboard URL)
 *                     e.g. team_xxxxxxxxxxx
 *
 * Usage:
 *   VERCEL_TOKEN=xxx VERCEL_TEAM_ID=team_xxx node scripts/sync-vercel-env.js
 *   node scripts/sync-vercel-env.js --dry-run   (preview only, no writes)
 *
 * To find your team ID:
 *   npx vercel team ls   → copy the ID column for grudgenexus
 */

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────

const VERCEL_TOKEN   = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || 'grudgenexus'; // slug also works
const DRY_RUN        = process.argv.includes('--dry-run');

if (!VERCEL_TOKEN) {
  console.error('❌  VERCEL_TOKEN is required.');
  console.error('    Get one at: https://vercel.com/account/tokens');
  process.exit(1);
}

// ── Shared environment variables (non-secret, non-app-exclusive) ─────────────
// These are the values every Grudge frontend should share.
// Add app-exclusive vars (WEB3AUTH_CLIENT_ID, etc.) manually per project.

const SHARED_VARS = [
  { key: 'VITE_AUTH_URL',            value: 'https://id.grudge-studio.com' },
  { key: 'VITE_API_URL',             value: 'https://api.grudge-studio.com' },
  { key: 'VITE_ACCOUNT_URL',         value: 'https://account.grudge-studio.com' },
  { key: 'VITE_WALLET_URL',          value: 'https://wallet.grudge-studio.com' },
  { key: 'VITE_LAUNCHER_URL',        value: 'https://launcher.grudge-studio.com' },
  { key: 'VITE_WS_URL',              value: 'wss://ws.grudge-studio.com' },
  { key: 'VITE_AI_URL',              value: 'https://ai.grudge-studio.com' },
  { key: 'VITE_ASSETS_URL',          value: 'https://assets.grudge-studio.com' },
  { key: 'VITE_OBJECTSTORE_URL',     value: 'https://molochdagod.github.io/ObjectStore' },
  { key: 'VITE_GBUX_TOKEN_ADDRESS',  value: '55TpSoMNxbfsNJ9U1dQoo9H3dRtDmjBZVMcKqvU2nray' },
  { key: 'VITE_WEB3AUTH_NETWORK',    value: 'sapphire_mainnet' },
  { key: 'VITE_ENABLE_WEB3',         value: 'true' },
];

// Projects to sync. These are the production Grudge platform apps.
// thc-labz-battle and dopebudz are intentionally excluded per project rules.
const TARGET_PROJECTS = [
  'warlord-crafting-suite',
  'grudge-platform',
  'grudge-wars',
  'grudge-warlords-game',
  'grudge-builder',
  'gdevelop-assistant',
  'star-way-gruda-web-client',
  'grim-armada-web',
  'grudge-studio-dash',
  'nexus-nemesis',
  'nexus-nemesis-game',
  'grudge-factions-site',
  'grudachain',
  'grudachain2',
  'grudge-game-data-hub',
  'grudge-rts',
  'grudge-angeler',
  'grudge-rpg-sprite-attack',
  'grudge-warlords-3d',
  'dungeon-crawler-quest',
  'grudge-space-rts',
  'the-engine',
];

// ── Vercel API helpers ────────────────────────────────────────────────────────

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const teamQ = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : '';
    const options = {
      hostname: 'api.vercel.com',
      path: path + teamQ,
      method,
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Get existing env vars for a project */
async function getProjectEnvs(projectId) {
  const res = await apiRequest('GET', `/v9/projects/${projectId}/env`);
  if (res.status !== 200) return [];
  return res.body.envs || [];
}

/** Upsert a single env var (create or update) */
async function upsertEnv(projectId, key, value, existingEnvs) {
  const existing = existingEnvs.find(e => e.key === key);
  const targets = ['production', 'preview', 'development'];

  if (existing) {
    // Update existing
    const res = await apiRequest('PATCH', `/v9/projects/${projectId}/env/${existing.id}`, {
      value,
      target: targets,
      type: 'plain',
    });
    return { action: 'updated', status: res.status };
  } else {
    // Create new
    const res = await apiRequest('POST', `/v9/projects/${projectId}/env`, {
      key,
      value,
      target: targets,
      type: 'plain',
    });
    return { action: 'created', status: res.status };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧  Grudge Studio — Vercel Shared Env Sync`);
  console.log(`    Team: ${VERCEL_TEAM_ID}`);
  console.log(`    Projects: ${TARGET_PROJECTS.length}`);
  console.log(`    Variables: ${SHARED_VARS.length}`);
  console.log(`    Mode: ${DRY_RUN ? '🟡 DRY RUN (no writes)' : '🟢 LIVE'}\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors  = 0;

  for (const projectSlug of TARGET_PROJECTS) {
    console.log(`\n📦  ${projectSlug}`);

    let existingEnvs = [];
    try {
      existingEnvs = await getProjectEnvs(projectSlug);
    } catch (err) {
      console.error(`    ❌ Could not fetch envs: ${err.message}`);
      totalErrors++;
      continue;
    }

    for (const { key, value } of SHARED_VARS) {
      if (DRY_RUN) {
        const exists = existingEnvs.find(e => e.key === key);
        const existingVal = exists?.value;
        if (!exists) {
          console.log(`    + ${key} → "${value}" (would create)`);
        } else if (existingVal !== value) {
          console.log(`    ~ ${key} → "${value}" (would update from "${existingVal}")`);
        } else {
          console.log(`    ✓ ${key} already correct`);
        }
        continue;
      }

      try {
        const result = await upsertEnv(projectSlug, key, value, existingEnvs);
        if (result.status >= 200 && result.status < 300) {
          const icon = result.action === 'created' ? '+' : '~';
          console.log(`    ${icon} ${key} (${result.action})`);
          if (result.action === 'created') totalCreated++;
          else totalUpdated++;
        } else {
          console.error(`    ❌ ${key} — HTTP ${result.status}`);
          totalErrors++;
        }
      } catch (err) {
        console.error(`    ❌ ${key} — ${err.message}`);
        totalErrors++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (DRY_RUN) {
    console.log('🟡  Dry run complete — no changes were made.');
    console.log('    Remove --dry-run to apply.\n');
  } else {
    console.log(`✅  Sync complete.`);
    console.log(`    Created: ${totalCreated}  Updated: ${totalUpdated}  Errors: ${totalErrors}\n`);
    if (totalCreated + totalUpdated > 0) {
      console.log('⚡  Trigger new deployments on affected projects for env changes to take effect.');
      console.log('    npx vercel --scope grudgenexus --prod --yes\n');
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
