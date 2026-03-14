-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Dungeon Crawler & MOBA Schema (11)
-- Depends on: 01-schema.sql (users, characters)
-- Heroes, abilities, items, dungeon runs, MOBA match results
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── MOBA HEROES ──────────────────────────────────────────────
-- 26 static hero definitions for MOBA + Dungeon modes.
CREATE TABLE IF NOT EXISTS moba_heroes (
  id              INT UNSIGNED NOT NULL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  title           VARCHAR(128) NOT NULL,
  race            VARCHAR(32)  NOT NULL,
  hero_class      VARCHAR(32)  NOT NULL,
  faction         VARCHAR(32)  NOT NULL,
  rarity          VARCHAR(32)  NOT NULL DEFAULT 'Common',
  hp              INT UNSIGNED NOT NULL DEFAULT 200,
  atk             INT UNSIGNED NOT NULL DEFAULT 20,
  def             INT UNSIGNED NOT NULL DEFAULT 10,
  spd             INT UNSIGNED NOT NULL DEFAULT 60,
  rng             DECIMAL(4,1) NOT NULL DEFAULT 1.5,
  mp              INT UNSIGNED NOT NULL DEFAULT 100,
  quote           TEXT,
  is_secret       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_class (hero_class),
  INDEX idx_faction (faction)
);

-- ─── MOBA ABILITIES ───────────────────────────────────────────
-- Abilities keyed by class (or race_class for race-specific kits).
CREATE TABLE IF NOT EXISTS moba_abilities (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ability_class   VARCHAR(64)  NOT NULL,  -- e.g. 'Warrior', 'Orc_Warrior', 'Mage'
  name            VARCHAR(128) NOT NULL,
  hotkey          CHAR(1)      NOT NULL,  -- Q, W, E, R
  cooldown        DECIMAL(5,1) NOT NULL DEFAULT 0,
  mana_cost       INT UNSIGNED NOT NULL DEFAULT 0,
  damage          INT UNSIGNED NOT NULL DEFAULT 0,
  ability_range   INT UNSIGNED NOT NULL DEFAULT 0,
  radius          INT UNSIGNED NOT NULL DEFAULT 0,
  duration        DECIMAL(5,1) NOT NULL DEFAULT 0,
  ability_type    ENUM('damage','buff','debuff','heal','aoe','dash','summon') NOT NULL DEFAULT 'damage',
  cast_type       ENUM('targeted','skillshot','ground_aoe','self_cast','cone','line') NOT NULL DEFAULT 'targeted',
  description     TEXT,
  max_charges     INT UNSIGNED DEFAULT NULL,
  charge_recharge DECIMAL(5,1) DEFAULT NULL,
  INDEX idx_class (ability_class)
);

-- ─── MOBA ITEMS ───────────────────────────────────────────────
-- Shop items for MOBA mode.
CREATE TABLE IF NOT EXISTS moba_items (
  id              INT UNSIGNED NOT NULL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  cost            INT UNSIGNED NOT NULL DEFAULT 0,
  hp              INT UNSIGNED NOT NULL DEFAULT 0,
  atk             INT UNSIGNED NOT NULL DEFAULT 0,
  def             INT UNSIGNED NOT NULL DEFAULT 0,
  spd             INT UNSIGNED NOT NULL DEFAULT 0,
  mp              INT UNSIGNED NOT NULL DEFAULT 0,
  description     TEXT,
  tier            TINYINT UNSIGNED NOT NULL DEFAULT 1
);

-- ─── DUNGEON RUNS ─────────────────────────────────────────────
-- Tracks each dungeon session for a player.
CREATE TABLE IF NOT EXISTS dungeon_runs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36)  NOT NULL,
  hero_id         INT UNSIGNED NOT NULL,
  hero_name       VARCHAR(128) NOT NULL,
  hero_class      VARCHAR(32)  NOT NULL,
  floors_reached  INT UNSIGNED NOT NULL DEFAULT 1,
  kills           INT UNSIGNED NOT NULL DEFAULT 0,
  gold_earned     INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms     INT UNSIGNED NOT NULL DEFAULT 0,
  outcome         ENUM('cleared','died','abandoned') NOT NULL DEFAULT 'died',
  run_data        JSON DEFAULT NULL,  -- optional detailed run stats
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_player (grudge_id, created_at DESC),
  INDEX idx_leaderboard (floors_reached DESC, duration_ms ASC)
);

-- ─── MOBA MATCH RESULTS ──────────────────────────────────────
-- Stores MOBA game results tied to a player.
CREATE TABLE IF NOT EXISTS moba_match_results (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36)  NOT NULL,
  hero_name       VARCHAR(128) NOT NULL,
  hero_class      VARCHAR(32)  NOT NULL,
  kills           INT UNSIGNED NOT NULL DEFAULT 0,
  deaths          INT UNSIGNED NOT NULL DEFAULT 0,
  assists         INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms     INT UNSIGNED NOT NULL DEFAULT 0,
  win             BOOLEAN NOT NULL DEFAULT FALSE,
  match_data      JSON DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_player (grudge_id, created_at DESC),
  INDEX idx_leaderboard (win, kills DESC)
);


-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Heroes
-- ═══════════════════════════════════════════════════════════════
INSERT INTO moba_heroes (id, name, title, race, hero_class, faction, rarity, hp, atk, def, spd, rng, mp, quote, is_secret) VALUES
(0,  'Sir Aldric Valorheart',       'The Iron Bastion',            'Human',     'Warrior', 'Crusade', 'Rare',      245, 23, 19, 57, 1.5, 95,  'The shield breaks before the will does.', FALSE),
(1,  'Gareth Moonshadow',           'The Twilight Stalker',        'Human',     'Worg',    'Crusade', 'Rare',      235, 22, 16, 67, 1.5, 100, 'The beast within is not my curse. It is my salvation.', FALSE),
(2,  'Archmage Elara Brightspire',  'The Storm Caller',            'Human',     'Mage',    'Crusade', 'Epic',      175, 21, 9,  62, 5.5, 155, 'Knowledge is the flame. I am merely the torch.', FALSE),
(3,  'Kael Shadowblade',            'The Shadow Blade',            'Human',     'Ranger',  'Crusade', 'Rare',      185, 22, 11, 72, 6.5, 115, 'You never see the arrow that kills you.', FALSE),
(4,  'Ulfgar Bonecrusher',          'The Mountain Breaker',        'Barbarian', 'Warrior', 'Crusade', 'Rare',      255, 26, 17, 58, 1.5, 85,  'I do not fight to survive. I fight because the mountain told me to.', FALSE),
(5,  'Hrothgar Fangborn',           'The Beast of the North',      'Barbarian', 'Worg',    'Crusade', 'Epic',      245, 25, 14, 68, 1.5, 90,  'The pack does not forgive. The pack does not forget.', FALSE),
(6,  'Volka Stormborn',             'The Frost Witch',             'Barbarian', 'Mage',    'Crusade', 'Epic',      185, 24, 7,  63, 5.5, 145, 'Winter does not come. I bring it.', FALSE),
(7,  'Svala Windrider',             'The Silent Huntress',         'Barbarian', 'Ranger',  'Crusade', 'Rare',      195, 25, 9,  73, 6.5, 105, 'The wind tells me where you hide.', FALSE),
(8,  'Thane Ironshield',            'The Mountain Guardian',       'Dwarf',     'Warrior', 'Fabled',  'Epic',      260, 24, 23, 52, 1.5, 90,  'Deeper than stone. Harder than iron. We endure.', FALSE),
(9,  'Bromm Earthshaker',           'The Cavern Beast',            'Dwarf',     'Worg',    'Fabled',  'Legendary', 250, 23, 20, 57, 1.5, 95,  'The mountain has teeth. I am its bite.', FALSE),
(10, 'Runa Forgekeeper',            'The Runesmith',               'Dwarf',     'Mage',    'Fabled',  'Epic',      190, 22, 13, 52, 5.5, 150, 'Every rune tells a story. Mine tells of fire.', FALSE),
(11, 'Durin Tunnelwatcher',         'The Deep Scout',              'Dwarf',     'Ranger',  'Fabled',  'Rare',      200, 23, 15, 62, 6.5, 110, 'In the deep, every sound is a target.', FALSE),
(12, 'Thalion Bladedancer',         'The Graceful Death',          'Elf',       'Warrior', 'Fabled',  'Rare',      230, 22, 16, 65, 1.5, 120, 'A blade is a brush. Combat is art.', FALSE),
(13, 'Sylara Wildheart',            'The Forest Spirit',           'Elf',       'Worg',    'Fabled',  'Legendary', 220, 21, 13, 70, 1.5, 115, 'The forest breathes through me. And it is angry.', FALSE),
(14, 'Lyra Stormweaver',            'The Storm Weaver',            'Elf',       'Mage',    'Fabled',  'Legendary', 160, 20, 6,  65, 5.5, 170, 'Magic is not power. It is understanding. I understand everything.', FALSE),
(15, 'Aelindra Swiftbow',           'The Wind Walker',             'Elf',       'Ranger',  'Fabled',  'Epic',      170, 21, 8,  75, 6.5, 130, 'I loosed the arrow yesterday. It arrives tomorrow. You die today.', FALSE),
(16, 'Grommash Ironjaw',            'The Warchief',                'Orc',       'Warrior', 'Legion',  'Epic',      250, 27, 19, 57, 1.5, 80,  'BLOOD AND THUNDER!', FALSE),
(17, 'Fenris Bloodfang',            'The Alpha',                   'Orc',       'Worg',    'Legion',  'Legendary', 240, 26, 16, 67, 1.5, 85,  'I am the alpha. There is no omega.', FALSE),
(18, 'Zul''jin the Hexmaster',      'The Blood Shaman',            'Orc',       'Mage',    'Legion',  'Epic',      180, 25, 9,  62, 5.5, 140, 'Your blood screams louder than you do.', FALSE),
(19, 'Razak Deadeye',               'The Trophy Hunter',           'Orc',       'Ranger',  'Legion',  'Rare',      190, 26, 11, 72, 6.5, 100, 'Every head on my wall was once the strongest in its land.', FALSE),
(20, 'Lord Malachar',               'The Deathless Knight',        'Undead',    'Warrior', 'Legion',  'Epic',      265, 23, 20, 52, 1.5, 95,  'I cannot die. I have tried.', FALSE),
(21, 'The Ghoulfather',             'The Abomination',             'Undead',    'Worg',    'Legion',  'Legendary', 255, 22, 17, 62, 1.5, 100, 'We... are... HUNGRY.', FALSE),
(22, 'Necromancer Vexis',           'The Soul Harvester',          'Undead',    'Mage',    'Legion',  'Epic',      195, 21, 10, 57, 5.5, 155, 'Death is not the end. It is the door to real power.', FALSE),
(23, 'Shade Whisper',               'The Phantom Archer',          'Undead',    'Ranger',  'Legion',  'Rare',      205, 22, 12, 67, 6.5, 115, 'I remember your face. I remember all their faces.', FALSE),
(24, 'Racalvin the Pirate King',    'The Scourge of the Seven Seas','Barbarian','Ranger',  'Pirates', 'Legendary', 225, 30, 9,  78, 6.5, 105, 'The sea does not bow. Neither do I.', TRUE),
(25, 'Cpt. John Wayne',             'The Sky Captain',             'Human',     'Warrior', 'Pirates', 'Legendary', 240, 30, 18, 60, 2.5, 90,  'The ground is for those who''ve given up dreaming.', TRUE);


-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Abilities
-- ═══════════════════════════════════════════════════════════════
INSERT INTO moba_abilities (ability_class, name, hotkey, cooldown, mana_cost, damage, ability_range, radius, duration, ability_type, cast_type, description, max_charges, charge_recharge) VALUES
-- Warrior
('Warrior', 'Shield Bash',    'Q', 6,  20, 30,  80,  0,   1.5,  'damage',  'targeted',   'Bash target, dealing damage and stunning for 1.5s', NULL, NULL),
('Warrior', 'Rally',          'W', 15, 30, 0,   0,   200, 5,    'buff',    'self_cast',  'Rally allies, boosting ATK by 25% for 5s', NULL, NULL),
('Warrior', 'Blade Storm',    'E', 10, 35, 50,  0,   120, 0,    'aoe',     'self_cast',  'Spin with your blade dealing AoE damage', NULL, NULL),
('Warrior', 'Avatar',         'R', 60, 80, 0,   0,   0,   10,   'buff',    'self_cast',  'Transform into a giant, +50% HP and ATK for 10s', NULL, NULL),
-- Orc_Warrior
('Orc_Warrior', 'Skull Splitter',  'Q', 7,  25, 50,  90,  0,   4,    'damage',  'targeted',   'Overhead axe chop dealing heavy damage and shredding -20% DEF for 4s', NULL, NULL),
('Orc_Warrior', 'War Cry',         'W', 14, 30, 0,   0,   250, 5,    'debuff',  'self_cast',  'Terrifying war cry: fear enemies 1.5s, +30% ATK for 5s', NULL, NULL),
('Orc_Warrior', 'Cleave',          'E', 8,  30, 45,  0,   150, 0,    'aoe',     'cone',       'Wide frontal axe cleave hitting all enemies in a cone', NULL, NULL),
('Orc_Warrior', 'Blood Fury',      'R', 55, 70, 0,   0,   0,   10,   'buff',    'self_cast',  'Enter blood rage: +40% ATK, +30% lifesteal, +20% move speed for 10s', NULL, NULL),
-- Elf_Warrior
('Elf_Warrior', 'Piercing Strike', 'Q', 5,  20, 40,  120, 0,   0,    'damage',  'targeted',   'Long-range spear thrust dealing high damage', NULL, NULL),
('Elf_Warrior', 'Wind Walk',       'W', 12, 30, 0,   200, 0,   1,    'dash',    'ground_aoe', 'Dash forward, dodging all attacks for 1s', NULL, NULL),
('Elf_Warrior', 'Glaive Sweep',    'E', 9,  35, 40,  0,   130, 2,    'aoe',     'self_cast',  'Spinning glaive sweep dealing AoE damage and slowing 25% for 2s', NULL, NULL),
('Elf_Warrior', 'Dance of Blades', 'R', 50, 75, 25,  0,   160, 3,    'aoe',     'self_cast',  '3s flurry of 8 rapid strikes on nearby enemies', NULL, NULL),
-- Worg
('Worg', 'Feral Charge',  'Q', 8,  25, 40,  300, 0,   0,    'dash',    'targeted',   'Dash to target, dealing damage on impact', NULL, NULL),
('Worg', 'Howl',           'W', 12, 20, 0,   0,   250, 3,    'debuff',  'self_cast',  'Howl, slowing enemies by 30% for 3s', NULL, NULL),
('Worg', 'Rend',           'E', 5,  15, 60,  80,  0,   3,    'damage',  'targeted',   'Rend target, dealing damage over 3s', NULL, NULL),
('Worg', 'Primal Fury',    'R', 55, 70, 0,   0,   0,   12,   'buff',    'self_cast',  'Enter frenzy, +40% ATK SPD and lifesteal for 12s', NULL, NULL),
-- Mage
('Mage', 'Fireball',       'Q', 4,  25, 55,  400, 60,  0,    'damage',  'skillshot',  'Hurl a fireball dealing AoE damage', 2, 4),
('Mage', 'Frost Nova',     'W', 12, 35, 30,  0,   180, 2,    'aoe',     'self_cast',  'Freeze nearby enemies, dealing damage and slowing', NULL, NULL),
('Mage', 'Arcane Barrier',  'E', 18, 40, 0,   0,   0,   4,    'heal',    'self_cast',  'Create a magic shield absorbing 100 damage', NULL, NULL),
('Mage', 'Meteor',         'R', 50, 90, 120, 500, 150, 0,    'aoe',     'ground_aoe', 'Call down a meteor dealing massive AoE damage', NULL, NULL),
-- Ranger
('Ranger', 'Power Shot',    'Q', 5,  20, 45,  500, 0,   0,    'damage',  'line',       'Fire a piercing shot dealing high damage', 3, 5),
('Ranger', 'Trap',          'W', 14, 25, 20,  300, 50,  2,    'debuff',  'ground_aoe', 'Place a trap that roots for 2s', NULL, NULL),
('Ranger', 'Shadow Step',   'E', 10, 30, 0,   250, 0,   0,    'dash',    'ground_aoe', 'Teleport to location, becoming invisible for 1s', NULL, NULL),
('Ranger', 'Storm of Arrows','R', 55, 80, 80,  400, 200, 3,    'aoe',     'ground_aoe', 'Rain arrows over an area for 3s', NULL, NULL);


-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Items
-- ═══════════════════════════════════════════════════════════════
INSERT INTO moba_items (id, name, cost, hp, atk, def, spd, mp, description, tier) VALUES
(0,  'Short Sword',    300,  0,   10, 0,  0,  0,  '+10 Attack', 1),
(1,  'Iron Shield',    300,  0,   0,  10, 0,  0,  '+10 Defense', 1),
(2,  'Swift Boots',    350,  0,   0,  0,  12, 0,  '+12 Speed', 1),
(3,  'Mana Crystal',   300,  0,   0,  0,  0,  30, '+30 Mana', 1),
(4,  'Health Pendant',  400,  60,  0,  0,  0,  0,  '+60 Health', 1),
(5,  'Flaming Blade',  850,  0,   25, 0,  0,  0,  '+25 Attack', 2),
(6,  'Fortress Shield', 900,  100, 0,  20, 0,  0,  '+20 DEF +100 HP', 2),
(7,  'Arcane Staff',   850,  0,   20, 0,  0,  50, '+20 ATK +50 MP', 2),
(8,  'Shadow Cloak',   750,  0,   10, 0,  18, 0,  '+10 ATK +18 SPD', 2),
(9,  'Divine Armor',   1500, 200, 0,  30, 0,  0,  '+30 DEF +200 HP', 3),
(10, 'Doom Blade',     1600, 0,   40, 0,  5,  0,  '+40 ATK +5 SPD', 3),
(11, 'Staff of Ages',  1400, 50,  30, 0,  0,  80, '+30 ATK +80 MP +50 HP', 3),
(12, 'Divine Rapier',  2200, 0,   60, 0,  8,  0,  '+60 ATK +8 SPD. Dropped on death!', 3);
