/**
 * Shared S3-compatible storage module for Grudge Studio services.
 *
 * Provides:
 *  - Singleton S3Client configured from env vars
 *  - Presigned upload / download URL helpers
 *  - putObject / deleteObject wrappers
 *  - Multer memory storage factory
 *
 * Usage:
 *   const { getS3, putObject, presignUpload, presignDownload, createUploader } = require('../../shared/storage');
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const crypto = require('crypto');

// ── Singleton S3 Client ──────────────────────────────────────────────────────
let _s3 = null;

function getS3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    endpoint:       process.env.OBJECT_STORAGE_ENDPOINT,
    region:         process.env.OBJECT_STORAGE_REGION || 'auto',
    credentials: {
      accessKeyId:     process.env.OBJECT_STORAGE_KEY,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
    },
    forcePathStyle: true,
  });
  return _s3;
}

function getBucket() {
  return process.env.OBJECT_STORAGE_BUCKET || 'grudge-assets';
}

function getPublicUrl() {
  return (process.env.OBJECT_STORAGE_PUBLIC_URL || '').replace(/\/$/, '');
}

// ── Upload object directly ───────────────────────────────────────────────────
async function putObject(key, body, contentType, metadata = {}) {
  const s3 = getS3();
  const cmd = new PutObjectCommand({
    Bucket:             getBucket(),
    Key:                key,
    Body:               body,
    ContentType:        contentType,
    CacheControl:       'public, max-age=31536000, immutable',
    ContentDisposition: 'inline',
    Metadata:           metadata,
  });
  return s3.send(cmd);
}

// ── Delete object ────────────────────────────────────────────────────────────
async function deleteObject(key) {
  const s3 = getS3();
  return s3.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

// ── Head object (check existence + metadata) ─────────────────────────────────
async function headObject(key) {
  const s3 = getS3();
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// ── Presigned upload URL ─────────────────────────────────────────────────────
// Client uploads directly to R2 — bypasses Express memory.
async function presignUpload(key, contentType, expiresIn = 3600) {
  const s3 = getS3();
  const cmd = new PutObjectCommand({
    Bucket:       getBucket(),
    Key:          key,
    ContentType:  contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// ── Presigned download URL ───────────────────────────────────────────────────
async function presignDownload(key, expiresIn = 86400) {
  const s3 = getS3();
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// ── Resolve to CDN URL or fall back to presign ───────────────────────────────
async function resolveUrl(keyOrUrl) {
  if (!keyOrUrl) return null;
  if (keyOrUrl.startsWith('https://') || keyOrUrl.startsWith('http://')) return keyOrUrl;
  const publicBase = getPublicUrl();
  if (publicBase) return `${publicBase}/${keyOrUrl}`;
  return presignDownload(keyOrUrl);
}

// ── Content-hash key generator ───────────────────────────────────────────────
function contentHashKey(prefix, buffer, ext) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  return `${prefix}/${hash}.${ext}`;
}

// ── SHA-256 full hash ────────────────────────────────────────────────────────
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ── Multer factory ───────────────────────────────────────────────────────────
// Creates memory-based multer with configurable size + mime filter.
function createUploader({ maxSize = 10 * 1024 * 1024, allowedMimes = null } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize },
    fileFilter(req, file, cb) {
      if (allowedMimes && !allowedMimes.some(m => file.mimetype.startsWith(m))) {
        return cb(new Error(`File type ${file.mimetype} not allowed`));
      }
      cb(null, true);
    },
  });
}

module.exports = {
  getS3,
  getBucket,
  getPublicUrl,
  putObject,
  deleteObject,
  headObject,
  presignUpload,
  presignDownload,
  resolveUrl,
  contentHashKey,
  sha256,
  createUploader,
};
