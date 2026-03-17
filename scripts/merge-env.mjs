/**
 * Merge F:\.env.txt (real app secrets) with .env.example (template)
 * Generates secure random values for missing infrastructure variables.
 * Output: .env in the repo root
 *
 * Usage: node scripts/merge-env.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const REAL_ENV_PATH = 'F:\\.env.txt';
const TEMPLATE_PATH = join(REPO_ROOT, '.env.example');
const OUTPUT_PATH = join(REPO_ROOT, '.env');

// Generate a random hex string
const rand = (bytes = 32) => randomBytes(bytes).toString('hex');

// ── Parse an env file into { key: value } ──────────────────────
function parseEnv(filepath) {
  const map = {};
  try {
    const lines = readFileSync(filepath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      map[key] = val;
    }
  } catch (err) {
    console.error(`Warning: Could not read ${filepath}: ${err.message}`);
  }
  return map;
}

// ── Variables that need auto-generation if missing ─────────────
const GENERATED_DEFAULTS = {
  MYSQL_ROOT_PASSWORD: () => rand(16),
  MYSQL_DATABASE: () => 'grudge_game',
  MYSQL_USER: () => 'grudge_admin',
  MYSQL_PASSWORD: () => rand(16),
  REDIS_PASSWORD: () => rand(16),
  INTERNAL_API_KEY: () => rand(24),
  LAUNCH_TOKEN_SECRET: () => rand(32),
  WALLET_MASTER_SEED: () => 'PLACEHOLDER_GENERATE_BIP39_MNEMONIC',
  MAX_PLAYERS: () => '22',
};

// ── Main ────────────────────────────────────────────────────────
const realValues = parseEnv(REAL_ENV_PATH);
const template = readFileSync(TEMPLATE_PATH, 'utf-8');

console.log(`Loaded ${Object.keys(realValues).length} real values from ${REAL_ENV_PATH}`);

let output = '';
let filled = 0, generated = 0, kept = 0;

for (const line of template.split(/\r?\n/)) {
  const trimmed = line.trim();

  // Pass through comments and blanks
  if (!trimmed || trimmed.startsWith('#')) {
    output += line + '\n';
    continue;
  }

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 1) {
    output += line + '\n';
    continue;
  }

  const key = trimmed.slice(0, eqIdx).trim();

  if (realValues[key] !== undefined) {
    // Use real value from F:\.env.txt
    output += `${key}=${realValues[key]}\n`;
    filled++;
  } else if (GENERATED_DEFAULTS[key]) {
    // Generate a secure value
    const val = GENERATED_DEFAULTS[key]();
    output += `${key}=${val}\n`;
    generated++;
  } else {
    // Keep the template placeholder
    output += line + '\n';
    kept++;
  }
}

writeFileSync(OUTPUT_PATH, output, 'utf-8');

console.log(`\nMerged .env written to: ${OUTPUT_PATH}`);
console.log(`  Filled from real env:  ${filled}`);
console.log(`  Auto-generated:        ${generated}`);
console.log(`  Kept as placeholder:   ${kept}`);
console.log(`\n⚠ You still need to fill in OBJECT_STORAGE_* values for R2!`);
console.log(`  Look for these in your Cloudflare R2 dashboard:`);
console.log(`    OBJECT_STORAGE_ENDPOINT`);
console.log(`    OBJECT_STORAGE_BUCKET`);
console.log(`    OBJECT_STORAGE_KEY`);
console.log(`    OBJECT_STORAGE_SECRET`);
console.log(`    OBJECT_STORAGE_PUBLIC_URL`);
