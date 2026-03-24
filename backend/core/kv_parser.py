"""
backend/core/kv_parser.py

Key-Value (KV) log parser for structured logs of the form:
    key=value key="quoted value" key=value ...

Examples:
    date=2025-01-31 time=12:28:32 remip=209.126.10.147 user="N/A"
    type="event" subtype="vpn" level="error" action="ssl-alert"

This module is intentionally standalone — it has no dependency on the
regex engine, AI engine, or pattern store. It slots into the pipeline
as a lightweight middle tier between regex detection and AI fallback.

Public API
----------
is_kv_log(sample_lines)   → bool
parse_kv_lines(lines)     → list[dict]
build_kv_pattern(name)    → dict   (returns a synthetic pattern dict so
                                    the rest of the pipeline stays uniform)
"""

from __future__ import annotations

import re
from typing import Optional

from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Minimum number of key=value pairs per line to consider it a KV line.
_MIN_KV_PAIRS_PER_LINE = 3

# Fraction of sampled lines that must look like KV for us to confirm the
# format.  0.6 means 60 % of non-blank, non-comment lines must pass.
_KV_CONFIDENCE_THRESHOLD = 0.6

# Tokeniser: matches either
#   key="quoted value"   (group 1 = key, group 2 = quoted value)
#   key=unquoted_value   (group 3 = key, group 4 = bare value)
# Keys may contain letters, digits, underscores, hyphens, and dots.
_KV_TOKEN_RE = re.compile(
    r'([\w\-.]+)="([^"]*)"'   # quoted value
    r'|'
    r'([\w\-.]+)=([^\s"]*)'   # unquoted value
)

# ── Field normalisation map ────────────────────────────────────────────────────
#
# Maps vendor-specific field names → standard schema field names used
# throughout the pipeline (and expected by VT enrichment).
#
# Keys are lowercase because we normalise before lookup.

_FIELD_MAP: dict[str, str] = {
    # Network / IP
    "remip":        "src_ip",
    "srcip":        "src_ip",
    "src_ip":       "src_ip",
    "sourceip":     "src_ip",
    "dstip":        "dst_ip",
    "dst_ip":       "dst_ip",
    "destip":       "dst_ip",
    "destinationip":"dst_ip",

    # Country
    "srccountry":   "src_country",
    "src_country":  "src_country",
    "dstcountry":   "dst_country",
    "dst_country":  "dst_country",

    # Ports
    "srcport":      "src_port",
    "src_port":     "src_port",
    "dstport":      "dst_port",
    "dst_port":     "dst_port",

    # Auth / identity
    "user":         "user",
    "username":     "user",
    "cs_username":  "user",

    # Action / status
    "action":       "action",
    "status":       "sc_status",
    "sc_status":    "sc_status",

    # Protocol / tunnel
    "proto":        "protocol",
    "protocol":     "protocol",
    "tunneltype":   "tunnel_type",
    "tunnelid":     "tunnel_id",

    # Logging metadata
    "logid":        "log_id",
    "logdesc":      "log_desc",
    "type":         "log_type_field",
    "subtype":      "subtype",
    "level":        "level",
    "vd":           "vd",

    # Timing
    "eventtime":    "event_time",
    "tz":           "timezone",
    "duration":     "duration",
    "sentbyte":     "bytes_sent",
    "rcvdbyte":     "bytes_received",
}


# ── Public API ────────────────────────────────────────────────────────────────

def is_kv_log(sample_lines: list[str]) -> bool:
    """
    Returns True if the sample looks like a KV-structured log.

    Strategy
    --------
    1. Skip blank lines and comment lines (# / //).
    2. For each candidate line, count KV token matches.
    3. A line is a "KV line" if it has >= _MIN_KV_PAIRS_PER_LINE pairs.
    4. If >= _KV_CONFIDENCE_THRESHOLD of candidates are KV lines → True.

    The threshold avoids false positives on files that happen to contain
    a few key=value strings inside an otherwise unstructured format.

    Parameters
    ----------
    sample_lines : list[str]
        A representative sample of raw log lines (typically 20–200 lines).

    Returns
    -------
    bool
    """
    candidates = [
        line.strip()
        for line in sample_lines
        if line.strip() and not line.strip().startswith(("#", "//"))
    ]

    if not candidates:
        logger.debug("kv_detection_no_candidates")
        return False

    logger.debug(
        "kv_detection_started",
        candidate_lines=len(candidates),
    )

    kv_line_count = sum(
        1 for line in candidates
        if _count_kv_pairs(line) >= _MIN_KV_PAIRS_PER_LINE
    )

    confidence = kv_line_count / len(candidates)

    logger.debug(
        "kv_detection_scored",
        kv_lines=kv_line_count,
        total_candidates=len(candidates),
        confidence=round(confidence, 3),
        threshold=_KV_CONFIDENCE_THRESHOLD,
    )

    detected = confidence >= _KV_CONFIDENCE_THRESHOLD

    if detected:
        logger.info(
            "kv_detected",
            kv_lines=kv_line_count,
            total_candidates=len(candidates),
            confidence=round(confidence, 3),
        )
    else:
        logger.debug(
            "kv_not_detected",
            confidence=round(confidence, 3),
            threshold=_KV_CONFIDENCE_THRESHOLD,
        )

    return detected


def parse_kv_lines(lines: list[str]) -> list[dict]:
    """
    Parses a list of raw KV log lines into a list of normalised dicts.

    Each dict represents one log event.  Field names are normalised via
    _FIELD_MAP so that downstream components (VT enrichment, DataFrame
    builder) see standard field names regardless of the vendor format.

    Lines that produce zero KV pairs are stored as ``{"_raw": line,
    "_unmatched": True}`` sentinel records so that LogParser.get_unmatched()
    can report them correctly — this matches the contract used by
    RegexEngine.apply_pattern().

    Lines that are blank or start with # / // are silently skipped.

    Parameters
    ----------
    lines : list[str]
        All lines from the uploaded file (not just the sample).

    Returns
    -------
    list[dict]
        One dict per parsed log event plus sentinel dicts for unmatched lines.
    """
    records: list[dict] = []
    parsed_count = 0
    unmatched_count = 0

    for raw_line in lines:
        line = raw_line.strip()

        # Skip blank lines and comment lines
        if not line or line.startswith(("#", "//")):
            continue

        pairs = _extract_kv_pairs(line)

        if not pairs:
            # Preserve unmatched lines using the same sentinel format as
            # RegexEngine so LogParser.get_unmatched() works unchanged.
            records.append({"_unmatched": True, "_raw": raw_line})
            unmatched_count += 1
            continue

        normalised = _normalise_fields(pairs)

        # Merge date + time into timestamp if both present and no timestamp yet
        _merge_timestamp(normalised)

        records.append(normalised)
        parsed_count += 1

    logger.info(
        "kv_parsing_complete",
        parsed=parsed_count,
        unmatched=unmatched_count,
        total=parsed_count + unmatched_count,
    )

    # Log a sample of extracted fields for observability
    if records:
        first_matched = next((r for r in records if not r.get("_unmatched")), None)
        if first_matched:
            logger.info(
                "kv_fields_extracted",
                sample_fields=list(first_matched.keys()),
                has_src_ip="src_ip" in first_matched,
                has_dst_ip="dst_ip" in first_matched,
                has_timestamp="timestamp" in first_matched,
            )

    return records


def build_kv_pattern(filename: str) -> dict:
    """
    Returns a synthetic pattern dict for a KV-parsed file.

    This keeps the rest of the pipeline (upload.py, ParseResponse) uniform:
    every parse path returns a pattern dict, so no special-casing is needed
    downstream.

    Parameters
    ----------
    filename : str
        Original uploaded filename — used to build a human-readable name.

    Returns
    -------
    dict
        Synthetic pattern with source="kv_parser".
    """
    return {
        "id":       "kv_auto",
        "name":     f"KV Auto-detected ({filename})",
        "log_type": "kv",
        "pattern":  "",           # no regex — not used for KV path
        "fields":   [],           # fields are dynamic per line
        "source":   "kv_parser",
    }


# ── Private helpers ───────────────────────────────────────────────────────────

def _count_kv_pairs(line: str) -> int:
    """Returns the number of key=value tokens found in a line."""
    return len(_KV_TOKEN_RE.findall(line))


def _extract_kv_pairs(line: str) -> dict[str, str]:
    """
    Extracts all key=value pairs from a single log line.

    Handles:
    - Quoted values:   key="some value"
    - Unquoted values: key=value
    - Empty values:    key=""  or  key=
    - Numeric values:  key=12345

    Returns a raw (un-normalised) dict of string → string.
    """
    result: dict[str, str] = {}

    for match in _KV_TOKEN_RE.finditer(line):
        if match.group(1) is not None:
            # Quoted branch: groups 1 and 2
            key   = match.group(1)
            value = match.group(2)
        else:
            # Unquoted branch: groups 3 and 4
            key   = match.group(3)
            value = match.group(4)

        result[key] = value if value is not None else ""

    return result


def _normalise_fields(raw: dict[str, str]) -> dict[str, str]:
    """
    Applies _FIELD_MAP to rename vendor-specific keys to standard names.

    Unknown keys are kept as-is so no data is lost.
    All keys are lowercased before lookup.
    """
    normalised: dict[str, str] = {}

    for key, value in raw.items():
        lower_key = key.lower()
        standard_key = _FIELD_MAP.get(lower_key, lower_key)
        normalised[standard_key] = value

    return normalised


def _merge_timestamp(record: dict[str, str]) -> None:
    """
    Merges 'date' and 'time' fields into a single 'timestamp' field
    if both are present and 'timestamp' is not already set.

    Mutates the record in-place.
    """
    if "timestamp" in record:
        return

    date_val: Optional[str] = record.get("date")
    time_val: Optional[str] = record.get("time")

    if date_val and time_val:
        record["timestamp"] = f"{date_val} {time_val}"