/**
 * Grudge Studio — GitHub Actions Secret Migrator
 * Reads secrets from .env and pushes them to the GitHub repo's Actions secrets.
 *
 * Usage:  node scripts/set-github-secrets.mjs
 *
 * Requires: npm install -g tweetsodium  OR  uses the built-in approach below
 *
 * GitHub API docs: https://docs.github.com/en/rest/actions/secrets
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse .env ────────────────────────────────────────────────────────────────
function parseEnv(filePath) {
  const vars = {};
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    vars[key] = val;
  }
  return vars;
}

const env = parseEnv(resolve(ROOT, '.env'));

const GITHUB_TOKEN = env.GITHUB_TOKEN;
const REPO         = 'MolochDaGod/grudge-studio-backend';

if (!GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN not found in .env');
  process.exit(1);
}

// ── Secrets to push ───────────────────────────────────────────────────────────
// Read SSH key from ~/.ssh/id_ed25519
let sshKey = '';
try {
  sshKey = readFileSync(
    process.env.HOME
      ? `${process.env.HOME}/.ssh/id_ed25519`
      : `C:\\Users\\Mary\\.ssh\\id_ed25519`,
    'utf8'
  ).trim();
} catch {
  console.warn('WARNING: Could not read SSH key — DEPLOY_SSH_KEY will be skipped');
}

const SECRETS = {
  VPS_HOST:    '74.208.155.229',
  VPS_USER:    'root',
  DISCORD_SYSTEM_WEBHOOK_TOKEN: env.DISCORD_SYSTEM_WEBHOOK_TOKEN || '',
  ...(sshKey ? { DEPLOY_SSH_KEY: sshKey } : {}),
};

// ── GitHub API helpers ────────────────────────────────────────────────────────
const GH_API = 'https://api.github.com';
const HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'grudge-studio-secret-migrator/1.0',
};

async function ghFetch(path, opts = {}) {
  const res = await fetch(`${GH_API}${path}`, { headers: HEADERS, ...opts });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// ── Encrypt with libsodium (required by GitHub) ───────────────────────────────
// GitHub requires secrets encrypted with the repo's NaCl public key
// We use the sodium-native or libsodium-wrappers package if available,
// otherwise fall back to Node.js Buffer + a pure-JS sealed box implementation.

async function encryptSecret(publicKeyBase64, secretValue) {
  // Try libsodium-wrappers first (fast, available via npm)
  try {
    const { default: sodium } = await import('libsodium-wrappers');
    await sodium.ready;
    const keyBytes = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
    const msgBytes = sodium.from_string(secretValue);
    const encrypted = sodium.crypto_box_seal(msgBytes, keyBytes);
    return Buffer.from(encrypted).toString('base64');
  } catch {}

  // Fallback: tweetsodium (GitHub's own recommended library)
  try {
    const { default: tweetsodium } = await import('tweetsodium');
    const keyBytes  = Buffer.from(publicKeyBase64, 'base64');
    const msgBytes  = Buffer.from(secretValue);
    const encrypted = tweetsodium.seal(msgBytes, keyBytes);
    return Buffer.from(encrypted).toString('base64');
  } catch {}

  throw new Error(
    'Neither libsodium-wrappers nor tweetsodium is available.\n' +
    'Run:  npm install --no-save libsodium-wrappers\n' +
    'Then re-run this script.'
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nGrudge Studio — GitHub Secret Migrator`);
  console.log(`Repo: https://github.com/${REPO}`);
  console.log('─'.repeat(50));

  // Get repo public key
  const { ok, status, body: pkBody } = await ghFetch(`/repos/${REPO}/actions/secrets/public-key`);
  if (!ok) {
    console.error(`\nERROR: Could not fetch repo public key (HTTP ${status})`);
    console.error(`Response: ${JSON.stringify(pkBody)}`);
    console.error(`\nYour GITHUB_TOKEN may be expired or lack 'repo' scope.`);
    console.error(`Create a new token at: https://github.com/settings/tokens/new`);
    console.error(`Required scope: ✅ repo (full control)`);
    process.exit(1);
  }

  const { key_id, key } = pkBody;
  console.log(`\nPublic key obtained (key_id: ${key_id})\n`);

  let success = 0;
  let failed  = 0;

  for (const [name, value] of Object.entries(SECRETS)) {
    if (!value) {
      console.log(`SKIP  ${name} (empty value)`);
      continue;
    }
    try {
      const encrypted = await encryptSecret(key, value);
      const { ok: putOk, status: putStatus } = await ghFetch(
        `/repos/${REPO}/actions/secrets/${name}`,
        {
          method: 'PUT',
          body: JSON.stringify({ encrypted_value: encrypted, key_id }),
        }
      );
      if (putOk || putStatus === 204) {
        console.log(`  ✅ ${name}`);
        success++;
      } else {
        console.log(`  ❌ ${name} (HTTP ${putStatus})`);
        failed++;
      }
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Done: ${success} set, ${failed} failed`);
  if (failed === 0) {
    console.log('\nAll secrets migrated! GitHub Actions CI/CD is ready.');
    console.log('Next push to main will trigger an auto-deploy.');
  }
})();
