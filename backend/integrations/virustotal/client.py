"""
client.py
---------
Thin HTTP client for the VirusTotal v3 Enterprise API.

Single responsibility: make one API call, return a normalised
reputation string. All caching and orchestration happen in service.py.

Reputation values returned:
    "clean"       — 0 engines flagged
    "suspicious"  — 1–2 engines flagged
    "malicious"   — 3+ engines flagged
    "unknown"     — VT has no record (HTTP 404)
    "error"       — any network / API failure
"""

import httpx

from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
VT_BASE_URL           = "https://www.virustotal.com/api/v3"
REQUEST_TIMEOUT_SECS  = 10

# Verdict thresholds — tunable without redeploying
THRESHOLD_SUSPICIOUS  = 1   # score >= 1 → suspicious
THRESHOLD_MALICIOUS   = 3   # score >= 3 → malicious


def _headers() -> dict[str, str]:
    return {
        "x-apikey": settings.vt_api_key,
        "Accept":   "application/json",
    }


def _score_to_reputation(malicious: int, suspicious: int) -> str:
    """
    Convert raw engine counts to a human-readable reputation label.

    Uses an effective score: malicious count + half of suspicious count
    so that many 'suspicious' votes can elevate a borderline indicator.
    """
    effective = malicious + (suspicious * 0.5)
    if effective >= THRESHOLD_MALICIOUS:
        return "malicious"
    if effective >= THRESHOLD_SUSPICIOUS:
        return "suspicious"
    return "clean"


def get_ip_reputation(ip: str) -> str:
    """
    Query VirusTotal for the reputation of a single IPv4 address.

    This function is intentionally synchronous — it is designed to be
    called from a ThreadPoolExecutor in service.py, never from the
    async event loop directly.

    Parameters
    ----------
    ip : str
        The IPv4 address to check.

    Returns
    -------
    str
        One of: "clean" | "suspicious" | "malicious" | "unknown" | "error"
    """
    if not ip or not settings.vt_api_key:
        return "unknown"

    url = f"{VT_BASE_URL}/ip_addresses/{ip.strip()}"

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECS) as client:
            resp = client.get(url, headers=_headers())
    except httpx.TimeoutException:
        logger.warning("vt_client_timeout", ip=ip)
        return "error"
    except httpx.RequestError as exc:
        logger.warning("vt_client_network_error", ip=ip, error=str(exc))
        return "error"

    # VT has no data for this IP — not flagged by anyone
    if resp.status_code == 404:
        logger.debug("vt_client_no_record", ip=ip)
        return "unknown"

    if resp.status_code == 401:
        logger.error("vt_client_unauthorised", ip=ip)
        return "error"

    if resp.status_code == 429:
        logger.warning("vt_client_rate_limited", ip=ip)
        return "error"

    if not resp.is_success:
        logger.warning("vt_client_unexpected_status", ip=ip, status=resp.status_code)
        return "error"

    try:
        body  = resp.json()
        stats = body["data"]["attributes"]["last_analysis_stats"]
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("vt_client_parse_error", ip=ip, error=str(exc))
        return "error"

    malicious  = int(stats.get("malicious",  0))
    suspicious = int(stats.get("suspicious", 0))
    reputation = _score_to_reputation(malicious, suspicious)

    logger.debug(
        "vt_client_result",
        ip=ip,
        malicious=malicious,
        suspicious=suspicious,
        reputation=reputation,
    )
    return reputation