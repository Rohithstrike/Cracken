import csv
import io
from typing import Any

from backend.utils.logger import get_logger

logger = get_logger(__name__)


def records_to_csv(
    columns: list[str],
    rows: list[dict[str, Any]],
    filename: str = "parsed_logs.csv",
) -> tuple[bytes, str]:
    """
    Serialises parsed log rows to CSV bytes.

    Rules:
    - Column order matches the `columns` list exactly
    - Values that are None become empty strings
    - Values containing commas, quotes, or newlines are quoted per RFC 4180
    - The BOM (\\ufeff) is prepended so Excel opens the file correctly
      without a manual encoding step

    Args:
        columns:  Ordered list of column names — must match row keys
        rows:     List of dicts from LogParser.dataframe_to_json_rows()
        filename: Suggested download filename returned in Content-Disposition

    Returns:
        (csv_bytes, suggested_filename)
        csv_bytes includes the UTF-8 BOM for Excel compatibility.
    """
    if not columns:
        logger.warning("records_to_csv_called_with_no_columns")
        return b"", filename

    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=columns,
        extrasaction="ignore",   # silently ignore extra keys in rows
        lineterminator="\r\n",   # RFC 4180 line endings
    )

    writer.writeheader()

    for row in rows:
        # Normalise: replace None with empty string,
        # convert all values to strings for CSV safety
        safe_row = {
            col: ("" if row.get(col) is None else str(row.get(col, "")))
            for col in columns
        }
        writer.writerow(safe_row)

    # UTF-8 BOM — makes Excel auto-detect encoding correctly
    csv_bytes = "\ufeff".encode("utf-8") + buffer.getvalue().encode("utf-8")

    logger.info(
        "csv_serialised",
        columns=len(columns),
        rows=len(rows),
        size_bytes=len(csv_bytes),
        filename=filename,
    )

    return csv_bytes, filename


def build_csv_filename(original_filename: str, pattern_id: str) -> str:
    """
    Builds a descriptive CSV download filename.

    Example:
        original_filename = "auth.log"
        pattern_id        = "linux_auth"
        returns           = "auth_linux_auth_parsed.csv"
    """
    from pathlib import Path
    stem = Path(original_filename).stem
    return f"{stem}_{pattern_id}_parsed.csv"