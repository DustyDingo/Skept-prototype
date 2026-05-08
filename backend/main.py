"""
Skept Prototype — Backend API
FastAPI server: ingestion, analysis pipeline, job polling.
"""

import asyncio
import os
import uuid
import tempfile
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import aiofiles

from analysers.metadata import run_metadata
from analysers.deepfake import run_deepfake
from analysers.fusion import fuse

# ── Job store (in-memory for prototype; swap for Redis in prod) ─────────────
jobs: dict[str, dict] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Cleanup temp dirs on shutdown
    for job in jobs.values():
        wd = job.get("workdir")
        if wd and Path(wd).exists():
            shutil.rmtree(wd, ignore_errors=True)

app = FastAPI(title="Skept API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyse")
async def analyse(
    url: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    """
    Submit a clip for analysis. Accepts either a URL or a file upload.
    Returns a job_id immediately; poll /api/status/{job_id} for results.
    """
    if not url and not file:
        raise HTTPException(400, "Provide either a URL or a file.")

    job_id = str(uuid.uuid4())
    workdir = tempfile.mkdtemp(prefix="skept_")

    jobs[job_id] = {
        "id": job_id,
        "state": "pending",
        "input_type": "url" if url else "file",
        "input_ref": url or file.filename,
        "workdir": workdir,
        "analysers": {},
        "verdict": None,
        "error": None,
    }

    # Save uploaded file if present
    if file:
        dest = Path(workdir) / "upload.mp4"
        async with aiofiles.open(dest, "wb") as f:
            content = await file.read()
            await f.write(content)

    # Kick off analysis in the background
    asyncio.create_task(run_pipeline(job_id, url, workdir))

    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
def status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return {
        "id": job["id"],
        "state": job["state"],
        "input_type": job["input_type"],
        "input_ref": job["input_ref"],
        "analysers": job["analysers"],
        "verdict": job["verdict"],
        "error": job["error"],
    }


# ── Pipeline ─────────────────────────────────────────────────────────────────

async def run_pipeline(job_id: str, url: str | None, workdir: str):
    job = jobs[job_id]

    try:
        # ── Stage 0: Ingestion ──────────────────────────────────────────────
        job["state"] = "ingesting"
        video_path = await ingest(url, workdir)

        # ── Stage 1: Metadata forensics (cheap, no GPU) ─────────────────────
        job["state"] = "stage1"
        job["analysers"]["metadata"] = {"status": "running"}
        meta_result = await asyncio.to_thread(run_metadata, video_path)
        job["analysers"]["metadata"] = meta_result

        # ── Stage 2: Frame-level deepfake detection (GPU via HF API) ────────
        job["state"] = "stage2"
        job["analysers"]["deepfake"] = {"status": "running"}
        deepfake_result = await run_deepfake(video_path)
        job["analysers"]["deepfake"] = deepfake_result

        # ── Fusion ───────────────────────────────────────────────────────────
        verdict = fuse(meta_result, deepfake_result)
        job["verdict"] = verdict
        job["state"] = "complete"

    except Exception as e:
        job["state"] = "error"
        job["error"] = str(e)
    finally:
        # Keep workdir for debugging; clean in production
        pass


async def ingest(url: str | None, workdir: str) -> str:
    """Download from URL via yt-dlp, or use already-saved upload."""
    if url:
        out = Path(workdir) / "video.mp4"
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp",
            url,
            "-o", str(out),
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--no-playlist",
            "--quiet",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {stderr.decode()}")
        if not out.exists():
            # yt-dlp may use a different extension — find what it saved
            candidates = list(Path(workdir).glob("video.*"))
            if not candidates:
                raise RuntimeError("yt-dlp produced no output file.")
            out = candidates[0]
        return str(out)
    else:
        candidates = list(Path(workdir).glob("upload.*"))
        if not candidates:
            raise RuntimeError("No uploaded file found.")
        return str(candidates[0])
