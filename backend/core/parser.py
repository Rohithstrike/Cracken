import pandas as pd
from backend.utils.logger import get_logger

logger = get_logger(__name__)

PRIORITY_FIELDS: list[str] = [
    "date", "time", "timestamp",
    "c_ip", "s_ip", "s_port", "c_port",
    "cs_username",
    "cs_method", "cs_uri_stem", "cs_uri_query",
    "cs_user_agent", "cs_referer",
    "sc_status", "sc_substatus", "sc_win32_status",
    "action",
    "time_taken", "bytes",
    "protocol", "hostname", "process", "pid",
    "auth_method", "message_id", "message",
]

INTERNAL_FIELDS: frozenset[str] = frozenset({"_unmatched", "_raw"})

NUMERIC_FIELDS: frozenset[str] = frozenset({
    "sc_status",
    "sc_substatus",
    "sc_win32_status",
    "time_taken",
    "bytes",
    "s_port",
    "c_port",
    "pid",
})


class LogParser:
    """
    Converts raw regex match records into a clean, typed,
    column-ordered Pandas DataFrame.

    Handles:
    - Separating matched records from unmatched sentinel rows
    - Dropping internal metadata columns
    - Coercing numeric fields from string to Int64
    - Reordering columns by security-analyst priority
    - Safe JSON serialisation including pandas NA values
    """

    def build_dataframe(self, records: list[dict]) -> pd.DataFrame:
        """
        Builds a clean DataFrame from parsed log records.

        Returns an empty DataFrame (never raises) if:
        - records is empty
        - no records matched the pattern
        """
        if not records:
            logger.warning("build_dataframe_called_with_empty_records")
            return pd.DataFrame()

        matched = self._extract_matched(records)
        unmatched_count = len(records) - len(matched)

        if not matched:
            logger.warning(
                "no_matched_records",
                total_input=len(records),
                unmatched=unmatched_count,
            )
            return pd.DataFrame()

        df = pd.DataFrame(matched)
        df = self._drop_internal_columns(df)
        df = self._coerce_numeric_fields(df)
        df = self._reorder_columns(df)

        logger.info(
            "dataframe_built",
            rows=len(df),
            columns=list(df.columns),
            unmatched_excluded=unmatched_count,
        )

        return df

    def get_unmatched(self, records: list[dict]) -> list[str]:
        """Returns raw text of lines that did not match the pattern."""
        return [
            r["_raw"]
            for r in records
            if r.get("_unmatched") is True and "_raw" in r
        ]

    def dataframe_to_json_rows(self, df: pd.DataFrame) -> list[dict]:
        """
        Serialises a DataFrame to a JSON-safe list of dicts.

        Converts all pandas NA / NaN / pd.NA values to None
        so FastAPI can serialise the response without errors.

        Also converts any remaining pandas Int64 values to
        plain Python int for clean JSON output.
        """
        if df.empty:
            return []

        rows = df.where(df.notna(), other=None).to_dict(orient="records")

        # Second pass: convert any remaining pandas scalars to Python natives
        clean_rows = []
        for row in rows:
            clean_row = {}
            for key, value in row.items():
                if pd.isna(value) if not isinstance(value, str) else False:
                    clean_row[key] = None
                elif hasattr(value, "item"):
                    # numpy / pandas scalar → Python native (int, float, etc.)
                    clean_row[key] = value.item()
                else:
                    clean_row[key] = value
            clean_rows.append(clean_row)

        return clean_rows

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _extract_matched(records: list[dict]) -> list[dict]:
        """Filters out sentinel unmatched records."""
        return [r for r in records if not r.get("_unmatched")]

    @staticmethod
    def _drop_internal_columns(df: pd.DataFrame) -> pd.DataFrame:
        """Removes _unmatched and _raw columns if present."""
        cols_to_drop = [c for c in INTERNAL_FIELDS if c in df.columns]
        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)
        return df

    @staticmethod
    def _coerce_numeric_fields(df: pd.DataFrame) -> pd.DataFrame:
        """
        Converts known numeric columns from string to Int64.

        Handles:
        - IIS dash placeholders ("-") → pd.NA
        - Non-numeric strings → pd.NA (errors="coerce")
        - Genuine integers → Int64

        Only processes columns present in this DataFrame.
        Missing columns are silently skipped.
        """
        for col in NUMERIC_FIELDS:
            if col not in df.columns:
                continue

            # Replace IIS dash placeholders with NA before conversion
            df[col] = df[col].replace("-", pd.NA)

            # Replace any other non-numeric strings gracefully
            df[col] = pd.to_numeric(df[col], errors="coerce")

            # Use nullable Int64 so NA is preserved as NA not NaN float
            try:
                df[col] = df[col].astype("Int64")
            except (TypeError, ValueError) as exc:
                logger.warning(
                    "numeric_coercion_failed",
                    column=col,
                    error=str(exc),
                )

            logger.debug(
                "column_coerced_to_int64",
                column=col,
                non_null=int(df[col].notna().sum()),
                null=int(df[col].isna().sum()),
            )

        return df

    @staticmethod
    def _reorder_columns(df: pd.DataFrame) -> pd.DataFrame:
        """
        Puts priority fields first, then any remaining fields.
        Fields not present in the DataFrame are silently skipped.
        """
        priority_present = [f for f in PRIORITY_FIELDS if f in df.columns]
        remaining = [c for c in df.columns if c not in priority_present]
        return df[priority_present + remaining]