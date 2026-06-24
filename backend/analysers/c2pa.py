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
    print(f"[c2pa] resemble_c2pa_input={c2pa_resemble_status!r} → status={c2pa_result.get('status')}", flush=True)
    if not c2pa_resemble_status:
        return c2pa_result
    result = dict(c2pa_result)
    if c2pa_resemble_status == "not_found":
        result["status"]  = "not_found"
        result["summary"] = "No C2PA credentials detected"
    elif c2pa_resemble_status == "found":
        result["status"]  = "found"
        result["summary"] = "C2PA credentials present"
    return result
