/**
 * S3-compatible storage helpers (Cloudflare R2, AWS S3, MinIO, etc.)
 * Provides presigned uploads/downloads, head, delete, and public URL resolution.
 */
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createHash } = require('crypto');

// ── Client singleton ──────────────────────────────────────────────
let _client;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: process.env.OBJECT_STORAGE_REGION || 'auto',
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_KEY,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

const bucket = () => process.env.OBJECT_STORAGE_BUCKET || 'grudge-studio-assets';

// ── Presigned upload URL ──────────────────────────────────────────
async function presignUpload(key, contentType, expiresIn = 3600) {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// ── Presigned download URL ────────────────────────────────────────
async function presignDownload(key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// ── Head (check existence + metadata) ─────────────────────────────
async function headObject(key) {
  try {
    const cmd = new HeadObjectCommand({ Bucket: bucket(), Key: key });
    return await client().send(cmd);
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// ── Delete ────────────────────────────────────────────────────────
async function deleteObject(key) {
  const cmd = new DeleteObjectCommand({ Bucket: bucket(), Key: key });
  return client().send(cmd);
}

// ── Resolve public CDN URL ────────────────────────────────────────
async function resolveUrl(key) {
  const publicUrl = process.env.OBJECT_STORAGE_PUBLIC_URL;
  if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/${key}`;
  // Fallback to presigned download
  return presignDownload(key, 86400);
}

// ── Get public URL (sync) ─────────────────────────────────────────
function getPublicUrl(key) {
  const publicUrl = process.env.OBJECT_STORAGE_PUBLIC_URL;
  if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/${key}`;
  return null;
}

// ── SHA-256 of a buffer ───────────────────────────────────────────
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  presignUpload,
  presignDownload,
  resolveUrl,
  headObject,
  deleteObject,
  getPublicUrl,
  sha256,
};
