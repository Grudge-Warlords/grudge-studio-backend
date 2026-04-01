/**
 * shared/objectStore.js ? Grudge ObjectStore CDN Integration
 *
 * Provides utilities for resolving asset URLs using the Grudge UUID system
 * and integrating with both the VPS asset-service and the static ObjectStore
 * at molochdagod.github.io/ObjectStore
 *
 * CDN priority order:
 *   1. GRUDGE_CDN_URL (Cloudflare R2 via assets.grudge-studio.com)
 *   2. GRUDGE_ASSETS_URL (fallback)
 *   3. ObjectStore GitHub Pages (static fallback)
 */

const OBJECTSTORE_BASE = process.env.OBJECTSTORE_BASE
  || 'https://molochdagod.github.io/ObjectStore';
const CDN_BASE = process.env.GRUDGE_CDN_URL
  || process.env.GRUDGE_ASSETS_URL
  || OBJECTSTORE_BASE;
const ASSET_SERVICE_URL = process.env.GRUDGE_ASSET_SERVICE_URL
  || 'https://assets-api.grudge-studio.com';

// Category ? ObjectStore path mapping
const CATEGORY_PATHS = {
  weapon: 'weapons',
  weapons: 'weapons',
  armor: 'armor',
  sprite: 'sprites',
  sprites: 'sprites',
  icon: 'icons',
  icons: 'icons',
  texture: 'textures',
  model: 'models',
  models: 'models',
  audio: 'audio',
  ui: 'ui',
  avatar: 'avatars',
};

/**
 * Build a CDN URL for an asset using its Grudge UUID.
 * @param {string} grudgeId - e.g. 'ASST-20260319142500-000001-A1B2C3D4'
 * @param {string} category - asset category (weapon, sprite, etc.)
 * @param {string} ext - file extension without dot (png, glb, mp3)
 * @returns {string} Full CDN URL
 */
function resolveAssetUrl(grudgeId, category, ext) {
  const cat = CATEGORY_PATHS[category?.toLowerCase()] || category || 'other';
  const filename = `${grudgeId}.${ext}`;
  return `${CDN_BASE}/${cat}/${filename}`;
}

/**
 * Build an ObjectStore static URL for a known item key.
 * Item keys follow the ObjectStore naming convention (e.g. 'sword_of_wrath').
 * @param {string} itemKey - ObjectStore item identifier
 * @param {string} [assetType] - 'sprites'|'weapons'|'armor'|'icons'
 * @param {string} [ext] - file extension (default: 'png')
 * @returns {string} ObjectStore CDN URL
 */
function objectStoreUrl(itemKey, assetType = 'sprites', ext = 'png') {
  return `${OBJECTSTORE_BASE}/${assetType}/${itemKey}.${ext}`;
}

/**
 * Build a Grudge asset service URL for uploading/fetching via asset-service API.
 * @param {string} grudgeId - Grudge UUID for the asset
 * @returns {string} Asset service endpoint URL
 */
function assetServiceUrl(grudgeId) {
  return `${ASSET_SERVICE_URL}/assets/${grudgeId}`;
}

/**
 * Determine the category from a MIME type.
 */
function categoryFromMime(mime = '') {
  const m = mime.toLowerCase();
  if (m.includes('model') || m.endsWith('.glb') || m.endsWith('.gltf')) return 'model';
  if (m.startsWith('image/') || m.includes('png') || m.includes('jpg') || m.includes('webp')) return 'sprite';
  if (m.startsWith('audio/') || m.includes('mp3') || m.includes('ogg') || m.includes('wav')) return 'audio';
  if (m.includes('json') || m.includes('config')) return 'config';
  return 'other';
}

/**
 * Determine file extension from a MIME type.
 */
function extFromMime(mime = '') {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
    'application/json': 'json', 'text/plain': 'txt',
    'application/octet-stream': 'bin', 'application/zip': 'zip',
  };
  return map[mime.toLowerCase()] || mime.split('/').pop()?.split(';')[0] || 'bin';
}

/**
 * Build the storage key (path) for an asset in the CDN bucket.
 * Format: {category}/{grudge-uuid}.{ext}
 */
function storageKey(grudgeId, category, ext) {
  const cat = CATEGORY_PATHS[category?.toLowerCase()] || category || 'other';
  return `${cat}/${grudgeId}.${ext}`;
}

module.exports = {
  OBJECTSTORE_BASE,
  CDN_BASE,
  ASSET_SERVICE_URL,
  CATEGORY_PATHS,
  resolveAssetUrl,
  objectStoreUrl,
  assetServiceUrl,
  categoryFromMime,
  extFromMime,
  storageKey,
};
