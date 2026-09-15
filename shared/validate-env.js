'use strict';

/**
 * shared/validate-env.js
 *
 * Two startup-time guardrails. Call BOTH at the very top of each service's
 * index.js (before requiring any DB driver, before reading req).
 *
 *   const { validateEnv, validateCanonicalDB } = require('../../shared/validate-env');
 *   validateEnv(['JWT_SECRET', 'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD']);
 *   validateCanonicalDB({ serviceName: 'grudge-id' });
 *
 * Either failure exits with code 1 and a clear message — refusing to start
 * the service is a feature, not a bug. Don't catch and ignore.
 */

/**
 * validateEnv(required)
 * Backward-compatible default export. Refuses to start if any of the
 * named env vars is missing.
 *
 * @param {string[]} required - Names of env vars that must be set.
 */
function validateEnv(required) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `\n[startup] ❌ Missing required environment variables:\n${missing.map((k) => `  • ${k}`).join('\n')}\n` +
      `  Set these in your .env file or Docker environment before starting.\n`
    );
    process.exit(1);
  }
}

/**
 * validateCanonicalDB(opts)
 *
 * Enforces the Account Database Rules (see docs/ACCOUNT-DATABASE-RULES.md):
 *
 *   • The canonical user-account store is MySQL `grudge_game` on the
 *     production VPS, written through `grudge-id`.
 *   • Services that touch user accounts MUST NOT have alternate DB
 *     credentials in their environment.
 *
 * If any forbidden env var is set, this function prints the offenders and
 * exits with code 1. The service does not start. That is intentional.
 *
 * @param {object} opts
 * @param {string} opts.serviceName    - Used in the error message.
 * @param {boolean} [opts.requireMysql=true] - When true (default), also
 *                                            require MYSQL_HOST/DATABASE/USER/PASSWORD.
 * @param {string[]} [opts.allow=[]]   - Env-var names to whitelist.
 *                                       Use only with a comment in the call
 *                                       site explaining the documented exception.
 */
function validateCanonicalDB(opts) {
  opts = opts || {};
  const serviceName = opts.serviceName || 'service';
  const allow = new Set(opts.allow || []);

  // Hard-forbidden: presence of these env vars means the service has been
  // mis-wired to an alternate account store. The service must refuse to start.
  const FORBIDDEN_VARS = [
    'GRUDGE_ACCOUNT_DB',
    'GRUDGE_ACCOUNT_DB_UNPOOLED',
    'NEON_DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const offenders = FORBIDDEN_VARS
    .filter((k) => process.env[k] && !allow.has(k));

  // DATABASE_URL is OK for non-account uses, but if it points at neon.tech
  // or supabase.co the service is going to drift to a non-canonical store.
  const dbUrl = process.env.DATABASE_URL;
  if (
    dbUrl &&
    /neon\.tech|supabase\.co/.test(dbUrl) &&
    !allow.has('DATABASE_URL')
  ) {
    offenders.push(
      'DATABASE_URL (points at Neon/Supabase — see docs/ACCOUNT-DATABASE-RULES.md)'
    );
  }

  if (offenders.length > 0) {
    console.error(
      `\n[startup] ❌ ${serviceName} is configured with FORBIDDEN database credentials:\n` +
      offenders.map((k) => `  • ${k}`).join('\n') + '\n' +
      `\n  This service writes user accounts and must use ONLY MySQL grudge_game.\n` +
      `  Either remove the offending env var(s), or document a whitelisted exception\n` +
      `  in docs/ACCOUNT-DATABASE-RULES.md and pass { allow: [...] } to validateCanonicalDB.\n`
    );
    process.exit(1);
  }

  if (opts.requireMysql !== false) {
    const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.error(
        `\n[startup] ❌ ${serviceName} is missing canonical MySQL env vars:\n` +
        missing.map((k) => `  • ${k}`).join('\n') + '\n' +
        `  See: docs/ACCOUNT-DATABASE-RULES.md\n`
      );
      process.exit(1);
    }
  }
}

// Default export keeps the legacy require() pattern working:
//   require('../../shared/validate-env')(['JWT_SECRET', ...])
module.exports = validateEnv;
// Named exports for the new pattern:
module.exports.validateEnv = validateEnv;
module.exports.validateCanonicalDB = validateCanonicalDB;
