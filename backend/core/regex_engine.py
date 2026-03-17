import re
from typing import Optional

from backend.storage.pattern_store import PatternStore, SOURCE_PRIORITY
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Minimum fraction of clean lines that must match for a pattern
# to be considered a valid candidate at all.
# Patterns scoring below this are excluded entirely before ranking.
MATCH_THRESHOLD = 0.60


class RegexEngine:
    """
    Detects log format from a sample of lines and applies
    the matching regex to extract structured field dicts.

    Pattern selection uses three sort keys in this priority order:

        1. Specificity (primary, descending)
           Average number of meaningful named groups captured per
           matched line. Measured against the actual log data, not
           the pattern definition. This ensures linux_auth (9 real
           fields) beats syslog_rfc3164 (5 fields, one a blob) even
           when syslog matches more lines.

        2. Match score (secondary, descending)
           Fraction of clean lines the pattern matches. Used to
           separate patterns with equal specificity.

        3. Source priority (tertiary, ascending)
           builtin (0) beats ai_generated (1) on equal specificity
           and score. Prevents broad AI patterns shadowing precise
           builtins.

    Why specificity is primary:
        A generic pattern like syslog_rfc3164 can match almost any
        timestamped line by capturing the entire message as one blob.
        It will always outscore specific patterns on match rate.
        Ranking by specificity first means the pattern that extracts
        the most structured information from the lines it matches
        is always preferred — which is what a SOC analyst needs.
    """

    def __init__(self, store: PatternStore) -> None:
        self._store = store

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC — Detection
    # ─────────────────────────────────────────────────────────────────────────

    def detect_pattern(self, sample_lines: list[str]) -> Optional[dict]:
        """
        Scores every pattern in the library and returns the best match.

        Algorithm:
            1. Clean the input (strip blanks and comment lines)
            2. Score each pattern:
               - match_score:  matched_lines / total_clean_lines
               - specificity:  avg meaningful fields captured per match
               - priority:     source priority (builtin=0, ai=1)
            3. Discard any pattern below MATCH_THRESHOLD
            4. Sort remaining candidates:
               (-specificity, -match_score, source_priority)
            5. Return the top candidate, or None if none qualify

        Args:
            sample_lines: All lines from the uploaded file.
                          The engine cleans them internally.
                          Do NOT pre-filter with sample_lines() —
                          that reduces the statistical base and causes
                          generic patterns to win on short files.

        Returns:
            The winning pattern dict from PatternStore, or None.
        """
        clean = self._clean_lines(sample_lines)

        if not clean:
            logger.warning(
                "detect_pattern_empty_input",
                raw_line_count=len(sample_lines),
            )
            return None

        patterns = self._store.all()
        if not patterns:
            logger.error("pattern_store_is_empty")
            return None

        # ── Score every pattern ───────────────────────────────────────────
        # Build a list of candidate dicts, each containing:
        #   pattern     - the original pattern dict from the store
        #   match_score - fraction of clean lines matched
        #   specificity - avg meaningful fields captured per matched line
        #   priority    - source priority integer (lower = higher trust)
        candidates = []

        for pattern in patterns:
            pattern_id = pattern.get("id", "<unknown>")
            regex_str  = pattern.get("pattern", "")

            if not regex_str:
                logger.warning(
                    "pattern_skipped_empty_regex",
                    pattern_id=pattern_id,
                )
                continue

            match_score = self._score_pattern(regex_str, clean)

            # Discard patterns that fail the minimum threshold entirely.
            # They are not viable candidates regardless of specificity.
            if match_score < MATCH_THRESHOLD:
                logger.debug(
                    "pattern_below_threshold",
                    pattern_id=pattern_id,
                    match_score=round(match_score, 4),
                    threshold=MATCH_THRESHOLD,
                )
                continue

            specificity = self._specificity_score(regex_str, clean)
            source      = pattern.get("source", "builtin")
            priority    = SOURCE_PRIORITY.get(source, 99)

            candidates.append({
                "pattern":     pattern,
                "match_score": match_score,
                "specificity": specificity,
                "priority":    priority,
            })

            logger.debug(
                "pattern_candidate",
                pattern_id=pattern_id,
                source=source,
                match_score=round(match_score, 4),
                specificity=round(specificity, 4),
                source_priority=priority,
            )

        if not candidates:
            logger.info(
                "no_pattern_matched",
                threshold=MATCH_THRESHOLD,
                patterns_tested=len(patterns),
                clean_lines=len(clean),
                sample_preview=clean[:2],
            )
            return None

        # ── Rank candidates ───────────────────────────────────────────────
        #
        # Sort key: (-specificity, -match_score, priority)
        #
        # Primary:   specificity descending
        #   The pattern that extracts the most structured fields from
        #   the lines it actually matches wins. This is the core fix —
        #   linux_auth (specificity ~9) beats syslog_rfc3164 (specificity
        #   ~5) regardless of their match scores.
        #
        # Secondary: match_score descending
        #   Between patterns with equal specificity, prefer the one
        #   that matches more lines.
        #
        # Tertiary:  source priority ascending
        #   Between patterns with equal specificity and score, prefer
        #   builtin (0) over ai_generated (1).
        #
        candidates.sort(
            key=lambda c: (
                -c["specificity"],   # higher specificity first
                -c["match_score"],   # higher score first
                 c["priority"],      # lower number = higher trust
            )
        )

        winner = candidates[0]
        best_pattern = winner["pattern"]

        # Build summary for logging
        score_summary = {
            c["pattern"].get("id"): {
                "match_score":  round(c["match_score"],  4),
                "specificity":  round(c["specificity"],  4),
                "priority":     c["priority"],
            }
            for c in candidates
        }

        logger.info(
            "pattern_detected",
            pattern_id=best_pattern["id"],
            pattern_name=best_pattern.get("name"),
            source=best_pattern.get("source", "builtin"),
            match_score=round(winner["match_score"], 4),
            specificity=round(winner["specificity"], 4),
            source_priority=winner["priority"],
            total_candidates=len(candidates),
            all_candidates=score_summary,
        )

        return best_pattern

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC — Application
    # ─────────────────────────────────────────────────────────────────────────

    def apply_pattern(
        self,
        pattern: dict,
        lines: list[str],
    ) -> list[dict]:
        """
        Applies the given pattern to every line in the file.

        Per line:
            Blank lines        → skipped (not in output)
            Comment lines (#)  → skipped (IIS/W3C headers)
            Regex matches      → dict of named field values
            No match           → {"_raw": line, "_unmatched": True}

        Unmatched lines are never silently dropped. They appear in
        the output so the parser can surface them in unmatched_preview.

        Args:
            pattern: A pattern dict from PatternStore
            lines:   All lines from the uploaded file

        Returns:
            list of dicts — one per non-blank, non-comment line.
        """
        pattern_id = pattern.get("id", "<unknown>")
        regex_str  = pattern.get("pattern", "")

        compiled = self._compile(regex_str, source=pattern_id)
        if compiled is None:
            logger.error(
                "apply_pattern_compile_failed",
                pattern_id=pattern_id,
            )
            return []

        results: list[dict] = []
        matched_count   = 0
        unmatched_count = 0
        skipped_count   = 0

        for raw_line in lines:
            line = raw_line.strip()

            if not line:
                skipped_count += 1
                continue

            # Skip IIS/W3C metadata header lines
            if line.startswith("#"):
                skipped_count += 1
                continue

            match = compiled.search(line)

            if match:
                record = self._normalise_groups(match.groupdict())
                results.append(record)
                matched_count += 1
            else:
                results.append({"_raw": line, "_unmatched": True})
                unmatched_count += 1

        total_processed = matched_count + unmatched_count
        match_rate = (
            round(matched_count / total_processed, 4)
            if total_processed > 0
            else 0.0
        )

        logger.info(
            "pattern_applied",
            pattern_id=pattern_id,
            input_lines=len(lines),
            skipped=skipped_count,
            matched=matched_count,
            unmatched=unmatched_count,
            match_rate=match_rate,
        )

        return results

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC — Validation (used by AI fallback)
    # ─────────────────────────────────────────────────────────────────────────

    def validate_regex(
        self,
        regex_str: str,
        sample_lines: list[str],
    ) -> tuple[bool, float]:
        """
        Validates an AI-generated regex before saving to learned.json.

        Three checks — all must pass:
            1. Regex compiles without error
            2. Has at least one named capture group (?P<name>...)
            3. Scores >= MATCH_THRESHOLD on the sample lines

        Returns:
            (is_valid: bool, score: float)
        """
        compiled = self._compile(regex_str, source="ai_validation")
        if compiled is None:
            return False, 0.0

        named_groups = list(compiled.groupindex.keys())
        if not named_groups:
            logger.warning(
                "ai_regex_rejected_no_named_groups",
                regex_preview=regex_str[:80],
            )
            return False, 0.0

        clean = self._clean_lines(sample_lines)
        score = self._score_pattern(regex_str, clean)
        is_valid = score >= MATCH_THRESHOLD

        logger.info(
            "ai_regex_validation_result",
            is_valid=is_valid,
            score=round(score, 4),
            named_groups=named_groups,
            threshold=MATCH_THRESHOLD,
        )

        return is_valid, score

    # ─────────────────────────────────────────────────────────────────────────
    # PRIVATE
    # ─────────────────────────────────────────────────────────────────────────

    def _score_pattern(
        self,
        regex_str: str,
        clean_lines: list[str],
    ) -> float:
        """
        Returns matched_lines / total_clean_lines.
        Returns 0.0 on empty input or invalid regex.
        """
        if not clean_lines:
            return 0.0

        compiled = self._compile(regex_str, source="scoring")
        if compiled is None:
            return 0.0

        matched = sum(
            1 for line in clean_lines
            if compiled.search(line)
        )
        return matched / len(clean_lines)

    def _specificity_score(
        self,
        regex_str: str,
        clean_lines: list[str],
    ) -> float:
        """
        Measures how specifically a pattern describes each matched line.

        For each line the regex matches, count named groups that captured
        a meaningful value — not None, not empty string, not the IIS dash
        placeholder "-". Return the average across all matched lines.

        This is measured against the ACTUAL log data, not the pattern's
        fields definition array. A pattern claiming 9 fields that only
        extracts 3 on real lines gets a specificity of 3, not 9.

        Example on an SSH auth log line:

            syslog_rfc3164 captures:
                timestamp, hostname, process, pid → 4 real values
                message → 1 blob ("Failed password for admin from ...")
                specificity per line = 5

            linux_auth captures:
                timestamp, hostname, process, pid → 4 real values
                action="Failed", auth_method="password",
                cs_username="admin", c_ip="192.168.1.50",
                s_port="54321"  → 5 discrete values
                specificity per line = 9

            linux_auth wins: 9 > 5.

        Returns 0.0 on invalid regex or if no lines matched.
        """
        if not clean_lines:
            return 0.0

        compiled = self._compile(regex_str, source="specificity")
        if compiled is None:
            return 0.0

        field_counts: list[int] = []

        for line in clean_lines:
            match = compiled.search(line)
            if not match:
                continue

            groups = match.groupdict()
            meaningful = sum(
                1 for v in groups.values()
                if v is not None and v != "" and v != "-"
            )
            field_counts.append(meaningful)

        if not field_counts:
            return 0.0

        return sum(field_counts) / len(field_counts)

    def _compile(
        self,
        regex_str: str,
        source: str = "unknown",
    ) -> Optional[re.Pattern]:
        """
        Compiles a regex string. Returns None on failure — never raises.
        Logs a warning so broken library entries are visible.
        """
        try:
            return re.compile(regex_str)
        except re.error as exc:
            logger.warning(
                "regex_compile_failed",
                source=source,
                error=str(exc),
                regex_preview=regex_str[:120],
            )
            return None

    @staticmethod
    def _clean_lines(lines: list[str]) -> list[str]:
        """
        Removes lines that should not participate in scoring:
            - Blank or whitespace-only lines
            - IIS/W3C comment lines beginning with '#'

        Returns a new list. Never mutates the input.
        """
        return [
            line.strip()
            for line in lines
            if line.strip() and not line.strip().startswith("#")
        ]

    @staticmethod
    def _normalise_groups(
        groups: dict[str, Optional[str]],
    ) -> dict[str, str]:
        """
        Replaces None in a regex groupdict() with "-".
        Optional groups that did not participate return None.
        Normalising to "-" matches IIS convention and avoids null JSON.
        """
        return {
            key: (value if value is not None else "-")
            for key, value in groups.items()
        }