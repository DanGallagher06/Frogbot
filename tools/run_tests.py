"""Run tests/run-tests.html in headless Edge or Chrome and print the results for the
development set (tests/detect-cases.js), the scoring cases (tests/score-cases.js), the
fact cases (tests/facts-cases.js) and the held-out set (tests/holdout-cases.js).

Usage (from anywhere):  python tools/run_tests.py
Set FROGBOT_BROWSER to a browser executable to override the automatic search.
Exits with status 1 if any test in either set fails. Python standard library only.
"""

import html
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "tests" / "run-tests.html"

CANDIDATES = [
    os.environ.get("FROGBOT_BROWSER"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("microsoft-edge"),
    shutil.which("google-chrome"),
    shutil.which("chromium"),
]


def find_browser() -> str:
    for path in CANDIDATES:
        if path and pathlib.Path(path).exists():
            return path
    sys.exit("Couldn't find Edge or Chrome. Set FROGBOT_BROWSER to the browser's executable.")


def main() -> None:
    browser = find_browser()
    # A throwaway profile, so this never clashes with a browser that's already open.
    with tempfile.TemporaryDirectory() as profile:
        dom = subprocess.run(
            [browser, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}",
             "--dump-dom", PAGE.as_uri()],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        ).stdout

    found = re.search(r'<pre id="results-json"[^>]*>(.*?)</pre>', dom, re.S)
    if not found or not found.group(1).strip():
        sys.exit("The test page didn't produce results. Open tests/run-tests.html in a browser to see why.")
    results = json.loads(html.unescape(found.group(1)))

    failed = report("Development set (tests/detect-cases.js)", results["development"])
    print()
    failed |= report_scoring(results["scoring"])
    print()
    failed |= report_facts(results["facts"])
    print()
    held_out = results["holdout"]
    if held_out["summary"]["total"] == 0:
        print("Held-out set (tests/holdout-cases.js)")
        print("No held-out cases yet.")
    else:
        failed |= report("Held-out set (tests/holdout-cases.js)", held_out)
    if failed:
        sys.exit(1)


def report_facts(results: dict) -> bool:
    """Print the fact cases' summary and failures. Returns True if any failed."""
    s = results["summary"]
    title = "Facts (tests/facts-cases.js)"
    print(title)
    print("=" * len(title))
    print(f"Accuracy: {s['accuracy']}%  ({s['passed']} of {s['total']} cases pass, {s['failed']} failed)")
    if results["failures"]:
        print()
        print("Failures:")
        for f in results["failures"]:
            print(f"- {f['text'][:140]}")
            for p in f["problems"]:
                print(f"    {p}")
            for g in f["got"]:
                print(f"    got: {g}")
    return bool(results["failures"])


def report_scoring(results: dict) -> bool:
    """Print the scoring cases' summary and failures. Returns True if any failed."""
    s = results["summary"]
    title = "Scoring (tests/score-cases.js)"
    print(title)
    print("=" * len(title))
    print(f"Accuracy: {s['accuracy']}%  ({s['passed']} of {s['total']} cases pass, {s['failed']} failed)")
    print("By kind: " + ", ".join(f"{k} {r['passed']}/{r['total']}" for k, r in results["byKind"].items()))
    if results["failures"]:
        print()
        print("Failures:")
        for f in results["failures"]:
            print(f"- [{f['kind']}] {f['label'][:140]}")
            print(f"    {f['detail']}")
    return bool(results["failures"])


def report(title: str, results: dict) -> bool:
    """Print one set's summary, accuracy by type and failures. Returns True if any failed."""
    s = results["summary"]
    print(title)
    print("=" * len(title))
    print(f"Accuracy: {s['accuracy']}%  ({s['passed']} of {s['total']} cases pass, {s['failed']} failed)")
    print(f"Detection: {s['detectPassed']}/{s['detectTotal']}   Sentence splitting: {s['splitPassed']}/{s['splitTotal']}")
    print()
    print(f"{'Type':<22}{'Expected':>9}{'Correct':>9}{'Accuracy':>10}{'Extras':>8}")
    for name, r in sorted(results["perType"].items()):
        acc = f"{100 * r['correct'] / r['expected']:.1f}%" if r["expected"] else "-"
        print(f"{name:<22}{r['expected']:>9}{r['correct']:>9}{acc:>10}{r['falsePositives']:>8}")
    if results["real"]:
        print()
        print("On sentences from real pages: " + ", ".join(
            f"{t} {100 * r['correct'] / r['expected']:.1f}% ({r['correct']}/{r['expected']})"
            for t, r in results["real"].items()))
    if results["failures"]:
        print()
        print("Failures:")
        for f in results["failures"]:
            print(f"- [{f['kind']}{'/' + f['source'] if f.get('source') else ''}] {f['text'][:110]}")
            for p in f.get("problems", []):
                print(f"    {p}")
            if f["kind"] == "split":
                print(f"    expected: {f['expected']}")
                print(f"    actual:   {f['actual']}")
    return bool(results["failures"])


if __name__ == "__main__":
    main()
