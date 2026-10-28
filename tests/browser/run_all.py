"""Run every browser suite in tests/browser/ and summarise.

    python tests/browser/run_all.py [--skip-live]

Each suite runs in its own process (so one crash can't stop the rest), its output is shown as
it goes, and the run exits with status 1 if any suite had a failure. Needs Selenium; see
tests/browser/common.py for the kinds of page and the options.
"""

import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
SUITES = [
    "test_extraction.py",
    "test_detection.py",
    "test_scoring.py",
    "test_highlights.py",
    "test_hops.py",
    "test_facts_pages.py",
    "test_card.py",
    "test_card_actions.py",
]


def main():
    args = [a for a in sys.argv[1:] if a.startswith("--")]
    summary = []
    for suite in SUITES:
        print(f"\n===== {suite} =====", flush=True)
        started = time.time()
        proc = subprocess.Popen([sys.executable, str(HERE / suite), *args], cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        counts = None
        for line in proc.stdout:
            # Selenium and the browser can be chatty on stderr; keep the suite's own lines.
            if line.startswith(("PASS ", "FAIL ", "SKIP ", "     ", "Traceback", "  File", "    ")) or re.match(r"^\d+ passed", line) or "Error" in line:
                print(line, end="", flush=True)
            m = re.match(r"^(\d+) passed, (\d+) failed, (\d+) skipped", line)
            if m:
                counts = tuple(int(x) for x in m.groups())
        proc.wait()
        summary.append((suite, counts, proc.returncode, time.time() - started))

    print("\n===== Summary =====")
    failed = False
    for suite, counts, code, seconds in summary:
        if counts is None:
            failed = True
            print(f"{suite:<24} did not finish (exit {code})")
            continue
        passed, fails, skipped = counts
        failed = failed or fails > 0 or code != 0
        print(f"{suite:<24} {passed:>3} passed  {fails:>3} failed  {skipped:>3} skipped  ({seconds:.0f}s)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
