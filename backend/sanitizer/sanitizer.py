import re
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Hard limit on processed line length.
# Lines longer than this are truncated before regex processing.
#
# Rationale:
#   - Regex engines exhibit worst-case exponential backtracking on long
#     strings with certain patterns (ReDoS). Capping line length at a
#     safe value eliminates this class of vulnerability entirely.
#   - 8192 bytes covers all realistic single-line log entries including
#     verbose IIS lines, long URLs, and audit events with stack traces.
#   - Stack traces or base64 blobs that exceed this are not parseable
#     as structured log fields anyway.
MAX_LINE_LENGTH: int = 8192

# ── Compiled patterns — built once at module load, reused for every line ──────

# Matches ASCII control characters EXCEPT:
#   \t  (0x09) — horizontal tab, used in some log formats as field separator
#   \n  (0x0A) — newline, line boundary — handled by splitlines() upstream
#   \r  (0x0D) — carriage return — handled by splitlines() upstream
#
# Includes:
#   \x00–\x08  null through backspace
#   \x0B       vertical tab
#   \x0C       form feed
#   \x0E–\x1F  shift out through unit separator
#   \x7F       delete (DEL)
#
# These appear in logs due to:
#   - Corrupted file transfers (null bytes)
#   - Malicious input attempting to break parsers
#   - Encoding mismatches on non-UTF-8 systems
_CONTROL_CHAR_PATTERN: re.Pattern = re.compile(
    r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]"
)

# Matches two or more consecutive whitespace characters EXCLUDING newlines.
# We normalise these to a single space.
# Tabs are included here — a tab followed by a space becomes a single space.
_MULTI_WHITESPACE_PATTERN: re.Pattern = re.compile(r"[ \t]{2,}")


# ── Private helpers ───────────────────────────────────────────────────────────

def _remove_control_characters(line: str) -> tuple[str, int]:
    """
    Removes unsafe ASCII control characters from a single line.

    Preserves:
        \\t  tab           — field separator in some log formats
        \\n  newline       — not present in single lines (already split)
        All printable ASCII and Unicode characters

    Characters preserved intentionally in logs:
        [ ] : / . - _ @ = %
        These are structural characters in timestamps, IPs, URLs,
        HTTP methods, file paths, and query strings. This function
        does not touch them.

    Args:
        line: A single log line (no embedded newlines)

    Returns:
        (cleaned_line, count_of_characters_removed)
    """
    cleaned = _CONTROL_CHAR_PATTERN.sub("", line)
    removed = len(line) - len(cleaned)
    return cleaned, removed


def _normalize_whitespace(line: str) -> str:
    """
    Collapses runs of spaces and tabs into a single space.

    Example:
        "Oct 10   13:55:36   server01"
        →  "Oct 10 13:55:36 server01"

    Does NOT collapse across newlines — this function operates on
    a single line that has already been split from the file content.

    Args:
        line: A single log line after control character removal

    Returns:
        Line with all internal whitespace runs collapsed to one space
    """
    return _MULTI_WHITESPACE_PATTERN.sub(" ", line)


def _truncate_line(line: str, max_length: int = MAX_LINE_LENGTH) -> tuple[str, bool]:
    """
    Truncates a line to max_length characters if necessary.

    Truncation is hard (character boundary) not word-aware, because log
    parsing is field-based and the relevant fields appear at the start
    of most log formats. Keeping the beginning preserves timestamp, IP,
    and action fields even when the tail (URL, user agent, message) is
    cut.

    Args:
        line:       A single log line
        max_length: Maximum allowed character count

    Returns:
        (possibly_truncated_line, was_truncated: bool)
    """
    if len(line) <= max_length:
        return line, False
    return line[:max_length], True


# ── Public API ────────────────────────────────────────────────────────────────

def sanitize_line(line: str) -> str:
    """
    Sanitizes a single log line.

    Processing steps (in order):
        1. Safe unicode coercion — encode/decode round-trip replaces
           invalid byte sequences without crashing
        2. Remove control characters (except tab)
        3. Strip leading and trailing whitespace
        4. Normalize internal whitespace runs to single spaces
        5. Truncate to MAX_LINE_LENGTH if necessary

    Preserved characters (never removed):
        [ ] : / . - _ @ = %
        These are structural characters in log fields.

    Args:
        line: A raw log line, possibly containing unsafe characters

    Returns:
        A cleaned string. May be empty if the line contained only
        control characters and whitespace — the caller decides whether
        to discard empty results (sanitize_lines() does discard them).

    Example:
        >>> sanitize_line("  Oct 10   13:55:36\\x00 server01  ")
        'Oct 10 13:55:36 server01'
    """
    # ── Safe unicode coercion ─────────────────────────────────────────────
    # encode to UTF-8 replacing invalid sequences → decode back to str.
    # This handles logs from systems with mixed or broken encodings
    # without raising UnicodeDecodeError or UnicodeEncodeError.
    try:
        line = line.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    except (UnicodeEncodeError, UnicodeDecodeError):
        # Extremely unlikely after the round-trip above, but never crash.
        line = line.encode("ascii", errors="replace").decode("ascii", errors="replace")

    # ── Remove control characters ─────────────────────────────────────────
    line, _ = _remove_control_characters(line)

    # ── Strip leading and trailing whitespace ─────────────────────────────
    line = line.strip()

    # ── Normalize internal whitespace ─────────────────────────────────────
    line = _normalize_whitespace(line)

    # ── Truncate if necessary ─────────────────────────────────────────────
    line, _ = _truncate_line(line)

    return line


def sanitize_lines(lines: list[str]) -> list[str]:
    """
    Sanitizes a list of log lines and removes empty results.

    Applies sanitize_line() to every entry, then filters out lines
    that became empty after sanitization (blank lines, lines that
    consisted entirely of control characters, etc.).

    This is the main entry point for the log ingestion pipeline.
    Call this after read_lines() and before detect_pattern().

    Statistics logged:
        lines_processed         — total input count
        lines_removed           — lines that became empty after sanitizing
        lines_truncated         — lines that exceeded MAX_LINE_LENGTH
        total_control_chars     — sum of control chars removed across all lines
        lines_cleaned           — lines that were modified in any way

    Args:
        lines: Raw log lines from ingestion.read_lines()

    Returns:
        Cleaned, non-empty lines ready for pattern detection.

    Example:
        >>> sanitize_lines([
        ...     "  Oct 10   13:55:36 server01  ",
        ...     "",
        ...     "Oct 10 13:55:37 server01\\x00",
        ... ])
        ['Oct 10 13:55:36 server01', 'Oct 10 13:55:37 server01']
    """
    lines_processed      = len(lines)
    lines_removed        = 0
    lines_truncated      = 0
    total_control_chars  = 0
    lines_cleaned        = 0

    result: list[str] = []

    for raw_line in lines:
        original = raw_line

        # ── Safe unicode coercion ─────────────────────────────────────────
        try:
            line = raw_line.encode("utf-8", errors="replace").decode(
                "utf-8", errors="replace"
            )
        except (UnicodeEncodeError, UnicodeDecodeError):
            line = raw_line.encode("ascii", errors="replace").decode(
                "ascii", errors="replace"
            )

        # ── Remove control characters ─────────────────────────────────────
        line, ctrl_removed = _remove_control_characters(line)
        total_control_chars += ctrl_removed

        # ── Strip ─────────────────────────────────────────────────────────
        line = line.strip()

        # ── Discard empty lines ───────────────────────────────────────────
        if not line:
            lines_removed += 1
            continue

        # ── Normalize whitespace ──────────────────────────────────────────
        line = _normalize_whitespace(line)

        # ── Truncate ──────────────────────────────────────────────────────
        line, was_truncated = _truncate_line(line)
        if was_truncated:
            lines_truncated += 1

        # ── Track whether this line was modified at all ───────────────────
        if line != original.strip():
            lines_cleaned += 1

        result.append(line)

    logger.info(
        "sanitization_complete",
        lines_processed=lines_processed,
        lines_returned=len(result),
        lines_removed=lines_removed,
        lines_truncated=lines_truncated,
        lines_cleaned=lines_cleaned,
        total_control_chars_removed=total_control_chars,
    )

    return result