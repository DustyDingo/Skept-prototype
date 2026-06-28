import { updateUserTier, QUOTA_LIMITS } from './billing-utils.js';

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

async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { 'Authorization': 'Basic ' + btoa(secretKey + ':') },
  });
  return res.json();
}

async function lookupUserByCustomerId(db, stripeCustomerId) {
  const row = await db.prepare(
    'SELECT id FROM users WHERE stripe_customer_id = ?'
  ).bind(stripeCustomerId).first();
  return row ? row.id : null;
}

function tierFromPriceKey(priceKey) {
  // price key format: '{tier}_{period}' e.g. 'lite_monthly', 'plus_annual'
  return priceKey.split('_')[0];
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST' || url.pathname !== '/webhook') {
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
      // ── checkout.session.completed ──────────────────────────────────────────
      if (type === 'checkout.session.completed') {
        const userId = obj.metadata?.user_id;
        if (!userId) {
          console.warn('[stripe-webhook] checkout.session.completed: missing metadata.user_id');
          return json({ received: true });
        }

        const stripeCustomerId = obj.customer;
        const topupPack = obj.metadata?.topup_pack;

        if (topupPack) {
          // Top-up consumable payment
          const TOPUP_CREDITS = { small: 5, medium: 10, large: 20 };
          const credits = TOPUP_CREDITS[topupPack];
          if (!credits) {
            console.warn(`[stripe-webhook] checkout.session.completed: unknown topup_pack ${topupPack}`);
            return json({ received: true });
          }
          const topupExpiresAt = Math.floor(Date.now() / 1000) + 7776000; // 90 days
          await env.SKEPT_ANALYSIS_DB.prepare(
            'UPDATE quota_usage SET topup_credits = topup_credits + ?, topup_expires_at = ? WHERE user_id = ?'
          ).bind(credits, topupExpiresAt, userId).run();
          console.log(`[stripe-webhook] topup userId=${userId} pack=${topupPack} credits=${credits}`);
          return json({ received: true });
        }

        // Subscription checkout — fetch line items to resolve tier
        let priceIds;
        try {
          priceIds = JSON.parse(env.STRIPE_PRICE_IDS);
        } catch {
          console.error('[stripe-webhook] STRIPE_PRICE_IDS is not valid JSON');
          return json({ received: true });
        }

        const lineItems = await stripeGet(
          `/v1/checkout/sessions/${obj.id}/line_items`,
          env.STRIPE_SECRET_KEY
        );
        const priceId = lineItems.data?.[0]?.price?.id;
        if (!priceId) {
          console.warn('[stripe-webhook] checkout.session.completed: could not resolve price_id from line items');
          return json({ received: true });
        }

        const priceKey = Object.keys(priceIds).find(k => priceIds[k] === priceId);
        if (!priceKey) {
          console.warn(`[stripe-webhook] checkout.session.completed: no tier mapping for price_id ${priceId}`);
          return json({ received: true });
        }

        const tier = tierFromPriceKey(priceKey);
        const subscriptionRef = obj.subscription ?? null;

        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier,
          tierExpiresAt: null,
          subscriptionSource: 'stripe',
          subscriptionRef,
          stripeCustomerId,
        }, env.SKEPT_ANALYSIS_DB);

        console.log(`[stripe-webhook] checkout.session.completed userId=${userId} tier=${tier} sub=${subscriptionRef}`);

      // ── customer.subscription.updated ──────────────────────────────────────
      } else if (type === 'customer.subscription.updated') {
        const metaUserId = obj.metadata?.user_id;
        const userId = metaUserId || await lookupUserByCustomerId(env.SKEPT_AUTH_DB, obj.customer);
        if (!userId) {
          console.warn(`[stripe-webhook] customer.subscription.updated: no user for customer ${obj.customer}`);
          return json({ received: true });
        }

        const status = obj.status;
        if (status === 'active' || status === 'trialing') {
          let priceIds;
          try {
            priceIds = JSON.parse(env.STRIPE_PRICE_IDS);
          } catch {
            console.error('[stripe-webhook] STRIPE_PRICE_IDS is not valid JSON');
            return json({ received: true });
          }

          const priceId = obj.items?.data?.[0]?.price?.id;
          const priceKey = priceId ? Object.keys(priceIds).find(k => priceIds[k] === priceId) : null;
          const tier = priceKey ? tierFromPriceKey(priceKey) : obj.metadata?.tier;

          if (!tier) {
            console.warn(`[stripe-webhook] customer.subscription.updated: cannot resolve tier for sub ${obj.id}`);
            return json({ received: true });
          }

          await updateUserTier(env.SKEPT_AUTH_DB, userId, {
            tier,
            tierExpiresAt: obj.current_period_end ?? null,
            subscriptionSource: 'stripe',
            subscriptionRef: obj.id,
          }, env.SKEPT_ANALYSIS_DB);

          console.log(`[stripe-webhook] subscription.updated userId=${userId} tier=${tier} status=${status}`);
        } else if (status === 'canceled') {
          await updateUserTier(env.SKEPT_AUTH_DB, userId, {
            tier: 'free',
            tierExpiresAt: null,
            subscriptionSource: null,
            subscriptionRef: null,
          }, env.SKEPT_ANALYSIS_DB);
          console.log(`[stripe-webhook] subscription.updated userId=${userId} downgraded to free (canceled)`);
        } else {
          console.log(`[stripe-webhook] subscription.updated userId=${userId} status=${status} — no action`);
        }

      // ── customer.subscription.deleted ──────────────────────────────────────
      } else if (type === 'customer.subscription.deleted') {
        const userId = await lookupUserByCustomerId(env.SKEPT_AUTH_DB, obj.customer);
        if (!userId) {
          console.warn(`[stripe-webhook] subscription.deleted: no user for customer ${obj.customer}`);
          return json({ received: true });
        }
        await updateUserTier(env.SKEPT_AUTH_DB, userId, {
          tier: 'free',
          tierExpiresAt: null,
          subscriptionSource: null,
          subscriptionRef: null,
        }, env.SKEPT_ANALYSIS_DB);
        console.log(`[stripe-webhook] subscription.deleted userId=${userId} downgraded to free`);

      // ── invoice.payment_succeeded ───────────────────────────────────────────
      } else if (type === 'invoice.payment_succeeded') {
        console.log(`[stripe-webhook] invoice.payment_succeeded customer=${obj.customer} sub=${obj.subscription} — log only`);

      // ── invoice.payment_failed ──────────────────────────────────────────────
      } else if (type === 'invoice.payment_failed') {
        console.log(`[stripe-webhook] invoice.payment_failed customer=${obj.customer} next_attempt=${obj.next_payment_attempt} — log only`);

      } else {
        console.log(`[stripe-webhook] unhandled event type: ${type}`);
      }

      return json({ received: true });
    } catch (err) {
      console.error(`[stripe-webhook] error handling ${type}:`, err.message);
      // Return 200 to prevent Stripe retry storms
      return json({ received: true });
    }
  },
};
