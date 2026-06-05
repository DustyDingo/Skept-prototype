"""
analysers/audio.py — Audio & Voice Clone Detection

Two sub-signals fused within the pillar:
  1. Resemble AI Detect API v2 (classifier) — requires RESEMBLE_API_KEY
  2. Local librosa heuristics (pitch variance, spectral flatness, ZCR variance)
     — runs when audio is extractable; degrades gracefully if librosa absent

Fusion:
  - Both available:  0.70 × classifier + 0.30 × heuristics_mean
  - Classifier only: classifier_score, low_confidence=False
  - Heuristics only: heuristics_mean,  low_confidence=True
  - Nothing:         score=None (excluded from fusion denominator)

BIOMETRIC NOTE: Voice features are non-retained. The extracted audio file is
deleted in a finally block immediately after scoring. No embeddings or spectral
representations are stored or logged.
"""

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

RESEMBLE_API_KEY  = os.getenv("RESEMBLE_API_KEY")
RESEMBLE_ENDPOINT = "https://app.resemble.ai/api/v2/detect"


async def analyse(video_path: str) -> dict:
    tmpdir = None
    try:
        tmpdir     = tempfile.mkdtemp(prefix="skept_audio_")
        audio_path = str(Path(tmpdir) / "audio.wav")

        subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                audio_path, "-y", "-loglevel", "error",
            ],
            capture_output=True,
            timeout=60,
        )

        audio_extracted = (
            Path(audio_path).exists() and Path(audio_path).stat().st_size > 0
        )

        if not audio_extracted:
            return _base_result(
                audio_extracted=False,
                error="No audio track found in video",
                signals=[{"label": "Audio track", "value": "Not found", "suspicious": True}],
                summary="No audio track found — voice clone analysis unavailable.",
            )

        # Run classifier and heuristics concurrently
        classifier_task = asyncio.create_task(_resemble_detect(audio_path))

        try:
            pitch_score, flatness_score, zcr_score, heuristics_available = (
                await asyncio.to_thread(_librosa_heuristics, audio_path)
            )
        except Exception as exc:
            logger.warning("[audio] heuristics error: %s", exc)
            pitch_score = flatness_score = zcr_score = None
            heuristics_available = False

        classifier_score, classifier_label, classifier_segments = await classifier_task

        # Compute mean of whichever heuristic scores are not None
        valid_h = [s for s in (pitch_score, flatness_score, zcr_score) if s is not None]
        heuristics_mean = round(sum(valid_h) / len(valid_h), 3) if valid_h else None

        # Pillar fusion
        if classifier_score is not None and heuristics_mean is not None:
            score          = round(classifier_score * 0.70 + heuristics_mean * 0.30, 3)
            low_confidence = False
        elif classifier_score is not None:
            score          = classifier_score
            low_confidence = False
        elif heuristics_mean is not None:
            score          = heuristics_mean
            low_confidence = True
        else:
            score          = None
            low_confidence = True

        signals = _build_signals(
            classifier_score, classifier_label,
            pitch_score, flatness_score, zcr_score,
            heuristics_available,
        )
        summary = _build_summary(score, low_confidence)

        return {
            "status":                  "complete",
            "score":                   score,
            "low_confidence":          low_confidence,
            "classifier_score":        classifier_score,
            "classifier_label":        classifier_label,
            "classifier_segments":     classifier_segments,
            "pitch_variance_score":    pitch_score,
            "spectral_flatness_score": flatness_score,
            "zcr_variance_score":      zcr_score,
            "heuristics_available":    heuristics_available,
            "audio_extracted":         True,
            "error":                   None,
            "signals":                 signals,
            "summary":                 summary,
        }

    except Exception as e:
        logger.exception("[audio] analysis error: %s", e)
        return _base_result(
            audio_extracted=False,
            error=str(e),
            signals=[],
            summary=f"Audio analysis failed: {e}",
            status="error",
        )
    finally:
        if tmpdir and Path(tmpdir).exists():
            shutil.rmtree(tmpdir, ignore_errors=True)


async def _resemble_detect(
    audio_path: str,
) -> tuple[float | None, str | None, list | None]:
    if not RESEMBLE_API_KEY:
        return None, None, None
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            with open(audio_path, "rb") as f:
                resp = await client.post(
                    RESEMBLE_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {RESEMBLE_API_KEY}",
                        "Prefer":        "wait",
                    },
                    files={"file": ("audio.wav", f, "audio/wav")},
                )

        if resp.status_code != 200:
            logger.warning(
                "[audio] Resemble API returned %d: %r", resp.status_code, resp.text[:200]
            )
            return None, None, None

        data = resp.json()
        logger.info("[audio] Resemble raw response: %s", data)
        try:
            if not data.get("success"):
                logger.warning("[audio] Resemble success=false: %r", resp.text[:300])
                return None, None, None

            metrics   = data["item"]["metrics"]
            raw_score = metrics.get("aggregated_score")
            if raw_score is None:
                logger.warning("[audio] Resemble returned None score — falling through to heuristics")
                return None, None, None
            classifier_score    = round(float(raw_score), 4)
            classifier_label    = metrics.get("label")
            classifier_segments = [float(s) for s in metrics.get("score", []) if s is not None]
            return classifier_score, classifier_label, classifier_segments
        except Exception as e:
            logger.warning("[audio] Resemble classifier unavailable: %s — heuristics only", e)
            return None, None, None

    except Exception as e:
        logger.warning("[audio] Resemble API error: %s", e)
        return None, None, None


def _librosa_heuristics(
    audio_path: str,
) -> tuple[float | None, float | None, float | None, bool]:
    try:
        import numpy as np
        import librosa
    except ImportError:
        return None, None, None, False

    y, sr = librosa.load(audio_path, sr=16000, mono=True, duration=30.0)

    # Pitch variance: low std dev → monotone → suspicious → higher score
    f0        = librosa.yin(y, fmin=50, fmax=500, sr=sr)
    f0_voiced = f0[f0 > 0]
    if len(f0_voiced) >= 10:
        variance      = float(np.std(f0_voiced))
        pitch_score   = round(max(0.0, min(1.0, 1.0 - (variance / 40.0))), 3)
    else:
        pitch_score   = 0.50  # insufficient voiced frames

    # Spectral flatness: high mean → noise-like → suspicious → higher score
    flatness        = librosa.feature.spectral_flatness(y=y)
    mean_flatness   = float(np.mean(flatness))
    flatness_score  = round(min(1.0, mean_flatness * 20.0), 3)

    # ZCR variance: low variance → unnaturally consistent → suspicious → higher score
    zcr          = librosa.feature.zero_crossing_rate(y)
    zcr_variance = float(np.var(zcr))
    zcr_score    = round(max(0.0, min(1.0, 1.0 - (zcr_variance / 0.01))), 3)

    return pitch_score, flatness_score, zcr_score, True


def _build_signals(
    classifier_score, classifier_label,
    pitch_score, flatness_score, zcr_score,
    heuristics_available,
):
    signals = []

    # Classifier row
    if RESEMBLE_API_KEY:
        if classifier_score is not None:
            label_suffix = f" ({classifier_label})" if classifier_label else ""
            signals.append({
                "label":     "Voice clone classifier",
                "value":     f"{round(classifier_score * 100):.0f}%{label_suffix}",
                "suspicious": classifier_score > 0.5,
            })
        else:
            signals.append({
                "label":     "Voice clone classifier",
                "value":     "API error",
                "suspicious": False,
            })
    else:
        signals.append({
            "label":     "Voice clone classifier",
            "value":     "API key not set — heuristics only",
            "suspicious": False,
        })

    # Heuristic rows
    if heuristics_available:
        for label, score in (
            ("Pitch variance",    pitch_score),
            ("Spectral flatness", flatness_score),
            ("ZCR variance",      zcr_score),
        ):
            value = f"{round(score * 100):.0f}% suspicion" if score is not None else "N/A"
            signals.append({
                "label":     label,
                "value":     value,
                "suspicious": score is not None and score > 0.6,
            })
    else:
        signals.append({
            "label":     "Prosody heuristics",
            "value":     "Unavailable (librosa not installed)",
            "suspicious": False,
        })

    return signals


def _build_summary(score: float | None, low_confidence: bool) -> str:
    if score is None:
        return "Audio analysis produced no usable signal."
    if score < 0.3:
        s = f"Audio signals suggest authentic speech (suspicion score: {score:.0%})."
    elif score < 0.6:
        s = f"Audio signals inconclusive (suspicion score: {score:.0%})."
    else:
        s = f"Audio signals indicate possible voice synthesis (suspicion score: {score:.0%})."
    if low_confidence:
        s += " Heuristics only — Resemble AI classifier not active."
    return s


def _base_result(
    *,
    audio_extracted: bool,
    error: str | None,
    signals: list,
    summary: str,
    status: str = "complete",
) -> dict:
    return {
        "status":                  status,
        "score":                   None,
        "low_confidence":          True,
        "classifier_score":        None,
        "classifier_label":        None,
        "classifier_segments":     None,
        "pitch_variance_score":    None,
        "spectral_flatness_score": None,
        "zcr_variance_score":      None,
        "heuristics_available":    False,
        "audio_extracted":         audio_extracted,
        "error":                   error,
        "signals":                 signals,
        "summary":                 summary,
    }
