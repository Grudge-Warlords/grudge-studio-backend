'use strict';

/**
 * shared/storage.js — Grudge Studio shared S3-compatible object storage helpers
 *
 * Supports Cloudflare R2, AWS S3, MinIO, Backblaze B2, and any S3-compatible store.
 * Reads config from environment variables set in docker-compose.yml.
 *
 * Exports:
 *   getPublicUrl()                      — sync, returns OBJECT_STORAGE_PUBLIC_URL
 *   contentHashKey(prefix, buf, ext)    — SHA-256 based content-addressed key
 *   putObject(key, buf, ct, meta)       — upload buffer to storage
 *   resolveUrl(urlOrKey)                — resolve key → public or presigned URL (async)
 *   createUploader({maxSize, allowedMimes}) — multer middleware factory (lazy)
 */

const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

// ── S3 client singleton ───────────────────────────────────────────────────────
let _client;
function getClient() {
  if (!_client) {
    _client = new S3Client({
      endpoint:    process.env.OBJECT_STORAGE_ENDPOINT,
      region:      process.env.OBJECT_STORAGE_REGION || 'auto',
      credentials: {
        accessKeyId:     process.env.OBJECT_STORAGE_KEY     || '',
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET  || '',
      },
      forcePathStyle: true, // required for Cloudflare R2, MinIO
    });
  }
  return _client;
}

/**
 * Returns the public CDN base URL (no trailing slash).
 */
function getPublicUrl() {
  return (process.env.OBJECT_STORAGE_PUBLIC_URL || '').replace(/\/$/, '');
}

/**
 * Generate a content-addressed storage key.
 * e.g. contentHashKey('avatars/grudge123', buf, 'png') → 'avatars/grudge123/abc123abc123.png'
 */
function contentHashKey(prefix, buffer, ext) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
  return `${prefix}/${hash}.${ext}`;
}

/**
 * Upload a buffer to object storage.
 * @param {string} key           Storage key (path within bucket)
 * @param {Buffer} buffer        File data
 * @param {string} contentType   MIME type
 * @param {Object} metadata      Optional S3 object metadata (string → string map)
 * @returns {Promise<string>}    The storage key
 */
async function putObject(key, buffer, contentType, metadata = {}) {
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  await getClient().send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    Metadata:    metadata,
  }));
  return key;
}

/**
 * Resolve a storage URL/key to a usable download URL.
 *
 * Logic:
 *   1. If already an http/https URL → return as-is
 *   2. If OBJECT_STORAGE_PUBLIC_URL is set → return `${publicUrl}/${key}`
 *   3. Otherwise → generate an S3 presigned GET URL (1 hour TTL)
 *
 * @param {string|null} urlOrKey
 * @returns {Promise<string|null>}
 */
async function resolveUrl(urlOrKey) {
  if (!urlOrKey) return null;
  if (urlOrKey.startsWith('http://') || urlOrKey.startsWith('https://')) return urlOrKey;

  const publicUrl = getPublicUrl();
  if (publicUrl) return `${publicUrl}/${urlOrKey}`;

  // Lazy-load presigner — only installed in services that need it (e.g. launcher-api)
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: urlOrKey });
  return getSignedUrl(getClient(), cmd, { expiresIn: 3600 });
}

/**
 * Create a multer upload middleware (memory storage).
 * Lazy-loads multer so services without it in their package.json won't crash.
 *
 * @param {Object}   opts
 * @param {number}   opts.maxSize       Max file size in bytes (default 5 MB)
 * @param {string[]} opts.allowedMimes  Allowed MIME type prefixes (default: all)
 * @returns {import('multer').Multer}
 */
function createUploader({ maxSize = 5 * 1024 * 1024, allowedMimes = [] } = {}) {
  const multer = require('multer');
  return multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: maxSize },
    fileFilter(_req, file, cb) {
      if (!allowedMimes.length) return cb(null, true);
      const ok = allowedMimes.some(prefix => file.mimetype.startsWith(prefix));
      if (!ok) {
        const err = Object.assign(
          new Error(`Only ${allowedMimes.join(', ')} files are allowed`),
          { status: 400 }
        );
        return cb(err);
      }
      cb(null, true);
    },
  });
}

module.exports = { getPublicUrl, contentHashKey, putObject, resolveUrl, createUploader };
