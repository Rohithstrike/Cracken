"""
cache.py
--------
Thread-safe in-memory TTL cache for VirusTotal reputation results.

Keyed by normalised IP/indicator string.
TTL is read from settings.vt_cache_ttl_seconds.

Each entry:
    {
        "value":      str,    # "clean" | "malicious" | "suspicious" | "unknown"
        "expires_at": float,  # monotonic clock timestamp
    }
"""

import time
from threading import Lock
from typing import Optional

from backend.config import settings
from backend.utils.logger import get_logger


logger = get_logger(__name__)

# ── Internal store ─────────────────────────────────────────────────────────────
_store: dict[str, dict] = {}
_lock = Lock()


def _key(indicator: str) -> str:
    """Normalise indicator to a consistent cache key."""
    return indicator.strip().lower()


def get(indicator: str) -> Optional[str]:
    """
    Return cached reputation string if present and not expired.
    Returns None on cache miss or expiry.
    """
    k = _key(indicator)
    with _lock:
        entry = _store.get(k)
        if entry is None:
            return None
        if time.monotonic() > entry["expires_at"]:
            del _store[k]
            logger.debug("vt_cache_expired", indicator=k)
            return None
        logger.debug("vt_cache_hit", indicator=k, value=entry["value"])
        return entry["value"]


def set(indicator: str, value: str) -> None:
    """
    Store a reputation value with a TTL-based expiry.
    Overwrites any existing entry for the same indicator.
    """
    k = _key(indicator)
    expires_at = time.monotonic() + settings.vt_cache_ttl_seconds
    with _lock:
        _store[k] = {"value": value, "expires_at": expires_at}
    logger.debug(
        "vt_cache_set",
        indicator=k,
        value=value,
        ttl=settings.vt_cache_ttl_seconds
    )


def invalidate(indicator: str) -> bool:
    """
    Remove a single indicator from the cache.
    Returns True if an entry was removed, False if it was not present.
    """
    k = _key(indicator)
    with _lock:
        existed = _store.pop(k, None) is not None
    if existed:
        logger.debug("vt_cache_invalidated", indicator=k)
    return existed


def clear_all() -> int:
    """Flush the entire cache. Returns the number of entries removed."""
    with _lock:
        count = len(_store)
        _store.clear()
    logger.info("vt_cache_cleared", entries_removed=count)
    return count


def stats() -> dict:
    """Return live cache statistics for observability / health endpoints."""
    now = time.monotonic()
    with _lock:
        live = sum(1 for e in _store.values() if e["expires_at"] > now)
        expired = len(_store) - live
        total = len(_store)
    return {
        "entries_live": live,
        "entries_expired": expired,
        "entries_total": total,
        "ttl_seconds": settings.vt_cache_ttl_seconds,
    }