"""
Skept — C2PA Provenance Analyser (stub)
Checks for a C2PA manifest embedded in the video container.
Not yet implemented — returns a skipped result so fusion ignores this pillar.
"""


def run_c2pa(video_path: str) -> dict:
    return {
        "status":  "skipped",
        "score":   None,
        "signals": [],
        "summary": "C2PA provenance checking is not yet implemented.",
    }
