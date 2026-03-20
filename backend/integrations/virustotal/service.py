"""
service.py
----------
Orchestration layer for VirusTotal IP enrichment.

Responsibilities:
    1. Extract unique src_ip and dst_ip values from a list of row dicts
    2. Check the in-process cache — skip IPs already resolved
    3. Call the VT API in parallel using ThreadPoolExecutor
    4. Store results back in cache
    5. Return a Dict[ip, reputation] ready for O(1) row enrichment

This module is the ONLY place that touches threads.
client.py and cache.py have no knowledge of concurrency.
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Set, Tuple, Optional

from backend.config import settings
from backend.integrations.virustotal.cache import get as cache_get, set as cache_set
from backend.integrations.virustotal.client import get_ip_reputation
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── IP field names the enricher looks for ────────────────────────────────────
SRC_IP_FIELDS: frozenset[str] = frozenset({"src_ip", "c_ip", "client_ip", "source_ip"})
DST_IP_FIELDS: frozenset[str] = frozenset({"dst_ip", "s_ip", "server_ip", "dest_ip", "destination_ip"})

_RATE_DELAY_SECS: float = 0.05


def _extract_unique_ips(
    rows: List[Dict[str, Any]],
) -> Tuple[Set[str], Set[str]]:
    _SKIP = {"", "-", "n/a", "none", "null", "unknown"}

    src_ips: Set[str] = set()
    dst_ips: Set[str] = set()

    for row in rows:
        for field in SRC_IP_FIELDS:
            val = row.get(field)
            if val and str(val).strip().lower() not in _SKIP:
                src_ips.add(str(val).strip())

        for field in DST_IP_FIELDS:
            val = row.get(field)
            if val and str(val).strip().lower() not in _SKIP:
                dst_ips.add(str(val).strip())

    return src_ips, dst_ips


def _resolve_ips_parallel(ips: Set[str]) -> Dict[str, str]:
    results: Dict[str, str] = {}
    to_query: List[str] = []

    for ip in ips:
        cached = cache_get(ip)
        if cached is not None:
            results[ip] = cached
        else:
            to_query.append(ip)

    logger.info(
        "vt_service_resolution_start",
        total_unique_ips=len(ips),
        cache_hits=len(results),
        api_calls_needed=len(to_query),
        workers=settings.max_vt_workers,
    )

    if not to_query:
        return results

    start = time.monotonic()

    with ThreadPoolExecutor(max_workers=settings.max_vt_workers) as executor:
        future_to_ip = {
            executor.submit(_call_with_delay, ip): ip
            for ip in to_query
        }

        for future in as_completed(future_to_ip):
            ip = future_to_ip[future]
            try:
                reputation = future.result()
            except Exception as exc:
                logger.error(
                    "vt_service_future_exception",
                    ip=ip,
                    error=str(exc),
                )
                reputation = "error"

            results[ip] = reputation
            cache_set(ip, reputation)

    elapsed = time.monotonic() - start
    logger.info(
        "vt_service_resolution_complete",
        api_calls_made=len(to_query),
        elapsed_seconds=round(elapsed, 3),
    )

    return results


def _call_with_delay(ip: str) -> str:
    try:
        reputation = get_ip_reputation(ip)
        if _RATE_DELAY_SECS > 0:
            time.sleep(_RATE_DELAY_SECS)
        return reputation
    except Exception as exc:
        logger.warning("vt_service_call_error", ip=ip, error=str(exc))
        return "error"


def enrich_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return rows

    if not settings.vt_configured:
        logger.debug("vt_enrichment_skipped_not_configured")
        return _append_unknown(rows)

    try:
        src_ips, dst_ips = _extract_unique_ips(rows)
        all_ips = src_ips | dst_ips

        if not all_ips:
            logger.debug("vt_enrichment_no_ips_found")
            return _append_unknown(rows)

        ip_map = _resolve_ips_parallel(all_ips)

        enriched: List[Dict[str, Any]] = []
        for row in rows:
            src_ip = _get_ip_from_row(row, SRC_IP_FIELDS)
            dst_ip = _get_ip_from_row(row, DST_IP_FIELDS)

            row["src_vt_reputation"] = ip_map.get(src_ip, "unknown") if src_ip else "unknown"
            row["dst_vt_reputation"] = ip_map.get(dst_ip, "unknown") if dst_ip else "unknown"
            enriched.append(row)

        logger.info(
            "vt_enrichment_complete",
            total_rows=len(enriched),
            unique_ips_resolved=len(ip_map),
        )
        return enriched

    except Exception as exc:
        logger.error(
            "vt_enrichment_pipeline_error",
            error=str(exc),
            rows_affected=len(rows),
        )
        return _append_unknown(rows)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_ip_from_row(row: Dict[str, Any], fields: frozenset[str]) -> Optional[str]:
    for field in fields:
        val = row.get(field)
        if val and str(val).strip() not in {"", "-", "N/A", "none", "null"}:
            return str(val).strip()
    return None


def _append_unknown(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for row in rows:
        row["src_vt_reputation"] = "unknown"
        row["dst_vt_reputation"] = "unknown"
    return rows