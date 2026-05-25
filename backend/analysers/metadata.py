"""
Skept — Metadata / Container Forensics Analyser
Uses ffprobe to extract stream metadata and applies heuristic scoring.
Cheap, fast, no GPU. Runs in Stage 1.

Platform-context awareness:
  Known platforms (TikTok, YouTube, Instagram, etc.) strip camera EXIF and
  encoder metadata during re-encoding. Absent metadata on a platform-sourced
  clip is expected behaviour, not a suspicious signal — so it carries zero
  score weight. The signal is still surfaced as informational context.
  For direct file uploads or unknown sources, absent metadata is scored
  normally (0.4 weight) since an authentic original file should carry it.
"""

import json
import subprocess
from pathlib import Path


# Platforms known to strip camera/encoder metadata during re-encoding.
# Absence of camera metadata on clips from these sources is expected.
_PLATFORM_DOMAINS = {
    "tiktok.com", "youtube.com", "youtu.be", "instagram.com",
    "twitter.com", "x.com", "facebook.com", "reddit.com",
    "bsky.app", "bluesky.app",
}


def _is_platform_source(source_url: str) -> bool:
    url = source_url.lower()
    return any(domain in url for domain in _PLATFORM_DOMAINS)


def run_metadata(video_path: str, source_url: str = "") -> dict:
    """
    Run ffprobe and score the metadata signals.

    Args:
        video_path:  Local path to the downloaded/uploaded video file.
        source_url:  Original submitted URL (empty for file uploads).
                     Used to determine whether absent camera metadata
                     should be treated as suspicious or expected.
    """
    try:
        probe = _ffprobe(video_path)
    except Exception as e:
        return {
            "status":  "error",
            "error":   str(e),
            "score":   0.5,
            "signals": [],
            "summary": "Metadata extraction failed.",
        }

    platform_source = _is_platform_source(source_url)

    signals          = []
    score_components = []

    streams = probe.get("streams", [])
    fmt     = probe.get("format", {})
    tags    = fmt.get("tags", {})

    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    vs = video_streams[0] if video_streams else {}

    # ── Signal 1: Camera EXIF / encoder metadata ────────────────────────────
    encoder       = tags.get("encoder", tags.get("Encoder", ""))
    creation_time = tags.get("creation_time", "")
    has_camera_meta = bool(encoder or creation_time)

    if platform_source:
        # Platform re-encoding strips camera metadata — absence is normal.
        # Surface as informational; no score penalty either way.
        camera_signal = {
            "label":     "Camera/encoder metadata",
            "value":     encoder if has_camera_meta else "Stripped by platform",
            "weight":    "info",
            "suspicious": False,
            "detail":    "Platform re-encoding removes original camera provenance.",
        }
        score_components.append(0.0)
    else:
        # Direct file or unknown source — absent metadata is suspicious,
        # since an authentic original file should carry camera provenance.
        camera_signal = {
            "label":     "Camera/encoder metadata present",
            "value":     has_camera_meta,
            "detail":    encoder or "(none detected)",
            "weight":    "medium",
            "suspicious": not has_camera_meta,
        }
        score_components.append(0.0 if has_camera_meta else 0.4)

    signals.append(camera_signal)

    # ── Signal 2: Codec fingerprint ─────────────────────────────────────────
    codec    = vs.get("codec_name", "")
    profile  = vs.get("profile", "")
    codec_signal = {
        "label":     "Codec",
        "value":     f"{codec.upper()} / {profile}" if codec else "Unknown",
        "weight":    "low",
        "suspicious": not bool(codec),
    }
    signals.append(codec_signal)
    score_components.append(0.2 if not codec else 0.0)

    # ── Signal 3: Resolution plausibility ───────────────────────────────────
    width  = vs.get("width", 0)
    height = vs.get("height", 0)
    # Common synthetic output resolutions: 256×256, 512×512, 1024×1024
    synthetic_res = (width == height and width in {256, 512, 1024}) or width == 0
    res_signal = {
        "label":     "Resolution",
        "value":     f"{width}×{height}" if width else "Unknown",
        "weight":    "low",
        "suspicious": synthetic_res,
    }
    signals.append(res_signal)
    score_components.append(0.3 if synthetic_res else 0.0)

    # ── Signal 4: Frame rate ─────────────────────────────────────────────────
    r_frame_rate = vs.get("r_frame_rate", "0/1")
    try:
        num, den = map(int, r_frame_rate.split("/"))
        fps = round(num / den, 2) if den else 0
    except Exception:
        fps = 0
    unusual_fps = fps > 0 and fps not in {24, 25, 29.97, 30, 50, 59.94, 60}
    fps_signal = {
        "label":     "Frame rate",
        "value":     f"{fps} fps" if fps else "Unknown",
        "weight":    "low",
        "suspicious": unusual_fps,
    }
    signals.append(fps_signal)
    score_components.append(0.1 if unusual_fps else 0.0)

    # ── Signal 5: Audio/video stream pairing ────────────────────────────────
    has_audio = len(audio_streams) > 0
    audio_signal = {
        "label":     "Audio stream present",
        "value":     has_audio,
        "weight":    "low",
        "suspicious": not has_audio,
    }
    signals.append(audio_signal)
    score_components.append(0.1 if not has_audio else 0.0)

    # ── Signal 6: Container format ───────────────────────────────────────────
    fmt_name = fmt.get("format_name", "")
    container_signal = {
        "label":     "Container format",
        "value":     fmt_name.upper() if fmt_name else "Unknown",
        "weight":    "info",
        "suspicious": False,
    }
    signals.append(container_signal)

    # ── Composite score ──────────────────────────────────────────────────────
    raw_score = min(sum(score_components), 1.0)

    # Cap at 0.5 — metadata forensics cannot confirm manipulation,
    # only raise suspicion. Platform-sourced clips will naturally score
    # lower here; that's correct, not a calibration error.
    score = round(min(raw_score, 0.5), 3)

    suspicious_count = sum(1 for s in signals if s.get("suspicious"))

    if platform_source:
        if suspicious_count == 0:
            summary = "Metadata consistent with an authentic clip. Camera provenance absent — expected after platform re-encoding."
        elif suspicious_count == 1:
            summary = "One metadata signal is unusual. Camera provenance absent — expected after platform re-encoding."
        else:
            summary = "Some metadata anomalies detected. Camera provenance absent — expected after platform re-encoding."
    else:
        if suspicious_count == 0:
            summary = "Metadata consistent with an authentic clip. Note: platform re-encoding strips most container provenance."
        elif suspicious_count <= 2:
            summary = "Some metadata signals are absent or unusual. This file is likely multiple encoding hops from source."
        else:
            summary = "Multiple metadata anomalies detected. Container provenance is absent or inconsistent."

    return {
        "status":  "complete",
        "score":   score,
        "signals": signals,
        "summary": summary,
        "raw": {
            "codec":         codec,
            "resolution":    f"{width}×{height}",
            "fps":           fps,
            "encoder":       encoder,
            "creation_time": creation_time,
            "format":        fmt_name,
            "platform_source": platform_source,
        },
    }


def _ffprobe(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe error: {result.stderr}")
    return json.loads(result.stdout)
