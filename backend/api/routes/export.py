from fastapi import APIRouter
from fastapi.responses import Response

from backend.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["export"])


def csv_response(
    csv_bytes: bytes,
    filename: str,
) -> Response:
    """
    Builds a FastAPI Response that triggers a file download in the browser.

    Headers set:
        Content-Type        : text/csv; charset=utf-8
        Content-Disposition : attachment; filename="<filename>"
        Content-Length      : byte count (helps browsers show progress)

    This is a plain Response, not StreamingResponse, because the CSV
    is already fully built in memory. StreamingResponse is used in
    Step 4 (large file handling) when we cannot buffer the entire output.

    Args:
        csv_bytes: Complete CSV content as bytes (may include UTF-8 BOM)
        filename:  Suggested download filename

    Returns:
        FastAPI Response with correct download headers
    """
    logger.info(
        "csv_response_served",
        filename=filename,
        size_bytes=len(csv_bytes),
    )

    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(csv_bytes)),
            # Allow the frontend JavaScript to read this header
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )