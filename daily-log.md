# Skept — Daily Development Log

---

## 02 Jul 2026 (session 8) — §3.94 Stage 1 built and deployed; §3.90 gating milestone CLOSED — Cloudflare verify pipeline confirmed working end-to-end; route pattern bug found and fixed (§3.95)

**Session type:** Claude Code prompt production (Projects) → execution (Claude Code + Railway/Cloudflare dashboards, Charlie direct) → live testing (PowerShell) → MCP verification (Projects). First session to produce a real, verified 200 response from `skept.co/api/verify`.

---

**Opened against session 7's close note** — §3.94 Stage 1 was locked and ready, nothing built. Live-checked `skept-verify` before touching anything (deploy-divergence habit): confirmed `cc1b337` had never deployed — live `callResemble()` was still the old direct-JSON-URL version, live `callIngest()` still targeted the dead `skept-ingest` URL. R2 confirmed at 0 buckets. No drift from what the checklist already said; safe to proceed on the locked plan.

**Stage 1 build.** Created R2 bucket `skept-clips` via Cloudflare MCP. Generated `INGEST_SECRET`. Claude Code Prompt 1 (new `POST /api/ingest` endpoint on Railway's `Skept-prototype`, reusing existing yt-dlp/cookie logic, boto3 upload to R2, `INGEST_SECRET` bearer auth) — built and committed `fe722e6`, pushed to `main`.

**R2 credentials.** Charlie created an Account API Token (`skept-ingest-r2-write`, Object Read & Write scoped to `skept-clips`, TTL Forever, no IP filtering) via the Cloudflare dashboard — navigated there with a navigation-only Chrome Extension prompt; token generation itself stayed manual throughout, never delegated to an agent. Four new Railway env vars set (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `INGEST_SECRET`) via Raw Editor — caught and avoided a near-miss where submitting the editor as first-opened would have wiped the 5 existing variables (`HF_TOKEN`, `INSTAGRAM_COOKIES_B64`, `REPLICATE_API_TOKEN`, `RESEMBLE_API_TOKEN`, `SKEPT_FRAMES`); appended instead.

**Prompt 1 test.** First attempts failed on operator error, not code: PowerShell aliases `curl` to `Invoke-WebRequest`, which doesn't accept `-X`/`-H`/`-d` — switched to native `Invoke-RestMethod` for all further testing this session. A retry left the `<a real clip url>` placeholder unsubstituted (`download_failed`, correctly). Corrected retry succeeded: real Instagram reel downloaded via yt-dlp, uploaded to R2 as `test124.mp4`, confirmed via the endpoint's own `{"key": "test124.mp4"}` response. **§3.94 Stage 1 confirmed working.**

**Prompt 2 — smaller than scoped.** Verification-first prompt confirmed both `cc1b337` (R2-read → multipart → Resemble) and `66d6b43` (liveness gate: `intelligence: true`, `isNotRealPerson` guard, `non_human_content` exclusion propagation) were already correctly committed — session 6's work, just never deployed. Only actual fix needed: `INGEST_WORKER_URL` pointed at the dead `skept-ingest` URL instead of the real Railway prototype URL. Fixed, deployed `3e40a7d4-1bbd-4b3c-ab66-46fa3eef963b`, committed `171d355`. Independently confirmed via direct Cloudflare MCP inspection of the live Worker bytes (not just Claude Code's report) that both pieces were correctly present post-deploy.

**Secrets.** `INGEST_SECRET` and `RESEMBLE_API_KEY` provisioned on `skept-verify` via `wrangler secret put`, run directly in a plain terminal — deliberately kept outside Claude Code's session so neither value ever entered an AI context. Hit and resolved a PowerShell gotcha: first attempt ran from `C:\WINDOWS\System32` (permission error writing `.wrangler\cache` — a protected system folder, unrelated to the secret or the `NODE_OPTIONS` flag); `cd`'d into `cloudflare/` and both put commands succeeded clean.

**§3.95 — NEW — route pattern bug found and fixed.** First real `/api/verify` call returned a bare `405 Method Not Allowed` — no JSON body, meaning the request never reached the Worker's own `fetch()` handler (which always returns JSON). Root cause: `wrangler-verify.toml`'s route was `pattern = "skept.co/api/verify/*"` (trailing wildcard), which did not match the literal path `/api/verify` cleanly against the Worker's own internal check (`url.pathname !== "/api/verify"`, no wildcard tolerance) — the request fell through to Cloudflare's static-asset handling for skept.co, which only accepts GET/HEAD on unmatched paths. This is a real product bug, not a test artefact — the frontend's own `/api/verify` fetch call would have hit the identical wall on every real user submission since the route was first deployed. Fixed: pattern changed to `"skept.co/api/verify"` (wildcard removed entirely — the Worker never needs a suffix). Deployed `61046432-333c-4be8-8d4f-b3c33ad7230d`, committed `f7e6ac8`.

**First successful live run.** Retest after the route fix returned `{"error":"missing_token"}` — progress (reached the Worker), traced to the `Bearer ` prefix being stripped along with the placeholder during substitution, not a code issue. Corrected retry succeeded:

```
job_id:        19a5f448-8ad6-467d-b4db-f82d968e7602
verdict:       suspicious
score:         0.511
tier_at_run:   free
analysis_id:   3cf88ea9-54e3-4e9d-9234-5d1d0a3281b0
platform:      instagram
```

Independently confirmed via direct `d1_database_query` against `skept-analysis` (not just trusting the API response) — row present with `verdict_state: suspicious`, `run_depth: 5s`, both valid against the CHECK constraints §3.90 fixed, `permalink_uuid: null` (correct — Free tier).

**§3.90 — the gating milestone, open since session 3 — is CLOSED.** First clip ever processed end-to-end through the Cloudflare-native pipeline. §3.89's runtime verification is complete for the standard scoring path (audio passthrough, certainty scalar, 5s segments, tier quotas all exercised correctly on a real Resemble response). §3.92 and §3.93 close alongside it.

**§3.91 — not fully closed.** Code is deployed and confirmed live, and did not misfire on this run (real face, normal frame count, nothing excluded — correct behaviour, but the exclusion branch itself went unexercised). The reference cartoon-cat clip re-run — needed to confirm the guard actually fires — remains outstanding. Left open, downgraded from blocked to actionable.

---

**Decisions logged:** None new architecturally — pure execution against the plan session 6 locked. Two technique notes worth carrying forward: PowerShell aliases `curl` to `Invoke-WebRequest`; use `Invoke-RestMethod` natively instead of fighting `curl.exe` quoting on Windows. `wrangler secret put` values should always be entered in a raw terminal, never routed through Claude Code's own session, regardless of how the command itself was produced.

**Open items at session close:** §3.95 (NEW — route pattern bug — closed same session), §3.91 (code deployed, exclusion path unexercised — cartoon-cat re-test recommended), §3.76, §3.78 (Stripe-side confirmation only), §3.79, §3.81, §3.82, §3.83, §3.85, §3.88 (unchanged, carried forward). §3.84 (Railway wind-down) — status upgraded from *deferred pending Stage 1* to *actionable now*: Cloudflare verify has reached functional parity for the first time. §3.89, §3.90, §3.92, §3.93, §3.94 — CLOSED this session, dropped from the open list.
**Baseline:** Project Brief v0.25 · Engineers Brief v0.22 · Legal Brief v0.10 · Pricing Summary v2.3 (unchanged — no document builds this session)

---

## 30 Jun 2026 (session 7) — Project Brief v0.25 and Engineers Brief v0.22 built: §3.77/§3.78/§3.86/§3.87 folded in; §3.70 found already-folded

**Session type:** Document build (Projects). Two brief version bumps executed back-to-back — no code, no Claude Code handoff this session.

---

**Scope.** Cleared the closed-but-unfolded backlog flagged at session close: §3.77 (segment duration 4s→5s), §3.78 (founder cohort coupon), §3.86 (seal/permalink gate Plus→Pro) into Project Brief v0.25; §3.77, §3.86, §3.87 (role column) into Engineers Brief v0.22.

**Build method — worth recording for next time a brief gets rebuilt.** The project-mounted `.docx` files (`project_brief_v0_24.docx`, `engineers_brief_v0_21.docx`) are not raw binary — reading them via `bash`/`cat` returns a clean markdown-style text extraction, not a zip archive (`extract-text` and `unzip` both fail against them; `file` reports plain UTF-8 text). No markdown source file for either brief exists in the project to edit directly. Worked around it: extracted the full body text via `view`/`sed`, edited the relevant sections directly in markdown, ran it through `pandoc` to a fresh `.docx`, then wrote a small standalone script (`assemble_briefs.py`) that imports `build_cover()`, `build_toc_table()`, `HEADING_STYLES`, and the section-break helper directly from `skept_brief_template.py` and assembles cover + TOC (PB only) + pandoc body manually — rather than going through `rebuild()`'s strip-first-7-elements heuristic, which assumes a specific raw-pandoc leading-boilerplate shape that doesn't exist when the source is reconstructed extracted text rather than the original markdown. Same design tokens, same cover/TOC code, different assembly path. Verified by converting both outputs to PDF and rendering the cover, TOC, edited table pages, and Document History pages as images — confirmed correct before delivery.

**§3.70 finding.** Checklist carried this as "fold into EB §3.3 at next brief build; no active action." Direct inspection of the EB v0.21 source found the calibration note already present verbatim — it was evidently folded in during the v0.21 build itself, and the checklist row was never updated to reflect that. No action was actually needed this session; checklist row corrected to record the finding rather than re-doing already-done work. Same shape as the project's established deploy-divergence principle, just applied to documents instead of Worker bytes — live content beat the tracking note.

**Project Brief v0.25 — §11.5 Pricing:** monthly pricing table, analysis depth explained paragraph, and unit economics table all moved 4s→5s; Plus and Pro feature descriptions swapped to match the §3.86 gate move (Plus loses seal/permalink, Pro gains it); unit economics and top-up pack margins recalculated for the 5s cost basis (Plus/Pro ~26.7% web, Max ~17.5% web at full cap, down from ~41.3%/34.0%); margin commentary rewritten to match the pricing summary's explicit "40% floor superseded as a planning assumption" framing rather than the old "accepted, real-world will be better" hedge; new **Founder cohort coupon** paragraph added; pricing summary cross-reference bumped v2.2→v2.3 (was already stale — pricing summary itself has been at v2.3 since the §3.77 margin rebuild). **§16.4 Paid-tier gating:** Plus/Pro rows swapped to match. Cross-reference sweep: three body references to `engineers_brief_v0_21.docx` bumped to `v0_22`.

**Engineers Brief v0.22 — §4.10 Subscription and tier enforcement:** new **Role field** bullet documents the §3.87 schema addition (`role` column, `user`/`founder`/`admin`, migration `0003_add_role_to_users.sql`) — scoped deliberately to the structural fact only, not privilege specifics, since §3.88 (founder/admin privilege matrix) is still open and explicitly sequences brief updates after that decision closes. Analysis depth by tier and the Phase 2 delivery bullet's seal-gate tier list both moved to 5s/10s/15s and Pro/Max respectively. Cross-reference sweep: `project-brief-v0.22`/`v0.23` (the cover "Related" field was already stale, pointing at v0.23 while PB was actually at v0.24) bumped to `v0.25` throughout.

**§3.78 partial close.** Only the PB documentation action is done. The other two §3.78 actions — Stripe dashboard coupon-config confirmation and checkout-link price-ID targeting — are operational, not documentation, and remain open. Checklist entry retitled and the one completed box checked; the other two left unchecked.

---

**Decisions logged:** none new — execution session against already-locked decisions. The build-method workaround above (assemble via imported `skept_brief_template.py` functions rather than `rebuild()`) is a technique decision worth carrying forward, not a project decision.

**Open items at session close:** §3.90 (verify pipeline wiring, gating milestone, unchanged), §3.91 (liveness gate, blocked on §3.90), §3.92 (secrets), §3.93 (R2 bucket creation), §3.94 (Stage 1 build, ready, not started), §3.89 (scoring reconciled, runtime-unverified), §3.76 (verdict Worker visual confirmation outstanding), §3.78 (Stripe-side confirmation only — doc piece closed this session), §3.79, §3.81, §3.82, §3.83, §3.84, §3.85, §3.88 (unchanged, carried from session 6). §3.77, §3.86, §3.87 closed in full this session — dropped from the open list.
**Baseline:** Project Brief v0.25 · Engineers Brief v0.22 · Legal Brief v0.10 · Pricing Summary v2.3

---

## 30 Jun 2026 (session 6) — §3.90 architecture gap discovered: assumed ingest service never existed; Railway/Cloudflare split redesigned; build deferred to fresh session

**Session type:** Claude Code prompt production (Projects) → execution (Claude Code) → Chrome Extension investigation → architecture redesign. `cc1b337` committed but not deployed. No further code shipped this session — scope grew large enough mid-session that it was called to document and plan properly rather than rush a build.

---

**§3.90 fix attempt — `cc1b337` committed, redeploy blocked.** Claude Code prompt produced for the multipart-vs-presigned decision deferred at session 5 close — chose multipart, matching `deepfake.py`. `callResemble()` rewritten to `callResemble(apiKey, bucket, r2Key)`: read R2 object → multipart FormData → POST to Resemble. `[[r2_buckets]] CLIP_BUCKET` binding added to `wrangler-verify.toml`, bucket name placeholder `skept-clips`. Committed `cc1b337`, pushed to `main`. Deploy failed: R2 management API returned `code: 10042` ("Please enable R2 through the Cloudflare Dashboard") — R2 had never been enabled on the account at all. Bucket name also unconfirmed.

**Chrome Extension investigation (read-only, scoped to avoid clicking Enable/Purchase) surfaced a deeper problem than a missing toggle.** Findings:
- R2 confirmed not enabled, account ID `787ca3a5426422e0df65ba7ef999d196` matched expectation. Enable flow: single button, $0 due now, charges existing PayPal (`charlie.doust@hotmail.com`) only past free tier (10GB/1M Class-A/10M Class-B per month).
- R2 manually enabled mid-session via dashboard. R2 Overview confirms: zero buckets created.
- Railway has no `skept-ingest` service anywhere. Checked both `wholesome-truth` (Skept-prototype only) and `intuitive-fulfillment` (Skept-Provider-Eval, Skept-prototype) projects, all services, exhaustively. `R2_BUCKET_NAME` and `R2_ENDPOINT` — referenced in session 4/5 notes as living on Railway — do not exist on any Railway service or shared variables.
- The only working pipeline is Railway `wholesome-truth → Skept-prototype`: downloads clips directly via yt-dlp (Instagram cookie auth, `INSTAGRAM_COOKIES_B64`), calls Resemble (`RESEMBLE_API_TOKEN`) and Replicate (`REPLICATE_API_TOKEN`) directly. No R2 involvement anywhere in this path.

**Conclusion: the `skept-ingest`/R2-population architecture documented in session 4 (`INGEST_WORKER_URL`, `ingestion-worker.js` returning `{ key }`) was written/committed but never actually deployed as a running service.** Same failure mode as the established Worker deploy-divergence pattern (repo code ≠ live bytes) — turns out it applies to whole missing services, not just stale deploys. This invalidates §3.90's original "presigned vs multipart" framing entirely: both candidates assumed something populates R2, and nothing ever has. Full detail logged to checklist as §3.94.

**Architecture redesign, two false starts before landing:**
1. **Path A** (build the missing R2/ingest service from scratch) vs **Path B** (collapse — Cloudflare Worker calls the Railway prototype directly as one JSON-in/JSON-out hop, abandon R2 in the critical path entirely) — considered. B chosen for speed: reuses the only proven pipeline, no new infra. Claude Code prompt drafted for B (delete `callIngest()`/R2-based `callResemble()`, add `callPrototype(url)`, strip the R2 binding). **Not executed — superseded one message later, do not run.**
2. Redirected: Cloudflare should talk to Resemble directly as the primary route, Railway reduced toward eventual elimination ("wind up Railway" — testing/dev framing, not production-permanent). Triggered a check on whether full Cloudflare-native (including the download step) is now possible.
3. **Finding: standard Workers (V8 isolate) still can't run yt-dlp/ffmpeg/subprocess** — unchanged, this is why Railway exists as the ingestion microservice in the first place (§3.84, locked 29 Jun). **New finding: Cloudflare Containers is a current product** (changelog Mar 2026) — full Docker images deployed via `wrangler`, with R2/binding access, wired to a Durable Object. Means true full Railway elimination is technically possible now, but it's a new build (Docker image w/ yt-dlp + ffmpeg + cookie handling, Durable Object wiring, paid instance tier — not free Workers tier), not a swap. Logged as a horizon item under §3.84 — not started, not scoped for next session either; deliberately deferred until the basic pipeline has one confirmed live run.

**Landed direction — Stage 1 (planned, not built):** Railway's `Skept-prototype` service gets a new ingest-only endpoint — download via existing yt-dlp/cookie logic, upload to R2, return confirmation. No Resemble/Replicate calls in this new endpoint. Cloudflare Worker keeps/restores `cc1b337`'s R2-read → multipart → Resemble logic largely as committed — that code was correct, it just had nothing to read. `RESEMBLE_API_KEY` moves to Cloudflare as a new secret, value sourced from Railway's existing `RESEMBLE_API_TOKEN` (name differs, same value — flagged so it isn't mis-set). `INSTAGRAM_COOKIES_B64` stays on Railway. Replicate/faceswap calling location explicitly untouched — out of scope this round, only Resemble's call site moves. This is, in effect, the actual implementation of §3.84's already-locked "strip Railway to yt-dlp ingestion only" action item — not a new decision, just arrived at by a different route than expected.

**Session closed without building Stage 1.** Scope grew large enough mid-session ("this is going to be a big session") to warrant full planning + documentation now, build executed in a fresh session with everything already decided going in — no improvising mid-build. Checklist updated (§3.90 rewritten, §3.92/§3.93 updated, new §3.94 added, §3.84 annotated) ahead of that next session.

**Decisions logged:** Multipart over presigned for the Resemble call (carried into Stage 1). Path B (Worker→Railway-prototype-direct) considered and abandoned. Stage 1 split (Railway = ingest-only, Cloudflare = Resemble-direct) adopted as the build target. Cloudflare Containers flagged as the real "wind up Railway" path — deliberately deferred, not started.

**Open items at session close:** §3.94 (NEW — architecture gap + Stage 1 plan, ready to build), §3.90 (blocked on §3.94's build, root cause reframed), §3.92 (secrets — `RESEMBLE_API_KEY` now sourced from Railway's `RESEMBLE_API_TOKEN`, `INGEST_SECRET` now protects the new Railway ingest-only endpoint), §3.93 (binding present via `cc1b337`, R2 enabled, bucket still not created), §3.91 (unchanged, still blocked on §3.90 chain — guard logic must survive the Stage 1 Worker rewrite), §3.89 (unchanged), §3.84 (annotated — Containers horizon note added), §3.76, §3.77/§3.78 (brief fold-ins, unchanged), §3.79, §3.81, §3.82, §3.83, §3.85, §3.88 (unchanged, carried from session 5).
**Baseline:** Project Brief v0.24 · Engineers Brief v0.21 · Legal Brief v0.10 · Pricing Summary v2.3

---

## 30 Jun 2026 (session 5) — Claude Code repo audit surfaces three pre-flight blockers on the verify path

**Session type:** Prototype/production diagnosis (Projects) — reviewing a Claude Code repo-audit output surfaced via the terminal. No code changes this session; findings logged to checklist.

---

The audit was triggered to confirm the §3.90 verify-pipeline state ahead of a first live run. §3.91 code (`intelligence: true`, `isNotRealPerson` guard, `non_human_content` exclusion) confirmed fully present in repo source; commit `66d6b43` confirmed an ancestor of HEAD on `main`, so it's live, not stuck behind a stale deploy. Post-deploy commits touch docs only — Worker code is in sync with HEAD. That part is clean.

Three new blockers surfaced, all on the live verify path:

- **§3.92 — Worker secrets unprovisioned (hard floor).** `wrangler secret list` against `skept-verify` returns `[]`. Both `RESEMBLE_API_KEY` and `INGEST_SECRET` are missing. First live call fails at `callIngest()` (401 from Railway) and `callResemble()` (auth error) regardless of any other fix. Nothing downstream can be runtime-tested until both are set.
- **§3.93 — R2 binding + bucket name absent from repo.** No `[[r2_buckets]]` in `wrangler-verify.toml`. Bucket name lives in a Railway env var (`R2_BUCKET_NAME`), not visible in the Cloudflare repo. R2 S3 creds also unprovisioned as Worker secrets (Railway only). Account ID known via OAuth (`787ca3a5426422e0df65ba7ef999d196`) but not in toml.
- **§3.90 root cause confirmed.** This is the sharper finding. `callResemble()` is called with `clipUrl` — the original social URL — never the R2 key the ingest service already stored. Resemble gets `{ url: <tiktok.com/...>, content_type: 'video', intelligence: true }`. Independent of the existing JSON-vs-multipart question, a gated social URL is very likely to fail at Resemble outright. Two candidate fixes: (a) presigned R2 URL from the stored key — blocked on §3.93; (b) direct multipart upload to Resemble like `deepfake.py` — no R2 dependency, more self-contained while §3.93 is open. Decision deferred to the fix thread.

**Dependency shape:** §3.92 is the floor under everything (§3.89 runtime verification, §3.90, §3.91 liveness path). §3.93 only gates the presigned-URL fix option for §3.90 — the multipart option routes around it. Fix work to be picked up in a fresh thread.

**Decisions logged:** none — diagnosis only. Fix-approach decision (presigned vs multipart) explicitly deferred.

**Open items at session close:** §3.92 (Worker secrets — NEW, hard blocker), §3.93 (R2 binding/bucket name — NEW), §3.90 (verify wiring — root cause now identified, blocked on §3.92), §3.91 (liveness field path — blocked on §3.92), §3.89 (scoring reconciled, runtime-unverified — confirm against `verify-worker.js` if in doubt), §3.76 (verdict Worker visual confirmation), §3.77/§3.78 (brief fold-ins), §3.79, §3.81, §3.84, §3.85, §3.88.
**Baseline:** Project Brief v0.24 · Engineers Brief v0.21 · Legal Brief v0.10 · Pricing Summary v2.3

---

## 30 Jun 2026 (session 4) — §3.90/§3.91 code complete via Claude Code; both runtime-blocked on Cloudflare cutover

**Session type:** Claude Code prompt production (Projects) → execution (Claude Code) → output review. Two prompts run back-to-back. Both code-complete and committed; neither runtime-verified.

---

**§3.90 — Verify pipeline unblocked (code complete; deployed `skept-verify` version `f20b9445`):**

Two D1 CHECK constraint mismatches were silently 500-ing every real `/api/verify` call at the INSERT step — after the Resemble call had already been paid for.

- **FIX 1 — D1 migration (`cloudflare/migration-analysis-2.sql`, commit `2befcd8`):** recreated `analysis_history` with corrected CHECK constraints. `verdict_state` was `('likely_authentic','inconclusive','likely_manipulated')` → now `('authentic','ambiguous','suspicious','manipulated')`. `run_depth` was `('6s','12s','18s') DEFAULT '6s'` → now `('5s','10s','15s') DEFAULT '5s'`. Applied directly to live skept-analysis D1 — confirmed 0 rows (non-destructive); both indexes preserved.
- **FIX 2 — permalink_uuid (`verify-worker.js`):** `const permalinkUuid = tierConfig.permalink ? crypto.randomUUID() : null;` added before the INSERT, written to the `permalink_uuid` column, included in the JSON response. Pro/Max users now get a non-null UUID that `verdict-worker.js` can actually resolve.
- **FIX 3 — investigation results:**
  - (a) `INGEST_WORKER_URL` = `https://skept-ingest.up.railway.app` in `[vars]`, not a secret. Correct.
  - (b) `callIngest()` response shape — `ingestion-worker.js` returns `{ key: r2Key }`. Confirmed match.
  - (c) **Resemble URL — bug confirmed and fixed.** Worker used `https://api.resemble.ai/v2/detect`; `deepfake.py` (only confirmed-working caller) uses `https://app.resemble.ai/api/v2/detect`. Host corrected. **Caveat — the sharper risk:** `deepfake.py` submits via **multipart file upload**; the Worker submits a **URL-based JSON body**. Whether `/api/v2/detect` accepts URL-based requests at all is unconfirmed and cannot be confirmed without a live test. This — not the host — is the real open question under the §3.90 runtime test.
  - (d) Frontend auth — `submitVerify()` sends `credentials: 'include'` (cookie); `authenticate()` accepts the `skept_session` cookie. Confirmed match.
  - **Bonus unambiguous fixes:** `VERDICT_META` in `frontend/src/verify.js` was on stale 3-band keys → all verdicts were falling through to grey "Unknown"; updated to current 5-band keys. Share link was building off `data.analysis_id` → updated to `data.permalink_uuid` (verdict-worker queries by `permalink_uuid`; analysis_id links always 404'd).

**§3.91 — Non-human / synthetic content gate (code complete; commit `66d6b43`):**

- `verify-worker.js`: `callResemble()` now sends `intelligence: true` (required for Resemble to return the Intelligence/liveness layer). After `c2paResult`, extracts `item?.intelligence`, logs it once via `console.log` (one-shot diagnostic — read off `wrangler tail` on next live run), derives `livenessLabel` from either flat-string or `{ label }` object form.
- Non-human guard is now `resembleFrameCount <= 1 || isNotRealPerson` — frame-count branch unchanged in behaviour, just gains the reason label; both branches set `deepfakeExcludedReason = 'non_human_content'` and `videoSuspicion = null`.
- `fusion.js`: null-score pillar loop now propagates any `excluded_reason` on the input pillar (e.g. `non_human_content`) into `detail[name].excluded_reason` and `exclusionReasons`. `audio_dubbing_pattern` logic untouched.
- **Liveness field path is best-effort, NOT confirmed** — no live Resemble Intelligence response has been observed from the Worker. `// TODO: confirm exact field path against a live wrangler tail run` left at the gate.

---

**Both items are code-complete but runtime-unverified, and blocked on the same milestone: the Cloudflare verify cutover (§3.90 end-to-end wiring / first real `/api/verify` call).** Two specific confirmations must come off the *first* live run — both surface on the same `wrangler tail`, so it's one test session, not two:

1. **(§3.90)** Does Resemble's `/api/v2/detect` accept a URL-based JSON body, or must the Worker switch to multipart upload like `deepfake.py`? Sharpest risk in the verify path.
2. **(§3.91)** What is the actual `item.intelligence` field structure? Confirm the liveness path, remove the TODO.

**Deployments this session:** `skept-verify` `f20b9445`. Commits: `2befcd8` (D1 migration), `8ef0cd3` (§3.90 worker + frontend), `66d6b43` (§3.91).

**Open items at session close:** §3.76 (verdict Worker logo runtime confirmation), §3.78 (PB §11.5 fold-in + Stripe coupon config), §3.79, §3.81, §3.84, §3.85, §3.88, §3.90 (runtime verification — now the gating milestone; carries the multipart-vs-URL confirmation), §3.91 (runtime verification — liveness field path confirmation, bundled into the §3.90 test run). §3.77 brief fold-ins (EB §4.10 / PB §11.5) still pending next builds.
**Baseline:** Project Brief v0.24 · Engineers Brief v0.21 · Legal Brief v0.10 · Pricing Summary v2.3

---

## 30 Jun 2026 — Pricing v2.3 (5s segments), GST clarification, prototype triage, production Worker divergence found

**Session type:** Doc build + decision logging + prototype diagnosis. Started as a routine checklist knock-out (§3.77/§3.78); surfaced a margin-floor decision and ended on a significant production/prototype divergence finding.

---

**§3.77 — segment duration 4s → 5s, pricing folded in:**

- Pricing summary v2.2 → v2.3 built. Cost/run recalculated: Free/Lite $0.55, Plus/Pro $1.10, Max $1.65. Full-cap costs and both margin tables (subscription + top-up packs) revised.
- Margin impact surfaced and confirmed deliberate: Plus/Pro 41.3% → 26.7%, Max 34.0% → 17.5%, top-up packs ~34–37% → ~17–21%. Founder's rationale logged in the doc: reliability (more analysis depth) chosen over price-cutting or margin defence; the 40% floor was a planning assumption, now explicitly superseded. Startup posture — volume over margin %.
- §3.86 (seal/permalink gate Plus → Pro) folded into the same v2.3 pass.
- GST clarification added: 10% AU GST is a pass-through, zero margin effect (verified by recalc — margins identical with/without GST). New note distinguishes "no margin impact" from the real cash-flow/BAS reconciliation effect (Stripe AU payouts run ~10% above USD list).

**§3.78 — founder cohort coupon:** Decision confirmed (Plus/Pro/Max eligible, enforced at distribution point). PB §11.5 description fold-in queued for next PB build.

**§3.77 Claude Code prompt drafted** — then held (see §3.89 below).

---

**Prototype triage (cartoon-cat TikTok clip, verdict 79% suspicious):**

Verdict landed correct on genuinely AI content, but on two pillars both running outside their valid domain. Triage doc's Issue 1 (audio conversion) and Issue 2 (frame scalar overflow) reviewed and confirmed NOT bugs in the prototype — audio passthrough is the locked behaviour, scalar is `min()`-capped by construction. New findings logged:

- **Non-human guard too narrow:** faceswap pillar scored a faceless cartoon 99.74% and drove the verdict. Guard only excludes on 0 ImageResult frames; Resemble's own liveness layer said not_real_person. A human-made cartoon would score the same — false-positive risk. Sightengine (§3.20) is the architectural fix; interim, exclude deepfake pillar on non-human-face content.
- **§3.45 no-speech anchor not firing:** clip has audio (SFX/music, no speaker) but audio pillar showed raw 0.4443 not the 0.50 anchor. Likely lost when §3.57 swapped to Omni embedded-audio path. Not caught by §3.59 (audio present, just no speech).
- UI "8s of 69.8s" stale (4s-era); prototype sampler actually running 5s per log.

---

**§3.89 — production `skept-verify` Worker divergence (the significant finding):**

Cross-checked production via Cloudflare MCP after the prototype log showed 5s sampling. Deployed `skept-verify` (last modified 28 Jun, predates both the §3.77 and audio-passthrough decisions) turned out to be an OLDER implementation than the prototype, diverging on core scoring:

1. Audio score run through `(raw+1)/2` — the transform that was REMOVED per the passthrough decision. The triage doc's "Issue 1" IS a live bug — in production, not the prototype.
2. Video score also run through `(raw+1)/2` — wrong transform on the primary pillar; flips low/authentic scores to suspicious.
3. No certainty scalar.
4. No non-human guard.
5. Tier quota drift: Pro 50 (should be 40), Max 100 (should be 60).
6. Segment duration stale (`duration: 6`, run_depth `6s/12s/18s`) — three codebases now disagree.

Logged as §3.89, scoped as a single reconciliation task. §3.77 standalone code prompt explicitly held — running it against this Worker would fix the segment number and leave four scoring bugs in place.

---

**Decisions logged:** Margin floor superseded (reliability over margin); GST is pass-through (no margin effect); §3.77 code folded into §3.89; prototype is currently ahead of production on scoring correctness.

**Open items at session close:** §3.89 (production verify Worker reconciliation — NEW, blocks §3.77 code), §3.77 (brief fold-ins EB §4.10 / PB §11.5 only — pricing done), §3.78 (PB §11.5 fold-in), plus prototype findings to formalise (non-human guard, §3.45 no-speech anchor, UI stale-string + 100% display rounding, Wikidata Q22686 monitor). Prior: §3.76 (verdict Worker runtime confirmation), §3.79, §3.81, §3.84, §3.85, §3.88.

**Files produced:** `skept-pricing-summary-v2_3.md`, updated `v19-consolidation-checklist.md`.

---

## 30 Jun 2026 — §3.76 logo SVG colour fix diagnosed and applied

**Session type:** Bug fix — diagnosis, fix, deployment, partial visual confirmation.

---

**Root cause identified:**

- `<symbol id="skept-mark">` uses `fill="currentColor"` on its shapes. The logo instances (`.nav-logo svg`, `.footer-logo svg`) never set their own `color`, so `currentColor` was inheriting from the ancestor `<a>` link instead of resolving to ink — rendering the loupe mark grey instead of solid `#1a1a1a`.
- Scope correction: originally tracked as five live surfaces (index, history, verify, settings, verdict-worker). Confirmed the same bug exists in `skept-base-template.html` — the canonical source all pages derive from — so scope expanded to six files; fixing only the five live pages would have left the template silently broken for any future page built from it.

**Fix applied:**

- Added/corrected `color: var(--ink);` on `.nav-logo svg` and `.footer-logo svg` across `skept-base-template.html`, `index.html`, `history.html`, `verify.html`, `settings.html`, and `verdict-worker.js`.
- No changes to the `<symbol>` definition, SVG paths, or other `currentColor` icons (chevron, gear, sign-out) — those correctly keep inheriting softer grey.
- 12 edits across 6 files. Committed `76e50b2`, pushed to `main`.

**Visual confirmation:**

- Confirmed via Chrome Extension screenshot on `history.html` — loupe mark renders solid `#1a1a1a` in both nav and footer.
- Empty-state illustration (large loupe mark, "Nothing here yet") reviewed and approved as-is — no changes needed there.
- **Not yet confirmed:** `skept-verdict` Worker live deploy and visual check on a real `/v/{uuid}` permalink page. Worker deploy is a separate step from Pages auto-deploy and hasn't been verified post-fix — code-level diff confirms the same fix was applied to `verdict-worker.js`, but runtime rendering is unverified.

**Follow-up produced:** Claude Code prompt to update `CLAUDE.md`'s §3.76 open-items row, conditional on verdict Worker confirmation (close out fully if confirmed; otherwise update to reflect partial completion).

**Open items at session close:** §3.76 (verdict Worker live deploy + visual confirmation only — code fix applied and committed), §3.77 (segment duration 4s→5s — cost/margin + brief fold-in), §3.78 (founder cohort coupon tier eligibility), §3.79 (subject list growth — subject_candidates table; review surface now unblocked by §3.80), §3.81 (per-frame timestamp capture — same unblock), §3.84 (Railway permanent-service doc cleanup), §3.85 (magic link email rebrand), §3.88 (Founder/Admin privilege matrix)
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 2026-06-30

### Admin dashboard — live and operational

- skept-admin Worker deployed and confirmed working at skept.co/admin/api/*
- frontend/public/admin.html live at skept.co/admin, token-gated (ADMIN_TOKEN secret, sessionStorage)
- Deployment debugging resolved across several rounds:
  - _redirects routing conflict — /admin was falling through to catch-all and landing on /verify. Fixed by moving admin.html into frontend/public/ so Vite copies it to dist/ natively; explicit /admin redirect rule removed once that was in place (was causing ERR_TOO_MANY_REDIRECTS as a duplicate route).
  - ADMIN_TOKEN secret had to be reprovisioned after initial "Incorrect token" — resolved via fresh openssl-style PowerShell-generated token and wrangler secret put.
- Two features added post-launch, confirmed live via screenshot:
  - Sidebar Users section now has Free/Lite/Plus/Pro/Max tier sub-items (indented under "All users"), each filtering the user table via GET /admin/api/users?tier=X. Active tier highlighted in sidebar, synced with in-view dropdown.
  - Overview dashboard now has a period selector (7d/30d/3m/6m/9m/12m/all) next to the page title, re-fetching GET /admin/api/overview?period=X and updating subtitle + all stat cards. Worker endpoint updated to accept period param (previously hardcoded to 30d).
- Admin dashboard considered feature-complete for v1 — Dashboard, Job log, Signals, Cost, Users (with tier filtering), Founder cohort views all live and wired to real D1 data.
- Note: Founder cohort view still queries the now-superseded `founder_cohort` boolean (§3.87 retired this column in favour of `role`). Query needs updating to `role = 'founder'` — flagged, not yet actioned.

---

## 30 Jun 2026 — Role column live; privilege matrix established; brief updates queued

**Session type:** Architecture and planning — role/tier privilege matrix, D1 migration, checklist updates.

---

**Decisions locked:**

- **Privilege matrix confirmed** — five subscription tiers (Free/Lite/Plus/Pro/Max) locked with one edit: seal generation and permalink access moved from Plus to Pro. Plus retains detailed evidence output, export to PDF, viewed history tab, full evidence history.
- **Role column live** — `role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'founder', 'admin'))` added to `skept-auth / users` via migration `0003_add_role_to_users.sql` (commit 605515a). `idx_users_role` index created. Both existing users (is_admin=1) set to `role='admin'`. `is_admin` column now superseded — flagged for drop in future migration.
- **Role architecture** — `role` is orthogonal to `tier`. Admin and Founder are access roles, not subscription tiers. A user can be `role='founder'` + `tier='max'` simultaneously. `founder_cohort BOOLEAN` column (previously queued) retired — superseded by role field.
- **Admin privileges (direction agreed)** — bypasses all quota checks; admin dashboard access (`skept.co/admin`); manual tier override; aggregate usage stats. Full spec pending (§3.88).
- **Founder privileges (decision pending)** — structural approach confirmed (`role='founder'` + `tier='max'`). Specific privilege set beyond Max features not yet decided. Logged as §3.88 for next decision session.

**Checklist updates:**
- §3.86 closed — seal/permalink gate moved to Pro
- §3.87 closed — role column live
- §3.88 opened — Founder + Admin privilege matrix, decision pending

**Numbering note:** §3.77–§3.79 were reused this session for the three items above before this consolidation pass caught the collision — those numbers were already assigned (29 Jun planning session, below) to segment duration, founder cohort coupon, and subject list growth respectively, all still open at the time. Renumbered to §3.86–§3.88 to resolve. See consolidation checklist for the full restored open-item set.

**Brief updates queued (not yet built):**
- Pricing Summary v2.2 → v2.3: Plus feature list (seal/permalink removed); also carries the still-open §3.77 segment-duration cost/margin revision
- Project Brief v0.24 → v0.25: §11.5, §16.4
- Engineers Brief v0.21 → v0.22: §4.10 (seal gate Pro+, role field documented)

**Open items at session close:** §3.76 (logo SVG colour fix), §3.77 (segment duration 4s→5s — cost/margin + brief fold-in), §3.78 (founder cohort coupon tier eligibility), §3.79 (subject list growth — subject_candidates table; review surface now unblocked by §3.80), §3.81 (per-frame timestamp capture — same unblock), §3.84 (Railway permanent-service doc cleanup), §3.85 (magic link email rebrand), §3.88 (Founder/Admin privilege matrix)
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — Planning session: pricing, architecture, product features

**Session type:** Planning and product decisions — no code changes. All items queued for checklist.

---

**Decisions locked this session:**

**Segment duration — 4s → 5s across all tiers (§3.77)**
Segment duration increased from 4s to 5s across all tiers. Segment count unchanged. Total analysis seconds: Free/Lite 5s (1×5s), Plus/Pro 10s (2×5s), Max 15s (3×5s). Max now hits the 15s clip cap exactly. Worker logic unchanged — references tier → segment count only; duration is a constant. Rationale: improved reliability at lower tiers drives acquisition and upgrades. Margin impact accepted (Plus/Pro full-cap margin drops from 41.3% → 26.7%; Max from 34.0% → 17.5% — real-world margin materially better as most users do not hit full cap).

Revised full-cap cost/run: Free/Lite $0.55 (5s × $0.11), Plus/Pro $1.10 (10s × $0.11), Max $1.65 (15s × $0.11). Pricing summary v2.2 requires update.

**Founder cohort coupon — tier-variable, Plus floor (§3.78)**
Founder cohort Stripe coupon changed from Max-tier-specific to tier-variable. Applicable to Plus, Pro, and Max tiers only. Lite and Free excluded. Cohort member selects their preferred tier at checkout; discount applies to that tier's price. Rationale: removes price barrier, ensures cohort accesses meaningful feature set (seal generation, permalinks, full detection depth). Preferred outcome remains Max but not enforced. Implementation: single Stripe coupon code; tier eligibility enforced at point of coupon distribution (checkout link directs to Plus/Pro/Max prices only).

**Usage-triggered subject list growth (§3.79)**
When NER extracts a PERSON entity not in the current curated Wikidata subject list, log it to a new `subject_candidates` table (name, wikidata_qid nullable, hit_count, first_seen, status: pending/approved/rejected). Candidates surfacing at 3+ distinct runs queue for curator review via admin layer. Approved → promoted to live subject list. Rejected → suppressed. Fully passive — list self-prioritises around figures actually being targeted on platforms. Clip-centric framing: matching unit is the clip (perceptual hash), not the account. Account context stored alongside for richer Source Details output. D1 table: `subject_candidates` on skept-analysis.

**Admin view — priority build (§3.80)**
Internal dashboard for founder/admin use. Subject candidate queue (§3.79) is the first functional requirement that makes this necessary. Other likely surfaces: job volume, error rates, flagged verdicts, user management. To be designed and scoped in a dedicated session.

**Per-frame timestamp data — admin-only capture (§3.81)**
Per-frame timestamp + score + certainty data from Resemble response to be captured and stored internally. Not surfaced to users (would be misleading given segment-only sampling). Admin layer only. Purpose: sampling strategy calibration, understanding where in clips manipulation signal concentrates, empirical basis for future sampling adjustment. Implementation deferred until admin view is scoped.

**Resemble `metrics.consistency` — evidence card candidate (§3.82)**
`metrics.consistency` from Resemble response currently unused. Measures how uniformly suspicion is distributed across the clip. High score + low consistency = manipulation localised to specific segments. Candidate for a future evidence card note ("manipulation signal concentrated vs distributed"). Deferred — log for Phase 2 evidence card enhancement.

**LLM-generated verdict summary — Pro/Max tiers (§3.83)**
Post-analysis, structured verdict data (video score, audio score, certainty scalar, Resemble label, fusion result, source signals) passed to an LLM to generate a plain-English contextual summary. Displayed as a narrative summary card on the verdict page. Gated to Pro and Max tiers. Free/Lite/Plus receive templated copy. Phase 2 candidate.

**Railway architecture — confirmed permanent utility service (§3.84)**
Railway retained indefinitely as a single-purpose yt-dlp ingestion microservice. Not a migration target — remains as a $5/month utility pipe for clip download and R2 upload. All other services are on Cloudflare. This is the confirmed long-term architecture; "Railway decommission" in prior entries meant decommissioning as the primary stack, not full removal. Fly.io evaluated and rejected — no free tier, ~$8–25/month for equivalent workload, migration cost not justified.

**Magic link email rebrand (§3.85)**
Current email uses Resend default dark template — no brand palette, plain text "Skept" header, generic layout. To be rebranded: CREAM (#FAF8F5) background, INK (#1A1A1A) text, loupe mark SVG at top, AMBER (#DFB87B) CTA button, sender display name set to "Skept" (not bare noreply@skept.co), footer with ignore copy. Implementation: update `html` and `from` fields in skept-auth Worker Resend call. Claude Code prompt to be produced at terminal session.

---

**Open items at session close:** §3.76 (logo SVG colour fix), §3.77–§3.85 (all new — queued for checklist)
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — Base template established; nav/footer shell locked

**Session type:** UI design — canonical base template, nav pattern decision.

---

**Decisions locked:**

- Nav link order (left → right): How it works · Check a video · History · Account ▾
- "How it works" sits leftmost in the link group — most marketing-oriented, targets first-time users
- Sign out moved inside Account dropdown (not top-level nav link)
- Account dropdown for web (not avatar/initials — deferred to app build when initials avatar introduced)
- Unauthenticated nav state: How it works · Sign in (Sign in gets bordered button treatment)
- `data-auth="true|false"` on `<body>` controls nav state switching — single template covers both states
- Footer: loupe mark + *Skept* wordmark left, © 2026 Skept right
- `cloudflare/templates/` directory established as canonical home for base template in repo
- All future pages copy from `cloudflare/templates/skept-base-template.html` — original never modified directly
- Active page highlighted via `active` class on the relevant `.nav-link` (set per-page)

**Deliverables:**

- `cloudflare/templates/skept-base-template.html` — canonical nav + footer shell, both auth states, account dropdown with Settings / Sign out, dropdown closes on outside click / Escape key, demo toggle included (remove in production pages)
- Claude Code prompt produced to create `cloudflare/templates/` directory and commit the file

**Open items at session close:** None from this session. §3.76 (logo SVG colour fix) remains the only open checklist item.

**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — Verdict page Worker live; verify page fully built

**Session type:** Cloudflare Pages frontend build — verdict page Worker, verify page, route registration.

---

**Verdict page Worker (skept-verdict) — COMPLETE:**

- `cloudflare/verdict-worker.js` created: single route `GET /v/:id`, queries `skept-analysis` D1 by `permalink_uuid`, server-renders full HTML page (no auth required).
- Implements full verdict anatomy from `skept-public-verdict-page.html` spec: hero block (6px colour band, loupe mark, state pill, headline, confidence-hedge panel, clip meta), evidence cards from `evidence_json`, context link, acquisition CTA, footer disclaimer.
- 404 state: cream shell, "This result couldn't be found." + "← Back to Skept" link.
- `cloudflare/wrangler-verdict.toml` created. Worker deployed as `skept-verdict`.
- Route `skept.co/v/*` registered in Cloudflare dashboard (via Chrome Extension). Confirmed working: `skept.co/v/test` returns correct 404 state. Commit bb953be.
- Cache-Control: `public, max-age=3600` on 200 responses.

**Verify page (§3.76 partial) — COMPLETE:**

- `frontend/verify.html` rebuilt from scaffold: cream shell matching `frontend/history.html`, three view states (intake → analysing → verdict), wired to `/api/verify/*` Worker.
- `frontend/src/verify.js` created: auth guard (checkAuth → redirect to `/` if no session), `startAnalysis(url)` → POST `/api/verify/submit` → poll GET `/api/verify/status/:job_id` every 2s (max 30 attempts) → render verdict or error.
- Intake view: "A SECOND LOOK, BEFORE THE SHARE" eyebrow + rule, "Look closer / at every clip." two-line Sorts Mill Goudy headline, descriptor subtext, Paste URL / Upload file tab switcher (Upload file inert — Phase 2), URL input with amber focus ring, "Analyse" button, platform pills (TikTok · Instagram · YouTube Shorts · X / Twitter · Bluesky · Discord CDN · Facebook · Direct file).
- Verdict view: hero card (colour band + mark + pill + headline + score% + hedge copy), evidence cards from `evidence_json`, "Check another clip" reset button, permalink copy button (if `permalink_uuid` present).
- Pages pushed to main; auto-deployed.

**Open items at session close:** §3.76 logo SVG colour fix (grey loupe in nav — SVG color inheritance not resolving to ink on all five surfaces: index, history, verify, settings, verdict Worker)
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — History page live; cream shell established for all interior pages

**Session type:** Cloudflare Pages frontend build — history page, logo fix, shell design decision.

---

**Design decisions locked:**

- **Interior page shell:** all authenticated pages (history, verify, settings) use the cream shell from `skept-landing.html` — `#faf8f3` bg, amber `#b87400` accents, frosted-glass sticky nav, Sorts Mill Goudy italic wordmark, Inter body. Dark app UI from the history specimen was correct for mobile mockups only; dropped for web.
- **Landing page approach:** Option B confirmed — thin above-fold pitch (logo + tagline + CTA) before sign-in gate. Full marketing page deferred until product loop is working end-to-end and real output can be screenshotted. `skept-how-it-works.html` specimen retained for when ready.
- **Mandatory sign-in from day one:** confirmed. No unauthenticated access to any product page. Auth guard on all interior pages redirects to `/` if no valid session. Per-user quota tracking is the enforcement mechanism; per-IP rate limiting alone is too easily bypassed.

**History page (§3.76) — COMPLETE:**

- `cloudflare/history-worker.js` updated: GET /list now returns `{ quota_used, quota_limit, entries }`. Quota fetch non-fatal — defaults to 0/5 if no quota_usage row exists.
- `frontend/history.html` rebuilt: cream shell, sticky nav (loupe + wordmark + "Check a video" / "History" active / Sign out), quota strip with progress bar, filter chips (All / Suspicious / Ambiguous / Authentic — client-side), history card list, loading skeletons, amber error banner, empty state.
- `frontend/src/history.js` new file: checkAuth → fetch /api/history/list → render quota strip → render cards. Delete flow with inline confirmation, 403 sealed-entry guard, fade-out on success.
- History Worker redeployed; Pages pushed to main and deployed.
- 500 on initial load fixed (quota query throwing on missing row — wrapped non-fatal).

**Logo SVG fix (partial):**

- Double-circle bezel ring removed across all four frontend pages (index, history, verify, settings).
- Remaining issue: loupe mark rendering grey instead of solid `#1a1a1a` — SVG `color` inheritance not resolving to ink value in nav context. Fix deferred to next session (one-line CSS correction).

**Open items at session close:** §3.76 logo colour fix (grey loupe in nav — SVG color inheritance); verify page (frontend/verify.html scaffold needs full build — next session)
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — EB v0.21 and PB v0.24 complete; all checklist items closed

**Session type:** Document build — both primary briefs rebuilt. Consolidation checklist cleared.

---

**Engineers Brief v0.20 → v0.21:**

- **New §3.9 Subject identity (§3.21 + §3.27):** Phase 1 NLP spec fully documented — spaCy NER on video metadata, curated Wikidata subject list (11 entries), wordninja hashtag pre-processing (#presidentdonaldtrump → segmented → NER match), evidence card copy ("Subject detected · [Name]"), Phase 1 NLP-only limitation (no face-match gate, known false positive on metadata-only hashtag match), Phase 2 face recognition gated on legal-brief-v0.10.docx §12a.
- **§4.4:** Subject identity (NLP) row added to Source Details table.
- **§13:** Subject identity Phase 1 backlog item updated to "confirmed live" (§3.31 cross-ref).
- **§3.1 Frame confidence scalar corrected (§3.75):** formula corrected to min(skept_frames, resemble_frame_count) / skept_frames; base score switched from per-frame mean to video_metrics.score. Deployments 15be7c1c + 5924057a.
- **§3.3 Audio formula rebuild (§3.71):** scoring changed from (raw + 1.0) / 2.0 to max(raw, 0.0); 0.15 minimum floor and librosa fallback removed; §3.70 calibration note added (authentic clips cluster near 0.0 on aggregated_score). §3.30 audio criteria updated: no minimum floor.
- **§4.6 Evidence card certainty-suppressed display (§3.69 + §3.73):** low-certainty note spec (fires when resemble_certainty < 0.25 AND resemble_video_score > 0.50, outside excluded gate); summary copy gate documented (gates on video_metrics.label, not final_score alone); root cause note (conditional was inside active branch only — deployment 63384a23).

**Project Brief v0.23 → v0.24:**

- **§11.5 Pricing:** full rebuild to USD base currency (was AUD). New prices: Lite $15.00/$20.99 iOS, Plus $30.00/$42.99 iOS, Pro $60.00/$85.99 iOS, Max $120.00/$170.99 iOS. Annual pricing updated. Unit economics in USD only. Top-up packs in USD: Small $9.99, Medium $20.99, Large $39.99. Authoritative source: skept-pricing-summary-v2.2.md.
- **§16.4:** tier prices updated to USD across all rows.
- **§4.2:** §3.69 calibration note added — certainty scalar behaviour on text-to-video content; EB §4.6 cross-ref.
- **EB cross-refs:** engineers_brief_v0_20 → v0.21 throughout.

**Consolidation checklist:**

All open items closed. §3.21/§3.27 and §3.50 added to closed items table. Document state snapshot updated. No open items remain as of 29 Jun 2026.

**Open items at session close:** None
**Baseline:** Project Brief v0.24, Engineers Brief v0.21, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — Cloudflare Pages live; magic link auth working end-to-end

**Session type:** Cloudflare Pages scaffold, frontend wiring, auth Worker debug.

---

**AUTH_SESSIONS cleanup — COMPLETE:**
Extraneous AUTH_SESSIONS KV binding removed from skept-stripe-checkout Worker. Claude Code prompt executed; committed.

**Cloudflare Pages project created (skept-prototype):**
- Connected to DustyDingo/Skept-prototype, main branch
- Build command: `npm run build`, root directory: `frontend`, output directory: `dist`
- Custom domain skept.co activated (removed from old skept-landing project first)
- Initial build failed (output dir misconfiguration `frontend/dist` → fixed to `dist`); second build succeeded

**Worker routes configured on skept.co:**
- skept-auth → skept.co/api/auth/*
- skept-settings → skept.co/api/settings/*
- skept-stripe-checkout → skept.co/api/billing/*
- skept-stripe-webhook → skept.co/api/webhooks/stripe
- skept-revenuecat-webhook → skept.co/api/webhooks/revenuecat
- skept-verify → skept.co/api/verify/* (deployed this session, was missing)
- skept-history → skept.co/api/history/* (deployed this session, was missing)

**Auth Worker updated (cookie auth):**
- handleVerify now sets skept_session httpOnly cookie on skept.co domain
- GET /api/auth/me endpoint added
- POST /api/auth/logout endpoint added
- CORS updated to include Access-Control-Allow-Credentials: true
- Three pre-existing bugs fixed in verify/history/settings Workers: KV key missing session: prefix, expires_at comparison wrong, no cookie fallback

**Vite frontend scaffolded and deployed:**
- frontend/ directory created: package.json, vite.config.js, four HTML pages, src/api.js, src/auth.js, four page scripts
- Multi-page Vite build; 15 modules, no errors
- Pushed to main; Pages deployed successfully
- All four pages load; auth guard correctly redirects unauthenticated users to sign-in
- MPA routing fix: frontend/public/_redirects added so /verify.html, /history.html, /settings.html serve directly

**skept-signin-flow.html specimen wired as live sign-in page:**
- Proto banner removed
- SSO buttons removed (Phase 2)
- handleSendLink() replaced with real fetch to /api/auth/request
- Magic link token handler added (page load checks ?token= param, exchanges with /api/auth/verify, redirects to /verify.html)
- Auth Worker magic link URL confirmed pointing to https://skept.co/?token=

**Auth Worker debug — three bugs fixed:**
1. ENCRYPTION_KEY wrong length: Worker was using hexToBytes() treating base64 string as hex → 44/2 = 22 bytes (176 bits). Fixed to Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)) → correct 32 bytes (256 bits). Committed 4153744.
2. ENCRYPTION_KEY value itself was wrong length (previous provisioning attempts produced 176-bit and 328-bit values). Reprovisioned with correct 32-byte key generated via PowerShell RNG.
3. RESEND_API_KEY had garbage bytes (non-ASCII chars in Authorization header). Reprovisioned with fresh key from Resend dashboard.

**Magic link confirmed working:**
POST https://skept.co/api/auth/request → ok: true at 11:07 AEST. Email delivered to c.doust85@gmail.com.

**Repo location confirmed:** C:\Users\charl\OneDrive\Documents\App Development\Skept\Deployment-Skept\Github Repo\Skept-prototype

**Open items at session close:** §3.21/§3.27, §3.50 step 7 (launch day only), brief rebuild for USD pricing, end-to-end magic link tap → verify flow test (next session)
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — §3.50 Step 6 complete — billing infrastructure fully deployed

**Session type:** Billing infrastructure build — dashboard setup, Worker deployment, D1 migrations, secret provisioning.

---

**§3.50 Step 6 — CLOSED (29 Jun 2026)**

Full billing infrastructure landed in a single session. Both Stripe and RevenueCat dashboards configured, three Workers deployed, D1 migrations confirmed, all secrets provisioned and rotated.

---

**Stripe dashboard setup:**
- 4 subscription products created: Skept Lite, Plus, Pro, Max
- Each product has two prices: monthly and annual (AUD)
- Price IDs captured and stored:
  - Lite monthly: `price_1Tmq9d2FCHac8PzKOlKxs8DR`
  - Lite annual: `price_1TmqAU2FCHac8PzKzotIxlFJ`
  - Plus monthly: `price_1TmqCA2FCHac8PzKWaHRAKZQ`
  - Plus annual: `price_1TmqCm2FCHac8PzKRuXGai4V`
  - Pro monthly: `price_1TmqDb2FCHac8PzKLo3WnJw3`
  - Pro annual: `price_1TmqE82FCHac8PzKy5hZnaFi`
  - Max monthly: `price_1TmqEu2FCHac8PzK2epL26VK`
  - Max annual: `price_1TmqFS2FCHac8PzKuSrI6AHG`
- 3 top-up one-time products: Small (A$15.99), Medium (A$31.99), Large (A$63.99)
  - Small: `price_1TmqN32FCHac8PzKJ2s8S6nL`
  - Medium: `price_1TmqQw2FCHac8PzKrJvasM78`
  - Large: `price_1TmqSN2FCHac8PzKMvCD18OC`
- Webhook endpoint registered: `skept-stripe-webhook.c-doust85.workers.dev/webhook`
- 5 events subscribed: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
- Note: Stripe account was in live mode throughout — all products and prices are live, not test

**RevenueCat dashboard setup:**
- 4 entitlements created: Skept Lite, Skept Plus, Skept Pro, Skept Max (identifiers with spaces — Worker maps these)
- 11 products in Test Store:
  - 8 subscriptions: `skept_lite_monthly`, `skept_lite_annual`, `skept_plus_monthly`, `skept_plus_annual`, `skept_pro_monthly`, `skept_pro_annual`, `skept_max_monthly`, `skept_max_annual`
  - 3 consumables: `skept_topup_small`, `skept_topup_medium`, `skept_topup_large`
- Products attached to entitlements (monthly + annual per tier)
- HMAC webhook signing enabled
- Webhook registered: `skept-revenuecat-webhook.c-doust85.workers.dev/webhook`
- Public SDK key (Test Store): `test_zISQtaRQGgEddHhjwMTahvesyXi`

**Workers deployed (all via Claude Code, §3.50 prompt):**
- `skept-stripe-checkout` — Stripe Checkout session creation + Customer Portal; bindings: SKEPT_AUTH_DB, AUTH_SESSIONS (AUTH_SESSIONS is extraneous — clean up in next pass)
- `skept-stripe-webhook` — handles checkout.session.completed, subscription.updated/deleted, invoice events; updates tier + quota in D1; bindings: SKEPT_AUTH_DB, SKEPT_ANALYSIS_DB
- `skept-revenuecat-webhook` — handles INITIAL_PURCHASE, RENEWAL, NON_SUBSCRIPTION_PURCHASE, CANCELLATION, EXPIRATION; HMAC signature verified via SubtleCrypto; bindings: SKEPT_AUTH_DB, SKEPT_ANALYSIS_DB

**D1 migrations confirmed via PRAGMA table_info:**
- `skept-auth / users`: `lite` added to tier CHECK constraint; `stripe_customer_id` column present
- `skept-analysis / quota_usage`: `quota_limit` (INTEGER, default 5), `topup_credits` (INTEGER, default 0), `topup_expires_at` (INTEGER, nullable) all confirmed
- `skept-analysis / analysis_history`: `tier_at_creation` CHECK updated to include `lite`

**Secrets provisioned (all via `wrangler secret put`):**
- `skept-stripe-checkout`: STRIPE_SECRET_KEY, STRIPE_PRICE_IDS, JWT_SECRET
- `skept-stripe-webhook`: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_IDS
- `skept-revenuecat-webhook`: RC_HMAC_SECRET

**Security rotations completed this session:**
- Stripe `whsec_` exposed in chat → rotated in Stripe dashboard → reprovisioned via `wrangler secret put STRIPE_WEBHOOK_SECRET`
- RC HMAC secret exposed in chat → rotated in RevenueCat → reprovisioned via `wrangler secret put RC_HMAC_SECRET`

**§3.50 Step 7** (landing page swap — `skept-signin-flow.html` replaces `skept-landing.html`) deferred to launch day. No action required now.

**Known cleanup item:** `AUTH_SESSIONS` KV binding on `skept-stripe-checkout` Worker is extraneous (copied from auth Worker pattern). Remove in next cloudflare pass.

---

**Open items at session close:** §3.21/§3.27, §3.50 step 7 (launch day only), brief rebuild for USD pricing
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10, Pricing Summary v2.2

---

## 29 Jun 2026 — iOS build planning; tier enforcement architecture clarified; Mac hardware decision

**Session type:** Planning and architecture Q&A — no code changes, no checklist updates.

**Tier system architecture clarified:**
Single platform, single build. No separate versions per tier. Every user hits the same Workers; `tier-config.js` gates responses at the Worker layer. The `tier` field on the `users` table (skept-auth) is the sole source of truth — re-checked server-side on every gated request. Client cannot unlock features by spoofing state. UI renders conditionally based on what the API returns.

**iOS build overview confirmed:**
The mobile app is a thin client for the existing Cloudflare Workers backend. Key components:
- React Native app shell (verify, history, settings, account screens — relatively lightweight)
- Native iOS Share Extension (separate Xcode build target, Swift) — primary entry point; the hard part
- Universal Links config — magic link taps must open the app, not a browser; requires Associated Domains entitlement + `apple-app-site-association` file on skept.co
- Session tokens in SecureStore (keychain-backed, not AsyncStorage)
- RevenueCat IAP wiring → subscription status flows back via webhook → Worker → `users` table
- Apple Developer account ($99/yr), certificates, provisioning profiles, TestFlight

**Magic link explained:**
Passwordless auth. User enters email → Skept sends one-time link → user taps → authenticated. Link expires 15 min, single-use. No passwords, no OAuth at Phase 1. Universal Links is the iOS config layer that routes skept.co link taps into the app rather than a browser.

**Timeline estimate (solo + Claude guidance):**
- Solo without guidance: 3–5 months
- Solo with Claude guidance: 2–3 months realistic; TestFlight beta achievable in 6–8 weeks if pushing hard
- App Review adds unpredictable time — plan for at least one rejection cycle
- Share Extension + Universal Links + RevenueCat wiring = ~40% of mobile build time despite being invisible to the user
- Beta cohort (20 users, manual D1 inserts, `tier='free'`) doesn't require billing live — simplifies TestFlight timeline

**Mac hardware decision:**
MacBook Air M3 16GB RAM selected as the recommended build machine. Rationale: handles RN build, Xcode, and Claude in browser comfortably; no fan; current base model. ~$1,499 AUD new. M1 Air 16GB is the budget alternative (~$900–1,100 AUD refurbished from Apple). MacBook Pro not needed — no sustained GPU workload. Mac acquisition remains the current critical path blocker for iOS build start.

**Open items at session close:** §3.21/§3.27, §3.50 (steps 6–7), brief rebuild for USD pricing
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10, Pricing Summary v2.2

---

## 28 Jun 2026 — USD base currency adopted; pricing restructured; pricing summary v2.2 produced

**Currency policy decision — LOCKED:**

Base currency moved from AUD to USD. Rationale: primary cost lines (Resemble AI, RevenueCat) are USD-denominated — pricing in USD eliminates FX margin risk structurally. AUD/EUR/GBP are presentment currencies only, handled by Stripe (daily rate at checkout) and App Store Connect / Google Play (nearest tier, periodic reconciliation). No FX floor assumption or review trigger needed — costs and revenue are the same currency.

**New USD price points (locked):**

| Tier | Web/mo (USD) | iOS/mo (USD) | Runs |
|------|-------------|-------------|------|
| Free | — | — | 5 |
| Lite | $15.00 | $20.99 | 10 |
| Plus | $30.00 | $42.99 | 20 |
| Pro | $60.00 | $85.99 | 40 |
| Max | $120.00 | $170.99 | 60 |

iOS prices grossed up ÷ 0.70, rounded to nearest .99. Web and iOS margins closely aligned at all tiers (70%/41%/41%/34% web; 70%/41%/41%/34% iOS).

**Top-up packs revised to USD:**

| Pack | Web (USD) | iOS (USD) | Web margin |
|------|-----------|-----------|------------|
| Small | $9.99 | $13.99 | 33.9% |
| Medium | $20.99 | $29.99 | 37.1% |
| Large | $39.99 | $56.99 | 34.0% |

Medium nudged from $19.99 → $20.99 to restore upgrade incentive at Pro → Max transition ($19.99 fell $0.03 short). All three upgrade incentive transitions now validated.

**Pricing summary v2.2 produced.** Supersedes v2.1.

**Briefs to update:** Project Brief §11.5, §5.5, §16.4 and Engineers Brief §4.10 require rebuild to reflect USD pricing. Queued for next document build session.

**Open items at session close:** §3.21/§3.27, §3.50 (steps 6–7), brief rebuild for USD pricing
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10, Pricing Summary v2.2

---

## 28 Jun 2026 — Top-up pack margin decision locked; pricing summary v2.1 produced

**Top-up pack post-GST margin decision — LOCKED:**

Decision: accept ~34% post-GST margin on all three top-up pack sizes. Prices remain $15.99/$31.99/$63.99 web and $22.99/$45.99/$91.99 iOS. Rationale: raising prices or reducing run counts would push per-run cost above the threshold for casual consumer engagement, undermining the retention purpose of the packs. Top-ups are an infrequent bridge purchase, not a primary revenue line. The 34% floor is accepted and will not be revisited unless post-launch volume data makes it material.

**Pricing summary v2.1 produced:**

- Decision note replacing open "decision required" flag in top-up section
- Stale "Urgent pending patches" section removed (patches applied in v0.23 build on 26 Jun)
- "Infrastructure notes" section retained, cleanly separated
- All prices confirmed locked across all tiers and top-up packs

**Briefs status:** Project Brief v0.23 and Engineers Brief v0.20 already reflect current pricing in full — no brief rebuild required for this decision. Decision note belongs in pricing summary only.

**Open items at session close:** §3.21/§3.27, §3.50 (steps 6–7)
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10, Pricing Summary v2.1

---

## 27 Jun 2026 — Close-out review; §3.62 confirmed already closed (stale); outstanding items reconciled

**End-of-day close-out session. Checklist and daily log brought current. Two open items remain heading into next session.**

---

**§3.62 — CONFIRMED ALREADY CLOSED (stale checklist item):**

Review of daily log confirmed §3.62 (audio score normalisation disclosure) was already fixed in commit `49c0fd6` and verified closed during the 26 Jun batch session. The checklist carried it as open in error — no action required, no prompt needed.

**Outstanding items at end of day (27 Jun 2026):**

- **§3.21/§3.27** — Engineers Brief missing subject identity spec section. Feature is live and working; EB v0.21 write-up is the remaining task.
- **§3.50 steps 6–7** — Billing Workers (Stripe + RevenueCat) and landing page swap. Pre-deploy actions documented in checklist.

**Checklist and daily log updated to reflect true end-of-day state.**

**Open items at session close:** §3.21/§3.27, §3.50 (steps 6–7)
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 27 Jun 2026 — §3.69/§3.73/§3.74/§3.75 closed

**Three-round diagnostic session on Biden/alien Reel plus §3.74 close. §3.69, §3.73, §3.74 all confirmed. §3.75 (certainty scalar inversion) opened and closed same session — two-prompt fix.**

---

**§3.69 — CLOSED (27 Jun 2026, deployment `63384a23`):**

Three-round diagnostic to find why low-certainty evidence card note wasn't rendering despite the fix being committed. Root cause chain:

1. **Deploy 1 (`ba214653`):** Fix never executed — Railway container didn't redeploy after the 27 Jun commit. Same deployment ID confirmed across three consecutive runs.
2. **Deploy 2 (`781bc975`):** Redeployed after empty force-commit. Fix executed but note still absent. Diagnostic revealed `resemble_video_score` IS present in both `non_human` and `complete` return paths as `pillar_score_raw = 0.6005859375`. Template conditional `key === 'deepfake' && a.resemble_certainty < 0.25 && a.resemble_video_score > 0.50` evaluates true. Note still absent.
3. **Root cause:** Note conditional was inside the active (non-excluded) branch of the card-rendering callback. The Biden clip `final_score=0.0440` was causing the card to render in an `excluded`-adjacent state, bypassing the note block. Fix: moved the low-certainty conditional outside the excluded gate so it fires regardless of pillar state.
4. **Deploy 3 (`63384a23`):** Note confirmed rendering — "Low frame-detection confidence — this content may be AI-generated. Visual analysis score has been adjusted accordingly." visible in expanded deepfake card.

**§3.73 — CLOSED (27 Jun 2026, deployment `63384a23`):**

Bundled with §3.69 fix. Summary copy "Visual analysis score adjusted for low face-detection coverage." confirmed rendering at top of expanded deepfake card on Biden/alien Reel. Replaces the previous false-negative "Video analysis found no deepfake indicators" copy on certainty-suppressed scores.

**§3.75 — OPENED and CLOSED (27 Jun 2026):**

Surfaced by Extension report on Biden/alien Reel. Two-stage fix, two deployments.

**Stage 1 — scalar direction fix (deployment `15be7c1c`):** Certainty scalar formula corrected from whatever was producing `certainty=0.2012` to `min(skept_frames, resemble_frame_count) / skept_frames`. Confirmed `certainty=1.0000` in log. However `certainty_weighted_score=0.0741` persisted — exposing that the scalar was being applied to a per-frame mean, not `video_metrics.score`.

**Stage 2 — base score fix (deployment `5924057a`):** `deepfake.py` updated to use `video_metrics.score` as the base for certainty weighting, replacing the legacy per-frame average inherited from the scamai architecture. Result:
- `certainty_weighted_score=0.6006  certainty=1.0000  final_score=0.6010`
- `fusion score=0.6010  denominator=0.6000  contribution=0.3606`
- UI: **"Likely manipulated · 60%"** — Red banner. Matches Resemble's own "Deepfake Detected" verdict.

Residual 0.0004 delta (`final_score=0.6010` vs `video_metrics.score=0.6006`) is a rounding artefact in the certainty weighting path. Same band, same verdict — not actionable.

**Documents affected:** Engineers Brief v0.21 §3.2 (certainty scalar formula; base score source).

**§3.74 — CLOSED (27 Jun 2026, deployment `22f28beb`):**

Evidence card "Video suspicion score" was reading `certainty_weighted_score` (0.0741 ≈ 7%) instead of `a.score` / `final_score` (0.0440 ≈ 4%). Single-prompt fix — no diagnostic round needed as cause was confirmed during §3.69/§3.73 session. Confirmed rendering: card shows 4%, matches verdict banner exactly. Clean first-attempt close.

---

**Open items at session close:** §3.21/§3.27, §3.50 (steps 6–7)
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 27 Jun 2026 — §3.31/§3.59/§3.72 closed; §3.74 opened

**Triage session on @adsleben TikTok AR meme clip. Three items closed. One new UI bug opened.**

---

**§3.31 — CLOSED (27 Jun 2026):**

Chrome Extension screenshot on @dextergilmore66 Trump faceswap TikTok confirms "Subject detected · Donald Trump" card rendering correctly. Deployment 7ea434db log confirms full pipeline:
- `[subject_identity] hashtag_tokens=['presidentdonaldtrump', 'presidentdonaldtrump'] segmented='president donald trump president donald trump'`
- `[subject_identity] Match: NER entity 'donald trump' matched list entry 'Donald Trump'`
- Q22686 Wikidata label missing → hardcoded fallback fired correctly
- `subject_list` contains 11 entries including Donald Trump

Both the QID hardcode and wordninja hashtag pre-processing confirmed working. Closed.

**§3.59 — CLOSED (27 Jun 2026):**

Confirmed on @adsleben TikTok clip (deployment 7ea434db). Audio card displays "No speech detected — audio analysis excluded" correctly. Background music only, `video_job_audio_score=-1.0`, audio pillar excluded, denominator self-adjusted to 0.60. Fix prompt deployed; copy branching working as designed.

**§3.72 — CLOSED (27 Jun 2026):**

`video_job_audio_label` passthrough confirmed working (deployment ba214653). Label correctly forwarded from `deepfake.py` to `audio.py`. No scoring impact — logging fix only.

**§3.74 — OPENED (27 Jun 2026):**

Triage clip: @adsleben TikTok (`https://www.tiktok.com/@adsleben/video/7630822565937794326`) — "Tung Tung Tung Sahur" Italian Brainrot AR meme. Real person mock-fighting a 3D CGI character via TikTok AR effect. Resemble Intelligence: digital alteration confirmed (CGI overlay + edited music track), real_person 72%, no deepfake, no misinformation.

Results:
- Deepfake: 0.70% (`final_score=0.0070`, `certainty=0.9817`, 83 frames, label=Real)
- Audio: Excluded (sentinel -1.0, background music only, no speech)
- C2PA: not_found
- Fusion: `score=0.0070 denom=0.6000` → **0.70% Likely Authentic** (log)
- UI: verdict banner **3%**, deepfake card **3%** — **MISMATCH**

Arithmetic confirmed correct: `0.0070 × 0.60 / 0.60 = 0.0070`. Mismatch is UI-only. Source field in template needs audit — do not fix until field confirmed. Claude Code audit prompt to be produced in next session.

**Calibration note — subject identity false positive:**
`#presidentdonaldtrump` hashtag matched Trump in NER on a clip where Trump does not appear (AR meme content, private individual). Known Phase 1 NER-only limitation — no face-match gate. No action; noted for future subject identity spec iteration.

**Open items at session close:** §3.50 (steps 6–7), §3.69, §3.70, §3.74
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 26 Jun 2026 — §3.71/§3.45/§3.58 closed; audio pillar rebuild complete

**Audio pillar rebuilt on Resemble direct passthrough. No-speech exclusion confirmed. ref_53 dubbing label confirmed absent. All three immediate calibration blockers closed.**

---

**§3.71 — CLOSED (deployments 6f1086f1 → 853d7501):**

`deepfake.py` updated to store raw `aggregated_score` directly as `video_job_audio_score` — premature `(raw+1)/2` conversion removed. `audio.py` rebuilt: librosa heuristics, consistency scalar, minimum floor (0.15), and `(raw+1)/2` formula all removed. New scoring logic: `score = max(video_job_audio_score, 0.0)` for valid scores; `-1.0` sentinel → `score=None` (excluded); API error / missing field → `score=None` (excluded). No floor, no fallback anchor.

Confirmed on @randomantiks Starmer Reel (deployment 6f1086f1):
- `[deepfake] video_job_audio_score=0.010784 video_job_audio_label=real`
- `[audio] resemble score=0.010784 label=None → pillar score=0.0108`
- Fusion: `score=0.0100`, audio contribution=0.0038 (was 0.1769 before fix)
- Verdict: **1% Likely Authentic** (was 19%)
- Skept now matches Resemble dashboard exactly: Audio 1.08%, Video 1.15%.

Minor carry-forward: `label=None` in audio log — `video_job_audio_label` extracted in `deepfake.py` but not passed through to `audio.py`. No scoring impact. Logged as §3.72.

**§3.45 — CLOSED (deployment 6f1086f1, same session):**

Confirmed on @lula_sem_roteiro Trump parody TikTok (no-speech music-only clip):
- `[deepfake] video_job_audio_score=-1.000000 video_job_audio_label=real`
- `[audio] resemble sentinel -1.0 — no speech detected — pillar excluded (score=None)`
- `[fusion] score=0.1000 denominator=0.6000 pillars={'deepfake': ...}`
- Audio correctly excluded; denominator self-adjusted to 0.60; verdict 10% driven by deepfake only.
- UI shows "No speech" label correctly; 1/2 pillars active.

**§3.58 — CLOSED (deployment 853d7501, commit 23fdfe):**

Root cause confirmed via Claude Code enumeration: three ref_53 render sites existed. Site A (server-side Python `dubbing_note_html` generation) deleted entirely. Site B (JS `setNoData()`) was already correctly gated with unique ID. Site C (JS `showVerdict()` — `dubbingNoteContainer.innerHTML = job.dubbing_note_html || ''`) was unconditional — replaced with explicit client-side gate:

```js
const _dfExcluded = analysers.deepfake && analysers.deepfake.excluded_reason === 'audio_dubbing_pattern';
document.getElementById('dubbingNoteContainer').innerHTML = _dfExcluded ? '<p id="dubbingNote" ...>' : '';
```

Chrome Extension DOM audit confirmed on @randomantiks Starmer Reel (deployment 853d7501, 2/2 normal fusion, no exclusion):
- `id="dubbingNote"` — **NOT present** in DOM (`null` on getElementById and querySelector)
- `id="dubbingNoteContainer"` — present, `innerHTML = ""` (empty, correct)
- Verdict: 1% Likely Authentic, 2/2 pillars active. UI errors: None.

**§3.72 — OPENED (minor, 26 Jun 2026):**

`video_job_audio_label` correctly extracted and logged in `deepfake.py` (`video_job_audio_label=real`) but `audio.py` receives `label=None`. One-liner fix: read `video_job_audio_label` from the shared job dict in `audio.py` alongside `video_job_audio_score`. No scoring impact. Bundle with next minor fix prompt.

**Open items at session close:** §3.31, §3.50 (steps 6–7), §3.59, §3.69, §3.70, §3.72
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 26 Jun 2026 — Batch UI fixes deployed; §3.44/§3.56/§3.60/§3.62/§3.66 closed; §3.70 opened

**UI fix batch confirmed. @randomantiks Starmer triage run. Five items closed. One new calibration item opened.**

---

**Batch fix — commit 1239f7 (26 Jun 2026):**

Four-fix batch prompt (§3.56, §3.60, §3.62, §3.66) run against main.py. Claude Code audit found three already resolved in prior commits:

- **§3.56** — `!a.excluded_reason` already in pillar count filter. Already correct — closed.
- **§3.60** — `sig-audio` row already under Stage 2 heading. Already correct — closed.
- **§3.62** — Normalisation disclosure already added in prior commit 49c0fd6. Already correct — closed.
- **§3.66** — URL pre-flight block existed but logged raw URL at ERROR and returned wrong error string. Two-line fix applied: log now emits `scheme=` / `netloc=` instead of raw input; error message corrected to "Invalid URL". Committed 1239f7, pushed to main.

**@randomantiks Starmer/resignation Reel triage (deployment 2c4c36c9, 26 Jun 2026):**

URL: `https://www.instagram.com/reel/DZ5TmDsMBl9/`. Authentic Nov 2024 Downing Street press conference on immigration — reframed with false text overlays claiming resignation. Resemble Intelligence: political_manipulation 95%, real_person 100%, no digital alteration.

Deepfake: 1% (certainty=0.9770, 100 frames, label=Real). Audio: 51% (`aggregated_score=0.010784` raw → `0.5054` via `(raw+1)/2`). Fusion: 19% Likely Authentic. Verdict correct. Subject identity: Keir Starmer matched. Wikidata lazy-load confirmed (10 names). UI errors: None.

Fusion sanity check: `0.01 × 0.60 + 0.5054 × 0.35 = 0.18289 / 0.95 = 0.1925` → **19%** ✓

**§3.44 closed:** Speech clip confirmed. Audio card body text matches pillar score — no discrepancy. Close confirmed on live run.

**§3.70 — OPENED (26 Jun 2026):**

Structural calibration observation on audio `(raw+1)/2` conversion. Resemble `aggregated_score=0.010784` (raw, [-1,1]) → Skept audio pillar `0.5054` (51%). Resemble calls this "Real Audio" at 1.08%. The formula is architecturally correct for a scale where `-1.0 = definitely real` and `+1.0 = definitely fake`. However, on genuinely clean audio Resemble's aggregated_score clusters near `0.0`, not near `-1.0`. This means `(0.0 + 1) / 2 = 0.50` is the structural floor for any clean audio track — it will never approach 0% on the Skept scale unless Resemble returns a strongly negative score. In practice this inflates the audio pillar's contribution to fusion on authentic clips, suppressing the score's ability to land near 0% even when both Resemble pillars agree the content is real. The §3.62 disclosure note addresses the display confusion but not the underlying calibration gap. Requires live data across a broader clip set before determining if a formula adjustment is warranted. Note: frame confidence scalar retained — see §3.69 for rationale.

**Open items at session close:** §3.31, §3.50 (steps 6–7), §3.59, §3.69, §3.70
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 26 Jun 2026 — Complete document audit; Engineers Brief v0.20; Project Brief v0.23

**Full document audit and consolidation fold-in. Both primary briefs rebuilt.**

---

**Document audit (26 Jun 2026):**

Full audit of all project files against consolidation checklist. Identified fold-in items across Engineers Brief and Project Brief. Both rebuilt from updated source files.

**Engineers Brief v0.19 → v0.20:**

- §3.3 Audio pillar — source updated to `metrics.aggregated_score` from video job. No standalone audio API call. No-speech/no-audio-stream sentinel (`aggregated_score == -1.0`) → excluded from fusion (not neutral 0.5). Two distinct copy paths (`no_speech_detected` vs `no_audio_stream`) documented. Pillar independence caveat added (both pillars now Resemble DETECT-3B Omni; Sightengine is Phase 1 target for restoring independence). Librosa removed as scored path.
- §3.4 C2PA — stub status replaced. Resemble binary C2PA result now consumed (`not_found`/`found`/`skipped`). Phase 1 c2pa-rs manifest parsing still deferred.
- §4.2 Backend — Cloudflare production build step table added (steps 1–5 complete, 6–7 Phase 2/pending). D1 split-database architecture spec documented: `skept-auth` (users/auth_tokens/tombstones) + `skept-analysis` (analysis_history/viewed_history/quota_usage/seals), GDPR Article 17 rationale, Worker binding enforcement, email storage (email_hash + email_encrypted), retention hooks at schema level, KV namespace AUTH_SESSIONS.
- §4.5 Layer 1 caps — updated to five-tier structure: Free 5 / Lite 10 / Plus 20 / Pro 40 / Max 60.
- §4.10 Subscription — complete rewrite: five tiers (`free|lite|plus|pro|max`), corrected quota caps, analysis depth in 4s increments (Free/Lite 4s, Plus/Pro 8s, Max 12s), top-up credit pool (`topup_credits` + `topup_expires_at` on `quota_usage` table), three-step gate logic, seal gate moved to Plus+ (was Pro), downgrade scope covers Free or Lite, legal ref updated to v0.10.
- §12.5 blocked items, Appendix A, §1 overview — legal/engineers cross-refs updated to current versions.
- Header: v0.18 → v0.20, date 23 Jun → 26 Jun, related docs updated.

**Project Brief v0.22 → v0.23:**

- §5.5 Rate limiting — Layer 1 monthly caps updated to five-tier (5/10/20/40/60). Engineers brief ref updated to v0.20. Rate-limit upgrade message updated to Lite/Plus.
- §11.5 Pricing — complete rewrite. AUD currency (rate 0.690, 25 Jun 2026). Five tiers: Free/Lite/Plus/Pro/Max. New prices: Lite $19/$27.99 iOS, Plus $49/$69.99 iOS, Pro $99/$139.99 iOS, Max $199/$279.99 iOS. Analysis depth in 4s increments. Unit economics corrected: $0.11/sec (video $0.07 + audio $0.04, single Omni job — prior figures understated 57%). Gross margins: Lite 66%, Plus 48%, Pro 49%, Max 42% — all above 40% floor. Top-up packs added: Small/Medium/Large (5/10/20 runs), 90-day expiry, Max-rate pricing universal, upgrade incentive validated. Seal gate updated to Plus+. Legal/engineers refs updated.
- §16.4 Paid-tier gating — Lite row added. Seal gate corrected to Plus tier. Prices in AUD.
- §14 Phasing — Phase 2: Lite/Plus/Pro/Max activated, top-up packs live, seal launches at Plus+.
- Active legal brief body refs — updated from v0.8 to v0.10 throughout.

**Open items at session close:** §3.31, §3.44 (verify live), §3.45 (verified ✅), §3.50 (steps 6–7), §3.56, §3.59 (verified ✅), §3.60, §3.62 (fix prompt produced, deploy pending), §3.66, §3.69
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10

---

## 26 Jun 2026 — Audio diagnostic complete; §3.63 closed; §3.69 opened; §3.62 fix prompt produced

**Full audio issue diagnostic session. Five open audio items assessed via Claude Code read-only diagnostic. Three confirmed already correct (verification-gap only). One genuine fix produced (§3.62). One new calibration gap opened (§3.69) from live triage clip.**

---

**Audio diagnostic results (26 Jun 2026):**

Diagnostic prompt run against `audio.py`, `deepfake.py`, `main.py`, `fusion.py`. Results:

**§3.44 — NOT a code bug.** `a.summary` correctly reads from `audio_result["score"]` — summary % and header % are the same value (`audio.py:35–43`). Verification gap only. Close on next live run with a speech clip.

**§3.45 — NOT a code bug.** `audio.py:20–25` returns `score=None` when `video_job_audio_score=None`; does not fall through to librosa. `fusion.py:81` skips via `continue`; denominator self-adjusts. Confirmed working on today's triage clip (Biden/alien Reel — `no_speech_detected` sentinel fired, denominator collapsed to 0.60). **§3.45 verified ✅**

**§3.59 — NOT a code bug.** Template has two fully separate code paths keyed on `a.audio_exclusion_reason`: `no_audio_stream` → "No audio track — audio analysis not applicable."; `no_speech_detected` → "No speech detected — audio analysis not applicable." Code is correct. Needs live verification with one clip per sentinel. **Confirmed working on today's clip (no_speech_detected path) ✅**

**§3.62 — Genuine missing feature.** No disclosure note, tooltip, or footnote about `(raw + 1) / 2` conversion exists anywhere in the template or `SIGNAL_EXPLANATIONS`. Confirmed absent. **Fix prompt produced.**

**§3.63 — Already fixed.** `deepfake.py:252` sets `high_variance = stdev_val > 0.25`. `deepfake.py:283–293` appends a signal row when `high_variance=True`. Template renders both a signal row via `renderSignals(a.signals)` and an explicit italic note. Checklist item was stale. **§3.63 closed ✅**

---

**§3.69 — OPENED (26 Jun 2026):**

Triage clip: @ai_cre.art Area 51/Biden/alien Instagram Reel (`https://www.instagram.com/p/DZF7oahhYqx/`). Resemble job UUID: `fd95658339a40ea8fc6011da16019024`.

Resemble verdict: **Deepfake Detected**, Video 60.06% (label: Likely fake), Audio: No Valid Audio Stream (aggregated_score −1.0).
Skept verdict: **4% Likely Authentic** — verdict inversion.

Root cause: `certainty=0.2012` frame confidence scalar. Approximately 1 of 6 sampled frames returned as a valid `VideoFrameResult` node on fully synthetic (text-to-video) content. `0.6006 × 0.2012 = 0.0741` → `final_score=0.0440`. Biden likeness passes the non-human guard (61 frames, `result=pass`) but faceswap model has systematically low frame confidence on generative content because there is no real face to anchor on.

Resemble Intelligence: `synthetic_media_fraud confidence=65`, `not_real_person confidence=60`, `digital_alteration detected=True confidence=70`. Context: satirical AI-generated video — Joe Biden at Area 51 meeting an alien. Audio: synthetic sci-fi drone only, no speech. Account: @ai_cre.art explicitly self-describes as AI content creator.

Pipeline behaviour correct in isolation (scalar is working as designed; fusion arithmetic verified correct). Problem: model is being misapplied to a content class it wasn't designed for, and the scalar is punishing the aggregate-level detection that did work.

Distinct from §3.24 (face absent) and §3.26 (gender-swap faceswap false negative). This is the text-to-video synthetic content class — the correct architectural fix is Sightengine (§3.20). Interim fix: surface a low-certainty note in the evidence card when `certainty < 0.25 AND video_metrics.score > 0.50`.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 6–7), §3.56, §3.59, §3.60, §3.62, §3.66, §3.69
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 26 Jun 2026 — Stripe MCP plugin installed; business accounts live

**Stripe business accounts set up. Stripe MCP plugin installed into Claude Code via `.claude/settings.json`. Stripe secret key provisioned locally (not committed).**

---

**Stripe MCP install — COMPLETE (26 Jun 2026):**

- `.claude/settings.json` created with `npx @stripe/mcp --tools=all` MCP server entry. File is gitignored — stays local.
- `.gitignore` updated: `.claude/settings.json` added on line 4.
- `CLAUDE.md` updated: `## Stripe MCP` section added documenting that the secret key lives in `settings.json` and must never be committed.
- Committed `.gitignore` + `CLAUDE.md` only (commit 28fa00). `settings.json` correctly excluded.
- Stripe secret key (test mode) manually inserted into `.claude/settings.json` before prompt was run — not in repo.
- Publishable key intentionally excluded from MCP config — client-side only, used at Phase 2 frontend payment UI wiring (Stripe Elements / Checkout).

**CLAUDE.md update prompt produced** — to be run in Claude Code to document Stripe as Phase 2 billing provider.

---

## 25 Jun 2026 — §3.51 closed; D1 split-database schema locked; DDL produced

**D1 schema design session. Split-database architecture locked for GDPR isolation. Full DDL produced for both databases. Ready for Claude Code.**

---

**§3.51 — CLOSED (25 Jun 2026):**
Split D1 database architecture locked. `skept-auth` holds identity/session data (`users`, `auth_tokens`, `tombstones`); `skept-analysis` holds behavioural data (`analysis_history`, `viewed_history`, `quota_usage`, `seals`). Decision rationale: GDPR Article 17 erasure against analysis history cannot touch auth records; separate breach surfaces; Worker bindings enforce isolation at infrastructure level.

`viewed_history` added as a distinct table — structurally separate from `analysis_history` per legal brief §9, distinct GDPR basis, no biometric processing on the viewer's behalf.

Email stored as two representations: `email_hash` (SHA-256, lookups) and `email_encrypted` (AES-256-GCM, magic link sends). Raw email never in plaintext. Encryption key to be provisioned as Cloudflare Workers Secret before schema goes live.

Retention hooks baked in at schema level: `purge_after` columns computed at write time and indexed for daily sweep crons. Seals table has `ON DELETE RESTRICT` on `analysis_history_id` — verdict pages must remain resolvable after user history wipe.

Output: `skept_d1_schema.sql` — full DDL for both databases, ready for Claude Code.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50, §3.56, §3.58, §3.59, §3.60, §3.61, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 25 Jun 2026 — §3.50 step 5 complete; settings Worker deployed; secrets rotated

**Account settings Worker (§3.50 step 5) built, deployed, and secrets provisioned. ENCRYPTION_KEY and IP_SALT rotated across both skept-auth and skept-settings Workers.**

---

**§3.50 step 5 — COMPLETE (25 Jun 2026):**

Two files committed to Skept-prototype repo (commit 29cd32): `cloudflare/settings-worker.js`, `cloudflare/wrangler-settings.toml`.

- Five endpoints: GET/PATCH /api/settings/profile, GET /api/settings/subscription, POST /api/settings/export (JSON+CSV inline, Phase 1), DELETE /api/settings/account (full 10-step tombstone teardown).
- Deployment: Worker live at https://skept-settings.c-doust85.workers.dev (Version ID: 6e25f8bf-8881-4d2c-893e-29355e860332).
- ENCRYPTION_KEY and IP_SALT generated fresh and provisioned on both skept-auth and skept-settings Workers. Values saved to password manager. Not committed to repo.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 6–7 remaining), §3.54, §3.56, §3.58, §3.59, §3.60, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 25 Jun 2026 — §3.50 step 4 complete; history Worker built

**Analysis history Worker (§3.50 step 4) built and committed. Three routes: list (tier-gated), single delete (seal guard), full wipe (sealed entries skipped).**

---

**§3.50 step 4 — COMPLETE (25 Jun 2026):**

Two files committed: `cloudflare/history-worker.js` (158 lines), `cloudflare/wrangler-history.toml`. Commit 58288f.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 5–7 remaining), §3.54, §3.56, §3.58, §3.59, §3.60, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 25 Jun 2026 — §3.50 steps 2–3 complete; verify Worker and tier-config built

**Tier permission layer (step 2) and verify flow Worker (step 3) built and committed.**

---

**§3.50 step 2 — COMPLETE:** `cloudflare/tier-config.js` created; `cloudflare/verify-worker.js` refactored at three extraction points (commit 864099).

**§3.50 step 3 — COMPLETE:** Four files committed: `ingestion-worker.js`, `cloudflare/fusion.js`, `cloudflare/verify-worker.js`, `cloudflare/wrangler-verify.toml`. Auth required from day one. Railway thin endpoint handles yt-dlp → R2 upload. Two schema mismatch rounds resolved. analysis_history live table aligned with Worker INSERT.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 4–7), §3.54, §3.56, §3.58, §3.59, §3.60, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 25 Jun 2026 — §3.50 step 1 complete; Cloudflare auth worker deployed

**Auth layer (§3.50 step 1) built and deployed to Cloudflare. Magic link flow, KV sessions, Resend email dispatch live on workers.dev.**

---

**§3.50 step 1 — COMPLETE (25 Jun 2026):**

Three files committed: `auth-worker.js`, `wrangler-auth.toml`, `skept_d1_schema_auth.sql`.

Resources provisioned:
- D1 `skept-auth` (ID: b81343be-4703-4d26-959e-46781843d563) — 3 tables: users, auth_tokens, tombstones.
- KV `AUTH_SESSIONS` (ID: acb86bfb713e453ab616053bdbc785f8).
- Worker live at: https://skept-auth.c-doust85.workers.dev
- Secrets set: RESEND_API_KEY, ENCRYPTION_KEY, IP_SALT
- Resend domain skept.co verified (DKIM + SPF, Tokyo region). Ready to send from noreply@skept.co.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 2–7), §3.54, §3.56, §3.58, §3.59, §3.60, §3.61, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 25 Jun 2026 — §3.58 regression closed; §3.61/§3.64/§3.65/§3.67 closed

**Batch closures from triage and fix session.**

---

**§3.58 — CLOSED (deployment 9fc55695):**
Targeted prompt requiring conditional render (not CSS toggle) landed correctly. "UI errors: None" on Trump/Colbert face-swap clip (deepfake=0.817, audio=0.9943, denominator=0.95, 2/2 normal fusion). ref_53 absent from DOM. Fix required five attempts — root cause was CSS visibility toggle + second unconditional render site for "Insufficient signal" message.

**§3.61 — CLOSED (deployment db9e8a26):**
`[c2pa] resemble_c2pa_input=None → status=not_found` fires correctly. c2pa.py reads `resemble_c2pa` from job result and maps `None → not_found`. Early `[pipeline] c2pa written to job: skipped` log line is the pre-Resemble write — expected, not a bug.

**§3.64 — CLOSED (deployment aa0653f5):**
`[subject_list] Wikidata fetch OK — 10 names loaded (lazy)` fires on first job. No startup timeout. No double-emit.

**§3.65 — CLOSED (deployment 8985a8ff):**
502 error banner fix confirmed. Verdict card no longer hidden on completed jobs when prior polling error occurred.

**§3.67 — CLOSED (25 Jun 2026):**
Two white vertical tick marks (`.zone-divider`) removed from confidence meter. Zone labels already communicate threshold boundaries; tick marks were redundant and visually misread as being positioned at 30%/60%.

**§3.66 — OPENED:**
Task description string accidentally submitted as URL; reached ingest layer. yt-dlp rejected correctly but input was logged verbatim at ERROR severity. `urllib.parse.urlparse()` pre-flight check required in `/api/analyse` before yt-dlp call.

**Triage clip — Trump/Colbert face-swap (df_sampled.mp4, file upload):**
Deepfake: 82%, Audio: 99%, Fusion: 88% Likely Manipulated. Resemble: Video 99.61%, Audio 98.86%, Deepfake Detected. C2PA not found. Resemble Intelligence: face-swap, Trump likeness on Colbert body, blending anomalies at neck/jawline/hairline, audio splicing. Misinformation note: posted by Donald Trump on social media May 2026 to mock Stephen Colbert following final broadcast of The Late Show — footage entirely fabricated.

**Open items at session close:** §3.31, §3.44, §3.45, §3.50 (steps 2–7), §3.54, §3.56, §3.58, §3.59, §3.60, §3.62, §3.63, §3.66
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 24 Jun 2026 — §3.58 closed; §3.64 opened; Batch 1 partial confirmation

**Targeted §3.58 fix confirmed. New Wikidata startup issue logged. Batch 1 items partially verified.**

---

**§3.58 — CLOSED (deployment 9fc55695):**
Targeted prompt requiring conditional render (not CSS toggle) landed correctly. "UI errors: None" on Trump/Colbert face-swap clip (2/2 normal fusion). ref_53 absent from DOM.

**§3.64 — OPENED:**
Wikidata startup timeout on deployment 9fc55695 cold start. `query.wikidata.org` read timeout (10s) fired, emitting error log twice (two separate callers). Subject identity ran silent for entire deployment. Fix: lazy-load on first job.

**Open items at session close:** §3.31, §3.44, §3.45, §3.48, §3.49, §3.50, §3.54, §3.56, §3.59, §3.60, §3.61, §3.62, §3.63, §3.64
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 24 Jun 2026 — §3.56/§3.58/§3.59/§3.60/§3.61 prompts produced; §3.62/§3.63 opened

**Triage session. Five Claude Code prompts produced. Two new items opened.**

---

**Triage clips:**

*@jackohvids Starmer/recorder TikTok (deployment 3ef117ab):*
Keir Starmer resignation audio looped + Trump recorder overlay. Authentic footage, audio splice + instrument overlay. Deepfake: 4.2% (certainty=0.8112, 100 frames). Audio: 52.29% (video_job_omni). Fusion: 22% Likely Authentic. Verdict correct. Calibration note: Resemble dashboard Audio 4.58% vs Skept Audio 52% — same field, different representations (`(raw+1)/2` conversion).

*@realdonaldtrump belly dancer TikTok (deployment c7bc3174):*
Trump face-swap onto belly dancer body, Arabic music overlay. Confirmed synthetic media. Deepfake: 81.7% (certainty=0.9922, 100 frames, label=Fake). Audio: 99.43% (video_job_omni). Fusion: 88% Likely Manipulated. Verdict correct. Resemble Intelligence: synthetic_media_fraud 95%, not_real_person 95%.

**§3.62 — OPENED:** Audio score shown in Skept UI (52%) diverges from Resemble dashboard Audio Score (4.58%) — `(raw+1)/2` conversion not explained to user.
**§3.63 — OPENED:** `high_variance=true` flag not surfaced in evidence card. (Confirmed already fixed 26 Jun 2026 — checklist item stale.)

**Open items at session close:** §3.31, §3.44, §3.45, §3.48, §3.49, §3.50, §3.54, §3.56, §3.59, §3.60, §3.61, §3.62, §3.63, §3.64
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 24 Jun 2026 — §3.51–§3.57 batch; §3.57 audio pillar switched to video_job_omni; API cost halved

**Full triage and fix session. §3.51 audio_dubbing_pattern fusion fix confirmed. §3.52–§3.55 closed. §3.56–§3.59 opened. API cost halved.**

---

**§3.51 — CLOSED (deployment 9e7dd95d):** `audio_dubbing_pattern` exclusion gates fusion correctly. Denominator collapses to 0.35.
**§3.52 — CLOSED:** Temp file cleanup confirmed.
**§3.53 — CLOSED:** Pillar score display in evidence card confirmed correct.
**§3.54 — Carried forward:** File upload progress state — no prompt deployed.
**§3.55 — CLOSED:** Duplicate Resemble submissions resolved.
**§3.57 — CLOSED (deployment e9ef55a7):** Standalone audio.wav Resemble call removed. Audio pillar now sourced from `video_job_audio_score`. Cost halved. CLAUDE.md updated with pillar independence caveat.

**Open items at session close:** §3.31, §3.44, §3.45, §3.48, §3.49, §3.50, §3.54, §3.56, §3.58, §3.59
**Baseline:** Project Brief v0.22, Engineers Brief v0.19, Legal Brief v0.10

---

## 27 Jun 2026 — §3.72 closed; §3.69 fix incomplete; §3.73 opened

**§3.72 audio label passthrough confirmed closed. §3.69 low-certainty evidence card note partially deployed — render blocked by missing field on non_human return path. New issue opened: §3.73 deepfake summary copy false negative on suppressed scores.**

---

**§3.72 — CLOSED (27 Jun 2026):**

`video_job_audio_label` passthrough fix confirmed on Biden/alien Reel (deployment ba214653). Log confirms:

- `[deepfake] video_job_audio_score=-1.000000 video_job_audio_label=real`
- `[audio] resemble sentinel -1.0 — no speech detected — pillar excluded (score=None)`

`label=None` absent from audio log. Label now correctly forwarded from shared job dict in `audio.py`. No scoring impact — logging fix only. Closed.

---

**§3.69 — PARTIALLY DEPLOYED, render still failing (27 Jun 2026):**

Two-round diagnosis completed. Fix prompt added `resemble_video_score` to `non_human` return dict in `deepfake.py` — confirmed as the missing field via diagnostic (field absent from `non_human` path; present on `complete` path only). Template conditional is correctly written and evaluates true on the Biden/alien clip values (certainty=0.2012 < 0.25, resemble_video_score=0.6006 > 0.50). Fix committed and deployed.

Post-fix triage run on Biden/alien Reel: deployment ID `ba214653` — same ID as pre-fix run. Evidence card expanded: low-certainty note still absent. Most likely cause: Railway container did not redeploy after commit. Deployment ID must be verified at next session start.

**Action:** Confirm new deployment ID on next session. If same, trigger manual redeploy. If new and note still absent, third diagnostic pass required.

---

**§3.73 — OPENED (27 Jun 2026):**

**Status:** 🔴 Open — UI copy bug, bundle with §3.69 fix

**Source:** Biden/alien Reel triage, 27 Jun 2026.

Deepfake evidence card summary reads "Video analysis found no deepfake indicators (7% suspicion score)" on a clip where Resemble returned `video_metrics.label=Likely fake` at 60.06%. Summary is generated from `final_score=0.044` (post certainty-scalar), not from the raw Resemble score. On normal high-certainty clips these track closely. On text-to-video content with low certainty scalars they diverge significantly and the summary becomes a false negative.

**Fix:** Summary copy should gate on `video_metrics.label` (Resemble's native verdict string) rather than deriving a statement from `final_score` alone. When `resemble_video_score > 0.50` and `final_score < 0.15`, summary must not assert "no deepfake indicators." Bundle with §3.69 prompt once deployment issue is resolved.

**Documents affected:** Engineers Brief §4.6 (verdict display spec — evidence card summary copy). Fold into v0.21.

---

**Open items at session close:** §3.31, §3.50 (steps 6–7), §3.59, §3.69, §3.70, §3.73
**Baseline:** Project Brief v0.23, Engineers Brief v0.20, Legal Brief v0.10
