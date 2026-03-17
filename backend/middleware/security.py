import re
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Maximum line length passed to the AI ─────────────────────────────────────
_MAX_LINE_LENGTH = 2048


# ─────────────────────────────────────────────────────────────────────────────
# Prompt injection phrases
# Lines sent to the AI are scanned for these patterns and neutralised.
# The list covers the most common LLM injection attempts found in the wild.
# ─────────────────────────────────────────────────────────────────────────────
_INJECTION_PHRASES: list[str] = [
    r"ignore\s+previous\s+instructions?",
    r"system\s+prompt",
    r"assistant\s+instructions?",
    r"reveal\s+secrets?",
    r"print\s+system\s+prompt",
    r"disregard\s+previous",
    r"forget\s+previous\s+instructions?",
    r"new\s+instructions?",
    r"you\s+are\s+now",
    r"act\s+as\s+(?:a\s+)?(?:different|new|another)",
    r"override\s+(?:previous\s+)?instructions?",
    r"do\s+not\s+follow",
    r"bypass\s+(?:the\s+)?(?:filter|rule|restriction|policy)",
    r"jailbreak",
    r"DAN\s+mode",
    r"developer\s+mode",
]

_INJECTION_PATTERN: re.Pattern = re.compile(
    "|".join(f"(?:{p})" for p in _INJECTION_PHRASES),
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Sensitive value detection patterns
#
# ORDER IS CRITICAL — patterns are applied in the order listed.
# More specific patterns (JWT, IPv6, MAC) must come before generic ones
# (IPv4, hex strings) so they match first and are not partially consumed.
# ─────────────────────────────────────────────────────────────────────────────

# Each entry: (placeholder_prefix, compiled_pattern)
# placeholder_prefix becomes the key in the mapping dict and the base
# of the replacement token: prefix_1 → <PREFIX_1>

_PATTERNS: list[tuple[str, re.Pattern]] = [

    # ── Sensitive tokens — must come before hex/IP patterns ───────────────

    # JWT: three base64url segments separated by dots
    ("TOKEN", re.compile(
        r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"
    )),

    # Bearer tokens in Authorization headers
    ("TOKEN", re.compile(
        r"(?i)Bearer\s+([A-Za-z0-9\-._~+/]{20,}=*)"
    )),

    # API keys / tokens in URL query parameters
    # e.g. ?token=abc123&api_key=xyz
    ("TOKEN", re.compile(
        r"(?i)(?:token|api_key|apikey|access_token|secret|password|passwd|pwd)"
        r"=([A-Za-z0-9\-._~+/%]{8,})"
    )),

    # AWS ARN: arn:aws:service:region:account:resource
    ("TOKEN", re.compile(
        r"\barn:aws:[a-z0-9\-]+:[a-z0-9\-]*:[0-9]{12}:[^\s]+"
    )),

    # Long hex strings (session IDs, hashes) — 32+ hex chars
    # Must come before plain IPv4 to avoid mangling short hex-looking values
    ("TOKEN", re.compile(
        r"\b[0-9a-fA-F]{32,}\b"
    )),

    # ── Network — IPv6 before IPv4 ────────────────────────────────────────

    # IPv6 full and compressed forms
    ("IP", re.compile(
        r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b"        # full
        r"|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b"                     # trailing ::
        r"|\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b"   # leading ::
        r"|\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b"    # mixed
    )),

    # MAC address: 00:1A:2B:3C:4D:5E or 00-1A-2B-3C-4D-5E
    ("TOKEN", re.compile(
        r"\b(?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}\b"
    )),

    # IPv4 address — after IPv6 and MAC to avoid partial matches
    ("IP", re.compile(
        r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
        r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
    )),

    # ── Identity ──────────────────────────────────────────────────────────

    # Email address — before generic domain pattern
    ("EMAIL", re.compile(
        r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b"
    )),

    # Usernames after keywords: "for admin", "user john", "username deploy"
    ("USER", re.compile(
        r"(?i)(?:^|(?<=\s))(?:for|user|username)\s+"
        r"(?:invalid\s+user\s+)?"
        r"([a-zA-Z0-9_.\-]{2,32})"
        r"(?=\s|$|[^\w])"
    )),

    # ── Infrastructure ────────────────────────────────────────────────────

    # Full URLs (http / https) — before bare domain pattern
    ("URL", re.compile(
        r"https?://[^\s\"'<>]+"
    )),

    # Internal domains: at least two labels ending in common internal TLDs
    ("DOMAIN", re.compile(
        r"\b(?:[a-zA-Z0-9\-]+\.)+"
        r"(?:internal|local|corp|lan|intranet|priv|private|home)\b",
        re.IGNORECASE,
    )),

    # Hostnames: word chars and hyphens with common server name patterns
    # Matches: server01, web-prod-02, db-master, fw-edge
    # Conservative — avoids matching plain dictionary words
    ("HOST", re.compile(
        r"\b(?:[a-zA-Z][a-zA-Z0-9]*)"
        r"(?:[\-][a-zA-Z0-9]+)+"  # requires at least one hyphen segment
        r"\b"
    )),

    # ── Paths ─────────────────────────────────────────────────────────────

    # Linux absolute paths: /etc/passwd, /var/log/auth.log
    ("PATH", re.compile(
        r"(?<!\w)/(?:etc|var|usr|home|tmp|root|opt|srv|proc|sys|dev|run)"
        r"(?:/[^\s\"'<>;\x00-\x1F]*)+"
    )),

    # Windows paths: C:\Windows\System32, D:\Logs\app.log
    ("PATH", re.compile(
        r"\b[A-Za-z]:\\(?:[^\s\"'<>;\x00-\x1F\\/:*?|]+\\)*"
        r"[^\s\"'<>;\x00-\x1F\\/:*?|]*"
    )),

    # ── Ports — after IPs so "192.168.1.1:443" IPs are masked first ──────

    # Standalone port references: "port 54321", ":8080"
    ("PORT", re.compile(
        r"(?i)(?:^|(?<=\s)|(?<=:))port\s+(\d{1,5})\b"
        r"|(?<=[^\d]):(\d{1,5})(?=\s|$|[^\d])"
    )),

    # ── Personal identifiers ──────────────────────────────────────────────

    # Credit card: 16 digits in groups of 4 (Visa/MC/Amex pattern)
    ("TOKEN", re.compile(
        r"\b(?:\d{4}[\s\-]){3}\d{4}\b"
    )),

    # SSN: 3-2-4 digit pattern
    ("TOKEN", re.compile(
        r"\b\d{3}-\d{2}-\d{4}\b"
    )),
]


# ─────────────────────────────────────────────────────────────────────────────
# Session-scoped mapping store
# ─────────────────────────────────────────────────────────────────────────────

class _MaskingSession:
    """
    Holds the value → placeholder mapping for one masking session.
    The same original value always maps to the same placeholder within
    a session, ensuring consistent structure across multiple log lines.
    """

    def __init__(self) -> None:
        # Maps (prefix, original_value) → placeholder string
        self._map: dict[tuple[str, str], str] = {}
        # Tracks the next index per prefix: {"IP": 1, "USER": 2, ...}
        self._counters: dict[str, int] = {}

    def get_placeholder(self, prefix: str, value: str) -> str:
        """Returns the existing placeholder for value, or creates a new one."""
        key = (prefix, value)
        if key not in self._map:
            idx = self._counters.get(prefix, 1)
            self._map[key] = f"<{prefix}_{idx}>"
            self._counters[prefix] = idx + 1
        return self._map[key]

    @property
    def replacements_made(self) -> int:
        return len(self._map)


# ─────────────────────────────────────────────────────────────────────────────
# Core masking logic
# ─────────────────────────────────────────────────────────────────────────────

def _neutralise_injections(line: str) -> str:
    """Removes prompt injection phrases from a line."""
    return _INJECTION_PATTERN.sub("[FILTERED]", line)


def _mask_line_with_session(line: str, session: _MaskingSession) -> str:
    """
    Applies all masking patterns to a single line using the shared session
    so values are consistent across the entire batch.
    """
    # Neutralise prompt injections first
    line = _neutralise_injections(line)

    # Apply each pattern in declared order
    for prefix, pattern in _PATTERNS:
        def _replacer(match: re.Match, _prefix: str = prefix) -> str:
            # For patterns with capture groups (USER, PORT, query params),
            # only the captured group is the sensitive value.
            # We replace the whole match but preserve non-captured prefix text.
            full_match = match.group(0)

            # Find the first non-None captured group (group 1+)
            captured = None
            for i in range(1, len(match.groups()) + 1):
                if match.group(i) is not None:
                    captured = match.group(i)
                    break

            if captured is not None:
                # Replace only the captured value, preserve surrounding text
                placeholder = session.get_placeholder(_prefix, captured)
                return full_match.replace(captured, placeholder, 1)
            else:
                # No capture groups — replace the entire match
                placeholder = session.get_placeholder(_prefix, full_match)
                return placeholder

        line = pattern.sub(_replacer, line)

    # Enforce line length cap for AI safety
    if len(line) > _MAX_LINE_LENGTH:
        line = line[:_MAX_LINE_LENGTH]

    return line


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def mask_sensitive_line(line: str) -> str:
    """
    Masks sensitive values in a single log line.
    Creates a fresh session — use mask_sensitive_lines() for batches
    where cross-line consistency is required.
    """
    session = _MaskingSession()
    return _mask_line_with_session(line, session)


def mask_sensitive_lines(lines: list[str]) -> list[str]:
    """
    Masks sensitive values across a list of log lines.

    Uses a single shared session so the same value always receives
    the same placeholder across all lines in the batch.
    Empty lines are preserved to maintain line-number correspondence.
    """
    session = _MaskingSession()
    result: list[str] = []

    for line in lines:
        if not line.strip():
            result.append(line)
            continue
        result.append(_mask_line_with_session(line, session))

    logger.info(
        "masking_complete",
        lines_processed=len(lines),
        unique_values_masked=session.replacements_made,
    )

    return result