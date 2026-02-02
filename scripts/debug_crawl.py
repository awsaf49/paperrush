#!/usr/bin/env python3
"""Debug script - see full crawl and LLM output"""

import os
import re
import json
import requests
from urllib.parse import urljoin
from html.parser import HTMLParser
from openai import OpenAI


class HTMLTextExtractor(HTMLParser):
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


def fetch_and_parse(url):
    """Fetch URL and extract text + links"""
    print(f"\n{'='*60}")
    print(f"FETCHING: {url}")
    print('='*60)

    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    resp = requests.get(url, headers=headers, timeout=15)
    html = resp.text

    print(f"HTML length: {len(html)} chars")

    parser = HTMLTextExtractor()
    parser.feed(html)

    text = ' '.join(parser.text)
    text = re.sub(r'\s+', ' ', text)

    links = []
    for link in parser.links:
        href = link["href"]
        if href.startswith("#"):
            continue
        if not href.startswith("http"):
            href = urljoin(url, href)
        links.append({"text": link["text"][:50], "url": href})

    print(f"\nEXTRACTED TEXT ({len(text)} chars):")
    print("-"*40)
    print(text[:3000])
    print("..." if len(text) > 3000 else "")

    print(f"\nLINKS FOUND ({len(links)}):")
    print("-"*40)
    for l in links[:20]:
        print(f"  - {l['text'][:30]}: {l['url'][:60]}")

    return text, links


def call_llm(text, links, url):
    """Call LLM with chunking for long pages"""
    print(f"\n{'='*60}")
    print("LLM CALL (CHUNKED)")
    print('='*60)

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ.get("OPENROUTER_API_KEY")
    )

    links_str = "\n".join([f"- {l['text'][:50]}: {l['url']}" for l in links[:50]])

    # Chunking parameters
    CHUNK_SIZE = 12000
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
        print(f"📄 Text ({len(text)} chars) split into {len(chunks)} chunks")
    else:
        chunks = [text]
        print(f"📄 Text ({len(text)} chars) - single chunk")

    # Merged results
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
        print(f"\n{'='*60}")
        print(f"CHUNK {i+1}/{len(chunks)} ({len(chunk)} chars)")
        print('='*60)

        prompt = f"""Find conference links on this page. Return ONLY valid JSON.

URL: {url}

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

        print(f"PROMPT LENGTH: {len(prompt)} chars")

        response = client.chat.completions.create(
            model="meta-llama/llama-3.3-70b-instruct:free",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=1500
        )

        content = response.choices[0].message.content
        print(f"\nLLM RESPONSE:")
        print("-"*40)
        print(content)

        # Parse JSON
        try:
            clean = content.strip()
            clean = re.sub(r"^```json?\s*\n?", "", clean)
            clean = re.sub(r"\n?```\s*$", "", clean)

            start_idx = clean.find("{")
            end_idx = clean.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_str = clean[start_idx:end_idx]
                result = json.loads(json_str)
                print(f"\n✅ Parsed successfully")

                # Merge results
                for key in ["submission", "template", "registration", "author_guide", "cfp", "workshops"]:
                    if not merged[key] and result.get(key):
                        merged[key] = result[key]
                        print(f"   Found {key}: {result[key][:60]}...")

                for reason in result.get("desk_reject_reasons", []):
                    if reason and reason not in merged["desk_reject_reasons"]:
                        merged["desk_reject_reasons"].append(reason)

                for next_url in result.get("next_urls", []):
                    if next_url and next_url not in merged["next_urls"]:
                        merged["next_urls"].append(next_url)
        except Exception as e:
            print(f"\n❌ Parse failed: {e}")

    # Final merged result
    print(f"\n{'='*60}")
    print("FINAL MERGED RESULT")
    print('='*60)
    print(json.dumps(merged, indent=2))

    return merged


def main():
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else "https://cvpr.thecvf.com/Conferences/2026/AuthorGuidelines"

    text, links = fetch_and_parse(url)
    call_llm(text, links, url)


if __name__ == "__main__":
    main()
