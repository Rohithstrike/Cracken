from fastapi import APIRouter

from backend.models.log_type import LogTypeResponse
from backend.storage.pattern_store import PatternStore
from backend.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["log types"])

# ── Singleton ─────────────────────────────────────────────────────────────────
# Reuse the same store instance loaded at startup.
# PatternStore reads JSON files once — no repeated disk I/O per request.
_store = PatternStore()


@router.get(
    "/log-types",
    response_model=list[LogTypeResponse],
    summary="List available log patterns",
    description=(
        "Returns all built-in log patterns available for parsing. "
        "Use the returned pattern_id values to pre-select a format "
        "when uploading via POST /api/upload."
    ),
)
def get_log_types() -> list[LogTypeResponse]:
    """
    Returns the catalogue of known log formats.

    Behaviour:
    - Only returns builtin patterns — not AI-generated learned patterns.
      Learned patterns are implementation details; exposing them in the
      dropdown would confuse users with auto-generated names.
    - Filters out any entry missing required fields (id, name, fields).
      A corrupt or incomplete pattern entry must not crash the endpoint.
    - Returns an empty list if no valid patterns are loaded — never raises.

    Response is sorted by log_type then pattern_name so the frontend
    dropdown groups related formats together without needing its own
    sort logic.
    """
    raw_patterns = _store.builtin_patterns()

    result: list[LogTypeResponse] = []
    skipped = 0

    for pattern in raw_patterns:
        # ── Validate required fields ──────────────────────────────────────
        pattern_id   = pattern.get("id",       "")
        pattern_name = pattern.get("name",     "")
        log_type     = pattern.get("log_type", "unknown")
        fields       = pattern.get("fields",   [])

        if not pattern_id:
            logger.warning(
                "log_type_entry_skipped_no_id",
                entry=str(pattern)[:80],
            )
            skipped += 1
            continue

        if not pattern_name:
            logger.warning(
                "log_type_entry_skipped_no_name",
                pattern_id=pattern_id,
            )
            skipped += 1
            continue

        if not isinstance(fields, list) or not fields:
            logger.warning(
                "log_type_entry_skipped_no_fields",
                pattern_id=pattern_id,
            )
            skipped += 1
            continue

        result.append(
            LogTypeResponse(
                pattern_id=pattern_id,
                pattern_name=pattern_name,
                log_type=log_type,
                columns=fields,
            )
        )

    # Sort: group by log_type, then alphabetically by pattern_name
    result.sort(key=lambda r: (r.log_type, r.pattern_name))

    logger.info(
        "log_types_served",
        total=len(result),
        skipped=skipped,
    )

    return result