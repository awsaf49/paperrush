#!/usr/bin/env python3
"""Fail CI when PaperRush would publish stale or malformed conference data."""

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from update_from_scraper import (  # noqa: E402
    has_upcoming_conference_event,
    is_submission_deadline,
    load_existing_datajs,
    parse_date_for_comparison,
)
from scraper_to_datajs import normalize_datajs_deadlines  # noqa: E402


ALLOWED_CATEGORIES = {"ml", "cv", "nlp", "speech", "robotics", "other"}
ALLOWED_DEADLINE_TYPES = {
    "abstract", "paper", "supplementary", "rebuttal", "notification",
    "camera", "workshop", "tutorial", "conference", "event", "art",
}


def is_safe_web_url(value):
    """Accept only absolute HTTP(S) links in generated conference data."""
    if not value:
        return True
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def validate_conferences(conferences, now=None):
    """Return human-readable validation errors for generated conferences."""
    now = now or datetime.now(timezone.utc)
    errors = []
    editions_by_name = {}

    for conference in conferences:
        name = conference.get("name", "").strip()
        year = conference.get("year")
        conf_id = conference.get("id", "")
        label = conf_id or name or "<unknown>"

        if not name or not isinstance(year, int):
            errors.append(f"{label}: missing name or numeric year")
            continue

        name_key = name.lower()
        editions_by_name.setdefault(name_key, []).append(conference)

        expected_suffix = f"-{year}"
        if not conf_id.endswith(expected_suffix):
            errors.append(f"{label}: id must end with {expected_suffix}")

        if conference.get("category") not in ALLOWED_CATEGORIES:
            errors.append(f"{label}: invalid category {conference.get('category')!r}")

        if conference.get("datesTBD") and conference.get("deadlines"):
            errors.append(f"{label}: datesTBD editions cannot contain dated milestones")

        website = conference.get("website")
        if website and not is_safe_web_url(website):
            errors.append(f"{label}: unsafe website URL {website!r}")
        for link_name, link_value in (conference.get("links") or {}).items():
            if link_value and not is_safe_web_url(link_value):
                errors.append(f"{label}: unsafe {link_name} URL {link_value!r}")

        # Edition URLs are a common source of silent rollover errors. Stable
        # URLs without a year remain valid, but an explicit year must match.
        for link_name, link_value in {
            "website": website,
            **(conference.get("links") or {}),
        }.items():
            linked_years = {int(value) for value in re.findall(r"20\d{2}", link_value or "")}
            if linked_years and linked_years != {year}:
                errors.append(
                    f"{label}: {link_name} URL references another edition "
                    f"{sorted(linked_years)!r}"
                )

        info = conference.get("info") or {}
        if conference.get("isEstimated") and info:
            errors.append(
                f"{label}: estimated editions cannot publish unverified author instructions"
            )
        conference_name = str(info.get("conferenceName") or "")
        named_years = {int(value) for value in re.findall(r"20\d{2}", conference_name)}
        if named_years and named_years != {year}:
            errors.append(
                f"{label}: conferenceName references another edition {sorted(named_years)!r}"
            )

        submission_deadlines = []
        deadlines = conference.get("deadlines", [])
        normalized_deadlines = normalize_datajs_deadlines(deadlines)
        if len(normalized_deadlines) != len(deadlines):
            errors.append(f"{label}: duplicate deadline records must be removed")

        for deadline in deadlines:
            deadline_type = deadline.get("type")
            deadline_label = deadline.get("label")
            if deadline_type not in ALLOWED_DEADLINE_TYPES or not deadline_label:
                errors.append(
                    f"{label}: deadline requires a valid type and non-empty label"
                )
                continue

            normalized_deadline = normalize_datajs_deadlines([deadline])
            expected_type = normalized_deadline[0].get("type") if normalized_deadline else None
            if expected_type and deadline_type != expected_type:
                errors.append(
                    f"{label}: {deadline_label!r} is typed {deadline_type!r}; "
                    f"expected {expected_type!r}"
                )

            date_value = deadline.get("date")
            parsed = parse_date_for_comparison(date_value)
            if not parsed:
                errors.append(f"{label}: invalid deadline date {date_value!r}")
                continue

            for url_field in ("sourceUrl", "url"):
                deadline_url = deadline.get(url_field)
                if deadline_url and not is_safe_web_url(deadline_url):
                    errors.append(
                        f"{label}: unsafe deadline {url_field} URL {deadline_url!r}"
                    )
                deadline_url_years = {
                    int(value) for value in re.findall(r"20\d{2}", deadline_url or "")
                }
                if deadline_url_years and deadline_url_years != {year}:
                    errors.append(
                        f"{label}: deadline {url_field} references another edition "
                        f"{sorted(deadline_url_years)!r}"
                    )

            end_date_value = deadline.get("endDate")
            if end_date_value:
                end_parsed = parse_date_for_comparison(end_date_value)
                if not end_parsed or end_parsed < parsed:
                    errors.append(
                        f"{label}: invalid date range {date_value!r} to {end_date_value!r}"
                    )

            if deadline_type == "conference" and parsed.year != year:
                errors.append(
                    f"{label}: conference event year {parsed.year} must match edition {year}"
                )

            if is_submission_deadline(deadline) and parsed.year not in {year - 1, year}:
                errors.append(
                    f"{label}: deadline year {parsed.year} is inconsistent with edition {year}"
                )

            if is_submission_deadline(deadline):
                submission_deadlines.append(parsed)

    for editions in editions_by_name.values():
        if len(editions) < 2:
            continue
        newest_year = max(conference["year"] for conference in editions)
        for conference in editions:
            if conference["year"] == newest_year:
                continue
            if not has_upcoming_conference_event(conference, now):
                label = conference.get("id") or conference.get("name")
                errors.append(
                    f"{label}: older editions may remain only for an upcoming conference event"
                )

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
