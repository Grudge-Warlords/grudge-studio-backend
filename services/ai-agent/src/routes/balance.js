const express = require('express');
const router  = express.Router();
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

let getDB;
try { ({ getDB } = require('../db')); } catch {}

// ── Helper: gather game stats from MySQL ────────────────────
async function gatherStats() {
  if (!getDB) return null;
  const db = getDB();
  const stats = {};

  try {
    // Class distribution
    const [classRows] = await db.query('SELECT class, COUNT(*) AS count FROM characters GROUP BY class');
    stats.class_distribution = classRows;

    // Level brackets
    const [levelRows] = await db.query(`
      SELECT CASE
        WHEN level <= 24 THEN 'low'
        WHEN level <= 49 THEN 'mid'
        WHEN level <= 74 THEN 'high'
        ELSE 'elite'
      END AS tier, COUNT(*) AS count
      FROM characters GROUP BY tier`);
    stats.level_distribution = levelRows;

    // PvP win rates by class (last 7 days)
    const [pvpRows] = await db.query(`
      SELECT
        c1.class AS attacker_class, c2.class AS defender_class,
        SUM(CASE WHEN cl.outcome = 'win' THEN 1 ELSE 0 END) AS wins,
        COUNT(*) AS total
      FROM combat_log cl
      JOIN characters c1 ON c1.id = cl.attacker_id
      JOIN characters c2 ON c2.id = cl.defender_id
      WHERE cl.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY c1.class, c2.class`);
    stats.pvp_matchups = pvpRows;

    // Gold economy snapshot
    const [goldRows] = await db.query(`
      SELECT type, SUM(amount) AS total, COUNT(*) AS transactions
      FROM gold_transactions
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY type`);
    stats.gold_economy = goldRows;

    // Average gold by level tier
    const [avgGold] = await db.query(`
      SELECT CASE
        WHEN level <= 24 THEN 'low'
        WHEN level <= 49 THEN 'mid'
        WHEN level <= 74 THEN 'high'
        ELSE 'elite'
      END AS tier, AVG(gold) AS avg_gold
      FROM characters GROUP BY tier`);
    stats.avg_gold_by_tier = avgGold;

    // Crafting completion rates
    const [craftRows] = await db.query(`
      SELECT recipe_name,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        COUNT(*) AS total
      FROM crafting_queue
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY recipe_name
      ORDER BY total DESC
      LIMIT 20`);
    stats.crafting_rates = craftRows;
  } catch (err) {
    console.warn('[balance] DB query error:', err.message);
  }

  return stats;
}

// ── POST /ai/balance/analyze ────────────────────────────────
// Body: { focus?: "pvp"|"economy"|"crafting"|"all", period_days?: 7 }
router.post('/analyze', async (req, res, next) => {
  try {
    const { focus = 'all' } = req.body;
    const stats = await gatherStats();

    const statsText = stats
      ? `LIVE GAME DATA (last 7 days):\n${JSON.stringify(stats, null, 2)}`
      : 'DATABASE UNAVAILABLE — analyze based on game design knowledge only.';

    const result = await chatJSON([
      { role: 'system', content: PROMPTS.balance() },
      { role: 'user', content: `Analyze game balance${focus !== 'all' ? ` focused on ${focus}` : ''}.

${statsText}

Return JSON:
{
  "summary": "overall health assessment",
  "severity": "low|medium|high|critical",
  "issues": [
    { "area": "pvp|economy|crafting|progression", "title": "...", "severity": "...", "details": "...", "data_point": "..." }
  ],
  "recommendations": [
    { "priority": 1, "area": "...", "action": "...", "expected_impact": "..." }
  ],
  "metrics": {
    "class_balance_score": 0-100,
    "economy_health": 0-100,
    "crafting_engagement": 0-100,
    "overall": 0-100
  }
}` },
    ], { temperature: 0.2 });

    if (result.fallback) {
      return res.json({
        summary: 'LLM unavailable — raw stats only',
        stats: stats || {},
        fallback: true,
      });
    }

    res.json({
      analysis: result.data || result.raw,
      raw_stats: stats,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      analyzed_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
