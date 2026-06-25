import { fuse } from './fusion.js';

const TIER_CAPS = { free: 5, plus: 20, pro: 50, max: 100 };
const WINDOW_SECONDS = 2_592_000; // 30 days

function derivePlatform(url) {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname === 'youtu.be' || hostname.includes('youtube.com')) return 'youtube';
    if (hostname === 'cdn.discordapp.com') return 'discord';
  } catch {
    // ignore
  }
  return 'unknown';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rawToSuspicion(raw) {
  return clamp((raw + 1.0) / 2.0, 0.0, 1.0);
}

function depthConfig(tier) {
  const segments6 = [{ start: 0, duration: 6 }];
  const segmentsMid = { start: 'mid', duration: 6 };
  const segmentsTail = { start: 'tail', duration: 6 };

  if (tier === 'free') {
    return { segments: segments6, priority_queue: false };
  }
  if (tier === 'plus' || tier === 'pro') {
    return { segments: [...segments6, segmentsMid], priority_queue: false };
  }
  // max
  return { segments: [...segments6, segmentsMid, segmentsTail], priority_queue: true };
}

async function authenticate(request, AUTH_SESSIONS) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'missing_token', status: 401 };

  const raw = await AUTH_SESSIONS.get(token);
  if (!raw) return { error: 'invalid_token', status: 401 };

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return { error: 'invalid_token', status: 401 };
  }

  if (!session.expires_at || session.expires_at <= Date.now()) {
    return { error: 'token_expired', status: 401 };
  }

  return { session };
}

async function checkQuota(db, userId, tier) {
  const now = Math.floor(Date.now() / 1000);
  const cap = TIER_CAPS[tier] ?? TIER_CAPS.free;

  const row = await db.prepare(
    'SELECT run_count, window_start FROM quota_usage WHERE user_id = ?'
  ).bind(userId).first();

  if (!row) return { ok: true };

  const windowExpired = now - row.window_start >= WINDOW_SECONDS;
  if (windowExpired) {
    await db.prepare(
      'UPDATE quota_usage SET run_count = 0, window_start = ?, updated_at = ? WHERE user_id = ?'
    ).bind(now, now, userId).run();
    return { ok: true };
  }

  if (row.run_count >= cap) {
    return { ok: false, run_count: row.run_count, cap, tier };
  }

  return { ok: true };
}

async function callIngest(ingestUrl, ingestSecret, clipUrl, jobId) {
  const res = await fetch(`${ingestUrl}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ingestSecret}`,
    },
    body: JSON.stringify({ url: clipUrl, job_id: jobId }),
  });

  if (!res.ok) return { error: true };
  return res.json();
}

async function callResemble(apiKey, clipUrl) {
  const res = await fetch('https://api.resemble.ai/v2/detect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url: clipUrl, content_type: 'video' }),
  });

  if (!res.ok) throw new Error(`Resemble API error: ${res.status}`);
  return res.json();
}

async function incrementQuota(db, userId) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO quota_usage (user_id, run_count, window_start, updated_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      run_count  = run_count + 1,
      updated_at = excluded.updated_at
  `).bind(userId, now, now).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/api/verify') {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Step 1 — Auth
      const authResult = await authenticate(request, env.AUTH_SESSIONS);
      if (authResult.error) {
        return new Response(JSON.stringify({ error: authResult.error }), {
          status: authResult.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const { session } = authResult;
      const { user_id: userId, tier } = session;

      // Step 2 — Quota check
      const quota = await checkQuota(env.SKEPT_ANALYSIS_DB, userId, tier);
      if (!quota.ok) {
        return new Response(
          JSON.stringify({ error: 'quota_exceeded', tier: quota.tier, run_count: quota.run_count, cap: quota.cap }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Parse body
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_json' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { url: clipUrl } = body;
      if (!clipUrl) {
        return new Response(JSON.stringify({ error: 'url_required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 3 — Depth config
      const { segments, priority_queue: priorityQueue } = depthConfig(tier);

      // Step 4 — Ingestion
      const jobId = crypto.randomUUID();
      const ingestResult = await callIngest(
        env.INGEST_WORKER_URL,
        env.INGEST_SECRET,
        clipUrl,
        jobId
      );
      if (ingestResult.error) {
        return new Response(JSON.stringify({ error: 'ingestion_failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const r2Key = ingestResult.key;

      // Step 5 — Resemble API
      let resembleData;
      try {
        resembleData = await callResemble(env.RESEMBLE_API_KEY, clipUrl);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'analysis_failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const item = resembleData.item;
      const videoScoreRaw = item?.video_metrics?.score ?? null;
      const audioScoreRaw = item?.metrics?.aggregated_score ?? null;
      const c2paResult = item?.c2pa ?? null;

      const videoSuspicion = videoScoreRaw !== null ? rawToSuspicion(videoScoreRaw) : null;
      // No-speech sentinel: both audio scores -1.0 → null
      const audioSuspicion = audioScoreRaw === -1.0 ? null : (audioScoreRaw !== null ? rawToSuspicion(audioScoreRaw) : null);

      // Step 6 — Fusion
      const fuseResult = fuse({
        deepfake: { score: videoSuspicion, weight: 0.60 },
        audio:    { score: audioSuspicion, weight: 0.35 },
        c2pa:     { score: null,           weight: 0.40 },
      });

      const { score, verdict, pillar_detail, exclusion_reasons } = fuseResult;

      // Step 7 — Write analysis_history
      const analysisId = crypto.randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);
      const purgeAfter = createdAt + 15_552_000;
      const platform = derivePlatform(clipUrl);

      function mapVerdict(fusionVerdict) {
        const map = {
          likely_authentic:   'authentic',
          inconclusive:       'ambiguous',
          likely_manipulated: 'manipulated',
          insufficient_data:  'ambiguous',
        };
        return map[fusionVerdict] ?? 'ambiguous';
      }

      const run_depth = segments.length === 1 ? '6s' : segments.length === 2 ? '12s' : '18s';

      await env.SKEPT_ANALYSIS_DB.prepare(`
        INSERT INTO analysis_history (
          id, user_id, clip_url, r2_key, platform, verdict_state, score,
          evidence_json, conflict_flags, tier_at_creation, priority_queue,
          model_version, run_depth, created_at, purge_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        analysisId,
        userId,
        clipUrl,
        r2Key,
        platform,
        mapVerdict(verdict),
        score,
        JSON.stringify(pillar_detail),
        JSON.stringify(exclusion_reasons),
        tier,
        priorityQueue ? 1 : 0,
        'resemble-detect-3b-omni',
        run_depth,
        createdAt,
        purgeAfter
      ).run();

      // Step 8 — Quota increment
      await incrementQuota(env.SKEPT_ANALYSIS_DB, userId);

      // Step 9 — Return
      return new Response(
        JSON.stringify({
          job_id: jobId,
          verdict,
          score,
          pillar_detail,
          exclusion_reasons,
          tier_at_run: tier,
          analysis_id: analysisId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      console.error('[verify-worker] unhandled error:', err.message);
      return new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
