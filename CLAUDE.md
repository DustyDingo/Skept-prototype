# CLAUDE.md — Skept Prototype

This file provides persistent context for Claude Code sessions on the Skept prototype repo.
Read this fully before acting on any task.

---

## Project Overview

**Skept** is a consumer video verification platform for detecting AI-generated and manipulated
short-form social media content. The primary audience is casual social media scrollers who
encounter viral clips and want a practical, accessible way to assess authenticity before sharing.

**Current state:** Prototype v0.1 is live at `skept-prototype-production.up.railway.app`

**GitHub:** `DustyDingo/Skept-prototype`
**Hosting:** Railway (`wholesome-truth` project)
**Landing page:** `skept.co` (Cloudflare Pages)

---

## Stack

- **Backend:** FastAPI (Python)
- **Video ingestion:** yt-dlp
- **Metadata analysis:** ffprobe
- **GPU scoring:** Resemble AI DETECT-3B Omni (single video job per clip — deepfake score and embedded audio score both derived from the same job)
- **Frontend:** Embedded HTML/CSS/JS string inside `main.py` — do NOT edit `frontend/index.html`
- **Job store:** In-memory dict (`jobs: dict[str, JobStatus]`) — stateless, no DB
- **Deployment:** Railway via GitHub push to main

---

## Running the App

### Bare-metal (development)
```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

### Docker
```bash
docker build -t skept-prototype .
docker run -p 8000:8000 --env-file .env skept-prototype
```

App served at `http://localhost:8000`. No separate frontend build step.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `HF_TOKEN` | Optional | HuggingFace API token — not currently used for active scoring |
| `SKEPT_FRAMES` | Optional | Frames sampled per video (default: 6) |
| `REPLICATE_API_TOKEN` | Required | Deepfake frame scoring active; audio pillar will use same token once implemented |
| `RESEMBLE_API_TOKEN` | Required | Audio voice clone classifier (Resemble AI); falls back to librosa heuristics if missing or 402 |
| `INSTAGRAM_COOKIES_B64` | Optional | Base64-encoded Netscape cookie file; decoded to NamedTemporaryFile at startup for Instagram ingestion |

---

## Analysis Pipeline Architecture

User submits URL → backend creates `job_id` → frontend polls `/api/status/{job_id}` every 2–3s
→ pipeline runs stages in sequence:

**Input validation (§3.66, 25 Jun 2026):** `urllib.parse.urlparse()` checks scheme (http/https) and netloc before dispatching to yt-dlp. Invalid input returns HTTP 400.

### Stage 1 — Metadata (CPU, fast)
`analysers/metadata.py` — uses ffprobe to extract forensic signals:
- Camera/encoder metadata (capped at 0.5 for platform-reencoded sources)
- Codec
- Resolution
- Frame rate (23.976 and 29.97 fps treated as standard NTSC rates)
- Audio track presence
- Container format

Score uses soft ceiling of 0.65 — metadata alone cannot return a fully manipulated verdict.

### Stage 2 — Deepfake Detection (Resemble AI)
`analysers/deepfake.py` — submits video to Resemble AI DETECT-3B Omni video endpoint.
Returns `video_metrics` with top-level `score`, `certainty`, and `children` (VideoChunkResult nodes, each containing ImageResult children).

**Frame count fields (§3.48):**
- `resemble_frame_count` — count of ImageResult nodes Resemble returns from its internal analysis of the submitted clip. Reflects Resemble's own sub-sampling; typically much larger than `SKEPT_FRAMES` (e.g. 100 ImageResult nodes from a 12s clip vs 6 frames Skept requested). Logged as `resemble_frame_count=` alongside `skept_frames=` in every deepfake log line.
- `skept_frames` — the `SKEPT_FRAMES` env var value (default 6). Controls Skept's video sampling strategy; not a scoring input.
- `frame_confidence` in result dict — informational only: `resemble_frame_count / SKEPT_FRAMES`. **Not used in fusion or scoring.** This ratio is a legacy field and is meaningless at runtime (e.g. 100/6 ≈ 16.7); it does not feed the verdict. The actual scoring scalar is `video_metrics.certainty` from the Resemble response (see Step 2 below).

**Scoring model (§3.36, 22 Jun 2026):**
- Step 1 — Certainty-weighted frame mean: `Σ(frame_score × frame_certainty) / Σ(frame_certainty)` across all ImageResult nodes. Per-frame `ImageResult.certainty` is used as a weight — frames Resemble is more confident about contribute more to the mean. This is implemented as Option B (§3.36).
- Step 2 — Top-level certainty scalar: `frame_weighted_mean × (0.5 + video_metrics.certainty × 0.5)`. `video_metrics.certainty` is a top-level sub-1.0 float from the Resemble response (e.g. 0.9922) reflecting overall job confidence. Applied as a dampening scalar in range [0.5, 1.0] — never inflates the score above the weighted mean.
- Fallback: if `Σ(frame_certainty) == 0` or no valid frames, use `video_metrics.score` directly; logs `frame_certainty_fallback=True`
- Low-coverage guard: `resemble_frame_count < 2` → `status=low_coverage`, `score=None`, excluded from fusion

`high_variance=True` when `stdev(frame_scores) > 0.25` — indicates split-screen or multi-subject
content where the model may be firing on scene cuts rather than actual manipulation.
Surfaces a caution note in the evidence card when fired.

### Stage 3 — Source Reputation
`analysers/source_reputation.py` — account behavioural signals.
For Instagram, account-page fetch is bypassed when `ydl_info` is present (avoids 429s).
Falls back to username digit-ratio only; returns `low_sample=True`; UI shows "low confidence" badge.

**Strategically critical:** Platform re-encoding strips artifact metadata; behavioural signals
survive. Source reputation is the most durable detection layer at scale.

### Stage 4 — Source Behaviour & Bio
`analysers/source_behaviour.py` — bio cross-platform link check and cadence signals.
Bio link aggregator URLs detected but not resolved to individual platform URLs.
Returns exactly 0.50 when no actionable signal found — contributes no directional information.

### Stage 5 — Audio & Voice Clone
`analysers/audio.py` — single-source scoring model (§3.57, 24 Jun 2026):
- **Source:** DETECT-3B Omni video-job embedded audio stream. `video_job_audio_score` is extracted by `deepfake.py` from `item.metrics.aggregated_score` in the Resemble video job response, with `(raw + 1.0) / 2.0` conversion applied to produce a [0.0, 1.0] suspicion scale. `audio.py` receives this value after `run_deepfake()` completes and wraps it as the pillar result — no separate API call.
- **Removed (§3.57):** Standalone audio.wav Resemble API call, librosa heuristics (pitch variance, spectral flatness, ZCR variance), consistency scalar, §3.42 audio-dub cross-compare logic.
- **No-speech exclusion:** `aggregated_score == -1.0` is mapped to `None` in `deepfake.py`. When `video_job_audio_score is None`, `audio.py` returns `score=None` (`resemble_status=no_speech_both`), excluding the pillar from fusion. UI shows "No speech detected — voice clone analysis not applicable."
- **Pillar independence note:** Audio and deepfake pillars are now both derived from the same Resemble DETECT-3B Omni video job. They are no longer statistically independent signals. This reduces effective signal diversity but eliminates a redundant API call and the §3.42 cross-compare latency.
- Weight: 0.35 (§3.33). Fusion denominator max: 0.95 (deepfake + audio).
- Log: `[audio] pillar_score={value:.4f} source=video_job_omni`

**Observability (§3.28 resolved):** `audio.py` now logs librosa sub-scores (pitch variance, spectral flatness, ZCR variance) when the fallback path fires. `fusion.py` now logs score, denominator, and per-pillar weighted contributions for every job.

### Stage 6 — Subject Identity (Phase 1, NLP)
`analysers/subject_identity.py` — spaCy NER on video metadata, cross-referenced against Wikidata list.
- **Startup fetch:** `analysers/subject_list.py` queries Wikidata SPARQL at startup for current heads of state/government (AU/US/UK/EU) and major party leaders. Stored as module-level `SUBJECT_LIST: list[str]`. Degrades to empty list on failure — subject identity runs silent, not as error.
- **Hashtag pre-processing:** `#hashtag` tokens extracted from metadata, stripped of `#`, segmented via `wordninja.split()` before NER. Required for TikTok content where subject names appear only in hashtags (e.g. `#presidentdonaldtrump` → `['president', 'donald', 'trump']`).
- **NER:** spaCy `en_core_web_sm`. PERSON entities cross-referenced against SUBJECT_LIST via case-insensitive substring match (both directions).
- **Output:** `subject_identity` key on top-level job result dict — always present. `matched: bool`, `matched_name: str | None`, `ner_entities: list[str]`, `source: "metadata_nlp"`.
- **Score contribution:** Flag only — not a fusion input, not in denominator.
- **Evidence card:** Standalone silent row — renders amber/caution when `matched=True`, hidden when `matched=False`.

**Observability (§3.29/§3.31 resolved):** `subject_list.py` now prints Wikidata fetch OK/FAILED with name count at startup. `subject_identity.py` emits two log lines per call: `[subject_identity] hashtag_tokens=[...] segmented='...'` (fires when hashtags present, before NER); `[subject_identity] list_size=... ner_entities=... matched=...` (fires at every return point). Both are permanent production log lines (25 Jun 2026).

### Fusion Layer
`analysers/fusion.py` — fixed weighted ensemble (§3.33, 22 Jun 2026):

**Verdict pillars (in denominator):**
- Deepfake weight: 0.60 (Resemble AI DETECT-3B Omni video endpoint)
- Audio weight: 0.35 (Resemble AI voice clone classifier primary; librosa heuristics fallback)
- C2PA weight: 0.40 (reserved — stub returns `score: None`, excluded from denominator)

**Source Details pillars (excluded from denominator — evidence card only):**
- Metadata: runs every job, shown in Source Details section, not a verdict input
- Source reputation: runs every job, shown in Source Details section, not a verdict input
- Source behaviour: runs every job, shown in Source Details section, not a verdict input

Max active denominator (C2PA always None): 0.60+0.35 = 0.95

Pillars returning `score: None` are excluded from the weighted denominator entirely.
Denominator self-adjusts: if a verdict pillar returns None, remaining weights normalise to 1.0.

**Verdict bands:**
- Green 0.0–0.30 → "Likely authentic"
- Amber 0.30–0.60 → "Inconclusive"
- Red 0.60–1.0 → "Likely manipulated"

---

## Signal Architecture — current pillar status

| Pillar | Status | Notes |
|---|---|---|
| Metadata & container forensics | ✅ Active (Source Details only) | §3.33: excluded from fusion denominator. Shown in Source Details evidence section. §3.30: authentic-leaning branches clamped to 0.5. |
| Source reputation | ✅ Active (Source Details only) | §3.33: excluded from fusion denominator. Shown in Source Details section. Instagram: 1/5 signals; low-confidence badge shown. |
| Source behaviour & bio | ✅ Active (Source Details only) | §3.33: excluded from fusion denominator. Shown in Source Details section. Bio link check only. |
| C2PA provenance | ⏭ Stub | `score: None`, excluded from denominator — Phase 1. |
| Frame-level deepfake | ✅ Active | §3.33: Resemble AI DETECT-3B Omni video endpoint; weight 0.60. Certainty-weighted mean across Resemble's ImageResult nodes (`resemble_frame_count`); top-level `video_metrics.certainty` applied as scalar. Non-human guard: ≤1 ImageResult node → `status=non_human`, `score=None`. Low coverage: <2 ImageResult nodes → `status=low_coverage`, `score=None`. |
| Audio & voice clone | ✅ Active | §3.57: weight 0.35. Score sourced directly from DETECT-3B Omni video-job embedded audio stream (`video_job_audio_score`). Standalone audio.wav call and librosa heuristics removed. Audio and deepfake pillars now share the same Resemble job (reduced pillar independence). |
| Pixel-level forensics | ⏳ Not wired | Backlog |

**Active fusion pillars: 2/7 (deepfake + audio). Source Details pillars: 3 (metadata, source_rep, source_beh). C2PA stub: 1. Not wired: 1.**

---

## Known Calibration Gaps

These are not bugs — they are pillars operating correctly at partial capacity pending
further implementation or data access.

| Gap | Detail | Path forward |
|---|---|---|
| Source reputation depth (Instagram) | Only username digit-ratio fires; account-page bypassed to avoid 429s | Explore `--flat-playlist` on account URL for cadence signals |
| Bio link resolution | Aggregator URLs detected but not resolved to individual platforms | Decide resolution depth; check if yt-dlp `info_dict` exposes bio URL |
| Audio heuristic calibration | Pitch/flatness/ZCR thresholds are hand-tuned; no ground-truth validation yet | Calibrate against known TTS samples once live on real clips |
| Frame sampler scene-blind | Uniform sampling misses cut-points; split-screen reels produce high-variance sets | Phase 1: ffmpeg `select='gt(scene,0.4)'` scene-change sampler |
| C2PA | Stub by design; weight reserved | Phase 1: c2pa-rs implementation |
| Deepfake — non-human content | Faceswap model has no meaningful signal on animal-subject content; low `resemble_frame_count` (≤1 ImageResult node) triggers `status=non_human` correctly but evidence card does not communicate the limitation | Phase 1: content-type guard — if ≤1 frame scores a human face, set `content_type: non_human` and render pillar as "no human face detected — result not meaningful" |
| Audio — Resemble fallback | `RESEMBLE_API_TOKEN` missing from Railway Variables causes librosa-only path; minimum floor 0.15 clamps result | Add RESEMBLE_API_TOKEN to Railway Variables |
| Deepfake — per-frame latency | ✅ Resolved — concurrent submission via asyncio.gather() (18 Jun 2026). Total Stage 2 time ~40s vs ~156s sequential. Cold-start absorbed once across batch. | — |
| §3.32 — Deepfake under-detection on TikTok-compressed faceswap (19 Jun 2026) | @dextergilmore66 Trump faceswap clip returns 28% (Likely Authentic) despite visually obvious body-replacement composite. All three scored frames returned sub-50% probabilities (peak 41%). Likely cause: TikTok re-encoding degrades splice artefacts below detection threshold. Open calibration gap — track before Phase 1/TestFlight. | Mitigations under consideration: increase SKEPT_FRAMES, bias sampling toward first 30–40% of clip, evaluate alternative models. |
| §3.24 — Non-human content guard | ✅ Resolved (19 Jun 2026) — All-no-face runs now return `status=no_face`, `score=None`, excluded from fusion. Confirmed working on @nuggetonbeat dog clip. Content-type guard for partial no-face runs (human subject but rear-facing frames) remains a Phase 1 item. | — |

---

## Known Blockers

| Blocker | Detail | Fix |
|---|---|---|
| YouTube ingestion | Bot detection blocks yt-dlp on some clips | Phase A workaround: `--extractor-args "youtube:player_client=android"`; Phase B: bgutil PO token plugin + residential proxy |
| Audio/fusion logging | ✅ Resolved — per-job [audio] librosa sub-scores and [fusion] score/denominator/per-pillar breakdown now emitted to Railway logs (18 Jun 2026, §3.28). | — |
| §3.31 — Subject identity wordninja + observability | ✅ Resolved (25 Jun 2026) — wordninja hashtag pre-processing live in `detect_subject()`; per-call NER log confirmed. | — |
| §3.39 — Frame count display bug (UI) | ✅ Resolved (23 Jun 2026, commit 00d167f) — label now reads "N frames sampled · M scored by Resemble". | — |
| §3.40 — Asymmetric exclusion transparency gap (UI) | ✅ Resolved (23 Jun 2026, commit 96216af) — evidence card shows "Excluded from verdict" with explanation; dubbing note rendered below meter. | — |
| §3.42 — Audio-dub false negative | ✅ Superseded (§3.57, 24 Jun 2026) — audio pillar now sourced directly from video-job Omni embedded audio score; audio.wav call and §3.42 cross-compare logic removed from main.py. | — |
| §3.43 — Pillar active count included non-fusion pillars (UI) | ✅ Resolved (23 Jun 2026, commit 8dcf7e7) — `TOTAL_PILLARS` changed from 7 to 2; `activePillars` now counts only deepfake/audio/c2pa with non-null score. Display reads "2/2 pillars active". | — |
| §3.45 — Audio pillar fusion inflation on no-speech clips | ✅ Superseded (§3.57, 24 Jun 2026) — `video_job_audio_score == None` (mapped from -1.0 sentinel in deepfake.py) directly excludes the audio pillar; no-speech returns `score=None`, `resemble_status=no_speech_both`. | — |

---

## Key Design Decisions (do not reverse without discussion)

1. **Frontend embedded in `main.py`** — avoids Docker volume path issues.
   Edit there, NOT in `frontend/index.html` (which is stale).

2. **Stateless job store** — in-memory dict. Intentional at prototype stage. Phase 1 requires
   persistent job queue (Temporal is the current lean).

3. **C2PA slot reserved** — weight ~0.40 reserved but excluded from denominator while stub.
   Do not remove the slot.

4. **No test suite** — prototype velocity takes priority. Don't add tests without discussion.

5. **50-anchored scoring** — 0.5 = neutral/no information throughout. Below 0.5 = evidence of
   authenticity; above 0.5 = evidence of manipulation. Metadata soft ceiling 0.65.

6. **Resemble AI for both audio and video** (§3.33/§3.57) — Resemble DETECT-3B Omni
   used for both verdict pillars via the same `RESEMBLE_API_TOKEN`. A single video job
   (`POST /api/v2/detect`, file upload) returns both the deepfake score (`video_metrics.score`)
   and the embedded audio score (`item.metrics.aggregated_score`, converted: `(raw+1)/2`).
   The standalone audio.wav call was removed in §3.57 — audio and deepfake pillars now share
   the same Resemble job and are not statistically independent. Replicate is no longer used.

7. **§3.30 Scoring principle** (19 Jun 2026) — A pillar score may only move below 0.5
   (toward authentic) if the analyser found positive evidence of authenticity. Absence of
   a manipulation signal is not evidence of authenticity. Two failure modes corrected:
   (1) insufficient data → score: None, excluded from fusion denominator; (2) full run,
   no suspicious signal, no positive authentic verification mechanism → score: 0.5 neutral.
   Applies to all pillars. Four valid pillar states:
     score > 0.5  — suspicious signal detected
     score = 0.5  — ran fully; nothing suspicious; no positive authentic verification
     score < 0.5  — positive authentic signal (earned, not default)
     score = None — insufficient data or unavailable; excluded from denominator

8. **§3.33 Fusion weights** (22 Jun 2026) — Verdict pillars: deepfake 0.60, audio 0.35,
   c2pa ~0.40 reserved (stub, always None → excluded). Active denominator max: 0.95.
   Source Details pillars (metadata, source_rep, source_beh) run on every job but are
   excluded from the fusion denominator — they feed the evidence card only. This reflects
   that platform re-encoding destroys artifact metadata and behavioural signals are
   too thin at prototype scale to carry verdict weight.

9. **Self-adjusting denominator** — if a verdict pillar returns `score=None` (e.g. deepfake
   returns `status=no_face`), its weight is excluded from the denominator entirely. The
   remaining active pillars normalise to 1.0 automatically. No fixed denominator assumption.

10. **Source Details section** — metadata, source_rep, and source_beh display in a separate
    "Source Details" section on the verdict page, clearly labelled "Contextual signals —
    not verdict-determining". They do not affect the confidence meter or verdict band.

11. **Asymmetric fusion exclusion** (§3.37, 22 Jun 2026) — when `audio_dubbing_pattern` fires
    (audio score > 0.65 and deepfake score < 0.40), the deepfake pillar is excluded from the
    fusion denominator to prevent an authentic-leaning video score from diluting a strong audio
    manipulation signal. Both UI gaps resolved 23 Jun 2026:
    - **§3.39** ✅: frame count label corrected to "N frames sampled · M scored by Resemble" (commit 00d167f).
    - **§3.40** ✅: evidence card shows "Excluded from verdict"; explanation text in expanded state; dubbing note below meter (commit 96216af).

---

## Deployment

### Railway (production)
- Push to `main` triggers automatic redeploy
- Project: `wholesome-truth`
- URL: `skept-prototype-production.up.railway.app`
- Environment variables set in Railway dashboard

### Cloudflare (landing page)
- `skept.co` served from Cloudflare Pages
- Waitlist worker: `skept-waitlist` at `skept.co/api/waitlist*`
- KV namespace: `WAITLIST` (ID: `18cd94f511f047b7a220d6125f4987ea`)
- Deploy: `npx wrangler deploy` from Deployment-Skept folder
- KV listing requires `--remote` flag in wrangler 4.x

---

## Roadmap (near-term priorities)

1. **Logging instrumentation** — ✅ complete — [audio], [fusion], and [subject_identity] per-job log lines all resolved (§3.28 closed 18 Jun 2026, §3.29 closed 18 Jun 2026)
2. **§3.30 scoring principle** — ✅ complete — all six phases landed 19 Jun 2026 (deploy 6912d75f): metadata authentic-lean clamp, source_rep low_sample clamp, audio librosa-fallback neutralise + 0.15 floor removed, deepfake 0.75 floor removed, fusion denominator exclusion for None scores confirmed
3. **§3.24 content-type guard** — ✅ complete — all-no-face runs return `status=no_face`, `score=None`, excluded from fusion (deploy 6912d75f); confirmed on @nuggetonbeat dog clip
4. **§3.39/§3.40/§3.43 UI fixes** — ✅ complete (23 Jun 2026) — frame count label corrected; asymmetric exclusion surfaced in evidence card and meter; pillar active count restricted to fusion pillars (2/2)
5. **§3.57 audio pillar simplification** — ✅ complete (24 Jun 2026) — audio pillar now sourced directly from video-job Omni embedded audio score; standalone audio.wav call, librosa heuristics, consistency scalar, and §3.42/§3.45 cross-compare logic removed
6. **§3.32 deepfake calibration gap** — 🔴 OPEN — TikTok-compressed faceswap under-detection; @dextergilmore66 Trump clip returns 28% despite visible body-replacement. Track before Phase 1/TestFlight.
7. **§3.31 subject identity observability** — ✅ complete (25 Jun 2026) — wordninja hashtag pre-processing live in `detect_subject()`; per-call NER log confirmed
2. **Synthetic generation detector** — new independent pillar for Kling/Sora/Runway-generated content (§3.20); Replicate scouting complete — no Replicate model available; Sightengine API is best current option
3. **curl-cffi / TikTok reliability** — ✅ done; curl-cffi added to requirements.txt for TLS fingerprint impersonation
4. **Reverse video search** — detect re-uploads and source misattribution via reverse image/video lookup
5. **YouTube ingestion fix** — Phase B production solution (bgutil PO token + proxy)
6. **Scene-change-aware frame sampler** — replace uniform interval with ffmpeg scene-detection
7. **Source reputation signal depth** — explore `--flat-playlist` for Instagram cadence signals
8. **C2PA manifest integration** — Phase 1 watermarking bridge standard (c2pa-rs)
9. **Share sheet registration** — iOS Share Extension + Android intent filter

---

## Product Context

- **Primary user:** Casual scroller encountering a viral clip in their feed
- **Core loop:** User sees clip → opens Skept → submits URL or shares via share sheet →
  gets verdict → seal attached to their repost (paid tier)
- **Trust seal:** Public verdict page (`skept.app/v/[id]`) allows seal verification.
  Seal value defended by making Skept widely used, not by making reposting difficult.
- **Pricing model:** Free tier (verify only) / Pro ($4.99 web / $7.99 iOS) / Max ($19.99 web / $27.99 iOS)
- **Auth:** Passwordless magic link; Google and Apple OAuth (Phase 2); anonymous-first
- **Not labelled as "AI" in marketing** — use verification language only

---

## Brand & Design Tokens

| Token | Value | Usage |
|---|---|---|
| AMBER | `#DFB87B` | Primary brand colour |
| INK | `#1A1A1A` | Primary text |
| GRAY | `#4A4A4A` | Secondary text |
| SOFT | `#8A8A8A` | Tertiary / captions |
| CREAM | `#FAF8F5` | Warm white |
| AMBER_LIGHT | `#F5E6C8` | Light amber fills |

Display font (wordmark only): Palatino Linotype
Body font: Calibri

---

## Document Suite (managed separately from this repo)

| Document | Version | Purpose |
|---|---|---|
| Project Brief | v0.19 | Master product spec |
| Engineers Brief | v0.13 | Architecture and build specs |
| Legal Brief | v0.8 | Attorney reference |
| Trademark Clearance Brief | v0.3 | Filing strategy |

Cross-references and brief updates managed through `v19-consolidation-checklist.md`.
Next Engineers Brief target: v0.14 (§3.24 non-human content guard; §3.25 latency resolved; §3.26 faceswap false negative; §3.28/§3.29 logging resolved; §3.21/§3.27 subject identity + hashtag fix — see consolidation checklist).

---

## Working Style

- Charlie (founder) holds all accounts: Railway, Cloudflare, Apple Developer, Replicate
- Charlie runs terminal commands; Claude Code handles code changes and git operations
- Cheap-first execution: validate empirically before over-engineering
- Irreversible decisions (architecture, compliance, data retention) prioritised over reversible ones
- GDPR-standard data architecture from day one
- Biometric non-retention: facial and voice features discarded after each detection decision
