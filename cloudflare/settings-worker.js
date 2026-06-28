import { getTier } from './tier-config.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function authenticate(request, AUTH_SESSIONS) {
  let kvKey;
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    kvKey = `session:${authHeader.slice(7).trim()}`;
  } else {
    const cookieId = getCookieValue(request, 'skept_session');
    if (cookieId) kvKey = `session:${cookieId}`;
  }
  if (!kvKey) return { error: 'missing_token', status: 401 };

  const raw = await AUTH_SESSIONS.get(kvKey);
  if (!raw) return { error: 'invalid_token', status: 401 };

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return { error: 'invalid_token', status: 401 };
  }

  if (!session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000)) {
    return { error: 'token_expired', status: 401 };
  }

  return { session, token: kvKey };
}

function computeInitials(displayName) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ENCRYPTION_KEY is a base64-encoded 32-byte key.
// email_encrypted is stored as base64(IV[12 bytes] + ciphertext + GCM tag[16 bytes]).
async function decryptEmail(encryptedBase64, encryptionKeyBase64) {
  const keyBytes = Uint8Array.from(atob(encryptionKeyBase64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const buf = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const ciphertext = buf.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(ip + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns same calendar day next month; snaps to last day of month if target month is shorter.
function nextMonthSameDay(nowMs) {
  const d = new Date(nowMs);
  const origDay = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== origDay) d.setDate(0);
  return d.getTime();
}

async function readProfile(db, userId, encryptionKey) {
  const row = await db.prepare(`
    SELECT display_name, avatar_initials, email_encrypted, tier, tier_expires_at,
           subscription_source, notif_analysis_done, notif_origin_found, theme
    FROM users WHERE id = ?
  `).bind(userId).first();
  if (!row) return null;

  const email = await decryptEmail(row.email_encrypted, encryptionKey);
  return {
    displayName: row.display_name,
    avatarInitials: row.avatar_initials,
    email,
    tier: row.tier,
    tierExpiresAt: row.tier_expires_at,
    subscriptionSource: row.subscription_source,
    notifAnalysisDone: row.notif_analysis_done,
    notifOriginFound: row.notif_origin_found,
    theme: row.theme,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      const authResult = await authenticate(request, env.AUTH_SESSIONS);
      if (authResult.error) {
        return json({ error: authResult.error }, authResult.status);
      }
      const { session, token } = authResult;
      const { user_id: userId } = session;

      // GET /api/settings/profile
      if (method === 'GET' && pathname === '/api/settings/profile') {
        const profile = await readProfile(env.SKEPT_AUTH_DB, userId, env.ENCRYPTION_KEY);
        if (!profile) return json({ error: 'user_not_found' }, 404);
        console.log(`[settings] GET /profile userId=${userId} ok`);
        return json(profile);
      }

      // PATCH /api/settings/profile
      if (method === 'PATCH' && pathname === '/api/settings/profile') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        const setClauses = [];
        const bindValues = [];

        if ('displayName' in body) {
          if (typeof body.displayName !== 'string' || body.displayName.length > 64) {
            return json({ error: 'invalid_display_name' }, 400);
          }
          setClauses.push('display_name = ?');
          bindValues.push(body.displayName);
          setClauses.push('avatar_initials = ?');
          bindValues.push(computeInitials(body.displayName));
        }

        if ('theme' in body) {
          if (!['system', 'light', 'dark'].includes(body.theme)) {
            return json({ error: 'invalid_theme' }, 400);
          }
          setClauses.push('theme = ?');
          bindValues.push(body.theme);
        }

        if ('notifAnalysisDone' in body) {
          if (body.notifAnalysisDone !== 0 && body.notifAnalysisDone !== 1) {
            return json({ error: 'invalid_notif_analysis_done' }, 400);
          }
          setClauses.push('notif_analysis_done = ?');
          bindValues.push(body.notifAnalysisDone);
        }

        if ('notifOriginFound' in body) {
          if (body.notifOriginFound !== 0 && body.notifOriginFound !== 1) {
            return json({ error: 'invalid_notif_origin_found' }, 400);
          }
          setClauses.push('notif_origin_found = ?');
          bindValues.push(body.notifOriginFound);
        }

        if (setClauses.length === 0) {
          return json({ error: 'no_fields_to_update' }, 400);
        }

        const now = Math.floor(Date.now() / 1000);
        setClauses.push('updated_at = ?');
        bindValues.push(now);
        bindValues.push(userId);

        await env.SKEPT_AUTH_DB.prepare(
          `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`
        ).bind(...bindValues).run();

        const updated = await readProfile(env.SKEPT_AUTH_DB, userId, env.ENCRYPTION_KEY);
        console.log(`[settings] PATCH /profile userId=${userId} ok`);
        return json(updated);
      }

      // GET /api/settings/subscription
      if (method === 'GET' && pathname === '/api/settings/subscription') {
        const [userRow, quotaRow] = await Promise.all([
          env.SKEPT_AUTH_DB.prepare(
            'SELECT tier, tier_expires_at, subscription_source, subscription_ref FROM users WHERE id = ?'
          ).bind(userId).first(),
          env.SKEPT_ANALYSIS_DB.prepare(
            'SELECT run_count FROM quota_usage WHERE user_id = ?'
          ).bind(userId).first(),
        ]);

        if (!userRow) return json({ error: 'user_not_found' }, 404);

        const tierConfig = getTier(userRow.tier);
        console.log(`[settings] GET /subscription userId=${userId} ok`);
        return json({
          tier: userRow.tier,
          tierExpiresAt: userRow.tier_expires_at,
          subscriptionSource: userRow.subscription_source,
          subscriptionRef: userRow.subscription_ref,
          runsThisMonth: quotaRow ? quotaRow.run_count : 0,
          runsLimit: tierConfig.quota,
        });
      }

      // POST /api/settings/export
      if (method === 'POST' && pathname === '/api/settings/export') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        if (!['json', 'csv'].includes(body.format)) {
          return json({ error: 'invalid_format' }, 400);
        }

        const [userRow, historyResult, quotaRow] = await Promise.all([
          env.SKEPT_AUTH_DB.prepare(
            'SELECT display_name, email_encrypted, tier, tier_expires_at, subscription_source, created_at FROM users WHERE id = ?'
          ).bind(userId).first(),
          env.SKEPT_ANALYSIS_DB.prepare(
            'SELECT id, clip_url, verdict_state, score, platform, created_at, purge_after FROM analysis_history WHERE user_id = ? ORDER BY created_at DESC'
          ).bind(userId).all(),
          env.SKEPT_ANALYSIS_DB.prepare(
            'SELECT run_count, window_start FROM quota_usage WHERE user_id = ?'
          ).bind(userId).first(),
        ]);

        if (!userRow) return json({ error: 'user_not_found' }, 404);

        const email = await decryptEmail(userRow.email_encrypted, env.ENCRYPTION_KEY);

        const profile = {
          displayName: userRow.display_name,
          email,
          tier: userRow.tier,
          tierExpiresAt: userRow.tier_expires_at,
          subscriptionSource: userRow.subscription_source,
          createdAt: userRow.created_at,
        };

        const quota = quotaRow
          ? { runCount: quotaRow.run_count, windowStart: quotaRow.window_start }
          : { runCount: 0, windowStart: null };

        const analysisHistory = (historyResult.results || []).map(row => ({
          id: row.id,
          clipUrl: row.clip_url,
          verdictState: row.verdict_state,
          score: row.score,
          platform: row.platform,
          createdAt: row.created_at,
          purgeAfter: row.purge_after,
        }));

        const exportedAt = new Date().toISOString();
        console.log(`[settings] POST /export userId=${userId} format=${body.format} entries=${analysisHistory.length}`);

        if (body.format === 'json') {
          return new Response(
            JSON.stringify({ exported_at: exportedAt, profile, quota, analysisHistory }, null, 2),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': 'attachment; filename="skept-export.json"',
              },
            }
          );
        }

        // CSV — one row per analysis entry, profile columns repeated
        const csvHeaders = [
          'id', 'clipUrl', 'verdictState', 'score', 'platform', 'createdAt', 'purgeAfter',
          'displayName', 'email', 'tier', 'tierExpiresAt', 'subscriptionSource', 'accountCreatedAt',
        ];

        const escapeCell = v => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return (s.includes(',') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
        };

        const rows = analysisHistory.map(entry =>
          [
            entry.id, entry.clipUrl, entry.verdictState, entry.score,
            entry.platform, entry.createdAt, entry.purgeAfter,
            profile.displayName, profile.email, profile.tier,
            profile.tierExpiresAt, profile.subscriptionSource, profile.createdAt,
          ].map(escapeCell).join(',')
        );

        const csv = [csvHeaders.join(','), ...rows].join('\n');
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="skept-export.csv"',
          },
        });
      }

      // DELETE /api/settings/account
      if (method === 'DELETE' && pathname === '/api/settings/account') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        if (!body?.confirm) {
          return json({ error: 'confirm_required' }, 400);
        }

        const userRow = await env.SKEPT_AUTH_DB.prepare(
          'SELECT email_hash, tier, subscription_ref, subscription_source FROM users WHERE id = ?'
        ).bind(userId).first();

        if (!userRow) return json({ error: 'user_not_found' }, 404);

        // Step 1 — check for live tombstone
        const nowSec = Math.floor(Date.now() / 1000);
        const existingTombstone = await env.SKEPT_AUTH_DB.prepare(
          'SELECT id FROM tombstones WHERE email_hash = ? AND cooldown_expires_at > ? LIMIT 1'
        ).bind(userRow.email_hash, nowSec).first();

        if (existingTombstone) {
          return json({ error: 'active_tombstone' }, 409);
        }

        // Step 2 — compute cooldown (unix seconds)
        const paidTiers = ['plus', 'pro', 'max'];
        const cooldownExpiresAt = paidTiers.includes(userRow.tier)
          ? Math.floor(nextMonthSameDay(Date.now()) / 1000)
          : nowSec + 24 * 60 * 60;

        // Step 4 — insert tombstone
        const ip = request.headers.get('CF-Connecting-IP') || '';
        const deviceFingerprint = await hashIp(ip, env.IP_SALT || '');

        await env.SKEPT_AUTH_DB.prepare(`
          INSERT INTO tombstones
            (id, email_hash, device_fingerprint, held_paid_tier, cooldown_expires_at, deleted_at, subscription_history)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          userRow.email_hash,
          deviceFingerprint,
          paidTiers.includes(userRow.tier) ? 1 : 0,
          cooldownExpiresAt,
          nowSec,
          JSON.stringify({
            tier: userRow.tier,
            subscriptionSource: userRow.subscription_source,
            subscriptionRef: userRow.subscription_ref,
          })
        ).run();

        // Step 5 — delete auth_tokens
        await env.SKEPT_AUTH_DB.prepare(
          'DELETE FROM auth_tokens WHERE user_id = ?'
        ).bind(userId).run();

        // Step 6 — delete unsealed analysis_history
        const { results: sealedRows } = await env.SKEPT_ANALYSIS_DB.prepare(
          'SELECT analysis_history_id FROM seals WHERE user_id = ?'
        ).bind(userId).all();

        const sealedIds = sealedRows.map(r => r.analysis_history_id);

        if (sealedIds.length > 0) {
          const placeholders = sealedIds.map(() => '?').join(', ');
          await env.SKEPT_ANALYSIS_DB.prepare(
            `DELETE FROM analysis_history WHERE user_id = ? AND id NOT IN (${placeholders})`
          ).bind(userId, ...sealedIds).run();
        } else {
          await env.SKEPT_ANALYSIS_DB.prepare(
            'DELETE FROM analysis_history WHERE user_id = ?'
          ).bind(userId).run();
        }

        // Step 7 — delete quota_usage
        await env.SKEPT_ANALYSIS_DB.prepare(
          'DELETE FROM quota_usage WHERE user_id = ?'
        ).bind(userId).run();

        // Step 8 — delete user record
        await env.SKEPT_AUTH_DB.prepare(
          'DELETE FROM users WHERE id = ?'
        ).bind(userId).run();

        // Step 9 — invalidate KV session
        await env.AUTH_SESSIONS.delete(token);

        console.log(`[settings] DELETE /account userId=${userId} ok cooldownExpiresAt=${cooldownExpiresAt}`);
        return json({ deleted: true, cooldownExpiresAt });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('[settings] unhandled error:', err.message);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
