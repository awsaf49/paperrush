#!/usr/bin/env python3
"""
Conference Deadline Updater

This script:
1. Loads existing conference data (preserves as fallback)
2. Fetches each conference's official webpage
3. Uses Gemini to extract deadline information
4. Merges new data with existing data (preserves data on failure)
5. Updates the JavaScript data file

Execution: Runs weekly via GitHub Actions
"""

import os
import re
import json
import time
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any
from pathlib import Path
from html.parser import HTMLParser

# OpenRouter API (OpenAI-compatible)
from openai import OpenAI


class HTMLTextExtractor(HTMLParser):
    """Extract readable text from HTML, skipping scripts/styles"""
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip = False
        self.skip_tags = {'script', 'style', 'nav', 'footer', 'header', 'meta', 'link'}

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.skip_tags:
            self.skip = True

    def handle_endtag(self, tag):
        if tag.lower() in self.skip_tags:
            self.skip = False

    def handle_data(self, data):
        if not self.skip:
            text = data.strip()
            if text:
                self.text.append(text)

    def get_text(self):
        return ' '.join(self.text)


def html_to_text(html: str) -> str:
    """Convert HTML to plain text"""
    try:
        parser = HTMLTextExtractor()
        parser.feed(html)
        text = parser.get_text()
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        return text
    except:
        # Fallback: just strip tags
        return re.sub(r'<[^>]+>', ' ', html)

# ============================================
# CONFERENCE CONFIGURATION
# All 19 conferences with their URL patterns
# ============================================
CONFERENCES_CONFIG = [
    # ----- MACHINE LEARNING -----
    {
        "id": "icml",
        "name": "ICML",
        "fullName": "International Conference on Machine Learning",
        "category": "ml",
        "website": "https://icml.cc/",
        "brandColor": "#1E3A5F",
        "urls": [
            "https://icml.cc/Conferences/{year}",
            "https://icml.cc/Conferences/{year}/Dates",
            "https://icml.cc/Conferences/{year}/CallForPapers"
        ]
    },
    {
        "id": "iclr",
        "name": "ICLR",
        "fullName": "International Conference on Learning Representations",
        "category": "ml",
        "website": "https://iclr.cc/",
        "brandColor": "#008B8B",
        "urls": [
            "https://iclr.cc/Conferences/{year}",
            "https://iclr.cc/Conferences/{year}/Dates",
            "https://iclr.cc/Conferences/{year}/CallForPapers"
        ]
    },
    {
        "id": "neurips",
        "name": "NeurIPS",
        "fullName": "Conference on Neural Information Processing Systems",
        "category": "ml",
        "website": "https://neurips.cc/",
        "brandColor": "#6B2D73",
        "urls": [
            "https://neurips.cc/Conferences/{year}",
            "https://neurips.cc/Conferences/{year}/Dates",
            "https://neurips.cc/Conferences/{year}/CallForPapers"
        ]
    },
    {
        "id": "aaai",
        "name": "AAAI",
        "fullName": "AAAI Conference on Artificial Intelligence",
        "category": "ml",
        "website": "https://aaai.org/",
        "brandColor": "#003366",
        "urls": [
            "https://aaai.org/conference/aaai/aaai-{short_year}/",
            "https://aaai.org/conference/aaai/aaai-{short_year}/aaai-{short_year}-call-for-papers/"
        ]
    },
    {
        "id": "aistats",
        "name": "AISTATS",
        "fullName": "International Conference on AI and Statistics",
        "category": "ml",
        "website": "https://aistats.org/",
        "brandColor": "#2E5984",
        "urls": [
            "https://aistats.org/aistats{year}/",
            "https://aistats.org/aistats{year}/call-for-papers.html"
        ]
    },
    {
        "id": "ijcai",
        "name": "IJCAI",
        "fullName": "International Joint Conference on AI",
        "category": "ml",
        "website": "https://ijcai.org/",
        "brandColor": "#C41E3A",
        "urls": [
            "https://ijcai-{short_year}.org/",
            "https://ijcai-{short_year}.org/call-for-papers/"
        ]
    },

    # ----- COMPUTER VISION -----
    {
        "id": "cvpr",
        "name": "CVPR",
        "fullName": "Computer Vision and Pattern Recognition",
        "category": "cv",
        "website": "https://cvpr.thecvf.com/",
        "brandColor": "#CC0000",
        "urls": [
            "https://cvpr.thecvf.com/Conferences/{year}",
            "https://cvpr.thecvf.com/Conferences/{year}/Dates",
            "https://cvpr.thecvf.com/Conferences/{year}/CallForPapers"
        ]
    },
    {
        "id": "eccv",
        "name": "ECCV",
        "fullName": "European Conference on Computer Vision",
        "category": "cv",
        "website": "https://eccv.ecva.net/",
        "brandColor": "#2E8B57",
        "urls": [
            "https://eccv{year}.ecva.net/",
            "https://eccv.ecva.net/Conferences/{year}"
        ]
    },
    {
        "id": "iccv",
        "name": "ICCV",
        "fullName": "International Conference on Computer Vision",
        "category": "cv",
        "website": "https://iccv.thecvf.com/",
        "brandColor": "#0066CC",
        "urls": [
            "https://iccv{year}.thecvf.com/",
            "https://iccv.thecvf.com/Conferences/{year}"
        ]
    },
    {
        "id": "wacv",
        "name": "WACV",
        "fullName": "Winter Conference on Applications of Computer Vision",
        "category": "cv",
        "website": "https://wacv2026.thecvf.com/",
        "brandColor": "#4A90A4",
        "urls": [
            "https://wacv{year}.thecvf.com/"
        ]
    },

    # ----- NLP -----
    {
        "id": "acl",
        "name": "ACL",
        "fullName": "Annual Meeting of the ACL",
        "category": "nlp",
        "website": "https://www.aclweb.org/",
        "brandColor": "#FF6600",
        "urls": [
            "https://{year}.aclweb.org/",
            "https://{year}.aclweb.org/calls/main_conference_papers/"
        ]
    },
    {
        "id": "emnlp",
        "name": "EMNLP",
        "fullName": "Empirical Methods in Natural Language Processing",
        "category": "nlp",
        "website": "https://www.aclweb.org/",
        "brandColor": "#228B22",
        "urls": [
            "https://{year}.emnlp.org/",
            "https://emnlp.org/{year}/"
        ]
    },
    {
        "id": "naacl",
        "name": "NAACL",
        "fullName": "North American Chapter of the ACL",
        "category": "nlp",
        "website": "https://naacl.org/",
        "brandColor": "#9932CC",
        "urls": [
            "https://{year}.naacl.org/",
            "https://naacl.org/naacl{year}/"
        ]
    },

    # ----- SPEECH & SIGNAL -----
    {
        "id": "interspeech",
        "name": "Interspeech",
        "fullName": "Annual Conference of ISCA",
        "category": "speech",
        "website": "https://www.interspeech2025.org/",
        "brandColor": "#E67E22",
        "urls": [
            "https://www.interspeech{year}.org/",
            "https://interspeech{year}.org/"
        ]
    },
    {
        "id": "icassp",
        "name": "ICASSP",
        "fullName": "IEEE Conference on Acoustics, Speech, and Signal Processing",
        "category": "speech",
        "website": "https://2026.ieeeicassp.org/",
        "brandColor": "#FF8C00",
        "urls": [
            "https://{year}.ieeeicassp.org/",
            "https://ieeeicassp{year}.org/"
        ]
    },

    # ----- OTHER -----
    {
        "id": "kdd",
        "name": "KDD",
        "fullName": "Knowledge Discovery and Data Mining",
        "category": "other",
        "website": "https://kdd.org/",
        "brandColor": "#CC0066",
        "urls": [
            "https://kdd.org/kdd{year}/",
            "https://kdd{year}.kdd.org/"
        ]
    },
    {
        "id": "siggraph",
        "name": "SIGGRAPH",
        "fullName": "ACM SIGGRAPH Annual Conference",
        "category": "other",
        "website": "https://s2026.siggraph.org/",
        "brandColor": "#1ABC9C",
        "urls": [
            "https://s{year}.siggraph.org/",
            "https://www.siggraph.org/siggraph-{year}/"
        ]
    },
    {
        "id": "miccai",
        "name": "MICCAI",
        "fullName": "Medical Image Computing and Computer Assisted Intervention",
        "category": "other",
        "website": "https://miccai.org/",
        "brandColor": "#FF2D55",
        "urls": [
            "https://conferences.miccai.org/{year}/",
            "https://miccai{year}.org/"
        ]
    },
    {
        "id": "mlsys",
        "name": "MLSys",
        "fullName": "Conference on Machine Learning and Systems",
        "category": "other",
        "website": "https://mlsys.org/",
        "brandColor": "#34495E",
        "urls": [
            "https://mlsys.org/Conferences/{year}",
            "https://mlsys.org/"
        ]
    }
]

# Gemini prompt template - improved for better JSON extraction
EXTRACTION_PROMPT = """You are extracting academic conference deadline information from a webpage.

CONFERENCE: {conference_name} ({conference_full_name})
TARGET YEAR: {target_year}

WEBPAGE CONTENT:
{webpage_content}

Extract ALL deadline and location information for {conference_name} {target_year}.

Return ONLY a valid JSON object with this EXACT structure (no markdown, no explanation):

{{
  "location": {{
    "city": "City name or null",
    "country": "Country name or null",
    "flag": "Country flag emoji or null",
    "venue": "Venue name or null"
  }},
  "deadlines": [
    {{
      "type": "abstract|paper|supplementary|notification|rebuttal|camera|event",
      "label": "Human readable label",
      "date": "YYYY-MM-DDTHH:MM:SS-12:00",
      "endDate": "YYYY-MM-DD (only for event type)",
      "status": "upcoming",
      "estimated": false
    }}
  ],
  "links": {{
    "official": "Main conference URL",
    "author": "Call for papers URL or null",
    "submission": "Submission portal URL or null",
    "template": "LaTeX template URL or null"
  }},
  "info": {{
    "pageLimit": "e.g. 9 pages or null",
    "reviewType": "e.g. Double-blind or null",
    "acceptanceRate": "e.g. ~25% or null"
  }},
  "confidence": 0.9
}}

RULES:
1. Use AoE timezone (UTC-12), offset -12:00 for all times
2. If time not specified, use 23:59:00
3. Set estimated: true if date is uncertain or from previous years
4. For event type, include both date and endDate
5. Return ONLY valid JSON - no markdown code blocks, no explanation text
6. If no information found, return empty arrays/null values but valid JSON structure
"""


class ConferenceUpdater:
    def __init__(self, existing_data_path: str = "js/data.js"):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable not set")

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        self.model = "google/gemini-2.0-flash-001"  # Free model on OpenRouter
        self.existing_data = self._load_existing_data(existing_data_path)
        self.results = []

    def _load_existing_data(self, path: str) -> Dict[str, Any]:
        """Load existing conference data as fallback"""
        try:
            if not Path(path).exists():
                print(f"  ℹ️ No existing data file found at {path}")
                return {}

            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Extract the conferences array from JavaScript file
            # Look for the conferences array specifically
            match = re.search(r'conferences:\s*\[([\s\S]*?)\]\s*\}', content)
            if not match:
                print(f"  ⚠️ Could not find conferences array in {path}")
                return {}

            # For JS object notation, we need a more robust approach
            # Let's just extract IDs and basic info using regex
            indexed = {}

            # Find each conference block
            conf_pattern = r'\{\s*id:\s*"([^"]+)"[^}]*name:\s*"([^"]+)"[^}]*year:\s*(\d+)[^}]*category:\s*"([^"]+)"'

            for m in re.finditer(conf_pattern, content):
                conf_id = m.group(1)
                # Store minimal info - we'll merge with extracted data
                indexed[conf_id] = {"id": conf_id, "_exists": True}

            if indexed:
                print(f"  ✅ Loaded {len(indexed)} existing conference IDs as fallback")
            return indexed

        except Exception as e:
            print(f"  ⚠️ Could not load existing data: {e}")
        return {}

    def fetch_webpage(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch webpage content with error handling"""
        try:
            print(f"    🌐 Fetching: {url}")
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            response.raise_for_status()
            print(f"    ✅ Got {len(response.text)} chars")
            return response.text
        except Exception as e:
            print(f"    ❌ Failed: {type(e).__name__}")
            return None

    def _clean_json_response(self, text: str) -> str:
        """Clean Gemini response to extract valid JSON"""
        text = text.strip()

        # Remove markdown code blocks
        if text.startswith("```"):
            text = re.sub(r"```json?\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text)

        # Find JSON object boundaries
        start = text.find("{")
        end = text.rfind("}") + 1

        if start != -1 and end > start:
            text = text[start:end]

        return text.strip()

    def extract_with_llm(self, conf: Dict, content: str, year: int, retry_count: int = 2, verbose: bool = True) -> Optional[Dict]:
        """Use LLM (via OpenRouter) to extract deadline information with retry logic"""
        for attempt in range(retry_count):
            try:
                prompt = EXTRACTION_PROMPT.format(
                    conference_name=conf["name"],
                    conference_full_name=conf["fullName"],
                    target_year=year,
                    webpage_content=content[:15000]  # Limit content length
                )

                if verbose:
                    print(f"    📤 Sending to {self.model} ({len(content)} chars of webpage content)...")

                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    max_tokens=2000
                )

                raw_response = response.choices[0].message.content
                if verbose:
                    print(f"    📥 LLM response ({len(raw_response)} chars):")
                    print(f"    ---RAW OUTPUT START---")
                    print(raw_response[:1500] + ("..." if len(raw_response) > 1500 else ""))
                    print(f"    ---RAW OUTPUT END---")

                # Clean and parse JSON
                text = self._clean_json_response(raw_response)
                result = json.loads(text)

                # Validate required structure
                if not isinstance(result, dict):
                    raise ValueError("Response is not a JSON object")

                if verbose:
                    print(f"    ✅ Parsed successfully: {len(result.get('deadlines', []))} deadlines found")

                return result

            except json.JSONDecodeError as e:
                print(f"    ⚠️ JSON parse error (attempt {attempt + 1}/{retry_count}): {e}")
                if attempt < retry_count - 1:
                    time.sleep(1)
            except Exception as e:
                print(f"    ⚠️ LLM error (attempt {attempt + 1}/{retry_count}): {e}")
                if attempt < retry_count - 1:
                    time.sleep(1)

        return None

    def _merge_conference_data(self, conf_id: str, extracted: Dict, conf: Dict, year: int) -> Dict:
        """Merge extracted data with existing data, preserving good data"""
        existing = self.existing_data.get(conf_id, {})

        # Start with base info
        result = {
            "id": conf_id,
            "name": conf["name"],
            "fullName": conf["fullName"],
            "year": year,
            "category": conf["category"],
            "website": conf["website"],
            "brandColor": conf["brandColor"],
        }

        # Location: prefer extracted if available, else use existing
        extracted_location = extracted.get("location", {})
        existing_location = existing.get("location", {})

        if extracted_location.get("city") and extracted_location.get("city") != "null":
            result["location"] = extracted_location
        elif existing_location:
            result["location"] = existing_location
        else:
            result["location"] = {"city": "TBD", "country": "TBD", "flag": "🌍", "venue": "TBD"}

        # Deadlines: prefer extracted if non-empty, else use existing
        extracted_deadlines = extracted.get("deadlines", [])
        existing_deadlines = existing.get("deadlines", [])

        if extracted_deadlines and len(extracted_deadlines) > 0:
            result["deadlines"] = extracted_deadlines
        elif existing_deadlines:
            result["deadlines"] = existing_deadlines
        else:
            result["deadlines"] = []

        # Links: merge both, preferring extracted
        existing_links = existing.get("links", {})
        extracted_links = extracted.get("links", {})
        result["links"] = {**existing_links, **{k: v for k, v in extracted_links.items() if v}}

        # Info: merge both, preferring extracted
        existing_info = existing.get("info", {})
        extracted_info = extracted.get("info", {})
        if extracted_info or existing_info:
            result["info"] = {**existing_info, **{k: v for k, v in extracted_info.items() if v}}

        # Preserve notes and deskRejectReasons from existing
        if existing.get("notes"):
            result["notes"] = existing["notes"]
        if existing.get("deskRejectReasons"):
            result["deskRejectReasons"] = existing["deskRejectReasons"]

        return result

    def update_conference(self, conf: Dict, year: int) -> Optional[Dict]:
        """Update a single conference"""
        conf_id = f"{conf['id']}-{year}"
        print(f"\n📅 Updating {conf['name']} {year}...")

        # Fetch webpage content from all URLs
        all_content = []
        for url_template in conf.get("urls", []):
            url = url_template.format(year=year, short_year=str(year)[-2:])
            content = self.fetch_webpage(url)
            if content:
                all_content.append(f"--- Content from {url} ---\n{content}")

        if not all_content:
            print(f"  ❌ No content fetched for {conf['name']} {year}")
            # Return existing data if available
            if conf_id in self.existing_data:
                print(f"  ℹ️ Using existing data for {conf['name']} {year}")
                return self.existing_data[conf_id]
            return None

        # Convert HTML to text and combine
        text_content = []
        for html in all_content:
            text = html_to_text(html)
            text_content.append(text)
        combined_content = "\n\n".join(text_content)
        print(f"    📝 Extracted {len(combined_content)} chars of text from HTML")

        # Extract with Gemini
        extracted = self.extract_with_llm(conf, combined_content, year)

        if not extracted:
            print(f"  ❌ Extraction failed for {conf['name']} {year}")
            # Return existing data if available
            if conf_id in self.existing_data:
                print(f"  ℹ️ Using existing data for {conf['name']} {year}")
                return self.existing_data[conf_id]
            return None

        # Merge with existing data
        result = self._merge_conference_data(conf_id, extracted, conf, year)

        confidence = extracted.get("confidence", "N/A")
        deadline_count = len(result.get("deadlines", []))
        print(f"  ✅ {conf['name']} {year} updated (confidence: {confidence}, deadlines: {deadline_count})")

        return result

    def _estimate_next_year(self, conf_data: Dict, next_year: int) -> Dict:
        """Estimate next year's data by adding 1 year to all dates"""
        estimated = conf_data.copy()
        estimated["id"] = f"{conf_data['id'].rsplit('-', 1)[0]}-{next_year}"
        estimated["year"] = next_year
        estimated["isEstimated"] = True

        # Bump all deadline dates by 1 year
        new_deadlines = []
        for d in conf_data.get("deadlines", []):
            new_d = d.copy()
            try:
                old_date = datetime.fromisoformat(d["date"].replace("Z", "+00:00"))
                new_date = old_date.replace(year=old_date.year + 1)
                new_d["date"] = new_date.isoformat()
                new_d["estimated"] = True
                new_d["status"] = "upcoming"

                if d.get("endDate"):
                    old_end = datetime.fromisoformat(d["endDate"])
                    new_end = old_end.replace(year=old_end.year + 1)
                    new_d["endDate"] = new_end.strftime("%Y-%m-%d")
            except:
                pass
            new_deadlines.append(new_d)

        estimated["deadlines"] = new_deadlines
        estimated["location"] = {"city": "TBD", "country": "TBD", "flag": "🌍", "venue": "TBD"}

        return estimated

    def update_all(self, target_year: Optional[int] = None) -> List[Dict]:
        """Update all conferences"""
        current_year = datetime.now().year

        if target_year:
            target_years = [target_year]
        else:
            # Update current year and next year
            target_years = [current_year, current_year + 1]

        results = []
        processed_ids = set()
        year_results = {}  # Store results by conf_id base for estimation

        for conf in CONFERENCES_CONFIG:
            for year in target_years:
                conf_id = f"{conf['id']}-{year}"

                # Skip if already processed (avoid duplicates)
                if conf_id in processed_ids:
                    continue
                processed_ids.add(conf_id)

                result = self.update_conference(conf, year)

                if result:
                    results.append(result)
                    year_results[(conf['id'], year)] = result
                else:
                    # If failed and this is next year, try to estimate from current year
                    if year == current_year + 1:
                        prev_result = year_results.get((conf['id'], current_year))
                        if prev_result:
                            print(f"  🔮 Estimating {conf['name']} {year} from {current_year} data")
                            estimated = self._estimate_next_year(prev_result, year)
                            results.append(estimated)
                            processed_ids.add(conf_id)

                # Rate limiting - be nice to APIs
                time.sleep(0.3)

        # Add any existing conferences that weren't updated (different years, etc.)
        for conf_id, conf_data in self.existing_data.items():
            if conf_id not in processed_ids:
                # Check if this is a valid conference we should keep
                conf_year = conf_data.get("year", 0)
                if conf_year >= current_year - 1:  # Keep recent conferences
                    results.append(conf_data)
                    print(f"  ℹ️ Preserved existing: {conf_data.get('name')} {conf_year}")

        return results

    def generate_js_file(self, conferences: List[Dict], output_path: str):
        """Generate the JavaScript data file"""
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Sort conferences by next upcoming deadline
        def get_sort_key(conf):
            deadlines = conf.get("deadlines", [])
            for d in deadlines:
                if d.get("status") in ["active", "upcoming"]:
                    return d.get("date", "9999")
            return "9999"

        conferences.sort(key=get_sort_key)

        # Generate JavaScript content
        js_content = f'''/**
 * Conference Data
 * This file contains all conference information.
 * Auto-updated by GitHub Actions + Gemini
 * Last updated: {now}
 */

const CONFERENCES_DATA = {{
    lastUpdated: "{now}",
    conferences: {json.dumps(conferences, indent=8, ensure_ascii=False)}
}};

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

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(js_content)

        print(f"\n✅ Generated {output_path} with {len(conferences)} conferences")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Update conference deadlines")
    parser.add_argument("--only", type=str, help="Comma-separated conference IDs (e.g., --only icml,cvpr,neurips,eccv)")
    args = parser.parse_args()

    print("🚀 Starting conference deadline update...")
    print(f"📅 Current time: {datetime.now(timezone.utc).isoformat()}")

    try:
        updater = ConferenceUpdater()

        if args.only:
            # Process only specified conferences
            conf_ids = [c.strip().lower() for c in args.only.split(",")]
            test_configs = [c for c in CONFERENCES_CONFIG if c["id"] in conf_ids]
            print(f"🎯 Processing: {', '.join(c['name'] for c in test_configs)}")

            conferences = []
            year = datetime.now().year
            for conf in test_configs:
                result = updater.update_conference(conf, year)
                if result:
                    conferences.append(result)
                time.sleep(0.3)
        else:
            conferences = updater.update_all()

        if conferences:
            updater.generate_js_file(conferences, "js/data.js")
            print(f"\n✅ Successfully updated {len(conferences)} conferences")
        else:
            print("\n⚠️ No conferences updated")

    except Exception as e:
        print(f"\n❌ Update failed: {e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    main()
