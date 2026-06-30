/**
 * fuse(pillars) — weighted ensemble fusion for Skept analysis.
 *
 * Pillar input:
 *   { deepfake: { score, weight }, audio: { score, weight }, c2pa: { score, weight } }
 *   score may be null (excluded from fusion entirely).
 *
 * Returns:
 *   { score, verdict, active_denominator, pillar_detail, exclusion_reasons }
 */
export function fuse(pillars) {
  const detail = {};
  const exclusionReasons = [];

  for (const [name, p] of Object.entries(pillars)) {
    detail[name] = {
      score: p.score,
      weight: p.weight,
      excluded: false,
      excluded_reason: null,
      contribution: p.score !== null ? p.score * p.weight : 0.0,
    };
  }

  // Asymmetric audio-dubbing exclusion
  const df = pillars.deepfake;
  const au = pillars.audio;
  if (
    df.score !== null &&
    au.score !== null &&
    df.score < 0.10 &&
    au.score > 0.60
  ) {
    detail.deepfake.excluded = true;
    detail.deepfake.excluded_reason = 'audio_dubbing_pattern';
    detail.deepfake.contribution = 0.0;
    exclusionReasons.push('audio_dubbing_pattern');
  }

  // Null-score pillars are excluded
  for (const [name, p] of Object.entries(pillars)) {
    if (p.score === null) {
      detail[name].excluded = true;
      detail[name].contribution = 0.0;
    }
  }

  let numerator = 0.0;
  let denominator = 0.0;

  for (const [, d] of Object.entries(detail)) {
    if (!d.excluded && d.score !== null) {
      numerator += d.score * d.weight;
      denominator += d.weight;
    }
  }

  if (denominator === 0) {
    return {
      score: null,
      verdict: 'insufficient_data',
      active_denominator: 0,
      pillar_detail: detail,
      exclusion_reasons: exclusionReasons,
    };
  }

  const score = Math.round((numerator / denominator) * 1000) / 1000;

  // 5-band thresholds matching backend/analysers/fusion.py:152-186 (§3.89)
  let verdict;
  if (score < 0.20) {
    verdict = 'authentic';
  } else if (score < 0.50) {
    verdict = 'clean';
  } else if (score === 0.50) {
    verdict = 'ambiguous';
  } else if (score < 0.80) {
    verdict = 'suspicious';
  } else {
    verdict = 'manipulated';
  }

  return {
    score,
    verdict,
    active_denominator: denominator,
    pillar_detail: detail,
    exclusion_reasons: exclusionReasons,
  };
}
