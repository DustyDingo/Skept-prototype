import { getTier } from './tier-config.js';

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

  return { session };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
      const { session } = authResult;
      const { user_id: userId, tier } = session;
      const tierConfig = getTier(tier);

      // GET /api/history  or  GET /api/history/list
      if (method === 'GET' && (pathname === '/api/history' || pathname === '/api/history/list')) {
        const TIER_QUOTA = { free: 5, lite: 10, plus: 20, pro: 40, max: 60 };
        let quota_used = 0;
        let quota_limit = TIER_QUOTA[tier] ?? 5;
        try {
          const quotaRow = await env.SKEPT_ANALYSIS_DB.prepare(
            'SELECT quota_used, quota_limit FROM quota_usage WHERE user_id = ?'
          ).bind(userId).first();
          if (quotaRow) {
            quota_used = quotaRow.quota_used ?? 0;
            quota_limit = quotaRow.quota_limit ?? quota_limit;
          }
        } catch (quotaErr) {
          console.error('[history-worker] quota fetch failed, defaulting:', quotaErr.message);
        }

        const { results } = await env.SKEPT_ANALYSIS_DB.prepare(`
          SELECT id, verdict_state, score, platform, clip_url, thumbnail_r2_key,
                 strongest_signal, run_depth, tier_at_creation, created_at,
                 permalink_uuid, evidence_json, conflict_flags, model_version
          FROM analysis_history
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 50
        `).bind(userId).all();

        const entries = results.map(row => {
          const entry = {
            id: row.id,
            verdict_state: row.verdict_state,
            score: row.score,
            platform: row.platform,
            clip_url: row.clip_url,
            thumbnail_r2_key: row.thumbnail_r2_key,
            strongest_signal: row.strongest_signal,
            run_depth: row.run_depth,
            created_at: row.created_at,
          };
          if (tierConfig.permalink) {
            entry.permalink_uuid = row.permalink_uuid;
          }
          if (tierConfig.evidenceJson) {
            entry.evidence_json = row.evidence_json;
            entry.conflict_flags = row.conflict_flags;
            entry.model_version = row.model_version;
          }
          return entry;
        });

        return json({ quota_used, quota_limit, entries });
      }

      // DELETE /api/history/:id
      const singleMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
      if (method === 'DELETE' && singleMatch) {
        const entryId = singleMatch[1];

        const row = await env.SKEPT_ANALYSIS_DB.prepare(
          'SELECT user_id FROM analysis_history WHERE id = ?'
        ).bind(entryId).first();

        if (!row || row.user_id !== userId) {
          return json({ error: 'not_found' }, 404);
        }

        const seal = await env.SKEPT_ANALYSIS_DB.prepare(
          'SELECT id FROM seals WHERE analysis_history_id = ? LIMIT 1'
        ).bind(entryId).first();

        if (seal) {
          return json(
            { error: 'entry_has_seal', message: 'This entry has a published seal and cannot be deleted.' },
            409
          );
        }

        await env.SKEPT_ANALYSIS_DB.prepare(
          'DELETE FROM analysis_history WHERE id = ? AND user_id = ?'
        ).bind(entryId, userId).run();

        return json({ deleted: entryId });
      }

      // DELETE /api/history (full wipe)
      if (method === 'DELETE' && pathname === '/api/history') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        if (!body?.confirm) {
          return json({ error: 'confirm_required' }, 400);
        }

        const { results: sealedRows } = await env.SKEPT_ANALYSIS_DB.prepare(
          'SELECT analysis_history_id FROM seals WHERE user_id = ?'
        ).bind(userId).all();

        const sealedIds = sealedRows.map(r => r.analysis_history_id);

        let deletedCount;
        if (sealedIds.length > 0) {
          const placeholders = sealedIds.map(() => '?').join(', ');
          const result = await env.SKEPT_ANALYSIS_DB.prepare(
            `DELETE FROM analysis_history WHERE user_id = ? AND id NOT IN (${placeholders})`
          ).bind(userId, ...sealedIds).run();
          deletedCount = result.meta?.changes ?? 0;
        } else {
          const result = await env.SKEPT_ANALYSIS_DB.prepare(
            'DELETE FROM analysis_history WHERE user_id = ?'
          ).bind(userId).run();
          deletedCount = result.meta?.changes ?? 0;
        }

        return json({ deleted_count: deletedCount, skipped_sealed: sealedIds.length });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('[history-worker] unhandled error:', err.message);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
