const express = require('express');
const router  = express.Router();

let getDB;
try { ({ getDB } = require('../db')); } catch {}

const FACTION_DATA = {
  pirate:  { strengths: ['sailing','fighting'],    weakness: 'harvesting', lore: 'Masters of the open sea. Pirates raid convoys and seize territory through force and cunning.' },
  undead:  { strengths: ['harvesting','fighting'], weakness: 'competing',  lore: 'The Undead horde grows through death itself, turning every fallen foe into a new soldier.' },
  elven:   { strengths: ['harvesting','competing'],weakness: 'fighting',   lore: 'Ancient elves command the forests and arcane arts, excelling in craft, trade, and magic.' },
  orcish:  { strengths: ['fighting','competing'],  weakness: 'sailing',    lore: 'Orcish warbands dominate land combat, their brute strength unmatched in direct confrontation.' },
};

async function queryFactionStats(faction) {
  if (!getDB) return null;
  try {
    const db = getDB();
    const [[crewRow]]     = await db.query('SELECT COUNT(*) AS c FROM crews WHERE faction = ?', [faction]);
    const [[activeRow]]   = await db.query(
      `SELECT COUNT(*) AS c FROM missions m
       JOIN users u ON u.grudge_id = m.grudge_id
       WHERE u.faction = ? AND m.status = 'active' AND DATE(m.started_at) = CURDATE()`, [faction]);
    const [[completedRow]] = await db.query(
      `SELECT COUNT(*) AS c FROM missions m
       JOIN users u ON u.grudge_id = m.grudge_id
       WHERE u.faction = ? AND m.status = 'completed' AND DATE(m.completed_at) = CURDATE()`, [faction]);
    return { crews: crewRow.c, active_today: activeRow.c, completed_today: completedRow.c };
  } catch { return null; }
}

// ── GET /ai/faction/:faction/intel ────────────────────────────
router.get('/:faction/intel', async (req, res, next) => {
  try {
    const faction = req.params.faction.toLowerCase();
    const base    = FACTION_DATA[faction] || { strengths: [], weakness: null, lore: 'Unknown faction.' };
    const stats   = await queryFactionStats(faction);

    const threat    = stats ? (stats.crews > 5 ? 'high' : stats.crews > 2 ? 'medium' : 'low') : 'unknown';
    const momentum  = stats ? (stats.completed_today > stats.active_today * 0.6 ? 'advancing' : stats.completed_today > 0 ? 'active' : 'dormant') : 'unknown';

    res.json({
      faction,
      lore:      base.lore,
      strengths: base.strengths,
      weakness:  base.weakness,
      intel: {
        active_crews:           stats?.crews            ?? null,
        active_missions_today:  stats?.active_today     ?? null,
        completed_missions_today: stats?.completed_today ?? null,
        threat_level:           threat,
        momentum,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ── GET /ai/faction/standings/all ────────────────────────────
router.get('/standings/all', async (req, res, next) => {
  try {
    const factions  = Object.keys(FACTION_DATA);
    const standings = [];

    for (const faction of factions) {
      const stats = await queryFactionStats(faction);
      standings.push({
        faction,
        crews:         stats?.crews          ?? 0,
        missions_today: stats?.completed_today ?? 0,
        score: (stats?.crews ?? 0) * 10 + (stats?.completed_today ?? 0),
      });
    }
    standings.sort((a, b) => b.score - a.score);
    res.json({ standings, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
