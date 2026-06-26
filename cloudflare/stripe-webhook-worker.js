import { updateUserTier } from './billing-utils.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const entries = sigHeader.split(',').map(p => {
    const idx = p.indexOf('=');
    return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
  });
  const params = Object.fromEntries(entries);
  const t = params.t;
  const v1 = params.v1;
  if (!t || !v1) return false;

  const ts = parseInt(t, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const payload = `${t}.${rawBody}`;
  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(payload);

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, msgBytes);
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

async function lookupUserByCustomerId(db, stripeCustomerId) {
  const row = await db.prepare(
    'SELECT id FROM users WHERE stripe_customer_id = ?'
  ).bind(stripeCustomerId).first();
  return row ? row.id : null;
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST' || url.pathname !== '/api/webhooks/stripe') {
      return json({ error: 'not_found' }, 404);
    }

    const rawBody = await request.text();
    const sigHeader = request.headers.get('Stripe-Signature') || '';

    const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      console.warn('[stripe-webhook] signature validation failed');
      return json({ error: 'invalid_signature' }, 400);
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const { type, data } = event;
    const obj = data?.object;

    try {
      if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
        const customerId = obj.customer;
        const subscriptionId = obj.id;
        const status = obj.status;
        const periodEnd = obj.current_period_end;
        const tier = obj.metadata?.tier;

        const userId = await lookupUserByCustomerId(env.SKEPT_AUTH_DB, customerId);
        if (!userId) {
          console.warn(`[stripe-webhook] ${type}: no user for customer ${customerId}`);
          return json({ received: true });
        }

        if (status === 'active' || status === 'trialing') {
          if (!tier) {
            console.warn(`[stripe-webhook] ${type}: subscription ${subscriptionId} missing metadata.tier`);
            return json({ received: true });
          }
          await updateUserTier(env.SKEPT_AUTH_DB, userId, {
            tier,
            tierExpiresAt: periodEnd,
            subscriptionSource: 'stripe',
            subscriptionRef: subscriptionId,
          });
          console.log(`[stripe-webhook] ${type} userId=${userId} tier=${tier} status=${status}`);
        } else if (status === 'canceled') {
          await updateUserTier(env.SKEPT_AUTH_DB, userId, {
            tier: 'free',
            tierExpiresAt: null,
            subscriptionSource: null,
            subscriptionRef: null,
          });
          console.log(`[stripe-webhook] ${type} userId=${userId} downgraded to free (status=canceled)`);
        } else {
          console.log(`[stripe-webhook] ${type} userId=${userId} status=${status} — no action`);
        }

      } else if (type === 'customer.subscription.deleted') {
        const customerId = obj.customer;
        const userId = await lookupUserByCustomerId(env.SKEPT_AUTH_DB, customerId);
        if (!userId) {
          console.warn(`[stripe-webhook] ${type}: no user for customer ${customerId}`);
          return json({ received: true });
        }
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier: 'free',
          tierExpiresAt: null,
          subscriptionSource: null,
          subscriptionRef: null,
        });
        console.log(`[stripe-webhook] ${type} userId=${userId} downgraded to free`);

      } else if (type === 'invoice.payment_failed') {
        const customerId = obj.customer;
        const nextAttempt = obj.next_payment_attempt;
        const userId = await lookupUserByCustomerId(env.SKEPT_AUTH_DB, customerId);
        if (!userId) {
          console.warn(`[stripe-webhook] ${type}: no user for customer ${customerId}`);
          return json({ received: true });
        }
        const now = Math.floor(Date.now() / 1000);
        await env.SKEPT_AUTH_DB.prepare(
          'UPDATE users SET tier_expires_at = ?, updated_at = ? WHERE id = ?'
        ).bind(nextAttempt ?? null, now, userId).run();
        console.log(`[stripe-webhook] ${type} userId=${userId} grace until ${nextAttempt}`);

      } else if (type === 'invoice.payment_succeeded') {
        const customerId = obj.customer;
        const subscriptionId = obj.subscription;
        const lineItem = obj.lines?.data?.[0];
        const periodEnd = lineItem?.period?.end;
        const tier = lineItem?.metadata?.tier;
        const userId = await lookupUserByCustomerId(env.SKEPT_AUTH_DB, customerId);
        if (!userId) {
          console.warn(`[stripe-webhook] ${type}: no user for customer ${customerId}`);
          return json({ received: true });
        }
        if (!tier) {
          console.warn(`[stripe-webhook] ${type}: invoice line missing metadata.tier for user ${userId}`);
          return json({ received: true });
        }
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier,
          tierExpiresAt: periodEnd ?? null,
          subscriptionSource: 'stripe',
          subscriptionRef: subscriptionId,
        });
        console.log(`[stripe-webhook] ${type} userId=${userId} tier=${tier} renewed`);

      } else {
        console.log(`[stripe-webhook] unhandled event type: ${type}`);
      }

      return json({ received: true });
    } catch (err) {
      console.error(`[stripe-webhook] error handling ${type}:`, err.message);
      // Still return 200 to prevent Stripe retry storms
      return json({ received: true });
    }
  },
};
