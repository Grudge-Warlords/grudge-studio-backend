/**
 * GRUDGE STUDIO — Asset D1 Indexer
 * Registers all R2-uploaded assets into the ObjectStore D1 database.
 * Assigns UUID, category, tags, CDN URL to each asset.
 * Safe to re-run — uses INSERT OR IGNORE, skips duplicates.
 *
 * Usage: node scripts/index-assets.mjs
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, basename } from 'path';
import { randomUUID } from 'crypto';

const OS_URL    = 'https://objectstore.grudge-studio.com';
const API_KEY   = '97613fa567ae4653a18fd1f99f3701baf8fef26e';
const CDN       = 'https://assets.grudge-studio.com';
const DESKTOP   = 'C:/Users/david/Desktop';
const BATCH     = 50; // assets per request

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream', '.obj': 'model/obj',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

const SOURCES = [
  { src: `${DESKTOP}/grudge-wars/public/sprites`,      prefix: 'sprites/characters', category: 'sprite',     tags: ['2d','character','animation'],  exts: ['.png','.jpg','.gif'] },
  { src: `${DESKTOP}/grudge-wars/public/effects`,      prefix: 'sprites/effects',    category: 'effect',     tags: ['2d','vfx','combat'],           exts: ['.png','.jpg'] },
  { src: `${DESKTOP}/grudge-wars/public/icons`,        prefix: 'icons',              category: 'icon',       tags: ['2d','icon','rpg'],             exts: ['.png','.jpg','.svg'] },
  { src: `${DESKTOP}/grudge-wars/public/ui`,           prefix: 'ui',                 category: 'ui',         tags: ['2d','ui','interface'],         exts: ['.png','.jpg'] },
  { src: `${DESKTOP}/grudge-wars/public/backgrounds`,  prefix: 'backgrounds',        category: 'background', tags: ['2d','background','scene'],     exts: ['.png','.jpg'] },
  { src: `${DESKTOP}/grudge-wars/public/heroes`,       prefix: 'heroes',             category: 'portrait',   tags: ['2d','hero','portrait'],        exts: ['.png','.jpg'] },
  { src: `${DESKTOP}/grim-armada-web/public/models`,   prefix: 'models/ships',       category: 'model3d',    tags: ['3d','ship','armada'],          exts: ['.glb','.fbx','.gltf'] },
  { src: `${DESKTOP}/StarWayGRUDA-WebClient/public`,   prefix: 'models/starway',     category: 'model3d',    tags: ['3d','starway','space'],        exts: ['.glb','.fbx','.gltf'] },
  { src: `${DESKTOP}/grudgedot-launcher/client/public`, prefix: 'models/dev',         category: 'model3d',    tags: ['3d','dev','editor'],           exts: ['.glb'] },
  { src: `${DESKTOP}/grudge-wars/public/audio`,        prefix: 'audio',              category: 'audio',      tags: ['audio','sfx','music'],         exts: ['.mp3','.ogg','.wav'] },
];

function walkDir(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) results.push(...walkDir(full, exts));
    else if (exts.includes(extname(item).toLowerCase())) results.push(full);
  }
  return results;
}

async function bulkIndex(assets) {
  const res = await fetch(`${OS_URL}/v1/assets/bulk-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ assets }),
  });
  return res.json();
}

let totalInserted = 0, totalSkipped = 0;

for (const s of SOURCES) {
  const files = walkDir(s.src, s.exts);
  console.log(`\n📁  ${s.category} (${s.prefix}): ${files.length} files`);
  if (!files.length) continue;

  const batch = [];
  for (const f of files) {
    const rel  = relative(s.src, f).replace(/\\/g, '/').toLowerCase().replace(/\s+/g, '-');
    const key  = `${s.prefix}/${rel}`;
    const fname = basename(f).toLowerCase().replace(/\s+/g, '-');
    const mime  = MIME[extname(f).toLowerCase()] || 'application/octet-stream';

    // Add character folder name as extra tag for sprites
    const extraTags = [];
    if (s.category === 'sprite') {
      const parts = rel.split('/');
      if (parts.length > 1) extraTags.push(parts[0]); // character folder name
    }

    batch.push({
      id:       randomUUID(),
      key,
      filename: fname,
      mime,
      size:     0, // unknown without reading file
      category: s.category,
      tags:     [...s.tags, ...extraTags],
    });

    if (batch.length >= BATCH) {
      const r = await bulkIndex([...batch]);
      totalInserted += r.inserted || 0;
      totalSkipped  += r.skipped  || 0;
      process.stdout.write(`  ✓ ${totalInserted + totalSkipped}/${files.length} `);
      batch.length = 0;
    }
  }
  if (batch.length) {
    const r = await bulkIndex([...batch]);
    totalInserted += r.inserted || 0;
    totalSkipped  += r.skipped  || 0;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`✅  D1 inserted: ${totalInserted}`);
console.log(`⏭   D1 skipped (already indexed): ${totalSkipped}`);
console.log(`\n🔍  Test:  ${OS_URL}/v1/assets?category=sprite&limit=5`);
console.log(`🔍  Icons: ${OS_URL}/v1/assets?category=icon&limit=5`);
console.log(`🌐  CDN:   ${CDN}/sprites/characters/barbarian-warrior/idle.png`);
