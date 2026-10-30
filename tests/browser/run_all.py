"""Run every browser suite in tests/browser/ and summarise.

    python tests/browser/run_all.py [--skip-live]

Each suite runs in its own process (so one crash can't stop the rest) and its output is shown
as it goes. Failures listed in KNOWN_ISSUES (the known BBC issues in the README) are expected:
they're reported separately as "known" and don't fail the run, so the run is only red when
something new breaks. Needs Selenium; see tests/browser/common.py for the kinds of page and the
options.
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
    "test_summary.py",
]
# Known issues (see "Known issues" in the README): BBC can switch to scrolling the article inside
# a box after the frog appears, so these checks fail on some runs.
KNOWN_ISSUES = [
    re.compile(r"^FAIL \[live\] bbc short window: scrolled smoothly into view"),
    re.compile(r"^FAIL \[live\] bbc: frog starts clear of text and site header"),
]


def main():
    args = [a for a in sys.argv[1:] if a.startswith("--")]
    summary = []
    known_seen = []
    for suite in SUITES:
        print(f"\n===== {suite} =====", flush=True)
        started = time.time()
        proc = subprocess.Popen(
            [sys.executable, str(HERE / suite), *args],
            cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
        )
        counts, known = None, 0
        for line in proc.stdout:
            if line.startswith("FAIL ") and any(k.search(line) for k in KNOWN_ISSUES):
                known += 1
                known_seen.append(line.strip())
                print("KNOWN " + line[5:], end="", flush=True)
                continue
            # Selenium and the browser can be chatty; keep the suite's own lines.
            if line.startswith(("PASS ", "FAIL ", "SKIP ", "     ", "Traceback", "  File", "    ")) or re.match(r"^\d+ passed", line) or "Error" in line or "Exception" in line:
                print(line, end="", flush=True)
            m = re.match(r"^(\d+) passed, (\d+) failed, (\d+) skipped", line)
            if m:
                counts = tuple(int(x) for x in m.groups())
        proc.wait()
        summary.append((suite, counts, known, proc.returncode, time.time() - started))

    print("\n===== Summary =====")
    failed = False
    for suite, counts, known, code, seconds in summary:
        if counts is None:
            failed = True
            print(f"{suite:<24} did not finish (exit {code})")
            continue
        passed, fails, skipped = counts
        new_fails = fails - known
        failed = failed or new_fails > 0
        extra = f"  {known} known" if known else ""
        print(f"{suite:<24} {passed:>3} passed  {new_fails:>3} failed  {skipped:>3} skipped{extra}  ({seconds:.0f}s)")
    if known_seen:
        print("\nKnown issues seen (expected, see the README):")
        for line in known_seen:
            print("  " + line)
    print("\nResult: " + ("FAILED (something new broke)" if failed else "OK" + (" (with known issues only)" if known_seen else "")))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
