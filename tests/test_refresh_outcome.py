import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from report_refresh_outcome import main, refresh_outcome


class RefreshOutcomeTests(unittest.TestCase):
    def test_partial_coverage_is_not_a_pipeline_failure(self):
        self.assertEqual(refresh_outcome("success", 2, 11, 13), "partial")

    def test_partial_coverage_with_no_new_facts_is_still_reported(self):
        self.assertEqual(refresh_outcome("success", 0, 13, 13), "partial")

    def test_all_unchanged_is_complete(self):
        self.assertEqual(refresh_outcome("success", 0, 26, 0), "complete")

    def test_zero_usable_results_is_a_failure(self):
        self.assertEqual(refresh_outcome("success", 0, 0, 26), "failed")

    def test_missing_conversion_report_is_a_failure(self):
        self.assertEqual(refresh_outcome("success", 0, 0, 0), "failed")

    def test_upstream_failure_is_not_hidden_by_good_candidates(self):
        self.assertEqual(refresh_outcome("failure", 13, 13, 0), "failed")

    def test_negative_counts_are_rejected(self):
        with self.assertRaises(ValueError):
            refresh_outcome("success", -1, 13, 13)

    def test_partial_cli_warns_and_records_partial_status_without_failing(self):
        with tempfile.TemporaryDirectory() as directory:
            summary, output = Path(directory) / "summary", Path(directory) / "outputs"
            stdout = io.StringIO()
            with patch.dict(os.environ, {
                "JOB_STATUS": "success", "ACCEPTED_COUNT": "2",
                "UNCHANGED_COUNT": "11", "REJECTED_COUNT": "13",
                "GITHUB_STEP_SUMMARY": str(summary), "GITHUB_OUTPUT": str(output),
            }, clear=True), contextlib.redirect_stdout(stdout):
                self.assertEqual(main(), 0)
            self.assertIn("::warning title=Partial conference refresh::", stdout.getvalue())
            self.assertNotIn("::error", stdout.getvalue())
            self.assertIn("**PARTIAL**", summary.read_text())
            self.assertIn("13 rejected", summary.read_text())
            self.assertEqual(output.read_text(), "refresh_status=partial\n")

    def test_failed_cli_returns_failure(self):
        stdout = io.StringIO()
        with patch.dict(os.environ, {"JOB_STATUS": "failure"}, clear=True), contextlib.redirect_stdout(stdout):
            self.assertEqual(main(), 1)
        self.assertIn("::error title=Conference refresh failed::", stdout.getvalue())

    def test_invalid_counts_return_failure(self):
        with patch.dict(os.environ, {"JOB_STATUS": "success", "ACCEPTED_COUNT": "invalid"}, clear=True):
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
