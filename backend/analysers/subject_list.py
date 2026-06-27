"""
subject_list.py — Wikidata-backed list of high-profile subjects.
Lazy-loaded on first job; cache persists for the deployment lifetime.
On fetch failure the cache is not set, so the next job retries.
"""

import logging
import time

import requests

logger = logging.getLogger(__name__)

_subject_list_cache: list[str] | None = None

_SPARQL_URL = "https://query.wikidata.org/sparql"
_TIMEOUT = 20
_RETRY_ATTEMPTS = 3
_RETRY_DELAY = 2
_MIN_NAMES_THRESHOLD = 5

_QUERY = """\
SELECT DISTINCT ?item ?itemLabel WHERE {
  {
    VALUES ?role {
      wd:Q11696    wd:Q14211    wd:Q217394
      wd:Q19546    wd:Q2323301  wd:Q29975360
    }
    ?item wdt:P31 wd:Q5 ;
          p:P39 ?stmt .
    ?stmt ps:P39 ?role .
    FILTER NOT EXISTS { ?stmt pq:P582 [] }
  } UNION {
    VALUES ?party {
      wd:Q9192 wd:Q83918 wd:Q208242 wd:Q1017441
      wd:Q29552 wd:Q29468
      wd:Q9630 wd:Q9626 wd:Q50698 wd:Q10647
    }
    ?party wdt:P488 ?item .
    ?item wdt:P31 wd:Q5 .
  } UNION {
    VALUES ?item {
      wd:Q22686
    }
    ?item wdt:P31 wd:Q5 .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
"""
# QID comments:
# Q11696 President of the United States   Q14211 Prime Minister of the United Kingdom
# Q217394 Prime Minister of Australia      Q19546 Governor-General of Australia
# Q2323301 President of the European Commission   Q29975360 President of the European Council
# Q9192 Australian Labor Party   Q83918 Liberal Party of Australia
# Q208242 Australian Greens      Q1017441 National Party of Australia
# Q29552 Democratic Party (US)   Q29468 Republican Party (US)
# Q9630 Labour Party (UK)        Q9626 Conservative Party (UK)
# Q50698 Liberal Democrats (UK)  Q10647 Scottish National Party
# Q22686 Donald Trump


def get_subject_list() -> list[str]:
    """
    Returns the cached subject list, fetching from Wikidata on first call.
    Cache is only populated on success — failures return [] and retry on
    the next job call.
    """
    global _subject_list_cache
    if _subject_list_cache is not None:
        return _subject_list_cache
    names: list[str] = []
    last_exc: Exception | None = None
    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        try:
            resp = requests.get(
                _SPARQL_URL,
                params={"query": _QUERY, "format": "json"},
                headers={"User-Agent": "Skept-prototype/0.1 (skept.co)"},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            names = []
            for binding in data.get("results", {}).get("bindings", []):
                label = binding.get("itemLabel", {}).get("value", "")
                # Skip bare QIDs returned when no English label exists
                if label and not (label.startswith("Q") and label[1:].isdigit()):
                    names.append(label)
            break
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "[subject_list] Wikidata fetch attempt %d/%d failed: %s",
                attempt, _RETRY_ATTEMPTS, exc,
            )
            print(f"[subject_list] Wikidata fetch attempt {attempt}/{_RETRY_ATTEMPTS} failed: {exc}", flush=True)
            if attempt < _RETRY_ATTEMPTS:
                time.sleep(_RETRY_DELAY)
    if not names and last_exc is not None:
        logger.warning("[subject_list] Wikidata fetch FAILED (lazy) — subject identity silent for this job: %s", last_exc)
        print(f"[subject_list] Wikidata fetch FAILED (lazy) — subject identity silent for this job: {last_exc}", flush=True)
        return []
    if len(names) < _MIN_NAMES_THRESHOLD:
        logger.warning("[subject_list] Wikidata fetch degraded — only %d names loaded", len(names))
        print(f"[subject_list] Wikidata fetch degraded — only {len(names)} names loaded", flush=True)
    else:
        logger.info("[subject_list] Wikidata fetch OK — %d names loaded (lazy)", len(names))
        print(f"[subject_list] Wikidata fetch OK — {len(names)} names loaded (lazy)", flush=True)
    if "Donald Trump" not in names:
        logger.info("[subject_identity] Q22686 label missing from Wikidata response — hardcoded fallback added: Donald Trump")
        print("[subject_identity] Q22686 label missing from Wikidata response — hardcoded fallback added: Donald Trump", flush=True)
        names.append("Donald Trump")
    sorted_names = sorted(names)
    logger.info("[subject_list] subject_list=%s", sorted_names)
    print(f"[subject_list] subject_list={sorted_names}", flush=True)
    _subject_list_cache = names
    return _subject_list_cache
