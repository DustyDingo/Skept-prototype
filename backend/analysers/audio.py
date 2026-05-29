"""
analysers/audio.py — Audio & Voice Clone Detection

STATUS: Stub — reserved slot, not yet implemented.

Blocked on Railway GPU instance. Releases alongside face/lip-sync and
frame-level generative artifact pillars when GPU infrastructure is live.

Model selection pending empirical evaluation. Candidates:
  - AASIST (graph attention, spectral + temporal — current SOTA on ASVspoof)
  - RawNet2 (raw waveform, strong on codec artefacts)
  - Wav2Vec2-based classifiers (HF fine-tuned variants)

See: decision-record-audio-pillar.md

BIOMETRIC NOTE: Voice features are non-retained. Any intermediate embeddings
or spectral representations are discarded immediately after the detection
decision. Never stored, never logged.
"""

import os


REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")


async def analyse(video_path: str) -> dict:
    """
    Audio & voice clone detection.

    Currently a reserved stub — returns a skipped result with score=None
    so the fusion layer excludes it cleanly until the pillar is live.

    When implemented, will:
      1. Extract audio track from video_path (ffmpeg)
      2. Send to Replicate-hosted model (AASIST or RawNet2 — TBD)
      3. Return per-signal scores and a fused audio suspicion score 0.0–1.0

    Graceful skip conditions:
      - REPLICATE_API_TOKEN not set
      - No audio track present in video
      - Replicate API unreachable
    """
    if not REPLICATE_API_TOKEN:
        return {
            "analyser":     "audio",
            "status":       "skipped",
            "skip_reason":  "replicate_token_not_configured",
            "score":        None,
            "signal_cards": [],
            "summary":      "Audio pillar inactive — REPLICATE_API_TOKEN not configured.",
            "error":        None,
        }

    # TODO: implement when Railway GPU instance is live
    # 1. ffmpeg -i video_path -vn -acodec pcm_s16le -ar 16000 audio.wav
    # 2. Send to Replicate model
    # 3. Parse response into signal_cards and score
    # 4. Discard all intermediate audio features immediately after scoring

    return {
        "analyser":     "audio",
        "status":       "skipped",
        "skip_reason":  "not_implemented",
        "score":        None,
        "signal_cards": [],
        "summary":      "Audio pillar not yet implemented.",
        "error":        None,
    }
