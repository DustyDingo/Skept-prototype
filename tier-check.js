const TIER_CONFIG = {
  free:  { run_cap: 5,   depth: '6s',  queue: 'standard' },
  plus:  { run_cap: 20,  depth: '12s', queue: 'standard' },
  pro:   { run_cap: 50,  depth: '12s', queue: 'standard' },
  max:   { run_cap: 100, depth: '18s', queue: 'priority' },
};

const WINDOW_SECONDS = 2592000; // 30 days

export async function checkTierPermission(userId, authDb, analysisDb) {
  // 1. Fetch tier from skept-auth
  const userRow = await authDb
    .prepare('SELECT tier, tier_expires_at FROM users WHERE id = ?')
    .bind(userId)
    .first();

  if (!userRow) {
    return { allowed: false, reason: 'user_not_found' };
  }

  const now = Math.floor(Date.now() / 1000);
  let tier = userRow.tier;
  let tier_expired = false;

  if (userRow.tier_expires_at !== null && userRow.tier_expires_at < now) {
    tier = 'free';
    tier_expired = true;
  }

  // 2. Resolve tier config
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.free;
  const { run_cap, depth, queue } = config;

  // 3. Quota check from skept-analysis
  let quota = await analysisDb
    .prepare('SELECT run_count, window_start FROM quota_usage WHERE user_id = ?')
    .bind(userId)
    .first();

  if (!quota) {
    await analysisDb
      .prepare(
        'INSERT INTO quota_usage (user_id, run_count, window_start, updated_at) VALUES (?, 0, ?, ?)'
      )
      .bind(userId, now, now)
      .run();
    quota = { run_count: 0, window_start: now };
  } else if (now > quota.window_start + WINDOW_SECONDS) {
    await analysisDb
      .prepare(
        'UPDATE quota_usage SET run_count = 0, window_start = ?, updated_at = ? WHERE user_id = ?'
      )
      .bind(now, now, userId)
      .run();
    quota = { run_count: 0, window_start: now };
  }

  if (quota.run_count >= run_cap) {
    return { allowed: false, reason: 'quota_exceeded', runs_remaining: 0 };
  }

  // 4. Allowed
  return {
    allowed: true,
    tier,
    tier_expired,
    depth,
    queue,
    runs_remaining: run_cap - quota.run_count,
  };
}
