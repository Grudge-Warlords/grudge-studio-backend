-- ─────────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Asset Management Schema (07)
-- Depends on: 01-schema.sql (users)
-- Covers: Object storage metadata, conversions, export bundles
-- ─────────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── ASSETS — Metadata for every file in R2 ─────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              VARCHAR(36) NOT NULL UNIQUE,             -- public-facing ID
  r2_key            VARCHAR(1024) NOT NULL UNIQUE,           -- R2 object key
  filename          VARCHAR(256) NOT NULL,                   -- original upload filename
  mime              VARCHAR(128) DEFAULT NULL,
  size              BIGINT UNSIGNED DEFAULT 0,               -- bytes
  sha256            VARCHAR(64) DEFAULT NULL,                -- integrity hash
  category          ENUM(
    'model','texture','sprite','animation','audio','video',
    'icon','ui','config','bundle','avatar','build','other'
  ) NOT NULL DEFAULT 'other',
  tags              JSON DEFAULT NULL,                       -- ["sword","legendary","tier5"]
  visibility        ENUM('public','private','internal') NOT NULL DEFAULT 'public',
  owner_grudge_id   VARCHAR(36) DEFAULT NULL,                -- uploader
  metadata          JSON DEFAULT NULL,                       -- arbitrary: {width, height, fps, format, ...}
  is_deleted        BOOLEAN DEFAULT FALSE,                   -- soft-delete
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_grudge_id) REFERENCES users(grudge_id) ON DELETE SET NULL,
  INDEX idx_category     (category, is_deleted),
  INDEX idx_owner        (owner_grudge_id, is_deleted),
  INDEX idx_visibility   (visibility, is_deleted),
  INDEX idx_created      (created_at),
  FULLTEXT idx_search    (filename)
);

-- ─── ASSET CONVERSIONS — Track model/animation processing jobs ───
CREATE TABLE IF NOT EXISTS asset_conversions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_asset_id   BIGINT UNSIGNED NOT NULL,
  output_asset_id   BIGINT UNSIGNED DEFAULT NULL,            -- created after conversion completes
  input_format      VARCHAR(32) NOT NULL,                    -- e.g. 'fbx', 'obj', 'blend'
  output_format     VARCHAR(32) NOT NULL,                    -- e.g. 'gltf', 'glb', 'png'
  status            ENUM('queued','processing','completed','failed') DEFAULT 'queued',
  error             TEXT DEFAULT NULL,
  started_at        TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (output_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  INDEX idx_status (status, created_at)
);

-- ─── ASSET BUNDLES — Group assets for export/download ────────────
CREATE TABLE IF NOT EXISTS asset_bundles (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              VARCHAR(36) NOT NULL UNIQUE,
  name              VARCHAR(128) NOT NULL,
  description       TEXT DEFAULT NULL,
  owner_grudge_id   VARCHAR(36) DEFAULT NULL,
  r2_key            VARCHAR(1024) DEFAULT NULL,              -- zip file in R2 (populated after export)
  size              BIGINT UNSIGNED DEFAULT 0,
  status            ENUM('building','ready','failed') DEFAULT 'building',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_grudge_id) REFERENCES users(grudge_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS asset_bundle_items (
  bundle_id         BIGINT UNSIGNED NOT NULL,
  asset_id          BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (bundle_id, asset_id),
  FOREIGN KEY (bundle_id) REFERENCES asset_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id)  REFERENCES assets(id) ON DELETE CASCADE
);
