#!/usr/bin/env python3
"""
Conference Deadline Updater

This script:
1. Loads conference configuration
2. Fetches each conference's official webpage
3. Uses Gemini to extract deadline information
4. Updates the JavaScript data file
5. Handles errors gracefully with fallbacks

Execution: Runs weekly via GitHub Actions
"""

import os
import re
import json
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any
from dateutil import parser as date_parser

# Gemini API
from google import genai
from google.genai import types

# Configuration
CONFERENCES_CONFIG = [
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
            "https://eccv{year}.ecva.net/"
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
            "https://iccv{year}.thecvf.com/"
        ]
    },
    {
        "id": "acl",
        "name": "ACL",
        "fullName": "Annual Meeting of the ACL",
        "category": "nlp",
        "website": "https://www.aclweb.org/",
        "brandColor": "#FF6600",
        "urls": [
            "https://{year}.aclweb.org/"
        ]
    },
    {
        "id": "emnlp",
        "name": "EMNLP",
        "fullName": "Empirical Methods in NLP",
        "category": "nlp",
        "website": "https://www.aclweb.org/",
        "brandColor": "#228B22",
        "urls": [
            "https://{year}.emnlp.org/"
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
            "https://aaai.org/conference/aaai/aaai-{short_year}/"
        ]
    }
]

# Gemini prompt template
EXTRACTION_PROMPT = """You are an AI assistant that extracts academic conference deadline information from webpage content.

CONFERENCE: {conference_name} ({conference_full_name})
TARGET YEAR: {target_year}
OFFICIAL URL: {official_url}

WEBPAGE CONTENT:
{webpage_content}

TASK: Extract all available deadline information for {conference_name} {target_year}.

DEADLINE TYPES TO LOOK FOR:
- abstract: Abstract submission deadline
- paper: Full paper submission deadline
- supplementary: Supplementary material deadline
- notification: Author notification date
- rebuttal: Rebuttal period
- camera: Camera-ready deadline
- event: Conference start and end dates

ALSO EXTRACT:
- location (city, country, venue if available)
- official submission link
- author guidelines link

OUTPUT FORMAT (strict JSON, no markdown):
{{
  "year": {target_year},
  "status": "confirmed",
  "location": {{
    "city": "string or null",
    "country": "string or null",
    "flag": "emoji flag or null",
    "venue": "string or null"
  }},
  "deadlines": [
    {{
      "type": "paper",
      "label": "Paper Submission",
      "date": "YYYY-MM-DDTHH:MM:SS-12:00",
      "status": "upcoming",
      "estimated": false
    }}
  ],
  "links": {{
    "official": "url or null",
    "author": "url or null",
    "submission": "url or null"
  }},
  "confidence": 0.0-1.0
}}

IMPORTANT:
- All times should be in AoE timezone (UTC-12), use offset -12:00
- If time is not specified, use 23:59:00
- Set status to "passed" if date is in the past, "active" if within 30 days, "upcoming" otherwise
- Set estimated: true if date is guessed or uncertain
- Return ONLY valid JSON, no markdown formatting or explanation
"""


class ConferenceUpdater:
    def __init__(self):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set")
        
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash"
        self.results = []
    
    def fetch_webpage(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch webpage content with error handling"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"  ⚠️ Failed to fetch {url}: {e}")
            return None
    
    def extract_with_gemini(self, conf: Dict, content: str, year: int) -> Optional[Dict]:
        """Use Gemini to extract deadline information"""
        try:
            prompt = EXTRACTION_PROMPT.format(
                conference_name=conf["name"],
                conference_full_name=conf["fullName"],
                target_year=year,
                official_url=conf["website"],
                webpage_content=content[:15000]  # Limit content length
            )
            
            response = self.client.models.generate_content(
                model=self.model,
                contents=[types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=prompt)]
                )],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=2000
                )
            )
            
            # Parse JSON from response
            text = response.text.strip()
            # Remove markdown code blocks if present
            if text.startswith("```"):
                text = re.sub(r"```json?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)
            
            return json.loads(text)
        except Exception as e:
            print(f"  ⚠️ Gemini extraction failed: {e}")
            return None
    
    def update_conference(self, conf: Dict, year: int) -> Optional[Dict]:
        """Update a single conference"""
        print(f"\n📅 Updating {conf['name']} {year}...")
        
        # Fetch webpage content
        all_content = []
        for url_template in conf.get("urls", []):
            url = url_template.format(year=year, short_year=str(year)[-2:])
            content = self.fetch_webpage(url)
            if content:
                all_content.append(content)
        
        if not all_content:
            print(f"  ❌ No content fetched for {conf['name']}")
            return None
        
        # Combine content
        combined_content = "\n\n---\n\n".join(all_content)
        
        # Extract with Gemini
        extracted = self.extract_with_gemini(conf, combined_content, year)
        
        if not extracted:
            print(f"  ❌ Extraction failed for {conf['name']}")
            return None
        
        # Build result
        result = {
            "id": f"{conf['id']}-{year}",
            "name": conf["name"],
            "fullName": conf["fullName"],
            "year": year,
            "category": conf["category"],
            "website": conf["website"],
            "brandColor": conf["brandColor"],
            "location": extracted.get("location", {}),
            "deadlines": extracted.get("deadlines", []),
            "links": extracted.get("links", {})
        }
        
        print(f"  ✅ {conf['name']} {year} updated (confidence: {extracted.get('confidence', 'N/A')})")
        return result
    
    def update_all(self) -> List[Dict]:
        """Update all conferences"""
        current_year = datetime.now().year
        target_years = [current_year, current_year + 1]
        
        results = []
        for conf in CONFERENCES_CONFIG:
            for year in target_years:
                result = self.update_conference(conf, year)
                if result:
                    results.append(result)
        
        return results
    
    def generate_js_file(self, conferences: List[Dict], output_path: str):
        """Generate the JavaScript data file"""
        now = datetime.now(timezone.utc).isoformat()
        
        data = {
            "lastUpdated": now,
            "conferences": conferences
        }
        
        js_content = f"""/**
 * Conference Data
 * Auto-generated by GitHub Actions + Gemini
 * Last updated: {now}
 */

const CONFERENCES_DATA = {json.dumps(data, indent=4)};

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
"""
        
        with open(output_path, 'w') as f:
            f.write(js_content)
        
        print(f"\n✅ Generated {output_path}")


def main():
    print("🚀 Starting conference deadline update...")
    print(f"📅 Current time: {datetime.now(timezone.utc).isoformat()}")
    
    try:
        updater = ConferenceUpdater()
        conferences = updater.update_all()
        
        if conferences:
            updater.generate_js_file(conferences, "js/data.js")
            print(f"\n✅ Updated {len(conferences)} conferences")
        else:
            print("\n⚠️ No conferences updated, keeping existing data")
    
    except Exception as e:
        print(f"\n❌ Update failed: {e}")
        raise


if __name__ == "__main__":
    main()
