import { updateUserTier } from './billing-utils.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyRcSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(rawBody);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, msgBytes);
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed.length !== sigHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  }
  return diff === 0;
}

// RC entitlement identifier → Skept tier
const ENTITLEMENT_TIERS = {
  'Skept Lite': 'lite',
  'Skept Plus': 'plus',
  'Skept Pro':  'pro',
  'Skept Max':  'max',
};

// RC product identifier → top-up credits
const TOPUP_CREDITS = {
  'skept_topup_small':  5,
  'skept_topup_medium': 10,
  'skept_topup_large':  20,
};

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST' || url.pathname !== '/webhook') {
      return json({ error: 'not_found' }, 404);
    }

    const rawBody = await request.text();
    const sigHeader = request.headers.get('X-RevenueCat-Webhook-Signature') || '';

    const valid = await verifyRcSignature(rawBody, sigHeader, env.RC_HMAC_SECRET);
    if (!valid) {
      console.warn('[rc-webhook] invalid HMAC signature');
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const event = body.event;
    if (!event) {
      console.warn('[rc-webhook] missing event object');
      return json({ received: true });
    }

    const {
      type,
      app_user_id:    userId,
      product_id:     productId,
      expiration_at_ms: expirationAtMs,
      transaction_id: transactionId,
      entitlement_ids: entitlementIds,
    } = event;

    if (!userId) {
      console.warn(`[rc-webhook] ${type}: missing app_user_id`);
      return json({ received: true });
    }

    try {
      if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') {
        const entitlementId = entitlementIds?.[0];
        const tier = ENTITLEMENT_TIERS[entitlementId];
        if (!tier) {
          console.warn(`[rc-webhook] ${type}: no tier mapping for entitlement '${entitlementId}'`);
          return json({ received: true });
        }
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier,
          tierExpiresAt: expirationAtMs != null ? Math.floor(expirationAtMs / 1000) : null,
          subscriptionSource: 'revenuecat',
          subscriptionRef: transactionId ?? null,
        }, env.SKEPT_ANALYSIS_DB);
        console.log(`[rc-webhook] ${type} userId=${userId} tier=${tier}`);

      } else if (type === 'NON_SUBSCRIPTION_PURCHASE') {
        const credits = TOPUP_CREDITS[productId];
        if (!credits) {
          console.warn(`[rc-webhook] NON_SUBSCRIPTION_PURCHASE: no credits mapping for product_id '${productId}'`);
          return json({ received: true });
        }
        const topupExpiresAt = Math.floor(Date.now() / 1000) + 7776000; // 90 days
        await env.SKEPT_ANALYSIS_DB.prepare(
          'UPDATE quota_usage SET topup_credits = topup_credits + ?, topup_expires_at = ? WHERE user_id = ?'
        ).bind(credits, topupExpiresAt, userId).run();
        console.log(`[rc-webhook] NON_SUBSCRIPTION_PURCHASE userId=${userId} product=${productId} credits=${credits}`);

      } else if (type === 'CANCELLATION' || type === 'EXPIRATION') {
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier: 'free',
          tierExpiresAt: null,
          subscriptionSource: null,
          subscriptionRef: null,
        }, env.SKEPT_ANALYSIS_DB);
        console.log(`[rc-webhook] ${type} userId=${userId} downgraded to free`);

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
