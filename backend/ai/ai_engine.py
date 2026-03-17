import json
import re
from typing import Any

from backend.config import settings
from backend.sanitizer.sanitizer import sanitize_lines
from backend.middleware.security import mask_sensitive_lines
from backend.utils.logger import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Public helpers
# ─────────────────────────────────────────────────────────────────────────────

def extract_sample_lines(
    lines: list[str],
    max_lines: int = 20,
) -> list[str]:
    """
    Returns up to max_lines valid lines, skipping blanks and # comments.
    """
    sample: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        sample.append(stripped)
        if len(sample) >= max_lines:
            break

    logger.info(
        "sample_lines_extracted",
        input_lines=len(lines),
        sample_size=len(sample),
        max_lines=max_lines,
    )

    return sample


def prepare_logs_for_ai(lines: list[str]) -> list[str]:
    """
    Runs sanitize_lines() then mask_sensitive_lines() on the input.
    Returns lines safe to send to an external AI provider.
    """
    sanitized = sanitize_lines(lines)
    masked    = mask_sensitive_lines(sanitized)

    logger.info(
        "logs_prepared_for_ai",
        lines_after_sanitize=len(sanitized),
        lines_after_masking=len(masked),
    )

    return masked


# ─────────────────────────────────────────────────────────────────────────────
# Provider factory
# ─────────────────────────────────────────────────────────────────────────────

def _get_provider():
    """
    Returns an instantiated AI provider based on settings.ai_provider.
    Lazy imports keep startup fast — unused providers are never loaded.

    Raises:
        ValueError: if settings.ai_provider is not a known value.
    """
    name = settings.ai_provider.lower().strip()

    logger.info("ai_provider_selected", provider=name)

    if name == "ollama":
        from backend.ai.ollama_provider import OllamaProvider
        return OllamaProvider()

    if name == "openai":
        from backend.ai.openai_provider import OpenAIProvider
        return OpenAIProvider()

    if name == "claude":
        from backend.ai.claude_provider import ClaudeProvider
        return ClaudeProvider()

    raise ValueError(
        f"Unknown AI provider: '{name}'. "
        f"Expected one of: ollama, openai, claude. "
        f"Check AI_PROVIDER in your .env file."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Response parser
# ─────────────────────────────────────────────────────────────────────────────

def _infer_fields_from_regex(regex_str: str) -> list[str]:
    """
    Extracts named capture group names from a regex string.

    Example:
        "(?P<timestamp>\\S+) (?P<host>\\S+)"
        → ["timestamp", "host"]

    Returns an empty list if regex_str is empty or has no named groups.
    """
    if not regex_str:
        return []
    return re.findall(r"\(\?P<([^>]+)>", regex_str)


def _normalise_fields(fields: Any, regex_str: str) -> list[str]:
    """
    Returns a clean list of field names.

    Rules applied in order:
        1. If fields is a non-empty list → use it as-is
        2. If fields is missing, None, not a list, or an empty list
           → infer from named capture groups in regex_str
        3. If inference also yields nothing → return empty list

    This single function is called from every parse path so the
    behaviour is identical regardless of how the AI formatted its output.
    """
    if isinstance(fields, list) and fields:
        return fields

    # fields is None, [], not a list, or missing — infer from regex
    inferred = _infer_fields_from_regex(regex_str)
    return inferred


def _parse_ai_response(raw_response: Any) -> dict[str, Any]:
    """
    Extracts regex and fields from raw AI output.

    Handles six input forms in order:

        0. Already a dict        — short-circuit before any string ops
        1. Clean JSON string
        2. JSON in markdown fences  (```json...``` or ```...```)
        3. JSON object embedded in explanation text
        4. Raw regex string      — treat entire input as the regex

    In all cases:
        - Missing, null, or empty fields are inferred from named groups
          in the regex string via _normalise_fields().
        - Never raises — worst case returns {"regex": raw, "fields": []}.

    Args:
        raw_response: str, dict, or any value returned by an AI provider.

    Returns:
        {"regex": "<pattern>", "fields": ["field1", ...]}
    """

    # ── Form 0: already a dict ────────────────────────────────────────────
    # Must be checked BEFORE any .strip() / string operation.
    if isinstance(raw_response, dict):
        regex  = raw_response.get("regex", "")
        fields = _normalise_fields(raw_response.get("fields"), regex)
        return {"regex": regex, "fields": fields}

    # Everything below requires a string
    if not isinstance(raw_response, str):
        # Coerce unexpected types (int, bytes, etc.) to string
        raw_response = str(raw_response)

    text = raw_response.strip()

    # ── Form 2: markdown code fences ─────────────────────────────────────
    # Match ```json ... ``` or ``` ... ``` with optional whitespace.
    fenced = re.match(
        r"^```(?:json)?\s*([\s\S]+?)\s*```$",
        text,
        re.IGNORECASE,
    )
    if fenced:
        text = fenced.group(1).strip()

    # ── Form 1: attempt full JSON parse on (possibly de-fenced) text ─────
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "regex" in data:
            regex  = data.get("regex", "")
            fields = _normalise_fields(data.get("fields"), regex)
            return {"regex": regex, "fields": fields}
    except (json.JSONDecodeError, ValueError):
        pass

    # ── Form 3: JSON object embedded anywhere in explanation text ─────────
    # Use a non-greedy search to find the first {...} block.
    # We try progressively larger matches in case the first small block
    # is not the one containing "regex".
    for json_match in re.finditer(r"\{[\s\S]+?\}", text):
        try:
            data = json.loads(json_match.group(0))
            if isinstance(data, dict) and "regex" in data:
                regex  = data.get("regex", "")
                fields = _normalise_fields(data.get("fields"), regex)
                return {"regex": regex, "fields": fields}
        except (json.JSONDecodeError, ValueError):
            continue

    # Greedy fallback — try the largest {...} span in case nested braces
    # caused the non-greedy search to stop too early.
    greedy_match = re.search(r"\{[\s\S]+\}", text)
    if greedy_match:
        try:
            data = json.loads(greedy_match.group(0))
            if isinstance(data, dict) and "regex" in data:
                regex  = data.get("regex", "")
                fields = _normalise_fields(data.get("fields"), regex)
                return {"regex": regex, "fields": fields}
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Form 4: raw regex string ──────────────────────────────────────────
    # Entire response is treated as the regex pattern.
    logger.warning(
        "ai_response_not_json_treating_as_raw_regex",
        preview=text[:120],
    )
    regex  = text
    fields = _infer_fields_from_regex(regex)
    return {"regex": regex, "fields": fields}


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestration function
# ─────────────────────────────────────────────────────────────────────────────

async def generate_regex_with_ai(lines: list[str]) -> dict[str, Any]:
    """
    Full AI fallback pipeline for an unrecognised log format.

        1. extract_sample_lines()    — first 20 valid lines
        2. prepare_logs_for_ai()     — sanitize → mask
        3. build_regex_prompt()      — build the AI prompt
        4. _get_provider()           — select configured provider
        5. provider.generate_regex() — call the AI model
        6. _parse_ai_response()      — extract regex + fields

    Returns:
        {"regex": "<pattern>", "fields": ["field1", ...]}

    Raises:
        ValueError:   no valid sample lines, or unknown provider.
        RuntimeError: AI provider call failed.
    """
    # Step 1 — sample
    sample = extract_sample_lines(lines)

    if not sample:
        logger.error(
            "ai_fallback_aborted_no_valid_lines",
            total_input_lines=len(lines),
        )
        raise ValueError(
            "No valid log lines could be extracted. "
            "The file may contain only comment or blank lines."
        )

    # Step 2 — sanitize + mask
    prepared = prepare_logs_for_ai(sample)

    if not prepared:
        logger.error(
            "ai_fallback_aborted_empty_after_preparation",
            sample_size=len(sample),
        )
        raise ValueError(
            "All sample lines were empty after sanitization and masking."
        )

    # Step 3 — prompt
    from backend.ai.prompt_builder import build_regex_prompt
    prompt = build_regex_prompt(prepared)          # noqa: F841

    # Step 4 + 5 — provider call
    provider = _get_provider()

    try:
        raw_response = await provider.generate_regex(
            sanitized_log_sample="\n".join(prepared)
        )
    except Exception as exc:
        logger.error(
            "ai_provider_call_failed",
            provider=settings.ai_provider,
            error=str(exc),
        )
        raise RuntimeError(
            f"AI provider '{settings.ai_provider}' failed: {exc}"
        ) from exc

    # Step 6 — parse
    result = _parse_ai_response(raw_response)

    logger.info(
        "ai_regex_generated",
        provider=settings.ai_provider,
        regex_preview=result.get("regex", "")[:120],
        fields=result.get("fields", []),
        sample_lines_used=len(prepared),
    )

    return result