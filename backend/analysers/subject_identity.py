"""
subject_identity.py — NLP-based high-profile subject detection.
Uses spaCy PERSON NER on yt-dlp metadata fields, cross-referenced
against the Wikidata subject list fetched at startup.
"""

import logging
import re

logger = logging.getLogger(__name__)

try:
    import spacy
    _nlp = spacy.load("en_core_web_sm")
    logger.info("[subject_identity] spaCy en_core_web_sm loaded")
except Exception as _e:
    _nlp = None
    logger.warning("[subject_identity] spaCy unavailable — subject detection disabled: %s", _e)

try:
    import wordninja as _wordninja
    _HAS_WORDNINJA = True
except Exception as _e:
    _HAS_WORDNINJA = False
    logger.warning("[subject_identity] wordninja unavailable — hashtag splitting disabled: %s", _e)

_EMPTY = {"matched": False, "matched_name": None, "ner_entities": [], "source": "metadata_nlp"}


def detect_subject(ydl_info: dict, subject_list: list[str]) -> dict:
    """
    Extract PERSON entities from video metadata via spaCy NER and
    cross-reference against subject_list using case-insensitive substring
    match in both directions.

    Returns:
        matched       bool — True if a list entry was matched
        matched_name  str | None — the list entry that matched
        ner_entities  list[str] — all PERSON entities extracted
        source        str — always "metadata_nlp"
    """
    if not subject_list or _nlp is None:
        return dict(_EMPTY)

    title = ydl_info.get("title") or ""
    description = ydl_info.get("description") or ""
    tags = ydl_info.get("tags") or []
    if isinstance(tags, list):
        tags_str = " ".join(str(t) for t in tags)
    else:
        tags_str = str(tags)

    text = " ".join(filter(None, [title, description, tags_str]))

    hashtags = re.findall(r'#(\w+)', text)
    if hashtags and _HAS_WORDNINJA:
        segmented = " ".join(" ".join(_wordninja.segment(tag)) for tag in hashtags)
        text = text + " " + segmented

    if not text.strip():
        return dict(_EMPTY)

    doc = _nlp(text)
    entities = [ent.text for ent in doc.ents if ent.label_ == "PERSON"]

    if not entities:
        return {"matched": False, "matched_name": None, "ner_entities": [], "source": "metadata_nlp"}

    entities_lower = [e.lower() for e in entities]
    for entry in subject_list:
        entry_lower = entry.lower()
        for ent_lower in entities_lower:
            if ent_lower in entry_lower or entry_lower in ent_lower:
                logger.info(
                    "[subject_identity] Match: NER entity %r matched list entry %r",
                    ent_lower, entry,
                )
                return {
                    "matched": True,
                    "matched_name": entry,
                    "ner_entities": entities,
                    "source": "metadata_nlp",
                }

    return {
        "matched": False,
        "matched_name": None,
        "ner_entities": entities,
        "source": "metadata_nlp",
    }
