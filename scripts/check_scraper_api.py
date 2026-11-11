#!/usr/bin/env python3
"""Check configured extraction providers before starting a conference refresh."""

import os
import sys

from scraper import ConferenceScraper, ScraperAPIError


def main():
    for provider, key in (("gemini", "GEMINI_API_KEY"), ("openrouter", "OPENROUTER_API_KEY")):
        if not os.environ.get(key):
            continue
        try:
            scraper = ConferenceScraper(verbose=False, use_gemini=provider == "gemini")
            response = scraper.call_llm('Return only this JSON object: {"ok": true}')
            result = scraper.parse_llm_response(response)
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise ScraperAPIError("Provider returned an invalid preflight response")
        except Exception as error:
            print(f"::warning::{provider} preflight failed: {error}", file=sys.stderr)
            continue
        print(f"Extraction provider ready: {provider}")
        if os.environ.get("GITHUB_ENV"):
            with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as handle:
                handle.write(f"PAPERRUSH_SCRAPER_PROVIDER={provider}\n")
        return 0
    print("ERROR: No configured extraction provider passed preflight", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
