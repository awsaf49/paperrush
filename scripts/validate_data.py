#!/usr/bin/env python3
"""Fail CI when PaperRush would publish stale or malformed conference data."""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from update_from_scraper import (  # noqa: E402
    is_submission_deadline,
    load_existing_datajs,
    parse_date_for_comparison,
)


def validate_conferences(conferences, now=None):
    """Return human-readable validation errors for generated conferences."""
    now = now or datetime.now(timezone.utc)
    errors = []
    seen_names = set()

    for conference in conferences:
        name = conference.get("name", "").strip()
        year = conference.get("year")
        conf_id = conference.get("id", "")
        label = conf_id or name or "<unknown>"

        if not name or not isinstance(year, int):
            errors.append(f"{label}: missing name or numeric year")
            continue

        name_key = name.lower()
        if name_key in seen_names:
            errors.append(f"{label}: multiple editions published for {name}")
        seen_names.add(name_key)

        expected_suffix = f"-{year}"
        if not conf_id.endswith(expected_suffix):
            errors.append(f"{label}: id must end with {expected_suffix}")

        submission_deadlines = []
        for deadline in conference.get("deadlines", []):
            date_value = deadline.get("date")
            parsed = parse_date_for_comparison(date_value)
            if not parsed:
                errors.append(f"{label}: invalid deadline date {date_value!r}")
                continue

            if is_submission_deadline(deadline) and parsed.year not in {year - 1, year}:
                errors.append(
                    f"{label}: deadline year {parsed.year} is inconsistent with edition {year}"
                )

            if is_submission_deadline(deadline):
                submission_deadlines.append(parsed)

    return errors


def find_stale_warnings(conferences, now=None):
    """Report source entries that the browser's rollover failsafe will replace."""
    now = now or datetime.now(timezone.utc)
    warnings = []

    for conference in conferences:
        label = conference.get("id") or conference.get("name") or "<unknown>"
        submission_deadlines = []
        for deadline in conference.get("deadlines", []):
            if not is_submission_deadline(deadline):
                continue
            parsed = parse_date_for_comparison(deadline.get("date"))
            if parsed:
                submission_deadlines.append(parsed)

        if not submission_deadlines:
            warnings.append(f"{label}: no main author submission deadlines found")
        elif not any(deadline > now for deadline in submission_deadlines):
            warnings.append(
                f"{label}: source submission window is closed; browser rollover applies"
            )

    return warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_file", help="Path to js/data.js")
    parser.add_argument(
        "--now",
        help="ISO timestamp for deterministic checks (defaults to current UTC time)",
    )
    parser.add_argument(
        "--strict-stale",
        action="store_true",
        help="Treat stale source entries as errors instead of rollover warnings",
    )
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    if args.now:
        now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))

    conferences = load_existing_datajs(args.data_file)
    if not conferences:
        print(f"ERROR: no conferences parsed from {args.data_file}")
        return 1

    errors = validate_conferences(conferences, now)
    warnings = find_stale_warnings(conferences, now)
    if warnings:
        print("Conference rollover warnings:")
        for warning in warnings:
            print(f"- {warning}")
        if args.strict_stale:
            errors.extend(warnings)

    if errors:
        print("Conference data validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Validated {len(conferences)} conference editions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
