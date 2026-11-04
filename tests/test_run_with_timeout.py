import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from run_with_timeout import run_with_timeout


class ToolDeadlineTests(unittest.TestCase):
    def test_preserves_exit_code_and_captured_output(self):
        result = run_with_timeout(
            [sys.executable, "-c", "print('completed'); raise SystemExit(7)"],
            timeout=10, stdout=subprocess.PIPE, text=True,
        )
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout.strip(), "completed")

    def test_timeout_terminates_descendants_before_they_can_write(self):
        with tempfile.TemporaryDirectory() as work_dir:
            root = Path(work_dir)
            ready = root / "ready"
            unexpected = root / "late-write"
            child = root / "child.py"
            child.write_text(
                "import sys, time\n"
                "from pathlib import Path\n"
                "Path(sys.argv[1]).write_text('ready')\n"
                "time.sleep(1.5)\n"
                "Path(sys.argv[2]).write_text('should never be written')\n",
                encoding="utf-8",
            )
            parent = root / "parent.py"
            parent.write_text(
                "import subprocess, sys, time\n"
                "subprocess.Popen([sys.executable, sys.argv[1], sys.argv[2], sys.argv[3]])\n"
                "time.sleep(30)\n",
                encoding="utf-8",
            )

            with self.assertRaises(subprocess.TimeoutExpired):
                run_with_timeout(
                    [sys.executable, str(parent), str(child), str(ready), str(unexpected)],
                    timeout=1,
                )

            self.assertTrue(ready.exists(), "descendant must start before testing termination")
            time.sleep(1.6)
            self.assertFalse(unexpected.exists())

    def test_cli_returns_timeout_exit_code(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "run_with_timeout.py"),
             "--seconds", "0.1", "--", sys.executable, "-c", "import time; time.sleep(30)"],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 124)
        self.assertIn("deadline", result.stderr)


if __name__ == "__main__":
    unittest.main()
