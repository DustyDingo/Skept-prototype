"""
Skept — C2PA Provenance Analyser (stub)
Checks for a C2PA manifest embedded in the video container.
Not yet implemented — returns a skipped result so fusion ignores this pillar.
Resemble AI DETECT-3B Omni returns a C2PA detection result as part of the video
job response; apply_resemble_result() upgrades the stub result to not_found/found
once the deepfake pillar completes.
"""


def run_c2pa(video_path: str) -> dict:
    return {
        "status":  "skipped",
        "score":   None,
        "signals": [],
        "summary": "C2PA provenance checking is not yet implemented.",
    }


def apply_resemble_result(c2pa_result: dict, c2pa_resemble_status: str | None) -> dict:
    result = dict(c2pa_result)
    if c2pa_resemble_status is None or c2pa_resemble_status == "not_found":
        result["status"]  = "not_found"
        result["summary"] = (
            "No C2PA manifest was detected in this file. This is expected for most social media content "
            "— C2PA adoption by creators and platforms is limited. Absence is not a negative signal; "
            "presence would be a strong positive one."
        )
    elif c2pa_resemble_status == "found":
        result["status"]  = "found"
        result["summary"] = (
            "A C2PA manifest was found in this file. This is a strong positive signal "
            "— it means the content chain of custody has been recorded and verified."
        )
    print(f"[c2pa] resemble_c2pa_input={c2pa_resemble_status!r} → status={result['status']}", flush=True)
    return result
