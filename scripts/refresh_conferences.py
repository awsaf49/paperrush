#!/usr/bin/env python3
"""Fetch official date tables first, then use a bounded optional model fallback."""

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from official_dates import extract_official_deadlines
from run_with_timeout import run_with_timeout
from scraper import CONFERENCES
from update_from_scraper import all_deadlines_passed, get_next_year, get_valid_target_year, load_existing_datajs


SCRIPT_DIR = Path(__file__).resolve().parent


def target_year(conference, requested_year=None, existing=(), now=None):
    if requested_year:
        return get_valid_target_year(conference, requested_year)
    now = now or datetime.now(timezone.utc)
    # Refresh the edition already visible to users, rather than the past UTC year.
    editions = [c for c in existing if c.get("name", "").lower() == conference]
    latest = max(editions, key=lambda c: c["year"], default=None)
    year = latest["year"] if latest else now.year
    if latest and year <= now.year and all_deadlines_passed(latest, now):
        year = max(now.year, get_next_year(conference, year))
    return get_valid_target_year(conference, year)


def source_urls(conference, year, existing):
    config = CONFERENCES[conference]
    base = config["base"].format(year=year, short_year=str(year)[-2:])
    urls = []
    for entry in existing:
        if entry.get("name", "").lower() == conference and entry.get("year") == year:
            # Existing source links are useful only for this exact edition.
            for key in ("dates", "cfp"):
                value = entry.get("links", {}).get(key)
                if value and str(year) in value:
                    urls.append(value)
    seeds = sorted(config["seeds"], key=lambda s: ("date" not in s.lower(), bool(s)))
    urls.extend(f"{base}/{seed}".rstrip("/") for seed in seeds if "guideline" not in seed.lower() and "author" not in seed.lower())
    return list(dict.fromkeys(urls))[:4]


def refresh_one(conference, year, output_dir, existing, provider, fetch=requests.get, run_command=run_with_timeout):
    output_path = Path(output_dir) / f"{conference}.json"
    output_path.unlink(missing_ok=True)
    errors = []
    for url in source_urls(conference, year, existing):
        try:
            response = fetch(url, timeout=15, headers={"User-Agent": "PaperRush/1.0 (official conference deadline refresh)"})
            response.raise_for_status()
            # Cross-domain/edition redirects can silently return old CFPs.
            if urlparse(response.url).hostname != urlparse(url).hostname:
                continue
            linked_years = set(re.findall(r"20\d{2}", response.url))
            if linked_years and linked_years != {str(year)}:
                continue
            if len(response.text) > 500_000:
                continue
            deadlines = extract_official_deadlines(response.text, response.url, year)
            if not deadlines:
                continue
            result = {
                "conference": CONFERENCES[conference]["name"], "year": year,
                "links": {"official": CONFERENCES[conference]["base"].format(year=year, short_year=str(year)[-2:]), "important_dates": response.url},
                "deadlines": deadlines,
                "_meta": {"successful_extractions": 1, "dates_only": True, "source": "official-html"},
            }
            output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            print(f"{conference} {year}: extracted {len(deadlines)} official deadlines without a model", flush=True)
            return {"conference": conference, "year": year, "source": "official-html"}
        except Exception as error:
            errors.append(f"{url}: {error}")

    if provider in {"gemini", "openrouter"}:
        command = [sys.executable, str(SCRIPT_DIR / "scraper.py"), conference,
                   "--year", str(year), "--max-steps", "3", "--output", str(output_path)]
        if provider == "gemini":
            command.append("--gemini")
        try:
            result = run_command(command, timeout=120, check=False)
            if result.returncode == 0 and output_path.is_file():
                return {"conference": conference, "year": year, "source": provider}
        except Exception as error:
            errors.append(f"model fallback: {error}")
    output_path.unlink(missing_ok=True)
    print(f"::warning::{conference} {year}: no validated extraction; retaining published data", flush=True)
    return {"conference": conference, "year": year, "source": None, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferences", default="all")
    parser.add_argument("--year", type=int)
    parser.add_argument("--data", default="js/data.js")
    parser.add_argument("--output-dir", default="/tmp/scraped")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    conferences = list(CONFERENCES) if args.conferences == "all" else list(dict.fromkeys(c.strip().lower() for c in args.conferences.split(",") if c.strip()))
    if not conferences or any(c not in CONFERENCES for c in conferences):
        parser.error("Provide one or more supported conference keys")
    if args.workers < 1 or args.workers > 4:
        parser.error("workers must be between 1 and 4")
    existing = load_existing_datajs(args.data)
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    provider = os.environ.get("PAPERRUSH_SCRAPER_PROVIDER", "none")

    def refresh(conference):
        year = target_year(conference, args.year, existing)
        try:
            return refresh_one(conference, year, args.output_dir, existing, provider)
        except Exception as error:
            print(f"::warning::{conference} {year}: refresh failed: {error}", flush=True)
            return {"conference": conference, "year": year, "source": None, "errors": [str(error)]}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        report = list(pool.map(refresh, conferences))
    (Path(args.output_dir) / "../fetch-report.json").resolve().write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if any(item["source"] for item in report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
