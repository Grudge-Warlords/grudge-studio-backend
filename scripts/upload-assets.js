#!/usr/bin/env node
/**
 * GRUDGE STUDIO — Asset Upload Script
 * Uploads sprites, 3D models, icons, effects, and UI from local projects to R2.
 * Also registers each asset in the ObjectStore D1 metadata DB.
 *
 * Usage:
 *   node scripts/upload-assets.js [category]
 *   node scripts/upload-assets.js sprites
 *   node scripts/upload-assets.js models
 *   node scripts/upload-assets.js all
 *
 * Set env vars first:
 *   R2_ACCOUNT_ID   — Cloudflare account ID
 *   R2_ACCESS_KEY   — R2 API token access key
 *   R2_SECRET_KEY   — R2 API token secret key
 *   R2_BUCKET       — grudge-assets
 *   OBJECTSTORE_API_KEY — secret from wrangler secret list (objectstore-api worker)
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, basename } from 'path';
import { lookup as mimeLookup } from 'mime-types';

const ACCOUNT_ID    = process.env.R2_ACCOUNT_ID    || 'ee475864561b02d4588180b8b9acf694';
const ACCESS_KEY    = process.env.R2_ACCESS_KEY;
const SECRET_KEY    = process.env.R2_SECRET_KEY;
const BUCKET        = process.env.R2_BUCKET        || 'grudge-assets';
const OS_API_KEY    = process.env.OBJECTSTORE_API_KEY;
const OS_URL        = 'https://objectstore.grudge-studio.com';
const CDN_URL       = 'https://assets.grudge-studio.com';

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('❌  Missing R2_ACCESS_KEY and R2_SECRET_KEY');
  console.error('   Get them from: dash.cloudflare.com → R2 → Manage R2 API Tokens');
  console.error('   Create token: Object Read & Write on grudge-assets bucket');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

// ── Asset source map ─────────────────────────────────────────────────────────
const PROJECTS_ROOT = join(import.meta.dirname, '..', '..'); // ../.. from scripts/

const ASSET_SOURCES = {
  sprites: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/sprites'),
    prefix: 'sprites/characters',
    exts:   ['.png', '.jpg', '.gif'],
    tags:   ['sprite', '2d', 'character', 'animation'],
    desc:   '2D character sprite sheets',
  },
  effects: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/effects'),
    prefix: 'sprites/effects',
    exts:   ['.png', '.jpg'],
    tags:   ['sprite', '2d', 'effect', 'vfx'],
    desc:   '2D combat and visual effects',
  },
  icons: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/icons'),
    prefix: 'icons',
    exts:   ['.png', '.jpg', '.svg'],
    tags:   ['icon', 'ui', '2d', 'rpg'],
    desc:   'RPG game icons (weapons, armor, potions, etc.)',
  },
  ui: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/ui'),
    prefix: 'ui/panels',
    exts:   ['.png', '.jpg'],
    tags:   ['ui', '2d', 'interface'],
    desc:   '2D UI panels, slots, and HUD elements',
  },
  backgrounds: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/backgrounds'),
    prefix: 'backgrounds',
    exts:   ['.png', '.jpg'],
    tags:   ['background', '2d', 'scene'],
    desc:   'Battle and scene backgrounds',
  },
  ships: {
    src:    join(PROJECTS_ROOT, 'grim-armada-web/public/models'),
    prefix: 'models/ships',
    exts:   ['.glb', '.fbx', '.gltf'],
    tags:   ['3d', 'model', 'ship', 'armada'],
    desc:   '3D ship models for Grim Armada',
  },
  starway_models: {
    src:    join(PROJECTS_ROOT, 'StarWayGRUDA-WebClient/public'),
    prefix: 'models/starway',
    exts:   ['.glb', '.fbx', '.gltf'],
    tags:   ['3d', 'model', 'starway', 'space'],
    desc:   '3D models for StarWay open world',
  },
  dev_models: {
    src:    join(PROJECTS_ROOT, 'GDevelopAssistant/client/public'),
    prefix: 'models/dev',
    exts:   ['.glb'],
    tags:   ['3d', 'model', 'dev', 'editor'],
    desc:   '3D models used in GDevelop tools',
  },
  audio: {
    src:    join(PROJECTS_ROOT, 'grudge-wars/public/audio'),
    prefix: 'audio',
    exts:   ['.mp3', '.ogg', '.wav'],
    tags:   ['audio', 'music', 'sfx'],
    desc:   'Game music and sound effects',
  },
};

// ── File walker ───────────────────────────────────────────────────────────────
function walkDir(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  const items = readdirSync(dir);
  for (const item of items) {
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, exts));
    } else if (exts.includes(extname(item).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

// ── Upload one file ────────────────────────────────────────────────────────────
async function uploadFile(localPath, r2Key, tags) {
  const body = readFileSync(localPath);
  const ct   = mimeLookup(localPath) || 'application/octet-stream';

  // Skip if already uploaded (check via HEAD)
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }));
    return { status: 'skipped', key: r2Key };
  } catch {
    // Not found — proceed with upload
  }

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         r2Key,
    Body:        body,
    ContentType: ct,
    Metadata: {
      source:  'grudge-upload-script',
      tags:    tags.join(','),
    },
  }));

  // Register in ObjectStore D1
  if (OS_API_KEY) {
    try {
      await fetch(`${OS_URL}/v1/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': OS_API_KEY },
        body: JSON.stringify({
          key:         r2Key,
          filename:    basename(localPath),
          contentType: ct,
          size:        body.byteLength,
          url:         `${CDN_URL}/${r2Key}`,
          tags,
        }),
      });
    } catch (e) {
      // Non-fatal — asset is in R2 even if D1 registration fails
    }
  }

  return { status: 'uploaded', key: r2Key, size: body.byteLength };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const category = process.argv[2] || 'all';
const sources  = category === 'all'
  ? Object.entries(ASSET_SOURCES)
  : Object.entries(ASSET_SOURCES).filter(([k]) => k === category);

if (sources.length === 0) {
  console.error(`Unknown category: ${category}`);
  console.error('Available:', Object.keys(ASSET_SOURCES).join(', '), 'all');
  process.exit(1);
}

let uploaded = 0, skipped = 0, failed = 0, totalBytes = 0;

for (const [cat, config] of sources) {
  const files = walkDir(config.src, config.exts);
  console.log(`\n📁  ${cat}: ${files.length} files → R2/${config.prefix}/`);

  for (const [i, file] of files.entries()) {
    const rel    = relative(config.src, file);
    const r2Key  = `${config.prefix}/${rel.replace(/\\/g, '/')}`;

    process.stdout.write(`  [${i+1}/${files.length}] ${basename(file)}...`);

    try {
      const result = await uploadFile(file, r2Key, config.tags);
      if (result.status === 'uploaded') {
        uploaded++;
        totalBytes += result.size;
        process.stdout.write(` ✅ ${(result.size/1024).toFixed(1)}KB\n`);
      } else {
        skipped++;
        process.stdout.write(` ⏭ already exists\n`);
      }
    } catch (e) {
      failed++;
      process.stdout.write(` ❌ ${e.message}\n`);
    }
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`✅  Uploaded: ${uploaded} files (${(totalBytes/1024/1024).toFixed(1)} MB)`);
console.log(`⏭   Skipped: ${skipped} (already in R2)`);
console.log(`❌   Failed:  ${failed}`);
console.log(`\n🌐  CDN base: ${CDN_URL}`);
console.log(`🗄   Browse:  ${OS_URL}/v1/assets`);
