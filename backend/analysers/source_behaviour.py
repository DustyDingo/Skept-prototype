"""
Skept — Source Behaviour & Bio Analyser
TikTok-focused. Extracts account metadata via yt-dlp and scores three signals:
  1. Posting cadence burst patterns (peak 7-day window, CV, max single-day posts)
  2. Bio cross-platform link parsing and HTTP verification
  3. Cross-platform identity absence weighted by follower count and account age

Account age, post volume, follower count, and username pattern belong to
source_reputation.py. Follower count and account age are fetched here only
as context for scoring the identity_absence signal — they are not surfaced
as signal cards in this pillar.
"""

import asyncio
import logging
import re
import statistics
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

import httpx
import yt_dlp

logger = logging.getLogger(__name__)

MAX_POSTS      = 30
VERIFY_TIMEOUT = 5.0

SIGNAL_WEIGHTS = {
    "burst_cadence":      0.40,
    "bio_cross_platform": 0.35,
    "identity_absence":   0.25,
}

# ── Bio text parsers ─────────────────────────────────────────────────────────

_PLATFORM_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?"
    r"(instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be"
    r"|facebook\.com|snapchat\.com|twitch\.tv|linkedin\.com"
    r"|threads\.net|bsky\.app|reddit\.com)"
    r"(?:/[\w.\-@%+]*)?",
    re.IGNORECASE,
)

_LINKPAGE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?"
    r"(linktr\.ee|beacons\.ai|bio\.link|linkin\.bio|lnk\.bio|carrd\.co|msha\.ke)"
    r"(?:/[\w.\-]*)?",
    re.IGNORECASE,
)

_AT_HANDLE_RE = re.compile(r"(?<!\w)@([\w.]{2,30})(?!\w)")

_PLATFORM_KEYWORDS_RE = re.compile(
    r"\b(instagram|youtube|twitter|facebook|snapchat|twitch|linkedin"
    r"|threads|bluesky|tiktok|reddit|pinterest)\b",
    re.IGNORECASE,
)

# ── TikTok URL → account handle ──────────────────────────────────────────────

_TIKTOK_HANDLE_RE = re.compile(r"tiktok\.com/@([\w.]+)", re.IGNORECASE)


def _extract_tiktok_handle(url: str) -> Optional[str]:
    m = _TIKTOK_HANDLE_RE.search(url)
    return m.group(1) if m else None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PUBLIC INTERFACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def run_source_behaviour(url: str) -> dict:
    """Async entry point matching the run_* naming convention."""
    result = _base_result()

    handle = _extract_tiktok_handle(url)
    if not handle:
        return _skip(result, "non_tiktok_url")

    result["account_handle"] = handle
    account_url = f"https://www.tiktok.com/@{handle}"

    try:
        entries, account_meta = await asyncio.to_thread(
            _fetch_account_data, account_url
        )
    except Exception as exc:
        logger.error(f"[source_behaviour] fetch failed: {exc}", exc_info=True)
        return _skip(result, "account_fetch_error")

    if entries is None:
        return _skip(result, "account_fetch_blocked")
    if not entries:
        return _skip(result, "no_posts_accessible")

    bio_text       = account_meta.get("description") or account_meta.get("channel_description") or ""
    follower_count = account_meta.get("channel_follower_count")

    bio_refs      = _parse_bio(bio_text)
    verified_refs = await _verify_refs(bio_refs)

    signals = _compute_signals(entries, follower_count, bio_text, bio_refs, verified_refs)
    score, flags, confidence = _score(signals)

    if score is None:
        return _skip(result, "insufficient_data")

    result.update({
        "status":       "complete",
        "score":        score,
        "confidence":   confidence,
        "flags":        flags,
        "signals":      signals,
        "signal_cards": _build_signal_cards(signals, flags, bio_refs, verified_refs),
        "summary":      _build_summary(signals, flags, handle, bio_refs, verified_refs),
    })
    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ACCOUNT DATA FETCH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _fetch_account_data(account_url: str) -> tuple[Optional[list], dict]:
    ydl_opts = {
        "quiet":          True,
        "no_warnings":    True,
        "extract_flat":   True,
        "playlistend":    MAX_POSTS,
        "socket_timeout": 12,
        "retries":        1,
        "ignoreerrors":   True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(account_url, download=False)
        if info is None:
            return None, {}
        if info.get("_type") == "video":
            return [info], info
        entries      = [e for e in (info.get("entries") or []) if e is not None]
        account_meta = {k: v for k, v in info.items() if k != "entries"}
        return entries, account_meta
    except Exception as exc:
        logger.warning(f"[source_behaviour] yt-dlp failed ({account_url}): {exc}")
        return None, {}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BIO PARSING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _parse_bio(bio: str) -> list[dict]:
    """
    Extract distinct cross-platform references from bio text.
    Returns list of {type, domain, raw, verify_url}.
    """
    if not bio:
        return []

    found:     list[dict] = []
    seen_urls: set[str]   = set()

    def _add(ref: dict) -> None:
        key = ref["verify_url"].lower()
        if key not in seen_urls:
            seen_urls.add(key)
            found.append(ref)

    for m in _PLATFORM_URL_RE.finditer(bio):
        domain = m.group(1).lower()
        raw    = m.group(0).strip()
        full   = raw if raw.startswith("http") else "https://" + raw
        _add({"type": "platform_url", "domain": domain, "raw": raw, "verify_url": full})

    for m in _LINKPAGE_RE.finditer(bio):
        domain = m.group(1).lower()
        raw    = m.group(0).strip()
        full   = raw if raw.startswith("http") else "https://" + raw
        _add({"type": "linkpage", "domain": domain, "raw": raw, "verify_url": full})

    # @handle mentions — only include when a platform keyword appears in the bio
    if _PLATFORM_KEYWORDS_RE.search(bio):
        for m in _AT_HANDLE_RE.finditer(bio):
            handle = m.group(1)
            raw    = f"@{handle}"
            key    = f"@{handle.lower()}"
            if key not in seen_urls:
                seen_urls.add(key)
                found.append({
                    "type":       "at_handle",
                    "domain":     "unknown",
                    "raw":        raw,
                    "verify_url": "",  # no URL to check for bare @handles
                })

    return found


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CROSS-PLATFORM VERIFICATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def _verify_refs(refs: list[dict]) -> dict[str, str]:
    """
    HTTP HEAD each verifiable ref. Returns {verify_url: status}
    where status is 'exists' | 'not_found' | 'error'.
    """
    results: dict[str, str] = {}

    verifiable = [r for r in refs if r["verify_url"]]
    if not verifiable:
        return results

    async def _check(ref: dict) -> None:
        url = ref["verify_url"]
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=VERIFY_TIMEOUT,
                headers={"User-Agent": "Mozilla/5.0 (compatible; Skept/0.1)"},
            ) as client:
                resp = await client.head(url)
            if resp.status_code < 400:
                results[url] = "exists"
            elif resp.status_code == 404:
                results[url] = "not_found"
            else:
                results[url] = "error"
        except Exception:
            results[url] = "error"

    await asyncio.gather(*[_check(r) for r in verifiable])
    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SIGNAL COMPUTATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _parse_date(post: dict) -> Optional[datetime]:
    d_str = post.get("upload_date")
    if d_str and isinstance(d_str, str) and len(d_str) == 8:
        try:
            return datetime(int(d_str[:4]), int(d_str[4:6]), int(d_str[6:8]),
                            tzinfo=timezone.utc)
        except ValueError:
            pass
    ts = post.get("timestamp")
    if ts is not None:
        try:
            return datetime.fromtimestamp(float(ts), tz=timezone.utc)
        except (ValueError, OSError):
            pass
    return None


def _compute_signals(
    posts: list,
    follower_count: Optional[int],
    bio_text: str,
    bio_refs: list[dict],
    verified_refs: dict[str, str],
) -> dict:
    now     = datetime.now(timezone.utc)
    signals = {}

    dates = sorted(d for d in (_parse_date(p) for p in posts) if d)

    # ── Context fields for identity_absence scoring (not shown as cards) ──────
    if dates:
        signals["_account_age_days"] = max((now - dates[0]).days, 1)
    if follower_count is not None:
        signals["_follower_count"] = follower_count

    # ── Signal 1: burst cadence ──────────────────────────────────────────────
    if len(dates) >= 3:
        gaps     = [(dates[i+1] - dates[i]).total_seconds() / 3600
                    for i in range(len(dates) - 1)]
        mean_gap = statistics.mean(gaps)
        if mean_gap > 0:
            signals["cadence_cv"]     = round(statistics.stdev(gaps) / mean_gap, 3)
            signals["mean_gap_hours"] = round(mean_gap, 2)

        day_counts    = Counter(d.date() for d in dates)
        max_day_posts = max(day_counts.values())
        signals["max_posts_single_day"] = max_day_posts

        window_seconds = 7 * 86400
        max_in_window  = 0
        for anchor in dates:
            in_window = sum(
                1 for d in dates
                if 0 <= (d - anchor).total_seconds() <= window_seconds
            )
            max_in_window = max(max_in_window, in_window)
        signals["max_7d_window_posts"] = max_in_window
        signals["max_7d_window_pct"]   = round(max_in_window / len(dates), 3)

    # ── Signals 2 & 3: bio cross-platform ────────────────────────────────────
    platform_url_refs = [r for r in bio_refs if r["type"] in ("platform_url", "linkpage")]
    verifiable_refs   = [r for r in bio_refs if r["verify_url"]]
    exists_count      = sum(1 for r in verifiable_refs
                            if verified_refs.get(r["verify_url"]) == "exists")
    not_found_count   = sum(1 for r in verifiable_refs
                            if verified_refs.get(r["verify_url"]) == "not_found")

    signals["bio_text_length"]        = len(bio_text)
    signals["bio_refs_found"]         = len(bio_refs)
    signals["bio_platform_urls"]      = len(platform_url_refs)
    signals["bio_verified_exists"]    = exists_count
    signals["bio_verified_not_found"] = not_found_count

    return signals


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SCORING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _score(signals: dict) -> tuple[Optional[float], list[str], float]:
    sub_scores:  dict[str, float] = {}
    flags:       list[str]        = []
    data_points: int              = 0

    # ── Signal 1: burst cadence ──────────────────────────────────────────────
    cv            = signals.get("cadence_cv")
    max_day_posts = signals.get("max_posts_single_day")
    max_7d_pct    = signals.get("max_7d_window_pct")

    if cv is not None or max_7d_pct is not None:
        data_points += 1
        burst_score = 0.10

        if max_7d_pct is not None and max_7d_pct > 0.75:
            burst_score = max(burst_score, 0.88); flags.append("activity_concentrated_in_burst")
        elif max_7d_pct is not None and max_7d_pct > 0.55:
            burst_score = max(burst_score, 0.55); flags.append("elevated_burst_concentration")

        if cv is not None:
            if cv > 2.5:
                burst_score = max(burst_score, 0.85); flags.append("extreme_cadence_irregularity")
            elif cv > 1.5:
                burst_score = max(burst_score, 0.60); flags.append("irregular_cadence")

        if max_day_posts is not None and max_day_posts >= 5:
            burst_score = max(burst_score, 0.65); flags.append("multi_post_day_detected")

        sub_scores["burst_cadence"] = burst_score

    # ── Signal 2: bio cross-platform ─────────────────────────────────────────
    refs_found   = signals.get("bio_refs_found", 0)
    exists_count = signals.get("bio_verified_exists", 0)
    nf_count     = signals.get("bio_verified_not_found", 0)
    verifiable   = exists_count + nf_count

    data_points += 1  # bio always checked

    if refs_found == 0:
        sub_scores["bio_cross_platform"] = 0.0  # absence handled by identity_absence
    elif verifiable > 0 and nf_count > 0 and exists_count == 0:
        sub_scores["bio_cross_platform"] = 0.78; flags.append("bio_links_all_dead")
    elif verifiable > 0 and nf_count > exists_count:
        sub_scores["bio_cross_platform"] = 0.50; flags.append("bio_links_mostly_dead")
    elif exists_count >= 2:
        sub_scores["bio_cross_platform"] = 0.05
    elif exists_count >= 1:
        sub_scores["bio_cross_platform"] = 0.10
    else:
        sub_scores["bio_cross_platform"] = 0.20  # refs found but none verifiable

    # ── Signal 3: cross-platform identity absence ────────────────────────────
    followers = signals.get("_follower_count")
    age       = signals.get("_account_age_days")

    if refs_found > 0:
        sub_scores["identity_absence"] = 0.0
    elif followers is not None and age is not None:
        data_points += 1
        if followers > 100_000 and age > 180:
            sub_scores["identity_absence"] = 0.85; flags.append("high_follower_no_bio_links")
        elif followers > 50_000 and age > 90:
            sub_scores["identity_absence"] = 0.70; flags.append("established_account_no_bio_links")
        elif followers > 10_000 and age > 60:
            sub_scores["identity_absence"] = 0.45
        elif followers > 1_000 and age > 30:
            sub_scores["identity_absence"] = 0.25
        else:
            sub_scores["identity_absence"] = 0.08
    else:
        sub_scores["identity_absence"] = 0.0

    if not sub_scores:
        return None, [], 0.0

    total_weight = sum(SIGNAL_WEIGHTS[k] for k in sub_scores)
    composite    = sum(sub_scores[k] * SIGNAL_WEIGHTS[k] for k in sub_scores) / total_weight
    confidence   = round(min(data_points / len(SIGNAL_WEIGHTS), 1.0) * 0.9, 2)

    return round(composite, 3), flags, confidence


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# OUTPUT FORMATTING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _build_summary(
    signals: dict,
    flags: list[str],
    handle: str,
    bio_refs: list[dict],
    verified_refs: dict[str, str],
) -> str:
    parts = []
    name  = f"@{handle}"

    max_7d_pct = signals.get("max_7d_window_pct")
    cv         = signals.get("cadence_cv")
    max_day    = signals.get("max_posts_single_day")

    if max_7d_pct is not None and max_7d_pct > 0.55:
        parts.append(
            f"{int(max_7d_pct * 100)}% of {name}'s observed posts fall within "
            "a single 7-day window, consistent with burst-posting behaviour"
        )
    elif cv is not None:
        regularity = "irregular" if cv > 1.5 else "consistent"
        parts.append(f"{name} shows {regularity} posting timing (variance score {cv:.2f})")

    if max_day is not None and max_day >= 5:
        parts.append(f"peak of {max_day} posts on a single day detected")

    if bio_refs:
        exists = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "exists")
        nf     = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "not_found")
        verif_str = (
            f"{exists} verified, {nf} unreachable" if (exists + nf) > 0
            else "not verifiable"
        )
        refs_str = ", ".join(r["raw"] for r in bio_refs[:3])
        if len(bio_refs) > 3:
            refs_str += f" +{len(bio_refs) - 3} more"
        parts.append(
            f"bio contains {len(bio_refs)} cross-platform reference(s) "
            f"({refs_str}; {verif_str})"
        )
    else:
        followers = signals.get("_follower_count")
        if followers is not None and followers > 10_000:
            parts.append(
                f"bio contains no cross-platform links despite {followers:,} followers"
            )
        else:
            parts.append("bio contains no cross-platform links")

    if not parts:
        return "Insufficient data for source behaviour analysis."
    sentence = "; ".join(parts)
    return sentence[0].upper() + sentence[1:] + "."


def _build_signal_cards(
    signals: dict,
    flags: list[str],
    bio_refs: list[dict],
    verified_refs: dict[str, str],
) -> list[dict]:
    cards = []

    # ── Cadence / burst cards ─────────────────────────────────────────────────
    max_7d = signals.get("max_7d_window_pct")
    if max_7d is not None:
        cards.append({
            "label":      "Peak 7-day window concentration",
            "value":      f"{int(max_7d * 100)}%",
            "suspicious": max_7d > 0.75,
            "weight":     "high",
        })

    cv = signals.get("cadence_cv")
    if cv is not None:
        cards.append({
            "label":      "Posting timing variance (CV)",
            "value":      f"{cv:.2f}",
            "suspicious": cv > 1.5,
            "weight":     "medium",
        })

    max_day = signals.get("max_posts_single_day")
    if max_day is not None:
        cards.append({
            "label":      "Max posts in a single day",
            "value":      str(max_day),
            "suspicious": max_day >= 5,
            "weight":     "medium",
        })

    # ── Bio cross-platform cards ──────────────────────────────────────────────
    if bio_refs:
        exists      = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "exists")
        nf          = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "not_found")
        verif_label = f"{exists} live, {nf} dead" if (exists + nf) > 0 else "unverifiable"
        cards.append({
            "label":      "Bio cross-platform links",
            "value":      f"{len(bio_refs)} found ({verif_label})",
            "suspicious": nf > 0 and exists == 0,
            "weight":     "high",
        })
        for r in bio_refs[:5]:
            status       = verified_refs.get(r["verify_url"], "unverifiable")
            status_label = {"exists": "✓ live", "not_found": "✗ dead", "error": "timeout"}.get(status, "—")
            cards.append({
                "label":      r["raw"],
                "value":      status_label,
                "suspicious": status == "not_found",
                "weight":     "medium",
            })
    else:
        followers = signals.get("_follower_count")
        age       = signals.get("_account_age_days")
        absent_suspicious = (
            followers is not None and followers > 10_000
            and (age or 0) > 60
        )
        cards.append({
            "label":      "Bio cross-platform links",
            "value":      "None found",
            "suspicious": absent_suspicious,
            "weight":     "high",
        })

    if flags:
        cards.append({
            "label":      "Flags",
            "value":      ", ".join(f.replace("_", " ") for f in flags),
            "suspicious": True,
            "weight":     "high",
        })

    return cards


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _base_result() -> dict:
    return {
        "analyser":       "source_behaviour",
        "status":         "pending",
        "skip_reason":    None,
        "account_handle": None,
        "score":          None,
        "confidence":     0.0,
        "flags":          [],
        "signals":        {},
        "signal_cards":   [],
        "summary":        None,
        "error":          None,
    }


def _skip(result: dict, reason: str) -> dict:
    result["status"]      = "skipped"
    result["skip_reason"] = reason
    result["score"]       = 0.5
    result["summary"]     = f"Source behaviour analysis unavailable ({reason.replace('_', ' ')})."
    logger.info(f"[source_behaviour] Skipped — {reason}")
    return result
