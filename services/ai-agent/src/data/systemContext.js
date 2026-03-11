// ─────────────────────────────────────────────────────────────
// GRUDGE STUDIO — AI Agent System Context
// Single source of truth for all service endpoints, CDN URLs,
// and integration points used by the AI agent service.
// Updated: 2026 — v4.0.0 stack
// ─────────────────────────────────────────────────────────────

const SYSTEM_CONTEXT = {
  version: '4.0.0',

  // ── Public service endpoints ──────────────────────────────
  services: {
    identity:  process.env.GRUDGE_IDENTITY_API  || 'https://id.grudgestudio.com',
    gameApi:   process.env.GRUDGE_GAME_API      || 'https://api.grudgestudio.com',
    accountApi:process.env.GRUDGE_ACCOUNT_API   || 'https://account.grudgestudio.com',
    launcher:  process.env.GRUDGE_LAUNCHER_API  || 'https://launcher.grudgestudio.com',
    websocket: process.env.GRUDGE_WS_API        || 'wss://ws.grudgestudio.com',
  },

  // ── Cloudflare R2 CDN ─────────────────────────────────────
  cdn: {
    baseUrl:    process.env.GRUDGE_CDN_URL         || process.env.OBJECT_STORAGE_PUBLIC_URL || 'https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev',
    assetsUrl:  process.env.GRUDGE_ASSETS_URL      || 'https://assets.grudgestudio.com',
    bucket:     'grudge-assets',
    region:     'auto',
    // Asset path conventions
    paths: {
      avatars:   'avatars/{grudge_id}/{filename}',
      gameBundles:'bundles/{version}/{platform}/{filename}',
      items:     'items/{category}/{item_id}.png',
      sprites:   'sprites/{category}/{sprite_id}.png',
    },
  },

  // ── Auth endpoints ────────────────────────────────────────
  auth: {
    base:         'https://id.grudgestudio.com',
    discord:      '/auth/discord',
    logout:       '/auth/logout',
    verify:       '/auth/verify',
    puterBridge:  '/auth/puter-bridge',  // Puter KV session → Grudge JWT
    walletAuth:   '/auth/wallet',         // Web3Auth + Turnstile protected
  },

  // ── Puter integration ─────────────────────────────────────
  puter: {
    // Worker deployed at Puter hosting (slugs)
    workerVersion: '4.0.0',
    workerEndpoints: {
      authBridge:    '/api/auth/grudge-bridge',
      purgeSessions: '/api/admin/purge-sessions',
      gameData:      '/api/data/game',
      spriteJob:     '/api/sprite/job',
    },
    kvKeys: {
      usersDb:    'grudge_users_db',         // legacy index (read-only migration)
      userPrefix: 'grudge_user_',            // grudge_user_{id} per-user keys
      sessionPrefix: 'grudge_session_',
    },
  },

  // ── AI agent internal routes ──────────────────────────────
  aiAgent: {
    port: 3004,
    requiresInternalKey: true,
    endpoints: {
      health:            'GET  /health',
      missionGenerate:   'POST /ai/mission/generate',
      companionAssign:   'POST /ai/companion/assign',
      companionProfiles: 'GET  /ai/companion/profiles/:class',
      factionIntel:      'GET  /ai/faction/:faction/intel',
      factionStandings:  'GET  /ai/faction/standings/all',
    },
  },

  // ── Game systems reference ────────────────────────────────
  gameSystems: {
    missionTypes:   ['harvesting', 'fighting', 'sailing', 'competing'],
    maxMissionsPerDay: 11,
    classes:        ['warrior', 'mage', 'ranger', 'worge'],
    factions:       ['pirate', 'undead', 'elven', 'orcish'],
    maxGouldstones: 15,

    // Key mechanic notes for AI context
    mechanics: {
      warrior:  'Stamina system — fills via parry/dodge/block. Double jump, AoE, group invincibility. Perfect parry = extra stamina.',
      mage:     'Teleport blocks (max 10 total per map). Staff/tome/wand/off-hand. Ranged control + healing.',
      ranger:   'RMB+LMB = parry attempt. Perfect parry = instant dash counter, enemy stunned 0.5s, 2s window.',
      worge:    '3 forms: Bear (tank/powerful), Raptor (invisible/rogue), Bird (flyable, mountable by players/AI).',
      gouldstone: 'Clones player with same stats/gear/professions. Up to 15 allies. From faction vendors or boss drops.',
      zKey:     'Dynamic combat mechanic — random chat bubble triggers, stacking buffs, flame stack UI, PvP interaction.',
      hotbar:   'Combat: slots 1-4 = skills, 5 = empty, 6-8 = consumables (food/potions/on-use relics).',
    },
  },

  // ── VPS / infrastructure ──────────────────────────────────
  infra: {
    vpsIp:    '74.208.155.229',
    coolifyPort: 8000,
    dockerServices: [
      { name: 'grudge-id',       port: 3001 },
      { name: 'wallet-service',  port: 3002 },
      { name: 'game-api',        port: 3003 },
      { name: 'ai-agent',        port: 3004 },
      { name: 'account-api',     port: 3005 },
      { name: 'launcher-api',    port: 3006 },
      { name: 'grudge-headless', port: 7777 },
    ],
  },
};

/**
 * Get CDN URL for an asset.
 * @param {string} category - 'avatars' | 'items' | 'sprites' | 'bundles'
 * @param {string} filename
 * @param {string} [subPath] - optional sub-path
 */
function getCdnUrl(category, filename, subPath = '') {
  const base = SYSTEM_CONTEXT.cdn.baseUrl.replace(/\/$/, '');
  const path = subPath ? `${category}/${subPath}/${filename}` : `${category}/${filename}`;
  return `${base}/${path}`;
}

/**
 * Get a fully-qualified service endpoint URL.
 * @param {string} service - key from SYSTEM_CONTEXT.services
 * @param {string} [path]
 */
function getServiceUrl(service, path = '') {
  const base = SYSTEM_CONTEXT.services[service] || '';
  return base + path;
}

module.exports = { SYSTEM_CONTEXT, getCdnUrl, getServiceUrl };
