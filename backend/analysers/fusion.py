"""
Skept — Fusion & Scoring Service
Weighted ensemble combining analyser outputs into a final verdict band.

Weights:
  - Deepfake frame analysis:     0.40 — primary detection signal
  - Audio & voice clone:         0.20 — voice synthesis classifier + heuristics
  - C2PA (not yet in prototype): 0.22 — highest trust when present
  - Source reputation:           0.15 — durable behavioural signal
  - Source behaviour:            0.15 — account bio / cross-platform identity
  - Metadata forensics:          0.08 — supporting context, capped at 0.5

Verdict bands:
  Green  0.0 – 0.30   Likely authentic
  Amber  0.30 – 0.60  Inconclusive
  Red    0.60 – 1.0   Likely manipulated

Scoring model assumption:
  All analyser inputs use a 50-anchored scale: 0.5 = no information (neutral),
  below 0.5 = evidence of authenticity, above 0.5 = evidence of manipulation.
  A weighted mean of all-0.5 inputs produces exactly 0.5 (amber/inconclusive),
  so absent or neutral signals correctly contribute no net push in either direction.
  C2PA and audio return score=None when unavailable; they are excluded from the
  denominator entirely so they do not dilute toward neutral.
"""

import logging

logger = logging.getLogger(__name__)

WEIGHTS = {
    "metadata":          0.08,
    "source_reputation": 0.15,
    "source_behaviour":  0.15,
    "c2pa":              0.22,
    "deepfake":          0.40,
    "audio":             0.20,
}

# Maximum denominator when all pillars active (C2PA always None in prototype):
# 0.08 + 0.15 + 0.15 + 0.40 + 0.20 = 0.98
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

    scores        = {}
    total_weight  = 0.0
    weighted_sum  = 0.0

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
    for key, weight in WEIGHTS.items():
        analyser = analyser_map[key]
        if analyser.get("status") in ("complete", "skipped"):
            score = analyser.get("score")
            if score is None:
                continue
            score         = max(0.0, min(1.0, score))
            scores[key]   = score
            weighted_sum += score * weight
            total_weight += weight

    if total_weight == 0:
        return _error_verdict("No analysers produced results.")

    final_score = round(weighted_sum / total_weight, 3)

    logger.warning(
        "[fusion] score=%.4f denominator=%.4f pillars=%s",
        final_score,
        total_weight,
        {k: {"score": round(s, 4), "weight": WEIGHTS[k], "contribution": round(s * WEIGHTS[k], 4)} for k, s in scores.items()},
    )
    _pillar_breakdown = {k: {"score": round(s, 4), "weight": WEIGHTS[k], "contribution": round(s * WEIGHTS[k], 4)} for k, s in scores.items()}
    print(f"[fusion] job score={final_score:.4f} denom={total_weight:.4f} pillars={_pillar_breakdown}", flush=True)

    if final_score < 0.30:
        band        = "green"
        label       = "Likely authentic"
        description = (
            "Skept found no significant indicators of manipulation in this clip. "
            "Results reflect the submitted copy only - re-encoding may have degraded forensic signals."
        )
    elif final_score < 0.60:
        band        = "amber"
        label       = "Inconclusive"
        description = (
            "Skept detected some signals worth noting but cannot confirm manipulation. "
            "Platform re-encoding typically degrades artifact-level signals - "
            "a clean result here does not guarantee authenticity."
        )
    else:
        band        = "red"
        label       = "Likely manipulated"
        description = (
            "Skept detected multiple signals consistent with AI manipulation or synthetic generation. "
            "This verdict is based on the submitted copy and should be treated as investigative, "
            "not conclusive - re-analyse with the original file for stronger signal."
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
        "band":            "amber",
        "label":           "Inconclusive",
        "score":           0.5,
        "description":     f"Analysis could not be completed: {reason}",
        "analyser_scores": {},
        "confidence":      "none",
        "disclaimer": (
            "Skept verdicts are probabilistic observations, not factual determinations."
        ),
    }
