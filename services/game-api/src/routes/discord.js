/**
 * Discord Interactions Webhook
 *
 * Handles Discord slash command interactions for Grudge Studio.
 * Set this URL in your Discord app: Interactions Endpoint URL
 *   → https://api.grudge-studio.com/api/discord/interactions
 *
 * Slash commands:
 *   /profile   — View your Grudge ID, level, and character count
 *   /wallet    — Check your GBUX and SOL balances
 *   /arena     — View arena leaderboard (top 5)
 *   /character — List your characters
 *   /link      — Get a link to connect your Grudge account
 *
 * Env vars required:
 *   DISCORD_PUBLIC_KEY   — from Discord Developer Portal → App → General Information
 *   DISCORD_BOT_TOKEN    — Bot token for sending followup messages
 *   JWT_SECRET           — to verify grudge_auth_token in interactions
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN  || '';
const GAME_API_URL       = process.env.GAME_API_URL       || 'http://localhost:3003';

// ── Interaction types ─────────────────────────────────────────────────────────
const INTERACTION_TYPE = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 };
const INTERACTION_RESPONSE_TYPE = {
  PONG:                   1,
  CHANNEL_MESSAGE:        4,
  DEFERRED_CHANNEL:       5,
  DEFERRED_UPDATE:        6,
};

// ── Ed25519 signature verification ────────────────────────────────────────────
// Discord requires all interaction endpoints to verify the X-Signature-Ed25519 header
async function verifyDiscordRequest(req) {
  if (!DISCORD_PUBLIC_KEY) {
    console.warn('[discord] DISCORD_PUBLIC_KEY not set — skipping verification');
    return true; // dev mode
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const body      = req.rawBody || JSON.stringify(req.body);

  if (!signature || !timestamp) return false;

  try {
    const publicKey  = Buffer.from(DISCORD_PUBLIC_KEY, 'hex');
    const sig        = Buffer.from(signature, 'hex');
    const msg        = Buffer.from(timestamp + body);

    // Node 18+ WebCrypto
    const key = await crypto.subtle.importKey(
      'raw', publicKey, { name: 'Ed25519' }, false, ['verify']
    );
    return await crypto.subtle.verify('Ed25519', key, sig, msg);
  } catch (e) {
    console.error('[discord] sig verify error:', e.message);
    return false;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getUserByDiscordId(discordId) {
  try {
    const { getDB } = require('../db');
    const db = getDB();
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE discord_id = ? LIMIT 1', [discordId]
    );
    return rows[0] || null;
  } catch { return null; }
}

async function getArenaTop(limit = 5) {
  try {
    const { getDB } = require('../db');
    const db = getDB();
    const [rows] = await db.execute(
      'SELECT owner_name, wins, losses, avg_level FROM arena_teams ORDER BY wins DESC, losses ASC LIMIT ?',
      [limit]
    );
    return rows;
  } catch { return []; }
}

async function getCharacters(userId) {
  try {
    const { getDB } = require('../db');
    const db = getDB();
    const [rows] = await db.execute(
      'SELECT name, race_id, class_id, level FROM characters WHERE account_id = ? ORDER BY level DESC LIMIT 5',
      [userId]
    );
    return rows;
  } catch { return []; }
}

// ── Embed builders ────────────────────────────────────────────────────────────
const GRUDGE_COLOR = 0xDB6331; // orange

function embedProfile(user) {
  return {
    color: GRUDGE_COLOR,
    title: `🛡️ ${user.username || 'Warlord'}`,
    description: `**Grudge ID:** \`${(user.grudge_id || '').slice(0, 8).toUpperCase()}...\``,
    fields: [
      { name: 'Gold', value: `${(user.gold || 0).toLocaleString()} 🪙`, inline: true },
      { name: 'GBUX', value: `${(user.gbux_balance || 0).toFixed(2)} GBUX`, inline: true },
      { name: 'Server Wallet', value: user.server_wallet_address
          ? `\`${user.server_wallet_address.slice(0, 12)}...\``
          : '_Not created_', inline: false },
    ],
    footer: { text: 'Grudge Warlords · grudgewarlords.com' },
  };
}

function embedWallet(user) {
  return {
    color: 0x9945FF,
    title: '💰 Wallet',
    fields: [
      { name: 'GBUX Balance', value: `${(user.gbux_balance || 0).toFixed(4)} GBUX`, inline: true },
      { name: 'Gold', value: `${(user.gold || 0).toLocaleString()} 🪙`, inline: true },
      { name: 'Server Wallet (Solana)', value: user.server_wallet_address
          ? `\`${user.server_wallet_address}\``
          : '_Auto-created on first login_', inline: false },
      { name: 'GBUX Token', value: '`55TpSoMNxbfsNJ9U1dQoo9H3dRtDmjBZVMcKqvU2nray`', inline: false },
    ],
    footer: { text: 'Grudge Studio · Solana Mainnet' },
  };
}

function embedArena(rows) {
  const table = rows.length
    ? rows.map((r, i) =>
        `**${i + 1}.** ${r.owner_name || 'Unknown'} — ${r.wins}W/${r.losses}L (Avg Lv${r.avg_level || 1})`
      ).join('\n')
    : '_No ranked teams yet_';
  return {
    color: 0xF59E0B,
    title: '⚔️ Arena Leaderboard',
    description: table,
    footer: { text: 'Grudge Warlords Arena' },
  };
}

function embedCharacters(chars) {
  const list = chars.length
    ? chars.map(c => `**${c.name}** — Lv${c.level} ${c.race_id} ${c.class_id}`).join('\n')
    : '_No characters yet — create one at grudgewarlords.com_';
  return {
    color: GRUDGE_COLOR,
    title: '🗡️ Your Characters',
    description: list,
    footer: { text: 'Grudge Warlords' },
  };
}

function embedNotLinked() {
  return {
    color: 0xef4444,
    title: '🔗 Account Not Linked',
    description: 'Your Discord is not linked to a Grudge account yet.',
    fields: [{
      name: 'How to link',
      value: `1. Visit **[grudgewarlords.com](https://grudgewarlords.com)**\n2. Log in with Grudge ID\n3. Your Discord will auto-link next time you use \`/auth/discord\`\n\nOr use the link button below:`,
    }],
    footer: { text: 'Grudge Studio · id.grudge-studio.com' },
  };
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleProfile(interaction) {
  const discordId = interaction.member?.user?.id || interaction.user?.id;
  const user      = await getUserByDiscordId(discordId);

  if (!user) {
    return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
      embeds: [embedNotLinked()],
      components: [{
        type: 1, components: [{
          type: 2, style: 5, label: 'Connect Grudge Account',
          url: `https://id.grudge-studio.com/auth/discord/start?return=${encodeURIComponent('https://grudgewarlords.com')}`,
        }],
      }],
      flags: 64, // ephemeral
    }};
  }

  const chars = await getCharacters(user.id);
  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [embedProfile(user)],
    fields: chars.length ? [{
      name: `Characters (${chars.length})`,
      value: chars.map(c => `${c.name} Lv${c.level}`).join(', '),
    }] : [],
    flags: 64,
  }};
}

async function handleWallet(interaction) {
  const discordId = interaction.member?.user?.id || interaction.user?.id;
  const user      = await getUserByDiscordId(discordId);

  if (!user) return notLinkedResponse();

  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [embedWallet(user)],
    flags: 64,
  }};
}

async function handleArena() {
  const rows = await getArenaTop(5);
  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [embedArena(rows)],
  }};
}

async function handleCharacter(interaction) {
  const discordId = interaction.member?.user?.id || interaction.user?.id;
  const user      = await getUserByDiscordId(discordId);

  if (!user) return notLinkedResponse();

  const chars = await getCharacters(user.id);
  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [embedCharacters(chars)],
    flags: 64,
  }};
}

function handleLink() {
  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [{
      color: GRUDGE_COLOR,
      title: '🔗 Link Your Grudge Account',
      description: 'Connect your Discord to your Grudge ID to use all slash commands.',
      fields: [{
        name: 'Steps',
        value: '1. Click the button below\n2. Log in with Discord\n3. Your accounts are linked!',
      }],
      footer: { text: 'Grudge Studio' },
    }],
    components: [{
      type: 1, components: [{
        type: 2, style: 5, label: '🛡️ Connect Grudge ID',
        url: `https://id.grudge-studio.com/auth/discord/start?return=${encodeURIComponent('https://grudgewarlords.com')}`,
      }],
    }],
    flags: 64,
  }};
}

function notLinkedResponse() {
  return { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
    embeds: [embedNotLinked()],
    flags: 64,
  }};
}

// ── Main interaction router ───────────────────────────────────────────────────

router.post('/interactions',
  // Capture raw body BEFORE express.json() parses it (needed for sig verification)
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // Re-parse body if needed
      let body = req.body;
      if (Buffer.isBuffer(body)) {
        req.rawBody = body.toString('utf-8');
        body = JSON.parse(req.rawBody);
      } else {
        req.rawBody = JSON.stringify(body);
      }

      // Verify signature
      const valid = await verifyDiscordRequest(req);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Respond to ping (Discord verification handshake)
      if (body.type === INTERACTION_TYPE.PING) {
        return res.json({ type: INTERACTION_RESPONSE_TYPE.PONG });
      }

      // Handle slash commands
      if (body.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
        const { name } = body.data;
        let response;

        switch (name) {
          case 'profile':   response = await handleProfile(body);   break;
          case 'wallet':    response = await handleWallet(body);    break;
          case 'arena':     response = await handleArena();         break;
          case 'character': response = await handleCharacter(body); break;
          case 'link':      response = handleLink();                break;
          default:
            response = { type: INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE, data: {
              content: `Unknown command: \`/${name}\``, flags: 64,
            }};
        }

        return res.json(response);
      }

      res.json({ type: INTERACTION_RESPONSE_TYPE.PONG });
    } catch (err) {
      console.error('[discord/interactions]', err.message);
      res.status(500).json({ error: 'Internal error' });
    }
  }
);

module.exports = router;
