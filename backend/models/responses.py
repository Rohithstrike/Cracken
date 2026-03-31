from enum import Enum
from pydantic import BaseModel
from typing import Optional, Any


class ResponseFormat(str, Enum):
    """
    Controls the response format from /api/upload.
    json  → structured JSON (default, existing behaviour)
    csv   → downloadable CSV file
    """
    json = "json"
    csv  = "csv"


class UploadResponse(BaseModel):
    """Returned after a file is validated and saved."""
    success: bool
    filename: str
    saved_as: str
    size_kb: float
    total_lines: int
    preview: list[str]
    message: str


class ParseResponse(BaseModel):
    """
    Returned after a file has been fully parsed.
    Used for JSON responses. CSV responses bypass this model
    and return a raw file download instead.
    """
    success: bool
    filename: str
    pattern_id: Optional[str] = None
    pattern_name: Optional[str] = None
    log_type: Optional[str] = None
    pattern_source: str = "builtin"
    total_lines: int
    matched_lines: int
    unmatched_lines: int
    match_rate: float
    columns: list[str]
    rows: list[dict[str, Any]]
    unmatched_preview: list[str]
    message: str
    # ── VT enrichment statistics ──────────────────────────────────────────
    # None when VT is disabled, not configured, or no IPs were found.
    # Present with {"unique_ips": int, "api_calls": int} when VT ran.
    vt_stats: Optional[dict[str, int]] = None
    # ── Server-side pagination ────────────────────────────────────────────
    # Describes which slice of the full dataset this response contains.
    # page       → current page number (1-based)
    # page_size  → number of rows per page (default 100, max 500)
    # total_pages → total number of pages for the full dataset
    # total_rows  → total matched rows across ALL pages (unsliced count)
    page: int = 1
    page_size: int = 100
    total_pages: int = 1
    total_rows: int = 0