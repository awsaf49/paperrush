import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_scraped_updates import apply_candidate_updates


class CandidateUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.output = self.root / "data.js"
        self.output.write_text("valid: original", encoding="utf-8")
        self.converter = self.root / "converter.py"
        self.validator = self.root / "validator.py"

    def runner(self, command, check=False, **kwargs):
        self.assertFalse(check)
        if command[0] == "node":
            self.assertEqual(kwargs["env"]["PAPERRUSH_DATA_FILE"], str(self.output.resolve()))
            valid = "browser-error" not in self.output.read_text(encoding="utf-8")
            return subprocess.CompletedProcess(command, 0 if valid else 1)
        script = Path(command[1])

        if script == self.validator:
            valid = self.output.read_text(encoding="utf-8").startswith("valid:")
            return subprocess.CompletedProcess(command, 0 if valid else 1)

        input_path = Path(command[command.index("--input") + 1])
        name = input_path.stem
        if name == "conversion-error":
            self.output.write_text("invalid: partial conversion", encoding="utf-8")
            return subprocess.CompletedProcess(command, 1)

        value = "invalid: candidate" if name == "invalid" else f"valid: {name}"
        self.output.write_text(value, encoding="utf-8")
        return subprocess.CompletedProcess(command, 0)

    def candidate(self, name):
        path = self.root / f"{name}.json"
        path.write_text("{}", encoding="utf-8")
        return path

    def test_rejects_bad_candidate_and_continues_with_good_one(self):
        report = apply_candidate_updates(
            [self.candidate("invalid"), self.candidate("good")],
            self.output,
            self.converter,
            self.validator,
            self.runner,
        )

        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: good")
        self.assertEqual(report["accepted"], ["good"])
        self.assertEqual(
            report["rejected"],
            [{"conference": "invalid", "stage": "validation"}],
        )

    def test_conversion_failure_restores_last_known_good_data(self):
        report = apply_candidate_updates(
            [self.candidate("conversion-error")],
            self.output,
            self.converter,
            self.validator,
            self.runner,
        )

        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: original")
        self.assertEqual(
            report["rejected"],
            [{"conference": "conversion-error", "stage": "conversion"}],
        )

    def test_browser_regression_is_rejected_before_next_candidate(self):
        report = apply_candidate_updates(
            [self.candidate("browser-error"), self.candidate("good")],
            self.output,
            self.converter,
            self.validator,
            self.runner,
        )

        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: good")
        self.assertEqual(report["accepted"], ["good"])
        self.assertEqual(
            report["rejected"],
            [{"conference": "browser-error", "stage": "validation"}],
        )

    def test_missing_scrape_is_reported_without_changing_published_data(self):
        report = apply_candidate_updates(
            [self.root / "missing.json", self.candidate("good")],
            self.output,
            self.converter,
            self.validator,
            self.runner,
        )

        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: good")
        self.assertEqual(
            report["rejected"],
            [{"conference": "missing", "stage": "missing input"}],
        )

    def test_refuses_to_update_invalid_published_data(self):
        self.output.write_text("invalid: original", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "invalid before applying"):
            apply_candidate_updates(
                [self.candidate("good")],
                self.output,
                self.converter,
                self.validator,
                self.runner,
            )

        self.assertEqual(self.output.read_text(encoding="utf-8"), "invalid: original")


if __name__ == "__main__":
    unittest.main()
