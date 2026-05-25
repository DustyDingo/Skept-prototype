# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the App

```bash
# With Docker (recommended)
docker compose up --build

# Without Docker (requires Python 3.12+, ffmpeg, ffprobe, yt-dlp installed)
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The app is served at `http://localhost:8000`. The frontend is embedded in `main.py` so there is no separate frontend build step.

### Environment

Copy `.env.example` to `.env` and set:
- `HF_TOKEN` — HuggingFace API token (required for deepfake detection; stage 2 is silently skipped if missing)
- `SKEPT_FRAMES` — number of frames sampled per video (default: 6)

## Architecture

This is a single-service FastAPI app that embeds its entire frontend as a string in `main.py`. There is no build toolchain, no database, and no persistent storage — jobs live in memory and temp directories are cleaned up on shutdown.

### Analysis Pipeline

User submits a URL or file → backend creates a `job_id` → frontend polls `/api/status/{job_id}` every 2–3 seconds → pipeline runs two stages in sequence:

**Stage 1 — Metadata (CPU, fast):** `analysers/metadata.py` uses `ffprobe` to extract 6 forensic signals (camera/encoder metadata, codec, resolution, frame rate, audio track, container). Score is capped at 0.5 max — metadata alone can never return a "likely manipulated" verdict.

**Stage 2 — Deepfake detection (GPU optional):** `analysers/deepfake.py` extracts N evenly-spaced frames and sends each to the HuggingFace model `prithivMLmods/deepfake-detector-model-v1` (Fake/Real classifier). Uses a semaphore to cap concurrent HF requests at 2. Returns mean, peak, and high-confidence frame scores. Skipped gracefully if `HF_TOKEN` is not set.

**Fusion:** `analysers/fusion.py` combines scores with a fixed weighted ensemble:
- Metadata weight: 0.15
- Deepfake weight: 0.45
- C2PA weight: 0.40 (reserved — not yet implemented, contributes 0)

Verdict bands: Green 0.0–0.30 ("Likely authentic"), Amber 0.30–0.60 ("Inconclusive"), Red 0.60–1.0 ("Likely manipulated").

### Key Design Decisions

- **Frontend embedded in `main.py`**: Avoids Docker volume path issues with static files. The full HTML/CSS/JS is a Python string at the top of `main.py` — edit it there, not in `frontend/index.html` (which may be stale).
- **Stateless job store**: Jobs are held in an in-memory dict (`jobs: dict[str, JobStatus]`). Restarting the server loses all in-flight jobs.
- **No test suite**: The project has no pytest configuration or tests.
- **C2PA slot is reserved**: The fusion formula already allocates 40% weight to C2PA provenance checking, but the analyser doesn't exist yet.
