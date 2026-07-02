# v0.19 Consolidation Checklist

Living document tracking what's been decided, what's pending, and what needs folding into project documents at their next revisions. Update as decisions land. Filename tracks the current project brief baseline; will be renamed at each baseline bump.

**Current baselines:**
- Project Brief — **v0.25** (30 Jun 2026)
- Legal Brief — **v0.10** (23 Jun 2026)
- Engineers Brief — **v0.22** (30 Jun 2026)
- Trademark Clearance Brief — **v0.3** (19 May 2026, AU filing outcome documented)
- Advisor Script — **v1.4** (30 Apr 2026, acquisition phasing corrected)

**Targets:** Trademark Clearance Brief v0.4 (US/EU/UK filing outcomes; entity assignment once incorporated; Class 41 skip confirmed; any phrase mark filing decision). No active PB/EB targets queued.

---

## 1. Companion notes and their status

| **Document** | **Status** | **Notes** |
| --- | --- | --- |
| platform-seal-interactivity-decision.md | 🔵 Archived — historical record | Three-layer strategy reference. Folded into project brief §16.9. Retained as historical deliberation record only — not an active reference. |
| origin-reverification-feature.md | 🟢 Live reference | Origin re-verification feature spec. Folded into project brief v0.14 and engineers brief v0.6. Retained as extended spec record. |
| skept-mark-rendering-revised.html | 🟢 Live specimen | Visual identity concept — referenced from project brief §12.7. |
| skept-trust-seal-ux.html | 🟢 Live specimen — v0.2 | Seal in context — referenced from project brief §16.9. Idle-pulse animation + `prefers-reduced-motion` fallback. |
| skept-public-verdict-page.html | 🟢 Live specimen | Verdict page anatomy — referenced from project brief §16.10. |
| skept-how-it-works.html | 🟢 Live specimen | Public explainer page — referenced from project brief §16.10. |
| skept-analysis-history-ui.html | 🟢 Live specimen | History UI — referenced from project brief §9. |
| skept-base-template.html | 🟢 Live template | Canonical nav + footer shell. All pages derive from this file. Committed to `cloudflare/templates/skept-base-template.html`. Never modify directly — copy-then-edit. |
| skept-account-settings.html | 🟡 New specimen (30 Apr) | Account settings screen prototype. Six sections: Profile, Security, Notifications, Subscription, Theme, Privacy & data. Spec in engineers_brief §4.11. |
| skept-landing.html | 🟡 New specimen (29 Apr) | Coming-soon landing page with waitlist form. Not yet deployed as production entry point. |
| skept-verify-flow.html | 🟡 New specimen (29 Apr) | Free-tier verify flow prototype. |
| skept-verify-flow-pro.html | 🟡 New specimen (29 Apr) | Pro signed-in verify flow prototype. |
| skept-signin-flow.html | 🟡 New specimen (29 Apr, v0.3) | Passwordless magic link sign-in flow. Phase 2 SSO badges on Apple/Google buttons. |
| waitlist-worker.js | 🟡 New (29 Apr) | Cloudflare Worker for waitlist email capture. Ready to deploy. |
| wrangler.toml | 🟡 New (29 Apr) | Wrangler config for waitlist worker. KV namespace IDs are placeholders. |
| CLOUDFLARE_WORKER.md | 🟡 New (29 Apr, renamed) | Setup and deploy walkthrough for waitlist worker. |

All retired companion notes from v0.4–v0.6 cycles remain retired.

---

## 2. Closed items — reference table

Items fully closed and filed in their respective briefs. Detail is in the brief version history.

| **Item** | **Closed** | **Brief sections** |
| --- | --- | --- |
| §3.1 Trademark Clearance Brief revision | 30 Apr 2026 | Clearance Brief v0.2; Legal Brief v0.4; PB §12.4 |
| §3.2 Domain acquisition sequencing | 30 Apr 2026 | PB §12.4 |
| §3.3 Cloudflare stack | 30 Apr 2026 | PB §11.4, §14; EB §4.2, §13 |
| §3.4 Verify flow specimens | 30 Apr 2026 | PB §16.10, §9.7; EB §4.6 |
| §3.5 Product verb ("Skept it") | 30 Apr 2026 | PB §12.7.4; Clearance Brief §7 |
| §3.6 Bluesky + Discord platforms | 30 Apr 2026 | PB §1, §3.1, §4.7; EB §1, §2.1, §3.7, §4.3 |
| §3.7 Account settings surface | 30 Apr 2026 | PB §9.8, §15; EB §4.6, §4.11, §13; LB §8 |
| §3.8 Magic link auth spec | 30 Apr 2026 | EB §4.9 |
| §3.9 Subscription infrastructure | 30 Apr 2026 | PB §11.5, §14; EB §4.10, §13 |
| §3.10 Bot/CIB detection | 30 Apr 2026 | PB §2, §4.7; EB §3.7 |
| §3.11 Origin re-verification | 01 May 2026 | PB §4.5, §7.4, §9.4, §11.5, §14, §16.4; EB §3.5, §4.5a |
| §3.12 Acronym appendix | 04 May 2026 | PB Appendix A; EB Appendix A |
| §3.13 Trust seal idle-pulse animation | 04 May 2026 | PB §16.9.1 |
| §3.14 Watermarking scope update | 04 Jun 2026 | PB §16.3, §16.5 |
| §3.15 Certification mark legal framing | 04 Jun 2026 | PB §16.6.1; LB v0.8 (2 new attorney Qs) |
| §3.16 Journalist → Max rename + pricing | 04 Jun 2026 | PB §11.5; EB §4.10 |
| §3.17 Fusion weights + verdict bands | 04 Jun 2026 | EB §4.4, §13 |
| §3.18 Replicate deepfake live + calibration gaps | 06 Jun 2026 | EB v0.12: §3.2, §3.3, §4.4, §13 |
| §3.19 Bug batch — Bugs 1–6 | 15 Jun 2026 | All six resolved — EB v0.13 |
| §3.20 Synthetic generation detector | 27 Jun 2026 | EB §3.8 (fully documented — Sightengine selected, weight 0.25, deferral rationale); implementation is a dev task not a doc gap |
| §3.22 Three new live-run bugs | 15 Jun 2026 | EB v0.13 |
| §3.23 Two carry-forward items (C2PA + frame scalar) | 17 Jun 2026 | EB v0.13 |
| §3.24 Non-human content guard | 27 Jun 2026 | EB §3.1 (guard active and documented — content_type: non_human, evidence card copy spec confirmed in code) |
| §3.25 Per-frame latency anomaly | 27 Jun 2026 | Obsolete — was Replicate/scamai specific; Resemble replaced Replicate at v0.17. Re-test against reference clip if latency resurfaces on Resemble. |
| §3.26 Faceswap false negative (gender-swap) | 27 Jun 2026 | EB §3.1 (reference clip retained, coverage gap documented); EB §8.1.2 (labelled training data); PB §4.2 (coverage limitation). Re-run reference clip against Resemble at next calibration session. |
| §3.28 Audio/fusion logging gap | 19 Jun 2026 | CLAUDE.md |
| §3.29 Subject identity logging gap | 19 Jun 2026 | CLAUDE.md |
| §3.30 Authenticity verification principle | 27 Jun 2026 | EB §4.4 (four-state model, per-pillar criteria — fully documented); PB §2 (core detection principle). Code implementation is a dev task tracked in CLAUDE.md, not a doc gap. |
| §3.31 Trump QID hardcode + wordninja | 27 Jun 2026 | Confirmed via Extension |
| §3.32 Audio `resemble_raw=n/a` log artefact | 22 Jun 2026 | — |
| §3.33 Resemble video + fusion restructure | 22 Jun 2026 | EB v0.17 |
| §3.34 deepfake `video_metrics.score` parse fix | 22 Jun 2026 | — |
| §3.35 Non-human guard + traversal fix | 22 Jun 2026 | — |
| §3.36 Resemble `consistency` + `certainty` | 22 Jun 2026 | EB v0.18 |
| §3.37 Asymmetric exclusion (`audio_dubbing_pattern`) | 22 Jun 2026 | EB v0.17 |
| §3.38 Deepfake contribution zeroed on exclusion | 22 Jun 2026 | — |
| §3.39 Frame count display inverted | 23 Jun 2026 | — |
| §3.40 Asymmetric exclusion not surfaced in UI | 23 Jun 2026 | EB v0.18 §4.6 |
| §3.41 Clip duration cap at 15s before Resemble | 22 Jun 2026 | EB v0.18 §3.1, §4.6 |
| §3.42 Video-job audio score not consumed | 23 Jun 2026 | EB v0.19 §3.2, §4.4 |
| §3.43 Pillar active count fusion-only | 23 Jun 2026 | — |
| §3.44 Audio card body stale post-§3.42 swap | 24 Jun 2026 | — |
| §3.45 Audio pillar anchors at 0.50 on no-speech | 26 Jun 2026 | — |
| §3.46 Session expired banner on completed verdict | 24 Jun 2026 | — |
| §3.47 Chrome Extension: DOM audit workflow | 24 Jun 2026 | — |
| §3.48 Resemble C2PA result not consumed | 25 Jun 2026 | EB §4.5 → v0.20 |
| §3.49 "Analysis session expired" false-positive | 25 Jun 2026 | — |
| §3.51 `audio_dubbing_pattern` exclusion not functional | 24 Jun 2026 | EB §4.4 → v0.20 |
| §3.52 Fusion input score unlogged intermediate | 24 Jun 2026 | — |
| §3.53 Audio card body stale `final_score` | 24 Jun 2026 | — |
| §3.54 File upload no progress state | 25 Jun 2026 | — |
| §3.55 Duplicate Resemble submissions | 24 Jun 2026 | — |
| §3.56 Pillar active count includes excluded pillars | 26 Jun 2026 | — |
| §3.57 Standalone audio.wav call replaced by video_job_omni | 24 Jun 2026 | EB §4.4, §5 → v0.20 |
| §3.58 Stale dubbing-pattern DOM label | 26 Jun 2026 | — |
| §3.59 Audio card copy on no-audio-stream clips | 27 Jun 2026 | — |
| §3.60 Audio pillar row in wrong stage block | 26 Jun 2026 | — |
| §3.61 Resemble C2PA not consumed; stub shows "skipped" | 25 Jun 2026 | EB §4.5 → v0.20 |
| §3.62 Audio score divergence from Resemble dashboard | 26 Jun 2026 | — |
| §3.63 High-variance flag not in evidence card | 27 Jun 2026 | EB §3.1 (high_variance flag and evidence card note confirmed in code and brief) |
| §3.64 Wikidata startup timeout | 25 Jun 2026 | — |
| §3.65 502 banner obscures completed verdict | 25 Jun 2026 | — |
| §3.66 URL validation before yt-dlp | 26 Jun 2026 | — |
| §3.67 Confidence meter zone-divider markers | 25 Jun 2026 | — |
| §3.68 Stripe account live; MCP plugin installed | 26 Jun 2026 | — |
| §3.70 Audio `max(raw, 0.0)` calibration monitoring | 27 Jun 2026 | Note already present in EB §3.3 (confirmed via direct inspection 30 Jun 2026 — calibration note text matches verbatim, evidently folded in during the v0.21 build itself). Row was carried as pending in error; no action was actually outstanding. |
| §3.71 Audio `(raw+1)/2` → `max(raw, 0.0)` rebuild | 26 Jun 2026 | EB §3.3 → v0.21 |
| §3.72 `video_job_audio_label` not forwarded | 27 Jun 2026 | — |
| §3.69 Certainty scalar suppression — evidence card note | 27 Jun 2026 | EB v0.21 §4.6 (note spec); PB v0.24 §4 (note). Three-round diagnostic; root cause: note inside excluded gate. Deployment `63384a23`. |
| §3.73 Evidence card summary false negative on suppressed scores | 27 Jun 2026 | EB v0.21 §4.6 (summary copy spec). Bundled with §3.69. Deployment `63384a23`. |
| §3.74 Video suspicion score reads wrong field | 27 Jun 2026 | UI only — no brief impact. Card was reading `certainty_weighted_score`; fixed to `final_score`. Deployment `22f28beb`. |
| §3.75 Certainty scalar inverted + base score wrong field | 27 Jun 2026 | EB v0.21 §3.2. Two-stage fix: scalar formula corrected (`min(skept_frames, resemble_frame_count) / skept_frames`, deploy `15be7c1c`); base score switched from per-frame mean to `video_metrics.score` (deploy `5924057a`). Result: `certainty=1.0000, final_score=0.6010` → 60% Likely Manipulated on Biden/alien Reel. |
| §3.62 Audio score normalisation disclosure | 27 Jun 2026 (confirmed stale) | Fixed in commit `49c0fd6` (26 Jun); verified in batch session same day. Checklist carried as open in error. No action required. |
| §3.21 + §3.27 Subject identity — EB spec section | 29 Jun 2026 | EB v0.21 §3.9 (new section: spaCy NER, Wikidata list, wordninja hashtag pre-processing, evidence card copy, Phase 1 limitation, Phase 2 face recognition gate); EB v0.21 §4.4 (Source Details table row added); EB v0.21 §13 (backlog item → confirmed live). |
| §3.50 Cloudflare production stack — steps 6–7 | 29 Jun 2026 | Step 6 complete: Stripe dashboard (4 subscription products, 3 top-up one-time products, webhook registered), RevenueCat (4 entitlements, 11 Test Store products, HMAC webhook), 3 Workers deployed (skept-stripe-checkout, skept-stripe-webhook, skept-revenuecat-webhook), D1 migrations confirmed, all secrets provisioned. Step 7 (landing page swap) deferred to launch day. |
| §3.76 (partial) Verdict page Worker + verify page build | 29 Jun 2026 | skept-verdict Worker deployed; route skept.co/v/* registered; 404 state confirmed. frontend/verify.html fully built — intake (prototype copy + headline), analysing, verdict views wired to /api/verify/*. frontend/src/verify.js created. Logo SVG colour fix remains open (§3.76). |
| §3.86 Seal generation + permalink gate moved from Plus to Pro | 30 Jun 2026 | Seal generation and permalink access removed from Plus tier. Gate is now Pro or above (was Plus or above). PB §11.5, §16.4 → v0.25; EB §4.10 → v0.22; Pricing Summary v2.2 → v2.3 (done — folded in alongside §3.77 update). All fold-ins complete. *(Originally mislabelled §3.77 — renumbered; that number was already assigned to segment duration, below.)* |
| §3.87 Role column added to skept-auth users table | 30 Jun 2026 | `role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'founder', 'admin'))` added via migration `0003_add_role_to_users.sql`, committed 605515a. `idx_users_role` index created. Both existing users (is_admin=1) set to role='admin'. is_admin column now superseded — drop in future migration. EB §4.10 → v0.22 (role field documented alongside tier field, structural scope only — privilege spec deferred to §3.88); D1 schema doc. *(Originally mislabelled §3.78 — renumbered; that number was already assigned to founder cohort coupon, below.)* |

### §3.80 — Admin interface ✅ 30 Jun 2026

- [x] Overview (Dashboard) — six stat cards, verdict distribution, wired to skept-analysis D1
- [x] Job log — paginated with verdict/platform/tier/period filters; detail drawer per job
- [x] Signals — video + audio score distribution, dubbing exclusion and trim counts
- [x] Cost — Resemble API cost estimate, breakdown by tier
- [x] Users — paginated user table, tier badges, quota used/limit columns
- [x] Founder cohort — Max tier proxy list *(queries the now-retired `founder_cohort` boolean — needs updating to `role = 'founder'`, see §3.87)*
- [x] skept-admin Worker live at skept.co/admin* + skept.co/api/admin/*; ADMIN_TOKEN secret provisioned, sessionStorage token-gate
- [x] Add tier sub-items (Free/Lite/Plus/Pro/Max) under Users in sidebar, wired to GET /admin/api/users?tier=
- [x] Add period selector (7d/30d/3m/6m/9m/12m/all) to Overview view, wired to GET /admin/api/overview?period=

Closes out §3.80 (was logged as a priority open item below as of 29 Jun — built same week).

---

## 3. Open items

### 🟡 §3.76 — Logo SVG colour fix

**Root cause found and fixed 30 Jun 2026.** `<symbol id="skept-mark">` uses `fill="currentColor"`; `.nav-logo svg` / `.footer-logo svg` never set their own `color`, so it was inheriting grey from the ancestor link instead of resolving to `var(--ink)`. Fix: `color: var(--ink);` added to both selectors.

Scope corrected from five to six files — `skept-base-template.html` (canonical source) had the same bug and was missed in the original count. Fixed across `skept-base-template.html`, `index.html`, `history.html`, `verify.html`, `settings.html`, `verdict-worker.js`. 12 edits, 6 files, commit `76e50b2`, pushed to `main`.

Visually confirmed on `history.html` (nav + footer + empty-state mark). **Remaining:** `skept-verdict` Worker live deploy + visual confirmation on a real `/v/{uuid}` permalink page — code-level diff applied, runtime unverified.

---

### ✅ §3.89 — Production `skept-verify` Worker scoring reconciled — CLOSED 02 Jul 2026, runtime-verified

**Found 30 Jun 2026** via Cloudflare MCP inspection of the deployed `skept-verify` Worker (last modified 2026-06-28, predates the §3.77 decision and the audio passthrough decision). Triggered by cross-checking production after the prototype Railway log confirmed 5s sampling — production turned out to diverge on far more than segment duration. The deployed verify Worker is an older implementation than the Railway prototype; the prototype is ahead on scoring correctness.

**Divergences from locked decisions (deployed code vs spec/prototype):**

1. **Audio conversion bug (verdict-affecting).** Deployed `rawToSuspicion(raw) = clamp((raw+1)/2, 0, 1)` is applied to the audio score. This is the `(raw+1)/2` transform that was **removed** per the audio passthrough decision (EB v0.21 / memory: `max(aggregated_score, 0.0)` direct passthrough, no transform). Prototype correctly passes through (0.4443 → 0.4443); production would convert 0.4443 → 0.7221. This is the same formula the 30 Jun triage doc flagged as "Issue 1" and we dismissed as not-a-bug — correct for the prototype, but it IS live in production. The dismissal was right about the layer we were looking at, wrong about production.

2. **Video score also run through `(raw+1)/2` (verdict-breaking).** `videoSuspicion = rawToSuspicion(videoScoreRaw)`. Resemble `video_metrics.score` is already [0,1], so this is a wrong transform on the primary pillar. Small distortion at high scores (0.9974 → 0.9987) but flips low scores: an authentic 0.05 becomes 0.525 (authentic → suspicious). Direct contradiction of "authentic must be earned" scoring philosophy.

3. **No certainty scalar.** The `min(skept_frames, resemble_frame_count)/skept_frames` weighting (memory: certainty scalar on `video_metrics.score`) is absent. Video suspicion goes straight to fusion unweighted.

4. **No non-human guard.** The deepfake-pillar exclusion logic present in prototype `deepfake.py` (and the subject of the 30 Jun cartoon-cat finding) is not in the deployed Worker.

5. **Tier quota drift.** Deployed `TIERS`: Pro quota `50` (spec/pricing v2.3 = 40), Max quota `100` (spec/pricing v2.3 = 60). Free `5` and Plus `20` are correct.

6. **Segment duration (the original §3.77 target).** `SEGMENT_DEFS` all three segments `duration: 6` (stale); `run_depth` hardcoded `"6s"/"12s"/"18s"` — a third distinct set of numbers vs prototype UI ("8s") and spec (5/10/15s). Three codebases now disagree on segment duration.

**Note:** Deployed Worker correctly handles the `audioScoreRaw === -1` no-audio sentinel (→ null pillar), but the §3.45 no-*speech* anchor (anchor audio at 0.50 when audio present but no human speaker) is not implemented — same gap as prototype, see related no-speech finding.

**Action:** Scope as a single reconciliation task, NOT piecemeal. Fixing only the 4s→5s constant here would leave items 1–4 wrong and ship a Worker with broken verdict math. Production verify scoring must be brought to parity with the prototype's corrected logic (audio passthrough, raw video handling, certainty scalar, non-human guard) plus the tier quota correction, in one Claude Code pass. §3.77 code action is folded into this — do not run the standalone §3.77 segment-constant prompt against this Worker.

**Code shipped (commit `cd5df37`, deployed `96b9e66a`).** Direct MCP inspection of the deployed `skept-verify` Worker this session (30 Jun, session 4) confirms the reconciled scoring is live: audio passthrough (`max(raw,0.0)`, no `(raw+1)/2`), raw video handling (no `(raw+1)/2` on the primary pillar), certainty scalar `min(SKEPT_FRAMES, resembleFrameCount)/SKEPT_FRAMES` present, non-human frame-count guard present, tier quotas Free 5 / Lite 10 / Plus 20 / Pro 40 / Max 60 correct, `SEGMENT_DEFS` all 5s, `run_depth` 5/10/15s. Scoring math is correct as deployed.

**Runtime verification of the scoring still deferred to §3.90** — same blocker as everything else: no clip has run through `skept.co/api/verify` yet, so the corrected math has not been exercised against live Resemble output in production. The cartoon-cat re-run will be part of the §3.90 first-live-run test (and is also where §3.91's liveness gate gets confirmed).

- [x] Scope full reconciliation diff: prototype `deepfake.py` + fusion logic vs deployed `skept-verify` Worker
- [x] Confirm canonical scoring source of truth — prototype was the reference; deployed Worker now matches
- [x] Single Claude Code prompt: audio passthrough, remove video `(raw+1)/2`, add certainty scalar, add non-human guard, fix Pro/Max quotas (40/60), segment duration to 5s, run_depth strings to 5/10/15s — shipped `cd5df37`
- [x] Runtime-verified 02 Jul 2026 (§3.90 first-live-run): real Instagram reel through `skept.co/api/verify` returned `score: 0.511`, `verdict: suspicious`, confirmed via direct D1 query against `analysis_history`. Audio passthrough, certainty scalar, 5s segments, and quota logic all exercised on a real Resemble response with no scoring-layer errors. Cartoon-cat-specific non-human-guard confirmation (this run had nothing to exclude) carried forward under §3.91, not blocking this closure.

**Closed 02 Jul 2026.** All six divergences above confirmed corrected in production.

---

### ✅ §3.92 — Worker secrets provisioned — CLOSED 02 Jul 2026

**Found 30 Jun 2026 (session 5)** via Claude Code repo audit. `wrangler secret list` against `skept-verify` returns `[]` — no secrets provisioned at all. `RESEMBLE_API_KEY` and `INGEST_SECRET` are both missing. This is the hard floor underneath §3.90, §3.91, and §3.89's runtime verification: none of those can be exercised until both secrets exist on the Worker.

**Updated 30 Jun 2026 (session 6).** `ingestion-worker.js` — what `INGEST_SECRET` was meant to authenticate against — was never actually deployed (see §3.94). Both secrets still needed, but the targets shift: `INGEST_SECRET` now authenticates the Worker against the new ingest-only endpoint being added to Railway's `Skept-prototype` service in §3.94, not a separate `skept-ingest` service. `RESEMBLE_API_KEY` is unchanged in purpose but **sourced from a differently-named var** — Railway has it as `RESEMBLE_API_TOKEN`. Same value, set it on Cloudflare under the `RESEMBLE_API_KEY` name the Worker code expects — easy to mis-set by assuming the names match.

- [x] `wrangler secret put RESEMBLE_API_KEY` on `skept-verify` — set from Railway's `RESEMBLE_API_TOKEN` value, 02 Jul 2026
- [x] `wrangler secret put INGEST_SECRET` on `skept-verify` — matches the value set on Railway's ingest endpoint
- [x] Both confirmed present and functional via a successful live `/api/verify` call — a direct `wrangler secret list` re-check wasn't needed once a real request proved both live

**Closed 02 Jul 2026.** Both run directly in a plain terminal, deliberately kept out of Claude Code's session so neither value entered an AI context.

---

### ✅ §3.93 — R2 bucket created and confirmed working — CLOSED 02 Jul 2026

**Found 30 Jun 2026 (session 5)**, same audit as §3.92. Originally: no `[[r2_buckets]]` binding in `wrangler-verify.toml`; bucket name assumed to live in a Railway env var (`R2_BUCKET_NAME`); R2 S3 credentials assumed to exist on Railway only.

**Updated 30 Jun 2026 (session 6).** Binding now exists — `cc1b337` added `[[r2_buckets]] CLIP_BUCKET` with placeholder bucket name `skept-clips`. The Railway var this was meant to confirm against turned out not to exist at all (see §3.94) — there's no "real" name to match, the placeholder is free to become the actual name. R2 itself was not enabled on the account; Charlie enabled it manually this session (confirmed $0/month, free tier, existing PayPal on file, no new payment method). R2 Overview confirms zero buckets created — storage is active but empty. Account ID `787ca3a5426422e0df65ba7ef999d196` confirmed via dashboard, matches OAuth record.

Stage 1 (§3.94) uses a native R2 *binding* on the Worker side, not S3 credentials — `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` aren't needed for the Worker to read the bucket. May still be needed Railway-side depending on how the new ingest endpoint writes to R2 — confirm during Stage 1 build.

- [x] R2 bucket created — name kept as `skept-clips`, created via Cloudflare MCP 02 Jul 2026
- [x] `CLIP_BUCKET` binding confirmed working — Worker successfully read an object out of it during the first live `/api/verify` run
- [x] Confirmed Railway's ingest endpoint needs R2 S3 credentials (Railway isn't a Workers runtime, no native binding available there) — Account API Token generated, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_ACCOUNT_ID` provisioned as Railway env vars

**Closed 02 Jul 2026.**
- [x] ~~Confirm actual `R2_BUCKET_NAME` value from Railway env~~ — moot, var doesn't exist anywhere (§3.94)
- [x] ~~Decide presigned vs multipart~~ — multipart chosen, carried into §3.94's Stage 1 plan

---

### ✅ §3.94 — Stage 1 built, deployed, and confirmed working — CLOSED 02 Jul 2026

**Found 30 Jun 2026 (session 6)** via Chrome Extension live investigation (read-only — no Enable/Purchase clicked, no Railway variables modified) of the Cloudflare and Railway dashboards directly, triggered by `cc1b337`'s deploy failing on R2 management API `code: 10042`.

**What's actually there, confirmed by direct inspection, not repo review:**
- R2 was not enabled on the Cloudflare account (`787ca3a5426422e0df65ba7ef999d196`, confirmed correct) at all — independently reproduced via Cloudflare MCP (`r2_buckets_list` returned the same `10042`). Charlie enabled it manually mid-session: $0 due now, free tier (10GB/1M Class-A/10M Class-B per month), charges the existing PayPal on file only past that — no new payment method. R2 Overview post-enable: zero buckets created.
- No `skept-ingest` service exists on Railway. Checked both `wholesome-truth` (1 service: `Skept-prototype`) and `intuitive-fulfillment` (2 services: `Skept-Provider-Eval`, `Skept-prototype`) projects, every service, exhaustively.
- `R2_BUCKET_NAME` and `R2_ENDPOINT` — the vars session 4/5 referenced as the source of the real bucket name and an account-ID cross-check — do not exist on any Railway service or project shared variables.
- The only pipeline that has ever actually worked: `wholesome-truth → Skept-prototype`. Downloads clips directly via yt-dlp (Instagram cookie auth, `INSTAGRAM_COOKIES_B64`), calls Resemble (`RESEMBLE_API_TOKEN`) and Replicate (`REPLICATE_API_TOKEN`) directly. No R2 anywhere in this path.

**Conclusion.** `INGEST_WORKER_URL` (`https://skept-ingest.up.railway.app`) and `ingestion-worker.js` (`{ key }` response shape), both referenced as confirmed-working in session 4's investigation, describe code that was written and committed but never deployed as a running service. Same shape as the established Worker-deploy-divergence principle (live bytes ≠ repo/records) — turns out it generalises to entire missing services, not just stale Worker deploys. This is why §3.90's original two candidate fixes ("presigned R2 URL" vs "direct multipart") both stalled: both assumed something populates R2, and nothing ever has.

**Path considered and abandoned:** Worker calls the Railway `Skept-prototype` service directly as a single JSON-in/JSON-out hop (no R2 in the critical path at all) — drafted as a full Claude Code prompt, **not executed**, superseded the same session once the Resemble-direct-from-Cloudflare preference was stated.

**Landed direction — Stage 1 (planned, not built):**
- Railway `Skept-prototype` gets a new ingest-only endpoint: download via the existing yt-dlp/cookie logic (reused as-is, not rewritten), upload to R2, return confirmation. No Resemble or Replicate calls inside this new endpoint.
- Cloudflare Worker keeps/restores `cc1b337`'s R2-read → multipart → Resemble logic largely as committed — that code was already correct, it just had nothing to read.
- `RESEMBLE_API_KEY` becomes a new Cloudflare secret, value sourced from Railway's existing `RESEMBLE_API_TOKEN` (name differs, same value — see §3.92).
- `INSTAGRAM_COOKIES_B64` stays on Railway, untouched.
- Replicate/faceswap calling location explicitly **out of scope** this round — stays wherever it currently runs; only Resemble's call site moves.
- This is the concrete implementation of §3.84's already-locked "strip Railway to yt-dlp ingestion only" action item, arrived at by a different route than expected — not a new architectural decision.

**Deliberately not scoped here — Stage 2 (horizon, see §3.84 update):** Cloudflare Containers could eliminate Railway entirely (yt-dlp running inside a Cloudflare-deployed Docker image, R2-bound, via Durable Object). Genuinely new infrastructure build, paid instance tier, not a same-session task. Revisit once Stage 1 has one confirmed live run — building Stage 2 before Stage 1 has ever worked once would be exactly the over-engineering-before-validating thing the project avoids.

**Session closed without building Stage 1** — scope grew large enough mid-session to warrant full planning before any more code changes. Next session starts from this entry with the plan already locked.

- [x] Identified Railway's entrypoint and reused the existing download function as-is, 02 Jul 2026
- [x] Built the ingest-only endpoint — `POST /api/ingest`, `{ url, job_id } → download → upload to R2 → { key }`, `INGEST_SECRET` bearer auth. Committed `fe722e6`.
- [x] `callIngest()` needed no changes — its existing contract already matched the new endpoint exactly
- [x] §3.92 secrets and §3.93 bucket provisioned
- [x] Deployed — `skept-verify` version `3e40a7d4-1bbd-4b3c-ab66-46fa3eef963b` (URL fix), then `61046432-333c-4be8-8d4f-b3c33ad7230d` (§3.95 route fix)
- [x] First live run succeeded 02 Jul 2026 — confirms §3.89 scoring and §3.90 wiring. §3.91's liveness gate did not misfire but its exclusion branch remains unexercised — see §3.91.

**Closed 02 Jul 2026.** Real Instagram reel downloaded via yt-dlp, landed in `skept-clips`, read back by the Worker, scored by Resemble, verdict returned and persisted. Root architecture gap fully resolved.

---

### ✅ §3.95 — Verify Worker route pattern didn't match its own path check — 405 on every real call — CLOSED 02 Jul 2026

**Found 02 Jul 2026**, first real `/api/verify` test after §3.94/§3.90/§3.92/§3.93 all otherwise complete. Response was a bare `405 Method Not Allowed` with no JSON body — meaning the request never reached the Worker's `fetch()` handler at all, since every code path in it returns JSON.

**Root cause.** `wrangler-verify.toml`'s route was `pattern = "skept.co/api/verify/*"` (trailing wildcard). `verify-worker.js` itself checks `url.pathname !== "/api/verify"` (exact match, no wildcard tolerance) before doing anything else. A request to the bare path `/api/verify` — which is what the frontend actually calls, and what every real user submission has always sent — doesn't satisfy the wildcard route's expected trailing content, so it fell through to Cloudflare's static-asset handling for skept.co, which only serves GET/HEAD and correctly 405s on POST.

**This is a real product bug, not a test artefact.** Every live user submission through the actual `/verify` page has been hitting this same wall since the route was first deployed — not just this session's curl/PowerShell tests.

**Fix.** `pattern` changed to `"skept.co/api/verify"` — wildcard removed entirely, since the Worker never needs to match anything beyond that exact path. Deployed `61046432-333c-4be8-8d4f-b3c33ad7230d`, committed `f7e6ac8`.

- [x] Identify root cause — route pattern vs Worker's internal exact-path check
- [x] Fix `wrangler-verify.toml` route pattern
- [x] Deploy and confirm via a real live call — `missing_token` (auth-layer error) replaced the bare `405`, confirming the edge now reaches the Worker

---

### ✅ §3.90 — Cloudflare verify pipeline wired end-to-end — CLOSED 02 Jul 2026 (the gating milestone)

**Logged 30 Jun 2026 (session 3); code progressed 30 Jun (session 4).** The deployed `skept-verify` Worker exists and its scoring is reconciled (§3.89), but no clip can currently be analysed via `skept.co/api/verify` — all live analysis still runs through the Railway prototype. Completing this wiring is the prerequisite for (a) verifying §3.89's scoring at runtime, (b) verifying §3.90's own fixes, (c) verifying §3.91's liveness gate, and (d) beginning the Railway→Cloudflare wind-down. Positive framing: reaching it means the platform is ready to start shifting off Railway.

**Code complete this session (deployed `skept-verify` `f20b9445`):** the two confirmed blockers that were 500-ing every real call have been fixed.

- **D1 CHECK constraint mismatch (`migration-analysis-2.sql`, commit `2befcd8`, applied live):** `verdict_state` and `run_depth` constraints were rejecting every INSERT the Worker attempted — after the Resemble call had already been billed. `verdict_state` → `('authentic','ambiguous','suspicious','manipulated')`; `run_depth` → `('5s','10s','15s') DEFAULT '5s'`. Non-destructive (0 rows); indexes preserved.
- **permalink_uuid wired (`verify-worker.js`, commit `8ef0cd3`):** was never written → `skept.co/v/{uuid}` could never resolve any result. Now `tierConfig.permalink ? crypto.randomUUID() : null`, written to column + response.
- **Investigation outcomes:** INGEST_WORKER_URL (`https://skept-ingest.up.railway.app`, in `[vars]`) correct; `callIngest()` ↔ `ingestion-worker.js` `{ key }` shape confirmed; frontend cookie auth ↔ `authenticate()` confirmed.
- **Bonus fixes:** `VERDICT_META` in `frontend/src/verify.js` updated from stale 3-band to 5-band keys (all verdicts were rendering grey "Unknown"); share link switched from `analysis_id` to `permalink_uuid` (was always 404ing).

**Resemble submission method — resolved.** `deepfake.py` (only confirmed-working caller) submits via multipart file upload, not URL-based JSON. `cc1b337` (session 6) rewrote `callResemble()` to match: read bytes from an R2 binding, build multipart FormData, POST to `app.resemble.ai/api/v2/detect`. This part of the code is sound as committed.

**Root cause — bigger than originally scoped.** The original framing ("`callResemble()` receives `clipUrl` not the R2 key") was correct as far as it went, but session 6 discovered the R2 key it should have received was never going to exist either — no service has ever written a clip to R2. `INGEST_WORKER_URL`/`ingestion-worker.js`, referenced in session 4's investigation as the source of the R2 key, was committed to the repo but never deployed as a running Railway service. Full detail logged as §3.94. `cc1b337`'s multipart-to-Resemble logic is correct and stays; what's missing is anything that populates R2 in the first place. Stage 1 (§3.94) fixes this: a new ingest-only endpoint on Railway's existing `Skept-prototype` service does the R2 write; `cc1b337`'s Worker-side logic reads it.

- [x] Built Stage 1 (§3.94): Railway ingest-only endpoint + Cloudflare Worker wiring
- [x] Provisioned §3.92 secrets
- [x] Created R2 bucket, confirmed `CLIP_BUCKET` binding (§3.93)
- [x] Deployed `skept-verify` — final working version `61046432-333c-4be8-8d4f-b3c33ad7230d`, after fixing an unrelated route-pattern bug found along the way (§3.95)
- [x] First 200 confirmed: `analysis_history` row verified directly via `d1_database_query` — `verdict_state: suspicious`, `run_depth: 5s`, both valid. Test ran on Free tier, so `permalink_uuid` was correctly `null`, not a non-null case — a Pro+ tier run would be needed to specifically exercise the permalink-resolves-a-real-page path; not done this session, not considered blocking
- [ ] Re-run the cartoon-cat clip → confirms §3.91 liveness gate specifically (§3.89 scoring math is separately confirmed above, on a different real clip) — carried forward under §3.91
- [x] Railway wind-down (§3.84) sequencing is now unblocked — status upgraded to actionable, not yet started

**Closed 02 Jul 2026.** The gating milestone, open since session 3, is done. First clip ever processed end-to-end through the Cloudflare-native pipeline.

---

### 🟡 §3.91 — Non-human / synthetic content reaches deepfake pillar without exclusion — code deployed and live, exclusion path unexercised

**Found 30 Jun 2026** (cartoon-cat TikTok, two runs). The deepfake (faceswap) pillar scored a faceless AI-generated cartoon 99.74% and drove a false 79% "suspicious" verdict. The pre-§3.89 guard only excluded on `resembleFrameCount <= 1`, missing high-frame-count synthetic content — a faceswap model has nothing to swap on a cartoon, so 99.7% is not informative of manipulation risk, and a *human-made* cartoon would score identically (false-positive surface for legitimate animation).

**Code complete this session (commit `66d6b43`):**

- `callResemble()` now sends `intelligence: true` (required for Resemble to return the Intelligence/liveness layer).
- Guard is now `resembleFrameCount <= 1 || isNotRealPerson` — frame-count branch unchanged in behaviour, gains the reason label; both branches set `deepfakeExcludedReason = 'non_human_content'` and `videoSuspicion = null`.
- `fusion.js` null-score pillar loop propagates `excluded_reason` into `detail[name].excluded_reason` + `exclusionReasons`. `audio_dubbing_pattern` logic untouched.

**Liveness field path is best-effort, NOT confirmed.** No live Resemble Intelligence response has been observed from the Worker. A one-shot `console.log` of `item.intelligence` is in place to read off `wrangler tail`; `livenessLabel` derivation handles both flat-string and `{ label }` object forms; `// TODO: confirm exact field path against a live wrangler tail run` left at the gate.

**Note (session 6).** §3.94's Stage 1 rebuild touches `verify-worker.js` again — the Resemble call site changes from R2-read-multipart-with-nothing-to-read to R2-read-multipart-fed-by-the-new-Railway-endpoint. This guard (`intelligence: true`, `isNotRealPerson`, `non_human_content` propagation) must survive that edit unchanged — flag explicitly in the Stage 1 Claude Code prompt's "DO NOT CHANGE" list.

**Update 02 Jul 2026.** §3.90's first live run confirmed this code is deployed and does not misfire — a normal clip with a real, identifiable face correctly went through unexcluded. That's necessary but not sufficient: the exclusion branch itself (`isNotRealPerson` actually triggering) remains unexercised, since the test clip had nothing for it to catch.

- [ ] **First-live-run confirmation B:** read `item.intelligence` structure off `wrangler tail` on a synthetic/non-human clip specifically (the normal clip tested 02 Jul didn't exercise this path), confirm the liveness field path, remove the TODO
- [ ] Re-run the cartoon-cat reference clip specifically — the one test that actually confirms this guard fires as designed
- [ ] Sequence against §3.20 Sightengine build — liveness-gate + Sightengine are complementary halves of synthetic-content handling
- [ ] Until confirmed: a fully-synthetic clip with the gate firing has no valid verdict pillar — a more honest state than a confident 79%

---

### ✅ §3.77 — Segment duration 4s → 5s across all tiers — Fully complete 30 Jun 2026

**Decision locked 29 Jun 2026.**

Segment duration increased from 4s to 5s across all tiers. Segment count unchanged. Updated totals: Free/Lite 5s (1×5s), Plus/Pro 10s (2×5s), Max 15s (3×5s). Max hits 15s clip cap exactly.

**Margin impact (surfaced 30 Jun 2026):** Recalculating cost/run at 5s drops margins materially below the prior 40% floor — Plus/Pro fall from 41.3% to 26.7%, Max from 34.0% to 17.5%, top-up packs from ~34–37% to ~17–21%. Confirmed deliberate, not an oversight: founder's rationale is that detection reliability (more analysis depth) is the better use of cost-per-run than price-cutting for volume or price-raising to defend margin — a startup posture favouring user volume over margin percentage at this stage. The 40% floor is explicitly superseded as a planning assumption, not a hard constraint. Documented in pricing summary v2.3 margin summary sections (subscription + top-up pack).

**Actions:**
- [x] Pricing summary v2.2 → v2.3: revised cost/run (Free/Lite $0.55, Plus/Pro $1.10, Max $1.65), revised full-cap costs, revised margin tables (subscription + top-up packs), margin rationale documented
- [x] Segment duration constant 4→5 — **shipped via §3.89 reconciliation (commit `cd5df37`, deployed `96b9e66a`): `SEGMENT_DEFS` all 5s, run_depth 5/10/15s.** Code complete; runtime-unverified pending Cloudflare cutover (§3.90).
- [x] Update Engineers Brief §4.10 analysis depth table (4s → 5s per segment) — **done, EB v0.22**
- [x] Update Project Brief §11.5 analysis depth description — **done, PB v0.25**

All four actions complete. Runtime verification of the underlying scoring code (not the doc fold-in) remains gated on §3.90, tracked there.

---

### 🟡 §3.78 — Founder cohort coupon: tier-variable, Plus floor — PB fold-in complete; Stripe-side confirmation outstanding 30 Jun 2026

**Decision locked 29 Jun 2026.**

Founder cohort Stripe coupon applicable to Plus, Pro, Max only. Lite and Free excluded. Single Stripe coupon code — no tier restriction in Stripe itself. Tier eligibility enforced at distribution point (checkout link targets Plus/Pro/Max prices only). `founder_cohort BOOLEAN DEFAULT FALSE` column on users table unchanged.

**Actions:**
- [ ] Stripe dashboard: confirm coupon config requires no tier restriction (percentage-off applies to any price)
- [ ] Confirm checkout link generation for cohort invites targets Plus/Pro/Max price IDs only
- [x] Update Project Brief §11.5 founder cohort description — **done, PB v0.25** (new Founder cohort coupon paragraph, placed between Priority processing and iOS pricing note)

---

### 🟡 §3.79 — Usage-triggered subject list growth

**Decision locked 29 Jun 2026.**

NER extracts PERSON entity not in curated Wikidata list → log to `subject_candidates` table. Hit count threshold: 3+ distinct runs → surfaces for curator review. Approved → promoted to live list. Rejected → suppressed. Clip-centric framing: account context stored alongside but matching unit is the clip.

**Actions required:**
- Claude Code: create `subject_candidates` table in skept-analysis D1 (name TEXT, wikidata_qid TEXT nullable, hit_count INTEGER DEFAULT 1, first_seen INTEGER, status TEXT DEFAULT 'pending' CHECK status IN ('pending','approved','rejected'))
- Claude Code: update NER pipeline — on entity extraction, check against live list; if absent, upsert to subject_candidates (increment hit_count on conflict)
- Admin view (§3.80) is now live — review surface available once the table above exists; no longer blocked
- Update Engineers Brief §3.9 subject identity section

---

### 🟡 §3.81 — Per-frame timestamp data capture (admin-only)

**Decision locked 29 Jun 2026.**

Per-frame timestamp + score + certainty from Resemble response captured and stored internally. Not surfaced to users. Admin layer only. Purpose: sampling strategy calibration, identifying where in clips manipulation concentrates, empirical basis for future sampling and evidence card decisions.

**Actions required:**
- Decide storage: separate D1 table (`frame_data`) on skept-analysis, or JSON blob column on analysis_history
- Claude Code: update verify Worker to persist per-frame data alongside job result
- Admin view (§3.80) is now live — surface this once data capture is built; no longer blocked
- Update Engineers Brief §3.1 to note per-frame data retention for internal calibration

---

### 🟡 §3.82 — Resemble `metrics.consistency` — evidence card candidate

**Deferred — Phase 2.**

`metrics.consistency` currently unused. High score + low consistency = manipulation localised to specific segments. Candidate future evidence card note. No action required until Phase 2 evidence card enhancement session.

---

### 🟡 §3.83 — LLM-generated verdict summary — Pro/Max tiers

**Deferred — Phase 2.**

Structured verdict data passed to LLM post-analysis → plain-English narrative summary card on verdict page. Gated to Pro and Max. Free/Lite/Plus receive templated copy. No action required until Phase 2 feature build.

---

### 🟡 §3.84 — Railway confirmed as permanent yt-dlp utility service

**Decision locked 29 Jun 2026.**

Railway retained as single-purpose yt-dlp ingestion microservice indefinitely. $5/month, Hobby plan. All other services on Cloudflare. Fly.io evaluated and rejected (no free tier, ~$8–25/month equivalent). "Railway decommission" in prior entries meant decommissioning as the primary stack — not full removal.

**Actions required:**
- Strip Railway service down to yt-dlp ingestion only — remove any prototype UI or non-ingestion routes still running
- Update CLAUDE.md: clarify Railway role as permanent utility pipe, not prototype to be decommissioned
- Update Engineers Brief §4.2 backend section: Railway = permanent yt-dlp microservice (not "decommissioned at production launch")

**Update (session 6, 30 Jun 2026).** Confirmed via live investigation: the "strip to ingestion only" action item above has not been executed — Railway's `Skept-prototype` still runs full analysis (Resemble + Replicate calls), not just ingestion. Now precisely scoped as part of §3.94's Stage 1 plan, which gives Railway a dedicated ingest-only endpoint alongside (not yet replacing) its current full-analysis behaviour.

**Update (session 8, 02 Jul 2026).** §3.94's Stage 1 now has a confirmed live run (§3.90 closed) — the condition this decision was waiting on. The original "strip to ingestion only" action item is actionable now, not deferred. Not started this session; next infra session can open directly on it.

**Horizon note, not acted on.** Cloudflare Containers (confirmed current product, not available when this decision was locked) can run full Docker images — including yt-dlp + ffmpeg — with R2/binding access, deployed via `wrangler` + a Durable Object. The "permanent" framing above may eventually be revisited: full Railway elimination becomes technically possible, not just the ingestion-only shrink. Real new build (Docker image, cookie handling inside the container, paid instance tier), not a quick swap — deliberately not scoped here. Revisit once §3.94's Stage 1 has a confirmed live run.

---

### 🟡 §3.85 — Magic link email rebrand

**Decision locked 29 Jun 2026.**

Current Resend email uses default dark template. Target: CREAM (#FAF8F5) background, INK (#1A1A1A) text, loupe mark SVG at top, AMBER (#DFB87B) button, sender display name "Skept" (not bare noreply@skept.co), ignore-copy footer.

**Actions required:**
- Produce HTML email template matching brand tokens
- Claude Code prompt: update `html` and `from` fields in skept-auth Worker Resend call
- Verify rendered output in Gmail (mobile + desktop) before deploying

---

### 🟡 §3.88 — Founder + Admin privilege matrix — decision pending

**Decision locked 30 Jun 2026.**

Role column (`user|founder|admin`) is live in D1. Admin and Founder are recognised role values. Privileges for both roles are not yet defined or locked.

**Admin — direction agreed, not yet specced:**
- Bypasses all quota checks
- Access to admin dashboard (`skept.co/admin`)
- Manual tier override capability
- Aggregate usage stats visibility
- Full spec and EB §4.10 update pending privilege decisions.

**Founder — decision required before spec:**
- `role='founder'` + `tier='max'` confirmed as the structural approach
- Specific privilege set (beyond Max features) not yet decided
- Candidate privileges to decide: founder badge in UI, priority support marker, early feature access, quota exemption or uplift, other perks
- Distinct from §3.78 (founder cohort Stripe coupon) — that's pricing/checkout mechanics; this is role/access mechanics. Related initiatives, separate deliverables.
- Once decided: PB §11.5, §16.4; EB §4.10; Pricing Summary to be updated.

---

## 4. Sidelined / Parked items

| **Item** | **Status** | **Notes** |
| --- | --- | --- |
| Camera seal scanner | Parked | Too exotic for committed roadmap; screen-filling UX concern. Future direction: loupe mark as scannable credential with embedded machine-readable glyph. Worth exploring post-MVP. |
| Separate engineering Claude project | ✅ Resolved — 26 May 2026 | Claude Code CLI adopted instead. CLAUDE.md pushed to DustyDingo/Skept-prototype as canonical dev reference. |
| Image and longer-clip scope | Parked | Images at Phase 2, longer clips as Max-tier only when ready. |
| Max-tier verify flow specimen | Parked | Free and Pro specimens establish the pattern; Max tier is a Phase 2 surface. |
| GPU self-hosting strategy | Deferred — revisit at scale | Replicate replaced by Resemble as active provider (live v0.17). Railway GPU self-hosting remains the agreed long-term direction — deferred until prototype otherwise stable. Three-phase roadmap: Phase A self-host weights on Railway GPU; Phase B calibration on real-world clips; Phase C fine-tune on short-form social content. Custom model is the competitive moat. |

---

## 5. Document state snapshot

| **Document** | **Version** | **Last touched** | **Next planned revision** |
| --- | --- | --- | --- |
| project_brief_v0_25.docx | v0.25 | 30 Jun 2026 | Next batch: §3.88 founder/admin privilege fold-in once that decision closes |
| legal-brief-v0_10.docx | v0.10 | 23 Jun 2026 | Next attorney engagement outcomes or new legal questions |
| engineers_brief_v0_22.docx | v0.22 | 30 Jun 2026 | Next batch: §3.88 founder/admin privilege fold-in once that decision closes; §3.90/§3.91 runtime-verification notes once Cloudflare cutover confirmed |
| trademark-clearance-brief-v0_3.docx | v0.3 | 19 May 2026 | v0.4 — US/EU/UK filing outcomes; entity assignment; Class 41 skip confirmed |
| skept-account-settings.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-trust-seal-ux.html | v0.2 | 04 May 2026 | Next UX iteration cycle |
| skept-landing.html | v0.1 | 29 Apr 2026 | Launch day — slide out; skept-signin-flow.html slides in |
| skept-verify-flow.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-verify-flow-pro.html | v0.2 | 05 May 2026 | Next UX iteration cycle |
| skept-signin-flow.html | v0.3 | 05 May 2026 | Fine-tuning adjustments outstanding before launch deploy |
| waitlist-worker.js | v0.1 | 29 Apr 2026 | When deployed — fill KV namespace IDs in wrangler.toml |
| CLOUDFLARE_WORKER.md | v0.1 | 29 Apr 2026 | No planned revision |
| skept_advisor_script_v1_4.docx | v1.4 | 30 Apr 2026 | No planned revision |
| skept-pricing-summary-v2_3.md | v2.3 | 30 Jun 2026 | Authoritative source — always read before citing numbers. v2.2 figures now stale (4s segments superseded). |
| frontend/history.html | v1.0 | 29 Jun 2026 | Next UX iteration after verify page live and real entries render |
| frontend/verify.html | v1.0 | 29 Jun 2026 | Next UX iteration after end-to-end verify flow confirmed working |
| cloudflare/verdict-worker.js | v1.0 | 29 Jun 2026 | Iterate on evidence card rendering once real evidence_json shape confirmed |
| cloudflare/verify-worker.js | deployed `61046432-333c-4be8-8d4f-b3c33ad7230d` | 02 Jul 2026 | §3.89/§3.90 runtime-verified via first successful live run. §3.92/§3.93/§3.94 closed alongside. §3.91 code live, exclusion path not yet exercised — cartoon-cat re-test outstanding. §3.95 (route pattern fix) closed same session. |
| cloudflare/fusion.js | — | 30 Jun 2026 | §3.91: propagates `non_human_content` excluded_reason alongside `audio_dubbing_pattern`. |
| cloudflare/migration-analysis-2.sql | applied live | 30 Jun 2026 | §3.90: corrected verdict_state + run_depth CHECK constraints on analysis_history. Commit `2befcd8`. |
| frontend/src/verify.js | — | 30 Jun 2026 | §3.90: VERDICT_META → 5-band keys; share link → permalink_uuid. |
| cloudflare/templates/skept-base-template.html | v1.0 | 29 Jun 2026 | Update when nav structure changes (new links, avatar upgrade, dark mode) |
