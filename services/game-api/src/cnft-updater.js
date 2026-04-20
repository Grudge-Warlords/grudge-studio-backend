'use strict';
const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// R2 / S3 client (same as asset-service uses)
function getS3() {
  return new S3Client({
    region: process.env.OBJECT_STORAGE_REGION || 'auto',
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.OBJECT_STORAGE_KEY,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET,
    },
    forcePathStyle: false,
  });
}

const BUCKET       = process.env.OBJECT_STORAGE_BUCKET;
const PUBLIC_URL   = process.env.OBJECT_STORAGE_PUBLIC_URL?.replace(/\/$/, '');
const WALLET_URL   = process.env.WALLET_SERVICE_URL;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY;

// ── Build character metadata snapshot ────────────────────────────────────────
// Called after: equip, harvest, craft, guild inventory change
async function buildSnapshot(db, grudge_id, char_id) {
  const [[char]] = await db.query(
    `SELECT c.*, u.server_wallet_address, u.nft_mint, u.faction
     FROM characters c
     JOIN users u ON u.grudge_id = c.grudge_id
     WHERE c.id = ? AND c.grudge_id = ? LIMIT 1`,
    [char_id, grudge_id]
  );
  if (!char) return null;

  // Equipped items
  const [equipped] = await db.query(
    'SELECT item_type, item_key, tier, slot FROM inventory WHERE char_id = ? AND equipped = TRUE AND deleted = FALSE',
    [char_id]
  );

  // Resources (from professions / harvest log)
  const [resources] = await db.query(
    `SELECT resource_type, SUM(amount) as total
     FROM harvest_log
     WHERE char_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY resource_type`,
    [char_id]
  ).catch(() => [[]]);  // table may not exist yet

  // Gold
  const [[economy]] = await db.query(
    'SELECT gold, gbux_balance FROM users WHERE grudge_id = ? LIMIT 1',
    [grudge_id]
  ).catch(() => [[{ gold: 0, gbux_balance: 0 }]]);

  // Guild
  const [[guild]] = await db.query(
    `SELECT g.name FROM crews g
     JOIN crew_members cm ON cm.crew_id = g.id
     WHERE cm.grudge_id = ? LIMIT 1`,
    [grudge_id]
  ).catch(() => [[null]]);

  // Highest tier equipped
  const maxTier = equipped.reduce((max, i) => Math.max(max, i.tier || 1), 1);

  // Build NFT metadata (Metaplex standard)
  const attributes = [
    { trait_type: 'Race',   value: char.race  || 'Unknown' },
    { trait_type: 'Class',  value: char.class || 'Unknown' },
    { trait_type: 'Level',  value: char.level || 1 },
    { trait_type: 'Tier',   value: maxTier },
    { trait_type: 'Faction', value: char.faction || 'None' },
    { trait_type: 'Gold',   value: economy?.gold || 0 },
  ];

  // Add equipped slots
  for (const item of equipped) {
    attributes.push({
      trait_type: item.slot || item.item_type,
      value: item.item_key,
    });
  }

  // Add resources
  for (const res of resources) {
    if (res.total > 0) {
      attributes.push({ trait_type: res.resource_type, value: res.total });
    }
  }

  if (guild?.name) {
    attributes.push({ trait_type: 'Guild', value: guild.name });
  }

  return {
    name:        char.name || `Grudge Warlord #${char_id}`,
    symbol:      'GRUDGE',
    description: `A Grudge Warlords character — ${char.race || ''} ${char.class || ''}, Level ${char.level || 1}`,
    image:       `${PUBLIC_URL}/characters/${grudge_id}/avatar.png`,
    external_url: `https://grudgewarlords.com`,
    attributes,
    properties: {
      grudge_id,
      char_id,
      wallet: char.server_wallet_address,
      nft_mint: char.nft_mint || null,
      last_updated: new Date().toISOString(),
    },
  };
}

// ── Upload snapshot to R2 ─────────────────────────────────────────────────────
async function pushToR2(grudge_id, snapshot) {
  const key = `characters/${grudge_id}/metadata.json`;
  const s3  = getS3();
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        JSON.stringify(snapshot, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-cache',
  }));
  return `${PUBLIC_URL}/${key}`;
}

// ── Notify wallet-service to update on-chain (async, non-blocking) ────────────
async function notifyWalletService(grudge_id, metadataUri, nft_mint) {
  if (!nft_mint || !WALLET_URL) return;
  try {
    await axios.post(
      `${WALLET_URL}/cnft/update`,
      { grudge_id, metadataUri, nft_mint },
      { headers: { 'x-internal-key': INTERNAL_KEY }, timeout: 10000 }
    );
  } catch (e) {
    // Non-fatal — R2 is already updated, on-chain can sync later
    console.warn('[cnft] wallet-service notify failed:', e.message);
  }
}

// ── Main export: call this after any inventory change ─────────────────────────
// Fire-and-forget: do NOT await this in API routes
async function syncCnft(db, grudge_id, char_id, trigger = 'inventory') {
  try {
    const snapshot = await buildSnapshot(db, grudge_id, char_id);
    if (!snapshot) return;

    const metadataUri = await pushToR2(grudge_id, snapshot);
    console.log(`[cnft] updated ${grudge_id} (${trigger}) → ${metadataUri}`);

    // Async on-chain update if character has a minted NFT
    notifyWalletService(grudge_id, metadataUri, snapshot.properties.nft_mint);
  } catch (e) {
    console.warn('[cnft] sync failed:', e.message);
  }
}

module.exports = { syncCnft };
