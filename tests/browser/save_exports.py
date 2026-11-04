"""Save sample exports from each page to test-pages/local/exports/ (gitignored), for opening
in Excel and comparing between versions.

Releases the frog on each page, waits for the card and clicks Download Excel and Download CSV.
Saved as <page>.xlsx and <page>.csv; pages that aren't available (no saved copy, or
--skip-live) are skipped.

    python tests/browser/save_exports.py [--skip-live] [page ...]
"""

import csv
import io
import pathlib
import sys
import tempfile
import time

from card_helpers import CARD, wait_for_card
from common import LOCAL, add_css, available, make_driver, media, open_page, release

PAGES = ["test-page", "nvidia-release", "apple-release", "nvidia-wikipedia", "forbes"]
OUT = LOCAL / "exports"


def save(name):
    downloads = pathlib.Path(tempfile.mkdtemp(prefix="frogbot-export-"))
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        open_page(d, name)
        add_css(d)
        release(d)
        wait_for_card(d)
        # Cookie banners can cover the card on live sites.
        d.execute_script("document.querySelectorAll('#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter').forEach(e => e.remove())")
        d.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(downloads)})
        OUT.mkdir(parents=True, exist_ok=True)
        for ext in ("xlsx", "csv"):
            d.execute_script(f"return {CARD}.querySelector('.{ext}')").click()
            end = time.time() + 10
            files = []
            while time.time() < end and not files:
                files = list(downloads.glob(f"*.{ext}"))
                time.sleep(0.2)
            if not files:
                print(f"{name}: no {ext} download")
                return
            time.sleep(0.3)
            raw = files[0].read_bytes()
            (OUT / f"{name}.{ext}").write_bytes(raw)
        records = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline="")))
        first = records[0] if records else {}
        print(f"{name}: {len(records)} rows -> {OUT / (name + '.csv')}  company={first.get('company')!r} ticker={first.get('ticker')!r} published={first.get('published_date')!r}")
    finally:
        d.quit()


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or PAGES
    for name in names:
        if available(name):
            save(name)


if __name__ == "__main__":
    main()
