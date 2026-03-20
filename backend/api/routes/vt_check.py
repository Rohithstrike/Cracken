from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone

from backend.config import settings
from backend.vt_cache import get as cache_get, set as cache_set, stats as cache_stats

router = APIRouter()


class VTRequest(BaseModel):
    indicator: str  # IP or URL


class VTResponse(BaseModel):
    indicator: str
    status: str        # Clean / Suspicious / Malicious
    score: int
    last_checked: str


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@router.post("/vt_check", response_model=VTResponse)
async def vt_check(request: VTRequest):
    # ✅ Use API key from settings
    vt_api_key = settings.vt_api_key
    if not vt_api_key:
        raise HTTPException(status_code=503, detail="VT_API_KEY is not configured on the server.")

    indicator = request.indicator.strip().lower()

    # Check cache first
    cached = cache_get(indicator)
    if cached:
        return VTResponse(
            indicator=indicator,
            status=cached["status"],
            score=cached["score"],
            last_checked=cached["last_checked"]
        )

    # Simulated VT API call (replace with real VT call using vt_api_key)
    # Here we just simulate a clean result
    result = {
        "status": "Clean",
        "score": 0,
        "last_checked": _now_utc_iso()
    }

    # Cache result
    cache_set(indicator, result)

    return VTResponse(
        indicator=indicator,
        status=result["status"],
        score=result["score"],
        last_checked=result["last_checked"]
    )


# Optional: cache stats for debugging
@router.get("/vt_cache_stats")
async def vt_cache_stats_endpoint():
    return cache_stats()