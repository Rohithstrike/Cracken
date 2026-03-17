import uuid
from pathlib import Path
from backend.config import settings
from backend.utils.logger import get_logger
from typing import List, Optional  # <-- added for Python 3.9 type hints

logger = get_logger(__name__)

# ── Upload directory ──────────────────────────────────────────────────────────
# Relative to the project root. Created automatically if it does not exist.
UPLOAD_DIR = Path("tmp") / "uploads"


def ensure_upload_dir() -> None:
    """Creates the upload directory if it does not already exist."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def save_upload(content: bytes, original_filename: str) -> Path:
    """
    Saves raw file bytes to the upload directory with a unique filename.
    Returns the Path to the saved file.

    The unique filename pattern is:
        {original_stem}_{uuid4_hex}{original_suffix}
    Example:
        auth.log → auth_a3f2c1d4e5b6...log

    This prevents collisions when multiple files with the same
    name are uploaded concurrently.
    """
    ensure_upload_dir()

    original_path = Path(original_filename)
    stem = original_path.stem          # "auth"
    suffix = original_path.suffix      # ".log"
    unique_id = uuid.uuid4().hex       # "a3f2c1d4e5b6f7a8..."

    safe_filename = f"{stem}_{unique_id}{suffix}"
    dest_path = UPLOAD_DIR / safe_filename

    dest_path.write_bytes(content)

    logger.info(
        "file_saved",
        original_filename=original_filename,
        saved_as=str(dest_path),
        size_bytes=len(content),
    )

    return dest_path


def read_lines(file_path: Path) -> List[str]:
    """
    Reads a saved log file and returns its lines as a list of strings.

    Handles encoding issues gracefully using errors='replace' —
    if the file contains invalid UTF-8 bytes (common in some
    network device logs), they are replaced with the Unicode
    replacement character instead of crashing.

    Empty lines and lines containing only whitespace are removed.
    """
    try:
        raw = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.error(
            "file_read_failed",
            path=str(file_path),
            error=str(exc),
        )
        raise

    lines = [line for line in raw.splitlines() if line.strip()]

    logger.info(
        "file_read",
        path=str(file_path),
        total_lines=len(lines),
    )

    return lines


def sample_lines(lines: List[str], n: Optional[int] = None) -> List[str]:
    """
    Returns a representative sample of lines for pattern detection.

    For small files (under n lines): returns all lines.
    For large files: returns the first half + last half of the sample.

    This ensures the sample captures both the file header format
    and any format variations that appear later in long log files.

    Args:
        lines: Full list of log lines
        n: Sample size (defaults to settings.sample_line_count)

    Example:
        1000-line file, n=20 → first 10 lines + last 10 lines
    """
    n = n or settings.sample_line_count
    clean = [line for line in lines if line.strip()]

    if len(clean) <= n:
        return clean

    half = n // 2
    sample = clean[:half] + clean[-half:]

    logger.debug(
        "lines_sampled",
        total=len(clean),
        sample_size=len(sample),
    )

    return sample


def delete_file(file_path: Path) -> None:
    """
    Deletes a temporary upload file after processing.
    Safe to call even if the file no longer exists.
    """
    try:
        file_path.unlink(missing_ok=True)
        logger.debug("temp_file_deleted", path=str(file_path))
    except OSError as exc:
        # Non-fatal — log it but do not crash
        logger.warning(
            "temp_file_delete_failed",
            path=str(file_path),
            error=str(exc),
        )