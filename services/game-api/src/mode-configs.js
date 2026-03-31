/**
 * GRUDGE STUDIO — PvP Game Mode Registry
 *
 * Centralised configuration for every PvP game type.
 * Used by pvp.js routes, ws-service relay, and headless server allocation.
 *
 * Adding a new game mode:
 *   1. Add an entry here.
 *   2. If it needs a dedicated server (authoritative physics/hit-detection),
 *      set `serverType: 'dedicated'`. Otherwise `serverType: 'relay'` uses
 *      Socket.IO action forwarding only.
 *   3. Restart game-api + ws-service.
 */

const GAME_MODES = {
  // ── Core PvP modes (existing) ────────────────────────────────
  duel: {
    label: 'Duel',
    description: '1v1 ranked combat',
    minPlayers: 2,
    maxPlayers: 2,
    teams: 2,           // 0 = FFA
    serverType: 'relay', // relay = Socket.IO forwarding, dedicated = headless server
    tickRateHz: 20,      // server state updates per second (dedicated only)
    timeoutSec: 300,     // auto-forfeit after 5 minutes of no actions
    matchTimeLimitSec: 600, // hard match time limit
    respawns: false,
    allowedActions: ['attack', 'parry', 'dodge', 'z_key', 'ability', 'worge_form', 'hit', 'death', 'position', 'block', 'counter'],
    eloEnabled: true,
    eloK: 32,
    defaultIsland: 'spawn',
    queueEnabled: true,
    queueEloRange: 150,
  },

  crew_battle: {
    label: 'Crew Battle',
    description: 'Team-based crew warfare (up to 5v5)',
    minPlayers: 4,
    maxPlayers: 10,
    teams: 2,
    serverType: 'dedicated', // needs authoritative server for team state
    tickRateHz: 20,
    timeoutSec: 600,
    matchTimeLimitSec: 1200,
    respawns: false,
    allowedActions: ['attack', 'parry', 'dodge', 'z_key', 'ability', 'worge_form', 'hit', 'death', 'position', 'block', 'counter'],
    eloEnabled: true,
    eloK: 32,
    defaultIsland: 'spawn',
    queueEnabled: true,
    queueEloRange: 200,
  },

  arena_ffa: {
    label: 'Arena FFA',
    description: 'Free-for-all deathmatch (up to 16 players)',
    minPlayers: 3,
    maxPlayers: 16,
    teams: 0,
    serverType: 'dedicated',
    tickRateHz: 20,
    timeoutSec: 600,
    matchTimeLimitSec: 900,
    respawns: true,
    allowedActions: ['attack', 'parry', 'dodge', 'z_key', 'ability', 'worge_form', 'hit', 'death', 'position', 'block', 'counter', 'respawn'],
    eloEnabled: true,
    eloK: 24,
    defaultIsland: 'spawn',
    queueEnabled: true,
    queueEloRange: 250,
  },

  // ── Web-based PvP game modes ─────────────────────────────────
  // These run entirely through Socket.IO relay — no Unity headless needed.
  // Clients are authoritative; server validates actions + records results.

  nemesis: {
    label: 'Nemesis',
    description: '1v1 strategic card/ability combat',
    minPlayers: 2,
    maxPlayers: 2,
    teams: 2,
    serverType: 'relay',
    tickRateHz: 10,
    timeoutSec: 120,        // 2 min turn timeout
    matchTimeLimitSec: 900,  // 15 min max match
    respawns: false,
    allowedActions: ['play_card', 'use_ability', 'end_turn', 'concede', 'emote', 'position'],
    eloEnabled: true,
    eloK: 32,
    defaultIsland: 'nemesis_arena',
    queueEnabled: true,
    queueEloRange: 200,
  },

  rpg_fighter: {
    label: '2D RPG Fighter',
    description: '2D side-scrolling PvP combat',
    minPlayers: 2,
    maxPlayers: 4,
    teams: 0,          // FFA or 2v2 depending on player count
    serverType: 'relay',
    tickRateHz: 30,     // higher tick for fighting game responsiveness
    timeoutSec: 60,
    matchTimeLimitSec: 300,
    respawns: true,
    allowedActions: ['attack', 'heavy_attack', 'block', 'dodge', 'jump', 'special', 'combo', 'grab', 'position', 'hit', 'death', 'respawn', 'emote'],
    eloEnabled: true,
    eloK: 24,
    defaultIsland: 'fighter_ring',
    queueEnabled: true,
    queueEloRange: 200,
  },

  thc_battle: {
    label: 'THC Battle',
    description: 'Turn-based herb cultivation battle',
    minPlayers: 2,
    maxPlayers: 2,
    teams: 2,
    serverType: 'relay',
    tickRateHz: 5,      // low tick — turn-based
    timeoutSec: 90,     // 90s per turn
    matchTimeLimitSec: 1800,
    respawns: false,
    allowedActions: ['plant', 'harvest', 'use_item', 'attack', 'defend', 'end_turn', 'concede', 'emote'],
    eloEnabled: false,   // casual mode — no ELO
    eloK: 0,
    defaultIsland: 'thc_garden',
    queueEnabled: true,
    queueEloRange: 9999, // match anyone
  },
};

// ── Exports ─────────────────────────────────────────────────────

/** All valid mode keys */
const VALID_MODES = Object.keys(GAME_MODES);

/** Max players lookup (backward-compatible with existing code) */
const MODE_MAX_PLAYERS = {};
for (const [k, v] of Object.entries(GAME_MODES)) {
  MODE_MAX_PLAYERS[k] = v.maxPlayers;
}

/** Get full config for a mode. Returns null if mode doesn't exist. */
function getModeConfig(mode) {
  return GAME_MODES[mode] || null;
}

/** Validate an action type against a mode's allowed actions. */
function isValidAction(mode, actionType) {
  const cfg = GAME_MODES[mode];
  if (!cfg) return false;
  return cfg.allowedActions.includes(actionType);
}

/** Whether a mode requires a dedicated headless server. */
function requiresDedicatedServer(mode) {
  const cfg = GAME_MODES[mode];
  return cfg?.serverType === 'dedicated';
}

/** Modes that have ELO matchmaking queues. */
const QUEUE_MODES = VALID_MODES.filter(m => GAME_MODES[m].queueEnabled);

module.exports = {
  GAME_MODES,
  VALID_MODES,
  MODE_MAX_PLAYERS,
  QUEUE_MODES,
  getModeConfig,
  isValidAction,
  requiresDedicatedServer,
};
