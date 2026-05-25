"""
source_reputation.py  —  Skept prototype  —  Stage 1 analyser
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Platform-agnostic account behavioural signal analyser.

Entry point: run_reputation(url) — matches the run_* convention
used by the other Skept analysers.

Signals computed (Phase 1):
  account_age_days_min    lower bound on account age (oldest visible post)
  cadence_posts_per_day   average posting rate across observation window
  cadence_cv              coefficient of variation of inter-post gaps
  recent_7d_pct           share of visible posts from the last 7 days
  follower_count          where surfaced by platform
  follower_per_post       follower-to-post ratio

Deferred to Phase 2:
  GAN profile picture detection
  Content-category classification
  Engagement ratio analysis
  Cross-platform identity stitching

Language discipline (Project Brief §4.7):
  Evidence text uses descriptive behavioural language only.
  Never characterises intent.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import re
import logging
import statistics
from datetime import datetime, timezone
from typing import Optional

import yt_dlp

logger = logging.getLogger(__name__)

# ── Signal weights for composite score ──────────────────────────────────────
SIGNAL_WEIGHTS = {
    "account_age":          0.30,
    "cadence_variance":     0.25,
    "post_rate":            0.20,
    "recent_concentration": 0.15,
    "follower_post_ratio":  0.10,
}

# ── Platform URL patterns ────────────────────────────────────────────────────
# (regex, platform_name, account_url_template | None)
_PLATFORM_PATTERNS = [
    (r"tiktok\.com/@([\w.]+)",              "tiktok",    "https://www.tiktok.com/@{}"),
    (r"(?:twitter|x)\.com/([\w]+)/status/", "twitter",   "https://twitter.com/{}"),
    (r"youtu(?:be\.com|\.be)",              "youtube",   None),
    (r"instagram\.com/p/",                  "instagram", None),
    (r"facebook\.com/",                     "facebook",  None),
    (r"reddit\.com/r/",                     "reddit",    None),
]

MAX_POSTS = 30


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PUBLIC INTERFACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def run_reputation(url: str) -> dict:
    """
    Run the source reputation analyser on a submitted clip URL.

    Called from main.py Stage 1 alongside run_metadata().
    URL-only (no pre-fetched yt-dlp info dict in the current prototype
    since ingest() uses subprocess yt-dlp rather than the Python API).

    Returns a dict matching the Skept analyser output contract:
      status        "complete" | "skipped" | "error"
      score         float 0.0–1.0 (0=authentic, 1=suspicious) | None
      confidence    float 0.0–0.9
      flags         list[str]
      signals       dict  (used by fusion layer)
      signal_cards  list  (used by frontend evidence card renderer)
      summary       str   (matches metadata analyser field name)
    """
    result = _base_result()

    try:
        platform, account_url, handle = _extract_account_info(url)
        result["platform"]       = platform
        result["account_handle"] = handle

        if not account_url:
            return _skip(result, "account_url_not_resolvable")

        posts = _fetch_account_posts(account_url, platform)

        if posts is None:
            return _skip(result, "account_fetch_blocked")
        if len(posts) == 0:
            return _skip(result, "no_posts_accessible")

        signals = _compute_signals(posts)
        result["signals"] = signals

        score, flags, confidence = _score(signals)
        result["score"]        = score
        result["confidence"]   = confidence
        result["flags"]        = flags
        result["status"]       = "complete"
        result["summary"]      = _build_summary(signals, flags, handle, platform)
        result["signal_cards"] = _build_signal_cards(signals, flags)

    except Exception as exc:
        logger.error(f"[source_reputation] Error: {exc}", exc_info=True)
        result["status"] = "error"
        result["error"]  = str(exc)
        result["summary"] = "Source reputation analysis encountered an error."

    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# INTERNAL HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _base_result() -> dict:
    return {
        "analyser":       "source_reputation",
        "status":         "pending",
        "skip_reason":    None,
        "platform":       None,
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
    result["score"]       = 0.5   # neutral — don't penalise a skipped analyser
    result["summary"]     = f"Source reputation analysis unavailable ({reason.replace('_', ' ')})."
    logger.info(f"[source_reputation] Skipped — {reason}")
    return result


# ── 1. Account URL resolution ────────────────────────────────────────────────

def _extract_account_info(url: str) -> tuple:
    """Returns (platform, account_url, handle)."""
    platform    = "unknown"
    account_url = None
    handle      = None

    for pattern, p_name, url_template in _PLATFORM_PATTERNS:
        m = re.search(pattern, url, re.IGNORECASE)
        if m:
            platform = p_name
            if url_template and m.lastindex and m.group(1):
                handle      = m.group(1)
                account_url = url_template.format(m.group(1))
            break

    # For platforms where we can't derive the account URL from the video URL
    # alone (YouTube, Instagram), try a lightweight yt-dlp extraction to get
    # uploader_url from the video's own metadata.
    if platform in ("youtube", "instagram", "facebook") and not account_url:
        account_url, handle = _resolve_via_video_meta(url, platform)

    return platform, account_url, handle


def _resolve_via_video_meta(url: str, platform: str) -> tuple:
    """
    For platforms where account URL isn't in the video URL, do a quick
    yt-dlp extract on the video itself (no download) to get uploader_url.
    """
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": False,
        "socket_timeout": 10,
        "retries": 1,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if info:
            account_url = info.get("channel_url") or info.get("uploader_url")
            handle      = info.get("uploader_id") or info.get("channel_id") or info.get("uploader")
            return account_url, handle
    except Exception as exc:
        logger.debug(f"[source_reputation] Video meta resolve failed: {exc}")
    return None, None


# ── 2. Account post history fetch ────────────────────────────────────────────

def _fetch_account_posts(account_url: str, platform: str) -> Optional[list]:
    """
    Fetch recent post metadata using yt-dlp playlist/channel extraction.
    extract_flat=True → metadata only, no video downloads.
    Returns list of post dicts, or None if blocked/unavailable.
    """
    if platform == "youtube":
        account_url = account_url.rstrip("/") + "/videos"

    ydl_opts = {
        "quiet":        True,
        "no_warnings":  True,
        "extract_flat": True,
        "playlistend":  MAX_POSTS,
        "socket_timeout": 12,
        "retries":      1,
        "ignoreerrors": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(account_url, download=False)

        if info is None:
            return None
        if info.get("_type") == "video":
            return [info]

        entries = info.get("entries") or []
        return [e for e in entries if e is not None]

    except Exception as exc:
        logger.warning(f"[source_reputation] Account fetch failed ({account_url}): {exc}")
        return None


# ── 3. Signal computation ────────────────────────────────────────────────────

def _compute_signals(posts: list) -> dict:
    now     = datetime.now(timezone.utc)
    signals = {}

    dates = [d for d in (_parse_date(p) for p in posts) if d]
    dates.sort()

    if not dates:
        return signals

    signals["oldest_post_age_days"] = (now - dates[0]).days
    signals["newest_post_age_days"] = (now - dates[-1]).days
    signals["account_age_days_min"] = signals["oldest_post_age_days"]
    signals["post_count_fetched"]   = len(posts)

    window_days = max(signals["account_age_days_min"], 1)
    signals["cadence_posts_per_day"] = round(len(posts) / window_days, 3)

    if len(dates) >= 3:
        gaps     = [(dates[i+1] - dates[i]).total_seconds() / 3600 for i in range(len(dates) - 1)]
        mean_gap = statistics.mean(gaps)
        if mean_gap > 0:
            signals["cadence_cv"]              = round(statistics.stdev(gaps) / mean_gap, 3)
            signals["cadence_mean_gap_hours"]  = round(mean_gap, 2)
        else:
            signals["cadence_cv"] = 0.0

    week_ago = now.timestamp() - (7 * 86400)
    recent   = [d for d in dates if d.timestamp() > week_ago]
    signals["recent_7d_count"] = len(recent)
    signals["recent_7d_pct"]   = round(len(recent) / len(dates), 3)

    return signals


def _parse_date(post: dict) -> Optional[datetime]:
    d_str = post.get("upload_date")
    if d_str and isinstance(d_str, str) and len(d_str) == 8:
        try:
            return datetime(int(d_str[:4]), int(d_str[4:6]), int(d_str[6:8]), tzinfo=timezone.utc)
        except ValueError:
            pass
    ts = post.get("timestamp")
    if ts is not None:
        try:
            return datetime.fromtimestamp(float(ts), tz=timezone.utc)
        except (ValueError, OSError):
            pass
    return None


# ── 4. Scoring ───────────────────────────────────────────────────────────────

def _score(signals: dict) -> tuple:
    """Returns (composite_score, flags, confidence)."""
    sub_scores  = {}
    flags       = []
    data_points = 0

    age = signals.get("account_age_days_min")
    if age is not None:
        data_points += 1
        if age < 7:
            sub_scores["account_age"] = 0.95; flags.append("account_under_7_days")
        elif age < 30:
            sub_scores["account_age"] = 0.72; flags.append("account_under_30_days")
        elif age < 90:
            sub_scores["account_age"] = 0.35; flags.append("account_under_90_days")
        else:
            sub_scores["account_age"] = 0.05

    cv = signals.get("cadence_cv")
    if cv is not None:
        data_points += 1
        if cv > 2.0:
            sub_scores["cadence_variance"] = 0.92; flags.append("high_cadence_irregularity")
        elif cv > 1.2:
            sub_scores["cadence_variance"] = 0.65; flags.append("elevated_cadence_irregularity")
        elif cv > 0.7:
            sub_scores["cadence_variance"] = 0.35
        else:
            sub_scores["cadence_variance"] = 0.08

    rate = signals.get("cadence_posts_per_day")
    if rate is not None:
        data_points += 1
        if rate > 15:
            sub_scores["post_rate"] = 0.90; flags.append("extreme_post_rate")
        elif rate > 8:
            sub_scores["post_rate"] = 0.65; flags.append("high_post_rate")
        elif rate > 3:
            sub_scores["post_rate"] = 0.30
        else:
            sub_scores["post_rate"] = 0.08

    recent_pct = signals.get("recent_7d_pct")
    if recent_pct is not None:
        data_points += 1
        if recent_pct > 0.85:
            sub_scores["recent_concentration"] = 0.88; flags.append("sudden_activity_burst")
        elif recent_pct > 0.60:
            sub_scores["recent_concentration"] = 0.52; flags.append("elevated_recent_activity")
        else:
            sub_scores["recent_concentration"] = 0.12

    fpp = signals.get("follower_per_post")
    if fpp is not None:
        data_points += 1
        if fpp < 5:
            sub_scores["follower_post_ratio"] = 0.72; flags.append("low_follower_per_post")
        elif fpp < 50:
            sub_scores["follower_post_ratio"] = 0.30
        else:
            sub_scores["follower_post_ratio"] = 0.05

    if not sub_scores:
        return None, [], 0.0

    total_weight = sum(SIGNAL_WEIGHTS[k] for k in sub_scores)
    composite    = sum(sub_scores[k] * SIGNAL_WEIGHTS[k] for k in sub_scores) / total_weight
    confidence   = round(min(data_points / len(SIGNAL_WEIGHTS), 1.0) * 0.9, 2)

    return round(composite, 3), flags, confidence


# ── 5. Output formatting ─────────────────────────────────────────────────────

def _build_summary(signals: dict, flags: list, handle: Optional[str], platform: str) -> str:
    """Plain-language summary for the evidence card. Behavioural language only."""
    parts = []
    name  = f"@{handle.lstrip('@')}" if handle else "this account"
    p_str = f" on {platform}" if platform not in ("unknown", None) else ""

    age = signals.get("account_age_days_min")
    if age is not None:
        parts.append(f"{name}{p_str} has been active for at least {age} day{'s' if age != 1 else ''}")

    count = signals.get("post_count_fetched")
    rate  = signals.get("cadence_posts_per_day")
    if count and rate:
        parts.append(f"posted {count} videos at an average of {rate:.1f} per day")

    cv = signals.get("cadence_cv")
    if cv is not None:
        if cv > 1.2:
            parts.append(f"with irregular posting timing (variance score {cv:.2f})")
        else:
            parts.append(f"with consistent posting timing (variance score {cv:.2f})")

    recent_pct   = signals.get("recent_7d_pct")
    recent_count = signals.get("recent_7d_count")
    if recent_pct is not None and recent_pct > 0.50 and recent_count:
        parts.append(
            f"{int(recent_pct * 100)}% of observed posts in the last 7 days "
            f"({recent_count} video{'s' if recent_count != 1 else ''})"
        )

    if not parts:
        return "Insufficient data for source reputation analysis."

    sentence = "; ".join(parts)
    return sentence[0].upper() + sentence[1:] + "."


def _build_signal_cards(signals: dict, flags: list) -> list:
    """
    Convert signals dict to the list format expected by the frontend
    renderSignals() function (same schema as metadata.py signals list).
    """
    cards = []

    age = signals.get("account_age_days_min")
    if age is not None:
        cards.append({
            "label":     "Account age (minimum)",
            "value":     f"{age} days",
            "suspicious": age < 30,
            "weight":    "high",
        })

    count = signals.get("post_count_fetched")
    if count is not None:
        cards.append({
            "label":     "Posts fetched",
            "value":     str(count),
            "suspicious": False,
            "weight":    "info",
        })

    rate = signals.get("cadence_posts_per_day")
    if rate is not None:
        cards.append({
            "label":     "Posts per day",
            "value":     f"{rate:.1f}",
            "suspicious": rate > 8,
            "weight":    "medium",
        })

    cv = signals.get("cadence_cv")
    if cv is not None:
        cards.append({
            "label":     "Timing variance (CV)",
            "value":     f"{cv:.2f}",
            "suspicious": cv > 1.2,
            "weight":    "medium",
        })

    recent_pct = signals.get("recent_7d_pct")
    if recent_pct is not None:
        cards.append({
            "label":     "Activity in last 7 days",
            "value":     f"{int(recent_pct * 100)}%",
            "suspicious": recent_pct > 0.85,
            "weight":    "medium",
        })

    if flags:
        cards.append({
            "label":     "Flags",
            "value":     ", ".join(f.replace("_", " ") for f in flags),
            "suspicious": True,
            "weight":    "high",
        })

    return cards
