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


class ErrorResponse(BaseModel):
    """Standard error shape for manually constructed errors."""
    success: bool = False
    error: str
    detail: Optional[str] = None


class LogTypeInfo(BaseModel):
    """
    Describes one available log pattern.
    Returned by GET /api/log-types (Step 2).
    """
    id: str
    name: str
    log_type: str
    source: str
    field_count: int
    sample: Optional[str] = None