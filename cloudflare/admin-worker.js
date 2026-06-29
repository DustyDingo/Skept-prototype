// ── Auth helpers ────────────────────────────────────────────────────────────

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function authenticate(request, env) {
  let kvKey;
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    kvKey = `session:${authHeader.slice(7).trim()}`;
  } else {
    const cookieId = getCookieValue(request, 'skept_session');
    if (cookieId) kvKey = `session:${cookieId}`;
  }
  if (!kvKey) return { error: 'missing_token', status: 401 };

  const raw = await env.AUTH_SESSIONS.get(kvKey);
  if (!raw) return { error: 'invalid_token', status: 401 };

  let session;
  try { session = JSON.parse(raw); } catch { return { error: 'invalid_token', status: 401 }; }

  if (!session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000)) {
    return { error: 'token_expired', status: 401 };
  }

  // Verify is_admin in skept-auth DB
  const user = await env.SKEPT_AUTH_DB.prepare(
    'SELECT id, is_admin FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  if (!user || !user.is_admin) return { error: 'forbidden', status: 403 };

  return { session };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://skept.co',
      ...extra,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Period helper ────────────────────────────────────────────────────────────

function sinceTs(period) {
  const periodMap = { '7d': 604800, '30d': 2592000 };
  return periodMap[period]
    ? Math.floor(Date.now() / 1000) - periodMap[period]
    : 0;
}

// ── API handlers ─────────────────────────────────────────────────────────────

async function handleOverview(env) {
  const thirtyDaysAgo = sinceTs('30d');

  const [totalJobs, verdictDist, avgScore, audioExclusions, timedJobs, activeUsers] =
    await Promise.all([
      env.SKEPT_ANALYSIS_DB.prepare(
        'SELECT COUNT(*) as count FROM analysis_history WHERE created_at > ?'
      ).bind(thirtyDaysAgo).first(),

      env.SKEPT_ANALYSIS_DB.prepare(
        'SELECT verdict_state, COUNT(*) as count FROM analysis_history WHERE created_at > ? GROUP BY verdict_state'
      ).bind(thirtyDaysAgo).all(),

      env.SKEPT_ANALYSIS_DB.prepare(
        'SELECT AVG(score) as avg FROM analysis_history WHERE created_at > ?'
      ).bind(thirtyDaysAgo).first(),

      env.SKEPT_ANALYSIS_DB.prepare(
        `SELECT COUNT(*) as count FROM analysis_history
         WHERE created_at > ? AND conflict_flags LIKE '%audio_dubbing_pattern%'`
      ).bind(thirtyDaysAgo).first(),

      env.SKEPT_ANALYSIS_DB.prepare(
        `SELECT run_depth, COUNT(*) as count FROM analysis_history
         WHERE created_at > ? GROUP BY run_depth`
      ).bind(thirtyDaysAgo).all(),

      env.SKEPT_ANALYSIS_DB.prepare(
        'SELECT COUNT(DISTINCT user_id) as count FROM analysis_history WHERE created_at > ?'
      ).bind(thirtyDaysAgo).first(),
    ]);

  const depthMap = { '5s': 5, '10s': 10, '15s': 15 };
  let totalSeconds = 0;
  for (const row of timedJobs.results) {
    totalSeconds += (depthMap[row.run_depth] || 5) * row.count;
  }
  const estimatedCost = totalSeconds * 0.11;

  return json({
    period: '30d',
    total_jobs: totalJobs.count,
    verdict_distribution: verdictDist.results,
    avg_score: avgScore.avg,
    audio_dubbing_exclusions: audioExclusions.count,
    active_users: activeUsers.count,
    estimated_cost_usd: estimatedCost,
    total_seconds_processed: totalSeconds,
  });
}

async function handleJobs(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 25;
  const offset = (page - 1) * pageSize;
  const verdict = url.searchParams.get('verdict') || '';
  const platform = url.searchParams.get('platform') || '';
  const tier = url.searchParams.get('tier') || '';
  const period = url.searchParams.get('period') || '30d';

  const since = sinceTs(period);

  let where = 'WHERE created_at > ?';
  const binds = [since];
  if (verdict) { where += ' AND verdict_state = ?'; binds.push(verdict); }
  if (platform) { where += ' AND platform = ?'; binds.push(platform); }
  if (tier) { where += ' AND tier_at_creation = ?'; binds.push(tier); }

  const [rows, total] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT id, verdict_state, score, platform, tier_at_creation,
              run_depth, model_version, conflict_flags, strongest_signal,
              clip_url, created_at
       FROM analysis_history ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, pageSize, offset).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT COUNT(*) as count FROM analysis_history ${where}`
    ).bind(...binds).first(),
  ]);

  return json({
    jobs: rows.results,
    total: total.count,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total.count / pageSize),
  });
}

async function handleJobDetail(jobId, env) {
  const job = await env.SKEPT_ANALYSIS_DB.prepare(
    'SELECT * FROM analysis_history WHERE id = ?'
  ).bind(jobId).first();

  if (!job) return new Response('Not found', { status: 404 });

  if (job.evidence_json) {
    try { job.evidence = JSON.parse(job.evidence_json); } catch { /* keep raw */ }
  }
  if (job.conflict_flags) {
    try { job.conflict_flags = JSON.parse(job.conflict_flags); } catch { /* keep raw */ }
  }

  return json(job);
}

async function handleSignals(env) {
  const thirtyDaysAgo = sinceTs('30d');

  const [verdicts, scores, dubbingJobs, platformVariance] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT verdict_state, COUNT(*) as count
       FROM analysis_history WHERE created_at > ?
       GROUP BY verdict_state`
    ).bind(thirtyDaysAgo).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT score, run_depth FROM analysis_history WHERE created_at > ?'
    ).bind(thirtyDaysAgo).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT verdict_state, COUNT(*) as count
       FROM analysis_history
       WHERE created_at > ? AND conflict_flags LIKE '%audio_dubbing_pattern%'
       GROUP BY verdict_state`
    ).bind(thirtyDaysAgo).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT platform, AVG(score) as avg_score, COUNT(*) as count
       FROM analysis_history
       WHERE created_at > ? AND verdict_state = 'authentic'
       GROUP BY platform`
    ).bind(thirtyDaysAgo).all(),
  ]);

  const buckets = { authentic: 0, ambiguous: 0, inconclusive: 0, suspicious: 0, manipulated: 0 };
  for (const row of scores.results) {
    const s = row.score;
    if (s < 0.20) buckets.authentic++;
    else if (s < 0.50) buckets.ambiguous++;
    else if (s === 0.50) buckets.inconclusive++;
    else if (s < 0.80) buckets.suspicious++;
    else buckets.manipulated++;
  }

  return json({
    score_buckets: buckets,
    total: scores.results.length,
    verdict_distribution: verdicts.results,
    dubbing_exclusions: dubbingJobs.results,
    platform_variance: platformVariance.results,
  });
}

async function handleCost(env) {
  const thirtyDaysAgo = sinceTs('30d');

  const depthCounts = await env.SKEPT_ANALYSIS_DB.prepare(
    `SELECT run_depth, COUNT(*) as count
     FROM analysis_history WHERE created_at > ?
     GROUP BY run_depth`
  ).bind(thirtyDaysAgo).all();

  const depthMap = { '5s': 5, '10s': 10, '15s': 15 };
  const VIDEO_RATE = 0.07;
  const AUDIO_RATE = 0.04;

  let totalJobs = 0, totalSeconds = 0, totalCost = 0;
  const breakdown = [];
  for (const row of depthCounts.results) {
    const secs = depthMap[row.run_depth] || 5;
    const jobCost = secs * (VIDEO_RATE + AUDIO_RATE);
    const rowTotal = jobCost * row.count;
    totalJobs += row.count;
    totalSeconds += secs * row.count;
    totalCost += rowTotal;
    breakdown.push({
      run_depth: row.run_depth,
      seconds: secs,
      count: row.count,
      cost_per_job: jobCost,
      total: rowTotal,
    });
  }

  return json({
    period: '30d',
    total_jobs: totalJobs,
    total_seconds: totalSeconds,
    total_cost_usd: totalCost,
    avg_cost_per_job: totalJobs > 0 ? totalCost / totalJobs : 0,
    breakdown,
    rates: { video: VIDEO_RATE, audio: AUDIO_RATE },
  });
}

async function handleUsers(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 25;
  const offset = (page - 1) * pageSize;
  const thirtyDaysAgo = sinceTs('30d');

  const [usersAnalysis, total] = await Promise.all([
    env.SKEPT_ANALYSIS_DB.prepare(
      `SELECT
         ah.user_id,
         COUNT(ah.id) as job_count,
         MAX(ah.created_at) as last_active,
         qu.run_count,
         qu.window_start,
         qu.quota_limit
       FROM analysis_history ah
       LEFT JOIN quota_usage qu ON qu.user_id = ah.user_id
       WHERE ah.created_at > ?
       GROUP BY ah.user_id
       ORDER BY last_active DESC
       LIMIT ? OFFSET ?`
    ).bind(thirtyDaysAgo, pageSize, offset).all(),

    env.SKEPT_ANALYSIS_DB.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM analysis_history WHERE created_at > ?'
    ).bind(thirtyDaysAgo).first(),
  ]);

  const userIds = usersAnalysis.results.map(u => u.user_id);
  let authUsers = [];
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',');
    const authResult = await env.SKEPT_AUTH_DB.prepare(
      `SELECT id, tier, created_at FROM users WHERE id IN (${placeholders})`
    ).bind(...userIds).all();
    authUsers = authResult.results;
  }

  const authMap = Object.fromEntries(authUsers.map(u => [u.id, u]));
  const users = usersAnalysis.results.map(u => ({
    ...u,
    tier: authMap[u.user_id]?.tier || 'unknown',
    account_created_at: authMap[u.user_id]?.created_at,
  }));

  return json({
    users,
    total: total.count,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total.count / pageSize),
  });
}

async function handleCohort(env) {
  const cohortUsers = await env.SKEPT_AUTH_DB.prepare(
    `SELECT id, tier, tier_expires_at, subscription_source, created_at
     FROM users WHERE tier = 'max' ORDER BY created_at DESC`
  ).all();

  return json({
    members: cohortUsers.results,
    count: cohortUsers.results.length,
    note: 'founder_cohort column not yet added — showing all Max tier users as proxy',
  });
}

// ── Dashboard HTML ───────────────────────────────────────────────────────────

function renderDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Skept — Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sorts+Mill+Goudy:ital,wght@0,400;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --amber:        #b87400;
      --ink:          #1a1a1a;
      --ink-soft:     #5a5a5a;
      --ink-softer:   #8a8a8a;
      --bg:           #faf8f3;
      --card:         #ffffff;
      --rule:         #e8e4db;
      --green:        #3a7a50;
      --red-state:    #a83a2a;
      --amber-state:  #c07800;
      --sidebar-w:    220px;
      --goudy: 'Sorts Mill Goudy', Georgia, serif;
      --ui:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    body { font-family: var(--ui); background: var(--bg); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }

    /* NAV */
    .admin-nav {
      position: sticky; top: 0; z-index: 200;
      height: 52px; background: rgba(250,248,243,0.95);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--rule);
      display: flex; align-items: center; padding: 0 20px; gap: 12px;
    }
    .nav-wordmark { font-family: var(--goudy); font-style: italic; font-size: 20px; color: var(--ink); }
    .nav-tag { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-softer); background: var(--rule); padding: 3px 7px; border-radius: 4px; }
    .nav-spacer { flex: 1; }
    .nav-back { font-size: 13px; color: var(--ink-soft); text-decoration: none; }
    .nav-back:hover { color: var(--ink); }

    /* LAYOUT */
    .admin-body { display: flex; flex: 1; }
    .sidebar {
      width: var(--sidebar-w); flex-shrink: 0;
      border-right: 1px solid var(--rule);
      padding: 16px 12px;
      position: sticky; top: 52px; height: calc(100vh - 52px); overflow-y: auto;
    }
    .sidebar-section { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-softer); padding: 4px 8px 8px; margin-top: 12px; }
    .sidebar-section:first-child { margin-top: 0; }
    .sidebar-item {
      display: flex; align-items: center; gap: 9px;
      padding: 8px 10px; border-radius: 6px; cursor: pointer;
      font-size: 13.5px; color: var(--ink-soft); font-weight: 400;
      border: none; background: none; width: 100%; text-align: left;
      transition: background 0.12s, color 0.12s;
    }
    .sidebar-item:hover { background: rgba(0,0,0,0.04); color: var(--ink); }
    .sidebar-item.active { background: rgba(184,116,0,0.10); color: var(--amber); font-weight: 500; }
    .sidebar-icon { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }

    /* MAIN CONTENT */
    .admin-main { flex: 1; padding: 28px 32px; min-width: 0; }
    .view { display: none; }
    .view.active { display: block; }

    /* VIEW HEADER */
    .view-header { margin-bottom: 24px; }
    .view-title { font-family: var(--goudy); font-style: italic; font-size: 24px; color: var(--ink); }
    .view-sub { font-size: 13px; color: var(--ink-softer); margin-top: 4px; }

    /* STAT GRID */
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
    .stat-card { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; }
    .stat-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-softer); margin-bottom: 6px; }
    .stat-value { font-size: 28px; font-weight: 300; color: var(--ink); line-height: 1; }
    .stat-delta { font-size: 12px; color: var(--ink-softer); margin-top: 4px; }

    /* TABLE */
    .table-wrap { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
    .table-toolbar { padding: 14px 16px; border-bottom: 1px solid var(--rule); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .toolbar-label { font-size: 12px; font-weight: 600; color: var(--ink-softer); margin-right: 4px; }
    select.filter-select {
      font-size: 12px; color: var(--ink); border: 1px solid var(--rule);
      border-radius: 5px; padding: 5px 10px; background: var(--bg);
      font-family: var(--ui); cursor: pointer;
    }
    select.filter-select:focus { outline: 2px solid var(--amber); outline-offset: 1px; }
    .toolbar-spacer { flex: 1; }
    .toolbar-count { font-size: 12px; color: var(--ink-softer); }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-softer); border-bottom: 1px solid var(--rule); white-space: nowrap; }
    tbody tr { border-bottom: 1px solid var(--rule); cursor: pointer; transition: background 0.1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: rgba(0,0,0,0.02); }
    tbody td { padding: 10px 14px; font-size: 13px; }

    /* PILLS & BADGES */
    .verdict-pill { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; }
    .verdict-pill.green { background: rgba(58,122,80,0.12); color: var(--green); }
    .verdict-pill.amber { background: rgba(192,120,0,0.12); color: var(--amber-state); }
    .verdict-pill.red   { background: rgba(168,58,42,0.12); color: var(--red-state); }
    .verdict-pill.grey  { background: rgba(0,0,0,0.06); color: var(--ink-softer); }
    .platform-badge { font-size: 11px; color: var(--ink-soft); background: var(--bg); border: 1px solid var(--rule); border-radius: 4px; padding: 2px 7px; }
    .tier-badge { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; }
    .tier-badge.free  { background: rgba(0,0,0,0.06); color: var(--ink-softer); }
    .tier-badge.lite  { background: rgba(0,0,0,0.06); color: var(--ink-soft); }
    .tier-badge.plus  { background: rgba(184,116,0,0.10); color: var(--amber); }
    .tier-badge.pro   { background: rgba(58,122,80,0.10); color: var(--green); }
    .tier-badge.max   { background: rgba(168,58,42,0.10); color: var(--red-state); }
    .pill-excl { font-size: 10px; background: rgba(168,58,42,0.08); color: var(--red-state); border-radius: 4px; padding: 2px 6px; display: inline-block; }

    /* SCORE BAR */
    .score-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .score-bar-track { flex: 1; height: 4px; background: var(--rule); border-radius: 2px; min-width: 60px; }
    .score-bar-fill { height: 4px; border-radius: 2px; }
    .score-bar-fill.green { background: var(--green); }
    .score-bar-fill.amber { background: var(--amber-state); }
    .score-bar-fill.red   { background: var(--red-state); }
    .score-bar-fill.grey  { background: var(--ink-softer); }
    .score-val { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--ink-soft); min-width: 32px; }

    /* PAGINATION */
    .pagination { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--rule); }
    .page-btn { font-size: 12px; border: 1px solid var(--rule); border-radius: 5px; padding: 5px 12px; background: var(--bg); cursor: pointer; font-family: var(--ui); color: var(--ink-soft); }
    .page-btn:hover:not(:disabled) { border-color: var(--amber); color: var(--amber); }
    .page-btn:disabled { opacity: 0.4; cursor: default; }
    .page-info { font-size: 12px; color: var(--ink-softer); flex: 1; text-align: center; }

    /* DRAWER */
    .drawer-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 400; }
    .drawer-overlay.open { display: block; }
    .job-drawer {
      position: fixed; right: 0; top: 0; bottom: 0; width: 420px; max-width: 100vw;
      background: var(--card); border-left: 1px solid var(--rule);
      z-index: 401; padding: 24px; overflow-y: auto;
      transform: translateX(100%); transition: transform 0.22s ease;
    }
    .job-drawer.open { transform: translateX(0); }
    .drawer-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
    .drawer-id { font-size: 11px; color: var(--ink-softer); font-family: monospace; }
    .drawer-close { margin-left: auto; border: none; background: none; font-size: 18px; cursor: pointer; color: var(--ink-softer); padding: 4px; line-height: 1; }
    .drawer-close:hover { color: var(--ink); }
    .drawer-section { margin-bottom: 18px; }
    .drawer-section-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-softer); margin-bottom: 8px; }
    .drawer-row { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; border-bottom: 1px solid rgba(0,0,0,0.04); font-size: 13px; }
    .drawer-row:last-child { border-bottom: none; }
    .drawer-key { color: var(--ink-softer); }
    .drawer-val { color: var(--ink); text-align: right; font-variant-numeric: tabular-nums; }
    .pillar-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.04); font-size: 13px; }
    .pillar-row:last-child { border-bottom: none; }
    .pillar-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .pillar-name { flex: 1; }
    .pillar-score { font-variant-numeric: tabular-nums; color: var(--ink-soft); }
    .clip-url-link { font-size: 12px; word-break: break-all; color: var(--amber); text-decoration: none; }
    .clip-url-link:hover { text-decoration: underline; }

    /* SIGNAL VIEW SPECIFICS */
    .signal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .signal-bar-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
    .signal-bar-label { width: 90px; color: var(--ink-soft); font-size: 12px; }
    .signal-bar-track { flex: 1; height: 8px; background: var(--rule); border-radius: 4px; }
    .signal-bar-fill { height: 8px; border-radius: 4px; background: var(--amber); }
    .signal-bar-count { width: 40px; text-align: right; font-size: 12px; color: var(--ink-softer); }

    /* COST VIEW */
    .cost-summary { display: flex; gap: 14px; margin-bottom: 24px; flex-wrap: wrap; }
    .cost-card { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 16px 20px; flex: 1; min-width: 150px; }

    /* UTILITY */
    .mono { font-family: monospace; font-size: 12px; }
    .text-softer { color: var(--ink-softer); }
    .loading { color: var(--ink-softer); font-size: 14px; padding: 32px 0; }
    .empty { color: var(--ink-softer); font-size: 13px; padding: 24px 0; text-align: center; }

    @media (max-width: 800px) {
      .sidebar { display: none; }
      .admin-main { padding: 20px 16px; }
    }
  </style>
</head>
<body>

<!-- NAV -->
<nav class="admin-nav">
  <span class="nav-wordmark">Skept</span>
  <span class="nav-tag">Admin</span>
  <div class="nav-spacer"></div>
  <a class="nav-back" href="/verify">← Back to app</a>
</nav>

<div class="admin-body">

  <!-- SIDEBAR -->
  <aside class="sidebar">
    <div class="sidebar-section">Analytics</div>
    <button class="sidebar-item active" onclick="showView('overview', event)">
      <span class="sidebar-icon">📊</span> Overview
    </button>
    <button class="sidebar-item" onclick="showView('jobs', event)">
      <span class="sidebar-icon">🗂</span> Job log
    </button>
    <button class="sidebar-item" onclick="showView('signals', event)">
      <span class="sidebar-icon">📈</span> Signals
    </button>
    <button class="sidebar-item" onclick="showView('cost', event)">
      <span class="sidebar-icon">💸</span> Cost
    </button>
    <div class="sidebar-section">Users</div>
    <button class="sidebar-item" onclick="showView('users', event)">
      <span class="sidebar-icon">👤</span> All users
    </button>
    <button class="sidebar-item" onclick="showView('cohort', event)">
      <span class="sidebar-icon">⭐</span> Founder cohort
    </button>
  </aside>

  <!-- MAIN -->
  <main class="admin-main">

    <!-- OVERVIEW -->
    <div id="view-overview" class="view active">
      <div class="view-header">
        <div class="view-title">Overview</div>
        <div class="view-sub">Last 30 days</div>
      </div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total jobs</div>
          <div class="stat-value" id="stat-total-jobs">—</div>
          <div class="stat-delta" id="stat-total-jobs-delta">30d</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg score</div>
          <div class="stat-value" id="stat-avg-score">—</div>
          <div class="stat-delta">fusion score mean</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Manipulated rate</div>
          <div class="stat-value" id="stat-manipulated-rate">—</div>
          <div class="stat-delta" id="stat-manipulated-rate-delta"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active users</div>
          <div class="stat-value" id="stat-active-users">—</div>
          <div class="stat-delta">ran ≥1 job</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Est. API cost</div>
          <div class="stat-value" id="stat-cost">—</div>
          <div class="stat-delta">Resemble $0.11/s</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Audio excl.</div>
          <div class="stat-value" id="stat-audio-excl">—</div>
          <div class="stat-delta">dubbing pattern</div>
        </div>
      </div>
      <div id="overview-verdict-dist"></div>
    </div>

    <!-- JOBS -->
    <div id="view-jobs" class="view">
      <div class="view-header">
        <div class="view-title">Job log</div>
        <div class="view-sub">All analysis jobs</div>
      </div>
      <div class="table-wrap">
        <div class="table-toolbar">
          <span class="toolbar-label">Filter:</span>
          <select class="filter-select" id="filter-period" onchange="applyJobFilters()">
            <option value="30d">Last 30d</option>
            <option value="7d">Last 7d</option>
            <option value="all">All time</option>
          </select>
          <select class="filter-select" id="filter-verdict" onchange="applyJobFilters()">
            <option value="">All verdicts</option>
            <option value="authentic">Authentic</option>
            <option value="ambiguous">Ambiguous</option>
            <option value="suspicious">Suspicious</option>
            <option value="manipulated">Manipulated</option>
          </select>
          <select class="filter-select" id="filter-platform" onchange="applyJobFilters()">
            <option value="">All platforms</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
            <option value="discord">Discord</option>
            <option value="unknown">Unknown</option>
          </select>
          <select class="filter-select" id="filter-tier" onchange="applyJobFilters()">
            <option value="">All tiers</option>
            <option value="free">Free</option>
            <option value="lite">Lite</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
            <option value="max">Max</option>
          </select>
          <div class="toolbar-spacer"></div>
          <span class="toolbar-count" id="jobs-count"></span>
        </div>
        <table class="job-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Verdict</th>
              <th>Score</th>
              <th>Flags</th>
              <th>Platform</th>
              <th>Tier</th>
              <th>Depth</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody id="jobs-tbody">
            <tr><td colspan="8" class="loading">Loading…</td></tr>
          </tbody>
        </table>
        <div class="pagination">
          <button class="page-btn" id="jobs-prev" onclick="loadJobs(jobsPage - 1)" disabled>← Prev</button>
          <span class="page-info" id="jobs-page-info"></span>
          <button class="page-btn" id="jobs-next" onclick="loadJobs(jobsPage + 1)">Next →</button>
        </div>
      </div>
    </div>

    <!-- SIGNALS -->
    <div id="view-signals" class="view">
      <div class="view-header">
        <div class="view-title">Signals</div>
        <div class="view-sub">Score distribution — last 30 days</div>
      </div>
      <div id="signals-content" class="loading">Loading…</div>
    </div>

    <!-- COST -->
    <div id="view-cost" class="view">
      <div class="view-header">
        <div class="view-title">Cost</div>
        <div class="view-sub">Resemble API cost estimate — last 30 days</div>
      </div>
      <div id="cost-content" class="loading">Loading…</div>
    </div>

    <!-- USERS -->
    <div id="view-users" class="view">
      <div class="view-header">
        <div class="view-title">All users</div>
        <div class="view-sub">Active last 30 days</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Tier</th>
              <th>Jobs (30d)</th>
              <th>Quota used</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody id="users-tbody">
            <tr><td colspan="5" class="loading">Loading…</td></tr>
          </tbody>
        </table>
        <div class="pagination">
          <button class="page-btn" id="users-prev" onclick="loadUsers(usersPage - 1)" disabled>← Prev</button>
          <span class="page-info" id="users-page-info"></span>
          <button class="page-btn" id="users-next" onclick="loadUsers(usersPage + 1)">Next →</button>
        </div>
      </div>
    </div>

    <!-- COHORT -->
    <div id="view-cohort" class="view">
      <div class="view-header">
        <div class="view-title">Founder cohort</div>
        <div class="view-sub">Max tier — proxy until founder_cohort column added</div>
      </div>
      <div id="cohort-content" class="loading">Loading…</div>
    </div>

  </main>
</div>

<!-- DRAWER -->
<div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
<div class="job-drawer" id="job-drawer">
  <div class="drawer-header">
    <div>
      <div class="stat-label" style="margin-bottom:4px">Job detail</div>
      <div class="drawer-id" id="drawer-job-id"></div>
    </div>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>
  </div>
  <div id="drawer-body"></div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
const viewLoaded = {};
let jobsPage = 1;
let jobsFilters = { verdict: '', platform: '', tier: '', period: '30d' };
let usersPage = 1;

// ── Navigation ─────────────────────────────────────────────────────────────
async function showView(id, event) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  if (!viewLoaded[id]) {
    viewLoaded[id] = true;
    await loadView(id);
  }
}

async function loadView(id) {
  const loaders = {
    overview: loadOverview,
    jobs:     () => loadJobs(1),
    signals:  loadSignals,
    cost:     loadCost,
    users:    () => loadUsers(1),
    cohort:   loadCohort,
  };
  if (loaders[id]) await loaders[id]();
}

// ── API fetch ──────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    const res = await fetch(path, { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/'; return null; }
    if (res.status === 403) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Access denied — admin only.</p>';
      return null;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('apiFetch error', path, err);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function scoreClass(s) {
  if (s === null || s === undefined) return 'grey';
  if (s < 0.30) return 'green';
  if (s < 0.60) return 'amber';
  return 'red';
}

function relativeTime(unixTs) {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function fmtDate(unixTs) {
  const d = new Date(unixTs * 1000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Overview ───────────────────────────────────────────────────────────────
async function loadOverview() {
  const data = await apiFetch('/api/admin/overview');
  if (!data) return;

  setEl('stat-total-jobs', data.total_jobs ?? '—');
  setEl('stat-avg-score', data.avg_score != null ? data.avg_score.toFixed(2) : '—');
  setEl('stat-cost', data.estimated_cost_usd != null ? '$' + data.estimated_cost_usd.toFixed(2) : '—');
  setEl('stat-active-users', data.active_users ?? '—');

  const manipRow = (data.verdict_distribution || []).find(v => v.verdict_state === 'manipulated');
  const manipCount = manipRow?.count ?? 0;
  const manipRate = data.total_jobs > 0 ? Math.round((manipCount / data.total_jobs) * 100) : 0;
  setEl('stat-manipulated-rate', manipRate + '%');
  setEl('stat-manipulated-rate-delta', manipCount + ' / ' + data.total_jobs + ' jobs');

  const audioExclRate = data.total_jobs > 0
    ? ((data.audio_dubbing_exclusions / data.total_jobs) * 100).toFixed(1)
    : '0.0';
  setEl('stat-audio-excl', audioExclRate + '%');

  // Verdict distribution mini table
  if (data.verdict_distribution && data.verdict_distribution.length) {
    const rows = data.verdict_distribution
      .sort((a, b) => b.count - a.count)
      .map(v => {
        const cls = scoreClass(v.verdict_state === 'authentic' ? 0.1 : v.verdict_state === 'manipulated' ? 0.9 : 0.45);
        return '<tr><td><span class="verdict-pill ' + cls + '">' + esc(v.verdict_state) + '</span></td><td style="text-align:right;font-size:13px">' + v.count + '</td></tr>';
      }).join('');
    document.getElementById('overview-verdict-dist').innerHTML =
      '<div style="background:var(--card);border:1px solid var(--rule);border-radius:8px;overflow:hidden;max-width:320px">' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-softer);border-bottom:1px solid var(--rule)">Verdict</th><th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-softer);border-bottom:1px solid var(--rule)">Count</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }
}

// ── Jobs ───────────────────────────────────────────────────────────────────
function applyJobFilters() {
  jobsFilters.verdict  = document.getElementById('filter-verdict').value;
  jobsFilters.platform = document.getElementById('filter-platform').value;
  jobsFilters.tier     = document.getElementById('filter-tier').value;
  jobsFilters.period   = document.getElementById('filter-period').value;
  loadJobs(1);
}

async function loadJobs(page) {
  jobsPage = page;
  const params = new URLSearchParams({ page, ...jobsFilters });
  for (const [k, v] of [...params.entries()]) {
    if (!v) params.delete(k);
  }

  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading…</td></tr>';

  const data = await apiFetch('/api/admin/jobs?' + params.toString());
  if (!data) return;

  if (!data.jobs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No jobs found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.jobs.map(renderJobRow).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => openDrawer(tr.dataset.jobId));
  });

  setEl('jobs-page-info', 'Page ' + data.page + ' of ' + (data.total_pages || 1));
  setEl('jobs-count', data.total + ' jobs');
  document.getElementById('jobs-prev').disabled = data.page <= 1;
  document.getElementById('jobs-next').disabled = data.page >= data.total_pages;
}

function renderJobRow(job) {
  const cls = scoreClass(job.score);
  const scoreWidth = job.score != null ? Math.round(job.score * 100) : 0;
  let flags = [];
  try { flags = job.conflict_flags ? JSON.parse(job.conflict_flags) : []; } catch { /* raw string */ }
  if (!Array.isArray(flags)) flags = [];
  const flagHtml = flags.length
    ? flags.map(f => '<span class="pill-excl">' + esc(f.replace(/_/g, ' ')) + '</span>').join(' ')
    : '—';

  return '<tr data-job-id="' + esc(job.id) + '">' +
    '<td class="mono">' + esc((job.id || '').substring(0, 8)) + '…</td>' +
    '<td><span class="verdict-pill ' + cls + '">' + esc(job.verdict_state) + '</span></td>' +
    '<td><div class="score-bar-wrap"><div class="score-bar-track"><div class="score-bar-fill ' + cls + '" style="width:' + scoreWidth + '%"></div></div><span class="score-val">' + (job.score != null ? job.score.toFixed(2) : '—') + '</span></div></td>' +
    '<td>' + flagHtml + '</td>' +
    '<td><span class="platform-badge">' + esc(job.platform || 'unknown') + '</span></td>' +
    '<td><span class="tier-badge ' + esc(job.tier_at_creation) + '">' + esc(job.tier_at_creation) + '</span></td>' +
    '<td class="mono">' + esc(job.run_depth || '—') + '</td>' +
    '<td class="text-softer mono">' + relativeTime(job.created_at) + '</td>' +
    '</tr>';
}

// ── Drawer ─────────────────────────────────────────────────────────────────
async function openDrawer(jobId) {
  const j = await apiFetch('/api/admin/jobs/' + jobId);
  if (!j) return;

  setEl('drawer-job-id', j.id);

  const evidence = j.evidence || {};
  const video = evidence.deepfake || {};
  const audio = evidence.audio || {};
  const c2pa  = evidence.c2pa  || {};

  const flags = Array.isArray(j.conflict_flags) ? j.conflict_flags : [];
  const dubbingExcl = flags.includes('audio_dubbing_pattern');

  const videoScore  = video.final_score ?? video.score ?? null;
  const audioScore  = audio.score ?? null;
  const videoCol    = dubbingExcl ? 'grey' : scoreClass(videoScore);
  const audioCol    = (audio.excluded || audioScore === null) ? 'grey' : scoreClass(audioScore);
  const mainCol     = scoreClass(j.score);

  const dotStyle = (col) => {
    const colors = { green: '#3a7a50', amber: '#c07800', red: '#a83a2a', grey: '#8a8a8a' };
    return 'background:' + (colors[col] || '#8a8a8a');
  };

  let html = '';

  // Verdict
  html += '<div class="drawer-section">';
  html += '<div class="drawer-section-label">Verdict</div>';
  html += '<div class="drawer-row"><span class="drawer-key">State</span><span class="drawer-val"><span class="verdict-pill ' + mainCol + '">' + esc(j.verdict_state) + '</span></span></div>';
  html += '<div class="drawer-row"><span class="drawer-key">Score</span><span class="drawer-val">' + (j.score != null ? j.score.toFixed(4) : '—') + '</span></div>';
  html += '<div class="drawer-row"><span class="drawer-key">Platform</span><span class="drawer-val">' + esc(j.platform || '—') + '</span></div>';
  html += '<div class="drawer-row"><span class="drawer-key">Tier</span><span class="drawer-val">' + esc(j.tier_at_creation || '—') + '</span></div>';
  html += '<div class="drawer-row"><span class="drawer-key">Depth</span><span class="drawer-val">' + esc(j.run_depth || '—') + '</span></div>';
  html += '<div class="drawer-row"><span class="drawer-key">Created</span><span class="drawer-val">' + fmtDate(j.created_at) + '</span></div>';
  html += '</div>';

  // Pillars
  html += '<div class="drawer-section">';
  html += '<div class="drawer-section-label">Pillars</div>';
  html += '<div class="pillar-row"><div class="pillar-dot" style="' + dotStyle(videoCol) + '"></div><div class="pillar-name">Video deepfake</div><div class="pillar-score">' + (videoScore != null ? videoScore.toFixed(3) : '—') + (dubbingExcl ? ' <span style="color:var(--ink-softer);font-size:11px">[excluded]</span>' : '') + '</div></div>';
  html += '<div class="pillar-row"><div class="pillar-dot" style="' + dotStyle(audioCol) + '"></div><div class="pillar-name">Audio</div><div class="pillar-score">' + (audioScore != null ? audioScore.toFixed(3) : 'no speech') + '</div></div>';
  if (c2pa && c2pa.status) {
    html += '<div class="pillar-row"><div class="pillar-dot" style="background:#8a8a8a"></div><div class="pillar-name">C2PA</div><div class="pillar-score">' + esc(c2pa.status) + '</div></div>';
  }
  html += '</div>';

  // Flags
  if (flags.length) {
    html += '<div class="drawer-section">';
    html += '<div class="drawer-section-label">Conflict flags</div>';
    html += flags.map(f => '<span class="pill-excl" style="margin-right:6px">' + esc(f.replace(/_/g,' ')) + '</span>').join('');
    html += '</div>';
  }

  // Video detail
  if (Object.keys(video).length > 0) {
    html += '<div class="drawer-section">';
    html += '<div class="drawer-section-label">Video detail</div>';
    if (video.certainty != null) html += '<div class="drawer-row"><span class="drawer-key">Certainty</span><span class="drawer-val">' + video.certainty.toFixed(4) + '</span></div>';
    if (video.resemble_frame_count != null) html += '<div class="drawer-row"><span class="drawer-key">Frames (Resemble)</span><span class="drawer-val">' + video.resemble_frame_count + '</span></div>';
    if (video.skept_frames != null) html += '<div class="drawer-row"><span class="drawer-key">Frames (Skept)</span><span class="drawer-val">' + video.skept_frames + '</span></div>';
    html += '</div>';
  }

  // Clip URL
  if (j.clip_url) {
    html += '<div class="drawer-section">';
    html += '<div class="drawer-section-label">Source</div>';
    html += '<a class="clip-url-link" href="' + esc(j.clip_url) + '" target="_blank" rel="noopener">' + esc(j.clip_url) + '</a>';
    html += '</div>';
  }

  // Strongest signal
  if (j.strongest_signal) {
    html += '<div class="drawer-section">';
    html += '<div class="drawer-section-label">Strongest signal</div>';
    html += '<div style="font-size:13px;color:var(--ink-soft)">' + esc(j.strongest_signal) + '</div>';
    html += '</div>';
  }

  document.getElementById('drawer-body').innerHTML = html;
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('job-drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('job-drawer').classList.remove('open');
}

// ── Signals ────────────────────────────────────────────────────────────────
async function loadSignals() {
  const data = await apiFetch('/api/admin/signals');
  if (!data) return;

  const total = data.total || 1;
  const b = data.score_buckets;

  const bucketRows = [
    { label: 'Authentic',    key: 'authentic',    col: 'var(--green)' },
    { label: 'Ambiguous',    key: 'ambiguous',    col: 'var(--amber-state)' },
    { label: 'Inconclusive', key: 'inconclusive', col: '#8a8a8a' },
    { label: 'Suspicious',   key: 'suspicious',   col: 'var(--amber-state)' },
    { label: 'Manipulated',  key: 'manipulated',  col: 'var(--red-state)' },
  ].map(row => {
    const count = b[row.key] || 0;
    const pct = Math.round((count / total) * 100);
    return '<div class="signal-bar-row">' +
      '<div class="signal-bar-label">' + row.label + '</div>' +
      '<div class="signal-bar-track"><div class="signal-bar-fill" style="width:' + pct + '%;background:' + row.col + '"></div></div>' +
      '<div class="signal-bar-count">' + count + '</div>' +
      '</div>';
  }).join('');

  const dubbingRows = (data.dubbing_exclusions || [])
    .map(d => '<div class="drawer-row"><span class="drawer-key">' + esc(d.verdict_state) + '</span><span class="drawer-val">' + d.count + '</span></div>')
    .join('') || '<div style="font-size:13px;color:var(--ink-softer)">None</div>';

  const platRows = (data.platform_variance || [])
    .map(p => '<div class="drawer-row"><span class="drawer-key">' + esc(p.platform || 'unknown') + '</span><span class="drawer-val">' + (p.avg_score != null ? p.avg_score.toFixed(3) : '—') + ' <span style="color:var(--ink-softer)">(' + p.count + ')</span></span></div>')
    .join('') || '<div style="font-size:13px;color:var(--ink-softer)">No data</div>';

  document.getElementById('signals-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:700px">' +

    '<div style="background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:20px">' +
    '<div class="drawer-section-label" style="margin-bottom:12px">Score distribution (' + total + ' jobs)</div>' +
    bucketRows + '</div>' +

    '<div>' +
    '<div style="background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:20px;margin-bottom:14px">' +
    '<div class="drawer-section-label" style="margin-bottom:12px">Dubbing exclusions</div>' +
    dubbingRows + '</div>' +
    '<div style="background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:20px">' +
    '<div class="drawer-section-label" style="margin-bottom:12px">Avg score — authentic jobs, by platform</div>' +
    platRows + '</div>' +
    '</div>' +

    '</div>';
}

// ── Cost ───────────────────────────────────────────────────────────────────
async function loadCost() {
  const data = await apiFetch('/api/admin/cost');
  if (!data) return;

  const breakdownRows = (data.breakdown || []).map(row =>
    '<tr>' +
    '<td>' + esc(row.run_depth) + '</td>' +
    '<td style="text-align:right">' + row.seconds + 's</td>' +
    '<td style="text-align:right">' + row.count + '</td>' +
    '<td style="text-align:right">$' + row.cost_per_job.toFixed(3) + '</td>' +
    '<td style="text-align:right">$' + row.total.toFixed(2) + '</td>' +
    '</tr>'
  ).join('');

  document.getElementById('cost-content').innerHTML =
    '<div class="cost-summary">' +
    '<div class="cost-card"><div class="stat-label">Total cost</div><div class="stat-value">$' + (data.total_cost_usd || 0).toFixed(2) + '</div><div class="stat-delta">30d estimate</div></div>' +
    '<div class="cost-card"><div class="stat-label">Jobs</div><div class="stat-value">' + (data.total_jobs || 0) + '</div><div class="stat-delta">billed</div></div>' +
    '<div class="cost-card"><div class="stat-label">Avg / job</div><div class="stat-value">$' + (data.avg_cost_per_job || 0).toFixed(3) + '</div></div>' +
    '<div class="cost-card"><div class="stat-label">Total seconds</div><div class="stat-value">' + (data.total_seconds || 0) + 's</div><div class="stat-delta">video + audio (same call)</div></div>' +
    '</div>' +
    '<div class="table-wrap" style="max-width:600px">' +
    '<table><thead><tr><th>Depth</th><th style="text-align:right">Secs</th><th style="text-align:right">Jobs</th><th style="text-align:right">Cost/job</th><th style="text-align:right">Total</th></tr></thead>' +
    '<tbody>' + (breakdownRows || '<tr><td colspan="5" class="empty">No data</td></tr>') + '</tbody></table>' +
    '<div style="padding:10px 14px;font-size:11px;color:var(--ink-softer)">Rates: video $' + data.rates.video + '/s · audio $' + data.rates.audio + '/s (same Resemble call)</div>' +
    '</div>';
}

// ── Users ──────────────────────────────────────────────────────────────────
async function loadUsers(page) {
  usersPage = page;
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';

  const data = await apiFetch('/api/admin/users?page=' + page);
  if (!data) return;

  if (!data.users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No active users.</td></tr>';
    return;
  }

  tbody.innerHTML = data.users.map(u =>
    '<tr>' +
    '<td class="mono" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">' + esc(u.user_id) + '</td>' +
    '<td><span class="tier-badge ' + esc(u.tier) + '">' + esc(u.tier) + '</span></td>' +
    '<td style="text-align:right">' + (u.job_count || 0) + '</td>' +
    '<td style="text-align:right">' + (u.run_count || 0) + ' / ' + (u.quota_limit || '—') + '</td>' +
    '<td class="text-softer mono">' + (u.last_active ? relativeTime(u.last_active) : '—') + '</td>' +
    '</tr>'
  ).join('');

  setEl('users-page-info', 'Page ' + data.page + ' of ' + (data.total_pages || 1));
  document.getElementById('users-prev').disabled = data.page <= 1;
  document.getElementById('users-next').disabled = data.page >= data.total_pages;
}

// ── Cohort ─────────────────────────────────────────────────────────────────
async function loadCohort() {
  const data = await apiFetch('/api/admin/cohort');
  if (!data) return;

  if (!data.members.length) {
    document.getElementById('cohort-content').innerHTML =
      '<div class="empty">No Max tier users yet.</div>';
    return;
  }

  const rows = data.members.map(m =>
    '<div class="drawer-row">' +
    '<span class="drawer-key mono" style="font-size:11px">' + esc(m.id) + '</span>' +
    '<span class="drawer-val">' +
    '<span class="tier-badge max">max</span>' +
    (m.tier_expires_at ? ' <span style="font-size:11px;color:var(--ink-softer)">exp ' + fmtDate(m.tier_expires_at) + '</span>' : '') +
    '</span>' +
    '</div>'
  ).join('');

  document.getElementById('cohort-content').innerHTML =
    '<div style="background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:20px;max-width:600px">' +
    '<div class="drawer-section-label" style="margin-bottom:12px">' + data.count + ' member' + (data.count !== 1 ? 's' : '') + '</div>' +
    rows +
    '<div style="margin-top:12px;font-size:11px;color:var(--ink-softer)">' + esc(data.note) + '</div>' +
    '</div>';
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  viewLoaded['overview'] = true;
  loadOverview();
});
</script>
</body>
</html>`;
}

// ── Router ────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, method } = url;

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'https://skept.co',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Cookie',
        },
      });
    }

    try {
      // Serve dashboard shell (no auth — auth handled client-side via apiFetch redirects)
      // Actual admin gate is on every /api/admin/* call
      if (method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
        // Still require a valid admin session to see the HTML shell
        const authResult = await authenticate(request, env);
        if (authResult.error) {
          return new Response('', {
            status: 302,
            headers: { Location: '/' },
          });
        }
        return html(renderDashboard());
      }

      // All API routes require admin auth
      if (pathname.startsWith('/api/admin/')) {
        const authResult = await authenticate(request, env);
        if (authResult.error) {
          return json({ error: authResult.error }, authResult.status);
        }

        if (method === 'GET' && pathname === '/api/admin/overview') return handleOverview(env);
        if (method === 'GET' && pathname === '/api/admin/jobs') return handleJobs(request, env);
        if (method === 'GET' && pathname === '/api/admin/signals') return handleSignals(env);
        if (method === 'GET' && pathname === '/api/admin/cost') return handleCost(env);
        if (method === 'GET' && pathname === '/api/admin/users') return handleUsers(request, env);
        if (method === 'GET' && pathname === '/api/admin/cohort') return handleCohort(env);

        // GET /api/admin/jobs/:id
        const jobDetailMatch = pathname.match(/^\/api\/admin\/jobs\/([^/]+)$/);
        if (method === 'GET' && jobDetailMatch) return handleJobDetail(jobDetailMatch[1], env);

        return json({ error: 'not_found' }, 404);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('[admin-worker] unhandled error:', err.message, err.stack);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
