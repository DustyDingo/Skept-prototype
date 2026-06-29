"""
Skept — Fusion & Scoring Service
Weighted ensemble combining analyser outputs into a final verdict band.

Verdict pillars (contribute to fusion score):
  - Deepfake video analysis:     0.60 — primary detection signal (§3.33)
  - Audio & voice clone:         0.35 — voice synthesis classifier + heuristics (§3.33)
  - C2PA (not yet in prototype): 0.40 — highest trust when present (stub, excluded when None)

Source Details pillars (run on every job, feed evidence card only — §3.33):
  - Metadata forensics:          not in denominator
  - Source reputation:           not in denominator
  - Source behaviour:            not in denominator

Verdict bands:
  Green      0.00 – <0.20  Authentic      (band: authentic)
  LightGreen 0.20 – 0.49   Ambiguous      (band: clean)
  Amber      exactly 0.50  Inconclusive   (band: ambiguous)
  Orange     0.51 – 0.79   Suspicious     (band: suspicious)
  Red        0.80 – 1.00   Manipulated    (band: manipulated)

Scoring model assumption:
  All analyser inputs use a 50-anchored scale: 0.5 = no information (neutral),
  below 0.5 = evidence of authenticity, above 0.5 = evidence of manipulation.
  A weighted mean of all-0.5 inputs produces exactly 0.5 (amber/inconclusive),
  so absent or neutral signals correctly contribute no net push in either direction.
  Pillars returning score=None are excluded from the denominator entirely.
  The denominator self-adjusts: if deepfake or audio returns None, the remaining
  active pillar weights normalise to 1.0 automatically.
"""

import logging

logger = logging.getLogger(__name__)

WEIGHTS = {
    "deepfake": 0.60,
    "audio":    0.35,
    "c2pa":     0.40,  # reserved — stub returns None, excluded from denominator
}
# Source Details pillars (metadata, source_rep, source_beh) excluded from fusion denominator per §3.33. Evidence card only.

# Maximum denominator when all verdict pillars active (C2PA always None in prototype):
# 0.60 + 0.35 = 0.95
_MAX_ACTIVE_DENOM = sum(w for k, w in WEIGHTS.items() if k != "c2pa")
print(f"[fusion] max denominator (C2PA excluded) = {_MAX_ACTIVE_DENOM:.2f}", flush=True)


def fuse(
    metadata: dict,
    source_reputation: dict,
    source_behaviour: dict,
    c2pa_result: dict,
    deepfake: dict,
    audio: dict | None = None,
) -> dict:
    """Combine analyser scores into a final verdict."""
    analyser_map = {
        "metadata":          metadata,
        "source_reputation": source_reputation,
        "source_behaviour":  source_behaviour,
        "c2pa":              c2pa_result,
        "deepfake":          deepfake,
        "audio":             audio or {},
    }

    scores = {}

    # §3.30 — Pillar scoring principle
    # A pillar score may only move below 0.5 (toward authentic) if the analyser
    # found positive evidence of authenticity. Absence of a manipulation signal
    # is not evidence of authenticity.
    #
    # Four valid pillar states:
    #   score > 0.5   — suspicious signal detected
    #   score = 0.5   — ran fully; no suspicious signal; no positive authentic verification
    #   score < 0.5   — positive authentic signal (earned, not default)
    #   score = None  — insufficient data or unavailable; excluded from denominator
    for key in WEIGHTS:
        analyser = analyser_map[key]
        if analyser.get("status") in ("complete", "skipped"):
            score = analyser.get("score")
            if score is None:
                continue
            scores[key] = max(0.0, min(1.0, score))

    # §3.37 — Asymmetric exclusion for audio-dubbing pattern
    # When the visual classifier votes strongly authentic (<0.10) but audio votes
    # suspicious (>0.60), the faceswap model has no meaningful signal on dubbed
    # content. Exclude deepfake from the denominator so the audio signal carries
    # the verdict at its normalised weight. The deepfake score is still returned
    # in the job result dict and shown in the evidence card.
    #
    # §3.51 — Condition gates on video_job_audio_score (the raw Resemble video-job
    # embedded audio score, pre-blend), not on audio.py's pillar score. The video-job
    # audio score is the correct dubbing-pattern signal; the pillar score may be
    # dampened below 0.60 by the consistency scalar or librosa blend. Fusion score
    # when exclusion fires still uses audio.py's pillar score (scores["audio"]).
    _deepfake_s  = scores.get("deepfake")
    _audio_s     = scores.get("audio")
    _vj_audio_s  = deepfake.get("video_job_audio_score")
    asymmetric_exclusion = (
        _deepfake_s is not None
        and _deepfake_s < 0.10
        and _vj_audio_s is not None
        and _vj_audio_s > 0.60
    )
    if asymmetric_exclusion:
        # Use audio.py's original pillar score (pre-§3.42 video-job override) for the fusion
        # contribution.  The video_job_audio_score is only the trigger signal; once it fires,
        # the fusion weight must reflect what audio.py actually scored, not the inflated
        # video-job-derived value that §3.42 may have written into audio_result["score"].
        _original = (audio or {}).get("original_score")
        if _original is not None:
            scores["audio"] = max(0.0, min(1.0, _original))
            _audio_s = scores["audio"]
        print(
            f"[fusion] audio_dubbing_pattern — deepfake excluded. score={_audio_s:.4f} denom=0.35",
            flush=True,
        )
        print(
            f"[fusion] audio pillar score for fusion: {scores['audio']:.4f} (from audio.py); effective_au for trigger: {_vj_audio_s:.4f}",
            flush=True,
        )

    total_weight = 0.0
    weighted_sum = 0.0
    for key, score in scores.items():
        if asymmetric_exclusion and key == "deepfake":
            continue  # excluded from both numerator and denominator — weight 0.60 not counted
        weight        = WEIGHTS[key]
        weighted_sum += score * weight
        total_weight += weight

    if total_weight == 0:
        return _error_verdict("No analysers produced results.")

    final_score = round(weighted_sum / total_weight, 3)

    _pillar_breakdown = {k: {"score": round(s, 4), "weight": WEIGHTS[k], "contribution": round(s * WEIGHTS[k], 4)} for k, s in scores.items()}
    if asymmetric_exclusion and "deepfake" in _pillar_breakdown:
        _pillar_breakdown["deepfake"]["contribution"] = 0.0
        _pillar_breakdown["deepfake"]["excluded_reason"] = "audio_dubbing_pattern"
    logger.warning(
        "[fusion] score=%.4f denominator=%.4f pillars=%s",
        final_score,
        total_weight,
        _pillar_breakdown,
    )
    print(f"[fusion] job score={final_score:.4f} denom={total_weight:.4f} pillars={_pillar_breakdown}", flush=True)

    if final_score < 0.20:
        band        = "authentic"
        label       = "Authentic"
        description = (
            "No significant manipulation signals found. "
            "Results reflect the submitted copy only — re-encoding may have degraded forensic signals."
        )
    elif final_score < 0.50:
        band        = "clean"
        label       = "Ambiguous"
        description = (
            "Minimal signals detected. The clip leans authentic but some uncertainty remains — "
            "re-analyse with the original file for stronger signal."
        )
    elif final_score == 0.50:
        band        = "ambiguous"
        label       = "Inconclusive"
        description = (
            "No signals detected in either direction. The clip could not be verified as authentic "
            "or manipulated — seek additional sources and editorial judgement."
        )
    elif final_score < 0.80:
        band        = "suspicious"
        label       = "Suspicious"
        description = (
            "Skept detected signals consistent with potential manipulation. "
            "This does not confirm manipulation — treat as investigative and seek corroborating evidence."
        )
    else:
        band        = "manipulated"
        label       = "Manipulated"
        description = (
            "Skept detected multiple strong signals consistent with AI manipulation or synthetic generation. "
            "Treat this clip with high suspicion — cross-reference with verified sources and original file."
        )

    return {
        "band":            band,
        "label":           label,
        "score":           final_score,
        "description":     description,
        "analyser_scores": scores,
        "confidence":      _confidence_label(total_weight, scores),
        "disclaimer": (
            "Skept verdicts are probabilistic observations, not factual determinations. "
            "Platform compression reduces forensic signal quality. Always apply editorial judgement."
        ),
    }


def _confidence_label(total_weight: float, scores: dict) -> str:
    if total_weight >= 0.60 and len(scores) >= 2:
        return "moderate"
    elif total_weight >= 0.40:
        return "low"
    else:
        return "very low"


def _error_verdict(reason: str) -> dict:
    return {
        "band":            "ambiguous",
        "label":           "Inconclusive",
        "score":           0.5,
        "description":     f"Analysis could not be completed: {reason}",
        "analyser_scores": {},
        "confidence":      "none",
        "disclaimer": (
            "Skept verdicts are probabilistic observations, not factual determinations."
        ),
    }
