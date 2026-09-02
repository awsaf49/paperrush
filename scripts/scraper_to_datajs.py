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
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path
from zoneinfo import ZoneInfo


# =============================================================================
# TIMEZONE CONVERSION
# =============================================================================

TIMEZONE_OFFSETS = {
    # Standard offsets
    "AOE": "-12:00",      # Anywhere on Earth
    "UTC": "+00:00",
    "GMT": "+00:00",

    # US timezones
    "PST": "-08:00",      # Pacific Standard
    "PDT": "-07:00",      # Pacific Daylight
    "MST": "-07:00",      # Mountain Standard
    "MDT": "-06:00",      # Mountain Daylight
    "CST": "-06:00",      # Central Standard
    "CDT": "-05:00",      # Central Daylight
    "EST": "-05:00",      # Eastern Standard
    "EDT": "-04:00",      # Eastern Daylight

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


GENERIC_TIMEZONES = {
    "PT": "America/Los_Angeles",
    "MT": "America/Denver",
    "CT": "America/Chicago",
    "ET": "America/New_York",
}


def timezone_to_offset(tz: Optional[str], date_str: Optional[str] = None) -> Optional[str]:
    """
    Convert timezone abbreviation to UTC offset.
    Return None rather than inventing a timezone when it is unspecified.
    """
    if not tz:
        return None

    tz_upper = tz.upper().strip()
    if tz_upper in TIMEZONE_OFFSETS:
        return TIMEZONE_OFFSETS[tz_upper]

    zone_name = GENERIC_TIMEZONES.get(tz_upper)
    if zone_name and date_str:
        try:
            local_date = datetime.fromisoformat(date_str).replace(tzinfo=ZoneInfo(zone_name))
            offset = local_date.strftime("%z")
            return f"{offset[:3]}:{offset[3:]}"
        except (ValueError, KeyError):
            return None

    return None


# =============================================================================
# DEADLINE TYPE INFERENCE
# =============================================================================

def infer_deadline_type(event_name: str) -> str:
    """
    Infer deadline type from event name.
    Uses pattern matching to categorize deadlines.
    """
    if not event_name:
        return "event"

    label = event_name.lower().strip()

    # Specific lifecycle stages must win over generic words such as "paper"
    # and "submission" (for example, "Paper Acceptance Notification").
    if re.search(r"camera[ -]?ready|final (version|manuscript)", label):
        return "camera"
    if re.search(r"notification|decision|acceptance|accepted|rejection|results? released", label):
        return "notification"
    if re.search(r"rebuttal|author response|author feedback|reviews released", label):
        return "rebuttal"
    if "workshop" in label:
        return "workshop"
    if "tutorial" in label:
        return "tutorial"
    if re.search(r"paper (and|&) supplement.*submission", label):
        return "paper"
    if re.search(r"supplement|video submission", label):
        return "supplementary"
    if re.search(r"poster submission", label):
        return "event"
    if "abstract" in label or re.search(r"paper (registration|enrollment)", label):
        return "abstract"
    if re.search(r"paper|submission", label):
        return "paper"
    if re.fullmatch(r"(main )?conference( dates?)?", label):
        return "conference"
    return "event"


# =============================================================================
# DATE/TIME CONVERSION
# =============================================================================

def convert_date_time(date_str: Optional[str], time_str: Optional[str],
                      timezone_str: Optional[str]) -> str:
    """
    Convert date + time + timezone to ISO 8601 format.

    Input:  date="2025-11-13", time="23:59", timezone="AoE"
    Output: "2025-11-13T23:59:00-12:00"

    Input:  date="2025-11-13", time=None, timezone="AoE"
    Output: "2025-11-13T23:59:00-12:00" (default to end of day)

    Input:  date="2025-11-13", time=None, timezone=None
    Output: "2025-11-13T23:59:00-12:00" (default to AoE for deadlines)
    """
    if not date_str:
        return None

    # A date without a published time or timezone remains date-only. Guessing
    # AoE creates a false twelve-hour precision window.
    if not time_str:
        return date_str
    if len(time_str) == 5:  # HH:MM
        time_str = f"{time_str}:00"

    offset = timezone_to_offset(timezone_str, date_str)
    if not offset:
        return date_str

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

def normalize_label_for_dedup(label: str) -> str:
    """Normalize label for deduplication comparison."""
    if not label:
        return ""

    # Lowercase and remove common variations
    normalized = label.lower()

    # Common replacements to normalize similar labels
    replacements = [
        ("abstracts due", "abstract"),
        ("abstract submission", "abstract"),
        ("full papers due", "paper"),
        ("full paper due", "paper"),
        ("paper submission", "paper"),
        ("papers due", "paper"),
        ("supplementary material and code due", "supplementary"),
        ("supplementary material and code", "supplementary"),
        ("supplementary materials", "supplementary"),
        ("camera-ready", "camera"),
        ("camera ready", "camera"),
        ("notification of final acceptance or rejection", "final notification"),
        ("notification of acceptance or rejection", "final notification"),
        ("notification of phase 1 rejections", "phase1 notification"),
        ("author feedback window", "rebuttal"),
        ("rebuttal period", "rebuttal"),
        ("submission of camera-ready files", "camera"),
    ]

    for old, new in replacements:
        if old in normalized:
            return new

    return normalized


def extract_date_only(date_iso: str) -> str:
    """Extract just the date portion from an ISO date string."""
    if not date_iso:
        return ""
    # Handle both "2025-08-01" and "2025-08-01T23:59:00-12:00"
    return date_iso[:10]


PRIMARY_EXCLUSIONS = (
    "workshop", "tutorial", "demo", "dataset", "benchmark", "position",
    "art ", "art submission", "education", "industry", "doctoral",
    "student", "competition", "affinity", "show and tell", "social",
    "reviewer", "review", "bidding", "camera", "notification", "decision",
    "rebuttal", "conference", "journal", "presentation request", "one-page",
    "late breaking", "revision", "poster",
)


def is_primary_submission_type(deadline: Dict) -> bool:
    """Identify main-track paper and abstract milestones only."""
    if deadline.get("type") not in {"paper", "abstract"}:
        return False
    label = deadline.get("label", "").lower()
    return not any(term in label for term in PRIMARY_EXCLUSIONS)


def canonical_instant(date_iso: str) -> str:
    """Normalize equivalent timezone representations for deduplication."""
    if not date_iso or "T" not in date_iso:
        return date_iso or ""
    try:
        return datetime.fromisoformat(date_iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return date_iso


def deadline_quality(deadline: Dict) -> float:
    """Prefer explicit, official-looking records when duplicates collide."""
    score = 0 if deadline.get("estimated") else 4
    if "T" in deadline.get("date", ""):
        score += 4
    if deadline.get("endDate"):
        score += 1
    return score - len(deadline.get("label", "")) / 1000


def normalize_datajs_deadlines(deadlines: List[Dict]) -> List[Dict]:
    """Reclassify and deduplicate existing data.js deadline records."""
    best_by_key = {}
    for original in deadlines or []:
        deadline = original.copy()
        label = deadline.get("label", "")
        inferred = infer_deadline_type(label)
        if deadline.get("type") == "conference" or (
            deadline.get("type") == "event"
            and deadline.get("endDate")
            and re.search(r"conference|annual meeting|main event", label, re.I)
        ):
            inferred = "conference"
        deadline["type"] = inferred

        instant = canonical_instant(deadline.get("date", ""))
        if not instant:
            continue
        semantic = (
            inferred
            if is_primary_submission_type(deadline)
            else f"{inferred}:{normalize_label_for_dedup(label)}"
        )
        key = (semantic, instant)
        existing = best_by_key.get(key)
        if not existing or deadline_quality(deadline) > deadline_quality(existing):
            best_by_key[key] = deadline

    return sorted(best_by_key.values(), key=lambda item: item.get("date", ""))


def convert_deadlines(scraper_deadlines: List[Dict]) -> List[Dict]:
    """
    Convert scraper deadlines to data.js format with deduplication.

    Input:
    [{"event": "Paper Submission", "date": "2025-11-13", "time": "23:59", "timezone": "AoE"}]

    Output:
    [{"type": "paper", "label": "Paper Submission", "date": "2025-11-13T23:59:00-12:00",
      "endDate": null, "status": "upcoming", "estimated": false}]

    Deduplication strategy:
    - Group by normalized label + date (within 3 days)
    - Keep the version with more detail (time > no time)
    - Prefer official-sounding labels over informal ones
    """
    # First pass: convert all deadlines
    converted_list = []

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
            "_has_time": "T" in date_iso,  # Track if has time for preference
            "_normalized": normalize_label_for_dedup(event),
            "_date_only": extract_date_only(date_iso),
        }
        if "T" not in date_iso:
            converted["timeUnknown"] = True

        converted_list.append(converted)

    # Deduplicate equivalent labels and exact primary milestones, including the
    # same instant represented once in local time and once in UTC.
    final_seen = {}
    for deadline in converted_list:
        semantic = (
            deadline["type"]
            if is_primary_submission_type(deadline)
            else f"{deadline['type']}:{deadline['_normalized']}"
        )
        key = (semantic, canonical_instant(deadline["date"]))
        existing = final_seen.get(key)
        if not existing or deadline_quality(deadline) > deadline_quality(existing):
            final_seen[key] = deadline

    # Clean up internal fields and sort by date
    result = []
    for deadline in final_seen.values():
        clean = {k: v for k, v in deadline.items() if not k.startswith("_")}
        result.append(clean)

    # Sort by date
    result.sort(key=lambda x: x.get("date", ""))

    return result


def convert_conference_event(scraper_data: Dict) -> Optional[Dict]:
    """Convert explicitly structured conference dates into an event range."""
    location = scraper_data.get("location") or {}
    conference_dates = scraper_data.get("conference_dates") or {}
    start_date = conference_dates.get("start_date") or location.get("start_date")
    end_date = conference_dates.get("end_date") or location.get("end_date")

    if not start_date or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(start_date)):
        return None
    if end_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(end_date)):
        end_date = None

    return {
        "type": "conference",
        "label": "Main Conference",
        "date": start_date,
        "endDate": end_date,
        "status": "upcoming",
        "estimated": False,
        "timeUnknown": True,
    }


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
    Build an edition-specific location from scraped official data only.

    Conference series metadata is timeless; keeping a city there silently
    carries an old venue into a new edition when scraping misses the field.
    """
    scraped_loc = scraper_data.get("location", {}) or {}
    city = scraped_loc.get("city") or "TBD"
    country = scraped_loc.get("country") or "TBD"
    venue = scraped_loc.get("venue")
    flag = country_to_flag(country)

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

    deadlines = convert_deadlines(scraper_data.get("deadlines", []))
    conference_event = convert_conference_event(scraper_data)
    if conference_event and not any(
        deadline.get("type") == "conference" for deadline in deadlines
    ):
        deadlines.append(conference_event)
        deadlines.sort(key=lambda item: item.get("date", ""))

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
        "deadlines": deadlines,
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
