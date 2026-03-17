from pathlib import Path
from fastapi import HTTPException, status
from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Magic byte signatures for file types we must reject ───────────────────────
# These are binary formats disguised with a .log or .txt extension.
# We check the raw bytes — a renamed .exe is still an .exe.
BLOCKED_SIGNATURES: dict[bytes, str] = {
    b"\x4d\x5a":     "Windows PE executable (.exe/.dll)",
    b"\x7fELF":      "Linux ELF binary",
    b"\x89PNG":      "PNG image",
    b"\xff\xd8\xff": "JPEG image",
    b"PK\x03\x04":   "ZIP / Office document archive",
    b"%PDF":         "PDF document",
    b"<script":      "HTML/JavaScript content",
    b"<!DOCTYPE":    "HTML document",
}


def validate_extension(filename: str) -> None:
    """
    Checks the uploaded filename has an allowed extension.
    Raises HTTP 415 if not allowed.

    Example:
        validate_extension("auth.log")   # passes
        validate_extension("report.pdf") # raises 415
    """
    ext = Path(filename).suffix.lower()

    if ext not in settings.allowed_extensions_list:
        logger.warning(
            "upload_rejected_bad_extension",
            filename=filename,
            extension=ext,
            allowed=settings.allowed_extensions_list,
        )
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{ext}' is not allowed. "
                f"Accepted types: {', '.join(settings.allowed_extensions_list)}"
            ),
        )


def validate_file_size(content: bytes, filename: str) -> None:
    """
    Checks the file content does not exceed the configured size limit.
    Raises HTTP 413 if too large.

    Example:
        validate_file_size(content, "big.log")  # raises 413 if over limit
    """
    size_bytes = len(content)
    size_mb = size_bytes / (1024 * 1024)

    if size_bytes > settings.max_file_size_bytes:
        logger.warning(
            "upload_rejected_too_large",
            filename=filename,
            size_mb=round(size_mb, 2),
            limit_mb=settings.max_file_size_mb,
        )
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File size {size_mb:.1f}MB exceeds the "
                f"{settings.max_file_size_mb}MB limit."
            ),
        )


def validate_file_content(content: bytes, filename: str) -> None:
    """
    Inspects the first bytes of the file to detect its real type.
    Rejects binary files even if they have a .log or .txt extension.
    Raises HTTP 415 if a blocked signature is found.

    Example:
        validate_file_content(b"MZ\x90...", "evil.log")  # raises 415
        validate_file_content(b"Oct 10 login...", "auth.log")  # passes
    """
    # Read just the first 16 bytes for signature detection
    header = content[:16].lower()

    for signature, file_type in BLOCKED_SIGNATURES.items():
        if header.startswith(signature.lower()):
            logger.warning(
                "upload_rejected_bad_content",
                filename=filename,
                detected_type=file_type,
            )
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"File content appears to be a {file_type}. "
                    f"Only plain text log files are accepted."
                ),
            )


def validate_upload(content: bytes, filename: str) -> None:
    """
    Master validation function — runs all three checks in order.
    Import and call this single function from the route.

    Order matters:
    1. Extension (cheapest check — no content reading needed)
    2. Size (cheap — just len())
    3. Magic bytes (reads first 16 bytes)
    """
    validate_extension(filename)
    validate_file_size(content, filename)
    validate_file_content(content, filename)

    logger.info(
        "upload_validated",
        filename=filename,
        size_kb=round(len(content) / 1024, 1),
    )