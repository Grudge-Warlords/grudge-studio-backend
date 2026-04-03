-- ═══════════════════════════════════════════════════════════════
-- Migration 024: Expand PvP mode columns from ENUM to VARCHAR(32)
--
-- Problem: pvp_lobbies, pvp_matches, pvp_ratings have mode as
--   ENUM('duel','crew_battle','arena_ffa')
-- but game-api/mode-configs.js supports 6 modes:
--   duel, crew_battle, arena_ffa, nemesis, rpg_fighter, thc_battle
--
-- Attempting to insert nemesis/rpg_fighter/thc_battle throws:
--   ERROR 1265: Data truncated for column 'mode'
--
-- Fix: change all three to VARCHAR(32) with same default.
-- VARCHAR is also forward-compatible — new modes need no migration.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pvp_lobbies
  MODIFY COLUMN mode VARCHAR(32) NOT NULL DEFAULT 'duel';

ALTER TABLE pvp_matches
  MODIFY COLUMN mode VARCHAR(32) NOT NULL;

ALTER TABLE pvp_ratings
  MODIFY COLUMN mode VARCHAR(32) NOT NULL;

-- Also ensure the init schema file reflects this going forward
-- (existing rows are preserved — VARCHAR is a lossless conversion from ENUM)
