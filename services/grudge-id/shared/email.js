'use strict';

/**
 * shared/email.js — Grudge Studio transactional email via Resend
 *
 * Uses native fetch (Node 18+). No npm package needed.
 * Set RESEND_API_KEY in your environment.
 * If the key is missing, emails are silently skipped (safe for dev).
 *
 * Usage:
 *   const { sendEmail } = require('../../shared/email');
 *   await sendEmail({ to: 'user@example.com', subject: '...', html: '...' });
 */

const FROM = process.env.EMAIL_FROM || 'Grudge Studio <noreply@grudge-studio.com>';
const RESEND_API = 'https://api.resend.com/emails';

/**
 * Send a transactional email.
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, skipped?: boolean }>}
 */
async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', to);
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend error', res.status, body);
      return { ok: false, error: body };
    }

    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] fetch error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendEmail, FROM };
