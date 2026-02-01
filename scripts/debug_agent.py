#!/usr/bin/env python3
"""
Debug script for agentic conference scraper

Usage:
    python scripts/debug_agent.py cvpr
    python scripts/debug_agent.py icml
    python scripts/debug_agent.py --url "https://someconference.org/2026"
"""

import os
import sys
import json

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_scraper import AgentScraper

# Known conference base URLs
CONFERENCES = {
    "cvpr": {
        "name": "CVPR 2026",
        "url": "https://cvpr.thecvf.com/Conferences/2026"
    },
    "iccv": {
        "name": "ICCV 2025",
        "url": "https://iccv.thecvf.com/Conferences/2025"
    },
    "eccv": {
        "name": "ECCV 2026",
        "url": "https://eccv.ecva.net/Conferences/2026"
    },
    "neurips": {
        "name": "NeurIPS 2025",
        "url": "https://neurips.cc/Conferences/2025"
    },
    "icml": {
        "name": "ICML 2025",
        "url": "https://icml.cc/Conferences/2025"
    },
    "iclr": {
        "name": "ICLR 2026",
        "url": "https://iclr.cc/Conferences/2026"
    },
    "aaai": {
        "name": "AAAI 2026",
        "url": "https://aaai.org/conference/aaai/aaai-26/"
    },
    "acl": {
        "name": "ACL 2025",
        "url": "https://2025.aclweb.org/"
    },
    "emnlp": {
        "name": "EMNLP 2025",
        "url": "https://2025.emnlp.org/"
    },
    "naacl": {
        "name": "NAACL 2025",
        "url": "https://2025.naacl.org/"
    },
    "interspeech": {
        "name": "INTERSPEECH 2025",
        "url": "https://www.interspeech2025.org/"
    },
    "icassp": {
        "name": "ICASSP 2026",
        "url": "https://2026.ieeeicassp.org/"
    },
}


def print_section(title):
    print(f"\n{'='*60}")
    print(f" {title}")
    print('='*60)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Debug agentic conference scraper")
    parser.add_argument("conference", nargs="?", help="Conference name (cvpr, icml, neurips, etc.) or use --url")
    parser.add_argument("--url", type=str, help="Custom conference URL")
    parser.add_argument("--name", type=str, help="Conference name (required with --url)")
    parser.add_argument("--max-steps", type=int, default=10, help="Max pages to visit (default: 10)")
    parser.add_argument("--no-seed", action="store_true", help="Disable auto URL seeding")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show detailed extraction info")
    args = parser.parse_args()

    # Determine conference info
    if args.url:
        if not args.name:
            print("❌ --name required when using --url")
            sys.exit(1)
        conf_name = args.name
        conf_url = args.url
    elif args.conference:
        conf_key = args.conference.lower()
        if conf_key not in CONFERENCES:
            print(f"❌ Unknown conference: {args.conference}")
            print(f"   Known: {', '.join(CONFERENCES.keys())}")
            print(f"   Or use: --url <url> --name <name>")
            sys.exit(1)
        conf_name = CONFERENCES[conf_key]["name"]
        conf_url = CONFERENCES[conf_key]["url"]
    else:
        print("❌ Provide conference name or --url")
        print(f"   Known conferences: {', '.join(CONFERENCES.keys())}")
        parser.print_help()
        sys.exit(1)

    # Check API key
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("❌ OPENROUTER_API_KEY not set")
        print("   Run: export $(grep -v '^#' .env | xargs)")
        sys.exit(1)

    print_section(f"🔍 DEBUGGING: {conf_name}")
    print(f"URL: {conf_url}")
    print(f"Max steps: {args.max_steps}")
    print(f"Auto-seed: {not args.no_seed}")
    print(f"Verbose: {args.verbose}")

    # Run scraper
    scraper = AgentScraper()
    result = scraper.scrape(
        conference=conf_name,
        start_urls=[conf_url],
        max_steps=args.max_steps,
        auto_seed=not args.no_seed,
        verbose=args.verbose
    )

    # Display results
    print_section("📋 EXTRACTED LINKS")
    links = result.get("links", {})

    print(f"\n🔗 Key Links:")
    print(f"   Official:     {links.get('official', 'Not found')}")
    print(f"   Submission:   {links.get('submission', 'Not found')}")
    print(f"   Template:     {links.get('template', 'Not found')}")
    print(f"   Registration: {links.get('registration', 'Not found')}")

    print(f"\n📚 Guides:")
    guides = links.get("guides", {})
    if guides:
        for name, url in guides.items():
            print(f"   {name}: {url}")
    else:
        print("   (none found)")

    print(f"\n📢 Calls:")
    calls = links.get("calls", {})
    if calls:
        for name, url in calls.items():
            print(f"   {name}: {url}")
    else:
        print("   (none found)")

    print(f"\n📎 Misc:")
    misc = links.get("misc", [])
    if misc:
        for url in misc[:10]:
            print(f"   - {url}")
    else:
        print("   (none)")

    print_section("🚫 DESK REJECT REASONS")
    reasons = result.get("desk_reject_reasons", [])
    if reasons:
        for i, reason in enumerate(reasons, 1):
            print(f"   {i}. {reason}")
    else:
        print("   (none found)")

    print_section("📊 INFO")
    info = result.get("info", {})
    if info:
        print(json.dumps(info, indent=2))
    else:
        print("   (none)")

    # Full JSON output
    print_section("📄 FULL JSON OUTPUT")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
