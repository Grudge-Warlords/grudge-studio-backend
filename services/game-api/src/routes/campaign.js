/**
 * Campaign Routes — Gruda Armada endless campaign persistence
 *
 * POST   /campaign/save    — persist full campaign state
 * GET    /campaign/load    — restore campaign state
 * GET    /campaign/status  — check if player has active campaign
 * POST   /campaign/log     — batch append Captain's Log entries
 * POST   /campaign/event   — record event + player choice
 * POST   /campaign/title   — grant a campaign title
 * GET    /campaign/titles   — list earned titles
 */

const { Router } = require('express');
const router = Router();

// ── Input limits ─────────────────────────────────────────
const MAX_LOG_ENTRIES_PER_SAVE = 200;
const MAX_LOG_BATCH_CHUNK = 50; // insert in chunks to avoid MySQL packet limits
const MAX_STRING_LEN = 1024;    // max length for title/body fields
function clamp(s, max = MAX_STRING_LEN) { return typeof s === 'string' ? s.slice(0, max) : ''; }

// ── POST /campaign/save ──────────────────────────────────
router.post('/save', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const {
      progress, commanderName, commanderPortrait, commanderSpec,
      resources, upgrades, techResearched, logEntries, activeEvents,
      completedEventIds,
    } = req.body;

    if (!progress) return res.status(400).json({ error: 'progress required' });

    const db = require('../db').getDB();
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      // Upsert campaign_saves
      await conn.query(
        `INSERT INTO campaign_saves
           (grudge_id, sector_seed, commander_name, commander_portrait, commander_spec,
            game_time_elapsed, progress_json, resources_json, upgrades_json,
            tech_json, active_events_json, completed_event_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sector_seed = VALUES(sector_seed),
           commander_name = VALUES(commander_name),
           commander_portrait = VALUES(commander_portrait),
           commander_spec = VALUES(commander_spec),
           game_time_elapsed = VALUES(game_time_elapsed),
           progress_json = VALUES(progress_json),
           resources_json = VALUES(resources_json),
           upgrades_json = VALUES(upgrades_json),
           tech_json = VALUES(tech_json),
           active_events_json = VALUES(active_events_json),
           completed_event_ids_json = VALUES(completed_event_ids_json),
           updated_at = NOW()`,
        [
          grudgeId,
          clamp(progress.sectorSeed || '', 128),
          clamp(commanderName || 'Commander', 128),
          clamp(commanderPortrait || '', 512),
          clamp(commanderSpec || 'forge', 32),
          progress.elapsedGameTime || 0,
          JSON.stringify(progress),
          JSON.stringify(resources || {}),
          JSON.stringify(upgrades || {}),
          JSON.stringify(techResearched || {}),
          JSON.stringify(activeEvents || []),
          JSON.stringify(completedEventIds || []),
        ]
      );

      // Batch insert log entries in chunks to respect MySQL packet limits
      if (logEntries?.length) {
        const entries = logEntries.slice(-MAX_LOG_ENTRIES_PER_SAVE);
        for (let i = 0; i < entries.length; i += MAX_LOG_BATCH_CHUNK) {
          const chunk = entries.slice(i, i + MAX_LOG_BATCH_CHUNK);
          const values = chunk.map(e => [
            clamp(e.uuid, 36), grudgeId, clamp(e.category, 32), clamp(e.title, 256),
            clamp(e.body, 4096), JSON.stringify(e.metadata || null),
            e.planetUuid ? clamp(e.planetUuid, 36) : null,
            e.shipUuid ? clamp(e.shipUuid, 36) : null,
            new Date(e.realTimestamp || Date.now()),
          ]);
          const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          await conn.query(
            `INSERT IGNORE INTO campaign_log
               (uuid, campaign_grudge_id, category, title, body, metadata, planet_uuid, ship_uuid, created_at)
             VALUES ${placeholders}`,
            values.flat()
          );
        }
      }

      await conn.commit();
      res.json({ ok: true });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// ── GET /campaign/load ───────────────────────────────────────────
router.get('/load', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const db = require('../db').getDB();
    const [[row]] = await db.query(
      `SELECT * FROM campaign_saves WHERE grudge_id = ? LIMIT 1`,
      [grudgeId]
    );
    if (!row) return res.status(404).json({ error: 'No campaign save found' });

    // Load recent log entries (last 200)
    const [logRows] = await db.query(
      `SELECT uuid, category, title, body, metadata, planet_uuid, ship_uuid, created_at
       FROM campaign_log WHERE campaign_grudge_id = ?
       ORDER BY created_at DESC LIMIT 200`,
      [grudgeId]
    );

    // Load earned titles
    const [titleRows] = await db.query(
      `SELECT title_key, earned_at FROM campaign_titles WHERE grudge_id = ?`,
      [grudgeId]
    );

    const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

    res.json({
      grudgeId: row.grudge_id,
      progress: parse(row.progress_json),
      commanderName: row.commander_name,
      commanderPortrait: row.commander_portrait,
      commanderSpec: row.commander_spec,
      resources: parse(row.resources_json),
      upgrades: parse(row.upgrades_json),
      techResearched: parse(row.tech_json),
      activeEvents: parse(row.active_events_json) || [],
      completedEventIds: parse(row.completed_event_ids_json) || [],
      logEntries: logRows.reverse().map(r => ({
        uuid: r.uuid,
        timestamp: 0, // game-time not stored in DB, use realTimestamp
        realTimestamp: new Date(r.created_at).getTime(),
        category: r.category,
        title: r.title,
        body: r.body,
        planetUuid: r.planet_uuid,
        shipUuid: r.ship_uuid,
        metadata: parse(r.metadata),
      })),
      titles: titleRows.map(t => ({ key: t.title_key, earnedAt: new Date(t.earned_at).getTime() })),
      savedAt: new Date(row.updated_at || row.created_at).getTime(),
    });
  } catch (err) { next(err); }
});

// ── GET /campaign/status ─────────────────────────────────────────
router.get('/status', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const db = require('../db').getDB();
    const [[row]] = await db.query(
      `SELECT grudge_id, game_time_elapsed, updated_at FROM campaign_saves WHERE grudge_id = ? LIMIT 1`,
      [grudgeId]
    );
    const [titles] = await db.query(
      `SELECT title_key FROM campaign_titles WHERE grudge_id = ?`,
      [grudgeId]
    );

    res.json({
      active: !!row,
      gameTimeElapsed: row?.game_time_elapsed || 0,
      lastSaved: row ? new Date(row.updated_at).getTime() : null,
      titles: titles.map(t => t.title_key),
    });
  } catch (err) { next(err); }
});

// ── POST /campaign/log ───────────────────────────────────────────
router.post('/log', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const { entries } = req.body;
    if (!entries?.length) return res.json({ ok: true, inserted: 0 });

    const db = require('../db').getDB();
    const values = entries.slice(0, 100).map(e => [
      e.uuid, grudgeId, e.category, e.title,
      e.body, JSON.stringify(e.metadata || null),
      e.planetUuid || null, e.shipUuid || null,
      new Date(e.realTimestamp || Date.now()),
    ]);
    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const [result] = await db.query(
      `INSERT IGNORE INTO campaign_log
         (uuid, campaign_grudge_id, category, title, body, metadata, planet_uuid, ship_uuid, created_at)
       VALUES ${placeholders}`,
      values.flat()
    );

    res.json({ ok: true, inserted: result.affectedRows });
  } catch (err) { next(err); }
});

// ── POST /campaign/event ─────────────────────────────────────────
router.post('/event', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const event = req.body;
    if (!event?.uuid || !event?.type) {
      return res.status(400).json({ error: 'uuid and type required' });
    }

    const db = require('../db').getDB();
    await db.query(
      `INSERT INTO campaign_events
         (uuid, campaign_grudge_id, event_type, title, description, choice_taken, outcome_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         choice_taken = VALUES(choice_taken),
         outcome_json = VALUES(outcome_json)`,
      [
        event.uuid, grudgeId, event.type, event.title || '',
        event.description || '', event.choiceTaken ?? null,
        event.choiceTaken != null ? JSON.stringify(event.choices?.[event.choiceTaken]?.outcome || {}) : null,
      ]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /campaign/title ─────────────────────────────────────────
router.post('/title', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const { titleKey } = req.body;
    if (!titleKey) return res.status(400).json({ error: 'titleKey required' });

    const db = require('../db').getDB();
    await db.query(
      `INSERT IGNORE INTO campaign_titles (grudge_id, title_key, earned_at) VALUES (?, ?, NOW())`,
      [grudgeId, titleKey]
    );

    // Also update the user's display title if they don't have one
    await db.query(
      `UPDATE users SET campaign_title = COALESCE(campaign_title, ?) WHERE grudge_id = ?`,
      [titleKey, grudgeId]
    );

    res.json({ ok: true, titleKey });
  } catch (err) { next(err); }
});

// ── GET /campaign/titles ─────────────────────────────────────────
router.get('/titles', async (req, res, next) => {
  try {
    const grudgeId = req.user?.grudge_id || req.user?.grudgeId;
    if (!grudgeId) return res.status(401).json({ error: 'Unauthorized' });

    const db = require('../db').getDB();
    const [rows] = await db.query(
      `SELECT title_key, earned_at FROM campaign_titles WHERE grudge_id = ? ORDER BY earned_at`,
      [grudgeId]
    );

    res.json({ titles: rows.map(r => ({ key: r.title_key, earnedAt: new Date(r.earned_at).getTime() })) });
  } catch (err) { next(err); }
});

module.exports = router;
