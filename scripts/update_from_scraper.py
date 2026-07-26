#!/usr/bin/env python3
"""
Update data.js from Scraper Output

Main entry point for the scraper → website integration pipeline.
Orchestrates scraping multiple conferences and updating data.js.

Usage:
    # Scrape specific conferences and update data.js
    python scripts/update_from_scraper.py --conferences cvpr,icml --year 2026

    # Convert existing scraper JSON files to data.js
    python scripts/update_from_scraper.py --input /tmp/cvpr.json /tmp/icml.json

    # Full pipeline: scrape and update
    python scripts/update_from_scraper.py --conferences cvpr --year 2026 --output js/data.js
"""

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# Import from sibling modules
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

from scraper_to_datajs import convert_scraper_to_datajs, load_metadata


# =============================================================================
# COUNTRY TO FLAG EMOJI MAPPING
# =============================================================================

COUNTRY_FLAGS = {
    "united states": "🇺🇸", "usa": "🇺🇸", "us": "🇺🇸", "u.s.a.": "🇺🇸", "america": "🇺🇸",
    # US state abbreviations (scrapers sometimes return state instead of country)
    "al": "🇺🇸", "ak": "🇺🇸", "az": "🇺🇸", "ar": "🇺🇸", "ca": "🇺🇸", "co": "🇺🇸",
    "ct": "🇺🇸", "de": "🇺🇸", "fl": "🇺🇸", "ga": "🇺🇸", "hi": "🇺🇸", "id": "🇺🇸",
    "il": "🇺🇸", "in": "🇺🇸", "ia": "🇺🇸", "ks": "🇺🇸", "ky": "🇺🇸", "la": "🇺🇸",
    "me": "🇺🇸", "md": "🇺🇸", "ma": "🇺🇸", "mi": "🇺🇸", "mn": "🇺🇸", "ms": "🇺🇸",
    "mo": "🇺🇸", "mt": "🇺🇸", "ne": "🇺🇸", "nv": "🇺🇸", "nh": "🇺🇸", "nj": "🇺🇸",
    "nm": "🇺🇸", "ny": "🇺🇸", "nc": "🇺🇸", "nd": "🇺🇸", "oh": "🇺🇸", "ok": "🇺🇸",
    "or": "🇺🇸", "pa": "🇺🇸", "ri": "🇺🇸", "sc": "🇺🇸", "sd": "🇺🇸", "tn": "🇺🇸",
    "tx": "🇺🇸", "ut": "🇺🇸", "vt": "🇺🇸", "va": "🇺🇸", "wa": "🇺🇸", "wv": "🇺🇸",
    "wi": "🇺🇸", "wy": "🇺🇸", "dc": "🇺🇸",
    "canada": "🇨🇦",
    "united kingdom": "🇬🇧", "uk": "🇬🇧", "england": "🇬🇧",
    "germany": "🇩🇪",
    "france": "🇫🇷",
    "italy": "🇮🇹",
    "spain": "🇪🇸",
    "netherlands": "🇳🇱",
    "belgium": "🇧🇪",
    "switzerland": "🇨🇭",
    "austria": "🇦🇹",
    "sweden": "🇸🇪",
    "norway": "🇳🇴",
    "denmark": "🇩🇰",
    "finland": "🇫🇮",
    "poland": "🇵🇱",
    "czech republic": "🇨🇿", "czechia": "🇨🇿",
    "portugal": "🇵🇹",
    "greece": "🇬🇷",
    "ireland": "🇮🇪",
    "australia": "🇦🇺",
    "new zealand": "🇳🇿",
    "japan": "🇯🇵",
    "china": "🇨🇳",
    "south korea": "🇰🇷", "korea": "🇰🇷",
    "singapore": "🇸🇬",
    "hong kong": "🇭🇰",
    "taiwan": "🇹🇼",
    "india": "🇮🇳",
    "israel": "🇮🇱",
    "brazil": "🇧🇷",
    "mexico": "🇲🇽",
    "argentina": "🇦🇷",
    "south africa": "🇿🇦",
    "uae": "🇦🇪", "united arab emirates": "🇦🇪",
    "thailand": "🇹🇭",
    "vietnam": "🇻🇳",
    "indonesia": "🇮🇩",
    "malaysia": "🇲🇾",
    "philippines": "🇵🇭",
}


def get_flag_emoji(country: str) -> str:
    """Get flag emoji for a country name, or 🌍 if unknown."""
    if not country or not isinstance(country, str):
        return "🌍"
    return COUNTRY_FLAGS.get(country.lower().strip(), "🌍")


def is_valid_location(location: dict) -> bool:
    """Check if location has valid city/country (not null/TBD)."""
    if not location or not isinstance(location, dict):
        return False
    city = location.get("city")
    country = location.get("country")
    # Check for null-like values
    null_values = {None, "", "null", "None", "TBD", "tbd", "N/A", "n/a", "unknown"}
    return city not in null_values and country not in null_values


def normalize_location(location: dict) -> dict:
    """Normalize location: ensure flag is set, handle null values."""
    if not location or not isinstance(location, dict):
        return {"city": "TBD", "country": "TBD", "flag": "🌍", "venue": None}

    null_values = {None, "", "null", "None", "TBD", "tbd", "N/A", "n/a", "unknown"}

    city = location.get("city")
    country = location.get("country")
    venue = location.get("venue")
    flag = location.get("flag")

    # Normalize null-like values
    city = city if city not in null_values else "TBD"
    country = country if country not in null_values else "TBD"
    venue = venue if venue not in null_values else None

    # Derive flag from country if not set or invalid
    if not flag or flag in null_values or flag == "🌍":
        flag = get_flag_emoji(country) if country != "TBD" else "🌍"

    return {
        "city": city,
        "country": country,
        "flag": flag,
        "venue": venue
    }


# =============================================================================
# DATA.JS GENERATION
# =============================================================================

def generate_datajs_content(conferences: List[Dict], last_updated: Optional[str] = None) -> str:
    """
    Generate the complete data.js file content.

    Args:
        conferences: List of converted conference objects
        last_updated: ISO timestamp for last update

    Returns:
        JavaScript file content as string
    """
    if not last_updated:
        last_updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Sort conferences by year (desc) then name (asc)
    conferences = sorted(conferences, key=lambda c: (-c.get("year", 0), c.get("name", "")))

    # Build the full data structure
    data_structure = {
        "lastUpdated": last_updated,
        "conferences": conferences
    }

    # Generate JSON with proper indentation
    # Use indent="\t" to match original data.js style with tabs
    json_str = json.dumps(data_structure, indent="\t", ensure_ascii=False)

    # Add extra indentation for conferences array items (to match original style)
    # Original data.js has conferences array items indented with double tabs
    lines = json_str.split("\n")
    result_lines = []
    in_conferences = False
    brace_depth = 0

    for line in lines:
        # Track when we enter conferences array
        if '"conferences":' in line:
            in_conferences = True
            result_lines.append(line)
            continue

        if in_conferences:
            # Add extra tab for content inside conferences array
            stripped = line.lstrip('\t')
            current_tabs = len(line) - len(stripped)
            if current_tabs > 1:  # Inside conferences array
                line = '\t' + line  # Add one extra tab
            if line.strip() == ']':
                in_conferences = False

        result_lines.append(line)

    json_str = "\n".join(result_lines)

    js_content = f'''/**
 * Conference Data
 * This file contains all conference information.
 * Auto-updated by GitHub Actions + Gemini
 * Last updated: {last_updated}
 */

const CONFERENCES_DATA = {json_str};

// Category metadata
const CATEGORIES = {{
    ml: {{ name: "Machine Learning", color: "#AF52DE" }},
    cv: {{ name: "Computer Vision", color: "#007AFF" }},
    nlp: {{ name: "NLP", color: "#34C759" }},
    speech: {{ name: "Speech & Audio", color: "#FF9500" }},
    robotics: {{ name: "Robotics", color: "#FF1493" }},
    other: {{ name: "Other", color: "#8E8E93" }}
}};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {{
    module.exports = {{ CONFERENCES_DATA, CATEGORIES }};
}}
'''

    return js_content


def load_existing_datajs(datajs_path: str) -> List[Dict]:
    """
    Load existing conferences from data.js file.

    Returns:
        List of conference objects
    """
    if not os.path.exists(datajs_path):
        return []

    with open(datajs_path, "r") as f:
        content = f.read()

    # Extract the conferences array using regex
    import re

    # Find CONFERENCES_DATA = {...}
    match = re.search(r'const CONFERENCES_DATA\s*=\s*\{', content)
    if not match:
        return []

    # Find conferences: [...] (with or without quotes around key)
    conf_match = re.search(r'"?conferences"?:\s*\[', content)
    if not conf_match:
        return []

    # Extract from the opening bracket
    start = conf_match.end() - 1  # Include the [

    # Find matching closing bracket
    bracket_count = 0
    end = start
    for i, char in enumerate(content[start:]):
        if char == '[':
            bracket_count += 1
        elif char == ']':
            bracket_count -= 1
            if bracket_count == 0:
                end = start + i + 1
                break

    conferences_json = content[start:end]

    try:
        return json.loads(conferences_json)
    except json.JSONDecodeError:
        print(f"Warning: Could not parse existing data.js")
        return []


def merge_conferences(existing: List[Dict], new: List[Dict]) -> List[Dict]:
    """
    Merge new conference data with existing data.
    New data takes precedence for matching conferences.
    Removes stale entries when a newer year exists (e.g., removes aaai-2026 when aaai-2027 is added).

    Args:
        existing: Existing conferences from data.js
        new: New/updated conferences from scraper

    Returns:
        Merged list of conferences
    """
    # Build lookup by ID
    result = {c["id"]: c for c in existing}

    # Update/add new conferences
    for conf in new:
        conf_id = conf.get("id")
        if conf_id:
            if conf_id in result:
                # Merge with existing data
                existing_conf = result[conf_id]

                # LOCATION: Prefer scraped location if valid, else use existing
                new_location = conf.get("location")
                existing_location = existing_conf.get("location")

                if is_valid_location(new_location):
                    # Use freshly scraped location (normalize to ensure flag is set)
                    conf["location"] = normalize_location(new_location)
                elif is_valid_location(existing_location):
                    # Fall back to existing location (normalize in case flag is missing)
                    conf["location"] = normalize_location(existing_location)
                else:
                    # Both invalid - use TBD
                    conf["location"] = normalize_location(None)

                # Preserve other manually-set fields
                preserved_fields = ["brandColor", "notes"]
                for field in preserved_fields:
                    if field in existing_conf and existing_conf[field]:
                        conf[field] = existing_conf[field]

                # Preserve existing acceptance rate if not in new data
                existing_info = existing_conf.get("info", {})
                new_info = conf.get("info", {})
                if existing_info.get("acceptanceRate") and not new_info.get("acceptanceRate"):
                    conf.setdefault("info", {})["acceptanceRate"] = existing_info["acceptanceRate"]
            else:
                # New conference - normalize location
                conf["location"] = normalize_location(conf.get("location"))

            result[conf_id] = conf

    # Keep only the newest edition across both existing and newly scraped data.
    # A scrape of an old year must never reintroduce it beside a newer edition.
    latest_years = {}
    for conf in result.values():
        name = conf.get("name", "").lower()
        year = conf.get("year", 0)
        if name and year:
            latest_years[name] = max(latest_years.get(name, 0), year)

    stale_ids = []
    for conf_id, conf in result.items():
        name = conf.get("name", "").lower()
        year = conf.get("year", 0)
        if name in latest_years and year < latest_years[name]:
            stale_ids.append(conf_id)

    for stale_id in stale_ids:
        del result[stale_id]
        print(f"    🗑️  Removed stale entry: {stale_id}")

    return list(result.values())


# =============================================================================
# FALLBACK / ROLLOVER LOGIC
# =============================================================================

# Biennial conferences (happen every 2 years)
BIENNIAL_CONFERENCES = {
    "iccv": "odd",   # 2023, 2025, 2027
    "eccv": "even",  # 2022, 2024, 2026
}


def get_year_offset(conf_name: str) -> int:
    """Get year offset for conference (2 for biennial, 1 for annual)."""
    return 2 if conf_name.lower() in BIENNIAL_CONFERENCES else 1


def get_next_year(conf_name: str, current_year: int) -> int:
    """Get next valid year for a conference."""
    return current_year + get_year_offset(conf_name)


def get_previous_year(conf_name: str, current_year: int) -> int:
    """Get previous valid year for a conference."""
    return current_year - get_year_offset(conf_name)


def get_valid_target_year(conf_name: str, requested_year: int) -> int:
    """
    Get the valid target year for a conference.
    For biennial conferences, adjusts to the nearest valid year.

    - ICCV: odd years only (2023, 2025, 2027)
    - ECCV: even years only (2022, 2024, 2026)
    """
    conf_lower = conf_name.lower()

    if conf_lower == "iccv":
        # ICCV is odd years only
        if requested_year % 2 == 0:  # Even year requested
            return requested_year + 1  # Move to next odd year
    elif conf_lower == "eccv":
        # ECCV is even years only
        if requested_year % 2 == 1:  # Odd year requested
            return requested_year + 1  # Move to next even year

    return requested_year


def is_submission_deadline(deadline: Dict) -> bool:
    """Return True for main-track, author-facing submission deadlines."""
    dtype = deadline.get("type", "").lower()
    label = deadline.get("label", "").lower()
    excluded_labels = [
        "workshop", "tutorial", "demo", "dataset", "benchmark",
        "position", "art ", "education", "industry", "doctoral",
        "student", "competition", "affinity", "show and tell", "social",
        "reviewer", "review", "bidding", "camera",
        "notification", "decision", "rebuttal", "conference",
    ]

    if any(excluded in label for excluded in excluded_labels):
        return False

    return dtype in {"abstract", "paper", "supplementary"}


def bump_year_in_url(url: str, existing_year: int, target_year: int) -> str:
    """Update common four- and two-digit conference edition URL patterns."""
    if not url:
        return url

    updated = url.replace(str(existing_year), str(target_year))
    old_short_year = str(existing_year)[-2:]
    new_short_year = str(target_year)[-2:]
    updated = updated.replace(f"aaai-{old_short_year}", f"aaai-{new_short_year}")
    return updated


def parse_date_for_comparison(date_str: str) -> Optional[datetime]:
    """
    Parse a date string into a datetime for comparison.
    Handles 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS±HH:MM' formats.
    """
    if not date_str:
        return None

    try:
        normalized = date_str.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            # Date-only values represent the end of the listed day.
            parsed = parsed.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def all_deadlines_passed(conf_data: Dict, now: Optional[datetime] = None) -> bool:
    """
    Check if all main author submission deadlines have passed.

    Conference dates, notifications, reviews, and camera-ready deadlines do
    not keep an old edition current. PaperRush should move to the next edition
    as soon as the author submission window closes.

    Args:
        conf_data: Conference data (either scraper format or datajs format)

    Returns:
        True if no main submission deadline remains, False otherwise
    """
    now = now or datetime.now(timezone.utc)

    deadlines = [
        deadline for deadline in conf_data.get("deadlines", [])
        if is_submission_deadline(deadline)
    ]
    if not deadlines:
        return True

    for deadline in deadlines:
        date_str = deadline.get("date")
        date = parse_date_for_comparison(date_str)

        if date and date > now:
            return False  # Found a future deadline

    return True


def create_estimated_from_existing(existing_conf: Dict, target_year: int, year_offset: int = None) -> Optional[Dict]:
    """
    Create a next-edition placeholder without inventing deadline dates.

    Args:
        existing_conf: Existing conference data
        target_year: Target year for the placeholder
        year_offset: Retained for compatibility with existing callers

    Returns:
        New conference dict with dates marked TBA, or None if invalid
    """
    existing_year = existing_conf.get("year", 0)
    if not existing_year or existing_year >= target_year:
        return None

    conf_name = existing_conf.get("name", "")

    # Create new conference entry
    conf_name_lower = conf_name.lower()
    new_conf = {
        "id": f"{conf_name_lower}-{target_year}",
        "name": existing_conf.get("name"),
        "fullName": existing_conf.get("fullName"),
        "year": target_year,
        "category": existing_conf.get("category"),
        "website": bump_year_in_url(
            existing_conf.get("website", ""), existing_year, target_year
        ),
        "brandColor": existing_conf.get("brandColor"),
        "location": normalize_location(None),
        "deadlines": [],
        "links": {},  # Don't copy old links - they'd be wrong
        "info": existing_conf.get("info", {}),
        "notes": [],
        "isEstimated": True,
        "datesTBD": True,
    }

    return new_conf


def try_create_fallback(
    conf_name: str,
    target_year: int,
    existing_conferences: List[Dict],
    run_scraper_fn
) -> Optional[Dict]:
    """
    Create a dates-TBA fallback when scraping fails.

    Smart cascading fallback strategy (prioritizes accuracy):
    1. Try scraping previous year - most accurate source for estimates
    2. Fall back to existing data.js data - last resort if scraping fails

    For biennial conferences (ICCV/ECCV), uses 2-year offsets.

    Args:
        conf_name: Conference name (e.g., "neurips")
        target_year: Target year (e.g., 2026)
        existing_conferences: List of existing conference data
        run_scraper_fn: Function to run scraper for a conference

    Returns:
        Estimated conference dict, or None if can't create fallback
    """
    conf_name_lower = conf_name.lower()
    target_id = f"{conf_name_lower}-{target_year}"
    year_offset = get_year_offset(conf_name)
    prev_year = get_previous_year(conf_name, target_year)
    prev_id = f"{conf_name_lower}-{prev_year}"

    # Build lookup
    existing_by_id = {c["id"]: c for c in existing_conferences}

    # Strategy 1: Try scraping previous year FIRST (most accurate)
    # The previous edition confirms the conference exists; its dates are not reused.
    print(f"    🔍 Trying to scrape {prev_year} for fallback...")

    import tempfile
    import os

    tmpfile = tempfile.mktemp(suffix=".json", prefix=f"{conf_name_lower}_")

    if run_scraper_fn(conf_name, prev_year, tmpfile):
        try:
            with open(tmpfile, "r") as f:
                import json
                prev_data = json.load(f)

            if prev_data.get("deadlines"):
                print(f"    ✅ Got {prev_year} data; publishing {target_year} with dates TBA")

                # Convert to datajs format first
                from scraper_to_datajs import convert_scraper_to_datajs, load_metadata
                metadata = load_metadata()
                prev_conf = convert_scraper_to_datajs(prev_data, metadata)

                placeholder = create_estimated_from_existing(prev_conf, target_year, year_offset)
                return placeholder
            else:
                print(f"    ⚠️ {prev_year} also has no deadlines")
        except Exception as e:
            print(f"    ⚠️ Error processing {prev_year} data: {e}")
        finally:
            if os.path.exists(tmpfile):
                os.remove(tmpfile)
    else:
        print(f"    ⚠️ Failed to scrape {prev_year}")

    # Strategy 2: Fall back to existing data.js data (last resort)
    if target_id in existing_by_id:
        existing = existing_by_id[target_id]
        if existing.get("deadlines"):
            print(f"    📦 Using existing {target_year} data as last resort fallback")
            if existing.get("isEstimated"):
                existing["deadlines"] = []
                existing["datesTBD"] = True
            return existing

    return None


def try_roll_forward(
    conf_data: Dict,
    run_scraper_fn
) -> Optional[Dict]:
    """
    When all deadlines have passed, try to get next year's data.

    Strategy:
    1. Try scraping next year
    2. If next year doesn't exist, publish the edition with dates TBA

    Args:
        conf_data: Current conference data (datajs format)
        run_scraper_fn: Function to run scraper for a conference

    Returns:
        Next year's confirmed data, or a dates-TBA placeholder
    """
    conf_name = conf_data.get("name", "")
    current_year = conf_data.get("year", 0)

    if not conf_name or not current_year:
        return None

    conf_name_lower = conf_name.lower()
    year_offset = get_year_offset(conf_name)
    next_year = get_next_year(conf_name, current_year)

    print(f"    🔄 All deadlines passed for {conf_name} {current_year}, rolling forward to {next_year}...")

    # Strategy 1: Try scraping next year
    import tempfile
    import os

    tmpfile = tempfile.mktemp(suffix=".json", prefix=f"{conf_name_lower}_")

    if run_scraper_fn(conf_name, next_year, tmpfile):
        try:
            with open(tmpfile, "r") as f:
                import json
                next_data = json.load(f)

            if next_data.get("deadlines"):
                print(f"    ✅ Got {next_year} data")

                # Convert to datajs format
                from scraper_to_datajs import convert_scraper_to_datajs, load_metadata
                metadata = load_metadata()
                next_conf = convert_scraper_to_datajs(next_data, metadata)
                return next_conf
            else:
                print(f"    ⚠️ {next_year} site exists but no deadlines yet")
        except Exception as e:
            print(f"    ⚠️ Error processing {next_year} data: {e}")
        finally:
            if os.path.exists(tmpfile):
                os.remove(tmpfile)
    else:
        print(f"    ⚠️ {next_year} site not available yet")

    # Strategy 2: Publish a placeholder without inventing dates
    print(f"    📅 Official {next_year} dates unavailable; publishing TBA")
    return create_estimated_from_existing(conf_data, next_year, year_offset)


# =============================================================================
# SCRAPER INTEGRATION
# =============================================================================

def run_scraper(conference: str, year: int, output_path: str, use_gemini: bool = True) -> bool:
    """
    Run the scraper for a single conference.

    Args:
        conference: Conference name (e.g., "cvpr")
        year: Conference year
        output_path: Path to save JSON output
        use_gemini: Use Gemini API (default: True, matches workflow)

    Returns:
        True if successful, False otherwise
    """
    import subprocess

    cmd = [
        sys.executable,
        str(script_dir / "scraper.py"),
        conference,
        "--year", str(year),
        "--output", output_path,
        "--quiet"
    ]

    # Use Gemini by default (matches GitHub Actions workflow)
    if use_gemini:
        cmd.append("--gemini")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"  Error scraping {conference}: {result.stderr}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print(f"  Timeout scraping {conference}")
        return False
    except Exception as e:
        print(f"  Exception scraping {conference}: {e}")
        return False


# =============================================================================
# MAIN
# =============================================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Update data.js from scraper output",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Scrape and update specific conferences
    python scripts/update_from_scraper.py --conferences cvpr,icml --year 2026

    # Convert existing JSON files
    python scripts/update_from_scraper.py --input /tmp/cvpr.json /tmp/icml.json

    # Full update with custom output
    python scripts/update_from_scraper.py --conferences cvpr --year 2026 --output js/data.js

    # Dry run (preview without writing)
    python scripts/update_from_scraper.py --input /tmp/cvpr.json --dry-run
"""
    )

    parser.add_argument("--conferences", "-c",
                        help="Comma-separated list of conferences to scrape (e.g., cvpr,icml)")
    current_year = datetime.now(timezone.utc).year
    parser.add_argument("--year", "-y", type=int, default=current_year,
                        help=f"Conference year (default: {current_year})")
    parser.add_argument("--input", "-i", nargs="*",
                        help="Input JSON files from scraper (instead of running scraper)")
    parser.add_argument("--output", "-o", default="js/data.js",
                        help="Output data.js path (default: js/data.js)")
    parser.add_argument("--metadata", "-m",
                        help="Path to conference_metadata.json")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Print output without writing to file")
    parser.add_argument("--no-merge", action="store_true",
                        help="Don't merge with existing data.js (replace entirely)")

    args = parser.parse_args()

    # Validate arguments
    if not args.conferences and not args.input:
        parser.error("Either --conferences or --input is required")

    # Load metadata
    metadata = load_metadata(args.metadata)

    # Collect scraper JSON files
    json_files = []
    tmpdir = None  # Track if we created a temp directory

    if args.input:
        # Use provided input files
        json_files = args.input
    elif args.conferences:
        # Run scraper for each conference
        conferences = [c.strip() for c in args.conferences.split(",")]

        # Use /tmp directly instead of auto-deleting TemporaryDirectory
        tmpdir = tempfile.mkdtemp(prefix="scraper_")
        for conf in conferences:
            # Adjust year for biennial conferences (ICCV=odd, ECCV=even)
            target_year = get_valid_target_year(conf, args.year)
            if target_year != args.year:
                print(f"Scraping {conf}... (adjusted to {target_year}, {conf.upper()} is biennial)")
            else:
                print(f"Scraping {conf}...")

            output_path = os.path.join(tmpdir, f"{conf}.json")

            if run_scraper(conf, target_year, output_path):
                json_files.append(output_path)
                print(f"  Success: {output_path}")
            else:
                print(f"  Failed to scrape {conf}")

    if not json_files:
        print("No conferences to process. Exiting.")
        return

    # Load existing data for fallback
    default_datajs = os.path.join(os.path.dirname(script_dir), "js", "data.js")
    existing_conferences = []
    if os.path.exists(default_datajs):
        existing_conferences = load_existing_datajs(default_datajs)
    elif os.path.exists(args.output):
        existing_conferences = load_existing_datajs(args.output)

    # Convert all scraped data
    converted = []
    skipped = []
    estimated = []

    for json_file in json_files:
        if not os.path.exists(json_file):
            print(f"Warning: {json_file} not found, skipping")
            continue

        print(f"Converting {json_file}...")
        with open(json_file, "r") as f:
            scraper_data = json.load(f)

        # Check if scrape actually succeeded (has deadlines)
        deadlines = scraper_data.get("deadlines", [])
        conf_name = scraper_data.get("conference", "Unknown")
        year = scraper_data.get("year", args.year)

        if not deadlines:
            print(f"  ⚠️  No deadlines found for {conf_name} {year}")
            print(f"      Attempting fallback...")

            # Try to create a dates-TBA placeholder
            fallback = try_create_fallback(
                conf_name,
                year,
                existing_conferences,
                run_scraper
            )

            if fallback:
                converted.append(fallback)
                estimated.append(f"{conf_name}-{year}")
                print(f"  📅 Created dates-TBA placeholder: {fallback['id']}")
            else:
                print(f"  ❌ No fallback available for {conf_name} {year}")
                skipped.append(f"{conf_name}-{year}")
            continue

        conf = convert_scraper_to_datajs(scraper_data, metadata)

        # Check if all deadlines have passed → roll forward to next year
        if all_deadlines_passed(conf):
            print(f"  ⏰ All deadlines passed for {conf_name} {year}")
            rolled = try_roll_forward(conf, run_scraper)
            if rolled:
                converted.append(rolled)
                if rolled.get("isEstimated"):
                    estimated.append(f"{rolled['id']}")
                print(f"  🔄 Rolled forward: {rolled['id']} ({len(rolled.get('deadlines', []))} deadlines)")
            else:
                # Keep current data if roll-forward fails
                converted.append(conf)
                print(f"  ⚠️ Roll-forward failed, keeping current: {conf['id']}")
        else:
            converted.append(conf)
            print(f"  ✅ Converted: {conf['id']} ({len(conf.get('deadlines', []))} deadlines)")

    if not converted:
        print(f"\n{'=' * 70}")
        print(" ⚠️  No conferences converted successfully!")
        print(f"{'=' * 70}")
        if skipped:
            print(f"  Skipped (no deadlines): {', '.join(skipped)}")
        print("  Existing data.js will NOT be modified.")
        return

    # Merge with existing data.js
    # Prefer merging from js/data.js (production), fall back to output path if same
    default_datajs = os.path.join(os.path.dirname(script_dir), "js", "data.js")

    # Determine merge source: prefer default location, then output path
    if os.path.exists(default_datajs):
        merge_source = default_datajs
    elif os.path.exists(args.output):
        merge_source = args.output
    else:
        merge_source = None

    if not args.no_merge and merge_source:
        print(f"Merging with existing {merge_source}...")
        existing = load_existing_datajs(merge_source)
        conferences = merge_conferences(existing, converted)
        print(f"  Merged: {len(existing)} existing + {len(converted)} new = {len(conferences)} total")
    else:
        conferences = converted

    # Generate output
    js_content = generate_datajs_content(conferences)

    if args.dry_run:
        print(f"\n{'=' * 70}")
        print(f" DRY RUN - Summary")
        print(f"{'=' * 70}")
        print(f"  Would update: {len(converted)} conferences")
        if estimated:
            print(f"  Dates TBA: {', '.join(estimated)}")
        if skipped:
            print(f"  Skipped (no fallback): {', '.join(skipped)}")
        print(f"  Total would be: {len(conferences)} conferences")
        print(f"\nFirst 2000 chars of output:")
        print(js_content[:2000] + "..." if len(js_content) > 2000 else js_content)
    else:
        # Ensure output directory exists
        output_dir = os.path.dirname(args.output)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        with open(args.output, "w") as f:
            f.write(js_content)

        print(f"\n{'=' * 70}")
        print(f" ✅ Updated {args.output}")
        print(f"{'=' * 70}")
        print(f"  Conferences updated: {len(converted)}")
        if estimated:
            print(f"  Dates TBA: {', '.join(estimated)}")
        print(f"  Total in data.js: {len(conferences)}")
        if skipped:
            print(f"  Skipped (no fallback): {', '.join(skipped)}")
        print(f"  Size: {len(js_content):,} bytes")

    # Cleanup temp directory if we created one
    if tmpdir and os.path.exists(tmpdir):
        shutil.rmtree(tmpdir)


if __name__ == "__main__":
    main()
