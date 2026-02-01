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

    return list(result.values())


# =============================================================================
# SCRAPER INTEGRATION
# =============================================================================

def run_scraper(conference: str, year: int, output_path: str) -> bool:
    """
    Run the scraper for a single conference.

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
            print(f"Scraping {conf}...")
            output_path = os.path.join(tmpdir, f"{conf}.json")

            if run_scraper(conf, args.year, output_path):
                json_files.append(output_path)
                print(f"  Success: {output_path}")
            else:
                print(f"  Failed to scrape {conf}")

    if not json_files:
        print("No conferences to process. Exiting.")
        return

    # Convert all scraped data
    converted = []
    skipped = []

    for json_file in json_files:
        if not os.path.exists(json_file):
            print(f"Warning: {json_file} not found, skipping")
            continue

        print(f"Converting {json_file}...")
        with open(json_file, "r") as f:
            scraper_data = json.load(f)

        # Check if scrape actually succeeded (has deadlines)
        deadlines = scraper_data.get("deadlines", [])
        if not deadlines:
            conf_name = scraper_data.get("conference", "Unknown")
            year = scraper_data.get("year", "?")
            print(f"  ⚠️  SKIPPED: {conf_name} {year} - no deadlines found (scrape failed or not announced)")
            print(f"      Existing data will be preserved.")
            skipped.append(f"{conf_name}-{year}")
            continue

        conf = convert_scraper_to_datajs(scraper_data, metadata)
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
        if skipped:
            print(f"  Skipped (no deadlines): {', '.join(skipped)}")
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
        print(f"  Total in data.js: {len(conferences)}")
        if skipped:
            print(f"  Skipped (no deadlines): {', '.join(skipped)}")
        print(f"  Size: {len(js_content):,} bytes")

    # Cleanup temp directory if we created one
    if tmpdir and os.path.exists(tmpdir):
        shutil.rmtree(tmpdir)


if __name__ == "__main__":
    main()
