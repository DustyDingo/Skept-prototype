import { updateUserTier } from './billing-utils.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST' || url.pathname !== '/api/webhooks/revenuecat') {
      return json({ error: 'not_found' }, 404);
    }

    // Auth — RC sends the shared secret as the Authorization header value
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader !== env.REVENUECAT_WEBHOOK_SECRET) {
      console.warn('[rc-webhook] invalid authorization');
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const event = body.event;
    if (!event) {
      console.warn('[rc-webhook] missing event object');
      return json({ received: true });
    }

    const { type, app_user_id: userId, product_id: productId, expiration_at_ms: expirationAtMs, transaction_id: transactionId } = event;

    if (!userId) {
      console.warn(`[rc-webhook] ${type}: missing app_user_id`);
      return json({ received: true });
    }

    try {
      if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') {
        let productTiers;
        try {
          productTiers = JSON.parse(env.REVENUECAT_PRODUCT_TIERS);
        } catch {
          console.error('[rc-webhook] REVENUECAT_PRODUCT_TIERS is not valid JSON');
          return json({ received: true });
        }
        const tier = productTiers[productId];
        if (!tier) {
          console.warn(`[rc-webhook] ${type}: no tier mapping for product_id ${productId}`);
          return json({ received: true });
        }
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier,
          tierExpiresAt: expirationAtMs != null ? Math.floor(expirationAtMs / 1000) : null,
          subscriptionSource: 'revenuecat',
          subscriptionRef: transactionId ?? null,
        });
        console.log(`[rc-webhook] ${type} userId=${userId} tier=${tier}`);

      } else if (type === 'CANCELLATION') {
        // Access continues until expiry — preserve tier, update expires_at only
        const now = Math.floor(Date.now() / 1000);
        await env.SKEPT_AUTH_DB.prepare(
          'UPDATE users SET tier_expires_at = ?, updated_at = ? WHERE id = ?'
        ).bind(
          expirationAtMs != null ? Math.floor(expirationAtMs / 1000) : null,
          now,
          userId,
        ).run();
        console.log(`[rc-webhook] CANCELLATION userId=${userId} access until ${expirationAtMs}`);

      } else if (type === 'EXPIRATION') {
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier: 'free',
          tierExpiresAt: null,
          subscriptionSource: null,
          subscriptionRef: null,
        });
        console.log(`[rc-webhook] EXPIRATION userId=${userId} downgraded to free`);

      } else if (type === 'BILLING_ISSUE') {
        console.warn(`[rc-webhook] BILLING_ISSUE userId=${userId} product=${productId} — RC handles retry`);

      } else {
        console.log(`[rc-webhook] unrecognised event type: ${type} — ignored`);
      }

      return json({ received: true });
    } catch (err) {
      console.error(`[rc-webhook] error handling ${type}:`, err.message);
      return json({ received: true });
    }
  },
};
