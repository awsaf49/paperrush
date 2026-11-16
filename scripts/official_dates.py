"""Extract explicit main-track deadlines from official HTML without an LLM."""

import re
from datetime import datetime

from bs4 import BeautifulSoup

from scraper_to_datajs import canonical_main_milestone, infer_deadline_type


MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE = re.compile(
    rf"\b(?:20\d{{2}}-\d{{2}}-\d{{2}}|{MONTH}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?[,]?\s+(?:20\d{{2}}|['\u2019]\d{{2}})|\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH}\.?[,]?\s+20\d{{2}})\b",
    re.I,
)
EXCLUDED = re.compile(
    r"workshop|tutorial|industry|doctoral|demo|dataset|benchmark|position|sponsor|round|cycle|resubmission",
    re.I,
)


def parse_explicit_date(text, year):
    """Reject ambiguous ranges, missing years, and dates from another edition."""
    matches = list(DATE.finditer(text))
    if len(matches) != 1:
        return None
    value = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", matches[0].group(), flags=re.I)
    value = value.replace("\u2019", "'").replace(",", "").replace(".", "")
    value = re.sub(r"\bSept\b", "Sep", value, flags=re.I)
    parsed = None
    for fmt in ("%Y-%m-%d", "%b %d %Y", "%B %d %Y", "%b %d '%y", "%B %d '%y", "%d %b %Y", "%d %B %Y"):
        try:
            parsed = datetime.strptime(value, fmt)
            break
        except ValueError:
            pass
    if not parsed or not year - 1 <= parsed.year <= year:
        return None
    # Do not silently reduce a date range to its last endpoint.
    prefix = text[:matches[0].start()]
    if re.search(r"\d\s*[-\u2013\u2014]\s*$", prefix):
        return None
    result = {"date": parsed.strftime("%Y-%m-%d"), "time": None, "timezone": None}
    if re.search(r"\bAoE\b|Anywhere on Earth", text, re.I):
        result.update(time="23:59", timezone="AoE")
    else:
        clock = re.search(r"\b(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?\s*(UTC|GMT|PST|PDT|EST|EDT|CET|CEST|JST)\b", text, re.I)
        if clock:
            fmt = "%I:%M %p" if clock[2] else "%H:%M"
            try:
                time = datetime.strptime(f"{clock[1]} {clock[2]}".strip() if clock[2] else clock[1], fmt)
            except ValueError:
                return None
            result.update(time=time.strftime("%H:%M"), timezone=clock[3].upper())
    return result


def main_label(text):
    label = " ".join(text.split()).strip(" :*")
    if EXCLUDED.search(label):
        return None
    if label.lower() in {"submission deadline", "submissions deadline", "submission", "paper submissions"}:
        label = "Paper Submission"
    milestone = canonical_main_milestone({"type": infer_deadline_type(label), "label": label})
    if milestone:
        return "Abstract Submission" if milestone == "abstract" else "Paper Submission"
    return None


def extract_official_deadlines(html, url, year):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.select("script, style, del, s, nav, footer, header"):
        tag.decompose()
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    # A redirect or reused prior-year page is not evidence for this edition.
    title_years = set(re.findall(r"\b20\d{2}\b", title))
    if title_years and str(year) not in title_years:
        return []
    explicit_year = re.search(r"\ball dates are in (20\d{2})\b", soup.get_text(" ", strip=True), re.I)
    found = {}

    def add(label, date_text):
        event = main_label(label)
        if explicit_year and int(explicit_year[1]) == year and not DATE.search(date_text):
            # COLT explicitly states a shared year for the whole deadline list.
            if not re.search(r"\b20\d{2}\b|\d\s*[-\u2013\u2014]\s*\d", date_text):
                date_text = re.sub(rf"\b({MONTH}\.?\s+\d{{1,2}})\b", rf"\1 {year}", date_text, count=1, flags=re.I)
        parsed = parse_explicit_date(date_text, year)
        if event and parsed:
            deadline = {"event": event, **parsed, "sourceUrl": url}
            # Conflicting sources/rounds must go through the normal quarantine.
            key = (event, parsed["date"], parsed["time"], parsed["timezone"])
            found[key] = deadline

    for table in soup.find_all("table"):
        heading = table.find_previous(re.compile(r"^h[1-6]$"))
        section = heading.get_text(" ", strip=True) if heading else ""
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"], recursive=False)
            texts = [cell.get_text(" ", strip=True) for cell in cells]
            nonempty = [text for text in texts if text]
            if len(nonempty) == 1:
                section = nonempty[0]
                continue
            if EXCLUDED.search(section):
                continue
            # Pair only cells in the same row; never guess dates across rows.
            for label in texts:
                if main_label(label):
                    for date_text in texts:
                        add(label, date_text)

    for item in soup.find_all(["li", "p"]):
        if item.find_parent("table") or item.find(["li", "p", "table"]):
            continue
        text = item.get_text(" ", strip=True)
        parts = re.split(r"\s*:\s*|\s+[\u2013\u2014]\s+", text, maxsplit=1)
        if len(parts) == 2:
            heading = item.find_previous(re.compile(r"^h[1-6]$"))
            if not heading or not EXCLUDED.search(heading.get_text(" ", strip=True)):
                add(*parts)
    return list(found.values())
