/*
 * SKEPT AUTH WORKER
 * Magic link authentication, KV sessions, Resend email dispatch.
 * Cloudflare Worker — skept-auth
 *
 * SETUP (run once before first deploy):
 *   1. Create D1 database:
 *        wrangler d1 create skept-auth --config wrangler-auth.toml
 *      Paste returned database_id into wrangler-auth.toml
 *
 *   2. Run schema migrations (skept-auth tables only):
 *        wrangler d1 execute skept-auth --file=./skept_d1_schema_auth.sql --config wrangler-auth.toml
 *
 *   3. Create KV namespace:
 *        wrangler kv:namespace create AUTH_SESSIONS --config wrangler-auth.toml
 *        wrangler kv:namespace create AUTH_SESSIONS --preview --config wrangler-auth.toml
 *      Paste returned ids into wrangler-auth.toml
 *
 *   4. Set secrets:
 *        wrangler secret put RESEND_API_KEY --config wrangler-auth.toml
 *        wrangler secret put ENCRYPTION_KEY --config wrangler-auth.toml
 *        wrangler secret put IP_SALT --config wrangler-auth.toml
 *
 *   5. Deploy:
 *        wrangler deploy --config wrangler-auth.toml
 */

const ALLOWED_ORIGINS = [
  'https://skept.co',
  'https://www.skept.co',
  'https://skept.app',
  'https://www.skept.app',
  'http://localhost:8787',
  'http://localhost:3000',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:5500',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 3600;
const TOKEN_TTL_S = 900;      // 15 minutes
const SESSION_TTL_S = 2592000; // 30 days

// ── CRYPTO ──────────────────────────────────────────────────────────

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function importAesKey(keyB64) {
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptEmail(email, keyHex) {
  const key = await importAesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(email));
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  // btoa via char codes — safe for small payloads (email ciphertext is ~50–300 bytes)
  return btoa(String.fromCharCode(...combined));
}

async function decryptEmail(encryptedB64, keyHex) {
  const key = await importAesKey(keyHex);
  const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    key,
    combined.slice(12)
  );
  return new TextDecoder().decode(plain);
}

function randomTokenHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── HELPERS ──────────────────────────────────────────────────────────

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function jsonRes(body, status, origin, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function handlePreflight(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Accept session_id from Authorization: Bearer header or JSON body (does not re-read body).
async function extractSessionId(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  try {
    const body = await request.json();
    return body?.session_id ?? null;
  } catch {
    return null;
  }
}

// calendar-month cooldown: same day, next month — snap to last day if day doesn't exist.
// e.g. Jan 31 → Feb 28/29; Mar 31 → Apr 30.
function nextCalendarMonth(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();
  const tgtMonth = m === 11 ? 0 : m + 1;
  const tgtYear  = m === 11 ? y + 1 : y;
  const lastDay  = new Date(Date.UTC(tgtYear, tgtMonth + 1, 0)).getUTCDate();
  return Math.floor(
    new Date(Date.UTC(tgtYear, tgtMonth, Math.min(day, lastDay),
      d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).getTime() / 1000
  );
}

// ── HANDLERS ─────────────────────────────────────────────────────────

async function handleRequestLink(request, env, origin) {
  let payload;
  try { payload = await request.json(); }
  catch { return jsonRes({ error: 'invalid_json' }, 400, origin); }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return jsonRes({ error: 'invalid_email' }, 400, origin);
  }

  const emailHash = await sha256hex(email);

  // Rate limit (stored in AUTH_SESSIONS KV alongside session keys)
  const rlKey = `ratelimit:magic:${emailHash}`;
  const rlRaw = await env.AUTH_SESSIONS.get(rlKey);
  const rlCount = rlRaw ? parseInt(rlRaw, 10) : 0;
  if (rlCount >= RATE_LIMIT_MAX) {
    return jsonRes({ error: 'too_many_requests' }, 429, origin);
  }

  const ts = nowSec();

  // Tombstone check
  const tombstone = await env.SKEPT_AUTH_DB
    .prepare('SELECT id FROM tombstones WHERE email_hash = ? AND cooldown_expires_at > ?')
    .bind(emailHash, ts)
    .first();
  if (tombstone) return jsonRes({ error: 'account_deletion_cooldown' }, 429, origin);

  // User lookup or create
  let user = await env.SKEPT_AUTH_DB
    .prepare('SELECT id FROM users WHERE email_hash = ?')
    .bind(emailHash)
    .first();

  if (!user) {
    const userId = crypto.randomUUID();
    const emailEncrypted = await encryptEmail(email, env.ENCRYPTION_KEY);
    await env.SKEPT_AUTH_DB
      .prepare(
        `INSERT INTO users
           (id, email_hash, email_encrypted, display_name, avatar_initials, tier, created_at, updated_at)
         VALUES (?, ?, ?, '', '', 'free', ?, ?)`
      )
      .bind(userId, emailHash, emailEncrypted, ts, ts)
      .run();
    user = { id: userId };
  }

  // Generate token — never stored; only SHA-256(token) persisted
  const rawToken = randomTokenHex();
  const tokenHash = await sha256hex(rawToken);
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256hex(clientIp + (env.IP_SALT || ''));

  await env.SKEPT_AUTH_DB
    .prepare(
      `INSERT INTO auth_tokens (id, user_id, token_hash, type, used, expires_at, ip_hash, created_at)
       VALUES (?, ?, ?, 'magic_link', 0, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), user.id, tokenHash, ts + TOKEN_TTL_S, ipHash, ts)
    .run();

  // Increment rate limit counter
  await env.AUTH_SESSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });

  // Send magic link via Resend
  // Use `email` from request body — guaranteed equal to stored address by email_hash match
  const magicLink = `https://skept.co/?token=${rawToken}`;

  const emailText =
    `Tap this link to sign in to Skept. It expires in 15 minutes and can only be used once.\n\n` +
    `${magicLink}\n\n` +
    `If you didn't request this, you can ignore this email.`;

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#FAF8F5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:48px 20px;">
      <table cellpadding="0" cellspacing="0" border="0"
             style="max-width:480px;width:100%;font-family:Calibri,Arial,sans-serif;color:#1A1A1A;">
        <tr><td style="padding-bottom:28px;">
          <span style="font-size:22px;font-weight:bold;letter-spacing:-0.3px;">Skept</span>
        </td></tr>
        <tr><td style="font-size:16px;line-height:1.65;padding-bottom:36px;color:#1A1A1A;">
          Tap this link to sign in to Skept.
          It expires in <strong>15 minutes</strong> and can only be used once.
        </td></tr>
        <tr><td style="padding-bottom:36px;">
          <a href="${magicLink}"
             style="display:inline-block;background:#DFB87B;color:#1A1A1A;
                    font-family:Calibri,Arial,sans-serif;font-size:16px;font-weight:bold;
                    text-decoration:none;padding:13px 30px;border-radius:4px;">
            Sign in to Skept
          </a>
        </td></tr>
        <tr><td style="font-size:13px;color:#8A8A8A;
                        border-top:1px solid #E0E0E0;padding-top:20px;line-height:1.5;">
          If you didn't request this, you can safely ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@skept.co',
      to: [email],
      subject: 'Your Skept sign-in link',
      text: emailText,
      html: emailHtml,
    }),
  });

  if (!resendRes.ok) {
    let resendBody;
    try { resendBody = JSON.stringify(await resendRes.json()); }
    catch { resendBody = await resendRes.text(); }
    console.error('Resend error:', resendRes.status, resendBody);
    return jsonRes({ error: 'internal_error' }, 500, origin);
  }

  return jsonRes({ ok: true }, 200, origin);
}

async function handleVerify(request, env, url) {
  const rawToken = url.searchParams.get('token') || '';
  if (!rawToken) return verifyErrorPage('No token was provided in the link.');

  const tokenHash = await sha256hex(rawToken);
  const ts = nowSec();

  const tokenRow = await env.SKEPT_AUTH_DB
    .prepare("SELECT id, user_id, used, expires_at FROM auth_tokens WHERE token_hash = ? AND type = 'magic_link'")
    .bind(tokenHash)
    .first();

  if (!tokenRow) return verifyErrorPage('This link is invalid or has already been used. Please request a new one.');
  if (tokenRow.used === 1) return verifyErrorPage('This sign-in link has already been used. Please request a new one.');
  if (tokenRow.expires_at < ts) return verifyErrorPage('This sign-in link has expired. Please request a new one.');

  // Atomic consumption — guard against race conditions
  const updated = await env.SKEPT_AUTH_DB
    .prepare('UPDATE auth_tokens SET used=1, used_at=? WHERE id=? AND used=0')
    .bind(ts, tokenRow.id)
    .run();
  if (updated.meta.changes === 0) {
    return verifyErrorPage('This sign-in link has already been used. Please request a new one.');
  }

  // Fetch tier so Workers can read it from KV without a D1 round-trip
  const tierRow = await env.SKEPT_AUTH_DB
    .prepare('SELECT tier FROM users WHERE id = ?')
    .bind(tokenRow.user_id)
    .first();
  const tier = tierRow?.tier || 'free';

  // Create session
  const sessionId = crypto.randomUUID();
  const sessionExpires = ts + SESSION_TTL_S;
  await env.AUTH_SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({ user_id: tokenRow.user_id, tier, created_at: ts, expires_at: sessionExpires }),
    { expirationTtl: SESSION_TTL_S }
  );

  // Session audit row
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256hex(clientIp + (env.IP_SALT || ''));
  const sessionTokenHash = await sha256hex(sessionId);
  await env.SKEPT_AUTH_DB
    .prepare(
      `INSERT INTO auth_tokens (id, user_id, token_hash, type, used, expires_at, ip_hash, created_at)
       VALUES (?, ?, ?, 'session_audit', 0, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), tokenRow.user_id, sessionTokenHash, sessionExpires, ipHash, ts)
    .run();

  // Update user.updated_at
  await env.SKEPT_AUTH_DB
    .prepare('UPDATE users SET updated_at=? WHERE id=?')
    .bind(ts, tokenRow.user_id)
    .run();

  // Set httpOnly cookie and redirect to the app
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://skept.co/verify.html',
      'Set-Cookie': `skept_session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Domain=skept.co; Path=/; Max-Age=604800`,
      'Cache-Control': 'no-store',
    },
  });
}

function verifyErrorPage(message) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign-in issue — Skept</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Calibri,Arial,sans-serif;background:#FAF8F5;color:#1A1A1A;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{max-width:400px;width:100%;text-align:center}
    h1{font-size:18px;font-weight:bold;margin-bottom:12px}
    p{font-size:15px;color:#4A4A4A;line-height:1.55;margin-bottom:28px}
    a{display:inline-block;background:#DFB87B;color:#1A1A1A;font-weight:bold;
      text-decoration:none;padding:11px 26px;border-radius:4px;font-size:15px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign-in link issue</h1>
    <p>${message}</p>
    <a href="https://skept.co">Back to Skept</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleSession(request, env, origin) {
  const sessionId = await extractSessionId(request);
  if (!sessionId) return jsonRes({ error: 'session_not_found' }, 401, origin);

  const kvRaw = await env.AUTH_SESSIONS.get(`session:${sessionId}`);
  if (!kvRaw) return jsonRes({ error: 'session_not_found' }, 401, origin);

  let session;
  try { session = JSON.parse(kvRaw); }
  catch { return jsonRes({ error: 'session_not_found' }, 401, origin); }

  const user = await env.SKEPT_AUTH_DB
    .prepare(
      `SELECT id, tier, display_name, avatar_initials, theme,
              notif_analysis_done, notif_origin_found
       FROM users WHERE id = ?`
    )
    .bind(session.user_id)
    .first();

  if (!user) return jsonRes({ error: 'user_not_found' }, 401, origin);

  return jsonRes({
    user_id: user.id,
    tier: user.tier,
    display_name: user.display_name,
    avatar_initials: user.avatar_initials,
    theme: user.theme,
    notif_analysis_done: user.notif_analysis_done,
    notif_origin_found: user.notif_origin_found,
    session_expires_at: session.expires_at,
  }, 200, origin);
}

async function handleMe(request, env, origin) {
  const sessionId = getCookieValue(request, 'skept_session');
  if (!sessionId) return jsonRes({ error: 'not_authenticated' }, 401, origin);

  const kvRaw = await env.AUTH_SESSIONS.get(`session:${sessionId}`);
  if (!kvRaw) return jsonRes({ error: 'session_not_found' }, 401, origin);

  let session;
  try { session = JSON.parse(kvRaw); }
  catch { return jsonRes({ error: 'session_not_found' }, 401, origin); }

  if (!session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000)) {
    return jsonRes({ error: 'session_expired' }, 401, origin);
  }

  const user = await env.SKEPT_AUTH_DB
    .prepare('SELECT id, email_hash, tier, display_name FROM users WHERE id = ?')
    .bind(session.user_id)
    .first();
  if (!user) return jsonRes({ error: 'user_not_found' }, 401, origin);

  return jsonRes({ user_id: user.id, email_hash: user.email_hash, tier: user.tier, display_name: user.display_name }, 200, origin);
}

async function handleLogout(request, env, origin) {
  // Try cookie first, then Bearer/body session_id
  const cookieSessionId = getCookieValue(request, 'skept_session');
  if (cookieSessionId) {
    await env.AUTH_SESSIONS.delete(`session:${cookieSessionId}`);
  } else {
    const sessionId = await extractSessionId(request);
    if (sessionId) await env.AUTH_SESSIONS.delete(`session:${sessionId}`);
  }
  const clearCookie = 'skept_session=; HttpOnly; Secure; SameSite=Strict; Domain=skept.co; Path=/; Max-Age=0';
  return jsonRes({ ok: true }, 200, origin, { 'Set-Cookie': clearCookie });
}

async function handleDeleteAccount(request, env, origin) {
  const sessionId = await extractSessionId(request);
  if (!sessionId) return jsonRes({ error: 'session_not_found' }, 401, origin);

  const kvRaw = await env.AUTH_SESSIONS.get(`session:${sessionId}`);
  if (!kvRaw) return jsonRes({ error: 'session_not_found' }, 401, origin);

  let session;
  try { session = JSON.parse(kvRaw); }
  catch { return jsonRes({ error: 'session_not_found' }, 401, origin); }

  const user = await env.SKEPT_AUTH_DB
    .prepare('SELECT id, email_hash, tier, subscription_ref FROM users WHERE id = ?')
    .bind(session.user_id)
    .first();
  if (!user) return jsonRes({ error: 'user_not_found' }, 401, origin);

  const ts = nowSec();
  // ever_paid: currently on a paid tier OR has a subscription_ref (has held paid at any point)
  const everPaid = (user.tier !== 'free' || user.subscription_ref !== null) ? 1 : 0;
  const cooldownExpiresAt = everPaid === 1 ? nextCalendarMonth(ts) : ts + 86400;

  await env.SKEPT_AUTH_DB
    .prepare(
      `INSERT INTO tombstones (id, email_hash, device_fingerprint, ever_paid, deletion_timestamp, cooldown_expires_at)
       VALUES (?, ?, NULL, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), user.email_hash, everPaid, ts, cooldownExpiresAt)
    .run();

  // Delete auth_tokens explicitly before users (avoids FK CASCADE dependency on D1 pragma state)
  await env.SKEPT_AUTH_DB
    .prepare('DELETE FROM auth_tokens WHERE user_id = ?')
    .bind(user.id)
    .run();

  await env.SKEPT_AUTH_DB
    .prepare('DELETE FROM users WHERE id = ?')
    .bind(user.id)
    .run();

  await env.AUTH_SESSIONS.delete(`session:${sessionId}`);

  return jsonRes({ ok: true, cooldown_expires_at: cooldownExpiresAt }, 200, origin);
}

async function handleVerifyPost(request, env, origin) {
  let payload;
  try { payload = await request.json(); }
  catch { return jsonRes({ error: 'invalid_json' }, 400, origin); }

  const rawToken = String(payload.token || '').trim();
  if (!rawToken) return jsonRes({ error: 'missing_token' }, 400, origin);

  const tokenHash = await sha256hex(rawToken);
  const ts = nowSec();

  const tokenRow = await env.SKEPT_AUTH_DB
    .prepare("SELECT id, user_id, used, expires_at FROM auth_tokens WHERE token_hash = ? AND type = 'magic_link'")
    .bind(tokenHash)
    .first();

  if (!tokenRow) return jsonRes({ error: 'invalid_token' }, 401, origin);
  if (tokenRow.used === 1) return jsonRes({ error: 'token_already_used' }, 401, origin);
  if (tokenRow.expires_at < ts) return jsonRes({ error: 'token_expired' }, 401, origin);

  const updated = await env.SKEPT_AUTH_DB
    .prepare('UPDATE auth_tokens SET used=1, used_at=? WHERE id=? AND used=0')
    .bind(ts, tokenRow.id)
    .run();
  if (updated.meta.changes === 0) return jsonRes({ error: 'token_already_used' }, 401, origin);

  const tierRow = await env.SKEPT_AUTH_DB
    .prepare('SELECT tier FROM users WHERE id = ?')
    .bind(tokenRow.user_id)
    .first();
  const tier = tierRow?.tier || 'free';

  const sessionId = crypto.randomUUID();
  const sessionExpires = ts + SESSION_TTL_S;
  await env.AUTH_SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({ user_id: tokenRow.user_id, tier, created_at: ts, expires_at: sessionExpires }),
    { expirationTtl: SESSION_TTL_S }
  );

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256hex(clientIp + (env.IP_SALT || ''));
  const sessionTokenHash = await sha256hex(sessionId);
  await env.SKEPT_AUTH_DB
    .prepare(
      `INSERT INTO auth_tokens (id, user_id, token_hash, type, used, expires_at, ip_hash, created_at)
       VALUES (?, ?, ?, 'session_audit', 0, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), tokenRow.user_id, sessionTokenHash, sessionExpires, ipHash, ts)
    .run();

  await env.SKEPT_AUTH_DB
    .prepare('UPDATE users SET updated_at=? WHERE id=?')
    .bind(ts, tokenRow.user_id)
    .run();

  const cookie = `skept_session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Domain=skept.co; Path=/; Max-Age=604800`;
  return jsonRes({ ok: true }, 200, origin, { 'Set-Cookie': cookie });
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return handlePreflight(origin);

    try {
      const m = request.method;
      const p = url.pathname;

      if (m === 'POST' && p === '/api/auth/request')        return await handleRequestLink(request, env, origin);
      if (m === 'POST' && p === '/api/auth/request-link')  return await handleRequestLink(request, env, origin);
      if (m === 'POST' && p === '/api/auth/verify')         return await handleVerifyPost(request, env, origin);
      if (m === 'GET'  && p === '/api/auth/verify')         return await handleVerify(request, env, url);
      if (m === 'GET'  && p === '/api/auth/me')             return await handleMe(request, env, origin);
      if (m === 'POST' && p === '/api/auth/session')        return await handleSession(request, env, origin);
      if (m === 'POST' && p === '/api/auth/logout')         return await handleLogout(request, env, origin);
      if (m === 'POST' && p === '/api/auth/delete-account') return await handleDeleteAccount(request, env, origin);

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('Worker unhandled error:', err);
      return jsonRes({ error: 'internal_error' }, 500, origin);
    }
  },
};
