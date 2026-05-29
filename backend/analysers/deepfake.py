"""
Skept — Frame-Level Deepfake Analyser (Replicate)
Extracts frames via ffmpeg, sends each to Replicate faceswap detection API,
aggregates scores into a verdict signal.

Model: scamai/deepfake-faceswap-detection
       Detects face-replacement deepfakes specifically. Does not cover purely
       AI-generated imagery — use as a faceswap signal pillar, not a general
       synthetic-content detector.

TEMPORARY STAND-IN: Replace with prithivMLmods/deepfake-detector-model-v1
       (via HuggingFace paid tier) once HF billing is active. At that point,
       retain scamai as an additive 8th signal pillar alongside the general
       synthetic content detector.

Replaces: capcheck/ai-image-detection (404 — not actually hosted on Replicate)
"""

import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

import replicate

REPLICATE_MODEL = "scamai/deepfake-faceswap-detection:163f897bd0e920d375e4e67299bfc4c5eeeb8beb243d5ea9b309d1c299f562e7"
FRAMES_TO_SAMPLE = int(os.getenv("SKEPT_FRAMES", "3"))
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")


async def run_deepfake(video_path: str) -> dict:
    if not REPLICATE_API_TOKEN:
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
            "label": "Mean faceswap probability",
            "value": f"{mean_fake:.0%}",
            "weight": "high",
            "suspicious": mean_fake > 0.5,
        },
        {
            "label": "Peak faceswap probability",
            "value": f"{max_fake:.0%}",
            "weight": "high",
            "suspicious": max_fake > 0.7,
        },
        {
            "label": "High-confidence faceswap frames",
            "value": f"{len(high_conf)} of {len(valid)}",
            "weight": "high",
            "suspicious": len(high_conf) > 0,
        },
    ]

    if mean_fake < 0.3:
        summary = f"Frame analysis found no faceswap indicators ({mean_fake:.0%} mean probability)."
    elif mean_fake < 0.6:
        summary = f"Frame analysis inconclusive - {mean_fake:.0%} mean faceswap probability across {len(valid)} sampled frames."
    else:
        summary = (
            f"Frame analysis flags faceswap characteristics - {mean_fake:.0%} mean and "
            f"{max_fake:.0%} peak probability. "
            f"{len(high_conf)} frame(s) above high-confidence threshold."
        )

    return {
        "status": "complete",
        "score": mean_fake,
        "signals": signals,
        "summary": summary,
        "model": REPLICATE_MODEL,
        "frames_sampled": len(valid),
    }


def _extract_frames(video_path: str, n: int) -> list[str]:
    """Unchanged — ffmpeg frame extraction, evenly spaced with 5% margin."""
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
        subprocess.run(
            ["ffmpeg", "-ss", str(t), "-i", video_path,
             "-frames:v", "1", "-q:v", "2", str(out), "-y", "-loglevel", "error"],
            capture_output=True, timeout=15
        )
        if out.exists() and out.stat().st_size > 0:
            frames.append(str(out))
    return frames


async def _score_frame(frame_path: str) -> dict | None:
    """
    Score a single frame via Replicate scamai/deepfake-faceswap-detection.

    Output schema is logged on first call for verification — the model returns
    a confidence score for faceswap likelihood. Defensive parsing handles both
    dict and list responses so we can confirm the schema from Railway logs and
    adjust if needed without another deploy cycle.
    """
    try:
        with open(frame_path, "rb") as f:
            output = await asyncio.to_thread(
                replicate.run,
                REPLICATE_MODEL,
                input={"image": f},
            )

        # Log raw output once so we can confirm schema from Railway logs
        print(f"[deepfake] raw output type={type(output).__name__} value={output!r}")

        fake_prob = _parse_fake_prob(output)
        return {"frame": frame_path, "fake_prob": round(float(fake_prob), 4)}

    except Exception as e:
        print(f"Frame scoring error ({frame_path}): {e}")
        return None


def _parse_fake_prob(output) -> float:
    """
    Defensive parser for Replicate model output.
    Handles the most common return shapes until schema is confirmed from logs.
    """
    if output is None:
        return 0.5

    # Dict: {"score": 0.95} or {"fake": 0.95} or {"probability": 0.95}
    if isinstance(output, dict):
        for key in ("score", "fake", "fake_probability", "probability", "confidence"):
            if key in output:
                return float(output[key])
        # Fallback: take the first numeric value
        for v in output.values():
            try:
                return float(v)
            except (TypeError, ValueError):
                continue

    # List: [{"label": "fake", "score": 0.95}, ...] or [0.95, 0.05]
    if isinstance(output, list):
        if output and isinstance(output[0], dict):
            fake_item = next(
                (item for item in output
                 if str(item.get("label", "")).lower() in ("fake", "deepfake", "faceswap")),
                None,
            )
            if fake_item:
                return float(fake_item.get("score", fake_item.get("probability", 0.5)))
            # No matching label — take first item's score
            first = output[0]
            for key in ("score", "probability", "confidence"):
                if key in first:
                    return float(first[key])
        elif output and isinstance(output[0], (int, float)):
            # Raw probability list — assume index 0 is fake probability
            return float(output[0])

    # Scalar
    try:
        return float(output)
    except (TypeError, ValueError):
        pass

    return 0.5


def _no_token_result() -> dict:
    return {
        "status": "skipped",
        "score": 0.5,
        "signals": [{
            "label": "REPLICATE_API_TOKEN not configured",
            "value": "Set REPLICATE_API_TOKEN in Railway environment variables",
            "weight": "high",
            "suspicious": False,
        }],
        "summary": "Frame-level analysis skipped - no Replicate API token configured.",
        "model": REPLICATE_MODEL,
    }
