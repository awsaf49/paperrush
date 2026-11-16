import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from official_dates import extract_official_deadlines, parse_explicit_date
import refresh_conferences
from refresh_conferences import refresh_one, target_year
from update_from_scraper import merge_date_only_update


URL = "https://cvpr.thecvf.com/Conferences/2027/Dates"
HTML = """<title>2027 Dates and Deadlines</title><h2>Dates and Deadlines</h2>
<table><tr><td colspan="4">Paper Submissions</td></tr>
<tr><td></td><td>Paper Registration Deadline</td><td>Nov 10 '26 (Anywhere on Earth)</td></tr>
<tr><td></td><td>Submission Deadline</td><td>Nov 16 '26 (Anywhere on Earth)</td></tr>
<tr><td colspan="4">Workshops</td></tr>
<tr><td>Submission Deadline</td><td>Nov 01 '26 (Anywhere on Earth)</td></tr></table>"""


class OfficialDateTests(unittest.TestCase):
    def test_official_table_preserves_aoe_and_ignores_workshops(self):
        dates = extract_official_deadlines(HTML, URL, 2027)
        self.assertEqual(len(dates), 2)
        self.assertEqual(dates[1], {"event": "Paper Submission", "date": "2026-11-16",
                                  "time": "23:59", "timezone": "AoE", "sourceUrl": URL})

    def test_rejects_missing_year_multiple_dates_and_wrong_cycle(self):
        for value in ("Nov 16", "2023-11-16", "Jan 8, 2027 - Jan 14, 2027", "January 8-14, 2027", "January 32, 2027"):
            self.assertIsNone(parse_explicit_date(value, 2027), value)

    def test_keeps_date_only_when_clock_is_not_published(self):
        self.assertEqual(parse_explicit_date("January 14, 2027", 2027),
                         {"date": "2027-01-14", "time": None, "timezone": None})

    def test_explicit_clock_and_local_timezone(self):
        parsed = parse_explicit_date("Jan 14 '27 05:00 PM PST", 2027)
        self.assertEqual(parsed["time"], "17:00")
        self.assertEqual(parsed["timezone"], "PST")

    def test_ignores_redirected_prior_edition_title(self):
        self.assertEqual(extract_official_deadlines(HTML.replace("2027 Dates", "2026 Dates"), URL, 2027), [])

    def test_removes_struck_through_old_deadline(self):
        html = '<title>2027</title><table><tr><td>Paper Deadline</td><td><del>Jan 8, 2027</del> Jan 22, 2027</td></tr></table>'
        self.assertEqual(extract_official_deadlines(html, URL, 2027)[0]["date"], "2027-01-22")

    def test_opening_and_track_specific_dates_are_not_main_deadlines(self):
        for label in ("Paper Submission Opens", "Workshop Paper Submission", "Round 1 Paper Submission", "Position Paper Submission"):
            html = f'<table><tr><td>{label}</td><td>Jan 14, 2027</td></tr></table>'
            self.assertEqual(extract_official_deadlines(html, URL, 2027), [])

    def test_conflicting_rows_are_preserved_for_quarantine(self):
        html = '<table><tr><td>Paper Deadline</td><td>Jan 14, 2027</td></tr><tr><td>Paper Deadline</td><td>Jan 22, 2027</td></tr></table>'
        self.assertEqual(len(extract_official_deadlines(html, URL, 2027)), 2)

    def test_list_deadlines_are_supported(self):
        html = '<h2>Important Dates</h2><ul><li>Abstract submission deadline: September 18, 2026 (AoE)</li></ul>'
        self.assertEqual(extract_official_deadlines(html, URL, 2027)[0]["date"], "2026-09-18")

    def test_currently_tracked_edition_wins_over_utc_year(self):
        now = datetime(2026, 11, 16, tzinfo=timezone.utc)
        self.assertEqual(target_year("cvpr", existing=[{"name": "CVPR", "year": 2027}], now=now), 2027)
        self.assertEqual(target_year("eccv", 2027), 2028)

    def test_closed_current_year_edition_moves_to_next_year(self):
        now = datetime(2026, 11, 16, tzinfo=timezone.utc)
        self.assertEqual(target_year("naacl", existing=[{
            "name": "NAACL", "year": 2026, "deadlines": []}], now=now), 2027)

    def test_official_extraction_requires_no_provider(self):
        response = SimpleNamespace(url=URL, text=HTML, raise_for_status=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            with patch("refresh_conferences.source_urls", return_value=[URL]):
                result = refresh_one("cvpr", 2027, directory, [], "none", fetch=lambda *a, **k: response)
            saved = json.loads((Path(directory) / "cvpr.json").read_text())
            self.assertEqual(result["source"], "official-html")
            self.assertTrue(saved["_meta"]["dates_only"])

    def test_cross_edition_redirect_is_not_published(self):
        response = SimpleNamespace(url=URL.replace("2027", "2026"), text=HTML, raise_for_status=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            with patch("refresh_conferences.source_urls", return_value=[URL]):
                result = refresh_one("cvpr", 2027, directory, [], "none", fetch=lambda *a, **k: response)
            self.assertIsNone(result["source"])
            self.assertFalse((Path(directory) / "cvpr.json").exists())

    def test_failed_refresh_removes_stale_input_and_bounds_fallback(self):
        def fail(*args, **kwargs):
            self.assertEqual(kwargs["timeout"], 120)
            self.assertIn("--max-steps", args[0])
            raise subprocess.TimeoutExpired(args[0], 120)

        with tempfile.TemporaryDirectory() as directory:
            stale = Path(directory) / "cvpr.json"
            stale.write_text("{}")
            with patch("refresh_conferences.source_urls", return_value=[]):
                result = refresh_one("cvpr", 2027, directory, [], "openrouter", run_command=fail)
            self.assertIsNone(result["source"])
            self.assertFalse(stale.exists())

    def test_one_unexpected_worker_failure_does_not_stop_other_conferences(self):
        def refresh(conference, *args):
            if conference == "cvpr":
                raise OSError("simulated worker failure")
            return {"conference": conference, "year": 2027, "source": "official-html"}

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "scraped"
            with patch.object(sys, "argv", ["refresh_conferences.py", "--conferences", "cvpr,icml",
                                            "--data", str(ROOT / "js/data.js"), "--output-dir", str(output)]):
                with patch("refresh_conferences.refresh_one", side_effect=refresh):
                    self.assertEqual(refresh_conferences.main(), 0)
            report = json.loads((Path(directory) / "fetch-report.json").read_text())
            self.assertIsNone(report[0]["source"])
            self.assertEqual(report[1]["source"], "official-html")

    def test_sparse_dates_preserve_policies_and_other_milestones(self):
        existing = {"website": "", "links": {"template": "https://example.com"},
                    "info": {"pageLimit": 8}, "notes": ["manual"],
                    "deadlines": [{"type": "paper", "label": "Paper Submission", "date": "2027-01-01"},
                                  {"type": "conference", "label": "Conference", "date": "2027-06-01"}]}
        incoming = {"website": URL, "links": {"dates": URL}, "deadlines": [
            {"type": "paper", "label": "Paper Submission", "date": "2027-01-22"}]}
        result = merge_date_only_update(existing, incoming)
        self.assertEqual(result["info"], existing["info"])
        self.assertEqual(result["notes"], existing["notes"])
        self.assertEqual(result["links"]["template"], "https://example.com")
        self.assertEqual(result["deadlines"][0]["type"], "conference")
        self.assertEqual(existing["deadlines"][0]["date"], "2027-01-01")

    def test_date_only_confirmation_does_not_erase_known_time_precision(self):
        previous = {"type": "paper", "label": "Paper Submission", "date": "2027-01-22T23:59:00-12:00"}
        incoming = {"website": URL, "deadlines": [
            {"type": "paper", "label": "Paper Submission", "date": "2027-01-22", "timeUnknown": True}]}
        result = merge_date_only_update({"deadlines": [previous]}, incoming)
        self.assertEqual(result["deadlines"][0]["date"], previous["date"])
        self.assertNotIn("timeUnknown", result["deadlines"][0])

    def test_offline_conversion_is_repeatable_without_false_freshness(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data.js"
            source = Path(directory) / "cvpr.json"
            # Use a production baseline so browser/data contracts remain realistic.
            data.write_bytes((ROOT / "js/data.js").read_bytes())
            source.write_text(json.dumps({"conference": "CVPR", "year": 2027,
                "links": {"official": URL.rsplit("/", 1)[0], "important_dates": URL},
                "deadlines": extract_official_deadlines(HTML, URL, 2027),
                "_meta": {"successful_extractions": 1, "dates_only": True}}))
            command = [sys.executable, str(ROOT / "scripts/update_from_scraper.py"),
                       "--input", str(source), "--output", str(data), "--merge-source", str(data), "--offline"]
            for attempt in range(2):
                result = subprocess.run(command, capture_output=True, text=True, timeout=20,
                                        env={**os.environ, "PAPERRUSH_SCRAPER_PROVIDER": "none"})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                if attempt == 0:
                    first = data.read_bytes()
                else:
                    self.assertEqual(data.read_bytes(), first)
                    self.assertIn("preserving the published freshness timestamp", result.stdout)


if __name__ == "__main__":
    unittest.main()
