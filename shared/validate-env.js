'use strict';

/**
 * shared/validate-env.js
 * Call at the very top of each service's index.js before anything else.
 * Exits with code 1 and a clear message if any required var is missing.
 *
 * Usage:
 *   require('../../shared/validate-env')(['JWT_SECRET', 'DB_HOST', 'DB_PASS']);
 */
module.exports = function validateEnv(required) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `\n[startup] ❌ Missing required environment variables:\n${missing.map((k) => `  • ${k}`).join('\n')}\n` +
      `  Set these in your .env file or Docker environment before starting.\n`
    );
    process.exit(1);
  }
};
