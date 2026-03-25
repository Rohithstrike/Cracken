from pathlib import Path
from typing import Union, Optional
import re as _re
import uuid

from fastapi import APIRouter, File, Query, UploadFile, HTTPException, status
from fastapi.responses import Response

from backend.utils.validators import validate_upload
from backend.core.ingestion import (
    save_upload,
    read_lines,
    sample_lines,
    delete_file,
)
from backend.core.regex_engine import RegexEngine
from backend.core.parser import LogParser
from backend.core.exporter import records_to_csv, build_csv_filename
from backend.storage.pattern_store import PatternStore
from backend.models.responses import ParseResponse, ResponseFormat
from backend.api.routes.export import csv_response
from backend.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["log ingestion"])

# ── Module-level singletons ───────────────────────────────────────────────────
_store  = PatternStore()
_engine = RegexEngine(_store)
_parser = LogParser()

# Maximum rows returned when preview_only=true
MAX_PREVIEW_ROWS = 100


@router.post(
    "/upload",
    summary="Upload and parse a log file",
    description=(
        "Accepts a .log or .txt file. Validates, detects the log format, "
        "and returns structured data. "
        "Supports optional pattern_id for manual format selection, "
        "format=csv for CSV download, and preview_only=true for large files."
    ),
    response_model=None,
)
async def upload_log_file(
    file: UploadFile = File(..., description="Log file (.log or .txt)"),
    format: ResponseFormat = Query(
        default=ResponseFormat.json,
        description=(
            "'json' returns structured JSON (default). "
            "'csv' returns a downloadable CSV file."
        ),
    ),
    pattern_id: Optional[str] = Query(
        default=None,
        description=(
            "Optional. Force a specific pattern by id (e.g. 'linux_auth', 'iis_w3c'). "
            "If omitted, automatic detection is used. "
            "Use GET /api/log-types to see available pattern ids."
        ),
    ),
    preview_only: bool = Query(
        default=False,
        description=(
            f"If true, returns only the first {MAX_PREVIEW_ROWS} matched rows. "
            "Useful for large files where a full response would be too large. "
            "Match statistics still reflect the full file."
        ),
    ),
) -> Union[ParseResponse, Response]:
    """
    Full pipeline:

        1. Validate      — extension, size, magic bytes
        2. Save          — write to tmp/uploads/ with unique filename
        3. Read          — decode text, split into lines
        4. Select pattern:
               a. pattern_id provided → load from store directly
               b. auto-detect        → score ALL lines
               c. KV detection       → parse as key=value if confident
               d. no match           → AI fallback → validate → save → use
        5. Apply         — extract fields from all lines
        6. Parse         — build typed, ordered DataFrame
        7. VT enrichment — append src_vt_reputation and dst_vt_reputation
        8. Preview slice — if preview_only, cap rows at MAX_PREVIEW_ROWS
        9. Respond       — JSON or CSV

    AI fallback notes:
        - Only triggered when no pattern matches AND pattern_id is not given
          AND the file is not detected as KV format
        - Sanitizes and masks log lines before sending to AI
        - Validates AI-generated regex before trusting it
        - Saves successful patterns to learned.json for future reuse
        - Requires Ollama running locally (or OpenAI/Claude configured in .env)

    KV parser notes:
        - Triggered when regex detection fails and file contains key=value lines
        - No AI call, no regex dependency — pure structural parsing
        - Normalises vendor field names (remip->src_ip, srccountry->src_country)
        - src_ip is extracted so VT enrichment works automatically
        - Never saves a pattern — KV detection is stateless and always re-runs

    VT enrichment notes:
        - Only runs when VT_ENABLED=true and VT_API_KEY is set in .env
        - Deduplicates IPs before calling VT — one call per unique IP
        - Results are cached per TTL set by VT_CACHE_TTL_SECONDS
        - Never breaks the pipeline — sets "unknown" on any failure
        - CSV export includes VT columns in full dataset
        - vt_stats included in JSON response: {"unique_ips": N, "api_calls": N}
        - vt_stats is null in JSON response when VT is disabled or no IPs found

    Large file notes:
        - preview_only=true caps the response rows at MAX_PREVIEW_ROWS
        - Match statistics (matched_lines, match_rate) always reflect the FULL file
        - CSV export always contains ALL matched rows regardless of preview_only
    """
    logger.info(
        "upload_received",
        filename=file.filename,
        format=format.value,
        pattern_id=pattern_id,
        preview_only=preview_only,
    )

    # ── Step 1: Validate ──────────────────────────────────────────────────
    content = await file.read()
    validate_upload(content, file.filename)

    # ── Step 2: Save ──────────────────────────────────────────────────────
    saved_path: Path = save_upload(content, file.filename)

    # ── Step 3: Read ──────────────────────────────────────────────────────
    try:
        lines = read_lines(saved_path)
    except Exception as exc:
        logger.error(
            "file_read_failed",
            filename=file.filename,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read uploaded file: {exc}",
        ) from exc
    finally:
        delete_file(saved_path)

    if not lines:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file contains no readable lines.",
        )

    # ── Step 4: Select pattern ────────────────────────────────────────────
    #
    # _select_pattern returns a (pattern, records) tuple.
    #
    # For the regex and AI paths:   records=None  (apply_pattern runs below)
    # For the KV path:              records is pre-populated by kv_parser
    #
    # This avoids running apply_pattern() on a KV file (it has no regex)
    # while keeping Steps 5-10 completely unchanged.

    matched_pattern, kv_records = await _select_pattern(
        lines=lines,
        pattern_id=pattern_id,
        filename=file.filename,
    )

    # ── Step 5: Apply ─────────────────────────────────────────────────────
    # For KV files the records are already built — skip apply_pattern().
    if kv_records is not None:
        records = kv_records
    else:
        records = _engine.apply_pattern(matched_pattern, lines)

    # ── Step 6: Parse ─────────────────────────────────────────────────────
    df        = _parser.build_dataframe(records)
    unmatched = _parser.get_unmatched(records)

    if df.empty:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Pattern '{matched_pattern['name']}' produced no structured rows. "
                f"The file may contain only header or comment lines."
            ),
        )

    # ── Step 7: Compute statistics on the full dataset ────────────────────
    matched_count   = len(df)
    unmatched_count = len(unmatched)
    total_processed = matched_count + unmatched_count
    match_rate      = (
        round(matched_count / total_processed, 4)
        if total_processed > 0 else 0.0
    )

    # rows = full parsed dataset, serialised to plain Python dicts.
    # This must happen before VT enrichment because enrich_with_vt()
    # operates on plain dicts, not on the DataFrame.
    rows = _parser.dataframe_to_json_rows(df)

    # ── Step 8: VT enrichment ─────────────────────────────────────────────
    # Appends src_vt_reputation + dst_vt_reputation to every row in-place.
    #
    # enrich_with_vt() now returns (enriched_rows, vt_stats) where:
    #   vt_stats = {"unique_ips": int, "api_calls": int}  when VT ran
    #   vt_stats = None                                   when VT skipped
    #
    # Key properties (all unchanged):
    #   - Runs on the FULL rows list so CSV export always has VT columns.
    #   - Deduplicates IPs internally — one VT call per unique IP.
    #   - Is a no-op (sets "unknown") when VT_ENABLED=false or no API key.
    #   - Never raises — any failure returns rows unchanged with "unknown".
    #
    # Placement: after dataframe_to_json_rows() and BEFORE the preview
    # slice so that both the JSON preview and the CSV export see VT data.
    rows, vt_stats = _parser.enrich_with_vt(rows)

    # Rebuild the columns list AFTER enrichment so the two new VT fields
    # are included in the response columns array when VT is active.
    # When VT is disabled enrich_with_vt() still appends the fields with
    # value "unknown", so columns is always consistent with row content.
    columns = list(rows[0].keys()) if rows else list(df.columns)

    # ── Step 9: Preview slice ─────────────────────────────────────────────
    # Sliced dataset — only used by JSON when preview_only=True.
    # CSV always uses the full `rows` list (see Step 10).
    response_rows = rows[:MAX_PREVIEW_ROWS] if preview_only else rows
    is_preview    = preview_only and len(rows) > MAX_PREVIEW_ROWS

    logger.info(
        "parse_complete",
        filename=file.filename,
        pattern_id=matched_pattern["id"],
        pattern_source=matched_pattern.get("source", "builtin"),
        format=format.value,
        total_lines=len(lines),
        matched=matched_count,
        unmatched=unmatched_count,
        match_rate=match_rate,
        preview_only=preview_only,
        vt_columns_present="src_vt_reputation" in columns,
        vt_unique_ips=vt_stats["unique_ips"] if vt_stats else None,
        vt_api_calls=vt_stats["api_calls"] if vt_stats else None,
    )

    # ── Step 10: Respond ──────────────────────────────────────────────────

    if format == ResponseFormat.csv:
        # CSV always uses full rows — never the preview slice.
        # VT columns are included because enrichment ran on the full list.
        csv_filename = build_csv_filename(file.filename, matched_pattern["id"])
        csv_bytes, csv_filename = records_to_csv(columns, rows, csv_filename)
        return csv_response(csv_bytes, csv_filename)

    # JSON uses the preview slice
    return ParseResponse(
        success=True,
        filename=file.filename,
        pattern_id=matched_pattern["id"],
        pattern_name=matched_pattern["name"],
        log_type=matched_pattern.get("log_type", "unknown"),
        pattern_source=matched_pattern.get("source", "builtin"),
        total_lines=len(lines),
        matched_lines=matched_count,
        unmatched_lines=unmatched_count,
        match_rate=match_rate,
        columns=columns,
        rows=response_rows,
        unmatched_preview=unmatched[:5],
        message=_build_message(
            matched_count=matched_count,
            total_lines=len(lines),
            pattern_name=matched_pattern["name"],
            unmatched_count=unmatched_count,
            is_preview=is_preview,
            preview_rows=MAX_PREVIEW_ROWS,
        ),
        vt_stats=vt_stats,  # None when VT disabled/skipped, dict when VT ran
    )


# ─────────────────────────────────────────────────────────────────────────────
# Pattern selection — extracted to keep the route handler readable
# ─────────────────────────────────────────────────────────────────────────────

async def _select_pattern(
    lines: list[str],
    pattern_id: Optional[str],
    filename: str,
) -> tuple[dict, Optional[list[dict]]]:
    """
    Resolves the pattern to use for parsing.

    Priority:
        1. pattern_id provided -> load from store, raise 404 if not found
        2. Auto-detect         -> score all lines against pattern library
        3. KV detection        -> parse as key=value structured log
        4. AI fallback         -> generate, validate, save, return

    Returns
    -------
    tuple[dict, Optional[list[dict]]]
        (pattern, records)

        For paths 1, 2, 4:  records=None  -> caller runs apply_pattern()
        For path 3 (KV):    records is the pre-built list of dicts from
                            kv_parser — caller skips apply_pattern()

    Raises HTTPException on all failure paths.
    """

    # ── Path A: manual pattern selection ─────────────────────────────────
    if pattern_id:
        return _load_pattern_by_id(pattern_id), None

    # ── Path B: automatic regex detection ────────────────────────────────
    logger.info(
        "starting_pattern_detection",
        filename=filename,
        total_lines=len(lines),
    )

    matched_pattern = _engine.detect_pattern(lines)

    if matched_pattern:
        return matched_pattern, None

    # ── Path C: KV detection ──────────────────────────────────────────────
    #
    # Runs BEFORE AI fallback.  If the file is a well-structured KV log
    # (key=value pairs, >= 60 % of lines match) we parse it directly.
    # This avoids an unnecessary AI call and produces better field names.
    #
    # The KV path returns pre-built records so the caller can skip
    # apply_pattern() (which expects a regex-based pattern dict).
    kv_result = _run_kv_path(lines, filename)
    if kv_result is not None:
        return kv_result  # (pattern, records)

    # ── Path D: AI fallback ───────────────────────────────────────────────
    pattern = await _run_ai_fallback(lines, filename)
    return pattern, None


def _run_kv_path(
    lines: list[str],
    filename: str,
) -> Optional[tuple[dict, list[dict]]]:
    """
    Attempts to parse the file as a KV-structured log.

    Returns
    -------
    tuple[dict, list[dict]]
        (synthetic_pattern, records) if KV format is detected.
    None
        If the file does not look like KV — caller falls through to AI.
    """
    from backend.core.kv_parser import is_kv_log, parse_kv_lines, build_kv_pattern
    from backend.core.ingestion import sample_lines as _sample_lines

    # Use the same sample_lines helper used by the AI path for consistency.
    sample = _sample_lines(lines)

    if not is_kv_log(sample):
        return None

    # KV format confirmed — parse the full file, not just the sample.
    logger.info(
        "kv_path_selected",
        filename=filename,
        total_lines=len(lines),
    )

    records = parse_kv_lines(lines)
    pattern = build_kv_pattern(filename)

    return pattern, records


def _load_pattern_by_id(pattern_id: str) -> dict:
    """
    Loads a pattern by id from the store.
    Raises HTTP 404 if the id is not found.
    """
    pattern = _store.find_by_id(pattern_id)

    if not pattern:
        available = [p.get("id", "") for p in _store.all()]
        logger.warning(
            "manual_pattern_id_not_found",
            requested=pattern_id,
            available=available,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Pattern '{pattern_id}' not found in the library. "
                f"Available patterns: {', '.join(available)}. "
                f"Use GET /api/log-types to see all options."
            ),
        )

    logger.info(
        "manual_pattern_selected",
        pattern_id=pattern_id,
        pattern_name=pattern.get("name"),
    )
    return pattern


async def _run_ai_fallback(lines: list[str], filename: str) -> dict:
    """
    Calls the AI engine to generate a regex for an unrecognised log format.

    Validation rules applied in order:
        1. regex must be a non-empty string
        2. regex must compile without error
        3. regex must match at least one line in the sample (match_rate > 0)
           — prevents saving and using a syntactically valid but
             semantically wrong regex that matches nothing

    Fields list is preferred but non-fatal if absent.

    Raises HTTP 422 if regex is empty, does not compile, or matches nothing.
    Raises HTTP 503 if the AI provider is unavailable.
    Does NOT save the pattern unless all three checks pass.
    """
    ai_sample = sample_lines(lines)

    logger.warning(
        "no_pattern_detected_activating_ai_fallback",
        filename=filename,
        total_lines=len(lines),
        ai_sample_size=len(ai_sample),
        ai_sample_preview=ai_sample[:2],
    )

    try:
        from backend.ai.ai_engine import generate_regex_with_ai
        ai_result = await generate_regex_with_ai(lines)
    except RuntimeError as exc:
        logger.error(
            "ai_fallback_provider_failed",
            filename=filename,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"No regex pattern matched the uploaded file and the AI "
                f"fallback failed: {exc}. "
                f"Check that your AI provider is running and configured in .env."
            ),
        ) from exc
    except ValueError as exc:
        logger.error(
            "ai_fallback_preparation_failed",
            filename=filename,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    ai_regex  = ai_result.get("regex", "").strip()
    ai_fields = ai_result.get("fields", [])

    # ── Check 1: regex must exist ─────────────────────────────────────────
    if not ai_regex:
        logger.error(
            "ai_fallback_empty_regex",
            filename=filename,
            ai_result=str(ai_result)[:200],
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "The AI model did not return a usable regex pattern. "
                "Try uploading a larger sample or switching AI providers."
            ),
        )

    if not ai_fields:
        # Non-fatal: fields can be inferred from named groups at parse time
        logger.warning(
            "ai_fallback_no_fields_returned",
            filename=filename,
            regex_preview=ai_regex[:120],
        )

    # ── Check 2: regex must compile ───────────────────────────────────────
    try:
        compiled = _re.compile(ai_regex)
    except _re.error as exc:
        logger.error(
            "ai_fallback_regex_does_not_compile",
            filename=filename,
            regex_preview=ai_regex[:120],
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"The AI-generated regex does not compile: {exc}. "
                f"Try uploading a larger or more representative sample."
            ),
        ) from exc

    # ── Check 3: regex must match at least one sample line ────────────────
    clean_sample = [
        line.strip()
        for line in ai_sample
        if line.strip() and not line.strip().startswith("#")
    ]

    matched_in_sample = sum(
        1 for line in clean_sample
        if compiled.search(line)
    )

    sample_match_rate = (
        matched_in_sample / len(clean_sample)
        if clean_sample else 0.0
    )

    logger.info(
        "ai_fallback_sample_match_check",
        filename=filename,
        clean_sample_lines=len(clean_sample),
        matched_in_sample=matched_in_sample,
        sample_match_rate=round(sample_match_rate, 4),
    )

    if matched_in_sample == 0:
        logger.error(
            "ai_fallback_regex_matches_nothing",
            filename=filename,
            regex_preview=ai_regex[:120],
            clean_sample_size=len(clean_sample),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "AI-generated pattern did not match any log lines. "
                "Try uploading more representative data."
            ),
        )

    # ── All checks passed — build, save, and return the pattern ──────────
    new_pattern = {
        "id":       f"ai_{uuid.uuid4().hex[:8]}",
        "name":     f"AI-generated ({filename})",
        "log_type": "unknown",
        "pattern":  ai_regex,
        "fields":   ai_fields if ai_fields else [],
        "source":   "ai_generated",
    }

    _store.save_learned(new_pattern)

    logger.info(
        "ai_fallback_pattern_saved",
        pattern_id=new_pattern["id"],
        fields=ai_fields,
        sample_match_rate=round(sample_match_rate, 4),
    )

    return new_pattern


def _build_message(
    matched_count: int,
    total_lines: int,
    pattern_name: str,
    unmatched_count: int,
    is_preview: bool,
    preview_rows: int,
) -> str:
    """Builds the human-readable summary message for the JSON response."""
    base = (
        f"Parsed {matched_count}/{total_lines} lines using "
        f"'{pattern_name}'. "
        f"{unmatched_count} line(s) did not match."
    )
    if is_preview:
        base += (
            f" Showing first {preview_rows} rows. "
            f"Use ?format=csv to download all {matched_count} rows."
        )
    return base