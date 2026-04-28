require('dotenv').config();

const { validateCanonicalDB } = require('../../shared/validate-env');
validateCanonicalDB({ serviceName: 'wallet-service' });

const express = require('express');
const helmet = require('helmet');
const { initDB } = require('./db');
const walletRoutes = require('./routes/wallet');
const phantomRoutes = require('./routes/phantom');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(express.json());

// ── Internal-only API key guard ───────────────
app.use((req, res, next) => {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'wallet-service' }));
app.use('/wallet', walletRoutes);
app.use('/phantom', phantomRoutes);

app.use((err, req, res, next) => {
  console.error('[wallet-service]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`[wallet-service] Running on port ${PORT}`);
  });
})();
