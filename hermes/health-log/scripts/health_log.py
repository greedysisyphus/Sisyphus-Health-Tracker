#!/usr/bin/env python3
"""Normalize one Hermes health workflow and send it through health_api.py."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, NoReturn, cast
from zoneinfo import ZoneInfo


def fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def taipei_today() -> str:
    return datetime.now(ZoneInfo("Asia/Taipei")).date().isoformat()


def normalize(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        fail("input must be a JSON object")
    data = cast(dict[str, Any], payload)
    if "action" in data:
        allowed_passthrough = {
            "get_daily_summary",
            "get_range_summary",
            "find_foods",
            "amend_food",
            "delete_food",
            "upsert_food",
        }
        if data.get("action") not in allowed_passthrough:
            fail("legacy write action is not allowed; use log_health_event with eventId")
        return data
    if data.get("intent") != "log_health_event":
        fail("intent must be log_health_event")

    event_id = data.get("eventId")
    if not isinstance(event_id, str) or not event_id.strip():
        fail("eventId is required")
    date = data.get("date", "today")
    if date == "today":
        date = taipei_today()
    if not isinstance(date, str):
        fail("date must be today or YYYY-MM-DD")

    entries = data.get("entries", [])
    plain_water_ml = data.get("plainWaterMl", 0)
    body = data.get("body")
    if not isinstance(entries, list):
        fail("entries must be an array")
    if not isinstance(plain_water_ml, (int, float)) or plain_water_ml < 0:
        fail("plainWaterMl must be a non-negative number")
    if not entries and plain_water_ml == 0 and body is None:
        fail("health event must contain entries, plainWaterMl, or body")

    request = {
        "action": "log_health_event",
        "date": date,
        "entries": entries,
        "plainWaterMl": plain_water_ml,
        "idempotency": {
            "source": data.get("source", "discord"),
            "eventId": event_id,
            "operationKey": data.get("operationKey", "health-event"),
        },
    }
    if body is not None:
        request["body"] = body
    return request


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one safe health-tracker workflow")
    parser.add_argument("--file", help="Read JSON from a file instead of standard input")
    parser.add_argument("--dry-run", action="store_true", help="Print the normalized API request without sending it")
    args = parser.parse_args()

    raw = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"invalid JSON: {error}")
    request = normalize(payload)
    encoded = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    if args.dry_run:
        print(encoded)
        return 0

    api_script = Path(__file__).with_name("health_api.py")
    result = subprocess.run(
        [sys.executable, str(api_script)],
        input=encoded,
        text=True,
        capture_output=True,
    )
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
