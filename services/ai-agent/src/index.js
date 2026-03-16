require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { initDB } = require('./db');
const { SYSTEM_CONTEXT } = require('./data/systemContext');

const missionRoutes   = require('./routes/missions');
const companionRoutes = require('./routes/companions');
const factionRoutes   = require('./routes/factions');
const devRoutes       = require('./routes/dev');
const balanceRoutes   = require('./routes/balance');
const loreRoutes      = require('./routes/lore');
const artRoutes       = require('./routes/art');
const { getProviderStatus } = require('./llm/provider');

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
  res.json({ status: 'ok', service: 'ai-agent', version: SYSTEM_CONTEXT.version })
);
// Expose full system context (internal only — requires x-internal-key)
app.get('/ai/context', (req, res) => res.json(SYSTEM_CONTEXT));
app.use('/ai/mission',   missionRoutes);
app.use('/ai/companion', companionRoutes);
app.use('/ai/faction',   factionRoutes);
app.use('/ai/dev',       devRoutes);
app.use('/ai/balance',   balanceRoutes);
app.use('/ai/lore',      loreRoutes);
app.use('/ai/art',       artRoutes);

// ── LLM diagnostic endpoint ───────────────────────────────────
app.get('/ai/llm/status', async (req, res) => {
  try {
    const status = await getProviderStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
