require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initDB } = require('./db');
const { initRedis } = require('./redis');

const characterRoutes = require('./routes/characters');
const factionRoutes = require('./routes/factions');
const missionRoutes = require('./routes/missions');
const crewRoutes = require('./routes/crews');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(cors({
  origin: [
    'https://grudgewarlords.com',
    'https://grudgestudio.com',
    'https://grudachain.grudgestudio.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// ── Grudge ID JWT auth middleware ─────────────
function requireAuth(req, res, next) {
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

// ── Routes ────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'game-api' }));
app.use('/characters', requireAuth, characterRoutes);
app.use('/factions', requireAuth, factionRoutes);
app.use('/missions', requireAuth, missionRoutes);
app.use('/crews', requireAuth, crewRoutes);

app.use((err, req, res, next) => {
  console.error('[game-api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

(async () => {
  await initDB();
  await initRedis();
  app.listen(PORT, () => {
    console.log(`[game-api] Running on port ${PORT}`);
  });
})();
