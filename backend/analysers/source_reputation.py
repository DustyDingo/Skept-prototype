"""
source_reputation.py  —  Skept prototype  —  Stage 1 analyser
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Platform-agnostic account identity signal analyser.

Domain (exclusive):
  account_age_days_min    lower bound on account age (oldest visible post)
  cadence_posts_per_day   average posting rate across observation window
  recent_7d_pct           share of visible posts from the last 7 days
  follower_count          where surfaced by platform
  follower_per_post       follower-to-post ratio
  username_digit_ratio    fraction of username characters that are digits
  username_has_words      whether username contains a recognisable word (≥3 letters)

Cadence timing variance (CV) and burst-pattern analysis belong to
source_behaviour.py, which shares the same yt-dlp fetch but owns the
cadence shape and bio identity domain.

Language discipline (Project Brief §4.7):
  Evidence text uses descriptive behavioural language only.
  Never characterises intent.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import re
import logging
from datetime import datetime, timezone
from typing import Optional

import yt_dlp

logger = logging.getLogger(__name__)

SIGNAL_WEIGHTS = {
    "account_age":          0.35,
    "post_rate":            0.25,
    "recent_concentration": 0.18,
    "follower_post_ratio":  0.12,
    "username_pattern":     0.10,
}

_PLATFORM_PATTERNS = [
    (r"tiktok\.com/@([\w.]+)",              "tiktok",    "https://www.tiktok.com/@{}"),
    (r"(?:twitter|x)\.com/([\w]+)/status/", "twitter",   "https://twitter.com/{}"),
    (r"bsky\.app/profile/([\w.]+)",         "bluesky",   "https://bsky.app/profile/{}"),
    (r"youtu(?:be\.com|\.be)",              "youtube",   None),
    (r"instagram\.com/(?:p|reel|reels)/",    "instagram", None),
    (r"facebook\.com/",                     "facebook",  None),
    (r"reddit\.com/r/",                     "reddit",    None),
]

MAX_POSTS = 30


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PUBLIC INTERFACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def run_reputation(url: str, ydl_info: dict | None = None) -> dict:
    """
    Run the source reputation analyser on a submitted clip URL.

    Returns a dict matching the Skept analyser output contract:
      status        "complete" | "skipped" | "error"
      score         float 0.0–1.0 (0=authentic, 1=suspicious) | None
      confidence    float 0.0–0.9
      flags         list[str]
      signals       dict  (used by fusion layer)
      signal_cards  list  (used by frontend evidence card renderer)
      summary       str
    """
    result = _base_result()

    try:
        platform, account_url, handle = _extract_account_info(url, ydl_info)
        result["platform"]       = platform
        result["account_handle"] = handle

        if not account_url:
            return _skip(result, "account_url_not_resolvable")

        if platform == "instagram" and ydl_info:
            entries, account_meta = [], {}
        else:
            entries, account_meta = _fetch_account_data(account_url, platform)

            if entries is None or len(entries) == 0:
                if not ydl_info:
                    reason = "account_fetch_blocked" if entries is None else "no_posts_accessible"
                    return _skip(result, reason)
                entries, account_meta = [], {}

        signals = _compute_signals(entries, account_meta, handle)
        result["signals"] = signals

        score, flags, confidence = _score(signals)

        # Confidence floor: thin post history means individual signals are unreliable.
        # A brand-new account with few posts can look clean by accident — insufficient
        # data should return near-0.5 (unknown), not a confident lean in either direction.
        posts    = signals.get("post_count_fetched", 0) or 0
        age_days = signals.get("account_age_days_min") or 0
        if posts < 10:
            scalar = 0.2
        elif posts < 30 or age_days < 30:
            scalar = 0.5
        elif posts < 100:
            scalar = 0.8
        else:
            scalar = 1.0

        low_sample = scalar < 1.0
        if low_sample and score is not None:
            score = round(0.5 + (score - 0.5) * scalar, 3)

        result["score"]        = score
        result["confidence"]   = confidence
        result["flags"]        = flags
        result["low_sample"]   = low_sample
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
        "low_sample":     False,
        "signals":        {},
        "signal_cards":   [],
        "summary":        None,
        "error":          None,
    }


def _skip(result: dict, reason: str) -> dict:
    result["status"]      = "skipped"
    result["skip_reason"] = reason
    result["score"]       = 0.5
    result["summary"]     = f"Source reputation analysis unavailable ({reason.replace('_', ' ')})."
    logger.info(f"[source_reputation] Skipped — {reason}")
    return result


# ── 1. Account URL resolution ────────────────────────────────────────────────

def _extract_account_info(url: str, ydl_info: dict | None = None) -> tuple:
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

    if platform in ("youtube", "instagram", "facebook") and not account_url:
        if ydl_info:
            account_url = ydl_info.get("channel_url") or ydl_info.get("uploader_url")
            handle      = (ydl_info.get("uploader_id") or ydl_info.get("channel_id")
                           or ydl_info.get("uploader"))
            if not account_url and handle:
                account_url = f"https://www.instagram.com/{handle}/"
        else:
            account_url, handle = _resolve_via_video_meta(url, platform)

    return platform, account_url, handle


def _resolve_via_video_meta(url: str, platform: str) -> tuple:
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

def _fetch_account_data(account_url: str, platform: str) -> tuple[Optional[list], dict]:
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
            return None, {}
        if info.get("_type") == "video":
            return [info], info

        entries      = [e for e in (info.get("entries") or []) if e is not None]
        account_meta = {k: v for k, v in info.items() if k != "entries"}
        return entries, account_meta

    except Exception as exc:
        logger.warning(f"[source_reputation] Account fetch failed ({account_url}): {exc}")
        return None, {}


# ── 3. Signal computation ────────────────────────────────────────────────────

def _compute_signals(posts: list, account_meta: dict, handle: Optional[str] = None) -> dict:
    now     = datetime.now(timezone.utc)
    signals = {}

    dates = [d for d in (_parse_date(p) for p in posts) if d]
    dates.sort()

    if dates:
        signals["oldest_post_age_days"] = (now - dates[0]).days
        signals["newest_post_age_days"] = (now - dates[-1]).days
        signals["account_age_days_min"] = signals["oldest_post_age_days"]
        signals["post_count_fetched"]   = len(posts)

        window_days = max(signals["account_age_days_min"], 1)
        signals["cadence_posts_per_day"] = round(len(posts) / window_days, 3)

        week_ago = now.timestamp() - (7 * 86400)
        recent   = [d for d in dates if d.timestamp() > week_ago]
        signals["recent_7d_count"] = len(recent)
        signals["recent_7d_pct"]   = round(len(recent) / len(dates), 3)

    follower_count = account_meta.get("channel_follower_count")
    if follower_count is not None:
        signals["follower_count"] = follower_count
        if len(posts) > 0:
            signals["follower_per_post"] = round(follower_count / len(posts), 1)

    if handle:
        clean       = handle.lstrip("@")
        digit_ratio = sum(c.isdigit() for c in clean) / max(len(clean), 1)
        has_words   = bool(re.search(r"[a-zA-Z]{3,}", clean))
        signals["username_digit_ratio"] = round(digit_ratio, 3)
        signals["username_has_words"]   = has_words

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
    """Returns (composite_score, flags, confidence).

    50-anchored: 0.5 = no information (genuinely unknown); below 0.5 = evidence
    of authenticity; above 0.5 = evidence of manipulation. Missing signals are
    excluded from both numerator and denominator — they do not dilute toward
    authentic.
    """
    sub_scores  = {}
    flags       = []
    data_points = 0

    age = signals.get("account_age_days_min")
    if age is not None:
        data_points += 1
        # Neutral: 0.5. Established account pulls below; brand-new account pushes above.
        if age < 7:
            sub_scores["account_age"] = 0.90; flags.append("account_under_7_days")
        elif age < 30:
            sub_scores["account_age"] = 0.78; flags.append("account_under_30_days")
        elif age < 90:
            sub_scores["account_age"] = 0.58; flags.append("account_under_90_days")
        else:
            sub_scores["account_age"] = 0.28

    rate = signals.get("cadence_posts_per_day")
    if rate is not None:
        data_points += 1
        # Neutral: 0.5. Low sustained rate pulls below; extreme burst rate pushes above.
        if rate > 15:
            sub_scores["post_rate"] = 0.88; flags.append("extreme_post_rate")
        elif rate > 8:
            sub_scores["post_rate"] = 0.72; flags.append("high_post_rate")
        elif rate > 3:
            sub_scores["post_rate"] = 0.52
        else:
            sub_scores["post_rate"] = 0.38

    recent_pct = signals.get("recent_7d_pct")
    if recent_pct is not None:
        data_points += 1
        # Neutral: 0.5. Evenly spread historical activity pulls below; sudden burst pushes above.
        if recent_pct > 0.85:
            sub_scores["recent_concentration"] = 0.88; flags.append("sudden_activity_burst")
        elif recent_pct > 0.60:
            sub_scores["recent_concentration"] = 0.80; flags.append("elevated_recent_activity")
        else:
            sub_scores["recent_concentration"] = 0.30

    fpp = signals.get("follower_per_post")
    if fpp is not None:
        data_points += 1
        # Neutral: 0.5. Healthy follower ratio pulls below; near-zero ratio pushes above.
        if fpp < 5:
            sub_scores["follower_post_ratio"] = 0.72; flags.append("low_follower_per_post")
        elif fpp < 50:
            sub_scores["follower_post_ratio"] = 0.48
        else:
            sub_scores["follower_post_ratio"] = 0.28

    digit_ratio = signals.get("username_digit_ratio")
    has_words   = signals.get("username_has_words")
    if digit_ratio is not None:
        data_points += 1
        # Neutral: 0.5. Readable word-based username pulls below; digit-heavy random string pushes above.
        if digit_ratio > 0.5 and not has_words:
            sub_scores["username_pattern"] = 0.78; flags.append("numeric_heavy_username")
        elif digit_ratio > 0.3:
            sub_scores["username_pattern"] = 0.55
        else:
            sub_scores["username_pattern"] = 0.28

    if not sub_scores:
        return None, [], 0.0

    total_weight = sum(SIGNAL_WEIGHTS[k] for k in sub_scores)
    composite    = sum(sub_scores[k] * SIGNAL_WEIGHTS[k] for k in sub_scores) / total_weight
    confidence   = round(min(data_points / len(SIGNAL_WEIGHTS), 1.0) * 0.9, 2)

    return round(composite, 3), flags, confidence


# ── 5. Output formatting ─────────────────────────────────────────────────────

def _build_summary(signals: dict, flags: list, handle: Optional[str], platform: str) -> str:
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

    recent_pct = signals.get("recent_7d_pct")
    if recent_pct is not None:
        cards.append({
            "label":     "Activity in last 7 days",
            "value":     f"{int(recent_pct * 100)}%",
            "suspicious": recent_pct > 0.85,
            "weight":    "medium",
        })

    follower_count = signals.get("follower_count")
    if follower_count is not None:
        cards.append({
            "label":     "Followers",
            "value":     f"{follower_count:,}",
            "suspicious": False,
            "weight":    "info",
        })

    fpp = signals.get("follower_per_post")
    if fpp is not None:
        cards.append({
            "label":     "Followers per post",
            "value":     f"{fpp:.0f}",
            "suspicious": fpp < 5,
            "weight":    "medium",
        })

    digit_ratio = signals.get("username_digit_ratio")
    if digit_ratio is not None:
        cards.append({
            "label":     "Username digit ratio",
            "value":     f"{int(digit_ratio * 100)}%",
            "suspicious": digit_ratio > 0.5 and not signals.get("username_has_words"),
            "weight":    "low",
        })

    if flags:
        cards.append({
            "label":     "Flags",
            "value":     ", ".join(f.replace("_", " ") for f in flags),
            "suspicious": True,
            "weight":    "high",
        })

    return cards
