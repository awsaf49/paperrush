"""Distinguish partial conference coverage from a failed publication pipeline."""

import os
import sys


def refresh_outcome(job_status, accepted, unchanged, rejected):
    if min(accepted, unchanged, rejected) < 0:
        raise ValueError("Conference counts cannot be negative")
    if job_status != "success" or accepted + unchanged == 0:
        return "failed"
    return "partial" if rejected else "complete"


def main():
    try:
        accepted, unchanged, rejected = (
            int(os.environ.get(name) or 0)
            for name in ("ACCEPTED_COUNT", "UNCHANGED_COUNT", "REJECTED_COUNT")
        )
        status = refresh_outcome(
            os.environ.get("JOB_STATUS", "failure"), accepted, unchanged, rejected
        )
    except ValueError as error:
        print(f"::error::Invalid refresh report: {error}", file=sys.stderr)
        return 1

    counts = f"{accepted} accepted, {unchanged} unchanged, {rejected} rejected"
    print(f"Refresh outcome: {status.upper()} ({counts})")
    if status == "partial":
        print(
            "::warning title=Partial conference refresh::"
            f"{rejected} conference updates were rejected; their prior data was retained. "
            "Valid updates completed independently. Coverage is incomplete; "
            "see the update report and updater-health issue."
        )
    elif status == "failed":
        print(
            "::error title=Conference refresh failed::"
            "A pipeline step failed or no conference update completed successfully."
        )

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"\n### Refresh Outcome\n\n**{status.upper()}** - {counts}.\n")
            if status == "partial":
                handle.write(
                    "The publication pipeline completed with incomplete conference coverage. "
                    "Rejected conferences retain their previous data and remain tracked "
                    "in the updater-health issue.\n"
                )
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"refresh_status={status}\n")
    return 1 if status == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
