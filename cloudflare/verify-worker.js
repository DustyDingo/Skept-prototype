import { fuse } from './fusion.js';
import { getTier } from './tier-config.js';

const WINDOW_SECONDS = 2_592_000; // 30 days

// Maps tier depthSegment names to Worker segment objects.
// 'mid' and 'tail' are sentinel strings; Worker resolves actual timestamps using clip duration.
const SEGMENT_DEFS = {
  head: { start: 0,      duration: 5 },
  mid:  { start: 'mid',  duration: 5 },
  tail: { start: 'tail', duration: 5 },
};

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

async function checkQuota(db, userId, tier) {
  const now = Math.floor(Date.now() / 1000);
  const cap = getTier(tier).quota;

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

async function callResemble(apiKey, bucket, r2Key) {
  const obj = await bucket.get(r2Key);
  if (!obj) throw new Error(`R2 object not found: ${r2Key}`);

  const bytes = await obj.arrayBuffer();
  const filename = r2Key.split('/').pop() || 'clip.mp4';

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), filename);
  form.append('content_type', 'video');
  form.append('intelligence', 'true');

  const res = await fetch('https://app.resemble.ai/api/v2/detect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Prefer: 'wait',
      // Do not set Content-Type — FormData sets the multipart boundary automatically
    },
    body: form,
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
      const tierConfig = getTier(tier);
      const segments = tierConfig.depthSegments.map(s => SEGMENT_DEFS[s]);
      const priorityQueue = tierConfig.priority;

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
        resembleData = await callResemble(env.RESEMBLE_API_KEY, env.CLIP_BUCKET, r2Key);
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

      // Intelligence layer — liveness signal for non-human content gate (§3.91)
      const intelligence = item?.intelligence ?? null;
      // Temporary diagnostic: confirm exact field path from `wrangler tail` on next live run
      console.log('[verify-worker] resemble intelligence layer:', JSON.stringify(intelligence));
      // TODO: confirm exact field path against a live wrangler tail run
      const livenessLabel =
        typeof intelligence?.liveness === 'string'
          ? intelligence.liveness
          : (intelligence?.liveness?.label ?? null);
      const isNotRealPerson = livenessLabel === 'not_real_person';

      // Certainty scalar: min(SKEPT_FRAMES, resemble_frame_count) / SKEPT_FRAMES (§3.75, deepfake.py:222)
      const SKEPT_FRAMES = 6;
      const videoChildren = item?.video_metrics?.children ?? [];
      const chunks = videoChildren[0]?.children ?? [];
      const frameData = chunks.flatMap(chunk =>
        (chunk.children ?? []).filter(f => f.score != null && f.certainty != null)
      );
      const resembleFrameCount = frameData.length;

      // Non-human content guard: ≤1 frame OR Resemble liveness=not_real_person → deepfake pillar excluded (§3.91)
      let videoSuspicion;
      let deepfakeExcludedReason = null;
      if (videoScoreRaw === null) {
        videoSuspicion = null;
      } else if (resembleFrameCount <= 1 || isNotRealPerson) {
        videoSuspicion = null;
        deepfakeExcludedReason = 'non_human_content';
      } else {
        const certainty = Math.min(SKEPT_FRAMES, resembleFrameCount) / SKEPT_FRAMES;
        videoSuspicion = Math.max(0.0, Math.min(1.0, videoScoreRaw * certainty));
      }
      // Audio: max(raw, 0.0) passthrough; -1.0 → null no-speech sentinel (§3.89, audio.py:56)
      const audioSuspicion = audioScoreRaw === -1.0 ? null : (audioScoreRaw !== null ? Math.max(0.0, audioScoreRaw) : null);

      // Step 6 — Fusion
      const fuseResult = fuse({
        deepfake: { score: videoSuspicion, weight: 0.60, excluded_reason: deepfakeExcludedReason },
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
          authentic:         'authentic',
          clean:             'authentic',
          ambiguous:         'ambiguous',
          suspicious:        'suspicious',
          manipulated:       'manipulated',
          insufficient_data: 'ambiguous',
        };
        return map[fusionVerdict] ?? 'ambiguous';
      }

      const run_depth = segments.length === 1 ? '5s' : segments.length === 2 ? '10s' : '15s';
      const permalinkUuid = tierConfig.permalink ? crypto.randomUUID() : null;

      await env.SKEPT_ANALYSIS_DB.prepare(`
        INSERT INTO analysis_history (
          id, user_id, clip_url, r2_key, platform, verdict_state, score,
          evidence_json, conflict_flags, tier_at_creation, priority_queue,
          model_version, run_depth, permalink_uuid, created_at, purge_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        permalinkUuid,
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
          permalink_uuid: permalinkUuid,
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
