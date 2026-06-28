const VALID_TIERS = new Set(['free', 'lite', 'plus', 'pro', 'max']);

export const QUOTA_LIMITS = { free: 5, lite: 10, plus: 20, pro: 40, max: 60 };

// authDb   — skept-auth D1 binding (always required)
// userId   — Skept user UUID
// opts     — { tier, tierExpiresAt, subscriptionSource, subscriptionRef, stripeCustomerId? }
// analysisDb — skept-analysis D1 binding (optional); when provided, quota_limit is synced
export async function updateUserTier(authDb, userId, opts, analysisDb) {
  const { tier, tierExpiresAt, subscriptionSource, subscriptionRef, stripeCustomerId } = opts;
  if (!VALID_TIERS.has(tier)) throw new Error(`invalid tier: ${tier}`);
  const now = Math.floor(Date.now() / 1000);

  const setClauses = [
    'tier = ?',
    'tier_expires_at = ?',
    'subscription_source = ?',
    'subscription_ref = ?',
    'updated_at = ?',
  ];
  const values = [
    tier,
    tierExpiresAt ?? null,
    subscriptionSource ?? null,
    subscriptionRef ?? null,
    now,
  ];

  if (stripeCustomerId !== undefined) {
    setClauses.push('stripe_customer_id = ?');
    values.push(stripeCustomerId);
  }

  values.push(userId);

  await authDb.prepare(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  if (analysisDb) {
    const quotaLimit = QUOTA_LIMITS[tier] ?? 5;
    await analysisDb.prepare(
      'UPDATE quota_usage SET quota_limit = ? WHERE user_id = ?'
    ).bind(quotaLimit, userId).run();
  }
}
