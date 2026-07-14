#!/usr/bin/env python3
"""Send one JSON health-tracker action to the configured Vercel API."""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Call the private health tracker API")
    parser.add_argument("--file", help="Read JSON from a file instead of standard input")
    args = parser.parse_args()
    api_url = os.environ.get("HEALTH_TRACKER_URL")
    secret = os.environ.get("HERMES_API_SECRET")
    if not api_url or not secret:
        print("HEALTH_TRACKER_URL and HERMES_API_SECRET are required.", file=sys.stderr)
        return 2
    raw = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    try:
        json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"Invalid JSON: {error}", file=sys.stderr)
        return 2
    timestamp = str(int(time.time() * 1000))
    signature = hmac.new(secret.encode(), f"{timestamp}.{raw}".encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(api_url, data=raw.encode(), headers={"Content-Type": "application/json", "x-health-timestamp": timestamp, "x-health-signature": signature}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            print(response.read().decode())
            return 0
    except urllib.error.HTTPError as error:
        print(error.read().decode(), file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"API request failed: {error.reason}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
