"""
Skept — Video Deepfake Analyser (Resemble AI DETECT-3B Omni)

Submits the video file to the Resemble AI /api/v2/detect endpoint.
Parses video_metrics.score (top-level) and per-frame VideoFrameResult children for
frame confidence scalar, high-variance detection, and non-human content guard.

Score is already [0.0, 1.0] — no inversion needed (unlike audio path).
"""

import logging
import os
import statistics
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

RESEMBLE_API_TOKEN = os.getenv("RESEMBLE_API_TOKEN")
RESEMBLE_ENDPOINT  = "https://app.resemble.ai/api/v2/detect"
FRAMES_TO_SAMPLE   = int(os.getenv("SKEPT_FRAMES", "6"))

print(
    f"[deepfake] model=resemble_detect_v2_omni "
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

        item             = data.get("item", {})
        video_metrics    = item.get("video_metrics", {})
        pillar_score_raw = video_metrics.get("score")
        pillar_label     = video_metrics.get("label")
        children         = video_metrics.get("children") or []

        if pillar_score_raw is None:
            logger.warning("[deepfake] no video_metrics.score in Resemble response")
            return _error_result("No video_metrics.score in Resemble response")

        pillar_score_raw = float(pillar_score_raw)
        print(f"[deepfake] video_metrics.score={pillar_score_raw} video_metrics.label={pillar_label}", flush=True)

        # Safety guard: empty VideoResult wrapper or empty VideoChunkResult list → low_coverage
        if not children or not children[0].get("children"):
            print(f"[deepfake] guard=low_coverage reason=empty_children result=excluded", flush=True)
            logger.warning("[deepfake] status=low_coverage reason=empty_children score=None")
            return {
                "status":           "low_coverage",
                "score":            None,
                "frame_confidence": 0.0,
                "signals":          [],
                "summary":          "Insufficient frame data from Resemble — deepfake analysis excluded.",
                "high_variance":    False,
            }

        # Navigate: video_metrics.children[0] = VideoResult
        #           VideoResult.children       = list of VideoChunkResult
        #           VideoChunkResult.children  = list of VideoFrameResult
        chunks = children[0]["children"]
        frame_scores = [
            float(frame["score"])
            for chunk in chunks
            for frame in chunk.get("children", [])
            if frame.get("score") is not None
        ]

        # Non-human content guard
        valid_frame_count = len(frame_scores)
        if valid_frame_count <= 1:
            print(f"[deepfake] guard=non_human valid_frames={valid_frame_count} result=excluded", flush=True)
            logger.info("[deepfake] status=non_human frames=%d score=None", valid_frame_count)
            return {
                "status":           "non_human",
                "content_type":     "non_human",
                "score":            None,
                "frame_confidence": 0.0,
                "signals":          [],
                "summary":          "No human subject detected in video frames — deepfake analysis not applicable.",
                "high_variance":    False,
            }
        print(f"[deepfake] guard=non_human valid_frames={valid_frame_count} result=pass", flush=True)

        stdev_val = statistics.stdev(frame_scores) if len(frame_scores) > 1 else 0.0

        # Frame confidence scalar and final score
        scalar      = min(valid_frame_count / FRAMES_TO_SAMPLE, 1.0)
        final_score = round(pillar_score_raw * scalar, 3)

        # High-variance detection (reuses stdev_val computed above)
        high_variance = stdev_val > 0.25

        print(
            f"[deepfake] resemble_score={pillar_score_raw:.4f} "
            f"frames={valid_frame_count}/{FRAMES_TO_SAMPLE} "
            f"scalar={scalar:.4f} final={final_score:.4f}",
            flush=True,
        )
        logger.info(
            "[deepfake] resemble_score=%.4f frames=%d/%d scalar=%.4f final=%.4f high_variance=%s",
            pillar_score_raw, valid_frame_count, FRAMES_TO_SAMPLE, scalar, final_score, high_variance,
        )

        signals = [
            {
                "label":      "Frame coverage",
                "value":      f"{valid_frame_count} of {FRAMES_TO_SAMPLE} sampled frames scored",
                "weight":     "info",
                "suspicious": False,
            },
            {
                "label":      "Frame confidence scalar",
                "value":      f"{scalar:.0%}",
                "weight":     "info",
                "suspicious": False,
            },
            {
                "label":      "Video suspicion score",
                "value":      f"{pillar_score_raw:.0%}",
                "weight":     "high",
                "suspicious": pillar_score_raw > 0.5,
            },
        ]

        if high_variance:
            signals.append({
                "label":      "High score variance across frames",
                "value":      (
                    f"Scores ranged {min(frame_scores):.0%} – {max(frame_scores):.0%}. "
                    "May reflect scene cuts or multiple subjects."
                ),
                "weight":     "medium",
                "suspicious": False,
            })

        if pillar_score_raw < 0.3:
            summary = f"Video analysis found no deepfake indicators ({pillar_score_raw:.0%} suspicion score)."
        elif pillar_score_raw < 0.6:
            summary = f"Video analysis inconclusive — {pillar_score_raw:.0%} suspicion score across {valid_frame_count} frames."
        else:
            summary = f"Video analysis flags deepfake characteristics — {pillar_score_raw:.0%} suspicion score."

        return {
            "status":           "complete",
            "score":            final_score,
            "signals":          signals,
            "summary":          summary,
            "frames_sampled":   valid_frame_count,
            "frame_confidence": scalar,
            "high_variance":    high_variance,
        }

    except Exception as e:
        logger.exception("[deepfake] analysis error: %s", e)
        return _error_result(str(e))


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
            "label":      "RESEMBLE_API_TOKEN not configured",
            "value":      "Set RESEMBLE_API_TOKEN in Railway environment variables",
            "weight":     "high",
            "suspicious": False,
        }],
        "summary": "Video deepfake analysis skipped — no Resemble API token configured.",
    }
