const VALID_TIERS = new Set(['free', 'plus', 'pro', 'max']);

export async function updateUserTier(db, userId, { tier, tierExpiresAt, subscriptionSource, subscriptionRef }) {
  if (!VALID_TIERS.has(tier)) throw new Error(`invalid tier: ${tier}`);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    UPDATE users
    SET tier = ?, tier_expires_at = ?, subscription_source = ?, subscription_ref = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    tier,
    tierExpiresAt ?? null,
    subscriptionSource ?? null,
    subscriptionRef ?? null,
    now,
    userId,
  ).run();
}
