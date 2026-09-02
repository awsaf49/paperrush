import ast
import json
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_from_scraper import (
    all_deadlines_passed,
    bump_year_in_url,
    create_estimated_from_existing,
    merge_conferences,
    parse_date_for_comparison,
    shift_iso_year,
)
from validate_data import find_stale_warnings, validate_conferences
from scraper_to_datajs import (
    build_location,
    convert_conference_event,
    convert_date_time,
    infer_deadline_type,
    normalize_datajs_deadlines,
    timezone_to_offset,
)


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
            "category": "ml",
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

    def test_merge_retains_an_older_edition_with_an_upcoming_event(self):
        existing = [{
            "id": "sample-2026",
            "name": "SAMPLE",
            "year": 2026,
            "deadlines": [{
                "type": "conference",
                "label": "Main Conference",
                "date": "2026-09-10",
                "endDate": "2026-09-12",
                "estimated": False,
            }],
        }]
        future_placeholder = [{
            "id": "sample-2027",
            "name": "SAMPLE",
            "year": 2027,
            "deadlines": [],
            "datesTBD": True,
            "isEstimated": True,
        }]

        merged = merge_conferences(existing, future_placeholder)

        self.assertEqual(
            sorted(conference["id"] for conference in merged),
            ["sample-2026", "sample-2027"],
        )

    def test_confirmed_scrape_replaces_same_edition_estimate(self):
        existing = [{
            "id": "sample-2027", "name": "SAMPLE", "year": 2027,
            "deadlines": [{
                "type": "paper", "label": "Paper Submission",
                "date": "2026-09-24", "estimated": True,
            }],
            "isEstimated": True,
        }]
        scraped = [{
            "id": "sample-2027", "name": "SAMPLE", "year": 2027,
            "deadlines": [{
                "type": "paper", "label": "Paper Submission",
                "date": "2026-09-28", "estimated": False,
            }],
            "isEstimated": False,
        }]

        merged = merge_conferences(existing, scraped)

        self.assertEqual(merged[0]["deadlines"][0]["date"], "2026-09-28")
        self.assertFalse(merged[0]["deadlines"][0]["estimated"])

    def test_estimate_cannot_replace_confirmed_same_edition_data(self):
        existing = [{
            "id": "iclr-2027", "name": "ICLR", "year": 2027,
            "deadlines": [{
                "type": "abstract", "label": "Abstract Submission",
                "date": "2026-09-18T23:59:00-12:00", "estimated": False,
            }],
            "isEstimated": False,
        }]
        estimated = [{
            "id": "iclr-2027", "name": "ICLR", "year": 2027,
            "deadlines": [{
                "type": "abstract", "label": "Abstract Submission",
                "date": "2026-09-19T23:59:00-12:00", "estimated": True,
            }],
            "isEstimated": True,
        }]

        merged = merge_conferences(existing, estimated)

        self.assertEqual(merged[0]["deadlines"][0]["date"], "2026-09-18T23:59:00-12:00")
        self.assertFalse(merged[0]["deadlines"][0]["estimated"])

    def test_two_digit_aaai_url_rolls_forward(self):
        url = "https://aaai.org/conference/aaai/aaai-26/"

        self.assertEqual(
            bump_year_in_url(url, 2026, 2027),
            "https://aaai.org/conference/aaai/aaai-27/",
        )

    def test_specific_deadline_types_beat_generic_paper_word(self):
        self.assertEqual(infer_deadline_type("Paper Acceptance Notification"), "notification")
        self.assertEqual(infer_deadline_type("Camera-Ready Paper Submission"), "camera")
        self.assertEqual(infer_deadline_type("Paper Registration Deadline"), "abstract")
        self.assertEqual(infer_deadline_type("Workshop Paper Submission"), "workshop")
        self.assertEqual(infer_deadline_type("Poster Submissions Deadline"), "event")

    def test_poster_submission_does_not_keep_main_paper_cycle_open(self):
        conference = {
            "deadlines": [
                {
                    "type": "paper",
                    "label": "Paper Submission",
                    "date": "2026-05-29T23:59:00-12:00",
                },
                {
                    "type": "paper",
                    "label": "Poster Submissions Deadline",
                    "date": "2026-10-30T23:59:00-12:00",
                },
            ]
        }

        self.assertTrue(
            all_deadlines_passed(
                conference, datetime(2026, 7, 26, 12, tzinfo=timezone.utc)
            )
        )

    def test_aoe_without_an_extracted_time_uses_end_of_day(self):
        self.assertEqual(convert_date_time("2027-03-07", "23:59", None), "2027-03-07")
        self.assertEqual(
            convert_date_time("2027-03-07", None, "AoE"),
            "2027-03-07T23:59:00-12:00",
        )
        self.assertEqual(convert_date_time("2027-03-07", None, None), "2027-03-07")
        self.assertEqual(
            convert_date_time("2027-03-07", "23:59", "AoE"),
            "2027-03-07T23:59:00-12:00",
        )

    def test_generic_pacific_time_uses_date_aware_dst_offset(self):
        self.assertEqual(timezone_to_offset("PT", "2026-01-15"), "-08:00")
        self.assertEqual(timezone_to_offset("PT", "2026-07-15"), "-07:00")

    def test_structured_conference_range_becomes_filterable_event(self):
        event = convert_conference_event({
            "location": {
                "start_date": "2026-09-27",
                "end_date": "2026-10-01",
            }
        })

        self.assertEqual(event["type"], "conference")
        self.assertEqual(event["date"], "2026-09-27")
        self.assertEqual(event["endDate"], "2026-10-01")

    def test_static_metadata_cannot_leak_an_old_location_into_a_new_edition(self):
        location = build_location(
            {"location": {}},
            {"location": {"city": "Old City", "country": "USA"}},
        )

        self.assertEqual(location["city"], "TBD")
        self.assertEqual(location["country"], "TBD")

    def test_equivalent_timezone_records_are_deduplicated(self):
        normalized = normalize_datajs_deadlines([
            {
                "type": "paper",
                "label": "Doctoral Consortium Submission Deadline",
                "date": "2026-12-20T23:59:00-07:00",
            },
            {
                "type": "paper",
                "label": "Doctoral Consortium Submission Deadline",
                "date": "2026-12-21T06:59:00+00:00",
            },
        ])

        self.assertEqual(len(normalized), 1)

    def test_validator_rejects_unsafe_links_and_wrong_types(self):
        conference = {
            "id": "sample-2027",
            "name": "SAMPLE",
            "year": 2027,
            "category": "ml",
            "website": "javascript:alert(1)",
            "deadlines": [{
                "type": "paper",
                "label": "Paper Acceptance Notification",
                "date": "2027-03-01",
            }],
        }

        errors = validate_conferences([conference])

        self.assertTrue(any("unsafe website URL" in error for error in errors))
        self.assertTrue(any("expected 'notification'" in error for error in errors))

    def test_estimated_rollover_shifts_dates_and_labels_previous_source(self):
        placeholder = create_estimated_from_existing({
            "id": "sample-2026",
            "name": "SAMPLE",
            "year": 2026,
            "category": "ml",
            "website": "https://example.com/2026",
            "location": {"city": "Old City", "country": "USA"},
            "deadlines": [{"type": "paper", "label": "Paper", "date": "2026-01-01"}],
            "links": {"author": "https://example.com/2026/authors"},
            "info": {"pageLimit": "8 pages"},
        }, 2027)

        self.assertEqual(placeholder["deadlines"][0]["date"], "2027-01-01")
        self.assertTrue(placeholder["deadlines"][0]["estimated"])
        self.assertEqual(
            placeholder["links"],
            {"previousEdition": "https://example.com/2026"},
        )
        self.assertEqual(placeholder["info"], {})
        self.assertEqual(placeholder["location"]["city"], "TBD")

    def test_iso_year_shift_handles_leap_day_and_offsets(self):
        self.assertEqual(shift_iso_year("2024-02-29", 1), "2025-02-28")
        self.assertEqual(
            shift_iso_year("2025-09-24T23:59:00-12:00", 1),
            "2026-09-24T23:59:00-12:00",
        )

    def test_validator_rejects_cross_edition_metadata(self):
        conference = {
            "id": "sample-2027",
            "name": "SAMPLE",
            "year": 2027,
            "category": "ml",
            "website": "https://example.com/2026",
            "info": {"conferenceName": "Sample Conference 2026"},
            "deadlines": [],
        }

        errors = validate_conferences([conference])

        self.assertTrue(any("website URL references another edition" in error for error in errors))
        self.assertTrue(any("conferenceName references another edition" in error for error in errors))

    def test_validator_accepts_explicit_previous_edition_evidence(self):
        conference = {
            "id": "sample-2027",
            "name": "SAMPLE",
            "year": 2027,
            "category": "ml",
            "website": "",
            "links": {"previousEdition": "https://example.com/2026"},
            "info": {},
            "isEstimated": True,
            "deadlines": [{
                "type": "paper",
                "label": "Paper Submission",
                "date": "2027-05-01",
                "estimated": True,
            }],
        }

        self.assertEqual(validate_conferences([conference]), [])

    def test_validator_rejects_mislabeled_previous_edition_evidence(self):
        conference = {
            "id": "sample-2027",
            "name": "SAMPLE",
            "year": 2027,
            "category": "ml",
            "website": "",
            "links": {"previousEdition": "https://example.com/2027"},
            "info": {},
            "isEstimated": True,
            "deadlines": [{
                "type": "paper",
                "label": "Paper Submission",
                "date": "2027-05-01",
                "estimated": True,
            }],
        }

        errors = validate_conferences([conference])

        self.assertTrue(any("must reference an older edition" in error for error in errors))

    def test_new_conferences_are_covered_by_scraper_and_weekly_workflow(self):
        required = {"ijcai", "mlsys", "corl", "colt", "miccai", "bmvc", "3dv"}

        scraper_tree = ast.parse((ROOT / "scripts" / "scraper.py").read_text())
        scraper_configs = None
        for node in scraper_tree.body:
            if not isinstance(node, ast.Assign):
                continue
            if any(isinstance(target, ast.Name) and target.id == "CONFERENCES"
                   for target in node.targets):
                scraper_configs = ast.literal_eval(node.value)
                break

        self.assertIsNotNone(scraper_configs)
        self.assertTrue(required.issubset(scraper_configs))

        workflow = (ROOT / ".github" / "workflows" / "update-deadlines.yml").read_text()
        match = re.search(r"ALL_CONFERENCES:\s*'([^']+)'", workflow)
        self.assertIsNotNone(match)
        workflow_conferences = set(match.group(1).split(","))
        self.assertEqual(workflow_conferences, set(scraper_configs))

        metadata = json.loads((ROOT / "scripts" / "conference_metadata.json").read_text())
        self.assertTrue(required.issubset(metadata))


if __name__ == "__main__":
    unittest.main()
