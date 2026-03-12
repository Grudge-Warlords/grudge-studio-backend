-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Crafting Schema (05)
-- Depends on: 01-schema.sql, 02-game-systems.sql, 04-economy.sql
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── CRAFTING RECIPES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crafting_recipes (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipe_key          VARCHAR(128) NOT NULL UNIQUE,
  name                VARCHAR(128) NOT NULL,
  output_item_key     VARCHAR(128) NOT NULL,
  output_item_type    ENUM('weapon','armor','shield','off_hand','relic','cape','tome','wand') NOT NULL,
  output_tier         TINYINT UNSIGNED NOT NULL DEFAULT 1,   -- 1-6
  -- Requirement: player must have this profession at this level
  required_profession ENUM('mining','fishing','woodcutting','farming','hunting','none') DEFAULT 'none',
  required_level      TINYINT UNSIGNED DEFAULT 0,
  -- Gold cost
  cost_gold           INT UNSIGNED DEFAULT 0,
  -- JSON: [{ "item_key": "iron_ore", "quantity": 3 }, ...]
  cost_materials      JSON DEFAULT NULL,
  -- Seconds to craft (0 = instant)
  craft_time_seconds  SMALLINT UNSIGNED DEFAULT 0,
  -- NULL = all classes can craft
  class_restriction   VARCHAR(32) DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type_tier (output_item_type, output_tier),
  INDEX idx_class (class_restriction)
);

-- ─── CRAFTING QUEUE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crafting_queue (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36)     NOT NULL,
  char_id         BIGINT UNSIGNED NOT NULL,
  recipe_key      VARCHAR(128)    NOT NULL,
  status          ENUM('queued','complete','cancelled') DEFAULT 'queued',
  started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completes_at    TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP NULL,
  output_item_id  BIGINT UNSIGNED NULL,  -- inventory row created on completion
  FOREIGN KEY (grudge_id)  REFERENCES users(grudge_id)  ON DELETE CASCADE,
  FOREIGN KEY (char_id)    REFERENCES characters(id)    ON DELETE CASCADE,
  INDEX idx_char_active (char_id, status, completes_at)
);

-- ─── SEED RECIPES ────────────────────────────────────────────
-- Weapon tiers (T1-T6) for each weapon type × class restrictions
-- Armor: cloth (mage), leather (ranger), metal (warrior) × 6 tiers
-- Tier profession requirements match profession milestones:
--   T1 = lvl 0  (Apprentice)
--   T2 = lvl 25 (Journeyman) — +25 gold
--   T3 = lvl 50 (Expert)     — +50 gold
--   T4 = lvl 75 (Master)     — +75 gold
--   T5 = lvl 100 (Grandmaster) — +100 gold
--   T6 = lvl 100 + special mat — legendary

-- ── SWORDS (warrior, ranger) ──────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('sword_t1','Iron Sword','iron_sword_t1','weapon',1,'mining',0,50,30,'warrior'),
  ('sword_t2','Steel Sword','steel_sword_t2','weapon',2,'mining',25,100,60,'warrior'),
  ('sword_t3','Tempered Sword','tempered_sword_t3','weapon',3,'mining',50,200,120,'warrior'),
  ('sword_t4','Dragonbone Sword','dragonbone_sword_t4','weapon',4,'mining',75,400,180,'warrior'),
  ('sword_t5','Celestial Blade','celestial_blade_t5','weapon',5,'mining',100,800,300,'warrior'),
  ('sword_t6','Grudge Slayer','grudge_slayer_t6','weapon',6,'mining',100,2000,600,'warrior');

-- ── 2H SWORDS (warrior, ranger) ──────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('2h_sword_t1','Iron Greatsword','iron_greatsword_t1','weapon',1,'mining',0,75,45,NULL),
  ('2h_sword_t2','Steel Greatsword','steel_greatsword_t2','weapon',2,'mining',25,150,90,NULL),
  ('2h_sword_t3','Tempered Greatsword','tempered_greatsword_t3','weapon',3,'mining',50,300,150,NULL),
  ('2h_sword_t4','Dragonbone Greatsword','dragonbone_greatsword_t4','weapon',4,'mining',75,600,240,NULL),
  ('2h_sword_t5','Titan Cleaver','titan_cleaver_t5','weapon',5,'mining',100,1200,360,NULL),
  ('2h_sword_t6','World Ender','world_ender_t6','weapon',6,'mining',100,3000,720,NULL);

-- ── STAFFS (mage, worge) ─────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('staff_t1','Wooden Staff','wooden_staff_t1','weapon',1,'woodcutting',0,50,30,NULL),
  ('staff_t2','Ironwood Staff','ironwood_staff_t2','weapon',2,'woodcutting',25,100,60,NULL),
  ('staff_t3','Elderstave','elderstave_t3','weapon',3,'woodcutting',50,200,120,NULL),
  ('staff_t4','Godwood Staff','godwood_staff_t4','weapon',4,'woodcutting',75,400,180,NULL),
  ('staff_t5','Arcane Channel','arcane_channel_t5','weapon',5,'woodcutting',100,800,300,NULL),
  ('staff_t6','Staff of Ruin','staff_of_ruin_t6','weapon',6,'woodcutting',100,2000,600,NULL);

-- ── BOWS (ranger, worge) ─────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('bow_t1','Hunting Bow','hunting_bow_t1','weapon',1,'woodcutting',0,50,30,NULL),
  ('bow_t2','Recurve Bow','recurve_bow_t2','weapon',2,'woodcutting',25,100,60,NULL),
  ('bow_t3','Shadowbow','shadowbow_t3','weapon',3,'woodcutting',50,200,120,NULL),
  ('bow_t4','Stormbow','stormbow_t4','weapon',4,'woodcutting',75,400,180,NULL),
  ('bow_t5','Voidbow','voidbow_t5','weapon',5,'woodcutting',100,800,300,NULL),
  ('bow_t6','Fate Arrow','fate_arrow_t6','weapon',6,'woodcutting',100,2000,600,NULL);

-- ── DAGGERS (ranger, worge) ──────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('dagger_t1','Iron Dagger','iron_dagger_t1','weapon',1,'mining',0,40,20,NULL),
  ('dagger_t2','Steel Dagger','steel_dagger_t2','weapon',2,'mining',25,80,40,NULL),
  ('dagger_t3','Shadow Blade','shadow_blade_t3','weapon',3,'mining',50,160,80,NULL),
  ('dagger_t4','Venom Fang','venom_fang_t4','weapon',4,'mining',75,320,120,NULL),
  ('dagger_t5','Night Shard','night_shard_t5','weapon',5,'mining',100,640,240,NULL),
  ('dagger_t6','Assassin Fang','assassin_fang_t6','weapon',6,'mining',100,1600,480,NULL);

-- ── SPEARS (ranger, worge) ───────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('spear_t1','Wooden Spear','wooden_spear_t1','weapon',1,'woodcutting',0,50,30,NULL),
  ('spear_t2','Iron Spear','iron_spear_t2','weapon',2,'mining',25,100,60,NULL),
  ('spear_t3','Tempered Spear','tempered_spear_t3','weapon',3,'mining',50,200,120,NULL),
  ('spear_t4','Dragon Lance','dragon_lance_t4','weapon',4,'mining',75,400,180,NULL),
  ('spear_t5','Stormpiercer','stormpiercer_t5','weapon',5,'mining',100,800,300,NULL),
  ('spear_t6','World Spear','world_spear_t6','weapon',6,'mining',100,2000,600,NULL);

-- ── MACES (mage, worge) ──────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('mace_t1','Stone Mace','stone_mace_t1','weapon',1,'mining',0,50,30,NULL),
  ('mace_t2','Iron Mace','iron_mace_t2','weapon',2,'mining',25,100,60,NULL),
  ('mace_t3','Runic Mace','runic_mace_t3','weapon',3,'mining',50,200,120,NULL),
  ('mace_t4','Chaos Mace','chaos_mace_t4','weapon',4,'mining',75,400,180,NULL),
  ('mace_t5','Void Crusher','void_crusher_t5','weapon',5,'mining',100,800,300,NULL),
  ('mace_t6','Judgement','judgement_t6','weapon',6,'mining',100,2000,600,NULL);

-- ── HAMMERS (worge) ──────────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('hammer_t1','Iron Hammer','iron_hammer_t1','weapon',1,'mining',0,60,30,'worge'),
  ('hammer_t2','Steel Hammer','steel_hammer_t2','weapon',2,'mining',25,120,60,'worge'),
  ('hammer_t3','Heavy Hammer','heavy_hammer_t3','weapon',3,'mining',50,240,120,'worge'),
  ('hammer_t4','Titan Hammer','titan_hammer_t4','weapon',4,'mining',75,480,180,'worge'),
  ('hammer_t5','Earthshaker','earthshaker_t5','weapon',5,'mining',100,960,300,'worge'),
  ('hammer_t6','Thunder Maul','thunder_maul_t6','weapon',6,'mining',100,2400,600,'worge');

-- ── SHIELDS (warrior) ────────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('shield_t1','Wooden Shield','wooden_shield_t1','shield',1,'woodcutting',0,60,30,'warrior'),
  ('shield_t2','Iron Shield','iron_shield_t2','shield',2,'mining',25,120,60,'warrior'),
  ('shield_t3','Steel Shield','steel_shield_t3','shield',3,'mining',50,240,120,'warrior'),
  ('shield_t4','Dragon Shield','dragon_shield_t4','shield',4,'mining',75,480,180,'warrior'),
  ('shield_t5','Celestial Ward','celestial_ward_t5','shield',5,'mining',100,960,300,'warrior'),
  ('shield_t6','Aegis of Grudge','aegis_of_grudge_t6','shield',6,'mining',100,2400,600,'warrior');

-- ── CLOTH ARMOR (mage) ───────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('cloth_chest_t1','Cloth Robe T1','cloth_robe_t1','armor',1,'farming',0,40,20,'mage'),
  ('cloth_chest_t2','Cloth Robe T2','cloth_robe_t2','armor',2,'farming',25,80,40,'mage'),
  ('cloth_chest_t3','Arcane Vestment T3','arcane_vestment_t3','armor',3,'farming',50,160,80,'mage'),
  ('cloth_chest_t4','Mystic Robe T4','mystic_robe_t4','armor',4,'farming',75,320,120,'mage'),
  ('cloth_chest_t5','Void Silk T5','void_silk_t5','armor',5,'farming',100,640,240,'mage'),
  ('cloth_chest_t6','Lich Raiment T6','lich_raiment_t6','armor',6,'farming',100,1600,480,'mage');

-- ── LEATHER ARMOR (ranger) ───────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('leather_chest_t1','Leather Vest T1','leather_vest_t1','armor',1,'hunting',0,50,20,'ranger'),
  ('leather_chest_t2','Cured Leather T2','cured_leather_t2','armor',2,'hunting',25,100,40,'ranger'),
  ('leather_chest_t3','Shadow Leather T3','shadow_leather_t3','armor',3,'hunting',50,200,80,'ranger'),
  ('leather_chest_t4','Drake Leather T4','drake_leather_t4','armor',4,'hunting',75,400,120,'ranger'),
  ('leather_chest_t5','Void Leather T5','void_leather_t5','armor',5,'hunting',100,800,240,'ranger'),
  ('leather_chest_t6','Phantom Hide T6','phantom_hide_t6','armor',6,'hunting',100,2000,480,'ranger');

-- ── METAL ARMOR (warrior) ────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds, class_restriction) VALUES
  ('metal_chest_t1','Iron Chainmail T1','iron_chainmail_t1','armor',1,'mining',0,80,30,'warrior'),
  ('metal_chest_t2','Steel Plate T2','steel_plate_t2','armor',2,'mining',25,160,60,'warrior'),
  ('metal_chest_t3','Tempered Plate T3','tempered_plate_t3','armor',3,'mining',50,320,120,'warrior'),
  ('metal_chest_t4','Dragonscale T4','dragonscale_t4','armor',4,'mining',75,640,180,'warrior'),
  ('metal_chest_t5','Celestial Plate T5','celestial_plate_t5','armor',5,'mining',100,1280,300,'warrior'),
  ('metal_chest_t6','Grudge Aegis T6','grudge_aegis_t6','armor',6,'mining',100,3200,600,'warrior');

-- ── CAPES (all classes) ──────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds) VALUES
  ('cape_t1','Traveler Cape','traveler_cape_t1','cape',1,'farming',0,60,30),
  ('cape_t2','Ranger Cape','ranger_cape_t2','cape',2,'farming',25,120,60),
  ('cape_t3','Shadow Cape','shadow_cape_t3','cape',3,'farming',50,240,120),
  ('cape_t4','Wyvern Cape','wyvern_cape_t4','cape',4,'farming',75,480,180),
  ('cape_t5','Void Mantle','void_mantle_t5','cape',5,'farming',100,960,300),
  ('cape_t6','Immortal Shroud','immortal_shroud_t6','cape',6,'farming',100,2400,600);

-- ── TOMES (mage, worge) ──────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds) VALUES
  ('tome_t1','Beginner Tome','beginner_tome_t1','tome',1,'none',0,60,20),
  ('tome_t2','Arcane Tome','arcane_tome_t2','tome',2,'none',25,120,40),
  ('tome_t3','Dark Tome','dark_tome_t3','tome',3,'none',50,240,80),
  ('tome_t4','Void Tome','void_tome_t4','tome',4,'none',75,480,160),
  ('tome_t5','Eldritch Grimoire','eldritch_grimoire_t5','tome',5,'none',100,960,300),
  ('tome_t6','Tome of Ruin','tome_of_ruin_t6','tome',6,'none',100,2400,600);

-- ── RELICS (all classes) ─────────────────────────────────────
INSERT IGNORE INTO crafting_recipes (recipe_key, name, output_item_key, output_item_type, output_tier, required_profession, required_level, cost_gold, craft_time_seconds) VALUES
  ('relic_t1','Iron Talisman','iron_talisman_t1','relic',1,'none',0,100,60),
  ('relic_t2','Silver Charm','silver_charm_t2','relic',2,'none',25,200,120),
  ('relic_t3','Gold Sigil','gold_sigil_t3','relic',3,'none',50,400,180),
  ('relic_t4','Dragon Eye','dragon_eye_t4','relic',4,'none',75,800,300),
  ('relic_t5','Void Crystal','void_crystal_t5','relic',5,'none',100,1600,480),
  ('relic_t6','Heart of Grudge','heart_of_grudge_t6','relic',6,'none',100,4000,900);
