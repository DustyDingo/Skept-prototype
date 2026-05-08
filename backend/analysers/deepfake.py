"""
Skept — Frame-Level Deepfake Analyser
Extracts frames via ffmpeg, sends each to HuggingFace Inference API,
aggregates scores into a verdict signal.

Model: prithivMLmods/deepfake-detector-model-v1 (SigLIP-based, 94.4% accuracy)
Labels: "Fake" / "Real"
"""

import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

import httpx

HF_MODEL = "prithivMLmods/deepfake-detector-model-v1"
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
FRAMES_TO_SAMPLE = int(os.getenv("SKEPT_FRAMES", "3"))
HF_TOKEN = os.getenv("HF_TOKEN", "")


async def run_deepfake(video_path: str) -> dict:
    if not HF_TOKEN:
        return _no_token_result()

    frame_paths = await asyncio.to_thread(_extract_frames, video_path, FRAMES_TO_SAMPLE)

    if not frame_paths:
        return {
            "status": "error",
            "error": "Frame extraction produced no output.",
            "score": 0.5,
            "signals": [],
            "summary": "Frame extraction failed.",
        }

    sem = asyncio.Semaphore(2)

    async def score_one(fp):
        async with sem:
            return await _score_frame(fp)

    results = await asyncio.gather(*[score_one(fp) for fp in frame_paths])
    valid = [r for r in results if r is not None]

    if not valid:
        return {
            "status": "error",
            "error": "All frame requests failed.",
            "score": 0.5,
            "signals": [],
            "summary": "Deepfake analyser returned no results.",
        }

    fake_probs = [r["fake_prob"] for r in valid]
    mean_fake = round(sum(fake_probs) / len(fake_probs), 3)
    max_fake = round(max(fake_probs), 3)
    high_conf = [r for r in valid if r["fake_prob"] > 0.7]

    signals = [
        {
            "label": "Frames analysed",
            "value": f"{len(valid)} of {len(frame_paths)} sampled",
            "weight": "info",
            "suspicious": False,
        },
        {
            "label": "Mean synthetic probability",
            "value": f"{mean_fake:.0%}",
            "weight": "high",
            "suspicious": mean_fake > 0.5,
        },
        {
            "label": "Peak synthetic probability",
            "value": f"{max_fake:.0%}",
            "weight": "high",
            "suspicious": max_fake > 0.7,
        },
        {
            "label": "High-confidence synthetic frames",
            "value": f"{len(high_conf)} of {len(valid)}",
            "weight": "high",
            "suspicious": len(high_conf) > 0,
        },
    ]

    if mean_fake < 0.3:
        summary = f"Frame analysis consistent with authentic content ({mean_fake:.0%} mean synthetic probability)."
    elif mean_fake < 0.6:
        summary = f"Frame analysis inconclusive — {mean_fake:.0%} mean synthetic probability across {len(valid)} sampled frames."
    else:
        summary = (
            f"Frame analysis flags synthetic characteristics — {mean_fake:.0%} mean and "
            f"{max_fake:.0%} peak synthetic probability. "
            f"{len(high_conf)} frame(s) above high-confidence threshold."
        )

    return {
        "status": "complete",
        "score": mean_fake,
        "signals": signals,
        "summary": summary,
        "model": HF_MODEL,
        "frames_sampled": len(valid),
    }


def _extract_frames(video_path: str, n: int) -> list[str]:
    tmpdir = tempfile.mkdtemp(prefix="skept_frames_")
    dur_result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", video_path],
        capture_output=True, text=True, timeout=15
    )
    try:
        duration = float(dur_result.stdout.strip())
    except Exception:
        duration = 30.0

    margin = duration * 0.05
    usable = max(duration - 2 * margin, 1.0)
    interval = usable / n
    frames = []
    for i in range(n):
        t = margin + i * interval
        out = Path(tmpdir) / f"frame_{i:03d}.jpg"
        res = subprocess.run(
            ["ffmpeg", "-ss", str(t), "-i", video_path,
             "-frames:v", "1", "-q:v", "2", str(out), "-y", "-loglevel", "error"],
            capture_output=True, timeout=15
        )
        if out.exists() and out.stat().st_size > 0:
            frames.append(str(out))
    return frames


async def _score_frame(frame_path: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            with open(frame_path, "rb") as f:
                data = f.read()
            resp = await client.post(
                HF_API_URL,
                content=data,
                headers={
                    "Authorization": f"Bearer {HF_TOKEN}",
                    "Content-Type": "image/jpeg",
                },
            )
            if resp.status_code == 503:
                await asyncio.sleep(15)
                resp = await client.post(
                    HF_API_URL, content=data,
                    headers={
                        "Authorization": f"Bearer {HF_TOKEN}",
                        "Content-Type": "image/jpeg",
                    },
                )
            resp.raise_for_status()
            predictions = resp.json()
            # Model labels: "Fake" / "Real"
            fake_prob = next(
                (p["score"] for p in predictions
                 if p["label"].lower() in ("fake", "deepfake")), 0.5
            )
            return {"frame": frame_path, "fake_prob": round(fake_prob, 4)}
    except Exception as e:
        print(f"Frame scoring error ({frame_path}): {e}")
        return None


def _no_token_result() -> dict:
    return {
        "status": "skipped",
        "score": 0.5,
        "signals": [{"label": "HF_TOKEN not configured", "value": "Set HF_TOKEN to enable GPU analysis", "weight": "high", "suspicious": False}],
        "summary": "Frame-level deepfake analysis skipped — no HuggingFace API token configured.",
        "model": HF_MODEL,
    }
