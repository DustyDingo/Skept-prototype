import { updateUserTier } from './billing-utils.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function validateSession(request, AUTH_SESSIONS) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'missing_token', status: 401 };

  const raw = await AUTH_SESSIONS.get(token);
  if (!raw) return { error: 'invalid_token', status: 401 };

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return { error: 'invalid_token', status: 401 };
  }

  if (!session.expires_at || session.expires_at <= Date.now()) {
    return { error: 'token_expired', status: 401 };
  }

  return { session };
}

async function stripePost(path, params, secretKey) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(secretKey + ':'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

const VALID_TIERS = new Set(['plus', 'pro', 'max']);
const VALID_PERIODS = new Set(['monthly', 'annual']);

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST' || url.pathname !== '/api/billing/create-checkout-session') {
      return json({ error: 'not_found' }, 404);
    }

    // Origin check
    const origin = request.headers.get('Origin') || '';
    if (origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'forbidden' }, 403);
    }

    try {
      // Auth
      const authResult = await validateSession(request, env.AUTH_SESSIONS);
      if (authResult.error) {
        return json({ error: authResult.error }, authResult.status);
      }
      const { session } = authResult;
      const userId = session.user_id;

      // Parse body
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid_json' }, 400);
      }

      const { tier, billing_period: billingPeriod } = body;

      if (!VALID_TIERS.has(tier)) {
        return json({ error: 'invalid_tier' }, 400);
      }
      if (!VALID_PERIODS.has(billingPeriod)) {
        return json({ error: 'invalid_billing_period' }, 400);
      }

      // Look up user
      const userRow = await env.SKEPT_AUTH_DB.prepare(
        'SELECT id, stripe_customer_id FROM users WHERE id = ?'
      ).bind(userId).first();

      if (!userRow) {
        return json({ error: 'user_not_found' }, 404);
      }

      // Create Stripe customer if needed
      let stripeCustomerId = userRow.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await stripePost('/v1/customers', { metadata: { skept_user_id: userId } }, env.STRIPE_SECRET_KEY);
        if (!customer.id) {
          console.error('[checkout] stripe customer create failed:', JSON.stringify(customer));
          return json({ error: 'stripe_error' }, 502);
        }
        stripeCustomerId = customer.id;
        const now = Math.floor(Date.now() / 1000);
        await env.SKEPT_AUTH_DB.prepare(
          'UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?'
        ).bind(stripeCustomerId, now, userId).run();
        console.log(`[checkout] created stripe customer ${stripeCustomerId} for user ${userId}`);
      }

      // Resolve price ID
      let priceIds;
      try {
        priceIds = JSON.parse(env.STRIPE_PRICE_IDS);
      } catch {
        console.error('[checkout] STRIPE_PRICE_IDS is not valid JSON');
        return json({ error: 'configuration_error' }, 500);
      }
      const priceKey = `${tier}_${billingPeriod}`;
      const priceId = priceIds[priceKey];
      if (!priceId) {
        console.error(`[checkout] no price ID for key: ${priceKey}`);
        return json({ error: 'price_not_found' }, 400);
      }

      // Create checkout session
      const sessionParams = {
        'customer': stripeCustomerId,
        'mode': 'subscription',
        'success_url': 'https://skept.co/account?billing=success',
        'cancel_url': 'https://skept.co/pricing',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'subscription_data[metadata][tier]': tier,
      };

      const checkoutSession = await stripePost('/v1/checkout/sessions', sessionParams, env.STRIPE_SECRET_KEY);
      if (!checkoutSession.url) {
        console.error('[checkout] stripe session create failed:', JSON.stringify(checkoutSession));
        return json({ error: 'stripe_error' }, 502);
      }

      console.log(`[checkout] session created userId=${userId} tier=${tier} period=${billingPeriod}`);
      return json({ url: checkoutSession.url });
    } catch (err) {
      console.error('[checkout] unhandled error:', err.message);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
