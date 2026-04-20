#!/usr/bin/env node
/**
 * setup-cloudflare-access.js
 *
 * Creates Cloudflare Zero Trust Access applications for every
 * VPS-hosted Grudge Studio service, plus one shared service token
 * for Vercel → VPS machine-to-machine API calls.
 *
 * For Vercel-hosted frontends (grudgewarlords.com etc.) it also adds
 * a Bypass policy for /.well-known/acme-challenge/* so Vercel can
 * renew TLS certificates without being blocked by Access.
 *
 * Required env vars:
 *   CF_API_TOKEN    – Cloudflare API token with permissions:
 *                       • Zone: DNS Edit
 *                       • Account: Zero Trust Read + Write
 *                       • Account: Access: Apps and Policies Write
 *                       • Account: Access: Service Tokens Write
 *   CF_ACCOUNT_ID   – Your Cloudflare account ID (from dashboard URL)
 *
 * Optional:
 *   CF_ZONE_ID      – grudge-studio.com zone ID (for DNS edits)
 *
 * Usage:
 *   CF_API_TOKEN=xxx CF_ACCOUNT_ID=xxx node scripts/setup-cloudflare-access.js
 *   node scripts/setup-cloudflare-access.js --dry-run
 */

const https = require('https');

const CF_TOKEN     = process.env.CF_API_TOKEN;
const CF_ACCOUNT   = process.env.CF_ACCOUNT_ID;
const DRY_RUN      = process.argv.includes('--dry-run');

if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('❌  CF_API_TOKEN and CF_ACCOUNT_ID are required.');
  console.error('\n   Create a token at: https://dash.cloudflare.com/profile/api-tokens');
  console.error('   Required permissions:');
  console.error('     Account > Zero Trust > Edit');
  console.error('     Account > Access: Apps and Policies > Edit');
  console.error('     Account > Access: Service Tokens > Edit');
  console.error('     Zone > DNS > Edit\n');
  process.exit(1);
}

// ── Services to protect with Cloudflare Access ────────────────────────────────
// VPS-hosted — these sit behind Traefik and must be proxied through Cloudflare.
// All public traffic should pass through Access; health endpoints are exempt.
const VPS_SERVICES = [
  { name: 'Grudge ID',       domain: 'id.grudge-studio.com',       sessionDuration: '24h',  isAdmin: false },
  { name: 'Game API',        domain: 'api.grudge-studio.com',       sessionDuration: '24h',  isAdmin: false },
  { name: 'Account API',     domain: 'account.grudge-studio.com',   sessionDuration: '24h',  isAdmin: false },
  { name: 'Wallet Service',  domain: 'wallet.grudge-studio.com',    sessionDuration: '24h',  isAdmin: false },
  { name: 'Launcher API',    domain: 'launcher.grudge-studio.com',  sessionDuration: '24h',  isAdmin: false },
  { name: 'WebSocket',       domain: 'ws.grudge-studio.com',        sessionDuration: '24h',  isAdmin: false },
  { name: 'AI Hub',          domain: 'ai.grudge-studio.com',        sessionDuration: '8h',   isAdmin: true  },
  { name: 'Studio Dashboard',domain: 'dash.grudge-studio.com',      sessionDuration: '8h',   isAdmin: true  },
];

// Vercel-hosted frontends that are Cloudflare-proxied and need ACME bypass rules.
// Only include domains here if you are actually proxying them through Cloudflare.
// If the record is DNS-only (gray cloud), no bypass is needed.
const VERCEL_PROXIED_DOMAINS = [
  'grudgewarlords.com',
  'grudgeplatform.io',
  'grudge-studio.com',
  'play.grudge-studio.com',
  'game.grudge-studio.com',
  'nexus.grudge-studio.com',
];

// ── Cloudflare API helper ─────────────────────────────────────────────────────

function cfRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
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

// ── List existing Access apps ─────────────────────────────────────────────────

async function listAccessApps() {
  const res = await cfRequest('GET', `/accounts/${CF_ACCOUNT}/access/apps`);
  if (!res.body.success) return [];
  return res.body.result || [];
}

// ── Create or update an Access application ───────────────────────────────────

async function upsertAccessApp(service, existingApps) {
  const existing = existingApps.find(a => a.domain === service.domain);

  const payload = {
    name: `Grudge Studio — ${service.name}`,
    domain: service.domain,
    type: 'self_hosted',
    session_duration: service.sessionDuration,
    // Allow CORS preflight from all Grudge origins
    cors_headers: {
      allowed_origins: [
        'https://grudgewarlords.com',
        'https://grudgeplatform.io',
        'https://grudge-studio.com',
        'https://*.grudge-studio.com',
        'https://grudge-warlords-game.vercel.app',
        'https://warlord-crafting-suite.vercel.app',
        'https://grudge-platform.vercel.app',
      ],
      allow_credentials: true,
      allowed_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowed_headers: ['Authorization', 'Content-Type', 'CF-Access-Client-Id', 'CF-Access-Client-Secret'],
      max_age: 86400,
    },
  };

  if (DRY_RUN) {
    console.log(`    ${existing ? '~' : '+'} ${service.name} (${service.domain}) — ${existing ? 'would update' : 'would create'}`);
    return existing || { id: 'dry-run-id', aud: 'dry-run-aud' };
  }

  let appId, appAud;
  if (existing) {
    const res = await cfRequest('PUT', `/accounts/${CF_ACCOUNT}/access/apps/${existing.id}`, payload);
    if (!res.body.success) {
      console.error(`    ❌ Update failed for ${service.name}:`, JSON.stringify(res.body.errors));
      return null;
    }
    appId  = res.body.result.id;
    appAud = res.body.result.aud;
    console.log(`    ~ Updated: ${service.name} (aud: ${appAud})`);
  } else {
    const res = await cfRequest('POST', `/accounts/${CF_ACCOUNT}/access/apps`, payload);
    if (!res.body.success) {
      console.error(`    ❌ Create failed for ${service.name}:`, JSON.stringify(res.body.errors));
      return null;
    }
    appId  = res.body.result.id;
    appAud = res.body.result.aud;
    console.log(`    + Created: ${service.name} (aud: ${appAud})`);
  }

  return { id: appId, aud: appAud };
}

// ── Create Access policies ────────────────────────────────────────────────────

async function createPolicy(appId, service) {
  const policies = [];

  // Policy 1: Allow — grudge-studio.com email domain + service tokens
  policies.push({
    name: 'Allow Grudge Users',
    decision: 'allow',
    include: [
      { email_domain: { domain: 'grudge-studio.com' } },
      // Also allow anyone who authenticates via service token
      { service_token: {} },
    ],
    precedence: 1,
  });

  // Policy 2 (admin only): Require specific email list
  if (service.isAdmin) {
    policies.push({
      name: 'Admin Only',
      decision: 'allow',
      include: [
        // Add admin email(s) here — replace with actual admin emails
        { email: { email: 'admin@grudge-studio.com' } },
        { service_token: {} },
      ],
      precedence: 2,
    });
  }

  if (DRY_RUN) {
    console.log(`      Policies: ${policies.map(p => p.name).join(', ')} (dry run)`);
    return;
  }

  for (const policy of policies) {
    const res = await cfRequest('POST', `/accounts/${CF_ACCOUNT}/access/apps/${appId}/policies`, policy);
    if (res.body.success) {
      console.log(`      ✓ Policy: "${policy.name}"`);
    } else {
      console.error(`      ❌ Policy failed:`, JSON.stringify(res.body.errors));
    }
  }
}

// ── Create ACME bypass for Vercel domains ─────────────────────────────────────

async function createAcmeBypass(domain, existingApps) {
  const bypassDomain = `${domain}/.well-known/acme-challenge/*`;
  const existing = existingApps.find(a => a.domain === bypassDomain);
  if (existing) {
    console.log(`    ✓ ACME bypass already exists for ${domain}`);
    return;
  }

  if (DRY_RUN) {
    console.log(`    + Would create ACME bypass for ${domain}`);
    return;
  }

  // Create the bypass app
  const appRes = await cfRequest('POST', `/accounts/${CF_ACCOUNT}/access/apps`, {
    name: `ACME Bypass — ${domain}`,
    domain: bypassDomain,
    type: 'self_hosted',
    session_duration: '1m',
  });

  if (!appRes.body.success) {
    console.error(`    ❌ ACME bypass create failed for ${domain}:`, JSON.stringify(appRes.body.errors));
    return;
  }

  const bypassAppId = appRes.body.result.id;

  // Attach a Bypass policy with "Everyone"
  const policyRes = await cfRequest('POST', `/accounts/${CF_ACCOUNT}/access/apps/${bypassAppId}/policies`, {
    name: 'ACME Challenge — Bypass Everyone',
    decision: 'bypass',
    include: [{ everyone: {} }],
    precedence: 1,
  });

  if (policyRes.body.success) {
    console.log(`    + Created ACME bypass for ${domain}`);
  } else {
    console.error(`    ❌ ACME bypass policy failed:`, JSON.stringify(policyRes.body.errors));
  }
}

// ── Create shared service token ───────────────────────────────────────────────

async function createServiceToken() {
  if (DRY_RUN) {
    console.log('  + Would create service token: Grudge Vercel Services');
    return null;
  }

  const res = await cfRequest('POST', `/accounts/${CF_ACCOUNT}/access/service_tokens`, {
    name: 'Grudge Vercel Services',
    duration: '8760h', // 1 year
  });

  if (!res.body.success) {
    console.error('  ❌ Service token creation failed:', JSON.stringify(res.body.errors));
    return null;
  }

  const token = res.body.result;
  console.log('\n  ✅  Service token created!');
  console.log('  ⚠️   SAVE THESE — the secret is shown only once:\n');
  console.log(`  CF_ACCESS_CLIENT_ID     = ${token.client_id}`);
  console.log(`  CF_ACCESS_CLIENT_SECRET = ${token.client_secret}`);
  console.log('\n  Add these to your Vercel projects and VPS .env files.');
  console.log('  Vercel sync: VERCEL_TOKEN=xxx node scripts/sync-vercel-env.js');
  console.log('  (Add to SHARED_VARS in sync-vercel-env.js if you want auto-sync)\n');
  return token;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔐  Grudge Studio — Cloudflare Access Setup');
  console.log(`    Account: ${CF_ACCOUNT}`);
  console.log(`    Services: ${VPS_SERVICES.length}`);
  console.log(`    Mode: ${DRY_RUN ? '🟡 DRY RUN (no writes)' : '🟢 LIVE'}\n`);

  console.log('📋  Fetching existing Access apps…');
  let existingApps = [];
  try {
    existingApps = await listAccessApps();
    console.log(`    Found ${existingApps.length} existing apps.\n`);
  } catch (err) {
    console.error('    ❌ Could not fetch apps:', err.message);
    process.exit(1);
  }

  // Step 1: Create/update Access apps for VPS services
  console.log('🔒  Setting up VPS service Access applications…');
  const createdApps = [];
  for (const service of VPS_SERVICES) {
    console.log(`\n  📦 ${service.name} — ${service.domain}`);
    const app = await upsertAccessApp(service, existingApps);
    if (app) {
      await createPolicy(app.id, service);
      createdApps.push({ service, appId: app.id, aud: app.aud });
    }
  }

  // Step 2: ACME bypass rules for proxied Vercel domains
  console.log('\n🔓  Creating ACME bypass rules for Vercel-proxied domains…');
  for (const domain of VERCEL_PROXIED_DOMAINS) {
    await createAcmeBypass(domain, existingApps);
  }

  // Step 3: Service token for Vercel → VPS M2M auth
  console.log('\n🤖  Creating shared service token for Vercel → VPS machine auth…');
  await createServiceToken();

  // Step 4: Print AUD tags
  console.log('\n📋  Application Audience (AUD) tags for VPS .env files:');
  console.log('    Add these to each service .env as CF_ACCESS_AUD\n');
  for (const { service, aud } of createdApps) {
    console.log(`  CF_ACCESS_AUD_${service.name.replace(/\s+/g, '_').toUpperCase()} = ${aud}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('✅  Cloudflare Access setup complete.\n');
  console.log('Next steps:');
  console.log('  1. Set CF_TEAM_DOMAIN and CF_ACCESS_AUD in each VPS service .env');
  console.log('  2. Set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET in Vercel');
  console.log('  3. Add the service token as an "Allow" policy in each Access app');
  console.log('  4. Configure your IdP (Google/Discord) in Cloudflare One dashboard');
  console.log('  5. Verify DNS: VPS subdomains must be orange-cloud (proxied)\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
