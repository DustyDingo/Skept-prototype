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
- **GPU scoring:** Replicate (active — `scamai/deepfake-faceswap-detection`, concurrent frame scoring (asyncio.gather))
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

### Stage 1 — Metadata (CPU, fast)
`analysers/metadata.py` — uses ffprobe to extract forensic signals:
- Camera/encoder metadata (capped at 0.5 for platform-reencoded sources)
- Codec
- Resolution
- Frame rate (23.976 and 29.97 fps treated as standard NTSC rates)
- Audio track presence
- Container format

Score uses soft ceiling of 0.65 — metadata alone cannot return a fully manipulated verdict.

### Stage 2 — Deepfake Detection (Replicate)
`analysers/deepfake.py` — extracts N evenly-spaced frames, submits all frames to Replicate concurrently via asyncio.gather().
Returns mean, peak, high-confidence frame count, and `high_variance` flag.
Frame confidence scalar applied before score exits analyser: `frame_confidence = len(valid_scores) / total_frames_sampled`. Pillar score multiplied by scalar — prevents a single high-probability frame carrying full fusion weight. `frame_confidence` included in returned dict. For non-human-subject content (e.g. animal videos), scalar will suppress score toward authentic because the faceswap model rarely detects human faces in animal-subject frames — expected behaviour; Phase 1 content-type guard queued.

`high_variance=True` when `stdev(frame_scores) > 0.25` — indicates split-screen or multi-subject
content where the faceswap model may be firing on scene cuts rather than actual manipulation.
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
`analysers/audio.py` — two-path scoring model:
- **Primary path:** Resemble AI voice clone classifier via `RESEMBLE_API_TOKEN`. Raw score converted: `suspicion = (raw + 1.0) / 2.0`. Sub-scores and final pillar score clamped to [0.0, 1.0]. Minimum composite floor: 0.15 (prevents audio zeroing the pillar on definitively-real content).
- **Fallback path:** librosa heuristics (pitch variance, spectral flatness, ZCR variance) when Resemble unavailable or returns 402.
- Weight: 0.20. Fusion denominator: 0.98 (C2PA excluded).

**Observability (§3.28 resolved):** `audio.py` now logs librosa sub-scores (pitch variance, spectral flatness, ZCR variance) when the fallback path fires. `fusion.py` now logs score, denominator, and per-pillar weighted contributions for every job.

### Stage 6 — Subject Identity (Phase 1, NLP)
`analysers/subject_identity.py` — spaCy NER on video metadata, cross-referenced against Wikidata list.
- **Startup fetch:** `analysers/subject_list.py` queries Wikidata SPARQL at startup for current heads of state/government (AU/US/UK/EU) and major party leaders. Stored as module-level `SUBJECT_LIST: list[str]`. Degrades to empty list on failure — subject identity runs silent, not as error.
- **Hashtag pre-processing:** `#hashtag` tokens extracted from metadata, stripped of `#`, segmented via `wordninja.split()` before NER. Required for TikTok content where subject names appear only in hashtags (e.g. `#presidentdonaldtrump` → `['president', 'donald', 'trump']`).
- **NER:** spaCy `en_core_web_sm`. PERSON entities cross-referenced against SUBJECT_LIST via case-insensitive substring match (both directions).
- **Output:** `subject_identity` key on top-level job result dict — always present. `matched: bool`, `matched_name: str | None`, `ner_entities: list[str]`, `source: "metadata_nlp"`.
- **Score contribution:** Flag only — not a fusion input, not in denominator.
- **Evidence card:** Standalone silent row — renders amber/caution when `matched=True`, hidden when `matched=False`.

**Observability gap (§3.29):** No `[subject_identity]` log line emitted. Cannot confirm from Railway logs whether the function ran, Wikidata list populated, or NER entities were extracted. Fix queued.

### Fusion Layer
`analysers/fusion.py` — fixed weighted ensemble:
- Metadata weight: 0.08
- Source reputation weight: 0.15
- Source behaviour weight: 0.15
- Deepfake weight: 0.40
- Audio weight: 0.20 (Resemble AI voice clone classifier primary; librosa heuristics fallback)
- C2PA weight: 0.22 (reserved — stub returns `score: None`, excluded from denominator)

Max active denominator (C2PA always None): 0.08+0.15+0.15+0.40+0.20 = 0.98

Pillars returning `score: None` are excluded from the weighted denominator entirely.
Pillars returning `score: 0.50` contribute dead weight — architectural decision pending on
whether to treat exactly-neutral scores the same as None.

**Verdict bands:**
- Green 0.0–0.30 → "Likely authentic"
- Amber 0.30–0.60 → "Inconclusive"
- Red 0.60–1.0 → "Likely manipulated"

---

## Signal Architecture — current pillar status

| Pillar | Status | Notes |
|---|---|---|
| Metadata & container forensics | ✅ Active | NTSC fps fix deployed |
| Source reputation | ✅ Active (partial) | Instagram: 1/5 signals; low-confidence badge shown |
| Source behaviour & bio | ✅ Active (partial) | Bio link check only; 0.50 when no data |
| C2PA provenance | ⏭ Stub | `score: None`, excluded from denominator — Phase 1 |
| Frame-level deepfake | ✅ Active | Replicate live, sequential scoring, high-variance detection |
| Audio & voice clone | ✅ Active (partial) | Resemble AI voice clone classifier active; librosa heuristics fallback; weight 0.20 |
| Pixel-level forensics | ⏳ Not wired | Backlog |

**Active fusion pillars: 5/7**

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
| Deepfake — non-human content | Faceswap model has no meaningful signal on animal-subject content; frame confidence scalar suppresses score toward authentic correctly but evidence card does not communicate the limitation | Phase 1: content-type guard — if ≤1 frame scores a human face, set `content_type: non_human` and render pillar as "no human face detected — result not meaningful" |
| Audio — Resemble fallback | `RESEMBLE_API_TOKEN` missing from Railway Variables causes librosa-only path; minimum floor 0.15 clamps result | Add RESEMBLE_API_TOKEN to Railway Variables |
| Deepfake — per-frame latency | ✅ Resolved — concurrent submission via asyncio.gather() (18 Jun 2026). Total Stage 2 time ~40s vs ~156s sequential. Cold-start absorbed once across batch. | — |

---

## Known Blockers

| Blocker | Detail | Fix |
|---|---|---|
| YouTube ingestion | Bot detection blocks yt-dlp on some clips | Phase A workaround: `--extractor-args "youtube:player_client=android"`; Phase B: bgutil PO token plugin + residential proxy |
| Audio/fusion logging | ✅ Resolved — per-job [audio] librosa sub-scores and [fusion] score/denominator/per-pillar breakdown now emitted to Railway logs (18 Jun 2026, §3.28). | — |

---

## Key Design Decisions (do not reverse without discussion)

1. **Frontend embedded in `main.py`** — avoids Docker volume path issues.
   Edit there, NOT in `frontend/index.html` (which is stale).

2. **Stateless job store** — in-memory dict. Intentional at prototype stage. Phase 1 requires
   persistent job queue (Temporal is the current lean).

3. **C2PA slot reserved** — do not remove the 0.40 weight slot.

4. **No test suite** — prototype velocity takes priority. Don't add tests without discussion.

5. **50-anchored scoring** — 0.5 = neutral/no information throughout. Below 0.5 = evidence of
   authenticity; above 0.5 = evidence of manipulation. Metadata soft ceiling 0.65.

6. **Sequential frame scoring** — one Replicate request per frame, 1s delay between.
   Eliminates burst-limit 429s regardless of account tier. 6 frames ≈ 2 minutes total.

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

1. **Logging instrumentation** — add per-job [subject_identity] log line (§3.29); audio and fusion logging resolved (§3.28 closed 18 Jun 2026)
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
Next Engineers Brief target: v0.14 (§3.24 non-human content guard; §3.25 latency; §3.26 faceswap false negative; §3.28/§3.29 logging gaps; §3.21/§3.27 subject identity + hashtag fix — see consolidation checklist).

---

## Working Style

- Charlie (founder) holds all accounts: Railway, Cloudflare, Apple Developer, Replicate
- Charlie runs terminal commands; Claude Code handles code changes and git operations
- Cheap-first execution: validate empirically before over-engineering
- Irreversible decisions (architecture, compliance, data retention) prioritised over reversible ones
- GDPR-standard data architecture from day one
- Biometric non-retention: facial and voice features discarded after each detection decision
