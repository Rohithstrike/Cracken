import os
import time
from threading import Lock
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from backend.config import settings

# ── TTL ───────────────────────────────────────────────────────────────────────
TTL_SECONDS: int = settings.vt_cache_ttl_seconds

# ── Internal store ─────────────────────────────────────────────────────────────
_store: Dict[str, Dict[str, Any]] = {}
_lock = Lock()


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get(indicator: str) -> Optional[Dict[str, Any]]:
    key = indicator.strip().lower()
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        if time.monotonic() > entry["expires_at"]:
            del _store[key]
            return None
        return entry["result"]


def set(indicator: str, result: Dict[str, Any]) -> None:
    key = indicator.strip().lower()
    with _lock:
        _store[key] = {
            "result": result,
            "expires_at": time.monotonic() + TTL_SECONDS,
        }


def invalidate(indicator: str) -> bool:
    key = indicator.strip().lower()
    with _lock:
        return _store.pop(key, None) is not None


def stats() -> Dict[str, int]:
    with _lock:
        now = time.monotonic()
        live = sum(1 for e in _store.values() if e["expires_at"] > now)
        total = len(_store)
    return {
        "entries_live": live,
        "entries_total": total,
        "ttl_seconds": TTL_SECONDS
    }