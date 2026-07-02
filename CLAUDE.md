# Skept Prototype — Developer Reference
**Last updated: 02 Jul 2026 (session 8)**

Skept is an AI-content detection and video verification platform for short-form social media. This file is the canonical session-start reference for Claude Code. Load it at the start of every session.

---

## Repo location

Local path: C:\Users\charl\OneDrive\Documents\App Development\Skept\Deployment-Skept\Github Repo\Skept-prototype

---

## Architecture overview

Production stack is Cloudflare-native — Pages (frontend), Workers (API/routing), D1 (user records, analysis history), R2 (clip storage), KV (sessions, auth tokens). Railway (`skept-prototype-production.up.railway.app`) is confirmed permanent (§3.84). **The ingest/analysis split is now built and confirmed working end-to-end (§3.94, session 8, 02 Jul 2026).** Railway now exposes a dedicated `POST /api/ingest` endpoint (download via existing yt-dlp/cookie logic, upload to R2, no Resemble/Replicate calls) alongside its pre-existing full-analysis routes, which remain untouched. The Cloudflare Worker (`skept-verify`) reads the resulting R2 object and submits it to Resemble via multipart upload. First real clip processed end-to-end 02 Jul 2026 — see §3.90.

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

**Asymmetric exclusion — non-human content (§3.91, commit 66d6b43, 30 Jun 2026):**
When Resemble's Intelligence liveness signal indicates `not_real_person`, the deepfake pillar is excluded from both numerator and denominator: `videoSuspicion = null`, `deepfakeExcludedReason = 'non_human_content'`. Parallel in structure to `audio_dubbing_pattern`. `fusion.js` propagates this reason into the pillar detail (`detail.deepfake.excluded_reason`) and pushes it to `exclusionReasons` via the null-score pillar loop (lines 40–49 of `fusion.js`). The low-frame-count guard (`resembleFrameCount <= 1`) is retained alongside the liveness check — both branches now set `deepfakeExcludedReason = 'non_human_content'`. **Guard confirmed live, exclusion branch still unconfirmed (session 8, 02 Jul 2026).** The first real `/api/verify` call went through this code path without misfiring — a normal clip with a real, identifiable face correctly went unexcluded. That confirms the guard doesn't false-positive, but the `isNotRealPerson` branch itself has still never actually fired — the test clip had nothing for it to catch. The liveness field path (`item.intelligence`) remains unconfirmed in the sense that matters: no one has yet observed what a genuinely non-human/synthetic clip's Intelligence response looks like off `wrangler tail`. The TODO and one-shot `console.log` should stay in place until a cartoon-cat-style clip is specifically re-run.

**Verdict bands (5-band — source of record: `backend/analysers/fusion.py`, confirmed §3.89, 30 Jun 2026):**
- Authentic:    0.00 – <0.20
- Clean:        0.20 – <0.50   (label: "Ambiguous")
- Inconclusive: exactly 0.50
- Suspicious:   0.51 – <0.80
- Manipulated:  0.80 – 1.00

Note: CLAUDE.md previously showed 3 bands (0.30 / 0.60). That was wrong — `fusion.py` uses the 5-band thresholds above. `cloudflare/fusion.js` reconciled to match (§3.89, commit cd5df37). Do not revert to 3-band values.

**Pillar score semantics:**
- `score > 0.5` = suspicious (earned)
- `score = 0.5` = neutral (absence of signal, not authentic)
- `score < 0.5` = authentic-leaning (earned — positive authenticity evidence found)
- `score = None` = excluded from fusion entirely

---

## Resemble AI integration

- Endpoint: `https://app.resemble.ai/api/v2/detect` (confirmed §3.90, 30 Jun 2026 — `deepfake.py` is the canonical source; Worker was previously using wrong subdomain/path `https://api.resemble.ai/v2/detect`)
  - **Submission method resolved (commit `cc1b337`, session 6):** `callResemble()` has been rewritten to read the clip from R2 (`bucket.get(r2Key)`) and multipart-upload it directly to Resemble, matching `deepfake.py` exactly. The old URL-based JSON body (`{ url: clipUrl, ... }`) is gone. Do not revert this change.
  - **Resolved (session 8, 02 Jul 2026).** The assumed `skept-ingest` Railway service never existed and was abandoned as an approach. Instead, Railway's existing `Skept-prototype` service gained a new `POST /api/ingest` endpoint (§3.94) that does the R2 write; `INGEST_WORKER_URL` now points at `https://skept-prototype-production.up.railway.app` instead of the dead `skept-ingest` URL. `callResemble()`'s multipart-from-R2 logic needed no changes — it was already correct, it just had nothing to read until this endpoint existed. First real clip confirmed processed end-to-end 02 Jul 2026.
- Worker Resemble request body includes `intelligence: true` — required to return the Intelligence/liveness layer used by the §3.91 non-human gate.
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
- Analysis segment duration: 5 seconds per segment. Segment count by tier: Free/Lite = 1 segment (5s), Plus/Pro = 2 segments (10s), Max = 3 segments (15s). Worker references tier → segment count only; duration is a constant.
- Temp file cleanup runs post-processing on Railway.
- URL validation (scheme=http/https, non-empty netloc) must occur at `/api/analyse` before yt-dlp dispatch. Returns 400 on failure.

**Ingest endpoint (§3.94, built session 8, 02 Jul 2026):** Railway's `Skept-prototype` service now exposes `POST /api/ingest` alongside its pre-existing full-analysis routes (which are untouched — Replicate/faceswap calling location was explicitly out of scope for this build). New endpoint: `{ url, job_id } → download via existing yt-dlp/cookie logic → upload to R2 → { key }`. Auth: `Authorization: Bearer <INGEST_SECRET>` header, fail-closed if unset. Confirmed working via a real Instagram reel download, upload, and Cloudflare Worker read-back. Railway's long-term target role (§3.84) is still ingestion-only — the full-analysis routes staying live alongside the new endpoint is an interim state, not the end state.

**Wikidata subject list:**
Lazy-loaded on first job, not at startup. Prevents cold-start timeout and double-emit.

---

## UI rendering rules

- Pillar active count = pillars with `score != None AND no excluded_reason`. When `audio_dubbing_pattern` fires, deepfake is excluded — count must reflect this (1/2, not 2/2).
- `audio_dubbing_pattern` DOM label (`ref_53`) is a pure client-side conditional: `const _dfExcluded = analysers.deepfake && analysers.deepfake.excluded_reason === 'audio_dubbing_pattern'` — the `<p id="dubbingNote">` element is only injected into `dubbingNoteContainer` when this condition is true. Not server-side generated.
- Audio state copy: "Audio & voice clone — no speech detected" vs "Audio & voice clone — excluded" are distinct states and must use distinct copy.
- Confidence meter: no zone-divider tick marks on track. Zone labels (`AUTHENTIC / INCONCLUSIVE / SUSPICIOUS`) are the only threshold indicators.

---

## Open checklist items (as of 02 Jul 2026)

**Current baselines:** Project Brief v0.25 (30 Jun 2026) · Engineers Brief v0.22 (30 Jun 2026)

| Item | Description |
|---|---|
| §3.70 | Audio `max(raw, 0.0)` formula structurally floors near 0% on clean audio (Resemble clusters near 0.0, not -1.0) — monitoring only, no action pending until more live data |
| §3.76 | Logo SVG colour fix: code fix applied and committed (76e50b2) to all six surfaces — index.html, history.html, verify.html, settings.html, skept-base-template.html, verdict-worker.js. Visually confirmed on history.html. Verdict Worker live deploy + visual confirmation pending. |
| §3.77 | Segment duration 4s → 5s implemented (commit e4703ad, 30 Jun 2026). deepfake.py: `-t 5`, threshold `> 10`, strategy `start_mid_5s`. verify-worker.js: `SEGMENT_DEFS.duration: 5`, run_depth `5s/10s/15s`. main.py UI label updated to `10s of`. Note: verify-worker.js previously had `duration: 6` (not 4) — also corrected to 5. |
| §3.78 | Founder cohort Stripe coupon (tier-variable, Plus/Pro/Max, Plus floor) decided 29 Jun 2026 — NOT implemented. Stripe dashboard coupon config still pending |
| §3.79 | Usage-triggered subject list growth — `subject_candidates` D1 table + NER pipeline hook not yet built. Review surface (admin dashboard, see below) is now live and unblocked |
| §3.81 | Per-frame timestamp/score/certainty capture (admin-only, internal calibration) — storage approach not decided, not yet built |
| §3.82 | Resemble `metrics.consistency` unused — Phase 2 evidence card candidate, no action pending |
| §3.83 | LLM-generated verdict summary (Pro/Max tiers) — Phase 2 candidate, no action pending |
| §3.84 | Railway confirmed PERMANENT (30 Jun 2026), target role locked: thin yt-dlp ingestion + R2 upload utility, $5/month, NOT being decommissioned. **NOT YET BUILT** — Railway currently still runs full analysis (yt-dlp + Resemble + Replicate) directly; no R2 write path exists. §3.94 is the concrete build plan. Future option (flagged, not started): Cloudflare Containers (full Docker images via wrangler, with R2/binding access) could eventually eliminate Railway entirely — not scoped, not in progress. |
| §3.85 | Magic link email rebrand (CREAM/INK/AMBER tokens) — HTML template not yet built; live email still uses Resend's default dark template |
| §3.88 | Founder + Admin privilege matrix — role column live in D1, specific privileges (admin quota bypass, founder perks) not yet specced or built |
| §3.89 | **CLOSED 02 Jul 2026.** Runtime-verified via a real `/api/verify` call — audio passthrough, certainty scalar, 5s segments, and tier quotas all confirmed correct against a live Resemble response, independently checked via direct D1 query. |
| §3.90 | **CLOSED 02 Jul 2026 — the gating milestone.** First clip ever processed end-to-end through the Cloudflare-native pipeline: real Instagram reel → Railway ingest → R2 → Worker read → Resemble → verdict persisted to `analysis_history` with valid `verdict_state`/`run_depth`. Confirmed via direct D1 query, not just the API response. |
| §3.91 | **Code deployed and confirmed live, exclusion path still unexercised.** The 02 Jul live run didn't misfire (normal clip, correctly unexcluded) but never triggered the `isNotRealPerson` branch either — the liveness field path is still unconfirmed for an actual synthetic/non-human clip. Re-run the cartoon-cat reference clip specifically to close this. Still pair with §3.20 (Sightengine synthetic gap). |
| §3.92 | **CLOSED 02 Jul 2026.** Both `RESEMBLE_API_KEY` and `INGEST_SECRET` provisioned on `skept-verify` via `wrangler secret put`, run in a plain terminal outside any AI session. Confirmed functional via a successful live call. |
| §3.93 | **CLOSED 02 Jul 2026.** `skept-clips` bucket created via Cloudflare MCP. `CLIP_BUCKET` binding confirmed working — Worker successfully read an uploaded object during the first live run. R2 S3 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`) provisioned as Railway env vars — needed after all, since Railway isn't a Workers runtime and has no native R2 binding; the ingest endpoint (§3.94) uses boto3 against R2's S3-compatible API. |
| §3.94 | **CLOSED 02 Jul 2026 — Stage 1 built, deployed, and confirmed working.** New `POST /api/ingest` endpoint added to Railway's `Skept-prototype` service (download via existing yt-dlp logic, upload to R2, `INGEST_SECRET` bearer auth). `callResemble()` needed no changes — already correct, just had nothing to read until now. `callIngest()` on the Worker side also needed no changes — its existing contract matched the new endpoint's shape exactly. Only Worker-side fix needed: `INGEST_WORKER_URL` updated from the dead `skept-ingest` URL to the real Railway prototype URL. |
| §3.95 | **NEW, CLOSED 02 Jul 2026.** First real `/api/verify` call returned a bare `405 Method Not Allowed` — the route pattern `skept.co/api/verify/*` (trailing wildcard) didn't match the Worker's own internal exact-path check (`url.pathname !== "/api/verify"`), so requests fell through to Cloudflare's static-asset handling instead of reaching the Worker. This affected every real user submission through the live product, not just this session's tests. Fixed by removing the wildcard — route is now `skept.co/api/verify`, exact match only. |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `RESEMBLE_API_KEY` | Resemble AI DETECT-3B Omni (Worker secret on `skept-verify` — value sourced from Railway's `RESEMBLE_API_TOKEN` env var, same value, different name). Provisioned and confirmed working 02 Jul 2026. |
| `INGEST_SECRET` | Shared secret authenticating the Cloudflare Worker against Railway's `/api/ingest` endpoint (§3.94). Set as a Worker secret on `skept-verify` AND a Railway env var on `Skept-prototype` — must match on both sides. Provisioned and confirmed working 02 Jul 2026. |
| `R2_ACCOUNT_ID` | Railway env var (on `Skept-prototype`) — Cloudflare account ID, used to construct the R2 S3-compatible endpoint URL for the ingest endpoint's boto3 client. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Railway env vars (on `Skept-prototype`) — R2 API token credentials (Object Read & Write, scoped to `skept-clips`), used by the ingest endpoint to upload via boto3. Not needed Worker-side — the Worker uses a native R2 binding (`CLIP_BUCKET`) instead. |
| `RAILWAY_*` | Set by Railway automatically |

---

## Deploy

**Cloudflare Pages (production):** Push to `main` → auto-deploy. No manual deploy needed for frontend changes.
**Railway:** Confirmed permanent (30 Jun 2026, §3.84), $5/month Hobby plan, NOT being decommissioned. **Target role:** thin yt-dlp ingestion + R2 upload endpoint only. **Current actual state (02 Jul 2026):** the `POST /api/ingest` endpoint now exists and is confirmed working (§3.94) alongside the pre-existing full-analysis routes, which remain live and untouched. The ingestion-only end state is not yet reached — that's a separate future step (§3.84), not started. Push to `main` → auto-deploy. Monitor via Railway dashboard logs.
**Production stack:** Cloudflare Pages + Workers + D1 + R2 + KV — LIVE (see Current build state below). Railway remains permanently alongside it as the yt-dlp utility pipe; it is not a migration target.

---

## Current build state (as of 30 Jun 2026)

| Component | Status |
|---|---|
| Auth flow | LIVE — magic link, cookie session, `/api/auth/me`, `/api/auth/logout` |
| History page (`history.html`) | LIVE at skept.co/history — cream shell, quota strip, filter chips, card list, delete flow |
| History Worker | LIVE at skept.co/api/history/* |
| Billing Workers (Stripe + RevenueCat) | LIVE — `skept-stripe-checkout`, `skept-stripe-webhook`, `skept-revenuecat-webhook` |
| Verify Worker | LIVE and confirmed working end-to-end at **skept.co/api/verify** (route corrected 02 Jul 2026, §3.95 — no longer a wildcard, was previously misconfigured as `/api/verify/*` which caused every real call to 405). Scoring reconciled to backend (§3.89, runtime-verified); D1 CHECK constraints fixed, permalink_uuid wired, Resemble URL corrected (§3.90, closed); `callResemble()` reads from R2 via multipart (commit `cc1b337`); §3.91 liveness gate (`non_human_content`) deployed and confirmed not to misfire, exclusion branch itself still unexercised. First real clip processed end-to-end 02 Jul 2026 — verdict persisted and independently confirmed via D1 query. |
| Settings Worker | LIVE at skept.co/api/settings/* |
| verify.html | LIVE — intake, analysing, and verdict views wired to /api/verify/* |
| settings.html | Scaffold only — not yet built |
| Verdict Worker (`skept-verdict`) | LIVE at skept.co/v/* — server-rendered verdict page, four states, 404 state |
| Base template | `cloudflare/templates/skept-base-template.html` — canonical nav + footer shell, both auth states, account dropdown. All new pages derive from this file. |
| Nav/footer standardisation | Claude Code prompt issued — pending execution. Applies canonical nav/footer to index.html, verify.html, history.html, settings.html, verdict-worker.js in one commit. Closes §3.76. |
| Admin dashboard (`skept-admin`) | LIVE at skept.co/admin — Overview, Job log, Signals, Cost, Users (tier-filtered), Founder cohort views. Gated by static ADMIN_TOKEN, not by the new `role='admin'` field — these two gating mechanisms are not yet unified (§3.88) |

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
- skept-verify → skept.co/api/verify (exact path only — no trailing wildcard, fixed §3.95, 02 Jul 2026; a wildcard here previously caused every real call to fall through to static-asset handling and 405)
- skept-history → skept.co/api/history/*
- skept-verdict → skept.co/v/* → cloudflare/verdict-worker.js → wrangler-verdict.toml (route registered manually in Cloudflare dashboard)
- skept-admin → skept.co/admin* (frontend page) + skept.co/api/admin/* (Worker API) — ADMIN_TOKEN secret, sessionStorage token-gate, NOT tier-gated, NOT yet tied to role='admin'

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
npx wrangler@latest deploy --config cloudflare/wrangler-admin.toml
```

---

## Secrets

All secrets provisioned via: `npx wrangler@latest secret put <SECRET_NAME> --config <toml file>`

- skept-auth secrets: ENCRYPTION_KEY (32-byte base64), IP_SALT, RESEND_API_KEY
- skept-settings secrets: ENCRYPTION_KEY (must match skept-auth), IP_SALT
- skept-stripe-checkout secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_IDS, JWT_SECRET
- skept-stripe-webhook secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_IDS
- skept-revenuecat-webhook secrets: RC_HMAC_SECRET
- skept-verify secrets: RESEMBLE_API_KEY, INGEST_SECRET — **NOT YET PROVISIONED as of 30 Jun session 6** (`wrangler secret list` returns `[]`). Both required before any live `/api/verify` call (§3.92). INGEST_SECRET must match the shared secret used by the new Railway ingest-only endpoint (§3.94 — not yet built; `ingestion-worker.js` was never a running service, do not reference it). RESEMBLE_API_KEY value should be sourced from Railway's existing `RESEMBLE_API_TOKEN` env var — same value, different name.

---

## Auth flow

Magic link passwordless auth. Sign-in page at skept.co sets skept_session httpOnly cookie on skept.co domain after token exchange. All API calls use credentials: 'include'. Token endpoint: POST /api/auth/request. Verify endpoint: POST /api/auth/verify. Session check: GET /api/auth/me. Logout: POST /api/auth/logout.

---

## Frontend structure

```
frontend/
  index.html          — sign-in (LIVE — magic link)
  verify.html         — authenticated verify page; three view states (intake → analysing → verdict); wired to /api/verify/*
  history.html        — analysis history (LIVE — cream shell, quota strip, filter chips, card list, delete flow)
  settings.html       — account settings (scaffold only — not yet built)
  public/_redirects   — MPA routing for Cloudflare Pages
  src/
    api.js            — shared fetch wrapper (all fetch calls, credentials: include, relative /api/* paths)
    auth.js           — shared auth guard (checkAuth, logout)
    verify.js         — verify page logic (auth guard, startAnalysis, poll loop, verdict render)
    history.js        — history page logic (all history page JS)
    pages/
      signin.js
      verify.js
      settings.js

cloudflare/
  templates/
    skept-base-template.html  — canonical nav/footer shell; copy for new pages; set data-auth="true|false" on <body>
  admin-worker.js       — admin dashboard Worker (skept.co/admin + skept.co/api/admin/*)
  wrangler-admin.toml   — bindings: SKEPT_AUTH_DB, SKEPT_ANALYSIS_DB, AUTH_SESSIONS KV
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

**Base template:** `cloudflare/templates/skept-base-template.html` — canonical nav/footer shell. Copy for each new page; do not edit the template directly.

**Nav link order (auth):** How it works · Check a video · History · Account ▾
**Nav link order (unauth):** How it works · Sign in

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
- `skept-auth / users`: is_admin INTEGER NOT NULL DEFAULT 0 added (29 Jun 2026)
- `skept-auth / users`: `role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'founder', 'admin'))` added via migration `0003_add_role_to_users.sql` (commit 605515a); `idx_users_role` index created. `is_admin` column now superseded by `role` — not yet dropped, do not write new code against `is_admin`.
- `skept-analysis / quota_usage`: quota_limit (default 5), topup_credits (default 0), topup_expires_at added
- `skept-analysis / analysis_history`: tier_at_creation CHECK includes 'lite'

### Tier → quota_limit mapping
free=5, lite=10, plus=20, pro=40, max=60

**Feature gates:** Seal generation and permalink access require Pro or above (moved from Plus, 30 Jun 2026, §3.86). Do not gate these at Plus.

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

- Frontend changes: edit files in `frontend/` and push to main — Pages auto-deploys.
- Worker changes: edit in `cloudflare/` and deploy with the relevant `wrangler` command.
- One Resemble API call per job. Never add a second.
- `score=None` excludes from fusion. Never substitute 0.5 for None.
- Absence of signal is not evidence of authenticity.
- Read CLAUDE.md before every session. Do not rely on session memory for architecture facts.
- Never handle secret values directly — `wrangler secret put` is interactive and must be run by the human in a plain terminal, not through Claude Code.
