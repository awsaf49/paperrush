#!/usr/bin/env python3
"""
Conference Scraper - Hybrid Agentic Approach

Flow:
1. Start with 5-10 seed URLs per conference
2. Fetch → Extract → LLM (chunked) → Discover more URLs
3. Follow discovered URLs (track visited, stay on domain)
4. Merge all extracted info
"""

import os
import re
import json
import time
import requests
from typing import Optional, Dict, List, Set
from urllib.parse import urljoin, urlparse
from html.parser import HTMLParser
from openai import OpenAI


# =============================================================================
# CONFERENCE SEED URLS
# =============================================================================

# Crawl strategy: Only crawl pages with essential submission info
# CRAWL (seeds): Landing, Dates, AuthorGuidelines, CallForPapers
# LINK-ONLY: Everything else (reviewer, workshops, tutorials, FAQ, etc.)

CONFERENCES = {
    "cvpr": {
        "name": "CVPR",
        "base": "https://cvpr.thecvf.com/Conferences/{year}",
        "seeds": [
            "",  # Landing
            "Dates",
            "AuthorGuidelines",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerGuidelines",
            "CallForWorkshops",
            "CallForTutorials",
        ],
        "known_template": "https://github.com/cvpr-org/author-kit",
    },
    "iccv": {
        "name": "ICCV",
        "base": "https://iccv.thecvf.com/Conferences/{year}",
        "seeds": [
            "",
            "Dates",
            "AuthorGuidelines",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerGuidelines",
            "CallForWorkshops",
            "CallForTutorials",
        ],
    },
    "eccv": {
        "name": "ECCV",
        "base": "https://eccv.ecva.net/Conferences/{year}",
        "seeds": [
            "",
            "AuthorGuidelines",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerGuidelines",
        ],
    },
    "icml": {
        "name": "ICML",
        "base": "https://icml.cc/Conferences/{year}",
        "seeds": [
            "",
            "Dates",
            "AuthorInstructions",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerInstructions",
            "CallForWorkshops",
            "CallForTutorials",
            "PeerReviewFAQ",
        ],
    },
    "neurips": {
        "name": "NeurIPS",
        "base": "https://neurips.cc/Conferences/{year}",
        "seeds": [
            "",
            "Dates",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerGuidelines",
            "CallForWorkshops",
            "CallForTutorials",
            "CallForDatasetsBenchmarks",
        ],
    },
    "iclr": {
        "name": "ICLR",
        "base": "https://iclr.cc/Conferences/{year}",
        "seeds": [
            "",
            "Dates",
            "AuthorGuide",
            "CallForPapers",
        ],
        "link_only": [
            "ReviewerGuide",
            "CallForWorkshops",
            "CallForTutorials",
        ],
    },
    "aaai": {
        "name": "AAAI",
        "base": "https://aaai.org/conference/aaai/aaai-{short_year}",
        "seeds": [
            "",
            "submission-instructions",  # Author guidelines equivalent
            "main-technical-track-call",  # Call for papers
        ],
        "link_only": [
            "review-process",
            "policies-for-aaai-{short_year}-authors",
            "call-for-workshop-proposals",
            "call-for-tutorial-proposals",
        ],
    },
    "acl": {
        "name": "ACL",
        "base": "https://{year}.aclweb.org",
        "seeds": [
            "",
            "calls/main_conference_papers",  # CFP + author guidelines combined
        ],
        "link_only": [
            "calls/industry_track",
            "calls/workshops",
            "calls/tutorials",
            "program/accepted",
            "faq",
        ],
        "known_template": "https://github.com/acl-org/acl-style-files",
    },
    "emnlp": {
        "name": "EMNLP",
        "base": "https://{year}.emnlp.org",
        "seeds": [
            "",
            "calls/main_conference_papers",
        ],
        "link_only": [
            "calls/industry_track",
            "calls/workshops",
            "calls/tutorials",
            "registration",
            "faq",
        ],
    },
    "naacl": {
        "name": "NAACL",
        "base": "https://{year}.naacl.org",
        "seeds": [
            "",
            "calls/main_conference_papers",
        ],
        "link_only": [
            "calls/industry_track",
            "calls/workshops",
            "calls/tutorials",
        ],
    },
    "interspeech": {
        "name": "INTERSPEECH",
        "base": "https://interspeech{year}.org",
        "seeds": [
            "",
            "important-dates",
            "paper-submission",  # Author guidelines
            "call-for-papers",
        ],
        "link_only": [
            "special-sessions",
            "satellite-workshops",
        ],
    },
    "icassp": {
        "name": "ICASSP",
        "base": "https://{year}.ieeeicassp.org",
        "seeds": [
            "",
            "important-dates",
            "authors",  # Author guidelines
            "call-for-papers",
        ],
        "link_only": [
            "tutorials",
            "workshops",
        ],
    },
}


# =============================================================================
# HTML PARSER - SIMPLE, NO FILTERING
# =============================================================================

class HTMLTextExtractor(HTMLParser):
    """Extract ALL text and links from HTML - no filtering bullshit"""

    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self.in_script_or_style = False
        self.current_href = None

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        # Only skip script/style content (not useful)
        if tag in ('script', 'style'):
            self.in_script_or_style = True
        # Capture links
        if tag == 'a':
            for attr, value in attrs:
                if attr == 'href' and value:
                    self.current_href = value

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ('script', 'style'):
            self.in_script_or_style = False
        if tag == 'a':
            self.current_href = None

    def handle_data(self, data):
        if self.in_script_or_style:
            return
        text = data.strip()
        if text:
            self.text.append(text)
            if self.current_href:
                self.links.append({"text": text, "href": self.current_href})

    def get_text(self):
        return ' '.join(self.text)

    def get_links(self):
        return self.links


def extract_page_content(html: str, base_url: str) -> Dict:
    """Extract text and links from HTML"""
    parser = HTMLTextExtractor()
    try:
        parser.feed(html)
    except:
        return {"text": "", "links": []}

    # Resolve relative URLs and deduplicate
    seen_urls = set()
    links = []
    for link in parser.get_links():
        href = link["href"]
        if href.startswith("#") or href.startswith("javascript:") or href.startswith("mailto:"):
            continue
        if not href.startswith("http"):
            href = urljoin(base_url, href)
        if href not in seen_urls:
            seen_urls.add(href)
            links.append({"text": link["text"][:100], "url": href})

    text = re.sub(r'\s+', ' ', parser.get_text()).strip()
    return {"text": text, "links": links}


# =============================================================================
# POST-PROCESSING & VALIDATION HELPERS
# =============================================================================

def parse_page_limit(value) -> tuple:
    """
    Parse page limit to (integer, extra_info).
    Examples:
        "8 pages + unlimited references" → (8, "unlimited references")
        8 → (8, None)
        "8" → (8, None)
        "8-10 pages excluding references" → (8, "10 pages excluding references")
    """
    if value is None:
        return None, None

    if isinstance(value, int):
        return value, None

    if isinstance(value, str):
        # Try to extract leading number
        match = re.match(r'^(\d+)', value.strip())
        if match:
            num = int(match.group(1))
            rest = value[match.end():].strip()
            # Clean up common patterns
            rest = re.sub(r'^[\s\-\+,]+', '', rest)
            rest = re.sub(r'^pages?\s*', '', rest, flags=re.IGNORECASE)
            rest = re.sub(r'^[\s\-\+,]+', '', rest)
            return num, rest if rest else None
        return None, value

    return None, None


def normalize_date(date_str: str) -> Optional[str]:
    """
    Normalize date string to ISO format YYYY-MM-DD.
    Handles various formats like:
        "November 7, 2025" → "2025-11-07"
        "Nov 7 2025" → "2025-11-07"
        "2025-11-07" → "2025-11-07"
        "7/11/2025" → "2025-11-07" (assumes M/D/Y)
    """
    if not date_str:
        return None

    date_str = date_str.strip()

    # Already ISO format
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str

    # Month name patterns
    months = {
        'jan': '01', 'january': '01',
        'feb': '02', 'february': '02',
        'mar': '03', 'march': '03',
        'apr': '04', 'april': '04',
        'may': '05',
        'jun': '06', 'june': '06',
        'jul': '07', 'july': '07',
        'aug': '08', 'august': '08',
        'sep': '09', 'sept': '09', 'september': '09',
        'oct': '10', 'october': '10',
        'nov': '11', 'november': '11',
        'dec': '12', 'december': '12',
    }

    # "November 7, 2025" or "Nov 7 2025"
    match = re.match(r'(\w+)\s+(\d{1,2}),?\s*(\d{4})', date_str, re.IGNORECASE)
    if match:
        month_str, day, year = match.groups()
        month = months.get(month_str.lower())
        if month:
            return f"{year}-{month}-{int(day):02d}"

    # "7 November 2025"
    match = re.match(r'(\d{1,2})\s+(\w+),?\s*(\d{4})', date_str, re.IGNORECASE)
    if match:
        day, month_str, year = match.groups()
        month = months.get(month_str.lower())
        if month:
            return f"{year}-{month}-{int(day):02d}"

    # M/D/YYYY
    match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_str)
    if match:
        m, d, y = match.groups()
        return f"{y}-{int(m):02d}-{int(d):02d}"

    return date_str  # Return as-is if can't parse


def normalize_time(time_str: str) -> Optional[str]:
    """
    Normalize time to 24-hour format HH:MM.
    Examples:
        "11:59 PM" → "23:59"
        "23:59" → "23:59"
        "11:59pm" → "23:59"
    """
    if not time_str:
        return None

    time_str = time_str.strip().upper()

    # Already 24-hour format
    if re.match(r'^\d{2}:\d{2}$', time_str):
        return time_str

    # 12-hour format with AM/PM
    match = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM)?', time_str)
    if match:
        hour, minute, period = match.groups()
        hour = int(hour)
        if period == 'PM' and hour != 12:
            hour += 12
        elif period == 'AM' and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute}"

    return None


def normalize_timezone(tz_str: str) -> Optional[str]:
    """
    Normalize timezone abbreviation.
    """
    if not tz_str:
        return None

    tz_str = tz_str.strip()

    # Common mappings
    tz_map = {
        'anywhere on earth': 'AoE',
        'aoe': 'AoE',
        'utc': 'UTC',
        'gmt': 'UTC',
        'pacific': 'PT',
        'pacific time': 'PT',
        'pacific standard time': 'PST',
        'pacific daylight time': 'PDT',
        'pst': 'PST',
        'pdt': 'PDT',
        'pt': 'PT',
        'eastern': 'ET',
        'eastern time': 'ET',
        'est': 'EST',
        'edt': 'EDT',
        'et': 'ET',
    }

    normalized = tz_map.get(tz_str.lower(), tz_str)
    return normalized


def split_camel_case(text: str) -> str:
    """
    Convert CamelCase or PascalCase to spaced text.
    Examples:
        "TutorialSubmissionNotifications" → "Tutorial Submission Notifications"
        "WorkshopSubmissionDeadline" → "Workshop Submission Deadline"
        "Paper Submission" → "Paper Submission" (already spaced, unchanged)
    """
    if not text or ' ' in text:
        return text  # Already has spaces or empty

    # Insert space before each uppercase letter (except first)
    result = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    # Also handle consecutive capitals like "ACGuides" → "AC Guides"
    result = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', result)
    return result


def clean_deadline(deadline: Dict) -> Dict:
    """Clean and normalize a deadline object."""
    if not isinstance(deadline, dict):
        return None

    # Handle old format {"name": ..., "date": ...}
    event = deadline.get("event") or deadline.get("name")
    if not event:
        return None

    # Convert CamelCase to spaced text
    event = split_camel_case(event)

    result = {
        "event": event,
        "date": normalize_date(deadline.get("date")),
        "time": normalize_time(deadline.get("time")),
        "timezone": normalize_timezone(deadline.get("timezone")),
    }

    return result


def post_process_extraction(extracted: Dict) -> Dict:
    """
    Post-process LLM extraction to ensure clean data types.
    """
    result = extracted.copy()

    # Clean page_limit
    if "info" in result:
        page_limit = result["info"].get("page_limit")
        if page_limit is not None:
            limit_int, limit_extra = parse_page_limit(page_limit)
            result["info"]["page_limit"] = limit_int
            if limit_extra and not result["info"].get("page_limit_extra"):
                result["info"]["page_limit_extra"] = limit_extra

    # Clean deadlines
    if "deadlines" in result:
        cleaned_deadlines = []
        for d in result["deadlines"]:
            cleaned = clean_deadline(d)
            if cleaned and cleaned.get("event"):
                cleaned_deadlines.append(cleaned)
        result["deadlines"] = cleaned_deadlines

    # Ensure links.other is a dict
    if "links" in result:
        other = result["links"].get("other")
        if isinstance(other, list):
            # Convert list to dict
            result["links"]["other"] = {f"link_{i}": url for i, url in enumerate(other) if url}
        elif not isinstance(other, dict):
            result["links"]["other"] = {}

    # Ensure info.other is a dict
    if "info" in result:
        other = result["info"].get("other")
        if not isinstance(other, dict):
            result["info"]["other"] = {}

    return result


# =============================================================================
# LLM PROMPT (Comprehensive & Robust with Clean Data Types)
# =============================================================================

EXTRACTION_PROMPT = '''You are extracting information from a conference website page.

**CURRENT URL:** {url}

**PAGE CONTENT (part {chunk_num}/{total_chunks}):**
{text}

**LINKS FOUND ON PAGE:**
{links}

---

**YOUR TASK:** Extract ALL relevant conference information with CLEAN DATA TYPES.

Return a JSON object with these fields:

{{
  "links": {{
    "submission_portal": "URL to submission system (OpenReview, CMT, EasyChair, etc.) or null",
    "latex_template": "URL to LaTeX/Word template download or null",
    "author_guidelines": "URL to author guidelines/instructions page or null",
    "reviewer_guidelines": "URL to reviewer guidelines page or null",
    "ac_guidelines": "URL to Area Chair (AC) guidelines or null",
    "sac_guidelines": "URL to Senior Area Chair (SAC) guidelines or null",
    "call_for_papers": "URL to call for papers page or null",
    "call_for_workshops": "URL to workshop proposals page or null",
    "call_for_tutorials": "URL to tutorial proposals page or null",
    "important_dates": "URL to dates/deadlines page or null",
    "registration": "URL to conference registration page or null",
    "faq": "URL to FAQ page or null",
    "other": {{
      "key_name": "URL for conference-specific links not covered above",
      "Examples: call_for_art, datasets_track, findings_track, industry_track, etc."
    }}
  }},

  "location": {{
    "city": "City name (e.g., 'Vancouver', 'Seoul', 'Vienna') or null",
    "country": "Country name (e.g., 'Canada', 'South Korea', 'Austria') or null",
    "venue": "Venue/convention center name or null",
    "dates": "Conference dates as string (e.g., 'June 5-7, 2026') or null"
  }},

  "info": {{
    "page_limit": 8,
    "page_limit_extra": "unlimited references",
    "review_type": "double-blind",
    "submission_format": "PDF",
    "other": {{}}
  }},

  "deadlines": [
    {{
      "event": "Abstract Submission",
      "date": "2025-11-07",
      "time": "23:59",
      "timezone": "AoE"
    }},
    {{
      "event": "Paper Submission",
      "date": "2025-11-13",
      "time": "23:59",
      "timezone": "AoE"
    }},
    {{
      "event": "Notification",
      "date": "2026-02-20",
      "time": null,
      "timezone": null
    }}
  ],

  "desk_reject_reasons": [
    "Short bullet points (max 10 words each) for desk rejection reasons",
    "Examples: 'Page limit exceeded', 'Anonymity violation', 'Wrong template'"
  ],

  "next_urls_to_visit": [
    "Suggest 2-5 URLs from the links that would contain more useful information"
  ]
}}

**CRITICAL DATA TYPE REQUIREMENTS:**

1. **page_limit**: Return as INTEGER (e.g., 8), NOT a string. Put extra info in page_limit_extra.

2. **date**: Return in ISO format YYYY-MM-DD (e.g., "2025-11-07"), NOT "November 7, 2025"

3. **time**: Return in 24-hour format HH:MM (e.g., "23:59"), or null if not specified

4. **timezone**: Return as string abbreviation (e.g., "AoE", "UTC", "PST", "PT"), or null if not specified
   - "Anywhere on Earth" = "AoE"
   - "Pacific Time" = "PT" or "PST"
   - If time says "11:59 PM AoE" → time: "23:59", timezone: "AoE"

5. **deadlines**: Return as array of objects. Use descriptive event names WITH SPACES:
   - Good: "Abstract Submission", "Paper Submission", "Tutorial Submission Deadline"
   - Bad: "AbstractSubmission", "PaperSubmission", "TutorialSubmissionDeadline" (NO CamelCase!)
   - Always use proper spacing between words, never CamelCase or PascalCase

6. **links.other**: Use for conference-specific links (call_for_art, datasets_track, etc.)

7. **info.other**: Use for conference-specific info not in standard fields

**IMPORTANT INSTRUCTIONS:**
1. Extract information ONLY from the provided content - do not make up information
2. For desk_reject_reasons, keep each reason SHORT (max 10 words). Use phrases not sentences.
   - Good: "Page limit exceeded (8 pages max)"
   - Bad: "Papers that have more than eight pages excluding references will be desk rejected"
3. For links, prefer direct download links over general pages when available
4. For next_urls_to_visit, only include URLs that appear in the LINKS section
5. If information is not present, use null for single values or empty arrays for lists
6. Return ONLY the JSON object, no other text'''


# =============================================================================
# SCRAPER CLASS
# =============================================================================

class ConferenceScraper:
    """Hybrid agentic conference scraper"""

    def __init__(self, verbose: bool = True):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY not set. Run: export $(grep -v '^#' .env | xargs)")

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        self.model = "google/gemini-2.0-flash-001"
        self.verbose = verbose

    def log(self, msg: str, end="\n"):
        if self.verbose:
            print(msg, end=end, flush=True)

    def fetch(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch URL content"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            resp.raise_for_status()
            return resp.text
        except:
            return None

    def is_same_domain(self, url: str, base_domain: str) -> bool:
        """Check if URL is on same domain (or subdomain)"""
        try:
            parsed = urlparse(url)
            # Allow same domain or subdomains
            return base_domain in parsed.netloc or parsed.netloc in base_domain
        except:
            return False

    def call_llm(self, prompt: str) -> Optional[str]:
        """Call LLM with retry"""
        for attempt in range(3):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    max_tokens=3000
                )
                content = response.choices[0].message.content
                if content:
                    return content
            except Exception as e:
                self.log(f"      ⚠️ LLM error (attempt {attempt+1}): {e}")
                time.sleep(1)
        return None

    def parse_llm_response(self, response: str) -> Optional[Dict]:
        """Parse JSON from LLM response"""
        if not response:
            return None
        try:
            # Clean markdown code blocks
            text = response.strip()
            text = re.sub(r"^```json?\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text)

            # Find JSON object
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
        return None

    def extract_from_page(self, url: str, text: str, links: List[Dict]) -> Dict:
        """Extract info from page content using LLM with chunking"""

        # Format links for prompt
        links_str = "\n".join([f"- [{l['text'][:60]}]({l['url']})" for l in links[:80]])

        CHUNK_SIZE = 10000
        OVERLAP = 500

        # Split text into chunks
        if len(text) > CHUNK_SIZE:
            chunks = []
            start = 0
            while start < len(text):
                end = min(start + CHUNK_SIZE, len(text))
                chunks.append(text[start:end])
                start = end - OVERLAP
                if start >= len(text) - OVERLAP:
                    break
            self.log(f"      📄 {len(text):,} chars → {len(chunks)} chunks")
        else:
            chunks = [text]
            self.log(f"      📄 {len(text):,} chars")

        # Process each chunk and merge
        merged = {
            "links": {},
            "info": {},
            "desk_reject_reasons": [],
            "deadlines": [],
            "next_urls_to_visit": [],
        }

        for i, chunk in enumerate(chunks):
            self.log(f"      🔄 Chunk {i+1}/{len(chunks)}...", end=" ")

            prompt = EXTRACTION_PROMPT.format(
                url=url,
                chunk_num=i+1,
                total_chunks=len(chunks),
                text=chunk,
                links=links_str
            )

            response = self.call_llm(prompt)
            result = self.parse_llm_response(response)

            if not result:
                self.log("❌ parse failed")
                continue

            # Merge links (take first non-null)
            for key, value in result.get("links", {}).items():
                if key == "other_useful":
                    for url in (value or []):
                        if url and url not in merged["links"].get("other_useful", []):
                            merged["links"].setdefault("other_useful", []).append(url)
                elif value and not merged["links"].get(key):
                    merged["links"][key] = value

            # Merge info (take first non-null)
            for key, value in result.get("info", {}).items():
                if value and not merged["info"].get(key):
                    merged["info"][key] = value

            # Merge lists (deduplicate)
            for reason in result.get("desk_reject_reasons", []):
                if reason and reason not in merged["desk_reject_reasons"]:
                    merged["desk_reject_reasons"].append(reason)

            for deadline in result.get("deadlines", []):
                if not deadline:
                    continue
                # Normalize event name for deduplication
                event = deadline.get("event", "")
                # Split CamelCase and lowercase for comparison
                normalized = split_camel_case(event).lower().strip()
                # Remove common suffixes for better matching
                for suffix in [" deadline", " submission", " period"]:
                    if normalized.endswith(suffix) and len(normalized) > len(suffix) + 3:
                        normalized = normalized[:-len(suffix)].strip()
                date = deadline.get("date", "")
                dedup_key = (normalized, date)

                # Check if we already have a similar deadline
                dominated = False
                dominated_idx = None
                for idx, existing in enumerate(merged["deadlines"]):
                    existing_event = existing.get("event", "")
                    existing_normalized = split_camel_case(existing_event).lower().strip()
                    for suffix in [" deadline", " submission", " period"]:
                        if existing_normalized.endswith(suffix) and len(existing_normalized) > len(suffix) + 3:
                            existing_normalized = existing_normalized[:-len(suffix)].strip()
                    existing_date = existing.get("date", "")
                    existing_key = (existing_normalized, existing_date)

                    if existing_key == dedup_key:
                        dominated = True
                        # Prefer the one with more complete time info
                        if deadline.get("time") and not existing.get("time"):
                            dominated_idx = idx
                        break

                if dominated_idx is not None:
                    merged["deadlines"][dominated_idx] = deadline
                elif not dominated:
                    merged["deadlines"].append(deadline)

            for next_url in result.get("next_urls_to_visit", []):
                if next_url and next_url not in merged["next_urls_to_visit"]:
                    merged["next_urls_to_visit"].append(next_url)

            # Show what was found
            found = []
            if result.get("links", {}).get("submission_portal"): found.append("submission")
            if result.get("links", {}).get("latex_template"): found.append("template")
            if result.get("desk_reject_reasons"): found.append(f"{len(result['desk_reject_reasons'])} desk_rejects")
            self.log(f"✅ {found if found else 'ok'}")

            time.sleep(0.3)

        return merged

    def scrape_conference(self, conf_key: str, year: int, max_steps: int = 15) -> Dict:
        """
        Scrape conference using hybrid agentic approach

        Args:
            conf_key: Conference identifier (cvpr, icml, etc.)
            year: Conference year
            max_steps: Maximum pages to visit
        """
        conf_key = conf_key.lower()
        if conf_key not in CONFERENCES:
            print(f"❌ Unknown conference: {conf_key}")
            print(f"   Available: {', '.join(sorted(CONFERENCES.keys()))}")
            return {}

        conf = CONFERENCES[conf_key]
        short_year = str(year)[2:]
        base_url = conf["base"].format(year=year, short_year=short_year)
        base_domain = urlparse(base_url).netloc

        print(f"\n{'='*70}")
        print(f" 🎯 {conf['name']} {year}")
        print(f" Base: {base_url}")
        print(f" Max steps: {max_steps}")
        print('='*70)

        # Build initial URL queue from seeds
        queue = []
        for seed in conf["seeds"]:
            seed = seed.format(year=year, short_year=short_year)
            url = f"{base_url}/{seed}".rstrip("/")
            queue.append(url)

        self.log(f"\n🌱 Starting with {len(queue)} seed URLs")

        # Track state
        visited: Set[str] = set()
        steps = 0
        failed_fetches = 0

        # Pre-populate link-only URLs (don't crawl, just store)
        link_only_urls = {}
        skip_url_patterns = set()  # URLs we should NOT crawl

        for link_path in conf.get("link_only", []):
            link_path = link_path.format(year=year, short_year=short_year)
            full_url = f"{base_url}/{link_path}".rstrip("/")
            skip_url_patterns.add(full_url.lower())  # Add to skip list

            # Map path to link type
            path_lower = link_path.lower()
            if "reviewer" in path_lower:
                link_only_urls["reviewer_guidelines"] = full_url
            elif "workshop" in path_lower:
                link_only_urls["call_for_workshops"] = full_url
            elif "tutorial" in path_lower:
                link_only_urls["call_for_tutorials"] = full_url
            elif "dataset" in path_lower or "benchmark" in path_lower:
                link_only_urls.setdefault("other", {})["datasets_track"] = full_url
            elif "industry" in path_lower:
                link_only_urls.setdefault("other", {})["industry_track"] = full_url
            elif "faq" in path_lower:
                link_only_urls["faq"] = full_url
            elif "registration" in path_lower:
                link_only_urls["registration"] = full_url

        self.log(f"   🚫 Skip patterns: {len(skip_url_patterns)} link-only URLs")

        # Define allowed URL patterns (only crawl these categories)
        # Landing page is handled separately (it's the base URL)
        allowed_keywords = [
            "date", "deadline", "important-date",  # Dates
            "author", "submission", "instruction", "guideline",  # Author Guidelines
            "call-for-paper", "callforpaper", "cfp",  # Call for Papers
        ]

        def is_allowed_url(url: str) -> bool:
            """Check if URL matches one of our 4 allowed categories"""
            url_lower = url.lower()
            # Always allow the base/landing page
            if url_lower.rstrip("/") == base_url.lower().rstrip("/"):
                return True
            # Check if URL contains any allowed keyword
            for keyword in allowed_keywords:
                if keyword in url_lower:
                    return True
            return False

        self.log(f"   ✅ Allowed patterns: dates, author/guidelines, call-for-papers")

        # Result accumulator with new robust schema
        result = {
            "conference": conf['name'],  # Just the name, year is separate
            "year": year,

            "links": {
                "official": base_url,
                "submission_portal": None,
                "latex_template": conf.get("known_template"),
                "author_guidelines": None,
                "reviewer_guidelines": link_only_urls.get("reviewer_guidelines"),
                "ac_guidelines": None,
                "sac_guidelines": None,
                "call_for_papers": None,
                "call_for_workshops": link_only_urls.get("call_for_workshops"),
                "call_for_tutorials": link_only_urls.get("call_for_tutorials"),
                "important_dates": None,
                "registration": link_only_urls.get("registration"),
                "faq": link_only_urls.get("faq"),
                "other": link_only_urls.get("other", {}),
            },

            "location": {
                "city": None,
                "country": None,
                "venue": None,
                "dates": None,
            },

            "info": {
                "page_limit": None,
                "page_limit_extra": None,
                "review_type": None,
                "submission_format": None,
                "other": {},
            },

            "deadlines": [],  # Array of {event, date, time, timezone}

            "desk_reject_reasons": [],

            # Metadata
            "_meta": {
                "base_url": base_url,
                "pages_visited": [],
            },
        }

        # Main loop
        while queue and steps < max_steps:
            url = queue.pop(0)

            # Normalize URL
            url = url.rstrip("/")

            # Skip if visited
            if url in visited:
                continue

            # Skip if different domain
            if not self.is_same_domain(url, base_domain):
                continue

            # Skip link-only URLs (even if in queue from seeds somehow)
            if url.lower() in skip_url_patterns:
                continue

            # Skip URLs that don't match our allowed categories
            if not is_allowed_url(url):
                continue

            visited.add(url)

            # Fetch page
            self.log(f"\n📥 [{steps+1}/{max_steps}] {url}")
            html = self.fetch(url)

            if not html:
                self.log(f"      ❌ Failed to fetch")
                failed_fetches += 1
                if failed_fetches > 10:
                    self.log(f"      ⚠️ Too many failures, stopping")
                    break
                continue

            failed_fetches = 0  # Reset on success
            steps += 1
            result["_meta"]["pages_visited"].append(url)

            self.log(f"      ✅ {len(html):,} chars HTML")

            # Extract content
            content = extract_page_content(html, url)
            self.log(f"      📝 {len(content['text']):,} chars text, {len(content['links'])} links")

            if len(content['text']) < 200:
                self.log(f"      ⚠️ Too little text, skipping LLM")
                continue

            # LLM extraction
            extracted = self.extract_from_page(url, content['text'], content['links'])

            # Post-process to ensure clean data types
            extracted = post_process_extraction(extracted)

            # Merge links (take first non-null for standard keys)
            for key, value in extracted.get("links", {}).items():
                if key == "other":
                    # Merge other links dict
                    for ok, ov in (value or {}).items():
                        if ov and ok not in result["links"]["other"]:
                            result["links"]["other"][ok] = ov
                elif value and not result["links"].get(key):
                    result["links"][key] = value

            # Merge info (take first non-null for standard keys)
            for key, value in extracted.get("info", {}).items():
                if key == "other":
                    # Merge other info dict
                    for ok, ov in (value or {}).items():
                        if ov and ok not in result["info"]["other"]:
                            result["info"]["other"][ok] = ov
                elif value is not None and result["info"].get(key) is None:
                    result["info"][key] = value

            # Merge location (take first non-null for each field)
            for key, value in extracted.get("location", {}).items():
                if value and not result["location"].get(key):
                    result["location"][key] = value

            # Merge lists (deduplicate)
            for reason in extracted.get("desk_reject_reasons", []):
                if reason and reason not in result["desk_reject_reasons"]:
                    result["desk_reject_reasons"].append(reason)

            # Merge deadlines (smart deduplication by normalized event + date)
            def normalize_event(event):
                """Normalize event name for deduplication."""
                if not event:
                    return ""
                normalized = split_camel_case(event).lower().strip()
                for suffix in [" deadline", " submission", " period"]:
                    if normalized.endswith(suffix) and len(normalized) > len(suffix) + 3:
                        normalized = normalized[:-len(suffix)].strip()
                return normalized

            for deadline in extracted.get("deadlines", []):
                if not deadline:
                    continue

                event = deadline.get("event", "")
                normalized_event = normalize_event(event)
                date = deadline.get("date", "")

                # Check for similar existing deadline
                is_duplicate = False
                for existing in result["deadlines"]:
                    existing_normalized = normalize_event(existing.get("event", ""))
                    existing_date = existing.get("date", "")
                    if existing_normalized == normalized_event and existing_date == date:
                        is_duplicate = True
                        break

                if not is_duplicate:
                    result["deadlines"].append(deadline)

            # Add discovered URLs to queue (only if matches allowed categories)
            for next_url in extracted.get("next_urls_to_visit", []):
                if not next_url or next_url in visited or next_url in queue:
                    continue
                # Skip link-only URLs (reviewer guidelines, workshops, etc.)
                if next_url.lower().rstrip("/") in skip_url_patterns:
                    continue  # Silently skip
                # Only queue if URL matches allowed categories
                if not is_allowed_url(next_url):
                    continue  # Silently skip non-essential pages
                # Prioritize by inserting at front
                queue.insert(0, next_url)
                self.log(f"      🔗 Queued: {next_url[:60]}...")

        # Summary
        print(f"\n{'='*70}")
        print(f" 📊 SCRAPING COMPLETE")
        print('='*70)
        print(f"   Pages visited: {len(result['_meta']['pages_visited'])}")
        # Count non-null links (excluding 'other' dict)
        link_count = sum(1 for k, v in result['links'].items() if v and k != 'other')
        link_count += len(result['links'].get('other', {}))
        print(f"   Links found: {link_count}")
        print(f"   Desk reject reasons: {len(result['desk_reject_reasons'])}")
        print(f"   Deadlines: {len(result['deadlines'])}")

        return result


# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

def print_results(result: Dict):
    """Pretty print results with organized link sections"""
    conf_name = result.get('conference', 'Unknown')
    year = result.get('year', '')
    print(f"\n{'='*70}")
    print(f" 📋 RESULTS: {conf_name} {year}")
    print('='*70)

    # Get organized links from clean export
    clean = clean_output_for_export(result)
    links = clean.get("links", {})

    section_icons = {
        "primary": "⭐",
        "guidelines": "📖",
        "calls": "📢",
        "misc": "📎",
    }

    section_names = {
        "primary": "PRIMARY (Submission Essentials)",
        "guidelines": "GUIDELINES",
        "calls": "CALLS",
        "misc": "MISC",
    }

    print(f"\n🔗 LINKS:")
    for section, section_links in links.items():
        if section_links:
            icon = section_icons.get(section, "•")
            name = section_names.get(section, section.upper())
            print(f"\n   {icon} {name}:")
            for key, value in section_links.items():
                label = key.replace("_", " ").title()
                print(f"      {label}: {value}")

    print(f"\n📄 INFO:")
    info = result.get("info", {})
    for key, value in info.items():
        if key == "other":
            for ok, ov in (value or {}).items():
                if ov:
                    label = ok.replace("_", " ").title()
                    print(f"   {label}: {ov}")
        elif value is not None:
            label = key.replace("_", " ").title()
            print(f"   {label}: {value}")

    deadlines = result.get("deadlines", [])
    if deadlines:
        print(f"\n📅 DEADLINES ({len(deadlines)}):")
        for d in deadlines[:15]:
            if isinstance(d, dict):
                event = d.get('event', 'Unknown')
                date = d.get('date', 'TBD')
                time = d.get('time', '')
                tz = d.get('timezone', '')
                time_str = f" {time}" if time else ""
                tz_str = f" {tz}" if tz else ""
                print(f"   • {event}: {date}{time_str}{tz_str}")
            else:
                print(f"   • {d}")
        if len(deadlines) > 15:
            print(f"   ... and {len(deadlines) - 15} more")

    desk_rejects = result.get("desk_reject_reasons", [])
    if desk_rejects:
        print(f"\n🚫 DESK REJECT REASONS ({len(desk_rejects)}):")
        for i, reason in enumerate(desk_rejects[:10], 1):
            display = reason[:100] + "..." if len(reason) > 100 else reason
            print(f"   {i}. {display}")
        if len(desk_rejects) > 10:
            print(f"   ... and {len(desk_rejects) - 10} more")

    # Get pages from _meta
    pages = result.get('_meta', {}).get('pages_visited', [])
    print(f"\n📑 PAGES VISITED ({len(pages)}):")
    for url in pages:
        print(f"   • {url}")


def clean_output_for_export(result: Dict) -> Dict:
    """
    Clean the result for final JSON export.
    Organizes links into sections and removes internal metadata.
    """
    links = result.get("links", {})
    other_links = links.get("other", {})

    # Organize links into sections
    organized_links = {
        # Section 1: Top Priority (essential for submission)
        "primary": {
            "official": links.get("official"),
            "submission_portal": links.get("submission_portal"),
            "latex_template": links.get("latex_template"),
        },

        # Section 2: Guidelines
        "guidelines": {
            "author_guidelines": links.get("author_guidelines"),
            "reviewer_guidelines": links.get("reviewer_guidelines"),
            "ac_guidelines": links.get("ac_guidelines") or other_links.get("ac_guides") or other_links.get("ac_guidelines"),
            "sac_guidelines": links.get("sac_guidelines") or other_links.get("sac_guides") or other_links.get("sac_guidelines"),
        },

        # Section 3: Calls (CFP and related)
        "calls": {
            "call_for_papers": links.get("call_for_papers"),
            "call_for_workshops": links.get("call_for_workshops"),
            "call_for_tutorials": links.get("call_for_tutorials"),
        },

        # Section 4: Misc (dates, registration, faq, etc.)
        "misc": {
            "important_dates": links.get("important_dates"),
            "registration": links.get("registration"),
            "faq": links.get("faq"),
        },
    }

    # Add conference-specific calls to the calls section
    call_keywords = ["call_for", "cfp", "_track", "findings"]
    for key, value in other_links.items():
        if value:
            key_lower = key.lower()
            if any(kw in key_lower for kw in call_keywords):
                organized_links["calls"][key] = value
            # Skip non-author-relevant links (exhibitor, AC guides, etc.)

    # Remove None values from each section
    for section in organized_links:
        organized_links[section] = {k: v for k, v in organized_links[section].items() if v}

    # Remove empty sections
    organized_links = {k: v for k, v in organized_links.items() if v}

    # Clean location (remove None values)
    location = result.get("location", {})
    clean_location = {k: v for k, v in location.items() if v}

    # Build output
    output = {
        "conference": result.get("conference"),
        "year": result.get("year"),
        "location": clean_location if clean_location else None,
        "links": organized_links,
        "info": {},
        "deadlines": result.get("deadlines", []),
        "desk_reject_reasons": result.get("desk_reject_reasons", []),
    }

    # Copy info, removing None values
    info = result.get("info", {})
    for key, value in info.items():
        if key == "other":
            if value:
                output["info"]["other"] = {k: v for k, v in value.items() if v}
        elif value is not None:
            output["info"][key] = value

    # Remove empty 'other' dict from info
    if not output["info"].get("other"):
        output["info"].pop("other", None)

    return output


# =============================================================================
# MAIN
# =============================================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Conference scraper - extracts submission info, policies, and desk reject reasons",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"Available conferences:\n  {', '.join(sorted(CONFERENCES.keys()))}"
    )
    parser.add_argument("conference", help="Conference key (cvpr, icml, neurips, etc.)")
    parser.add_argument("--year", "-y", type=int, default=2026, help="Year (default: 2026)")
    parser.add_argument("--max-steps", "-m", type=int, default=15, help="Max pages to visit (default: 15)")
    parser.add_argument("--output", "-o", type=str, help="Output JSON file")
    parser.add_argument("--quiet", "-q", action="store_true", help="Less verbose output")
    args = parser.parse_args()

    if not os.environ.get("OPENROUTER_API_KEY"):
        print("❌ OPENROUTER_API_KEY not set")
        print("   Run: export $(grep -v '^#' .env | xargs)")
        return

    scraper = ConferenceScraper(verbose=not args.quiet)
    result = scraper.scrape_conference(args.conference, args.year, args.max_steps)

    if not result:
        return

    print_results(result)

    # Clean output for export
    clean_result = clean_output_for_export(result)

    # Full JSON
    print(f"\n{'='*70}")
    print(" 📄 CLEAN JSON OUTPUT")
    print('='*70)
    print(json.dumps(clean_result, indent=2, default=str))

    if args.output:
        with open(args.output, "w") as f:
            json.dump(clean_result, f, indent=2, default=str)
        print(f"\n💾 Saved to {args.output}")


if __name__ == "__main__":
    main()
