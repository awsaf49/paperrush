#!/usr/bin/env python3
"""Run a tool with a deadline that also terminates its child processes."""

import argparse
import os
import signal
import subprocess
import sys


def run_with_timeout(command, *, timeout, check=False, **kwargs):
    with subprocess.Popen(command, start_new_session=True, **kwargs) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise

        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if args.seconds <= 0 or not command:
        parser.error("A positive deadline and a command are required")
    try:
        return run_with_timeout(command, timeout=args.seconds).returncode
    except subprocess.TimeoutExpired:
        print(f"Tool exceeded its {args.seconds:g}-second deadline", file=sys.stderr)
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
