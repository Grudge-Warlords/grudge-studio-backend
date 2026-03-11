/**
 * Cloudflare Turnstile — server-side verification middleware
 *
 * Free service: unlimited challenges, no credit card needed.
 * Replaces reCAPTCHA / hCaptcha with a privacy-friendly, friction-free widget.
 *
 * Dashboard setup (one-time):
 *   https://dash.cloudflare.com → Turnstile → Add Site
 *   Site keys:
 *     Domain    : grudgestudio.com (+ grudgewarlords.com)
 *     Widget type: Managed (invisible challenge, no user interaction needed)
 *   Copy:
 *     Site Key   → CF_TURNSTILE_SITE_KEY  (put in frontend .env / HTML)
 *     Secret Key → CF_TURNSTILE_SECRET_KEY (put in backend .env)
 *
 * Frontend usage:
 *   <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
 *   <div class="cf-turnstile" data-sitekey="<CF_TURNSTILE_SITE_KEY>"></div>
 *   // On form submit, the widget injects `cf-turnstile-response` into the form.
 *   // For programmatic use: window.turnstile.getResponse()
 *   // Pass as `cf_turnstile_token` in the POST body.
 *
 * Backend — apply this middleware to any endpoint you want to protect:
 *   router.post('/wallet', verifyTurnstile, handler);
 */

const axios = require('axios');

const VERIFY_URL     = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SECRET_KEY     = process.env.CF_TURNSTILE_SECRET_KEY;
// Skip in dev/test if secret not configured — fail open so local dev isn't blocked
const IS_ENABLED     = !!SECRET_KEY && process.env.NODE_ENV === 'production';

/**
 * Express middleware — reads `cf_turnstile_token` from request body,
 * verifies it with Cloudflare, rejects bots with 403.
 *
 * The token field name matches the default form field injected by the Turnstile widget.
 */
async function verifyTurnstile(req, res, next) {
  if (!IS_ENABLED) {
    // Dev / staging — skip challenge
    return next();
  }

  const token = req.body?.cf_turnstile_token;

  if (!token) {
    return res.status(400).json({
      error: 'Bot challenge token missing. Include cf_turnstile_token in request body.',
    });
  }

  try {
    const { data } = await axios.post(
      VERIFY_URL,
      new URLSearchParams({
        secret:   SECRET_KEY,
        response: token,
        // CF-Connecting-IP is set by Cloudflare when traffic is proxied
        remoteip: req.headers['cf-connecting-ip'] ?? req.ip ?? '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }
    );

    if (!data.success) {
      console.warn('[turnstile] challenge failed — error-codes:', data['error-codes']);
      return res.status(403).json({
        error: 'Bot challenge failed. Please try again.',
        codes: data['error-codes'],
      });
    }

    // Attach verification result to request for downstream logging
    req.turnstile = {
      hostname:    data.hostname,
      challenge_ts: data.challenge_ts,
      action:      data.action,
    };

    return next();
  } catch (err) {
    // Fail open — don't block real users if Cloudflare's API is unreachable
    console.error('[turnstile] verification request failed:', err.message);
    return next();
  }
}

module.exports = { verifyTurnstile };
