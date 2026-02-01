#!/usr/bin/env python3
"""
Agentic Conference Scraper

Multi-step agent that explores conference websites to extract:
- Links (guides, calls, templates, misc)
- Desk rejection reasons
- Detailed conference info

Uses OpenRouter with free z-ai/glm-4.5-air model
"""

import os
import re
import json
import time
import requests
from datetime import datetime
from typing import Optional, Dict, List, Any, Set
from urllib.parse import urljoin, urlparse
from html.parser import HTMLParser

from openai import OpenAI


class HTMLTextExtractor(HTMLParser):
    """Extract readable text from HTML"""
    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self.skip_text = False
        self.skip_all = False
        # Skip text from nav/footer (noisy) but still capture their links
        self.skip_text_tags = {'nav', 'footer'}
        # Skip everything from these (no useful content)
        self.skip_all_tags = {'script', 'style', 'meta', 'link', 'noscript'}
        self.current_href = None

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower in self.skip_all_tags:
            self.skip_all = True
        if tag_lower in self.skip_text_tags:
            self.skip_text = True
        if tag_lower == 'a':
            for attr, value in attrs:
                if attr == 'href' and value:
                    self.current_href = value

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self.skip_all_tags:
            self.skip_all = False
        if tag_lower in self.skip_text_tags:
            self.skip_text = False
        if tag_lower == 'a':
            self.current_href = None

    def handle_data(self, data):
        if self.skip_all:
            return
        text = data.strip()
        if text:
            # Always capture links (even from nav)
            if self.current_href:
                self.links.append({"text": text, "href": self.current_href})
            # Only add to main text if not in nav/footer
            if not self.skip_text:
                self.text.append(text)

    def get_text(self):
        return ' '.join(self.text)

    def get_links(self):
        return self.links


def extract_page_content(html: str, base_url: str) -> Dict:
    """Extract text and links from HTML"""
    try:
        parser = HTMLTextExtractor()
        parser.feed(html)

        # Resolve relative URLs
        links = []
        for link in parser.get_links():
            href = link["href"]
            if href.startswith("#"):
                continue
            if not href.startswith("http"):
                href = urljoin(base_url, href)
            links.append({"text": link["text"], "url": href})

        text = re.sub(r'\s+', ' ', parser.get_text())
        return {"text": text[:20000], "links": links}  # Limit text size
    except:
        return {"text": "", "links": []}


class AgentScraper:
    """Agentic scraper for conference websites"""

    # Common URL patterns for conference sites (JS dropdowns won't be captured)
    # Include many variations since 404s are cheap
    COMMON_PATHS = [
        # Author info (CVPR=AuthorGuidelines, ICML=AuthorInstructions, NeurIPS=AuthorInfo)
        "AuthorGuidelines", "AuthorInstructions", "AuthorInfo", "Author-Guidelines",
        "author-guidelines", "author-instructions", "authors", "for-authors",
        "submission-guidelines", "SubmissionGuidelines", "paper-submission",

        # Call for papers
        "CallForPapers", "Call-For-Papers", "call-for-papers", "cfp", "CFP",
        "CallForAbstracts", "call-for-abstracts",

        # Submission
        "Submission", "submission", "submit", "Submit", "paper-submission",
        "SubmissionSite", "submission-site", "openreview",

        # Dates & deadlines
        "Dates", "dates", "important-dates", "ImportantDates", "Deadlines", "deadlines",
        "key-dates", "KeyDates", "timeline", "Timeline",

        # Registration
        "Registration", "registration", "register", "Register", "attend",

        # Workshops & tutorials
        "Workshops", "workshops", "CallForWorkshops", "workshop-proposals",
        "Tutorials", "tutorials", "CallForTutorials",

        # Reviewer info
        "Reviewers", "reviewers", "ReviewerGuidelines", "reviewer-guidelines",
        "ReviewerInstructions", "for-reviewers",

        # Program & schedule
        "Program", "program", "schedule", "Schedule", "accepted-papers",
        "AcceptedPapers", "papers", "proceedings",

        # Policies
        "Policies", "policies", "ethics", "Ethics", "code-of-conduct",
        "DeskRejectPolicy", "desk-reject", "FAQ", "faq",
    ]

    def __init__(self):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable not set")

        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        self.model = "google/gemini-2.0-flash-001"

    def generate_seed_urls(self, base_url: str) -> List[str]:
        """Generate common conference URLs to try (for JS-heavy sites)"""
        seeds = [base_url]
        base = base_url.rstrip('/')

        for path in self.COMMON_PATHS:
            seeds.append(f"{base}/{path}")

        return seeds

    def fetch_page(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch webpage content"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
            response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"    ❌ Fetch failed: {url} - {e}")
            return None

    def is_same_domain(self, url: str, base_domain: str) -> bool:
        """Check if URL is on same domain"""
        try:
            parsed = urlparse(url)
            return base_domain in parsed.netloc
        except:
            return False

    def llm_call(self, prompt: str, retry: int = 2) -> Optional[str]:
        """Call LLM with retry"""
        for attempt in range(retry):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    max_tokens=1500
                )
                content = response.choices[0].message.content
                if content:
                    return content
                print(f"   ⚠️ Empty response from LLM")
            except Exception as e:
                print(f"   ⚠️ LLM error (attempt {attempt + 1}): {type(e).__name__}: {str(e)[:100]}")
                time.sleep(1)
        return None

    def parse_json_response(self, text: str) -> Optional[Dict]:
        """Parse JSON from LLM response"""
        if not text:
            return None
        try:
            text = text.strip()

            # Remove markdown code blocks
            text = re.sub(r"^```json?\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text)
            text = text.strip()

            # Find JSON object
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                json_str = text[start:end]
                return json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"   JSON error: {e}")
        except Exception as e:
            print(f"   Parse error: {e}")
        return None

    def extract_from_page(self, page_content: Dict, current_url: str, verbose: bool = False) -> Dict:
        """Extract info from page, chunking if text is too long"""

        text = page_content["text"]
        links = page_content["links"]
        links_str = "\n".join([f"- {l['text'][:50]}: {l['url']}" for l in links[:50]])

        if verbose:
            print(f"\n      📝 Text: {len(text)} chars, Links: {len(links)}")

        CHUNK_SIZE = 12000
        OVERLAP = 500

        # Split into chunks if text is long
        if len(text) > CHUNK_SIZE:
            chunks = []
            start = 0
            while start < len(text):
                end = min(start + CHUNK_SIZE, len(text))
                chunks.append(text[start:end])
                start = end - OVERLAP  # Overlap to avoid cutting mid-sentence
                if start >= len(text) - OVERLAP:
                    break
            if verbose:
                print(f"      📄 Split into {len(chunks)} chunks")
        else:
            chunks = [text]

        # Process each chunk and merge results
        merged = {
            "submission": None,
            "template": None,
            "registration": None,
            "author_guide": None,
            "cfp": None,
            "workshops": None,
            "desk_reject_reasons": [],
            "next_urls": []
        }

        for i, chunk in enumerate(chunks):
            if verbose:
                print(f"      🔄 Chunk {i+1}/{len(chunks)} ({len(chunk)} chars)...")

            prompt = f"""Find conference links on this page. Return ONLY valid JSON.

URL: {current_url}

TEXT (part {i+1}/{len(chunks)}):
{chunk}

LINKS ON PAGE:
{links_str}

Extract and return JSON:
{{
  "submission": "submission/openreview URL or null",
  "template": "latex template URL or null",
  "registration": "registration URL or null",
  "author_guide": "author guidelines URL or null",
  "cfp": "call for papers URL or null",
  "workshops": "workshops URL or null",
  "desk_reject_reasons": ["list of rejection reasons if found"],
  "next_urls": ["1-2 URLs worth visiting next"]
}}"""

            response = self.llm_call(prompt)
            if not response:
                if verbose:
                    print(f"      ❌ No LLM response!")
                continue

            result = self.parse_json_response(response)
            if not result:
                if verbose:
                    print(f"      ❌ JSON parse failed!")
                    print(f"      Response: {response[:300]}...")
                continue

            if verbose:
                print(f"      ✅ Parsed: {list(k for k,v in result.items() if v)}")

            # Merge results - take first non-null for links
            for key in ["submission", "template", "registration", "author_guide", "cfp", "workshops"]:
                if not merged[key] and result.get(key):
                    merged[key] = result[key]

            # Append lists (deduplicated)
            for reason in result.get("desk_reject_reasons", []):
                if reason and reason not in merged["desk_reject_reasons"]:
                    merged["desk_reject_reasons"].append(reason)

            for url in result.get("next_urls", []):
                if url and url not in merged["next_urls"]:
                    merged["next_urls"].append(url)

        return merged

    def scrape(self, conference: str, start_urls: List[str], max_steps: int = 12, auto_seed: bool = True, verbose: bool = False) -> Dict:
        """
        Main agentic scraping loop

        Args:
            conference: Conference name (e.g., "CVPR 2026")
            start_urls: Initial URLs to explore
            max_steps: Maximum exploration steps
            auto_seed: Auto-generate common conference URLs (for JS-heavy sites)

        Returns:
            Extracted data dictionary
        """
        # Get base domain from first URL
        base_domain = urlparse(start_urls[0]).netloc

        # Build initial URL list
        urls_to_visit = list(start_urls)
        if auto_seed:
            # Add common conference URL patterns
            seed_urls = self.generate_seed_urls(start_urls[0])
            for url in seed_urls:
                if url not in urls_to_visit:
                    urls_to_visit.append(url)
            print(f"🌱 Auto-seeded {len(seed_urls)} common URLs")

        state = {
            "conference": conference,
            "steps": 0,
            "max_steps": max_steps,
            "visited": set(),
            "to_visit": urls_to_visit,
            "extracted": {
                "links": {
                    "official": start_urls[0] if start_urls else None,
                    "submission": None,
                    "template": None,
                    "registration": None,
                    "guides": {},
                    "calls": {},
                    "misc": []
                },
                "desk_reject_reasons": [],
                "info": {}
            }
        }

        print(f"\n🤖 Agent: {conference} (max {max_steps} pages)")

        failed_attempts = 0
        max_failed = 20  # Stop after too many consecutive 404s

        while state["steps"] < max_steps and state["to_visit"] and failed_attempts < max_failed:
            url = state["to_visit"].pop(0)

            # Skip visited or external
            if url in state["visited"]:
                continue
            if not self.is_same_domain(url, base_domain):
                continue

            state["visited"].add(url)

            # Fetch (don't count 404s as steps!)
            html = self.fetch_page(url)
            if not html:
                failed_attempts += 1
                # Don't print every 404, just show a dot
                print(".", end="", flush=True)
                continue

            # Reset fail counter on success
            failed_attempts = 0
            state["steps"] += 1

            print(f"\n   [{state['steps']}] {url[:65]}...", end=" ")

            # Extract
            page_content = extract_page_content(html, url)
            extracted = self.extract_from_page(page_content, url, verbose=verbose)

            if extracted:
                # Merge links
                if extracted.get("submission"):
                    state["extracted"]["links"]["submission"] = extracted["submission"]
                if extracted.get("template"):
                    state["extracted"]["links"]["template"] = extracted["template"]
                if extracted.get("registration"):
                    state["extracted"]["links"]["registration"] = extracted["registration"]
                if extracted.get("author_guide"):
                    state["extracted"]["links"]["guides"]["author"] = extracted["author_guide"]
                if extracted.get("reviewer_guide"):
                    state["extracted"]["links"]["guides"]["reviewer"] = extracted["reviewer_guide"]
                if extracted.get("cfp"):
                    state["extracted"]["links"]["calls"]["papers"] = extracted["cfp"]
                if extracted.get("workshops"):
                    state["extracted"]["links"]["calls"]["workshops"] = extracted["workshops"]

                # Desk reject reasons
                for reason in extracted.get("desk_reject_reasons", []):
                    if reason and reason not in state["extracted"]["desk_reject_reasons"]:
                        state["extracted"]["desk_reject_reasons"].append(reason)

                # Queue next URLs at FRONT (priority over guessed patterns)
                for next_url in reversed(extracted.get("next_urls", [])[:3]):
                    if next_url and next_url not in state["visited"]:
                        state["to_visit"].insert(0, next_url)

                print("✅")
            else:
                print("⚠️")

            time.sleep(0.2)  # Lighter rate limit

        # Summary
        links = state["extracted"]["links"]
        found = sum(1 for v in [links["submission"], links["template"], links["registration"]] if v)
        found += len(links["guides"]) + len(links["calls"])

        print(f"\n📊 Agent Summary:")
        print(f"   Steps taken: {state['steps']}")
        print(f"   Pages visited: {len(state['visited'])}")
        print(f"   Links found: {found}")
        print(f"   Desk reject reasons: {len(state['extracted']['desk_reject_reasons'])}")

        return state["extracted"]


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Agentic conference scraper")
    parser.add_argument("--conference", type=str, required=True, help="Conference name (e.g., 'CVPR 2026')")
    parser.add_argument("--urls", type=str, required=True, help="Comma-separated starting URLs")
    parser.add_argument("--max-steps", type=int, default=12, help="Max exploration steps")
    parser.add_argument("--output", type=str, help="Output JSON file")
    args = parser.parse_args()

    scraper = AgentScraper()

    urls = [u.strip() for u in args.urls.split(",")]
    result = scraper.scrape(args.conference, urls, args.max_steps)

    # Output
    print("\n📋 Extracted Data:")
    print(json.dumps(result, indent=2))

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\n💾 Saved to {args.output}")


if __name__ == "__main__":
    main()
