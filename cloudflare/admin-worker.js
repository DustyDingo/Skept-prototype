// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_DAYS = { '24h':1, '7d':7, '30d':30, '3m':90, '6m':180, '9m':270, '12m':365 };
const QUOTA_LIMITS = { free:5, lite:10, plus:20, pro:40, max:60 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function sinceTs(period) {
  const days = PERIOD_DAYS[period] ?? 30;
  return Math.floor(Date.now() / 1000) - days * 86400;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://skept.co',
    },
  });
}

function parseEvidence(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function parseFlags(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

// ── Endpoint handlers ─────────────────────────────────────────────────────────

async function handleOverview(request, env) {
  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '30d';
  const isAll = period === 'all';
  const since = isAll ? null : sinceTs(period);
  const timeClause = isAll ? '1=1' : 'created_at > ?';
  const binds = isAll ? [] : [since];

  const [total, verdicts, avgScore, audioExcl, activeUsers, trimmedCount, durationRows] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(*) as c FROM analysis_history WHERE ${timeClause}`
    ).bind(...binds).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT verdict_state, COUNT(*) as count FROM analysis_history WHERE ${timeClause} GROUP BY verdict_state`
    ).bind(...binds).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT AVG(score) as avg FROM analysis_history WHERE ${timeClause}`
    ).bind(...binds).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(*) as c FROM analysis_history WHERE ${timeClause} AND conflict_flags LIKE '%audio_dubbing_pattern%'`
    ).bind(...binds).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM analysis_history WHERE ${timeClause}`
    ).bind(...binds).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(*) as c FROM analysis_history WHERE ${timeClause} AND trimmed = 1`
    ).bind(...binds).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT original_duration_sec FROM analysis_history WHERE ${timeClause}`
    ).bind(...binds).all(),
  ]);

  const totalJobs = total.c;
  const manipRow = verdicts.results.find(v => v.verdict_state === 'manipulated');
  const manipCount = manipRow?.count ?? 0;

  let totalCost = 0;
  let totalSecs = 0;
  for (const row of durationRows.results) {
    const secs = Math.min(row.original_duration_sec ?? 4, 15);
    totalSecs += secs;
    totalCost += secs * 0.11;
  }

  return json({
    period,
    total_jobs: totalJobs,
    avg_score: avgScore.avg,
    avg_fusion_score: avgScore.avg,
    manipulated_count: manipCount,
    manipulated_rate: totalJobs > 0 ? manipCount / totalJobs : 0,
    estimated_cost_usd: totalCost,
    estimated_cost: totalCost,
    active_users: activeUsers.c,
    audio_dubbing_exclusions: audioExcl.c,
    audio_exclusion_count: audioExcl.c,
    audio_exclusion_rate: totalJobs > 0 ? audioExcl.c / totalJobs : 0,
    avg_certainty: null,
    avg_clip_length: totalJobs > 0 ? totalSecs / totalJobs : 0,
    trimmed_count: trimmedCount.c,
    trimmed_pct: totalJobs > 0 ? trimmedCount.c / totalJobs : 0,
    verdict_distribution: verdicts.results,
  });
}

async function handleJobs(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '25'));
  const offset = (page - 1) * limit;
  const verdict  = url.searchParams.get('verdict') || '';
  const platform = url.searchParams.get('platform') || '';
  const tier     = url.searchParams.get('tier') || '';
  const period   = url.searchParams.get('period') || '30d';
  const since    = sinceTs(period);

  let where = 'WHERE created_at > ?';
  const binds = [since];
  if (verdict)  { where += ' AND verdict_state = ?'; binds.push(verdict); }
  if (platform) { where += ' AND platform = ?';      binds.push(platform); }
  if (tier)     { where += ' AND tier_at_creation = ?'; binds.push(tier); }

  const [rows, countRow] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT id, user_id, verdict_state, score, platform, tier_at_creation,
              run_depth, original_duration_sec, trimmed, conflict_flags, evidence_json,
              strongest_signal, clip_url, created_at
       FROM analysis_history ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(*) as count FROM analysis_history ${where}`
    ).bind(...binds).first(),
  ]);

  const jobs = rows.results.map(row => {
    const evidence = parseEvidence(row.evidence_json) || {};
    const flags    = parseFlags(row.conflict_flags);
    const pillars  = evidence.pillars || {};
    const deepfake = pillars.deepfake || evidence.deepfake || {};
    const audio    = pillars.audio    || evidence.audio    || {};
    return {
      id: row.id,
      user_id: row.user_id,
      verdict_state: row.verdict_state,
      score: row.score,
      platform: row.platform,
      tier_at_creation: row.tier_at_creation,
      run_depth: row.run_depth,
      original_duration_sec: row.original_duration_sec,
      trimmed: !!row.trimmed,
      created_at: row.created_at,
      conflict_flags: flags,
      video_score: deepfake.score ?? deepfake.final_score ?? null,
      audio_score: audio.score ?? null,
      dubbing_exclusion: deepfake.excluded_reason === 'audio_dubbing_pattern',
      certainty: deepfake.certainty ?? null,
    };
  });

  return json({
    jobs,
    total: countRow.count,
    page,
    total_pages: Math.ceil(countRow.count / limit),
    page_size: limit,
  });
}

async function handleJobDetail(jobId, env) {
  const row = await env.SKEPT_ANALYSIS_DB.prepare(
    'SELECT * FROM analysis_history WHERE id = ?'
  ).bind(jobId).first();

  if (!row) return json({ error: 'not_found' }, 404);

  const evidence = parseEvidence(row.evidence_json);
  const flags    = parseFlags(row.conflict_flags);

  return json({ ...row, evidence, conflict_flags: flags });
}

async function handleStatsVerdicts(request, env) {
  const url    = new URL(request.url);
  const period = url.searchParams.get('period') || '30d';
  const since  = sinceTs(period);

  const [verdicts, platforms, agg] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT verdict_state, COUNT(*) as count FROM analysis_history WHERE created_at > ? GROUP BY verdict_state'
    ).bind(since).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT LOWER(platform) as platform, COUNT(*) as count FROM analysis_history WHERE created_at > ? GROUP BY LOWER(platform)'
    ).bind(since).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT AVG(score) as avg, COUNT(*) as total FROM analysis_history WHERE created_at > ?'
    ).bind(since).first(),
  ]);

  const verdictCounts = { authentic: 0, ambiguous: 0, inconclusive: 0, suspicious: 0, manipulated: 0, total: agg.total };
  for (const v of verdicts.results) {
    if (v.verdict_state in verdictCounts) verdictCounts[v.verdict_state] = v.count;
  }

  const platformCounts = { tiktok: 0, instagram: 0, youtube: 0, other: 0 };
  for (const p of platforms.results) {
    const key = ['tiktok', 'instagram', 'youtube'].includes(p.platform) ? p.platform : 'other';
    platformCounts[key] += p.count;
  }

  return json({ ...verdictCounts, platform_counts: platformCounts, avg_fusion_score: agg.avg });
}

async function handleSignals(request, env) {
  const url    = new URL(request.url);
  const period = url.searchParams.get('period') || '30d';
  const since  = sinceTs(period);

  const [totalRow, dubbingRow, trimmedRow, evidenceRows] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT COUNT(*) as c FROM analysis_history WHERE created_at > ?'
    ).bind(since).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      "SELECT COUNT(*) as c FROM analysis_history WHERE created_at > ? AND conflict_flags LIKE '%audio_dubbing_pattern%'"
    ).bind(since).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT COUNT(*) as c FROM analysis_history WHERE created_at > ? AND trimmed = 1'
    ).bind(since).first(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT evidence_json FROM analysis_history WHERE created_at > ?'
    ).bind(since).all(),
  ]);

  const videoBuckets = { '0-0.10': 0, '0.10-0.30': 0, '0.30-0.60': 0, '0.60-0.80': 0, '0.80-1.00': 0 };
  const audioBuckets = { '0-0.10': 0, '0.10-0.30': 0, '0.30-0.60': 0, '0.60-0.80': 0, '0.80-1.00': 0 };
  let audioExcludedCount = 0;

  function bucket(score, map) {
    if (score < 0.10)      map['0-0.10']++;
    else if (score < 0.30) map['0.10-0.30']++;
    else if (score < 0.60) map['0.30-0.60']++;
    else if (score < 0.80) map['0.60-0.80']++;
    else                   map['0.80-1.00']++;
  }

  for (const row of evidenceRows.results) {
    const evidence = parseEvidence(row.evidence_json);
    if (!evidence) continue;
    const pillars  = evidence.pillars  || {};
    const deepfake = pillars.deepfake  || evidence.deepfake || {};
    const audio    = pillars.audio     || evidence.audio    || {};

    const vs = deepfake.score ?? deepfake.final_score;
    if (vs != null) bucket(vs, videoBuckets);

    if (audio.score == null || audio.excluded_reason) {
      audioExcludedCount++;
    } else {
      bucket(audio.score, audioBuckets);
    }
  }

  const totalJobs = totalRow.c;
  return json({
    total: totalJobs,
    video_buckets: videoBuckets,
    audio_buckets: { ...audioBuckets, excluded_count: audioExcludedCount },
    dubbing_exclusions: { count: dubbingRow.c, pct: totalJobs > 0 ? dubbingRow.c / totalJobs : 0 },
    trimmed: { count: trimmedRow.c, pct: totalJobs > 0 ? trimmedRow.c / totalJobs : 0 },
    // legacy field for backward compat
    score_buckets: videoBuckets,
  });
}

async function handleCost(request, env) {
  const url    = new URL(request.url);
  const period = url.searchParams.get('period') || '30d';
  const since  = sinceTs(period);

  const rows = await env.SKEPT_ANALYSIS_DB.prepare(
    'SELECT original_duration_sec, tier_at_creation, trimmed FROM analysis_history WHERE created_at > ?'
  ).bind(since).all();

  let totalCost = 0, videoCost = 0, audioCost = 0, totalJobs = 0, trimmedCount = 0;
  const costByTier = { free: 0, lite: 0, plus: 0, pro: 0, max: 0 };

  for (const row of rows.results) {
    const secs   = Math.min(row.original_duration_sec ?? 4, 15);
    const vid    = secs * 0.07;
    const aud    = secs * 0.04;
    totalCost   += vid + aud;
    videoCost   += vid;
    audioCost   += aud;
    totalJobs++;
    if (row.trimmed) trimmedCount++;
    const tier = row.tier_at_creation || 'free';
    if (tier in costByTier) costByTier[tier] += vid + aud;
  }

  return json({
    total_cost: totalCost,
    total_cost_usd: totalCost,
    cost_video: videoCost,
    cost_audio: audioCost,
    total_jobs: totalJobs,
    avg_cost_per_job: totalJobs > 0 ? totalCost / totalJobs : 0,
    trimmed_count: trimmedCount,
    trimmed_pct: totalJobs > 0 ? trimmedCount / totalJobs : 0,
    cost_by_tier: costByTier,
    rates: { video: 0.07, audio: 0.04 },
  });
}

async function handleUsers(request, env) {
  const url    = new URL(request.url);
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
  const limit  = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;
  const tier   = url.searchParams.get('tier') || '';

  let where = 'WHERE 1=1';
  const binds = [];
  if (tier) { where += ' AND tier = ?'; binds.push(tier); }

  const [usersRows, totalRow] = await Promise.all([
    env.SKEPT_AUTH_DB.prepare(
      `SELECT id, email, tier, created_at, founder_cohort FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),

    env.SKEPT_AUTH_DB.prepare(
      `SELECT COUNT(*) as count FROM users ${where}`
    ).bind(...binds).first(),
  ]);

  const users = usersRows.results.map(u => {
    let masked = u.email || '';
    if (masked) {
      const at = masked.indexOf('@');
      if (at > 0) masked = masked[0] + '****' + masked.slice(at);
    }
    return { ...u, email: masked };
  });

  if (users.length > 0) {
    const ids          = users.map(u => u.id);
    const placeholders = ids.map(() => '?').join(',');
    const quotaRows    = await env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT user_id, quota_used, quota_limit FROM quota_usage WHERE user_id IN (${placeholders})`
    ).bind(...ids).all();
    const quotaMap = Object.fromEntries(quotaRows.results.map(q => [q.user_id, q]));
    for (const u of users) {
      const q = quotaMap[u.id];
      u.quota_used  = q?.quota_used  ?? 0;
      u.quota_limit = q?.quota_limit ?? (QUOTA_LIMITS[u.tier] ?? 5);
    }
  }

  return json({
    users,
    total: totalRow.count,
    page,
    total_pages: Math.ceil(totalRow.count / limit),
  });
}

async function handleUpdateUserTier(userId, request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const validTiers = ['free', 'lite', 'plus', 'pro', 'max'];
  if (!validTiers.includes(body.tier)) return json({ error: 'invalid_tier', valid: validTiers }, 400);

  const quotaLimit = QUOTA_LIMITS[body.tier];

  await Promise.all([
    env.SKEPT_AUTH_DB.prepare(
      'UPDATE users SET tier = ? WHERE id = ?'
    ).bind(body.tier, userId).run(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'UPDATE quota_usage SET quota_limit = ? WHERE user_id = ?'
    ).bind(quotaLimit, userId).run(),
  ]);

  return json({ success: true, user_id: userId, new_tier: body.tier });
}

async function handleCohort(env) {
  const cohortUsers = await env.SKEPT_AUTH_DB.prepare(
    `SELECT id, tier, tier_expires_at, subscription_source, created_at
     FROM users WHERE tier = 'max' ORDER BY created_at DESC`
  ).all();

  return json({
    members: cohortUsers.results,
    count:   cohortUsers.results.length,
    note:    'Showing all Max tier users as founder cohort proxy',
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url      = new URL(request.url);
    const pathname = url.pathname;
    const method   = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  'https://skept.co',
          'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    }

    if (!pathname.startsWith('/admin/api/')) {
      return new Response('Not found', { status: 404 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token || token !== env.ADMIN_TOKEN) {
      return json({ error: 'Unauthorised' }, 401);
    }

    try {
      if (method === 'GET') {
        if (pathname === '/admin/api/overview')                     return handleOverview(request, env);
        if (pathname === '/admin/api/jobs')                         return handleJobs(request, env);
        if (pathname === '/admin/api/stats/verdicts')               return handleStatsVerdicts(request, env);
        if (pathname === '/admin/api/signals'
          || pathname === '/admin/api/stats/signals')               return handleSignals(request, env);
        if (pathname === '/admin/api/cost'
          || pathname === '/admin/api/stats/cost')                  return handleCost(request, env);
        if (pathname === '/admin/api/users')                        return handleUsers(request, env);
        if (pathname === '/admin/api/cohort')                       return handleCohort(env);

        const jobMatch = pathname.match(/^\/admin\/api\/jobs\/([^/]+)$/);
        if (jobMatch) return handleJobDetail(jobMatch[1], env);
      }

      if (method === 'PATCH') {
        const tierMatch = pathname.match(/^\/admin\/api\/users\/([^/]+)\/tier$/);
        if (tierMatch) return handleUpdateUserTier(tierMatch[1], request, env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('[admin-worker] error:', err.message, err.stack);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
