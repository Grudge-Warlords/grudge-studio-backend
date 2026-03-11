require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initDB } = require('./db');
const { initRedis } = require('./redis');

const characterRoutes  = require('./routes/characters');
const factionRoutes    = require('./routes/factions');
const missionRoutes    = require('./routes/missions');
const crewRoutes       = require('./routes/crews');
const inventoryRoutes  = require('./routes/inventory');
const professionRoutes = require('./routes/professions');
const gouldstoneRoutes = require('./routes/gouldstones');

const app = express();
const PORT = process.env.PORT || 3003;

// ── Dynamic CORS — supports GitHub Pages, puter apps, ObjectStore ────
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  'https://grudgewarlords.com,https://grudgestudio.com,https://grudachain.grudgestudio.com'
).split(',').map(o => o.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  CORS_ORIGINS.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173');
}

app.use(helmet());
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ── Auth middleware — accepts Grudge JWT or internal API key ───
function requireAuth(req, res, next) {
  // Game server / internal services use x-internal-key
  if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) {
    req.isInternal = true;
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Routes ────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'game-api', version: '2.0.0' }));
app.use('/characters',  requireAuth, characterRoutes);
app.use('/factions',    requireAuth, factionRoutes);
app.use('/missions',    requireAuth, missionRoutes);
app.use('/crews',       requireAuth, crewRoutes);
app.use('/inventory',   requireAuth, inventoryRoutes);
app.use('/professions', requireAuth, professionRoutes);
app.use('/gouldstones', requireAuth, gouldstoneRoutes);

app.use((err, req, res, next) => {
  console.error('[game-api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

(async () => {
  await initDB();
  await initRedis();
  app.listen(PORT, () => console.log(`[game-api] Running on port ${PORT}`));
})();
