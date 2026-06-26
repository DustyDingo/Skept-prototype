"""
analysers/audio.py — Audio & Voice Clone Detection

Audio pillar score is sourced from video_job_audio_score, which deepfake.py
extracts from item["metrics"]["aggregated_score"] in the Resemble Omni video
job response and writes to the shared job dict.

Three cases evaluated in order:
  no_speech — Resemble returned the no-speech sentinel (-1.0) → score=None, excluded
  ok        — Valid Resemble score → passed through directly as suspicion magnitude
  error     — Score unavailable (API error, missing field, exception) → score=None, excluded

Negative Resemble scores map to 0.0 (definitely real = 0% suspicious).
Positive scores pass through directly as suspicion magnitude.

BIOMETRIC NOTE: No audio extraction or spectral representation is retained.
"""

import logging

logger = logging.getLogger(__name__)


def analyse(video_job_audio_score: float | None, audio_exclusion_reason: str | None = None) -> dict:
    if video_job_audio_score is None:
        if audio_exclusion_reason == "no_speech_detected":
            print(f"[audio] resemble sentinel -1.0 — no speech detected — pillar excluded (score=None)", flush=True)
            return {
                "status":                 "complete",
                "score":                  None,
                "low_confidence":         False,
                "resemble_status":        "no_speech",
                "audio_extracted":        True,
                "audio_exclusion_reason": audio_exclusion_reason,
                "error":                  None,
                "signals":                [],
                "summary":                "No speech detected — audio analysis excluded.",
            }
        print(f"[audio] resemble score unavailable — pillar excluded (score=None)", flush=True)
        return {
            "status":                 "complete",
            "score":                  None,
            "low_confidence":         False,
            "resemble_status":        "error",
            "audio_extracted":        False,
            "audio_exclusion_reason": audio_exclusion_reason,
            "error":                  None,
            "signals":                [],
            "summary":                "Audio analysis unavailable.",
        }

    score = round(max(0.0, video_job_audio_score), 4)
    print(f"[audio] resemble score={video_job_audio_score} label=None → pillar score={score:.4f}", flush=True)

    if score < 0.3:
        summary = f"Audio analysis found no voice-clone indicators ({score:.0%} suspicion score)."
    elif score < 0.6:
        summary = f"Audio signals inconclusive ({score:.0%} suspicion score)."
    else:
        summary = f"Audio signals indicate possible voice synthesis ({score:.0%} suspicion score)."

    return {
        "status":          "complete",
        "score":           score,
        "low_confidence":  False,
        "resemble_status": "ok",
        "audio_extracted": True,
        "error":           None,
        "signals": [
            {
                "label":      "Voice clone score (Omni embedded audio)",
                "value":      f"{round(score * 100):.0f}%",
                "suspicious": score > 0.5,
            }
        ],
        "summary": summary,
    }
