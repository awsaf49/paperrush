import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_scraped_updates import (
    CONVERSION_TIMEOUT,
    VALIDATION_TIMEOUT,
    apply_candidate_updates,
)
from update_from_scraper import load_existing_datajs


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
            target = Path(kwargs["env"]["PAPERRUSH_DATA_FILE"])
            self.assertEqual(kwargs["timeout"], VALIDATION_TIMEOUT)
            valid = "browser-error" not in target.read_text(encoding="utf-8")
            return subprocess.CompletedProcess(command, 0 if valid else 1)
        script = Path(command[1])

        if script == self.validator:
            self.assertEqual(kwargs["timeout"], VALIDATION_TIMEOUT)
            valid = Path(command[2]).read_text(encoding="utf-8").startswith("valid:")
            return subprocess.CompletedProcess(command, 0 if valid else 1)

        self.assertEqual(kwargs["timeout"], CONVERSION_TIMEOUT)
        target = Path(command[command.index("--output") + 1])
        self.assertNotEqual(target, self.output)
        self.assertEqual(command[command.index("--merge-source") + 1], str(self.output))
        input_path = Path(command[command.index("--input") + 1])
        name = input_path.stem
        if name == "conversion-error":
            target.write_text("invalid: partial conversion", encoding="utf-8")
            return subprocess.CompletedProcess(command, 1)

        value = "invalid: candidate" if name == "invalid" else f"valid: {name}"
        target.write_text(value, encoding="utf-8")
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

    def test_exception_keeps_prior_success_and_allows_later_update(self):
        def crashing_runner(command, **kwargs):
            if "--input" in command and Path(command[command.index("--input") + 1]).stem == "crash":
                target = Path(command[command.index("--output") + 1])
                target.write_text("invalid: interrupted write", encoding="utf-8")
                raise OSError("simulated tool failure")
            return self.runner(command, **kwargs)

        report = apply_candidate_updates(
            [self.candidate("first"), self.candidate("crash"), self.candidate("last")],
            self.output, self.converter, self.validator, crashing_runner,
        )

        self.assertEqual(report["accepted"], ["first", "last"])
        self.assertEqual(report["rejected"], [{"conference": "crash", "stage": "exception: OSError"}])
        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: last")

    def test_timeout_discards_partial_candidate_and_processes_next_input(self):
        def hanging_runner(command, **kwargs):
            if "--input" in command and Path(command[command.index("--input") + 1]).stem == "hang":
                target = Path(command[command.index("--output") + 1])
                target.write_text("invalid: timed out write", encoding="utf-8")
                self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: first")
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return self.runner(command, **kwargs)

        report = apply_candidate_updates(
            [self.candidate("first"), self.candidate("hang"), self.candidate("last")],
            self.output, self.converter, self.validator, hanging_runner,
        )

        self.assertEqual(report["accepted"], ["first", "last"])
        self.assertEqual(report["rejected"], [{"conference": "hang", "stage": "timeout"}])
        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: last")

    def test_validation_timeout_discards_only_current_candidate(self):
        def hanging_validator(command, **kwargs):
            if command[0] == "node":
                target = Path(kwargs["env"]["PAPERRUSH_DATA_FILE"])
                if target.read_text(encoding="utf-8") == "valid: hang":
                    self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: first")
                    raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return self.runner(command, **kwargs)

        report = apply_candidate_updates(
            [self.candidate("first"), self.candidate("hang"), self.candidate("last")],
            self.output, self.converter, self.validator, hanging_validator,
        )

        self.assertEqual(report["accepted"], ["first", "last"])
        self.assertEqual(report["rejected"], [{"conference": "hang", "stage": "timeout"}])
        self.assertEqual(self.output.read_text(encoding="utf-8"), "valid: last")

    def test_real_validators_reject_bad_input_without_losing_good_updates(self):
        baseline = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
        self.output.write_text(baseline, encoding="utf-8")
        self.converter.write_text(
            "import argparse, json\n"
            "from pathlib import Path\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('--input')\n"
            "parser.add_argument('--output')\n"
            "parser.add_argument('--merge-source')\n"
            "args = parser.parse_args()\n"
            "change = json.loads(Path(args.input).read_text())\n"
            "output = Path(args.output)\n"
            "output.write_text(change.get('replace', output.read_text()) + change.get('append', ''))\n",
            encoding="utf-8",
        )
        inputs = []
        for name, change in (
            ("first", {"append": "\n// accepted first\n"}),
            ("bad", {"replace": "invalid JavaScript"}),
            ("last", {"append": "\n// accepted last\n"}),
        ):
            path = self.root / f"{name}.json"
            path.write_text(json.dumps(change), encoding="utf-8")
            inputs.append(path)

        report = apply_candidate_updates(inputs, self.output, self.converter)

        self.assertEqual(report["accepted"], ["first", "last"])
        self.assertEqual(report["rejected"], [{"conference": "bad", "stage": "validation"}])
        self.assertEqual(
            self.output.read_text(encoding="utf-8"),
            baseline + "\n// accepted first\n\n// accepted last\n",
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

    def test_real_cli_preserves_both_successes_around_malformed_json(self):
        published = ROOT / "js" / "data.js"
        original = published.read_bytes()
        self.output.write_bytes(original)
        first = self.root / "first.json"
        last = self.root / "last.json"
        for path, name in ((first, "IsolationA"), (last, "IsolationB")):
            path.write_text(json.dumps({
                "conference": name, "year": 2099,
                "deadlines": [{
                    "event": "Paper Submission", "date": "2099-11-01",
                    "time": "23:59", "timezone": "AoE",
                }],
            }), encoding="utf-8")
        bad = self.root / "bad.json"
        bad.write_text("{broken JSON", encoding="utf-8")
        report_path = self.root / "report.json"

        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "apply_scraped_updates.py"),
             "--input", str(first), str(bad), str(last),
             "--output", str(self.output), "--report", str(report_path)],
            capture_output=True, text=True, timeout=30,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(report_path.read_text())
        self.assertEqual(report["accepted"], ["first", "last"])
        self.assertEqual(report["rejected"], [{"conference": "bad", "stage": "conversion"}])
        ids = {conference["id"] for conference in load_existing_datajs(self.output)}
        self.assertTrue({"isolationa-2099", "isolationb-2099"}.issubset(ids))
        self.assertEqual(published.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
