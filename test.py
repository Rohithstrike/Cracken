import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.ai.ai_engine import _parse_ai_response

TESTS = [

    # ── Format 1: Clean JSON ──────────────────────────────────────────────────

    {
        "desc": "clean JSON with regex and fields",
        "input": '{"regex": "(?P<timestamp>\\\\S+) (?P<host>\\\\S+)", "fields": ["timestamp", "host"]}',
        "expected_regex": "(?P<timestamp>\\S+) (?P<host>\\S+)",
        "expected_fields": ["timestamp", "host"],
    },
    {
        "desc": "clean JSON with all IIS fields",
        "input": (
            '{"regex": "(?P<date>\\\\d{4}-\\\\d{2}-\\\\d{2}) (?P<time>\\\\d{2}:\\\\d{2}:\\\\d{2})'
            ' (?P<s_ip>[\\\\d.]+) (?P<method>\\\\S+)", '
            '"fields": ["date", "time", "s_ip", "method"]}'
        ),
        "expected_regex": (
            "(?P<date>\\d{4}-\\d{2}-\\d{2}) (?P<time>\\d{2}:\\d{2}:\\d{2})"
            " (?P<s_ip>[\\d.]+) (?P<method>\\S+)"
        ),
        "expected_fields": ["date", "time", "s_ip", "method"],
    },
    {
        "desc": "clean JSON extra whitespace around braces",
        "input": '  {  "regex": "(?P<level>\\\\w+) (?P<msg>.+)", "fields": ["level", "msg"]  }  ',
        "expected_regex": "(?P<level>\\w+) (?P<msg>.+)",
        "expected_fields": ["level", "msg"],
    },
    {
        "desc": "clean JSON with empty fields list — inferred from regex",
        "input": '{"regex": "(?P<timestamp>\\\\S+) (?P<action>\\\\w+)", "fields": []}',
        "expected_regex": "(?P<timestamp>\\S+) (?P<action>\\w+)",
        "expected_fields": ["timestamp", "action"],
    },
    {
        "desc": "clean JSON missing fields key entirely — inferred from regex",
        "input": '{"regex": "(?P<ip>[\\\\d.]+) (?P<port>\\\\d+)"}',
        "expected_regex": "(?P<ip>[\\d.]+) (?P<port>\\d+)",
        "expected_fields": ["ip", "port"],
    },

    # ── Format 2: Markdown fenced JSON ───────────────────────────────────────

    {
        "desc": "markdown fenced JSON with ```json tag",
        "input": '```json\n{"regex": "(?P<ts>\\\\S+) (?P<svc>\\\\S+)", "fields": ["ts", "svc"]}\n```',
        "expected_regex": "(?P<ts>\\S+) (?P<svc>\\S+)",
        "expected_fields": ["ts", "svc"],
    },
    {
        "desc": "markdown fenced JSON without language tag",
        "input": '```\n{"regex": "(?P<host>\\\\S+) (?P<msg>.+)", "fields": ["host", "msg"]}\n```',
        "expected_regex": "(?P<host>\\S+) (?P<msg>.+)",
        "expected_fields": ["host", "msg"],
    },
    {
        "desc": "markdown fenced JSON with extra newlines inside fence",
        "input": '```json\n\n{"regex": "(?P<pid>\\\\d+) (?P<cmd>.+)", "fields": ["pid", "cmd"]}\n\n```',
        "expected_regex": "(?P<pid>\\d+) (?P<cmd>.+)",
        "expected_fields": ["pid", "cmd"],
    },
    {
        "desc": "markdown fenced JSON with leading whitespace on content line",
        "input": '```json\n  {"regex": "(?P<level>\\\\w+) (?P<text>.+)", "fields": ["level", "text"]}\n```',
        "expected_regex": "(?P<level>\\w+) (?P<text>.+)",
        "expected_fields": ["level", "text"],
    },

    # ── Format 3: JSON embedded in explanation text ───────────────────────────

    {
        "desc": "JSON embedded after explanation sentence",
        "input": (
            'Here is the regex pattern for your log format: '
            '{"regex": "(?P<ts>\\\\S+) (?P<msg>.+)", "fields": ["ts", "msg"]} '
            'This should match most lines.'
        ),
        "expected_regex": "(?P<ts>\\S+) (?P<msg>.+)",
        "expected_fields": ["ts", "msg"],
    },
    {
        "desc": "JSON embedded before explanation sentence",
        "input": (
            '{"regex": "(?P<date>\\\\d{4}-\\\\d{2}-\\\\d{2}) (?P<level>\\\\w+)", "fields": ["date", "level"]} '
            'Hope this helps!'
        ),
        "expected_regex": "(?P<date>\\d{4}-\\d{2}-\\d{2}) (?P<level>\\w+)",
        "expected_fields": ["date", "level"],
    },
    {
        "desc": "JSON embedded between two paragraphs of explanation",
        "input": (
            'I analysed your logs and found the following pattern.\n'
            '{"regex": "(?P<action>\\\\w+) (?P<user>\\\\S+) from (?P<ip>[\\\\d.]+)", '
            '"fields": ["action", "user", "ip"]}\n'
            'Let me know if you need adjustments.'
        ),
        "expected_regex": "(?P<action>\\w+) (?P<user>\\S+) from (?P<ip>[\\d.]+)",
        "expected_fields": ["action", "user", "ip"],
    },
    {
        "desc": "JSON embedded with extra text and no trailing text",
        "input": 'Result: {"regex": "(?P<code>\\\\d{3}) (?P<path>\\\\S+)", "fields": ["code", "path"]}',
        "expected_regex": "(?P<code>\\d{3}) (?P<path>\\S+)",
        "expected_fields": ["code", "path"],
    },

    # ── Format 4: Raw regex string ────────────────────────────────────────────

    {
        "desc": "raw regex string with named groups only",
        "input": "(?P<timestamp>\\S+) (?P<hostname>\\S+) (?P<process>\\S+): (?P<message>.+)",
        "expected_regex": "(?P<timestamp>\\S+) (?P<hostname>\\S+) (?P<process>\\S+): (?P<message>.+)",
        "expected_fields": ["timestamp", "hostname", "process", "message"],
    },
    {
        "desc": "raw regex with leading and trailing whitespace",
        "input": "  (?P<ip>[\\d.]+) (?P<port>\\d+) (?P<status>\\d{3})  ",
        "expected_regex": "(?P<ip>[\\d.]+) (?P<port>\\d+) (?P<status>\\d{3})",
        "expected_fields": ["ip", "port", "status"],
    },
    {
        "desc": "raw regex with no named groups — fields returned as empty",
        "input": "\\d{4}-\\d{2}-\\d{2} \\S+ \\S+",
        "expected_regex": "\\d{4}-\\d{2}-\\d{2} \\S+ \\S+",
        "expected_fields": [],
    },

    # ── Format 5: Already parsed dict ────────────────────────────────────────

    {
        "desc": "already parsed dict passed directly",
        "input": {"regex": "(?P<ts>\\S+) (?P<msg>.+)", "fields": ["ts", "msg"]},
        "expected_regex": "(?P<ts>\\S+) (?P<msg>.+)",
        "expected_fields": ["ts", "msg"],
    },
    {
        "desc": "already parsed dict with empty fields — inferred from regex",
        "input": {"regex": "(?P<level>\\w+) (?P<text>.+)", "fields": []},
        "expected_regex": "(?P<level>\\w+) (?P<text>.+)",
        "expected_fields": ["level", "text"],
    },
    {
        "desc": "already parsed dict missing fields key",
        "input": {"regex": "(?P<host>\\S+) (?P<pid>\\d+)"},
        "expected_regex": "(?P<host>\\S+) (?P<pid>\\d+)",
        "expected_fields": ["host", "pid"],
    },

    # ── Edge cases ────────────────────────────────────────────────────────────

    {
        "desc": "regex with nested braces inside character class",
        "input": (
            '{"regex": "(?P<ts>\\\\d{4}-\\\\d{2}-\\\\d{2}) (?P<ip>[\\\\d.]{7,15})", '
            '"fields": ["ts", "ip"]}'
        ),
        "expected_regex": "(?P<ts>\\d{4}-\\d{2}-\\d{2}) (?P<ip>[\\d.]{7,15})",
        "expected_fields": ["ts", "ip"],
    },
    {
        "desc": "regex with nested braces quantifier {2,4}",
        "input": (
            '{"regex": "(?P<mac>([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})", '
            '"fields": ["mac"]}'
        ),
        "expected_regex": "(?P<mac>([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})",
        "expected_fields": ["mac"],
    },
    {
        "desc": "partial JSON with extra text before and after JSON block",
        "input": (
            'Sure! Here you go:\n\n'
            '{"regex": "(?P<level>INFO|WARN|ERROR) (?P<msg>.+)", '
            '"fields": ["level", "msg"]}\n\n'
            'That covers most cases.'
        ),
        "expected_regex": "(?P<level>INFO|WARN|ERROR) (?P<msg>.+)",
        "expected_fields": ["level", "msg"],
    },
    {
        "desc": "JSON with fields as null — inferred from regex",
        "input": '{"regex": "(?P<user>\\\\S+) (?P<action>\\\\w+)", "fields": null}',
        "expected_regex": "(?P<user>\\S+) (?P<action>\\w+)",
        "expected_fields": ["user", "action"],
    },
    {
        "desc": "fenced JSON with CRLF line endings",
        "input": '```json\r\n{"regex": "(?P<ts>\\\\S+) (?P<svc>\\\\S+)", "fields": ["ts", "svc"]}\r\n```',
        "expected_regex": "(?P<ts>\\S+) (?P<svc>\\S+)",
        "expected_fields": ["ts", "svc"],
    },
    {
        "desc": "SSH auth log regex with optional group",
        "input": (
            '{"regex": "(?P<timestamp>\\\\w{3}\\\\s+\\\\d{1,2}\\\\s+\\\\d{2}:\\\\d{2}:\\\\d{2})'
            '\\\\s+(?P<hostname>\\\\S+)\\\\s+(?P<process>\\\\S+?)(?:\\\\[(?P<pid>\\\\d+)\\\\])?:'
            '\\\\s+(?P<message>.+)", '
            '"fields": ["timestamp", "hostname", "process", "pid", "message"]}'
        ),
        "expected_regex": (
            "(?P<timestamp>\\w{3}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})"
            "\\s+(?P<hostname>\\S+)\\s+(?P<process>\\S+?)(?:\\[(?P<pid>\\d+)\\])?:"
            "\\s+(?P<message>.+)"
        ),
        "expected_fields": ["timestamp", "hostname", "process", "pid", "message"],
    },
    {
        "desc": "IIS W3C full pattern as raw regex string",
        "input": (
            "(?P<date>\\d{4}-\\d{2}-\\d{2})\\s+(?P<time>\\d{2}:\\d{2}:\\d{2})"
            "\\s+(?P<s_ip>[\\d.]+)\\s+(?P<cs_method>\\S+)\\s+(?P<cs_uri_stem>\\S+)"
            "\\s+(?P<cs_uri_query>\\S+)\\s+(?P<s_port>\\d+)\\s+(?P<cs_username>\\S+)"
            "\\s+(?P<c_ip>[\\d.]+)\\s+(?P<sc_status>\\d{3})\\s+(?P<time_taken>\\d+)"
        ),
        "expected_regex": (
            "(?P<date>\\d{4}-\\d{2}-\\d{2})\\s+(?P<time>\\d{2}:\\d{2}:\\d{2})"
            "\\s+(?P<s_ip>[\\d.]+)\\s+(?P<cs_method>\\S+)\\s+(?P<cs_uri_stem>\\S+)"
            "\\s+(?P<cs_uri_query>\\S+)\\s+(?P<s_port>\\d+)\\s+(?P<cs_username>\\S+)"
            "\\s+(?P<c_ip>[\\d.]+)\\s+(?P<sc_status>\\d{3})\\s+(?P<time_taken>\\d+)"
        ),
        "expected_fields": [
            "date", "time", "s_ip", "cs_method", "cs_uri_stem",
            "cs_uri_query", "s_port", "cs_username", "c_ip",
            "sc_status", "time_taken",
        ],
    },
    {
        "desc": "already parsed dict with fields as None — inferred from regex",
        "input": {"regex": "(?P<ip>[\\d.]+) (?P<status>\\d{3})", "fields": None},
        "expected_regex": "(?P<ip>[\\d.]+) (?P<status>\\d{3})",
        "expected_fields": ["ip", "status"],
    },
]


# ── Runner ────────────────────────────────────────────────────────────────────

def run_tests() -> None:
    passed = 0
    failed = 0

    for test in TESTS:
        desc            = test["desc"]
        raw_input       = test["input"]
        expected_regex  = test["expected_regex"]
        expected_fields = test["expected_fields"]

        try:
            result = _parse_ai_response(raw_input)

            actual_regex  = result.get("regex", "")
            actual_fields = result.get("fields", [])

            assert isinstance(result, dict), (
                f"Return type is {type(result).__name__}, expected dict"
            )
            assert "regex" in result, (
                f"Key 'regex' missing from result: {result}"
            )
            assert "fields" in result, (
                f"Key 'fields' missing from result: {result}"
            )
            assert actual_regex == expected_regex, (
                f"\n  Expected regex : {repr(expected_regex)}"
                f"\n  Actual regex   : {repr(actual_regex)}"
            )
            assert sorted(actual_fields) == sorted(expected_fields), (
                f"\n  Expected fields : {sorted(expected_fields)}"
                f"\n  Actual fields   : {sorted(actual_fields)}"
            )

            print(f"PASS: {desc}")
            passed += 1

        except AssertionError as exc:
            print(f"FAIL: {desc}")
            print(f"      {exc}")
            failed += 1

        except Exception as exc:
            print(f"ERROR: {desc}")
            print(f"       {type(exc).__name__}: {exc}")
            failed += 1

    print()
    print(f"Results: {passed} passed, {failed} failed out of {len(TESTS)} tests")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()