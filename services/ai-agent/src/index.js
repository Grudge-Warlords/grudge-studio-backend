require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { initDB } = require('./db');

const missionRoutes   = require('./routes/missions');
const companionRoutes = require('./routes/companions');
const factionRoutes   = require('./routes/factions');

const app  = express();
const PORT = process.env.PORT || 3004;

app.use(helmet());
app.use(express.json());

// ── Internal-only: all requests must carry x-internal-key ─────
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// ── Rate limit (per IP, internal network only) ─────────────────
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ── Routes ────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'ai-agent', version: '1.0.0' })
);
app.use('/ai/mission',   missionRoutes);
app.use('/ai/companion', companionRoutes);
app.use('/ai/faction',   factionRoutes);

app.use((err, req, res, next) => {
  console.error('[ai-agent]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// ── Start (DB optional — faction intel degrades gracefully) ───
(async () => {
  try {
    await initDB();
  } catch (e) {
    console.warn('[ai-agent] DB unavailable — faction intel will return static data');
  }
  app.listen(PORT, () => console.log(`[ai-agent] Running on port ${PORT}`));
})();
