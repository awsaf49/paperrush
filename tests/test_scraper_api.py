import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import check_scraper_api
import scraper as scraper_module
from scraper import ConferenceScraper, ScraperAPIError, clean_output_for_export


class ProviderFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(f"Provider returned {code}")


class ScraperAPITests(unittest.TestCase):
    def scraper(self, responses):
        scraper = ConferenceScraper.__new__(ConferenceScraper)
        scraper.verbose = False
        scraper.use_gemini = True
        scraper.model = "test-model"
        scraper.gemini_client = SimpleNamespace(models=SimpleNamespace(
            generate_content=Mock(side_effect=responses)
        ))
        return scraper

    def test_billing_failure_stops_without_retries(self):
        scraper = self.scraper(ProviderFailure(402))
        with patch("scraper.time.sleep") as sleep:
            with self.assertRaises(ScraperAPIError):
                scraper.call_llm("test")
        self.assertEqual(scraper.gemini_client.models.generate_content.call_count, 1)
        sleep.assert_not_called()

    def test_transient_failure_can_recover(self):
        scraper = self.scraper([ProviderFailure(503), SimpleNamespace(text='{"ok": true}')])
        with patch("scraper.time.sleep") as sleep:
            self.assertEqual(scraper.call_llm("test"), '{"ok": true}')
        sleep.assert_called_once_with(1)

    def test_exhausted_retries_raise_instead_of_empty_success(self):
        scraper = self.scraper(ProviderFailure(503))
        with patch("scraper.time.sleep"):
            with self.assertRaises(ScraperAPIError):
                scraper.call_llm("test")
        self.assertEqual(scraper.gemini_client.models.generate_content.call_count, 5)

    def test_empty_provider_responses_raise(self):
        scraper = self.scraper([SimpleNamespace(text=None)] * 5)
        with self.assertRaises(ScraperAPIError):
            scraper.call_llm("test")

    def test_export_preserves_extraction_health(self):
        exported = clean_output_for_export({"conference": "TEST", "year": 2027,
                                           "_meta": {"successful_extractions": 0}})
        self.assertEqual(exported["_meta"]["successful_extractions"], 0)

    def test_preflight_uses_configured_backup_after_primary_failure(self):
        primary = Mock()
        primary.call_llm.side_effect = ScraperAPIError("primary credits depleted")
        backup = Mock()
        backup.parse_llm_response.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as work_dir:
            env_file = Path(work_dir) / "github-env"
            with patch.dict(os.environ, {"GEMINI_API_KEY": "test-primary",
                                         "OPENROUTER_API_KEY": "test-backup",
                                         "GITHUB_ENV": str(env_file)}, clear=True):
                with patch("check_scraper_api.ConferenceScraper", side_effect=[primary, backup]):
                    self.assertEqual(check_scraper_api.main(), 0)
            self.assertEqual(env_file.read_text(), "PAPERRUSH_SCRAPER_PROVIDER=openrouter\n")

    def test_preflight_fails_when_all_providers_fail(self):
        provider = Mock()
        provider.call_llm.side_effect = ScraperAPIError("unavailable")
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test"}, clear=True):
            with patch("check_scraper_api.ConferenceScraper", return_value=provider):
                self.assertEqual(check_scraper_api.main(), 1)

    def test_scraper_cli_adjusts_biennial_year_before_fetching(self):
        instance = Mock()
        instance.scrape_conference.return_value = {
            "conference": "ECCV", "year": 2028,
            "_meta": {"successful_extractions": 1},
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test"}, clear=True):
            with patch.object(sys, "argv", ["scraper.py", "eccv", "--year", "2027", "--gemini"]):
                with patch("scraper.ConferenceScraper", return_value=instance), patch("scraper.print_results"):
                    scraper_module.main()
        instance.scrape_conference.assert_called_once_with("eccv", 2028, 15)


if __name__ == "__main__":
    unittest.main()
