/**
 * Puter Cloud storage helpers.
 * Replaces S3/R2 with Puter FS for file storage + Puter Hosting for public URLs.
 * Also supports Puter KV for lightweight metadata caching.
 */
const { createHash } = require('crypto');

// ── Puter SDK singleton ───────────────────────────────────────────
let _puter;
async function getPuter() {
  if (!_puter) {
    const { init } = require('@heyputer/puter.js/src/init.cjs');
    _puter = init(process.env.PUTER_AUTH_TOKEN);
  }
  return _puter;
}

const BASE_PATH = () => process.env.PUTER_BASE_PATH || '/grudge';

// Full Puter path for a given storage key (e.g. "model/uuid.glb")
function puterPath(key) {
  return `${BASE_PATH()}/assets/${key}`;
}

// ── Write file to Puter FS ────────────────────────────────────────
// Used for direct server-side uploads (replaces presigned PUT).
// Returns the FSItem with .path and .uid.
async function writeObject(key, buffer, _contentType) {
  const puter = await getPuter();
  const blob = new Blob([buffer]);
  return puter.fs.write(puterPath(key), blob, { createMissingParents: true });
}

// ── Presigned upload URL (Puter-compatible shim) ──────────────────
// Puter doesn't use presigned URLs — the asset-service handles the
// upload directly via writeObject(). This returns a "direct://" stub
// that tells the route handler to accept the file body and call
// writeObject() instead of redirecting to an external URL.
async function presignUpload(key, contentType, _expiresIn = 3600) {
  // Return a direct-upload sentinel; the route handler will intercept this.
  return `direct://${key}`;
}

// ── Download / read ───────────────────────────────────────────────
async function presignDownload(key, _expiresIn = 3600) {
  // Return the public URL (Puter files can be read via getReadURL)
  return resolveUrl(key);
}

// ── Head (check existence + size) ─────────────────────────────────
async function headObject(key) {
  try {
    const puter = await getPuter();
    const info = await puter.fs.stat(puterPath(key));
    return {
      ContentLength: info.size || 0,
      LastModified: info.modified || info.created,
      exists: true,
    };
  } catch (err) {
    // File doesn't exist yet
    return null;
  }
}

// ── Delete ────────────────────────────────────────────────────────
async function deleteObject(key) {
  const puter = await getPuter();
  return puter.fs.delete(puterPath(key));
}

// ── Resolve public URL ────────────────────────────────────────────
// Uses puter.fs.getReadURL() to produce a readable URL for the asset.
async function resolveUrl(key) {
  try {
    const puter = await getPuter();
    const url = await puter.fs.getReadURL(puterPath(key));
    return url;
  } catch {
    // Fallback: construct a conventional path
    return `https://puter.site/assets/${key}`;
  }
}

// ── Get public URL (sync best-effort) ─────────────────────────────
function getPublicUrl(key) {
  // Sync version can only return a placeholder; callers should prefer resolveUrl
  return `puter://${BASE_PATH()}/assets/${key}`;
}

// ── SHA-256 of a buffer ───────────────────────────────────────────
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  getPuter,
  writeObject,
  presignUpload,
  presignDownload,
  resolveUrl,
  headObject,
  deleteObject,
  getPublicUrl,
  sha256,
};
