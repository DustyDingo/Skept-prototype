"""
Skept — Video Deepfake Analyser (Resemble AI DETECT-3B Omni)

Submits the video file to the Resemble AI /api/v2/detect endpoint.
Parses video_metrics.score (top-level) and per-frame VideoFrameResult children for
frame confidence scalar, high-variance detection, and non-human content guard.

Score is already [0.0, 1.0] — no inversion needed (unlike audio path).
"""

import asyncio
import json
import logging
import os
import statistics
import subprocess
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


def _probe_duration(video_path: str) -> float | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            dur = json.loads(result.stdout).get("format", {}).get("duration")
            if dur:
                return float(dur)
    except Exception:
        pass
    return None


def _sample_video(video_path: str, duration: float) -> tuple[str, dict]:
    """Extract 4s from start and 4s centred on midpoint, concat into a single file.

    Intermediate files are cleaned up before returning. Caller must delete the
    returned path after Resemble submission.
    """
    workdir  = Path(video_path).parent
    seg_a    = workdir / "df_seg_a.mp4"
    seg_b    = workdir / "df_seg_b.mp4"
    concat   = workdir / "df_concat.txt"
    output   = workdir / "df_sampled.mp4"

    b_start = duration / 2.0 - 2.0
    b_end   = b_start + 4.0

    subprocess.run(
        ["ffmpeg", "-ss", "0", "-i", video_path, "-t", "4", "-c", "copy", str(seg_a), "-y", "-loglevel", "error"],
        capture_output=True, timeout=60,
    )
    subprocess.run(
        ["ffmpeg", "-ss", str(b_start), "-i", video_path, "-t", "4", "-c", "copy", str(seg_b), "-y", "-loglevel", "error"],
        capture_output=True, timeout=60,
    )
    concat.write_text(f"file '{seg_a}'\nfile '{seg_b}'\n")
    subprocess.run(
        ["ffmpeg", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(output), "-y", "-loglevel", "error"],
        capture_output=True, timeout=60,
    )

    for path in [seg_a, seg_b, concat]:
        try:
            path.unlink()
        except Exception:
            pass

    meta = {
        "sampled":               True,
        "original_duration_sec": round(duration, 1),
        "sample_strategy":       "start_mid_4s",
        "segment_a_start":       0,
        "segment_a_end":         4,
        "segment_b_start":       round(b_start, 1),
        "segment_b_end":         round(b_end, 1),
    }
    print(
        f"[deepfake] sampled=True strategy=start_mid_4s "
        f"original_duration={duration:.1f} "
        f"seg_a=0-4 seg_b={b_start:.1f}-{b_end:.1f}",
        flush=True,
    )
    return str(output), meta


async def run_deepfake(video_path: str) -> dict:
    if not RESEMBLE_API_TOKEN:
        return _no_token_result()

    logger.warning("[deepfake] starting — video=%r", video_path)
    sampled_path = None

    try:
        # §3.44 — 4s start + 4s mid segment strategy
        duration = await asyncio.to_thread(_probe_duration, video_path)
        sample_meta: dict = {"sampled": False}
        if duration is not None and duration > 8:
            sampled_path, sample_meta = await asyncio.to_thread(_sample_video, video_path, duration)
            submit_path = sampled_path
        else:
            submit_path = video_path

        async with httpx.AsyncClient(timeout=120) as client:
            with open(submit_path, "rb") as f:
                resp = await client.post(
                    RESEMBLE_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {RESEMBLE_API_TOKEN}",
                        "Prefer":        "wait",
                    },
                    files={"file": (Path(submit_path).name, f, "video/mp4")},
                )

        print(f"[deepfake] Resemble HTTP status={resp.status_code}", flush=True)
        print(f"[deepfake] Resemble raw body={resp.text[:500]}", flush=True)

        if resp.status_code != 200:
            logger.warning("[deepfake] Resemble API returned %d: %r", resp.status_code, resp.text[:200])
            return {**_error_result(f"Resemble API error {resp.status_code}"), "video_job_audio_label": None, **sample_meta}

        data = resp.json()
        if not data.get("success"):
            logger.warning("[deepfake] Resemble success=false: %r", resp.text[:300])
            return {**_error_result("Resemble returned success=false"), "video_job_audio_label": None, **sample_meta}

        item             = data.get("item", {})
        video_metrics    = item.get("video_metrics", {})
        pillar_score_raw = video_metrics.get("score")
        pillar_label     = video_metrics.get("label")
        children         = video_metrics.get("children") or []

        # Extract embedded audio score from the video job response (§3.42)
        _audio_raw   = item.get("metrics", {}).get("aggregated_score")
        _audio_label = item.get("metrics", {}).get("label")
        if _audio_raw is not None:
            _audio_raw_f = float(_audio_raw)
            video_job_audio_score = None if _audio_raw_f == -1.0 else round(_audio_raw_f, 6)
        else:
            video_job_audio_score = None
        video_job_audio_label = _audio_label
        _score_str = f"{float(_audio_raw):.6f}" if _audio_raw is not None else "None"
        print(f"[deepfake] video_job_audio_score={_score_str} video_job_audio_label={_audio_label}", flush=True)
        video_job_audio_exclusion_reason = (
            "no_speech_detected" if video_job_audio_score is None and _audio_raw is not None
            else "no_audio_stream" if video_job_audio_score is None
            else None
        )

        # Extract C2PA detection result from Resemble response
        _c2pa_raw = item.get("c2pa")
        print(f"[deepfake] resemble_c2pa={_c2pa_raw!r}", flush=True)
        if _c2pa_raw is None:
            c2pa_resemble_status = None
        elif isinstance(_c2pa_raw, dict):
            _c2pa_status = _c2pa_raw.get("status") or ""
            _c2pa_found  = _c2pa_raw.get("found") or _c2pa_raw.get("detected") or _c2pa_raw.get("present")
            if _c2pa_status:
                c2pa_resemble_status = "not_found" if "not" in _c2pa_status.lower() else "found"
            else:
                c2pa_resemble_status = "found" if _c2pa_found else "not_found"
        elif isinstance(_c2pa_raw, bool):
            c2pa_resemble_status = "found" if _c2pa_raw else "not_found"
        elif isinstance(_c2pa_raw, str):
            c2pa_resemble_status = "not_found" if "not" in _c2pa_raw.lower() else "found"
        else:
            c2pa_resemble_status = None

        if pillar_score_raw is None:
            logger.warning("[deepfake] no video_metrics.score in Resemble response")
            return {**_error_result("No video_metrics.score in Resemble response"), "video_job_audio_score": video_job_audio_score, "video_job_audio_label": video_job_audio_label, "video_job_audio_exclusion_reason": video_job_audio_exclusion_reason, "c2pa_resemble_status": c2pa_resemble_status, **sample_meta}

        pillar_score_raw = float(pillar_score_raw)
        print(f"[deepfake] video_metrics.score={pillar_score_raw} video_metrics.label={pillar_label}", flush=True)

        # Safety guard: empty VideoResult wrapper or empty VideoChunkResult list → low_coverage
        if not children or not children[0].get("children"):
            print(f"[deepfake] guard=low_coverage reason=empty_children result=excluded", flush=True)
            logger.warning("[deepfake] status=low_coverage reason=empty_children score=None")
            return {
                "status":                "low_coverage",
                "score":                 None,
                "frame_confidence":      0.0,
                "signals":               [],
                "summary":               "Insufficient frame data from Resemble — deepfake analysis excluded.",
                "high_variance":                    False,
                "video_job_audio_score":             video_job_audio_score,
                "video_job_audio_label":             video_job_audio_label,
                "video_job_audio_exclusion_reason":  video_job_audio_exclusion_reason,
                "c2pa_resemble_status":              c2pa_resemble_status,
                **sample_meta,
            }

        # Frame scalar replaced by certainty-weighted mean (§3.36 Option B)
        chunks = children[0]["children"]
        chunk_raw_scores = [float(c["score"]) for c in chunks if c.get("score") is not None]
        frame_data = [
            (float(frame["score"]), float(frame["certainty"]))
            for chunk in chunks
            for frame in chunk.get("children", [])
            if frame.get("score") is not None and frame.get("certainty") is not None
        ]

        # Certainty scalar: 1.0 when Resemble processed >= skept_frames; partial credit otherwise (§3.75)
        resemble_frame_count = len(frame_data)
        certainty_val    = min(FRAMES_TO_SAMPLE, resemble_frame_count) / FRAMES_TO_SAMPLE
        certainty_scalar = certainty_val

        # Non-human content guard
        if resemble_frame_count <= 1:
            print(f"[deepfake] guard=non_human resemble_frame_count={resemble_frame_count} skept_frames={FRAMES_TO_SAMPLE} result=excluded", flush=True)
            logger.info("[deepfake] status=non_human resemble_frame_count=%d score=None", resemble_frame_count)
            return {
                "status":                "non_human",
                "content_type":          "non_human",
                "score":                 None,
                "frame_confidence":      0.0,
                "signals":               [],
                "summary":                           "No human subject detected in video frames — deepfake analysis not applicable.",
                "high_variance":                     False,
                "resemble_video_score":              pillar_score_raw,
                "resemble_certainty":                certainty_val,
                "certainty":                         certainty_val,
                "final_score":                       round(max(0.0, min(1.0, pillar_score_raw * certainty_scalar)), 3),
                "video_metrics_label":               pillar_label,
                "video_job_audio_score":             video_job_audio_score,
                "video_job_audio_label":             video_job_audio_label,
                "video_job_audio_exclusion_reason":  video_job_audio_exclusion_reason,
                "c2pa_resemble_status":              c2pa_resemble_status,
                **sample_meta,
            }
        print(f"[deepfake] guard=non_human resemble_frame_count={resemble_frame_count} skept_frames={FRAMES_TO_SAMPLE} result=pass", flush=True)

        frame_scores = [s for s, c in frame_data]
        stdev_val    = statistics.stdev(frame_scores) if len(frame_scores) > 1 else 0.0

        # High-variance detection
        high_variance = stdev_val > 0.25

        # Use clip-level video_metrics.score as base; scale by certainty scalar (§3.75 follow-up)
        base_score = pillar_score_raw
        certainty_weighted_score = base_score * certainty_scalar
        deepfake_final = round(max(0.0, min(1.0, certainty_weighted_score)), 3)
        print(
            f"[deepfake] resemble_frame_count={resemble_frame_count} "
            f"skept_frames={FRAMES_TO_SAMPLE} "
            f"certainty_weighted_score={certainty_weighted_score:.4f} "
            f"certainty={certainty_val:.4f} "
            f"final_score={deepfake_final:.4f}",
            flush=True,
        )

        signals = [
            {
                "label":      "Frame coverage",
                "value":      f"{FRAMES_TO_SAMPLE} frames sampled · {resemble_frame_count} scored by Resemble",
                "weight":     "info",
                "suspicious": False,
            },
            {
                "label":      "Video suspicion score",
                "value":      f"{deepfake_final:.0%}",
                "weight":     "high",
                "suspicious": deepfake_final > 0.5,
            },
        ]

        if high_variance:
            _range_str = (
                f"Frame scores ranged {round(min(chunk_raw_scores) * 100)}%–{round(max(chunk_raw_scores) * 100)}%. "
                if chunk_raw_scores else "Frame scores varied. "
            )
            signals.append({
                "label":      "High score variance across frames",
                "value":      _range_str + "May reflect scene cuts or multiple subjects.",
                "weight":     "medium",
                "suspicious": False,
            })

        if pillar_score_raw > 0.50 and deepfake_final < 0.15:
            summary = "Visual analysis score adjusted for low face-detection coverage."
        elif base_score < 0.3:
            summary = f"Video analysis found no deepfake indicators ({base_score:.0%} suspicion score)."
        elif base_score < 0.6:
            summary = f"Video analysis inconclusive — {base_score:.0%} suspicion score across {resemble_frame_count} frames."
        else:
            summary = f"Video analysis flags deepfake characteristics — {base_score:.0%} suspicion score."

        return {
            "status":                "complete",
            "score":                 deepfake_final,
            "signals":               signals,
            "summary":               summary,
            "frames_sampled":        resemble_frame_count,
            "frame_confidence":      resemble_frame_count / max(FRAMES_TO_SAMPLE, 1),
            "high_variance":                    high_variance,
            "resemble_certainty":               certainty_val,
            "resemble_video_score":             pillar_score_raw,
            "video_metrics_label":              pillar_label,
            "video_job_audio_score":             video_job_audio_score,
            "video_job_audio_label":             video_job_audio_label,
            "video_job_audio_exclusion_reason":  video_job_audio_exclusion_reason,
            "c2pa_resemble_status":              c2pa_resemble_status,
            **sample_meta,
        }

    except Exception as e:
        logger.exception("[deepfake] analysis error: %s", e)
        return _error_result(str(e))
    finally:
        if sampled_path:
            try:
                Path(sampled_path).unlink(missing_ok=True)
            except Exception:
                pass


def _error_result(reason: str) -> dict:
    return {
        "status":                "error",
        "score":                 None,
        "error":                 reason,
        "signals":               [],
        "summary":               f"Video deepfake analysis unavailable — {reason}",
        "video_job_audio_score": None,
    }


def _no_token_result() -> dict:
    return {
        "status":                "skipped",
        "score":                 0.5,
        "signals":               [{
            "label":      "RESEMBLE_API_TOKEN not configured",
            "value":      "Set RESEMBLE_API_TOKEN in Railway environment variables",
            "weight":     "high",
            "suspicious": False,
        }],
        "summary":               "Video deepfake analysis skipped — no Resemble API token configured.",
        "video_job_audio_score": None,
    }
