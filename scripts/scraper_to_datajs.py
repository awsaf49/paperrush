#!/usr/bin/env python3
"""
Scraper to data.js Converter

Transforms scraper JSON output into the format expected by the PaperRush website.
This is a zero-breaking-change approach - the website code stays unchanged.

Usage:
    python scripts/scraper_to_datajs.py /tmp/cvpr.json --output /tmp/cvpr_converted.json
    python scripts/scraper_to_datajs.py /tmp/cvpr.json --metadata scripts/conference_metadata.json
"""

import json
import re
import os
from typing import Dict, List, Optional
from pathlib import Path


# =============================================================================
# TIMEZONE CONVERSION
# =============================================================================

TIMEZONE_OFFSETS = {
    # Standard offsets
    "AoE": "-12:00",      # Anywhere on Earth
    "UTC": "+00:00",
    "GMT": "+00:00",

    # US timezones
    "PST": "-08:00",      # Pacific Standard
    "PDT": "-07:00",      # Pacific Daylight
    "PT": "-08:00",       # Pacific Time (default to standard)
    "MST": "-07:00",      # Mountain Standard
    "MDT": "-06:00",      # Mountain Daylight
    "MT": "-07:00",       # Mountain Time
    "CST": "-06:00",      # Central Standard
    "CDT": "-05:00",      # Central Daylight
    "CT": "-06:00",       # Central Time
    "EST": "-05:00",      # Eastern Standard
    "EDT": "-04:00",      # Eastern Daylight
    "ET": "-05:00",       # Eastern Time

    # European timezones
    "CET": "+01:00",      # Central European
    "CEST": "+02:00",     # Central European Summer
    "WET": "+00:00",      # Western European
    "WEST": "+01:00",     # Western European Summer
    "EET": "+02:00",      # Eastern European
    "EEST": "+03:00",     # Eastern European Summer

    # Asian timezones
    "JST": "+09:00",      # Japan Standard
    "KST": "+09:00",      # Korea Standard
    "CST_ASIA": "+08:00", # China Standard
    "IST": "+05:30",      # India Standard
    "SGT": "+08:00",      # Singapore

    # Australian timezones
    "AEST": "+10:00",     # Australian Eastern Standard
    "AEDT": "+11:00",     # Australian Eastern Daylight
    "AWST": "+08:00",     # Australian Western Standard
}


def timezone_to_offset(tz: Optional[str]) -> str:
    """
    Convert timezone abbreviation to UTC offset.
    Default to AoE (-12:00) which is common for academic deadlines.
    """
    if not tz:
        return "-12:00"  # Default to AoE

    tz_upper = tz.upper().strip()
    return TIMEZONE_OFFSETS.get(tz_upper, "-12:00")


# =============================================================================
# DEADLINE TYPE INFERENCE
# =============================================================================

TYPE_PATTERNS = {
    "abstract": ["abstract"],
    "paper": ["paper", "submission", "full paper", "main paper"],
    "supplementary": ["supplementary", "supplement", "supplemental"],
    "rebuttal": ["rebuttal", "response", "author response", "reviews released", "review period"],
    "notification": ["notification", "decision", "acceptance", "accept", "result"],
    "camera": ["camera", "camera-ready", "camera ready", "final version", "final paper"],
    "workshop": ["workshop"],
    "tutorial": ["tutorial"],
    "event": [
        "conference", "main event", "registration", "early registration",
        "cancellation", "enrollment", "profile", "expo", "meeting"
    ],
    "art": ["art"],
}


def infer_deadline_type(event_name: str) -> str:
    """
    Infer deadline type from event name.
    Uses pattern matching to categorize deadlines.
    """
    if not event_name:
        return "event"

    event_lower = event_name.lower()

    # Check patterns in priority order
    for dtype, patterns in TYPE_PATTERNS.items():
        for pattern in patterns:
            if pattern in event_lower:
                return dtype

    return "event"  # Default fallback


# =============================================================================
# DATE/TIME CONVERSION
# =============================================================================

def convert_date_time(date_str: Optional[str], time_str: Optional[str],
                      timezone_str: Optional[str]) -> str:
    """
    Convert date + time + timezone to ISO 8601 format.

    Input:  date="2025-11-13", time="23:59", timezone="AoE"
    Output: "2025-11-13T23:59:00-12:00"

    Input:  date="2025-11-13", time=None, timezone=None
    Output: "2025-11-13" (date-only for events without specific time)
    """
    if not date_str:
        return None

    # If no time specified, return date-only format
    if not time_str:
        return date_str

    # Normalize time to HH:MM:SS
    if len(time_str) == 5:  # HH:MM
        time_str = f"{time_str}:00"

    # Get timezone offset
    offset = timezone_to_offset(timezone_str)

    return f"{date_str}T{time_str}{offset}"


# =============================================================================
# LINK FLATTENING
# =============================================================================

def flatten_links(organized_links: Dict) -> Dict:
    """
    Convert organized scraper links to flat data.js format.

    Scraper format (organized by section):
    {
        "primary": {"official": "...", "submission_portal": "..."},
        "guidelines": {"author_guidelines": "..."},
        "calls": {"call_for_papers": "..."},
        "misc": {"registration": "..."}
    }

    data.js format (flat):
    {
        "official": "...",
        "submission": "...",
        "author": "...",  # maps from call_for_papers
        "template": "...",
        "authorGuide": "..."  # maps from author_guidelines
    }
    """
    result = {}

    # Handle both organized (scraper) and flat (legacy) formats
    if "primary" in organized_links:
        # Organized format from scraper
        primary = organized_links.get("primary", {})
        guidelines = organized_links.get("guidelines", {})
        calls = organized_links.get("calls", {})
        misc = organized_links.get("misc", {})

        # Primary links
        if primary.get("official"):
            result["official"] = primary["official"]
        if primary.get("submission_portal"):
            result["submission"] = primary["submission_portal"]
        if primary.get("latex_template"):
            result["template"] = primary["latex_template"]

        # Guidelines
        if guidelines.get("author_guidelines"):
            result["authorGuide"] = guidelines["author_guidelines"]
        if guidelines.get("reviewer_guidelines"):
            result["reviewerGuide"] = guidelines["reviewer_guidelines"]

        # Calls - note: call_for_papers maps to "author" in data.js (confusing but matches existing schema)
        if calls.get("call_for_papers"):
            result["author"] = calls["call_for_papers"]

        # Misc
        if misc.get("important_dates"):
            result["dates"] = misc["important_dates"]
        if misc.get("registration"):
            result["registration"] = misc["registration"]
        if misc.get("faq"):
            result["faq"] = misc["faq"]
    else:
        # Flat format (legacy or already converted)
        # Map scraper field names to data.js field names
        mapping = {
            "official": "official",
            "submission_portal": "submission",
            "latex_template": "template",
            "author_guidelines": "authorGuide",
            "reviewer_guidelines": "reviewerGuide",
            "call_for_papers": "author",  # Yes, this is the data.js naming
            "important_dates": "dates",
            "registration": "registration",
            "faq": "faq",
        }

        for scraper_key, datajs_key in mapping.items():
            if organized_links.get(scraper_key):
                result[datajs_key] = organized_links[scraper_key]

    return result


# =============================================================================
# INFO CONVERSION
# =============================================================================

def convert_info(scraper_info: Dict) -> Dict:
    """
    Convert scraper info to data.js info format.

    Input:  {"page_limit": 8, "page_limit_extra": "unlimited references", "review_type": "double-blind"}
    Output: {"pageLimit": "8 pages + unlimited references", "reviewType": "Double-blind"}
    """
    result = {}

    # Page limit
    page_limit = scraper_info.get("page_limit")
    page_limit_extra = scraper_info.get("page_limit_extra")

    if page_limit is not None:
        page_limit_str = f"{page_limit} pages"
        if page_limit_extra:
            page_limit_str = f"{page_limit_str} + {page_limit_extra}"
        result["pageLimit"] = page_limit_str

    # Review type (capitalize)
    review_type = scraper_info.get("review_type")
    if review_type:
        # Capitalize first letter
        result["reviewType"] = review_type.capitalize() if review_type else None

    # Submission format
    submission_format = scraper_info.get("submission_format")
    if submission_format:
        result["submissionFormat"] = submission_format

    # Copy any other fields from info.other
    other = scraper_info.get("other", {})
    for key, value in other.items():
        if value:
            # Convert snake_case to camelCase
            camel_key = snake_to_camel(key)
            result[camel_key] = value

    return result


def snake_to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase."""
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


# =============================================================================
# DEADLINE CONVERSION
# =============================================================================

def convert_deadlines(scraper_deadlines: List[Dict]) -> List[Dict]:
    """
    Convert scraper deadlines to data.js format.

    Input:
    [{"event": "Paper Submission", "date": "2025-11-13", "time": "23:59", "timezone": "AoE"}]

    Output:
    [{"type": "paper", "label": "Paper Submission", "date": "2025-11-13T23:59:00-12:00",
      "endDate": null, "status": "upcoming", "estimated": false}]
    """
    result = []

    for deadline in scraper_deadlines:
        if not isinstance(deadline, dict):
            continue

        event = deadline.get("event") or deadline.get("name")
        if not event:
            continue

        # Convert date/time
        date_iso = convert_date_time(
            deadline.get("date"),
            deadline.get("time"),
            deadline.get("timezone")
        )

        if not date_iso:
            continue

        converted = {
            "type": infer_deadline_type(event),
            "label": event,
            "date": date_iso,
            "endDate": None,  # Scraper doesn't capture date ranges yet
            "status": "upcoming",
            "estimated": False,  # Scraped data is considered accurate
        }

        result.append(converted)

    return result


# =============================================================================
# MAIN CONVERTER
# =============================================================================

def country_to_flag(country: str) -> str:
    """Convert country name to flag emoji."""
    if not country:
        return "🌍"  # Globe

    country_flags = {
        "usa": "🇺🇸",
        "united states": "🇺🇸",
        "us": "🇺🇸",
        "canada": "🇨🇦",
        "uk": "🇬🇧",
        "united kingdom": "🇬🇧",
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
        "czech republic": "🇨🇿",
        "greece": "🇬🇷",
        "portugal": "🇵🇹",
        "ireland": "🇮🇪",
        "china": "🇨🇳",
        "japan": "🇯🇵",
        "south korea": "🇰🇷",
        "korea": "🇰🇷",
        "india": "🇮🇳",
        "singapore": "🇸🇬",
        "australia": "🇦🇺",
        "new zealand": "🇳🇿",
        "brazil": "🇧🇷",
        "mexico": "🇲🇽",
        "argentina": "🇦🇷",
        "thailand": "🇹🇭",
        "vietnam": "🇻🇳",
        "malaysia": "🇲🇾",
        "indonesia": "🇮🇩",
        "philippines": "🇵🇭",
        "taiwan": "🇹🇼",
        "hong kong": "🇭🇰",
        "israel": "🇮🇱",
        "uae": "🇦🇪",
        "united arab emirates": "🇦🇪",
        "south africa": "🇿🇦",
        "egypt": "🇪🇬",
        "russia": "🇷🇺",
    }

    return country_flags.get(country.lower(), "🌍")


def build_location(scraper_data: Dict, meta: Dict) -> Dict:
    """
    Build location object, preferring scraped data over metadata.
    """
    scraped_loc = scraper_data.get("location", {}) or {}
    meta_loc = meta.get("location", {}) or {}

    # Prefer scraped data, fall back to metadata
    city = scraped_loc.get("city") or meta_loc.get("city") or "TBD"
    country = scraped_loc.get("country") or meta_loc.get("country") or "TBD"
    venue = scraped_loc.get("venue") or meta_loc.get("venue")

    # If scraped country differs from metadata, derive flag from new country
    # Otherwise use metadata flag
    scraped_country = scraped_loc.get("country")
    meta_country = meta_loc.get("country")

    if scraped_country and scraped_country.lower() != (meta_country or "").lower():
        # Country changed - derive new flag
        flag = country_to_flag(scraped_country)
    else:
        # Use metadata flag or derive from country
        flag = meta_loc.get("flag") or country_to_flag(country)

    return {
        "city": city,
        "country": country,
        "flag": flag,
        "venue": venue
    }


def convert_scraper_to_datajs(scraper_data: Dict, metadata: Dict = None) -> Dict:
    """
    Convert scraper output to data.js conference format.

    Args:
        scraper_data: Output from scraper.py
        metadata: Static metadata from conference_metadata.json

    Returns:
        Conference object in data.js format
    """
    conference_name = scraper_data.get("conference", "Unknown")
    year = scraper_data.get("year", 2026)

    # Generate ID
    conf_id = f"{conference_name.lower()}-{year}"

    # Get metadata if available
    meta = {}
    if metadata:
        # Try to find metadata by conference name (case-insensitive)
        for key, value in metadata.items():
            if key.lower() == conference_name.lower():
                meta = value
                break

    # Build result
    result = {
        "id": conf_id,
        "name": conference_name,
        "fullName": meta.get("fullName", conference_name),
        "year": year,
        "category": meta.get("category", "other"),
        "website": extract_website(scraper_data),
        "brandColor": meta.get("brandColor", "#808080"),
        "location": build_location(scraper_data, meta),
        "deadlines": convert_deadlines(scraper_data.get("deadlines", [])),
        "links": flatten_links(scraper_data.get("links", {})),
        "info": convert_info(scraper_data.get("info", {})),
    }

    # Add desk reject reasons if present
    desk_rejects = scraper_data.get("desk_reject_reasons", [])
    if desk_rejects:
        result["deskRejectReasons"] = desk_rejects

    # Add notes (empty array, can be populated manually)
    result["notes"] = []

    return result


def extract_website(scraper_data: Dict) -> str:
    """Extract website URL from scraper data."""
    links = scraper_data.get("links", {})

    # Try organized format first
    if "primary" in links:
        official = links.get("primary", {}).get("official")
        if official:
            return official

    # Try flat format
    if links.get("official"):
        return links["official"]

    return ""


# =============================================================================
# FILE OPERATIONS
# =============================================================================

def load_metadata(metadata_path: Optional[str] = None) -> Dict:
    """Load conference metadata from JSON file."""
    if metadata_path and os.path.exists(metadata_path):
        with open(metadata_path, "r") as f:
            return json.load(f)

    # Try default location
    script_dir = Path(__file__).parent
    default_path = script_dir / "conference_metadata.json"

    if default_path.exists():
        with open(default_path, "r") as f:
            return json.load(f)

    return {}


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Convert scraper JSON output to data.js format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python scripts/scraper_to_datajs.py /tmp/cvpr.json
    python scripts/scraper_to_datajs.py /tmp/cvpr.json --output /tmp/cvpr_converted.json
    python scripts/scraper_to_datajs.py /tmp/cvpr.json --metadata scripts/conference_metadata.json
"""
    )
    parser.add_argument("input", help="Input JSON file from scraper")
    parser.add_argument("--output", "-o", help="Output JSON file (prints to stdout if not specified)")
    parser.add_argument("--metadata", "-m", help="Path to conference_metadata.json")
    parser.add_argument("--pretty", "-p", action="store_true", help="Pretty print JSON output")

    args = parser.parse_args()

    # Load input
    with open(args.input, "r") as f:
        scraper_data = json.load(f)

    # Load metadata
    metadata = load_metadata(args.metadata)

    # Convert
    result = convert_scraper_to_datajs(scraper_data, metadata)

    # Output
    indent = 2 if args.pretty else None
    json_output = json.dumps(result, indent=indent, ensure_ascii=False)

    if args.output:
        with open(args.output, "w") as f:
            f.write(json_output)
        print(f"Converted output saved to {args.output}")
    else:
        print(json_output)


if __name__ == "__main__":
    main()
