/**
 * Grudge Studio — Centralized Event Logger
 *
 * Sends structured events to the dashboard worker (D1) and optionally Discord.
 * Usage:
 *   const { logEvent, logError } = require('@grudge-studio/shared/logEvent');
 *   await logEvent('game-api', 'startup', { port: 3003 });
 *   await logError('game-api', err);
 */

const DASH_URL = process.env.DASH_EVENT_URL || 'https://dash.grudge-studio.com/api/event';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'unknown';

// Fire-and-forget — never block the caller
async function logEvent(service, event, payload = null) {
  try {
    const body = JSON.stringify({
      service: service || SERVICE_NAME,
      event,
      payload: typeof payload === 'object' ? payload : { message: payload },
    });
    await fetch(DASH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': INTERNAL_KEY,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silent fail — logging should never break the service
  }
}

// Convenience for errors — extracts message + stack
async function logError(service, err, context = {}) {
  return logEvent(service || SERVICE_NAME, 'error', {
    message: err?.message || String(err),
    stack: err?.stack?.split('\n').slice(0, 5).join('\n') || null,
    ...context,
  });
}

// Lifecycle events
async function logStartup(service, details = {}) {
  return logEvent(service || SERVICE_NAME, 'startup', details);
}

async function logShutdown(service, details = {}) {
  return logEvent(service || SERVICE_NAME, 'shutdown', details);
}

module.exports = { logEvent, logError, logStartup, logShutdown };
