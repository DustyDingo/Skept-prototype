# Skept Prototype — Developer Reference
**Last updated: 25 Jun 2026**

Skept is an AI-content detection and video verification platform for short-form social media. This file is the canonical session-start reference for Claude Code. Load it at the start of every session.

---

## Architecture overview

Single-file FastAPI app — all backend logic and frontend HTML live in `main.py`. No separate frontend directory. Edit `main.py` directly for all UI and pipeline changes.

**Analysers:**
- `analysers/deepfake.py` — Resemble AI DETECT-3B Omni (video). Single API call to `/api/v1/detect`. Submits `df_sampled.mp4`. Returns per-frame scores via `video_metrics.children`. Certainty-weighted mean scoring. Also reads embedded audio score from same response (`item["metrics"]["aggregated_score"]`), stored as `video_job_audio_score`.
- `analysers/audio.py` — reads `video_job_audio_score` written by `deepfake.py`. No standalone Resemble audio.wav submission. Source logged as `video_job_omni`.
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
- Score conversion: `(raw + 1) / 2` — e.g. raw `0.2724` → Skept score `0.6362`. This conversion is intentional. Skept scores and Resemble dashboard scores will always differ and cannot be directly cross-referenced.
- No-speech sentinel: when both Resemble audio scores return `-1.0`, route to `score=None` (excluded from fusion). Do not fall back to librosa.
- C2PA: read from `resemble_c2pa` field in video job response.

**Frame scalar (deepfake pillar):**
- `resemble_frame_count` — Resemble's internal count of ImageResult nodes across the submitted clip (not Skept's sample count).
- `skept_frames` — Skept's requested frame sample count (default 6).
- Certainty scalar = certainty-weighted mean from per-frame certainty values. Not `resemble_frame_count / skept_frames`.

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
- `audio_dubbing_pattern` DOM label (`ref_53`) must be conditionally rendered server-side — absent from DOM entirely when condition not met. Do not use CSS toggle.
- Audio state copy: "Audio & voice clone — no speech detected" vs "Audio & voice clone — excluded" are distinct states and must use distinct copy.
- Confidence meter: no zone-divider tick marks on track. Zone labels (`AUTHENTIC / INCONCLUSIVE / SUSPICIOUS`) are the only threshold indicators.

---

## Open checklist items (as of 25 Jun 2026)

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

## Brand tokens

AMBER `#DFB87B` · INK `#1A1A1A` · GRAY `#4A4A4A` · SOFT `#8A8A8A` · CREAM `#FAF8F5` · AMBER_LIGHT `#F5E6C8` · RULE `#E0E0E0`
Display font: Palatino Linotype (wordmark only). Body: Calibri.

---

## Stripe MCP

Stripe MCP active. Secret key set manually in `.claude/settings.json` — never commit this file if it contains a live key. `.claude/settings.json` is listed in `.gitignore`.

**Role:** Web billing provider (Phase 2). Handles subscription payments for Plus, Pro, and Max tiers on web (skept.co).
**Mobile billing:** RevenueCat (separate — Phase 2, mobile IAP abstraction for iOS/Android).
**Publishable key:** Client-side only — used at Phase 2 when wiring Stripe Elements / Checkout into the frontend. Not in MCP config.
**Secret key:** Test mode (`sk_test_...`) active locally. Swap for live key (`sk_live_...`) at launch.
**Schema hooks:** `subscription_source`, `subscription_ref`, `tier`, `tier_expires_at` fields in `skept-auth` D1 `users` table are already designed to receive Stripe webhook data.

---

## Working principles

- Edit `main.py` for all pipeline and UI changes.
- One Resemble API call per job. Never add a second.
- `score=None` excludes from fusion. Never substitute 0.5 for None.
- Absence of signal is not evidence of authenticity.
- Read CLAUDE.md before every session. Do not rely on session memory for architecture facts.
