"""
Skept — Video Deepfake Analyser (Resemble AI DETECT-3B Omni)

Submits the video file to the Resemble AI /api/v1/detect endpoint.
Parses video_metrics.aggregated_score and per-frame children data for
frame confidence scalar, high-variance detection, and non-human content guard.

Score is already [0.0, 1.0] — no inversion needed (unlike audio path).
"""

import asyncio
import logging
import os
import statistics
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

RESEMBLE_API_TOKEN = os.getenv("RESEMBLE_API_TOKEN")
RESEMBLE_ENDPOINT  = "https://api.resemble.ai/api/v1/detect"
FRAMES_TO_SAMPLE   = int(os.getenv("SKEPT_FRAMES", "6"))

print(
    f"[deepfake] model=resemble_detect_v1_omni "
    f"FRAMES_TO_SAMPLE={FRAMES_TO_SAMPLE} "
    f"(SKEPT_FRAMES env={os.getenv('SKEPT_FRAMES', 'not set')})",
    flush=True,
)


async def run_deepfake(video_path: str) -> dict:
    if not RESEMBLE_API_TOKEN:
        return _no_token_result()

    logger.warning("[deepfake] starting — video=%r", video_path)

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            with open(video_path, "rb") as f:
                resp = await client.post(
                    RESEMBLE_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {RESEMBLE_API_TOKEN}",
                        "Prefer":        "wait",
                    },
                    files={"file": (Path(video_path).name, f, "video/mp4")},
                )

        print(f"[deepfake] Resemble HTTP status={resp.status_code}", flush=True)
        print(f"[deepfake] Resemble raw body={resp.text[:500]}", flush=True)

        if resp.status_code != 200:
            logger.warning("[deepfake] Resemble API returned %d: %r", resp.status_code, resp.text[:200])
            return _error_result(f"Resemble API error {resp.status_code}")

        data = resp.json()
        if not data.get("success"):
            logger.warning("[deepfake] Resemble success=false: %r", resp.text[:300])
            return _error_result("Resemble returned success=false")

        video_metrics    = data.get("item", {}).get("video_metrics", {})
        aggregated_score = video_metrics.get("aggregated_score")
        children         = video_metrics.get("children") or []

        if aggregated_score is None:
            logger.warning("[deepfake] no aggregated_score in Resemble response")
            return _error_result("No aggregated_score in Resemble response")

        aggregated_score = float(aggregated_score)
        total_frames     = len(children)

        subjects     = [c for c in children if _frame_has_subject(c)]
        frame_scores = [float(c["score"]) for c in children if c.get("score") is not None]

        # Non-human content guard
        if total_frames > 0 and len(subjects) <= 1:
            logger.info(
                "[deepfake] status=non_human subjects=%d total=%d score=None",
                len(subjects), total_frames,
            )
            return {
                "status":           "non_human",
                "content_type":     "non_human",
                "score":            None,
                "frame_confidence": 0.0,
                "signals":          [],
                "summary":          "No human subject detected in video frames — deepfake analysis not applicable.",
                "high_variance":    False,
            }

        # Low coverage guard
        if len(frame_scores) < 2:
            logger.info("[deepfake] status=low_coverage frame_scores=%d", len(frame_scores))
            return {"score": None, "status": "low_coverage", "frame_confidence": 0.0}

        # Frame confidence scalar
        coverage_n     = len(subjects) if total_frames > 0 else len(frame_scores)
        coverage_total = max(total_frames, len(frame_scores), 1)
        scalar         = round(coverage_n / coverage_total, 3)
        mean_score     = round(sum(frame_scores) / len(frame_scores), 3)
        pillar_score   = round(mean_score * scalar, 3)

        # High-variance detection
        std_dev       = statistics.stdev(frame_scores) if len(frame_scores) > 1 else 0.0
        high_variance = std_dev > 0.25

        print(
            f"[deepfake] resemble_score={aggregated_score:.4f} "
            f"coverage={coverage_n}/{coverage_total} "
            f"scalar={scalar:.4f} final={pillar_score:.4f}",
            flush=True,
        )
        logger.info(
            "[deepfake] resemble_score=%.4f coverage=%d/%d scalar=%.4f final=%.4f high_variance=%s",
            aggregated_score, coverage_n, coverage_total, scalar, pillar_score, high_variance,
        )

        signals = [
            {
                "label":     "Coverage",
                "value":     f"{coverage_n} of {coverage_total} frames with detected subject",
                "weight":    "info",
                "suspicious": False,
            },
            {
                "label":     "Frame confidence scalar",
                "value":     f"{scalar:.0%}",
                "weight":    "info",
                "suspicious": False,
            },
            {
                "label":     "Mean frame score",
                "value":     f"{mean_score:.0%}",
                "weight":    "high",
                "suspicious": mean_score > 0.5,
            },
            {
                "label":     "Aggregated suspicion score",
                "value":     f"{aggregated_score:.0%}",
                "weight":    "high",
                "suspicious": aggregated_score > 0.5,
            },
        ]

        if high_variance:
            signals.append({
                "label":     "High score variance across frames",
                "value":     (
                    f"Scores ranged {min(frame_scores):.0%} – {max(frame_scores):.0%}. "
                    "May reflect scene cuts or multiple subjects."
                ),
                "weight":    "medium",
                "suspicious": False,
            })

        if aggregated_score < 0.3:
            summary = f"Video analysis found no deepfake indicators ({aggregated_score:.0%} suspicion score)."
        elif aggregated_score < 0.6:
            summary = f"Video analysis inconclusive — {aggregated_score:.0%} suspicion score across {coverage_n} frames."
        else:
            summary = f"Video analysis flags deepfake characteristics — {aggregated_score:.0%} suspicion score."

        return {
            "status":           "complete",
            "score":            pillar_score,
            "signals":          signals,
            "summary":          summary,
            "frames_sampled":   coverage_n,
            "frame_confidence": scalar,
            "high_variance":    high_variance,
        }

    except Exception as e:
        logger.exception("[deepfake] analysis error: %s", e)
        return _error_result(str(e))


def _frame_has_subject(child: dict) -> bool:
    for field in ("has_subject", "has_face", "has_human"):
        if field in child:
            return bool(child[field])
    return child.get("score") is not None


def _error_result(reason: str) -> dict:
    return {
        "status":  "error",
        "score":   None,
        "error":   reason,
        "signals": [],
        "summary": f"Video deepfake analysis unavailable — {reason}",
    }


def _no_token_result() -> dict:
    return {
        "status":  "skipped",
        "score":   0.5,
        "signals": [{
            "label":     "RESEMBLE_API_TOKEN not configured",
            "value":     "Set RESEMBLE_API_TOKEN in Railway environment variables",
            "weight":    "high",
            "suspicious": False,
        }],
        "summary": "Video deepfake analysis skipped — no Resemble API token configured.",
    }
