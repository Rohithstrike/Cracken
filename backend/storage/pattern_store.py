import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from backend.utils.logger import get_logger

logger = get_logger(__name__)

BUILTIN_PATH = Path(__file__).parent / "patterns" / "builtin.json"
LEARNED_PATH = Path(__file__).parent / "patterns" / "learned.json"

# Source priority — lower number = higher priority.
# Used by RegexEngine when two patterns score equally.
SOURCE_PRIORITY: dict[str, int] = {
    "builtin":      0,
    "ai_generated": 1,
}


class PatternStore:
    """
    Loads, stores, and manages regex patterns.

    Ordering guarantee:
        all() always returns builtin patterns before learned patterns.
        Within each group, insertion order (file order) is preserved.
        This ordering is the foundation of the priority system —
        the RegexEngine uses it to break ties in favour of builtins.
    """

    def __init__(self) -> None:
        self._builtin: list[dict] = []
        self._learned: list[dict] = []
        self._load()

    # ── Loading ───────────────────────────────────────────────────────────────

    def _load(self) -> None:
        """
        Reads both JSON files into separate lists.
        Builtins and learned are kept separate so all() can
        always return them in the correct priority order.
        """
        self._builtin = []
        self._learned = []

        self._load_file(BUILTIN_PATH, target=self._builtin, required=True)
        self._load_file(LEARNED_PATH, target=self._learned, required=False)

        logger.info(
            "pattern_store_ready",
            builtin_count=len(self._builtin),
            learned_count=len(self._learned),
            total=len(self._builtin) + len(self._learned),
        )

    def _load_file(
        self,
        path: Path,
        target: list,
        required: bool,
    ) -> None:
        """Loads one JSON file into the target list."""
        if not path.exists():
            if required:
                logger.error("required_pattern_file_missing", path=str(path))
            else:
                logger.debug("optional_pattern_file_not_found", path=str(path))
            return

        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error(
                "pattern_file_invalid_json",
                path=str(path),
                error=str(exc),
            )
            return
        except OSError as exc:
            logger.error(
                "pattern_file_read_error",
                path=str(path),
                error=str(exc),
            )
            return

        if not isinstance(data, list):
            logger.error(
                "pattern_file_wrong_format",
                path=str(path),
                expected="JSON array",
                received=type(data).__name__,
            )
            return

        valid_count = 0
        for entry in data:
            if self._is_valid_entry(entry, path):
                target.append(entry)
                valid_count += 1

        logger.info(
            "patterns_loaded",
            file=path.name,
            loaded=valid_count,
            skipped=len(data) - valid_count,
        )

    @staticmethod
    def _is_valid_entry(entry: dict, source_path: Path) -> bool:
        """Validates that a pattern entry has all required fields."""
        required = {"id", "name", "pattern", "fields"}
        missing = required - set(entry.keys())

        if missing:
            logger.warning(
                "pattern_entry_skipped",
                file=source_path.name,
                entry_id=entry.get("id", "<no id>"),
                missing_fields=list(missing),
            )
            return False

        if not isinstance(entry["fields"], list):
            logger.warning(
                "pattern_entry_fields_not_list",
                entry_id=entry.get("id"),
            )
            return False

        return True

    # ── Reading ───────────────────────────────────────────────────────────────

    def all(self) -> list[dict]:
        """
        Returns all patterns with builtins ALWAYS before learned.

        This ordering is the priority contract:
        - Index 0..N  → builtin patterns (source priority 0)
        - Index N+1.. → learned patterns (source priority 1)

        The RegexEngine iterates this list and uses the source field
        as a tiebreaker, meaning a builtin and a learned pattern with
        identical scores will always resolve to the builtin.
        """
        return list(self._builtin) + list(self._learned)

    def builtin_patterns(self) -> list[dict]:
        """Returns only builtin patterns."""
        return list(self._builtin)

    def learned_patterns(self) -> list[dict]:
        """Returns only AI-generated learned patterns."""
        return list(self._learned)

    def find_by_id(self, pattern_id: str) -> Optional[dict]:
        """Looks up a pattern by its unique id across both sources."""
        for pattern in self.all():
            if pattern.get("id") == pattern_id:
                return pattern
        return None

    def count(self) -> int:
        """Total patterns loaded (builtin + learned)."""
        return len(self._builtin) + len(self._learned)

    def ids(self) -> list[str]:
        """All pattern IDs in priority order. Useful for debugging."""
        return [p.get("id", "") for p in self.all()]

    # ── Writing ───────────────────────────────────────────────────────────────

    def save_learned(self, pattern: dict) -> None:
        """
        Persists an AI-generated pattern to learned.json.

        Safety check:
            Refuses to save a pattern whose id matches a builtin.
            This prevents an AI-generated pattern from ever shadowing
            a known-good builtin pattern.
        """
        pattern_id = pattern.get("id", "")

        # Safety: never overwrite a builtin with a learned pattern
        builtin_ids = {p["id"] for p in self._builtin}
        if pattern_id in builtin_ids:
            logger.error(
                "save_learned_refused_builtin_id_conflict",
                pattern_id=pattern_id,
                reason="A builtin pattern with this id already exists.",
            )
            return

        if not self._is_valid_entry(pattern, LEARNED_PATH):
            logger.error(
                "save_learned_rejected_invalid_pattern",
                pattern_id=pattern_id,
            )
            return

        # Load current learned.json
        existing: list[dict] = []
        if LEARNED_PATH.exists():
            try:
                existing = json.loads(
                    LEARNED_PATH.read_text(encoding="utf-8")
                )
                if not isinstance(existing, list):
                    existing = []
            except (json.JSONDecodeError, OSError):
                existing = []

        # Replace any previous version of this id
        existing = [p for p in existing if p.get("id") != pattern_id]

        # Stamp metadata
        pattern["source"] = "ai_generated"
        pattern["created_at"] = datetime.now(timezone.utc).isoformat()
        existing.append(pattern)

        try:
            LEARNED_PATH.write_text(
                json.dumps(existing, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.error(
                "save_learned_write_failed",
                path=str(LEARNED_PATH),
                error=str(exc),
            )
            raise

        # Update in-memory learned list
        self._learned = [
            p for p in self._learned if p.get("id") != pattern_id
        ]
        self._learned.append(pattern)

        logger.info(
            "learned_pattern_saved",
            pattern_id=pattern_id,
            pattern_name=pattern.get("name"),
            total_learned=len(self._learned),
        )

    def reload(self) -> None:
        """Discards in-memory state and reloads from both JSON files."""
        logger.info("pattern_store_reloading")
        self._load()