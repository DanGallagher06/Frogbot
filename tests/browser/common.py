"""Shared helpers for Frogbot's optional browser test suites.

These suites drive the real extension code in headless Edge with Selenium (`pip install
selenium`; card screenshots also use Pillow). Each suite runs on its own:

    python tests/browser/test_card.py

or all of them together with `python tests/browser/run_all.py`. Options for any suite:

    --skip-live   skip checks that load live websites (also FROGBOT_SKIP_LIVE=1)

Pages come in three kinds:

- test pages in `test-pages/` (always available)
- saved copies of real pages in `test-pages/local/` (gitignored, not part of the repo): checks
  on a missing copy are skipped with a message saying which file to save
- live sites: checks are labelled `[live]` and can fail if the site changes or is unreachable
"""

import atexit
import os
import pathlib
import sys
import time

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.edge.options import Options

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCAL = ROOT / "test-pages" / "local"
SCREENS = LOCAL / "screens"  # gitignored, for screenshots worth reviewing by eye
SCRIPTS = ("frog", "highlight", "extract", "score", "facts", "card", "main")  # popup.js's order
CSS = (ROOT / "content" / "frogbot.css").read_text(encoding="utf-8")
JS = "\n".join((ROOT / "content" / f"{name}.js").read_text(encoding="utf-8") for name in SCRIPTS)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
SKIP_LIVE = "--skip-live" in sys.argv or bool(os.environ.get("FROGBOT_SKIP_LIVE"))

# name -> (kind, location, options). Saved copies are the browser's "Save page as, complete".
PAGES = {
    "test-page": ("test", "earnings-sample.html", {}),
    "captions-page": ("test", "captions-and-collapsed.html", {}),
    "mapping-page": ("test", "mapping.html", {}),
    "nvidia-wikipedia": ("saved", "Nvidia - Wikipedia.html", {"source": "https://en.wikipedia.org/wiki/Nvidia"}),
    "apple-wikipedia": ("saved", "Apple Inc. - Wikipedia.html", {"source": "https://en.wikipedia.org/wiki/Apple_Inc."}),
    # The Forbes copy is loaded with its own scripts turned off (they rebuild the page offline).
    "forbes": (
        "saved",
        "Alphabet, Microsoft And Amazon Lead The Busiest Week Of Earnings Season.html",
        {"no_scripts": True, "source": "a Forbes article on the busiest week of earnings season (October 2025)"},
    ),
    "nvidia-release": ("live", "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2026", {}),
    "apple-release": ("live", "https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/", {}),
    "bbc": ("live", "https://www.bbc.com/news/articles/cq2e9we7w2ejo", {}),
    "bbc-no-figures": ("live", "https://www.bbc.com/news/articles/c6g7xn8p2n0ro", {}),
}

_results = {"pass": 0, "fail": 0, "skip": 0}
_skipped_pages = set()


def report(name, ok, detail=""):
    _results["pass" if ok else "fail"] += 1
    print(("PASS " if ok else "FAIL ") + name + (f"  -- {detail}" if detail else ""), flush=True)
    return ok


def skip(message):
    _results["skip"] += 1
    print(f"SKIP {message}", flush=True)


def info(message):
    print(f"     {message}", flush=True)


def label(name):
    """A page's name for check output; live sites are marked [live]."""
    return f"[live] {name}" if PAGES[name][0] == "live" else name


def available(name):
    """Whether a page can be used in this run. Prints a SKIP line (once) when it can't."""
    kind, where, options = PAGES[name]
    if kind == "saved" and not (LOCAL / where).exists():
        if name not in _skipped_pages:
            _skipped_pages.add(name)
            skip(f"{name}: saved copy not found. Save {options.get('source', 'the page')} as test-pages/local/{where} to run these checks.")
        return False
    if kind == "live" and SKIP_LIVE:
        if name not in _skipped_pages:
            _skipped_pages.add(name)
            skip(f"[live] {name}: live-site checks skipped (--skip-live)")
        return False
    return True


def url(name):
    kind, where, _ = PAGES[name]
    if kind == "test":
        return (ROOT / "test-pages" / where).as_uri()
    if kind == "saved":
        return (LOCAL / where).as_uri()
    return where


def make_driver(width=1300, height=1000, reduced=False, scheme=None, eager=True, page_timeout=45):
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument(f"--window-size={width},{height}")
    options.add_argument(f"--user-agent={UA}")
    if eager:
        options.page_load_strategy = "eager"
    driver = webdriver.Edge(options=options)
    driver.set_page_load_timeout(page_timeout)
    if reduced or scheme:
        media(driver, scheme or "light", reduced)
    return driver


def media(driver, scheme="light", reduced=False):
    driver.execute_cdp_cmd(
        "Emulation.setEmulatedMedia",
        {
            "features": [
                {"name": "prefers-color-scheme", "value": scheme},
                {"name": "prefers-reduced-motion", "value": "reduce" if reduced else "no-preference"},
            ]
        },
    )


def get(driver, address):
    """driver.get that tolerates saved pages hanging on missing subresources."""
    try:
        driver.get(address)
    except TimeoutException:
        driver.execute_script("window.stop()")


def open_page(driver, name, wait=None, query=""):
    """Load a page (which must be available()), waiting a moment for it to settle."""
    kind, _, options = PAGES[name]
    no_scripts = options.get("no_scripts")
    if no_scripts:
        driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": True})
    get(driver, url(name) + query)
    if no_scripts:
        driver.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": False})
    time.sleep(wait if wait is not None else (3.5 if kind == "live" else 0.6))


def add_css(driver):
    driver.execute_script(
        "if (!document.getElementById('__frogbot_css')) { const s = document.createElement('style');"
        " s.id = '__frogbot_css'; s.textContent = arguments[0]; document.head.appendChild(s); }",
        CSS,
    )


def release(driver):
    """Inject the content scripts, as clicking "Release the frog" does."""
    driver.execute_script(JS)


def escape(driver):
    driver.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")


def wait_for(driver, js, timeout=15, interval=0.05):
    end = time.time() + timeout
    while time.time() < end:
        if driver.execute_script("return " + js):
            return True
        time.sleep(interval)
    return False


def _summary():
    r = _results
    print(f"\n{r['pass']} passed, {r['fail']} failed, {r['skip']} skipped", flush=True)


def finish():
    """Print the summary and exit with status 1 if anything failed."""
    _summary()
    atexit.unregister(_summary)
    sys.exit(1 if _results["fail"] else 0)


atexit.register(_summary)
