"""
subject_list.py — Wikidata-backed list of high-profile subjects.
Fetched once at app startup; returns empty list on any failure.
"""

import logging

import requests

logger = logging.getLogger(__name__)

_SPARQL_URL = "https://query.wikidata.org/sparql"
_TIMEOUT = 10

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


def get_subject_list() -> list[str]:
    """
    Query Wikidata for current heads of state/government and major party
    leaders across AU, US, UK, and EU institutions.
    Returns a list of English name strings, or [] on any failure.
    """
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
        logger.info("[subject_list] Fetched %d subjects from Wikidata", len(names))
        print(f"[subject_list] Fetched {len(names)} subjects from Wikidata", flush=True)
        logger.info(f"[subject_identity] Wikidata fetch OK — {len(names)} names loaded")
        print(f"[subject_identity] Wikidata fetch OK — {len(names)} names loaded", flush=True)
        return names
    except Exception as exc:
        logger.warning("[subject_list] Wikidata fetch failed — subject identity will be silent: %s", exc)
        print(f"[subject_list] Wikidata fetch FAILED — subject identity will be silent: {exc}", flush=True)
        logger.info("[subject_identity] Wikidata fetch FAILED — subject list empty, running silent")
        print(f"[subject_identity] Wikidata fetch FAILED — subject list empty, running silent", flush=True)
        return []
