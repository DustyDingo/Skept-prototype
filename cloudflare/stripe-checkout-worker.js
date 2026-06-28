function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// verifyJWT — KV-backed session validation per §3.50 spec naming.
// Swap body for HS256 JWT verification once auth-worker.js ships JWT tokens.
async function verifyJWT(request, AUTH_SESSIONS) {
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

const TOPUP_KEYS = new Set(['topup_small', 'topup_medium', 'topup_large']);

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);

    if (method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const authResult = await verifyJWT(request, env.AUTH_SESSIONS);
    if (authResult.error) {
      return json({ error: authResult.error }, authResult.status);
    }
    const { session } = authResult;
    const userId = session.user_id;

    try {
      // POST /api/billing/checkout
      if (url.pathname === '/api/billing/checkout') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        const { price_id, success_url, cancel_url } = body;
        if (!price_id || !success_url || !cancel_url) {
          return json({ error: 'missing_fields' }, 400);
        }

        let priceIds;
        try {
          priceIds = JSON.parse(env.STRIPE_PRICE_IDS);
        } catch {
          console.error('[checkout] STRIPE_PRICE_IDS is not valid JSON');
          return json({ error: 'configuration_error' }, 500);
        }

        // Validate price_id and resolve its key
        const priceKey = Object.keys(priceIds).find(k => priceIds[k] === price_id);
        if (!priceKey) {
          return json({ error: 'invalid_price_id' }, 400);
        }

        const isTopup = TOPUP_KEYS.has(priceKey);
        const mode = isTopup ? 'payment' : 'subscription';

        let sessionParams;

        if (isTopup) {
          const topupPack = priceKey.replace('topup_', '');
          sessionParams = {
            'mode': mode,
            'success_url': success_url,
            'cancel_url': cancel_url,
            'line_items[0][price]': price_id,
            'line_items[0][quantity]': '1',
            'metadata[user_id]': userId,
            'metadata[topup_pack]': topupPack,
          };
        } else {
          const tier = priceKey.split('_')[0];
          sessionParams = {
            'mode': mode,
            'success_url': success_url,
            'cancel_url': cancel_url,
            'line_items[0][price]': price_id,
            'line_items[0][quantity]': '1',
            'metadata[user_id]': userId,
            'metadata[source]': 'stripe',
            'subscription_data[metadata][tier]': tier,
          };

          // Attach existing Stripe customer if available
          const userRow = await env.SKEPT_AUTH_DB.prepare(
            'SELECT stripe_customer_id FROM users WHERE id = ?'
          ).bind(userId).first();
          if (userRow?.stripe_customer_id) {
            sessionParams['customer'] = userRow.stripe_customer_id;
          }
        }

        const checkoutSession = await stripePost('/v1/checkout/sessions', sessionParams, env.STRIPE_SECRET_KEY);
        if (!checkoutSession.url) {
          console.error('[checkout] session create failed:', JSON.stringify(checkoutSession));
          return json({ error: 'stripe_error' }, 502);
        }

        console.log(`[checkout] session created userId=${userId} priceKey=${priceKey} mode=${mode}`);
        return json({ url: checkoutSession.url });
      }

      // POST /api/billing/portal
      if (url.pathname === '/api/billing/portal') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        const { return_url } = body;
        if (!return_url) {
          return json({ error: 'missing_return_url' }, 400);
        }

        const userRow = await env.SKEPT_AUTH_DB.prepare(
          'SELECT stripe_customer_id FROM users WHERE id = ?'
        ).bind(userId).first();

        if (!userRow?.stripe_customer_id) {
          return json({ error: 'No billing account found' }, 404);
        }

        const portalSession = await stripePost('/v1/billing_portal/sessions', {
          'customer': userRow.stripe_customer_id,
          'return_url': return_url,
        }, env.STRIPE_SECRET_KEY);

        if (!portalSession.url) {
          console.error('[checkout] portal session create failed:', JSON.stringify(portalSession));
          return json({ error: 'stripe_error' }, 502);
        }

        return json({ url: portalSession.url });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('[checkout] unhandled error:', err.message);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
