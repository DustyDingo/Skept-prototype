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
from dataclasses import dataclass, field


REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")


@dataclass
class AudioResult:
    skipped: bool = True
    score: float = 0.0
    # Sub-signals — populated when live
    voice_clone_score: float | None = None
    synthesis_artifact_score: float | None = None
    prosody_anomaly_score: float | None = None
    model_used: str | None = None
    error: str | None = None
    signals: list = field(default_factory=list)


async def analyse(video_path: str) -> AudioResult:
    """
    Audio & voice clone detection.

    Currently a reserved stub — returns a skipped result with score 0.0
    so the fusion layer can ignore it cleanly until the pillar is live.

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
        return AudioResult(
            skipped=True,
            score=0.0,
            error="REPLICATE_API_TOKEN not configured — audio pillar inactive"
        )

    # TODO: implement when Railway GPU instance is live
    # 1. ffmpeg -i video_path -vn -acodec pcm_s16le -ar 16000 audio.wav
    # 2. Send to Replicate model
    # 3. Parse response into AudioResult fields
    # 4. Discard all intermediate audio features immediately after scoring

    return AudioResult(
        skipped=True,
        score=0.0,
        error="Audio pillar not yet implemented"
    )
