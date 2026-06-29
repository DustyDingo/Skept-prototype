# Skept Prototype — Developer Reference
**Last updated: 29 Jun 2026**

Skept is an AI-content detection and video verification platform for short-form social media. This file is the canonical session-start reference for Claude Code. Load it at the start of every session.

---

## Repo location

Local path: C:\Users\charl\OneDrive\Documents\App Development\Skept\Deployment-Skept\Github Repo\Skept-prototype

---

## Architecture overview

Single-file FastAPI app — all backend logic and frontend HTML live in `main.py`. No separate frontend directory. Edit `main.py` directly for all UI and pipeline changes.

**Analysers:**
- `analysers/deepfake.py` — Resemble AI DETECT-3B Omni (video). Single API call to `/api/v1/detect`. Submits `df_sampled.mp4`. Returns per-frame scores via `video_metrics.children`. Certainty-weighted mean scoring. Also reads embedded audio score from same response (`item["metrics"]["aggregated_score"]`), stored as `video_job_audio_score`.
- `analysers/audio.py` — reads `video_job_audio_score` (`item["metrics"]["aggregated_score"]` from Resemble Omni video job, extracted in `deepfake.py` and passed via shared job dict). Scoring: `aggregated_score == -1.0` → `score=None` (no-speech sentinel, excluded from fusion, UI shows "No speech detected"); valid float → `score = max(aggregated_score, 0.0)` (Resemble's negative range means "definitely real"; negatives floor to 0.0); API error / missing field → `score=None` (not anchored at 0.50). No librosa heuristics, no consistency scalar, no `(raw+1)/2` conversion, no minimum floor (0.15), no standalone audio.wav Resemble call. Source logged as `video_job_omni`. Known gap: `video_job_audio_label` extracted in `deepfake.py` but not yet forwarded to `audio.py` (§3.72 — no scoring impact, fix pending).
- `analysers/c2pa.py` — reads `resemble_c2pa` field from Resemble video job response. Maps `None → not_found`, present value → `found`. No hardcoded `skipped` — that only appears as an early pre-Resemble write which `c2pa.py` overwrites correctly after the job returns.
- `analysers/metadata.py`, `analysers/source_rep.py`, `analysers/source_beh.py` — Source Details only. Not fusion contributors.

**Fusion (`fusion.py`):**
Weighted ensemble over verdict-determining pillars only.

| Pillar | Weight | Status |
|---|---|---|
| Video detection (`deepfake`) | 0.60 | Active |
| Audio detection (`audio`) | 0.35 | Active |
| C2PA / provenance | ~0.40 reserved | Stubbed — excluded from denominator |
| **Active denominator** | **0.95** | |

- Source Details signals (metadata, source_rep, source_beh) excluded from denominator entirely — evidence card only.
- `score=None` on any pillar: pillar excluded from both numerator and denominator. Denominator self-adjusts.
- Do not hard-code a fixed denominator of 1.0.

**Asymmetric exclusion — audio-dubbing pattern:**
When `deepfake_final < 0.10 AND audio_final > 0.60`, deepfake is excluded from both numerator and denominator. `excluded_reason: audio_dubbing_pattern` written to pillar dict. `contribution: 0.0`. Denominator collapses to 0.35. This must be functional in the fusion calculation — not decorative.

**Verdict bands:**
- Green (Likely Authentic): 0.0 – 0.30
- Amber (Inconclusive): 0.30 – 0.60
- Red (Likely Manipulated): 0.60 – 1.0

**Pillar score semantics:**
- `score > 0.5` = suspicious (earned)
- `score = 0.5` = neutral (absence of signal, not authentic)
- `score < 0.5` = authentic-leaning (earned — positive authenticity evidence found)
- `score = None` = excluded from fusion entirely

---

## Resemble AI integration

- Endpoint: `/api/v1/detect`
- Single API call per job (`df_sampled.mp4`). No separate audio.wav submission.
- Audio score embedded in video job response: `item["metrics"]["aggregated_score"]`
- Audio score formula: `score = max(aggregated_score, 0.0)` — Resemble's negative range means "definitely real"; negatives floor to 0.0. No `(raw+1)/2` conversion applied. Pending live data validation across more clip types (§3.70).
- Calibration note (27 Jun 2026): On genuinely clean audio, Resemble's `aggregated_score` clusters near `0.0` rather than near `-1.0`. This means `max(0.0, 0.0) = 0.0` is the structural floor — audio pillar will rarely score below 1–2% on authentic clips. This inflates the audio contribution to fusion slightly on clean content. No threshold adjustment pending — requires more live data. Monitor across a broader clip set before acting.
- No-speech sentinel: `aggregated_score == -1.0` → `score=None` (excluded from fusion). Do not fall back to librosa.
- C2PA: read from `resemble_c2pa` field in video job response.

**Frame scalar (deepfake pillar):**
- `resemble_frame_count` — Resemble's internal count of ImageResult nodes across the submitted clip (not Skept's sample count).
- `skept_frames` — Skept's requested frame sample count (default 6).
- Certainty scalar formula (confirmed §3.75, 27 Jun 2026): `certainty = min(skept_frames, resemble_frame_count) / skept_frames` — caps at 1.0 when Resemble processed ≥ SKEPT_FRAMES frames. Previous formula was directionally inverted.
- Base score: `video_metrics.score` is used directly before certainty weighting. The legacy per-frame mean path (inherited from scamai architecture) has been removed.
- Confirmed result (Biden/alien Reel): `certainty=1.0000, certainty_weighted_score=0.6006, final_score=0.6010` → 60% Likely Manipulated. Matches Resemble's own "Deepfake Detected" verdict.

**Pillar independence caveat:**
Both video and audio pillars derive from the same Resemble DETECT-3B Omni video job. Reduced independence is a documented Phase 1 trade-off. Sightengine reintroduction is the architectural fix.

**KlingAI / text-to-video gap:**
Resemble Omni cannot detect text-to-video AI synthesis (KlingAI, Sora, Runway, Pika, Veo). Known model coverage gap. Not a pipeline bug.

---

## Job store

In-memory Python dict. Stateless — jobs lost on restart. Phase 1 must replace with persistent queue (Temporal is current lean).

---

## Ingestion

- yt-dlp handles URL ingestion for TikTok, YouTube, Instagram (server-side, dev/testing only for Instagram).
- Discord CDN links (`cdn.discordapp.com/attachments/…`) bypass yt-dlp — direct file download branch.
- All clips trimmed to 15 seconds max before Resemble submission (`ffmpeg -t 15 -c copy`). Logging: `trimmed` bool + `original_duration_sec` int written to job result.
- Temp file cleanup runs post-processing on Railway.
- URL validation (scheme=http/https, non-empty netloc) must occur at `/api/analyse` before yt-dlp dispatch. Returns 400 on failure.

**Wikidata subject list:**
Lazy-loaded on first job, not at startup. Prevents cold-start timeout and double-emit.

---

## UI rendering rules

- Pillar active count = pillars with `score != None AND no excluded_reason`. When `audio_dubbing_pattern` fires, deepfake is excluded — count must reflect this (1/2, not 2/2).
- `audio_dubbing_pattern` DOM label (`ref_53`) is a pure client-side conditional: `const _dfExcluded = analysers.deepfake && analysers.deepfake.excluded_reason === 'audio_dubbing_pattern'` — the `<p id="dubbingNote">` element is only injected into `dubbingNoteContainer` when this condition is true. Not server-side generated.
- Audio state copy: "Audio & voice clone — no speech detected" vs "Audio & voice clone — excluded" are distinct states and must use distinct copy.
- Confidence meter: no zone-divider tick marks on track. Zone labels (`AUTHENTIC / INCONCLUSIVE / SUSPICIOUS`) are the only threshold indicators.

---

## Open checklist items (as of 29 Jun 2026)

**Current baselines:** Project Brief v0.24 (29 Jun 2026) · Engineers Brief v0.21 (29 Jun 2026)

| Item | Description |
|---|---|
| §3.31 | Trump QID absent — hashtag `#presidentdonaldtrump` not segmented by wordninja; NER returns empty entity list |
| §3.44 | Audio evidence card body text unverified |
| §3.45 | No-speech path unverified |
| §3.50 | (carry forward) |
| §3.56 | Pillar active count "2/2" on `audio_dubbing_pattern` exclusion path — unverified fix |
| §3.58 | `ref_53` DOM label renders on non-dubbing-pattern jobs — REOPENED; multiple render sites identified |
| §3.59 | No-audio-stream vs no-speech copy distinction — unverified |
| §3.60 | "Audio & voice clone detection" row should appear in Stage 2 GPU Ensemble block in progress screen (Resemble audio is GPU) |
| §3.62 | Resemble dashboard Audio % vs Skept Audio % divergence — disclosure note in evidence card (low priority) |
| §3.63 | High-variance per-frame scores not surfaced in verdict UI |
| §3.66 | URL validation before yt-dlp dispatch |
| §3.69 | Frame confidence scalar suppresses verdict on text-to-video synthetic content (certainty low on generative content); correct fix is Sightengine reintroduction (§3.20) |
| §3.70 | Audio `max(raw, 0.0)` formula — clean audio clusters near 0.0 correctly, but pending live data validation across more clip types |
| §3.72 | `video_job_audio_label` not forwarded from `deepfake.py` to `audio.py` — no scoring impact, one-liner fix pending |
| §3.76 | Logo colour: loupe mark renders grey in nav — SVG color not resolving to `#1a1a1a`. Fix: set `color: #1a1a1a` explicitly on SVG use element in nav markup. Affects all four frontend pages. |
| §3.77 | verify.html: scaffold only — full build pending (next priority after logo fix) |
| §3.78 | settings.html: scaffold only — not yet built |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `RESEMBLE_API_KEY` | Resemble AI DETECT-3B Omni |
| `RAILWAY_*` | Set by Railway automatically |

---

## Deploy

**Railway (prototype):** Push to `main` → auto-deploy. Monitor via Railway dashboard logs.
**Production stack (not yet built):** Cloudflare Pages + Workers + D1 + R2 + KV. Railway decommissioned at production launch.

---

## Current build state (as of 29 Jun 2026)

| Component | Status |
|---|---|
| Auth flow | LIVE — magic link, cookie session, `/api/auth/me`, `/api/auth/logout` |
| History page (`history.html`) | LIVE at skept.co/history — cream shell, quota strip, filter chips, card list, delete flow |
| History Worker | LIVE at skept.co/api/history/* |
| Billing Workers (Stripe + RevenueCat) | LIVE — `skept-stripe-checkout`, `skept-stripe-webhook`, `skept-revenuecat-webhook` |
| Verify Worker | LIVE at skept.co/api/verify/* — backend complete, frontend scaffold only |
| Settings Worker | LIVE at skept.co/api/settings/* |
| verify.html | Scaffold only — not yet built |
| settings.html | Scaffold only — not yet built |
| Logo / loupe mark colour in nav | Bug — renders grey, fix pending (§3.76) |

---

## Cloudflare Pages

Project name: skept-prototype
Live domain: skept.co
Branch: main
Build command: npm run build
Root directory: frontend
Output directory: dist
Auto-deploys on push to main — no manual deploy needed for frontend changes.

---

## Worker routes (skept.co)

- skept-auth → skept.co/api/auth/*
- skept-settings → skept.co/api/settings/*
- skept-stripe-checkout → skept.co/api/billing/*
- skept-stripe-webhook → skept.co/api/webhooks/stripe
- skept-revenuecat-webhook → skept.co/api/webhooks/revenuecat
- skept-verify → skept.co/api/verify/*
- skept-history → skept.co/api/history/*

---

## Worker deploy commands (run from repo root)

```bash
npx wrangler@latest deploy --config wrangler-auth.toml
npx wrangler@latest deploy --config cloudflare/wrangler-verify.toml
npx wrangler@latest deploy --config cloudflare/wrangler-history.toml
npx wrangler@latest deploy --config cloudflare/wrangler-settings.toml
npx wrangler@latest deploy --config cloudflare/wrangler-stripe-checkout.toml
npx wrangler@latest deploy --config cloudflare/wrangler-stripe-webhook.toml
npx wrangler@latest deploy --config cloudflare/wrangler-revenuecat-webhook.toml
```

---

## Secrets

All secrets provisioned via: `npx wrangler@latest secret put <SECRET_NAME> --config <toml file>`

- skept-auth secrets: ENCRYPTION_KEY (32-byte base64), IP_SALT, RESEND_API_KEY
- skept-settings secrets: ENCRYPTION_KEY (must match skept-auth), IP_SALT
- skept-stripe-checkout secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_IDS, JWT_SECRET
- skept-stripe-webhook secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_IDS
- skept-revenuecat-webhook secrets: RC_HMAC_SECRET

---

## Auth flow

Magic link passwordless auth. Sign-in page at skept.co sets skept_session httpOnly cookie on skept.co domain after token exchange. All API calls use credentials: 'include'. Token endpoint: POST /api/auth/request. Verify endpoint: POST /api/auth/verify. Session check: GET /api/auth/me. Logout: POST /api/auth/logout.

---

## Frontend structure

```
frontend/
  index.html          — sign-in (LIVE — magic link)
  verify.html         — verify flow (scaffold only — not yet built)
  history.html        — analysis history (LIVE — cream shell, quota strip, filter chips, card list, delete flow)
  settings.html       — account settings (scaffold only — not yet built)
  public/_redirects   — MPA routing for Cloudflare Pages
  src/
    api.js            — shared fetch wrapper (all fetch calls, credentials: include, relative /api/* paths)
    auth.js           — shared auth guard (checkAuth, logout)
    history.js        — history page logic (all history page JS)
    pages/
      signin.js
      verify.js
      settings.js
```

---

## Design system

**Interior page shell (all authenticated pages):**
- Background: `#faf8f3` (cream)
- Accent / amber: `#b87400`
- Nav: sticky, frosted glass (`backdrop-filter: saturate(140%) blur(8px)`), `border-bottom: 1px solid #e8e4db`
- Wordmark: Sorts Mill Goudy italic, 22px
- Body font: Inter
- Max content width: 1080px centred, padding 0 32px
- Mobile (≤640px): padding 0 16px
- Loupe mark SVG: solid dark circle (`#1a1a1a`), cream italic S (`#faf8f3`), handle lower-left 45°

**CSS custom properties:**
`--amber: #b87400` · `--ink: #1a1a1a` · `--ink-soft: #5a5a5a` · `--ink-softer: #8a8a8a` · `--bg: #faf8f3` · `--card: #ffffff` · `--rule: #e8e4db` · `--green: #3a7a50` · `--green-light: #7aaa88` · `--red-state: #a83a2a`
Display font: Sorts Mill Goudy (wordmark only, italic). Body: Inter.

---

## Stripe MCP

Stripe MCP active. Secret key set manually in `.claude/settings.json` — never commit this file if it contains a live key. `.claude/settings.json` is listed in `.gitignore`.

**Role:** Web billing provider (Phase 2). Handles subscription payments for Plus, Pro, and Max tiers on web (skept.co).
**Mobile billing:** RevenueCat (separate — Phase 2, mobile IAP abstraction for iOS/Android).
**Publishable key:** Client-side only — used at Phase 2 when wiring Stripe Elements / Checkout into the frontend. Not in MCP config.
**Secret key:** Test mode (`sk_test_...`) active locally. Swap for live key (`sk_live_...`) at launch.
**Schema hooks:** `subscription_source`, `subscription_ref`, `tier`, `tier_expires_at` fields in `skept-auth` D1 `users` table are already designed to receive Stripe webhook data.

---

## Billing Workers (§3.50 step 6 — deployed 29 Jun 2026)

Three billing Workers are live on the Cloudflare production stack:

### skept-stripe-checkout
- File: `cloudflare/stripe-checkout-worker.js`
- Toml: `cloudflare/wrangler-stripe-checkout.toml`
- Endpoints: `POST /api/billing/checkout`, `POST /api/billing/portal`
- Bindings: SKEPT_AUTH_DB (skept-auth)
- Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_IDS (JSON string), JWT_SECRET

### skept-stripe-webhook
- File: `cloudflare/stripe-webhook-worker.js`
- Toml: `cloudflare/wrangler-stripe-webhook.toml`
- Endpoint: `POST /webhook`
- Events handled: checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_succeeded/failed
- Bindings: SKEPT_AUTH_DB (skept-auth), SKEPT_ANALYSIS_DB (skept-analysis)
- Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_IDS

### skept-revenuecat-webhook
- File: `cloudflare/revenuecat-webhook-worker.js`
- Toml: `cloudflare/wrangler-revenuecat-webhook.toml`
- Endpoint: `POST /webhook`
- Events handled: INITIAL_PURCHASE, RENEWAL, NON_SUBSCRIPTION_PURCHASE, CANCELLATION, EXPIRATION
- Signature verification: HMAC-SHA256 via SubtleCrypto, header X-RevenueCat-Webhook-Signature
- Bindings: SKEPT_AUTH_DB (skept-auth), SKEPT_ANALYSIS_DB (skept-analysis)
- Secrets: RC_HMAC_SECRET

### D1 schema state (post-migration)
- `skept-auth / users`: tier CHECK includes 'lite'; stripe_customer_id column present
- `skept-analysis / quota_usage`: quota_limit (default 5), topup_credits (default 0), topup_expires_at added
- `skept-analysis / analysis_history`: tier_at_creation CHECK includes 'lite'

### Tier → quota_limit mapping
free=5, lite=10, plus=20, pro=40, max=60

### RevenueCat entitlement identifiers (note: contain spaces)
'Skept Lite' → 'lite', 'Skept Plus' → 'plus', 'Skept Pro' → 'pro', 'Skept Max' → 'max'

### Secret rotation policy
All billing secrets must be rotated if exposed. Reprovision via:
  npx wrangler@latest secret put <SECRET_NAME> --config cloudflare/<toml-file>
Never hardcode secrets in source files or commit them to the repo.

---

## History Worker

- File: `cloudflare/history-worker.js`
- Toml: `cloudflare/wrangler-history.toml`
- Routes: `GET /api/history/list`, `DELETE /api/history/:id`, `DELETE /api/history/all`
- Bindings: SKEPT_ANALYSIS_DB (D1 skept-analysis), AUTH_SESSIONS (KV)
- Auth: reads `skept_session` cookie or `Authorization: Bearer` header; validates against AUTH_SESSIONS KV
- Deploy: `cd cloudflare && npx wrangler@latest deploy --config wrangler-history.toml`

---

## iOS Mobile Build

**Status:** Not started — pending Mac acquisition (current critical path blocker).

**Architecture:** React Native app (thin client) + native iOS Share Extension (Swift, separate Xcode build target). The app calls existing Cloudflare Workers — no new backend work required for Phase 1.

**Components:**
- React Native app shell — verify, history, settings, account screens
- Native iOS Share Extension (Swift) — primary entry point; separate Xcode target with its own bundle ID, entitlements, and provisioning profile; shares data with main app via App Group
- Universal Links — routes skept.co magic link taps into the app (not a browser); requires Associated Domains entitlement + `apple-app-site-association` file on skept.co
- SecureStore for session tokens (keychain-backed — not AsyncStorage)
- RevenueCat IAP → subscription status flows back via webhook → Worker → `users.tier`

**Cloudflare Workers the app talks to (all already live):**
- Auth: skept-auth.c-doust85.workers.dev
- Verify: verify Worker
- History: history Worker
- Settings: skept-settings.c-doust85.workers.dev

**Tier enforcement:** single codebase, no per-tier app variants. `tier-config.js` gates all responses server-side. UI renders conditionally based on API response.

**Beta cohort:** up to ~20 testers via manual D1 inserts on `tier='free'` in skept-auth. No billing required for TestFlight.

**Prerequisites before starting:**
- Mac (MacBook Air M3 16GB recommended)
- Apple Developer account ($99/yr)
- Xcode installed and configured
- RevenueCat products and entitlements created (pending §3.50 Step 6)

**Do not build the Share Extension before Universal Links config is in place** — magic link deep-link must work before share-sheet auth can be tested end-to-end.

---

## Stage 6 billing Workers

Three Workers deployed separately. Deploy commands:

```bash
npx wrangler@latest deploy --config cloudflare/wrangler-stripe-checkout.toml
npx wrangler@latest deploy --config cloudflare/wrangler-stripe-webhook.toml
npx wrangler@latest deploy --config cloudflare/wrangler-revenuecat.toml
```

Migration (run once):
```bash
npx wrangler@latest d1 migrations apply skept-auth --remote
```

**Secrets to provision after deploy — do not commit values:**

`skept-stripe-checkout`:
- `STRIPE_SECRET_KEY` — Stripe secret key (test: `sk_test_...`, live: `sk_live_...`)
- `STRIPE_PRICE_IDS` — JSON string mapping tier+period to Stripe price IDs, e.g. `{"plus_monthly":"price_xxx","plus_annual":"price_xxx","pro_monthly":"price_xxx","pro_annual":"price_xxx","max_monthly":"price_xxx","max_annual":"price_xxx"}`
- `ALLOWED_ORIGIN` — e.g. `https://skept.co`

`skept-stripe-webhook`:
- `STRIPE_WEBHOOK_SECRET` — signing secret from Stripe dashboard → Webhooks
- `STRIPE_SECRET_KEY` — Stripe secret key

`skept-revenuecat-webhook`:
- `REVENUECAT_WEBHOOK_SECRET` — shared secret from RevenueCat dashboard → Integrations → Webhooks
- `REVENUECAT_PRODUCT_TIERS` — JSON string mapping RC product IDs to tier names, e.g. `{"skept_plus_monthly":"plus","skept_plus_annual":"plus","skept_pro_monthly":"pro","skept_pro_annual":"pro","skept_max_monthly":"max","skept_max_annual":"max"}`

**Stripe subscription metadata requirement:** Stripe subscriptions must have `metadata.tier` set to `plus`/`pro`/`max` for webhook handlers to resolve the correct tier. Set this in the Stripe dashboard or via the checkout session `subscription_data[metadata][tier]` param (already wired in stripe-checkout-worker.js).

---

## Working principles

- Edit `main.py` for all pipeline and UI changes.
- One Resemble API call per job. Never add a second.
- `score=None` excludes from fusion. Never substitute 0.5 for None.
- Absence of signal is not evidence of authenticity.
- Read CLAUDE.md before every session. Do not rely on session memory for architecture facts.
