"""
analysers/audio.py — Audio & Voice Clone Detection

Audio pillar score is sourced from the DETECT-3B Omni video-job embedded audio stream (§3.57).
The standalone audio.wav Resemble API call and librosa heuristics have been removed.
Score is passed in from deepfake.py's video_job_audio_score field after run_deepfake() completes.

video_job_audio_score is already on a [0.0, 1.0] suspicion scale — the (raw + 1) / 2
conversion is applied in deepfake.py before the value is returned.

BIOMETRIC NOTE: No audio extraction or spectral representation is retained.
"""

import logging

logger = logging.getLogger(__name__)


def analyse(video_job_audio_score: float | None) -> dict:
    if video_job_audio_score is None:
        print("[audio] video_job_audio_score=None — no speech or no signal — audio pillar excluded (score=None)", flush=True)
        return {
            "status":          "complete",
            "score":           None,
            "low_confidence":  True,
            "resemble_status": "no_speech_both",
            "audio_extracted": True,
            "error":           None,
            "signals":         [],
            "summary":         "No speech detected — voice clone analysis not applicable.",
        }

    score = round(max(0.0, min(1.0, video_job_audio_score)), 4)
    print(f"[audio] pillar_score={score:.4f} source=video_job_omni", flush=True)

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
