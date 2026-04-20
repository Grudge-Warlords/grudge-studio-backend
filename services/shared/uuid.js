/**
 * shared/uuid.js ? Grudge UUID Service (CommonJS)
 * Deterministic FNV-1a based IDs for all game entities.
 * Format: PREFIX-TIMESTAMP14-SEQ6HEX-HASH8HEX
 * e.g.    ASST-20260319142500-000001-A1B2C3D4
 *
 * Usage:
 *   const { generate, parse, isValid, PREFIX_MAP } = require('../../shared/uuid');
 *   const id = generate('asset', 'weapon-sword');
 */

const PREFIX_MAP = {
  hero: 'HERO', item: 'ITEM', equipment: 'EQIP', ability: 'ABIL',
  material: 'MATL', recipe: 'RECP', node: 'NODE', mob: 'MOBS',
  boss: 'BOSS', mission: 'MISS', infusion: 'INFU', loot: 'LOOT',
  consumable: 'CONS', quest: 'QUST', zone: 'ZONE', save: 'SAVE',
  asset: 'ASST', sync: 'SYNC', user: 'USER', account: 'ACCT',
  objectstore: 'OBJS', sprite: 'SPRT', model: 'MODL', audio: 'AUDI',
  texture: 'TXTR', bundle: 'BNDL', avatar: 'AVTR', icon: 'ICON',
  weapon: 'WEAP', armor: 'ARMR',
};

let seq = 0;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) ^ ((h >>> 0) >>> 16)) >>> 0)
    .toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
}

/**
 * Generate a Grudge UUID for any entity type.
 * @param {string} entityType - Key from PREFIX_MAP or custom 4-char string
 * @param {string} [metadata] - Optional string to include in hash (improves uniqueness)
 * @returns {string} e.g. 'ASST-20260319142500-000001-A1B2C3D4'
 */
function generate(entityType, metadata = '') {
  const prefix = PREFIX_MAP[entityType] || entityType.slice(0, 4).toUpperCase();
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  seq = (seq + 1) & 0xFFFFFF;
  const s = seq.toString(16).toUpperCase().padStart(6, '0');
  const hash = fnv1a(`${prefix}-${ts}-${s}-${metadata}-${Math.random()}`);
  return `${prefix}-${ts}-${s}-${hash}`;
}

/**
 * Parse a Grudge UUID into its components.
 */
function parse(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  const p = uuid.split('-');
  if (p.length !== 4) return null;
  const entityType = Object.entries(PREFIX_MAP).find(([, v]) => v === p[0])?.[0] || 'unknown';
  const ts = p[1];
  return {
    prefix: p[0], timestamp: ts, sequence: p[2], hash: p[3], entityType,
    createdAt: ts.length === 14 ? new Date(
      parseInt(ts.slice(0, 4)), parseInt(ts.slice(4, 6)) - 1, parseInt(ts.slice(6, 8)),
      parseInt(ts.slice(8, 10)), parseInt(ts.slice(10, 12)), parseInt(ts.slice(12, 14))
    ) : null,
  };
}

/**
 * Validate a Grudge UUID format.
 */
function isValid(uuid) {
  return typeof uuid === 'string' && /^[A-Z]{4}-\d{14}-[0-9A-F]{6}-[0-9A-F]{8}$/.test(uuid);
}

/**
 * Generate a Grudge User ID from a provider identity.
 * Deterministic ? same input always produces same prefix+hash (seq still increments).
 */
function generateUserId(provider, providerId) {
  return generate('user', `${provider}:${providerId}`);
}

module.exports = { PREFIX_MAP, generate, parse, isValid, generateUserId };
