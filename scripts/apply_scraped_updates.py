#!/usr/bin/env python3
"""Apply scraped conference updates without letting one bad result block the rest."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONVERTER = SCRIPT_DIR / "update_from_scraper.py"
DEFAULT_VALIDATOR = SCRIPT_DIR / "validate_data.py"
DEFAULT_BROWSER_TEST = SCRIPT_DIR.parent / "tests" / "data-integrity.test.js"


def command_succeeded(command, run_command):
    """Run a command with visible logs and return whether it succeeded."""
    return run_command(command, check=False).returncode == 0


def validate_output(output_path, validator_path, run_command):
    if not command_succeeded(
        [sys.executable, str(validator_path), str(output_path)],
        run_command,
    ):
        return False
    # Browser-level facts must be checked while rollback is still per conference.
    return run_command(
        ["node", "--test", str(DEFAULT_BROWSER_TEST)],
        check=False,
        env={**os.environ, "PAPERRUSH_DATA_FILE": str(Path(output_path).resolve())},
    ).returncode == 0


def apply_candidate_updates(
    input_paths,
    output_path,
    converter_path=DEFAULT_CONVERTER,
    validator_path=DEFAULT_VALIDATOR,
    run_command=subprocess.run,
):
    """Apply and validate each input independently, restoring rejected changes."""
    output_path = Path(output_path)
    converter_path = Path(converter_path)
    validator_path = Path(validator_path)

    if not output_path.is_file():
        raise RuntimeError(f"Published data file does not exist: {output_path}")

    original_content = output_path.read_bytes()
    if not validate_output(output_path, validator_path, run_command):
        raise RuntimeError("Published data is invalid before applying scraped updates")

    report = {"accepted": [], "unchanged": [], "rejected": []}

    for input_path in (Path(path) for path in input_paths):
        conference = input_path.stem
        before_content = output_path.read_bytes()
        stage = None

        print(f"\n{'=' * 70}")
        print(f"Applying candidate update: {conference}")
        print(f"{'=' * 70}")

        if not input_path.is_file():
            stage = "missing input"
        else:
            try:
                converted = command_succeeded(
                    [
                        sys.executable,
                        str(converter_path),
                        "--input",
                        str(input_path),
                        "--output",
                        str(output_path),
                    ],
                    run_command,
                )
                if not converted:
                    stage = "conversion"
                elif not validate_output(output_path, validator_path, run_command):
                    stage = "validation"
            except Exception as error:  # Keep one tool failure from poisoning later inputs.
                stage = f"exception: {type(error).__name__}"
                print(f"Candidate {conference} raised: {error}", file=sys.stderr)

        if stage:
            output_path.write_bytes(before_content)
            report["rejected"].append(
                {"conference": conference, "stage": stage}
            )
            print(
                f"::warning title=Conference update rejected::"
                f"{conference} failed during {stage}; retained last known-good data"
            )
        elif output_path.read_bytes() == before_content:
            report["unchanged"].append(conference)
            print(f"No published change for {conference}")
        else:
            report["accepted"].append(conference)
            print(f"Accepted candidate update: {conference}")

    if not validate_output(output_path, validator_path, run_command):
        output_path.write_bytes(original_content)
        raise RuntimeError("Final validation failed; restored original published data")

    return report


def write_github_outputs(report, output_file):
    """Expose compact report fields to later GitHub Actions steps."""
    rejected = [
        f"{item['conference']} ({item['stage']})"
        for item in report["rejected"]
    ]
    values = {
        "accepted": ", ".join(report["accepted"]) or "none",
        "accepted_count": len(report["accepted"]),
        "unchanged": ", ".join(report["unchanged"]) or "none",
        "unchanged_count": len(report["unchanged"]),
        "rejected": ", ".join(rejected) or "none",
        "rejected_count": len(report["rejected"]),
    }
    with open(output_file, "a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", nargs="+", required=True, help="Scraped JSON files")
    parser.add_argument("--output", default="js/data.js", help="Published data.js path")
    parser.add_argument("--report", help="Optional path for the JSON update report")
    args = parser.parse_args()

    try:
        report = apply_candidate_updates(args.input, args.output)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    report_json = json.dumps(report, indent=2)
    print(f"\nUpdate report:\n{report_json}")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(f"{report_json}\n", encoding="utf-8")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        write_github_outputs(report, github_output)

    if not report["accepted"] and not report["unchanged"]:
        print("ERROR: No candidate update completed successfully", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
