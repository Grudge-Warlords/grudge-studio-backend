#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Grudge Studio — Secret Generator
// Usage: node scripts/gen-secrets.js          (print to terminal)
//        node scripts/gen-secrets.js > .env   (write .env file)
// ─────────────────────────────────────────────────────────────
const { randomBytes } = require('crypto');

function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

const REDIS_PASS = hex(16);

const out = `# ═══════════════════════════════════════════════════
# GRUDGE STUDIO — Environment Config
# Generated: ${new Date().toISOString()}
# ═══════════════════════════════════════════════════

# ─── MYSQL ────────────────────────────────────────
MYSQL_ROOT_PASSWORD=${hex(16)}
MYSQL_DATABASE=grudge_game
MYSQL_USER=grudge_admin
MYSQL_PASSWORD=${hex(16)}

# ─── REDIS ────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASS}
# Local dev (non-Docker): redis://:${REDIS_PASS}@localhost:6379
# Docker internal (set automatically in docker-compose):
# REDIS_URL=redis://:${REDIS_PASS}@redis:6379

# ─── JWT ──────────────────────────────────────────
JWT_SECRET=${hex(64)}

# ─── DISCORD AUTH ─────────────────────────────────
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_REDIRECT_URI=https://id.grudge-studio.com/auth/discord/callback

# ─── WEB3AUTH ─────────────────────────────────────
WEB3AUTH_CLIENT_ID=your_web3auth_client_id

# ─── SOLANA / WALLET SERVICE ──────────────────────
# Generate mnemonic: node -e "const {generateMnemonic}=require('bip39');console.log(generateMnemonic(256))"
WALLET_MASTER_SEED=24_word_bip39_mnemonic_phrase_goes_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# ─── INTERNAL SERVICES ────────────────────────────
INTERNAL_API_KEY=${hex(32)}

# ─── GAME SERVER ──────────────────────────────────
MAX_PLAYERS=22

# ─── CORS ORIGINS ─────────────────────────────────
# Comma-separated list of allowed origins.
# Add your GitHub Pages URL, puter app domain, or localhost here.
CORS_ORIGINS=https://grudgewarlords.com,https://grudge-studio.com,https://grudgestudio.com,https://grudachain.grudge-studio.com,https://dash.grudge-studio.com

# ─── OBJECT STORAGE ───────────────────────────────
# Compatible with S3, Cloudflare R2, Backblaze B2, ObjectStore, etc.
OBJECT_STORAGE_ENDPOINT=https://s3.your-provider.com
OBJECT_STORAGE_BUCKET=grudge-studio-assets
OBJECT_STORAGE_KEY=your_access_key
OBJECT_STORAGE_SECRET=your_secret_key
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_PUBLIC_URL=https://assets.grudge-studio.com

# ─── SERVICE URLS (internal, set by docker-compose) ─
# AI_AGENT_URL=http://ai-agent:3004
# WALLET_SERVICE_URL=http://wallet-service:3002

# ─── DOMAINS ──────────────────────────────────────
DOMAIN_ID=id.grudge-studio.com
DOMAIN_API=api.grudge-studio.com
DOMAIN_WS=ws.grudge-studio.com
DOMAIN_DASH=dash.grudge-studio.com
CF_D1_DATABASE_ID=8fcb111b-fcee-4f4e-b0d5-59ad416ee3b9
`;

process.stdout.write(out);
