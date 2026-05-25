"""
Skept — Fusion & Scoring Service
Weighted ensemble combining analyser outputs into a final verdict band.

Weights:
  - C2PA (not yet in prototype): 0.25 — highest trust when present
  - Deepfake frame analysis:     0.40 — primary detection signal
  - Source reputation:           0.20 — durable behavioural signal
  - Metadata forensics:          0.15 — supporting context, capped at 0.5

Verdict bands:
  Green  0.0 – 0.30   Likely authentic
  Amber  0.30 – 0.60  Inconclusive
  Red    0.60 – 1.0   Likely manipulated
"""

WEIGHTS = {
    "metadata":          0.15,
    "source_reputation": 0.20,
    "c2pa":              0.25,
    "deepfake":          0.40,
}


def fuse(metadata: dict, source_reputation: dict, c2pa_result: dict, deepfake: dict) -> dict:
    """Combine analyser scores into a final verdict."""
    analyser_map = {
        "metadata":          metadata,
        "source_reputation": source_reputation,
        "c2pa":              c2pa_result,
        "deepfake":          deepfake,
    }

    scores        = {}
    total_weight  = 0.0
    weighted_sum  = 0.0

    for key, weight in WEIGHTS.items():
        analyser = analyser_map[key]
        if analyser.get("status") in ("complete", "skipped"):
            score = analyser.get("score")
            if score is None:
                continue
            scores[key]   = score
            weighted_sum += score * weight
            total_weight += weight

    if total_weight == 0:
        return _error_verdict("No analysers produced results.")

    final_score = round(weighted_sum / total_weight, 3)

    if final_score < 0.30:
        band        = "green"
        label       = "Likely authentic"
        description = (
            "Skept found no significant indicators of manipulation in this clip. "
            "Results reflect the submitted copy only — re-encoding may have degraded forensic signals."
        )
    elif final_score < 0.60:
        band        = "amber"
        label       = "Inconclusive"
        description = (
            "Skept detected some signals worth noting but cannot confirm manipulation. "
            "Platform re-encoding typically degrades artifact-level signals — "
            "a clean result here does not guarantee authenticity."
        )
    else:
        band        = "red"
        label       = "Likely manipulated"
        description = (
            "Skept detected multiple signals consistent with AI manipulation or synthetic generation. "
            "This verdict is based on the submitted copy and should be treated as investigative, "
            "not conclusive — re-analyse with the original file for stronger signal."
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
