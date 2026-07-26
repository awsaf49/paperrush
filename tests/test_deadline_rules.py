import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_from_scraper import (
    all_deadlines_passed,
    bump_year_in_url,
    merge_conferences,
    parse_date_for_comparison,
)
from validate_data import find_stale_warnings, validate_conferences


class DeadlineRolloverTests(unittest.TestCase):
    def test_future_conference_date_does_not_block_rollover(self):
        conference = {
            "deadlines": [
                {
                    "type": "paper",
                    "label": "Paper Submission",
                    "date": "2025-08-01T23:59:00-12:00",
                },
                {
                    "type": "event",
                    "label": "AAAI Conference",
                    "date": "2026-02-17",
                },
            ]
        }

        now = datetime(2025, 8, 2, 12, tzinfo=timezone.utc)

        self.assertTrue(all_deadlines_passed(conference, now))

    def test_aoe_deadline_keeps_its_timezone(self):
        parsed = parse_date_for_comparison("2026-07-28T23:59:00-12:00")

        self.assertEqual(parsed.isoformat(), "2026-07-29T11:59:00+00:00")

    def test_validator_reports_stale_edition(self):
        conference = {
            "id": "aaai-2026",
            "name": "AAAI",
            "year": 2026,
            "deadlines": [
                {
                    "type": "paper",
                    "label": "Paper Submission",
                    "date": "2025-08-01T23:59:00-12:00",
                },
                {
                    "type": "event",
                    "label": "AAAI Conference",
                    "date": "2026-02-17",
                },
            ],
        }
        now = datetime(2025, 8, 2, 12, tzinfo=timezone.utc)

        errors = validate_conferences([conference], now)
        warnings = find_stale_warnings([conference], now)

        self.assertEqual(errors, [])
        self.assertTrue(any("submission window is closed" in warning for warning in warnings))

    def test_merge_never_reintroduces_an_older_edition(self):
        existing = [{"id": "aaai-2027", "name": "AAAI", "year": 2027}]
        scraped = [{"id": "aaai-2026", "name": "AAAI", "year": 2026}]

        merged = merge_conferences(existing, scraped)

        self.assertEqual([conference["id"] for conference in merged], ["aaai-2027"])

    def test_two_digit_aaai_url_rolls_forward(self):
        url = "https://aaai.org/conference/aaai/aaai-26/"

        self.assertEqual(
            bump_year_in_url(url, 2026, 2027),
            "https://aaai.org/conference/aaai/aaai-27/",
        )


if __name__ == "__main__":
    unittest.main()
