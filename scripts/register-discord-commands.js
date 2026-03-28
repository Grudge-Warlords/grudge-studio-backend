#!/usr/bin/env node
/**
 * register-discord-commands.js
 *
 * Registers Grudge Studio slash commands with Discord.
 * Run once after setup, or whenever commands change.
 *
 * Usage:
 *   node scripts/register-discord-commands.js
 *   node scripts/register-discord-commands.js --guild <GUILD_ID>  (guild-only, instant)
 *   node scripts/register-discord-commands.js --app game          (GrudgeWars app only)
 *
 * Env vars (from .env):
 *   DISCORD_BOT_TOKEN       — Main Grudge Studio bot token
 *   DISCORD_CLIENT_ID       — App ID: 1342593452793270302 (Grudge Studio)
 *   DISCORD_BOT_TOKEN_GAME  — GrudgeWars bot token
 *   DISCORD_CLIENT_ID_GAME  — App ID: 1471046591220678677 (GrudgeWars)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

// ── Slash command definitions ─────────────────────────────────────────────────

const COMMANDS = [
  {
    name: 'profile',
    description: '🛡️ View your Grudge Warlords profile, Grudge ID, and gold balance',
    options: [],
  },
  {
    name: 'wallet',
    description: '💰 Check your GBUX balance and server-side Solana wallet address',
    options: [],
  },
  {
    name: 'arena',
    description: '⚔️ View the top 5 arena leaderboard — who reigns supreme?',
    options: [],
  },
  {
    name: 'character',
    description: '🗡️ List your Grudge Warlords characters',
    options: [],
  },
  {
    name: 'link',
    description: '🔗 Get a link to connect your Discord to your Grudge account',
    options: [],
  },
];

// ── App configurations ────────────────────────────────────────────────────────

const APPS = {
  studio: {
    name: 'Grudge Studio (id: 1342593452793270302)',
    clientId: process.env.DISCORD_CLIENT_ID || '1342593452793270302',
    token: process.env.DISCORD_BOT_TOKEN,
  },
  game: {
    name: 'GrudgeWars (id: 1471046591220678677)',
    clientId: process.env.DISCORD_CLIENT_ID_GAME || '1471046591220678677',
    token: process.env.DISCORD_BOT_TOKEN_GAME,
  },
};

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const guildFlag = args.indexOf('--guild');
const guildId   = guildFlag !== -1 ? args[guildFlag + 1] : null;
const appFlag   = args.indexOf('--app');
const appFilter = appFlag !== -1 ? args[appFlag + 1] : null;

// ── Discord API helper ────────────────────────────────────────────────────────

function discordRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10${path}`,
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function registerCommands(app, guildId) {
  if (!app.token) {
    console.log(`  ⚠  Skipping ${app.name} — no bot token`);
    return;
  }

  const path = guildId
    ? `/applications/${app.clientId}/guilds/${guildId}/commands`
    : `/applications/${app.clientId}/commands`;

  const scope = guildId ? `guild ${guildId}` : 'global (1h delay)';
  console.log(`\n  Registering ${COMMANDS.length} commands for ${app.name} — ${scope}`);

  const res = await discordRequest('PUT', path, COMMANDS, app.token);

  if (res.status >= 200 && res.status < 300) {
    const registered = Array.isArray(res.body) ? res.body : [];
    console.log(`  ✓ ${registered.length} commands registered:`);
    registered.forEach(c => console.log(`    /${c.name} — ${c.description.slice(0, 60)}`));
  } else {
    console.error(`  ✗ Failed (HTTP ${res.status}):`, JSON.stringify(res.body, null, 2));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n⚔️  Grudge Studio — Discord Slash Command Registration');
  console.log(`   Commands: ${COMMANDS.map(c => '/' + c.name).join(', ')}`);
  console.log(`   Scope: ${guildId ? `Guild ${guildId} (instant)` : 'Global (up to 1 hour to propagate)'}`);

  const toRegister = appFilter
    ? [APPS[appFilter]].filter(Boolean)
    : Object.values(APPS);

  if (!toRegister.length) {
    console.error(`Unknown --app value: ${appFilter}. Use 'studio' or 'game'.`);
    process.exit(1);
  }

  for (const app of toRegister) {
    await registerCommands(app, guildId);
  }

  console.log('\n✅ Done.\n');
  console.log('Next steps:');
  console.log('  1. In Discord Developer Portal → your app → General Information:');
  console.log('     Set Interactions Endpoint URL:');
  console.log('     → https://api.grudge-studio.com/api/discord/interactions');
  console.log('  2. Set Terms of Service URL:');
  console.log('     → https://id.grudge-studio.com/tos');
  console.log('  3. Set Privacy Policy URL:');
  console.log('     → https://id.grudge-studio.com/privacy');
  console.log('  4. Make sure DISCORD_PUBLIC_KEY is set in game-api env:');
  console.log('     → 0143abd7607575e363bf3e526fe6cabdd4fba152640d9efad3425699910ee96b');
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
