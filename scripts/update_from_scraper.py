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

    # Track which conference names have new entries (to remove stale years)
    new_conf_years = {}  # name -> max_year
    for conf in new:
        name = conf.get("name", "").lower()
        year = conf.get("year", 0)
        if name and year:
            new_conf_years[name] = max(new_conf_years.get(name, 0), year)

    # Update/add new conferences
    for conf in new:
        conf_id = conf.get("id")
        if conf_id:
            if conf_id in result:
                # Merge: keep existing location/metadata, update deadlines/links
                existing_conf = result[conf_id]

                # Preserve manually-set fields
                preserved_fields = ["location", "brandColor", "notes"]
                for field in preserved_fields:
                    if field in existing_conf and existing_conf[field]:
                        conf[field] = existing_conf[field]

                # Preserve existing acceptance rate if not in new data
                existing_info = existing_conf.get("info", {})
                new_info = conf.get("info", {})
                if existing_info.get("acceptanceRate") and not new_info.get("acceptanceRate"):
                    conf.setdefault("info", {})["acceptanceRate"] = existing_info["acceptanceRate"]

            result[conf_id] = conf

    # Remove stale entries: if we have aaai-2027, remove aaai-2026, aaai-2025, etc.
    stale_ids = []
    for conf_id, conf in result.items():
        name = conf.get("name", "").lower()
        year = conf.get("year", 0)
        if name in new_conf_years and year < new_conf_years[name]:
            stale_ids.append(conf_id)

    for stale_id in stale_ids:
        del result[stale_id]
        print(f"    🗑️  Removed stale entry: {stale_id}")

    return list(result.values())


# =============================================================================
# FALLBACK / ESTIMATION LOGIC
# =============================================================================

# Key deadline types to keep for estimated data (minimal set)
# Only keep: abstract, main paper submission, main conference event
KEY_DEADLINE_TYPES = {"abstract", "event"}
KEY_DEADLINE_LABELS_INCLUDE = [
    "abstract submission",
    "paper submission",
    "full paper",
    "main conference",
]
# Exclude these even if they match above (be careful not to exclude main paper deadline)
KEY_DEADLINE_LABELS_EXCLUDE = [
    "workshop", "tutorial", "demo", "dataset", "benchmark",
    "position", "competition", "creative", "education",
    "camera", "notification", "rebuttal", "review",
    "decision", "open", "assigned", "poster", "video",
    "bid", "ac ", "acs ", "reviewer", "meta", "import",
    "assignment", "check", "finalize", "careers", "expo", "sponsor",
    "supplemental material", "supplementary material"  # separate from main submission
]
# Note: We allow "Submission and Supplementary Materials Deadline" (main paper)
# but exclude "Supplemental Material Submission Deadline" (separate deadline)

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


def is_key_deadline(deadline: Dict) -> bool:
    """
    Check if a deadline is a key deadline worth keeping for estimates.

    For estimates, we only want 3 things:
    - Abstract submission
    - Main paper submission
    - Main conference event
    """
    dtype = deadline.get("type", "").lower()
    label = deadline.get("label", "").lower()

    # Always keep main conference event (type=event with "conference" or "main")
    if dtype == "event":
        # Skip if it's about poster, video, upload, etc.
        if any(x in label for x in ["poster", "video", "upload", "deadline"]):
            return False
        if "main conference" in label or label == "main conference":
            return True
        if "conference" in label and "call" not in label:
            return True
        return False  # Skip other events (workshops, tutorials, etc.)

    # First check exclusions - skip workshops, tutorials, etc.
    for exclude in KEY_DEADLINE_LABELS_EXCLUDE:
        if exclude in label:
            return False

    # Keep abstract submission
    if dtype == "abstract" or ("abstract" in label and "submission" in label):
        return True

    # Keep main paper submission (various naming conventions)
    paper_keywords = ["paper submission", "full paper", "submission deadline",
                      "paper registration", "submission and supplementary"]
    if dtype == "paper" or any(kw in label for kw in paper_keywords):
        # Exclude sub-tracks
        if any(x in label for x in ["dataset", "benchmark", "position", "workshop", "demo"]):
            return False
        return True

    return False


def bump_year_in_date(date_str: str, years: int = 1) -> str:
    """
    Bump the year in a date string by N years.
    Handles both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS±HH:MM' formats.
    """
    if not date_str:
        return date_str

    import re

    # Match year at the start
    match = re.match(r'^(\d{4})', date_str)
    if match:
        old_year = int(match.group(1))
        new_year = old_year + years
        return str(new_year) + date_str[4:]

    return date_str


def parse_date_for_comparison(date_str: str) -> Optional[datetime]:
    """
    Parse a date string into a datetime for comparison.
    Handles 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS±HH:MM' formats.
    """
    if not date_str:
        return None

    import re

    # Try ISO format with timezone
    match = re.match(r'^(\d{4})-(\d{2})-(\d{2})', date_str)
    if match:
        try:
            year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            return None

    return None


def all_deadlines_passed(conf_data: Dict) -> bool:
    """
    Check if ALL deadlines including the conference event have passed.

    Args:
        conf_data: Conference data (either scraper format or datajs format)

    Returns:
        True if all deadlines have passed, False otherwise
    """
    now = datetime.now(timezone.utc)

    deadlines = conf_data.get("deadlines", [])
    if not deadlines:
        return True  # No deadlines means nothing upcoming

    for deadline in deadlines:
        # Handle both scraper format (event/date) and datajs format (type/label/date)
        date_str = deadline.get("endDate") or deadline.get("date")
        date = parse_date_for_comparison(date_str)

        if date and date > now:
            return False  # Found a future deadline

    return True


def create_estimated_from_existing(existing_conf: Dict, target_year: int, year_offset: int = None) -> Optional[Dict]:
    """
    Create estimated conference data from existing data.
    Bumps dates by the difference in years and marks as estimated.

    Args:
        existing_conf: Existing conference data
        target_year: Target year for the estimated data
        year_offset: Override for year offset (for biennial conferences)

    Returns:
        New conference dict with estimated deadlines, or None if can't create
    """
    existing_year = existing_conf.get("year", 0)
    if not existing_year or existing_year >= target_year:
        return None

    # Calculate year diff (use offset for biennial conferences)
    conf_name = existing_conf.get("name", "")
    if year_offset is None:
        year_offset = get_year_offset(conf_name)

    year_diff = target_year - existing_year

    # Get existing deadlines
    existing_deadlines = existing_conf.get("deadlines", [])
    if not existing_deadlines:
        return None

    # Filter to key deadlines only and bump dates
    new_deadlines = []
    for deadline in existing_deadlines:
        if not is_key_deadline(deadline):
            continue

        new_deadline = deadline.copy()

        # Bump the date
        if "date" in new_deadline:
            new_deadline["date"] = bump_year_in_date(new_deadline["date"], year_diff)
        if "endDate" in new_deadline and new_deadline["endDate"]:
            new_deadline["endDate"] = bump_year_in_date(new_deadline["endDate"], year_diff)

        # Mark as estimated
        new_deadline["estimated"] = True
        new_deadline["status"] = "upcoming"

        new_deadlines.append(new_deadline)

    if not new_deadlines:
        return None

    # Create new conference entry
    conf_name_lower = conf_name.lower()
    new_conf = {
        "id": f"{conf_name_lower}-{target_year}",
        "name": existing_conf.get("name"),
        "fullName": existing_conf.get("fullName"),
        "year": target_year,
        "category": existing_conf.get("category"),
        "website": existing_conf.get("website", "").replace(str(existing_year), str(target_year)),
        "brandColor": existing_conf.get("brandColor"),
        "location": {
            "city": "TBD",
            "country": "TBD",
            "flag": "🌍",
            "venue": None
        },
        "deadlines": new_deadlines,
        "links": {},  # Don't copy old links - they'd be wrong
        "info": existing_conf.get("info", {}),
        "notes": [],
        "isEstimated": True,  # Mark entire conference as estimated
    }

    return new_conf


def try_create_fallback(
    conf_name: str,
    target_year: int,
    existing_conferences: List[Dict],
    run_scraper_fn
) -> Optional[Dict]:
    """
    Try to create fallback/estimated data when scraping fails.

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
    # This gives us real dates to estimate from, rather than using old estimates
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
                print(f"    ✅ Got {prev_year} data, creating {target_year} estimate (+{year_offset} year{'s' if year_offset > 1 else ''})")

                # Convert to datajs format first
                from scraper_to_datajs import convert_scraper_to_datajs, load_metadata
                metadata = load_metadata()
                prev_conf = convert_scraper_to_datajs(prev_data, metadata)

                estimated = create_estimated_from_existing(prev_conf, target_year, year_offset)

                # If estimate is missing "Main Conference" event, try to get from existing data.js
                if estimated:
                    has_event = any(d.get("type") == "event" for d in estimated.get("deadlines", []))
                    if not has_event and target_id in existing_by_id:
                        existing = existing_by_id[target_id]
                        for deadline in existing.get("deadlines", []):
                            if deadline.get("type") == "event" and "conference" in deadline.get("label", "").lower():
                                # Copy the existing conference event
                                event_copy = deadline.copy()
                                event_copy["estimated"] = True
                                estimated["deadlines"].append(event_copy)
                                print(f"    📅 Added Main Conference event from existing data")
                                break

                return estimated
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
            # Mark deadlines as estimated
            for deadline in existing.get("deadlines", []):
                deadline["estimated"] = True
            existing["isEstimated"] = True
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
    2. If next year doesn't exist, estimate from current year

    Args:
        conf_data: Current conference data (datajs format)
        run_scraper_fn: Function to run scraper for a conference

    Returns:
        Next year's conference data, or estimated data
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

    # Strategy 2: Estimate from current year
    print(f"    📅 Estimating {next_year} from {current_year} data (+{year_offset} year{'s' if year_offset > 1 else ''})")
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
    parser.add_argument("--year", "-y", type=int, default=2026,
                        help="Conference year (default: 2026)")
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

            # Try to create estimated data
            fallback = try_create_fallback(
                conf_name,
                year,
                existing_conferences,
                run_scraper
            )

            if fallback:
                converted.append(fallback)
                estimated.append(f"{conf_name}-{year}")
                print(f"  📊 Created estimated: {fallback['id']} ({len(fallback.get('deadlines', []))} key deadlines)")
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
            print(f"  Estimated (from prev year): {', '.join(estimated)}")
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
            print(f"  Estimated (from prev year): {', '.join(estimated)}")
        print(f"  Total in data.js: {len(conferences)}")
        if skipped:
            print(f"  Skipped (no fallback): {', '.join(skipped)}")
        print(f"  Size: {len(js_content):,} bytes")

    # Cleanup temp directory if we created one
    if tmpdir and os.path.exists(tmpdir):
        shutil.rmtree(tmpdir)


if __name__ == "__main__":
    main()
