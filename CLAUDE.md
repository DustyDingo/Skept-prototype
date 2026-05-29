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
- **Deepfake detection:** HuggingFace — `prithivMLmods/deepfake-detector-model-v1`
- **GPU scoring (pending):** Replicate (not yet integrated — current blocker)
- **Frontend:** Embedded HTML/CSS/JS string inside `main.py` — do NOT edit `frontend/index.html`
- **Job store:** In-memory dict (`jobs: dict[str, JobStatus]`) — stateless, no DB
- **Deployment:** Railway via GitHub push to main

---

## Running the App

### Bare-metal (development)
```bash
pip install -r requirements.txt
cp .env.example .env   # then fill in HF_TOKEN
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
| `HF_TOKEN` | Optional | HuggingFace API token — Stage 2 (deepfake) silently skipped if missing |
| `SKEPT_FRAMES` | Optional | Frames sampled per video (default: 6) |
| `REPLICATE_API_TOKEN` | Optional | Audio, face, and frame pillars inactive if not set |

Copy `.env.example` to `.env` before running.

---

## Analysis Pipeline Architecture

User submits URL → backend creates `job_id` → frontend polls `/api/status/{job_id}` every 2–3s
→ pipeline runs two stages in sequence:

### Stage 1 — Metadata (CPU, fast)
`analysers/metadata.py` — uses ffprobe to extract 6 forensic signals:
- Camera/encoder metadata
- Codec
- Resolution
- Frame rate
- Audio track presence
- Container format

All signal scores are 50-anchored: 0.5 = neutral/no information, below 0.5 = evidence of
authenticity, above 0.5 = evidence of manipulation. Soft ceiling of 0.65 applied (replaces
the old hard 0.5 cap) — metadata can flag genuinely suspicious signals but remains conservative.

### Stage 2 — Deepfake Detection (GPU optional)
`analysers/deepfake.py` — extracts N evenly-spaced frames, sends each to HuggingFace model.
Uses semaphore to cap concurrent HF requests at 2.
Returns mean, peak, and high-confidence frame scores.
Skipped gracefully if `HF_TOKEN` is not set.

### Stage 3 — Source Reputation
`analysers/source_reputation.py` — account behavioural signals:
- Recent burst concentration (post clustering in a 7-day window)
- Posting cadence / rate
- Disaster-content specialisation ratio
- Cross-platform identity absence

**Strategically critical:** Platform re-encoding strips artifact metadata; behavioural signals
survive. This makes source reputation the most durable detection layer.

### Fusion Layer
`analysers/fusion.py` — fixed weighted ensemble:
- Metadata weight: 0.15
- Deepfake weight: 0.45
- C2PA weight: 0.40 (reserved — not yet implemented, contributes 0)

**Verdict bands:**
- Green 0.0–0.30 → "Likely authentic"
- Amber 0.30–0.60 → "Inconclusive"
- Red 0.60–1.0 → "Likely manipulated"

---

## Signal Architecture (8 pillars across 2 stage groups)

### Stage Group A — Artifact-level forensics
1. Container/metadata forensics (ffprobe)
2. Pixel/model analysis (deepfake detection)
3. C2PA provenance checking (Phase 1 — reserved slot in fusion formula)
4. Audio & voice clone detection (GPU-gated — stub wired, pending Replicate)

### Stage Group B — Source behavioural signals
4. Account post history
5. Posting cadence patterns
6. Disaster-content specialisation ratio
7. Cross-platform identity absence

Multi-signal confluence is the core reliability principle. No single detector is sufficient.

---

## Known Blockers

| Blocker | Detail | Fix |
|---|---|---|
| GPU scores silently skipped | HF free tier blocks GPU inference | Integrate Replicate API — **priority task** |
| Audio pillar inactive | `REPLICATE_API_TOKEN` not configured | Integrate Replicate — same gate as face/frame |
| YouTube ingestion broken | Bot detection blocks yt-dlp | Needs workaround (cookies/proxy approach) |

---

## Key Design Decisions (do not reverse without discussion)

1. **Frontend embedded in `main.py`** — avoids Docker volume path issues with static files.
   The full HTML/CSS/JS is a Python string at the top of `main.py`.
   Edit there, NOT in `frontend/index.html` (which may be stale).

2. **Stateless job store** — jobs held in-memory dict. Restarting the server loses all
   in-flight jobs. This is intentional at prototype stage.

3. **C2PA slot reserved** — fusion formula already allocates 40% weight to C2PA provenance
   checking, but the analyser doesn't exist yet. Do not remove this slot.

4. **No test suite** — no pytest configuration or tests currently. Don't add them without
   discussion — prototype velocity takes priority.

5. **50-anchored scoring** — all pillar scores use 0.5 as the neutral baseline (no information).
   Values below 0.5 indicate evidence of authenticity; above 0.5 indicate evidence of
   manipulation. Absent or uninformative signals contribute exactly 0.5 — they do not dilute
   suspicious signals toward authentic. Metadata has a soft ceiling of 0.65 for conservatism.
   Fusion layer weighted mean of all-0.5 inputs produces exactly 0.5 (verified).

---

## Deployment

### Railway (production)
- Push to `main` branch triggers automatic Railway redeploy
- Project: `wholesome-truth`
- URL: `skept-prototype-production.up.railway.app`
- Environment variables set in Railway dashboard (not in repo)

### Cloudflare (landing page)
- `skept.co` served from Cloudflare Pages
- Waitlist worker: `skept-waitlist` deployed at `skept.co/api/waitlist*`
- KV namespace: `WAITLIST` (ID: `18cd94f511f047b7a220d6125f4987ea`)
- Deploy command (from Deployment-Skept folder): `npx wrangler deploy`
- KV listing requires `--remote` flag in wrangler 4.x

---

## Roadmap (near-term priorities)

1. **Replicate integration** — unblock GPU-based deepfake scoring (highest priority)
2. **Audio pillar implementation** — stub + pipeline wired; evidence card live; full scoring pending Replicate GPU
3. **YouTube ingestion fix** — workaround for bot detection
4. **Source reputation analyser** — implement Stage Group B signals
5. **C2PA manifest integration** — Phase 1 watermarking bridge standard
6. **Share sheet registration** — iOS Share Extension + Android intent filter as primary
   zero-friction entry point for the verify loop

---

## Product Context

- **Primary user:** Casual scroller encountering a viral clip in their feed
- **Core loop:** User sees clip → opens Skept → submits URL or shares via share sheet →
  gets verdict → seal attached to their repost (paid tier)
- **Trust seal:** The public verdict page (`skept.app/v/[id]`) is how people encountering
  a sealed clip verify it. Seal value defended by making Skept widely used, not by making
  reposting difficult.
- **Pricing model:** Free tier (verify only) + Pro tier (seal, history, PDF export)
- **Auth:** Passwordless magic link; Google and Apple OAuth; anonymous-first experience
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
| Project Brief | v0.18 | Master product spec |
| Engineers Brief | v0.8 | Architecture and build specs |
| Legal Brief | v0.7 | Attorney reference |
| Trademark Clearance Brief | v0.3 | Filing strategy |

Cross-references and brief updates managed through `/v14-consolidation-checklist.md`.

---

## Working Style

- Charlie (founder) holds all accounts: GCP, Railway, Cloudflare, Apple Developer
- Charlie runs terminal commands; Claude Code handles code changes and git operations
- Cheap-first execution: validate empirically before over-engineering
- Irreversible decisions (architecture, compliance, data retention) prioritised over
  reversible engagement/UX decisions
- Shadow phase: no public footprint, no premature spending before coordinated brand
  acquisition sprint
- GDPR-standard data architecture from day one (covers AU and US state laws by default)
- Biometric non-retention: facial and voice features discarded after each detection
  decision, never stored
