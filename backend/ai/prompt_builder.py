from typing import List


# ── System context sent before the log sample ─────────────────────────────────
_SYSTEM_CONTEXT = """You are a cybersecurity log analysis expert specializing in regex engineering.
Your task is to analyse sample log lines and produce a single Python regex pattern with named capture groups."""

# ── Field reference helps the model use consistent naming ─────────────────────
_FIELD_REFERENCE = """Common field names to use in named capture groups:
  timestamp, date, time, s_ip, c_ip, s_port, c_port,
  cs_method, cs_uri_stem, cs_uri_query, sc_status,
  cs_username, action, protocol, hostname, process, pid,
  message, bytes, time_taken, auth_method"""

# ── Hard constraints on what the model must return ───────────────────────────
_RESPONSE_RULES = """Rules:
1. Output ONLY valid JSON — no explanations, no markdown, no code fences.
2. Use Python named capture groups: (?P<field_name>...)
3. The regex must match the majority of the provided sample lines.
4. Prefer specific field extraction over generic catch-all groups.
5. Response format must be exactly:
{
  "regex": "<your regex here>",
  "fields": ["field1", "field2", ...]
}"""


def build_regex_prompt(log_lines: List[str]) -> str:
    """
    Builds a deterministic prompt for regex generation from log samples.

    The prompt structure:
        1. System context    — establishes the AI's role
        2. Field reference   — guides consistent field naming
        3. Rules             — enforces JSON-only output
        4. Sample lines      — the actual log data (already sanitized/masked)
        5. Instruction       — explicit final instruction

    Args:
        log_lines: Sanitized and masked log lines ready for AI submission.
                   These must already have been processed by
                   sanitize_lines() and mask_sensitive_lines() — no
                   real infrastructure data should be present.

    Returns:
        A complete prompt string ready to send to any AI provider.
    """
    sample_block = "\n".join(log_lines)

    prompt = f"""{_SYSTEM_CONTEXT}

{_FIELD_REFERENCE}

{_RESPONSE_RULES}

Sample log lines:
---
{sample_block}
---

Analyse the sample lines above and respond with ONLY the JSON object containing the regex and fields list. Nothing else."""

    return prompt