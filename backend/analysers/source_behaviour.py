"""
Skept — Source Behaviour Analyser
TikTok-focused. Extracts account metadata via yt-dlp and scores four signals:
  1. Account age vs posting volume
  2. Posting cadence burst detection
  3. Bio cross-platform handle extraction and HTTP verification
  4. Cross-platform identity absence weighted by follower count and account age
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
    "age_vs_volume":      0.30,
    "burst_cadence":      0.25,
    "bio_cross_platform": 0.25,
    "identity_absence":   0.20,
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

# @handle that looks like a cross-platform self-reference (contains a dot or
# appears alongside a platform keyword in the same bio sentence)
_AT_HANDLE_RE = re.compile(r"(?<!\w)@([\w.]{2,30})(?!\w)")

_PLATFORM_KEYWORDS_RE = re.compile(
    r"\b(instagram|youtube|twitter|facebook|snapchat|twitch|linkedin"
    r"|threads|bluesky|tiktok|reddit|pinterest)\b",
    re.IGNORECASE,
)

# Verification URL templates keyed by matched domain fragment
_VERIFY_URLS: dict[str, str] = {
    "instagram.com":  "https://www.instagram.com/{path}",
    "twitter.com":    "https://twitter.com/{path}",
    "x.com":          "https://x.com/{path}",
    "youtube.com":    "https://www.youtube.com/{path}",
    "youtu.be":       "https://youtu.be/{path}",
    "facebook.com":   "https://www.facebook.com/{path}",
    "twitch.tv":      "https://www.twitch.tv/{path}",
    "linkedin.com":   "https://www.linkedin.com/{path}",
    "threads.net":    "https://www.threads.net/{path}",
    "bsky.app":       "https://bsky.app/{path}",
    "reddit.com":     "https://www.reddit.com/{path}",
    "linktr.ee":      "https://linktr.ee/{path}",
    "beacons.ai":     "https://beacons.ai/{path}",
    "bio.link":       "https://bio.link/{path}",
    "linkin.bio":     "https://linkin.bio/{path}",
    "lnk.bio":        "https://lnk.bio/{path}",
    "carrd.co":       "https://carrd.co/{path}",
}

# ── TikTok URL → account handle ──────────────────────────────────────────────

_TIKTOK_HANDLE_RE = re.compile(r"tiktok\.com/@([\w.]+)", re.IGNORECASE)


def _extract_tiktok_handle(url: str) -> Optional[str]:
    m = _TIKTOK_HANDLE_RE.search(url)
    return m.group(1) if m else None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PUBLIC INTERFACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def run_source_behaviour(url: str) -> dict:
    """
    Async entry point. Matches the run_* naming convention.
    Returns the standard Skept analyser output contract.
    """
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

    bio_text = (
        account_meta.get("description")
        or account_meta.get("channel_description")
        or ""
    )
    follower_count = account_meta.get("channel_follower_count")
    following_count = account_meta.get("channel_following_count")

    # Bio parsing is synchronous; verification is async
    bio_refs = _parse_bio(bio_text)
    verified_refs = await _verify_refs(bio_refs)

    signals = _compute_signals(entries, follower_count, following_count, bio_text, bio_refs, verified_refs)
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

    found: list[dict] = []
    seen_urls: set[str] = set()

    def _add(ref: dict) -> None:
        key = ref["verify_url"].lower()
        if key not in seen_urls:
            seen_urls.add(key)
            found.append(ref)

    # Full platform URLs (most specific — match first)
    for m in _PLATFORM_URL_RE.finditer(bio):
        domain = m.group(1).lower()
        raw    = m.group(0).strip()
        # Build a verify URL from the full matched text
        full = raw if raw.startswith("http") else "https://" + raw
        _add({"type": "platform_url", "domain": domain, "raw": raw, "verify_url": full})

    # Link-page services (linktree etc.)
    for m in _LINKPAGE_RE.finditer(bio):
        domain = m.group(1).lower()
        raw    = m.group(0).strip()
        full   = raw if raw.startswith("http") else "https://" + raw
        _add({"type": "linkpage", "domain": domain, "raw": raw, "verify_url": full})

    # @handle mentions — only include if a platform keyword appears nearby in bio
    if _PLATFORM_KEYWORDS_RE.search(bio):
        for m in _AT_HANDLE_RE.finditer(bio):
            handle = m.group(1)
            # Skip if it's the account's own TikTok handle (would be trivial)
            # We can't know the account handle here without passing it in, so
            # we include all — duplicates filtered by seen_urls
            raw = f"@{handle}"
            # We can't verify bare @handles without knowing the platform;
            # record as unverifiable
            key = f"@{handle.lower()}"
            if key not in seen_urls:
                seen_urls.add(key)
                found.append({
                    "type":       "at_handle",
                    "domain":     "unknown",
                    "raw":        raw,
                    "verify_url": "",  # no URL to verify
                })

    return found


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CROSS-PLATFORM VERIFICATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def _verify_refs(refs: list[dict]) -> dict[str, str]:
    """
    HTTP HEAD each verifiable ref. Returns {verify_url: status}
    where status is 'exists' | 'not_found' | 'unverifiable' | 'error'.
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
    following_count: Optional[int],
    bio_text: str,
    bio_refs: list[dict],
    verified_refs: dict[str, str],
) -> dict:
    now     = datetime.now(timezone.utc)
    signals = {}

    dates = sorted(d for d in (_parse_date(p) for p in posts) if d)

    # ── Signal 1: account age vs posting volume ──────────────────────────────
    if dates:
        age_days  = max((now - dates[0]).days, 1)
        post_rate = round(len(posts) / age_days, 3)
        signals["account_age_days_min"] = age_days
        signals["post_count_fetched"]   = len(posts)
        signals["posts_per_day"]        = post_rate

    # ── Signal 2: burst cadence ──────────────────────────────────────────────
    if len(dates) >= 3:
        # Coefficient of variation of inter-post gaps (hours)
        gaps     = [(dates[i+1] - dates[i]).total_seconds() / 3600
                    for i in range(len(dates) - 1)]
        mean_gap = statistics.mean(gaps)
        if mean_gap > 0:
            signals["cadence_cv"]       = round(statistics.stdev(gaps) / mean_gap, 3)
            signals["mean_gap_hours"]   = round(mean_gap, 2)

        # Max posts on any single calendar day (day-level burst indicator)
        day_counts = Counter(d.date() for d in dates)
        max_day_posts = max(day_counts.values())
        signals["max_posts_single_day"] = max_day_posts

        # Share of posts in the most active 7-day window
        window_seconds = 7 * 86400
        max_in_window  = 0
        for i, anchor in enumerate(dates):
            in_window = sum(
                1 for d in dates
                if 0 <= (d - anchor).total_seconds() <= window_seconds
            )
            if in_window > max_in_window:
                max_in_window = in_window
        signals["max_7d_window_posts"]     = max_in_window
        signals["max_7d_window_pct"]       = round(max_in_window / len(dates), 3)

    # ── Signal 3 & 4: bio cross-platform ────────────────────────────────────
    platform_url_refs = [r for r in bio_refs if r["type"] in ("platform_url", "linkpage")]
    verifiable_refs   = [r for r in bio_refs if r["verify_url"]]
    exists_count      = sum(1 for r in verifiable_refs
                            if verified_refs.get(r["verify_url"]) == "exists")
    not_found_count   = sum(1 for r in verifiable_refs
                            if verified_refs.get(r["verify_url"]) == "not_found")

    signals["bio_text_length"]         = len(bio_text)
    signals["bio_refs_found"]          = len(bio_refs)
    signals["bio_platform_urls"]       = len(platform_url_refs)
    signals["bio_verified_exists"]     = exists_count
    signals["bio_verified_not_found"]  = not_found_count

    if follower_count is not None:
        signals["follower_count"] = follower_count
    if following_count is not None:
        signals["following_count"] = following_count

    return signals


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SCORING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _score(signals: dict) -> tuple[Optional[float], list[str], float]:
    sub_scores:  dict[str, float] = {}
    flags:       list[str]        = []
    data_points: int              = 0

    age  = signals.get("account_age_days_min")
    rate = signals.get("posts_per_day")

    # ── Signal 1: age vs volume ──────────────────────────────────────────────
    if age is not None and rate is not None:
        data_points += 1
        if age < 14 and rate > 5:
            sub_scores["age_vs_volume"] = 0.92; flags.append("new_account_high_volume")
        elif age < 30 and rate > 3:
            sub_scores["age_vs_volume"] = 0.75; flags.append("young_account_elevated_volume")
        elif age < 90 and rate > 8:
            sub_scores["age_vs_volume"] = 0.72; flags.append("growing_account_high_volume")
        elif age < 30:
            sub_scores["age_vs_volume"] = 0.45
        elif age > 365 and rate < 2:
            sub_scores["age_vs_volume"] = 0.05
        else:
            sub_scores["age_vs_volume"] = 0.12

    # ── Signal 2: burst cadence ──────────────────────────────────────────────
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
                burst_score = max(burst_score, 0.60)

        if max_day_posts is not None and max_day_posts >= 5:
            burst_score = max(burst_score, 0.65); flags.append("multi_post_day_detected")

        sub_scores["burst_cadence"] = burst_score

    # ── Signal 3: bio cross-platform ────────────────────────────────────────
    refs_found   = signals.get("bio_refs_found", 0)
    exists_count = signals.get("bio_verified_exists", 0)
    nf_count     = signals.get("bio_verified_not_found", 0)
    verifiable   = exists_count + nf_count  # those we could actually check

    data_points += 1  # bio is always checked (even if empty)

    if refs_found == 0:
        sub_scores["bio_cross_platform"] = 0.0  # handled by identity_absence
    elif verifiable > 0 and nf_count > 0 and exists_count == 0:
        # All verifiable refs are dead links
        sub_scores["bio_cross_platform"] = 0.78; flags.append("bio_links_all_dead")
    elif verifiable > 0 and nf_count > exists_count:
        # More dead than live
        sub_scores["bio_cross_platform"] = 0.50; flags.append("bio_links_mostly_dead")
    elif exists_count >= 2:
        # Multiple verified cross-platform presences
        sub_scores["bio_cross_platform"] = 0.05
    elif exists_count >= 1:
        sub_scores["bio_cross_platform"] = 0.10
    else:
        # refs found but none verifiable (e.g., only @handle mentions)
        sub_scores["bio_cross_platform"] = 0.20

    # ── Signal 4: identity absence ───────────────────────────────────────────
    followers = signals.get("follower_count")

    if refs_found > 0:
        # Cross-platform references exist — absence signal does not apply
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
            sub_scores["identity_absence"] = 0.08  # new/small — absence is normal
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

    age  = signals.get("account_age_days_min")
    rate = signals.get("posts_per_day")
    if age is not None and rate is not None:
        parts.append(
            f"{name} has been active for at least {age} day{'s' if age != 1 else ''}, "
            f"averaging {rate:.1f} post{'s' if rate != 1 else ''} per day"
        )

    max_7d_pct = signals.get("max_7d_window_pct")
    if max_7d_pct is not None and max_7d_pct > 0.55:
        pct_str = f"{int(max_7d_pct * 100)}%"
        parts.append(
            f"{pct_str} of observed posts fall within a single 7-day window, "
            "consistent with burst-posting behaviour"
        )

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
        parts.append(f"bio contains {len(bio_refs)} cross-platform reference(s) ({refs_str}; {verif_str})")
    else:
        followers = signals.get("follower_count")
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

    age = signals.get("account_age_days_min")
    if age is not None:
        cards.append({
            "label":     "Account age (minimum)",
            "value":     f"{age} days",
            "suspicious": age < 30,
            "weight":    "high",
        })

    rate = signals.get("posts_per_day")
    count = signals.get("post_count_fetched")
    if rate is not None:
        cards.append({
            "label":     "Posts per day",
            "value":     f"{rate:.1f}" + (f" ({count} fetched)" if count else ""),
            "suspicious": rate > 5,
            "weight":    "high",
        })

    max_7d = signals.get("max_7d_window_pct")
    if max_7d is not None:
        cards.append({
            "label":     "Peak 7-day window concentration",
            "value":     f"{int(max_7d * 100)}%",
            "suspicious": max_7d > 0.75,
            "weight":    "medium",
        })

    cv = signals.get("cadence_cv")
    if cv is not None:
        cards.append({
            "label":     "Posting timing variance (CV)",
            "value":     f"{cv:.2f}",
            "suspicious": cv > 1.5,
            "weight":    "medium",
        })

    max_day = signals.get("max_posts_single_day")
    if max_day is not None:
        cards.append({
            "label":     "Max posts in a single day",
            "value":     str(max_day),
            "suspicious": max_day >= 5,
            "weight":    "medium",
        })

    followers = signals.get("follower_count")
    if followers is not None:
        cards.append({
            "label":     "Followers",
            "value":     f"{followers:,}",
            "suspicious": False,
            "weight":    "info",
        })

    # Bio cross-platform block
    if bio_refs:
        exists = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "exists")
        nf     = sum(1 for r in bio_refs if verified_refs.get(r["verify_url"]) == "not_found")
        verif_label = f"{exists} live, {nf} dead" if (exists + nf) > 0 else "unverifiable"
        cards.append({
            "label":     "Bio cross-platform links",
            "value":     f"{len(bio_refs)} found ({verif_label})",
            "suspicious": nf > 0 and exists == 0,
            "weight":    "high",
        })
        for r in bio_refs[:5]:
            status = verified_refs.get(r["verify_url"], "unverifiable")
            status_label = {"exists": "✓ live", "not_found": "✗ dead", "error": "timeout"}.get(status, "—")
            cards.append({
                "label":     r["raw"],
                "value":     status_label,
                "suspicious": status == "not_found",
                "weight":    "medium",
            })
    else:
        absent_suspicious = (
            followers is not None and followers > 10_000
            and (signals.get("account_age_days_min") or 0) > 60
        )
        cards.append({
            "label":     "Bio cross-platform links",
            "value":     "None found",
            "suspicious": absent_suspicious,
            "weight":    "high",
        })

    if flags:
        cards.append({
            "label":     "Flags",
            "value":     ", ".join(f.replace("_", " ") for f in flags),
            "suspicious": True,
            "weight":    "high",
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
