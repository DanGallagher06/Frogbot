"""Clicking the card's rows, and exporting.

Covers: every row a focusable button that scrolls its exact figure to the centre and pulses it,
the frog turning to look, Enter and Space, the fallback outline when a highlight has gone,
cycling through several sources (1/2, 2/2), reduced motion, Escape / × / releasing again after
clicks, Copy table (clipboard API and the textarea fallback, on a file:// page and, live, an
https page) and Download CSV (file name, BOM, round trip, escaping of commas, quotes, £, € and –).

    python tests/browser/test_card_actions.py [--skip-live]
"""

import csv
import datetime
import io
import json
import math
import pathlib
import tempfile
import time

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from card_helpers import CARD, EXPECTED, wait_for_card
from common import add_css, available, finish, make_driver, media, open_page, release, report

PULSED = r"""return [...document.querySelectorAll('mark.frogbot-pulse, mark.frogbot-outline, .frogbot-outline')].map(m => ({
  text: m.textContent.replace(/\s+/g, ' ').trim(), cls: m.className, tag: m.tagName,
  cy: m.getBoundingClientRect().top + m.getBoundingClientRect().height / 2,
  cx: m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2,
  anims: m.getAnimations().length }));"""
FROG = r"""const f = document.querySelector('.frogbot-frog'); const r = f.getBoundingClientRect();
return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rotate: f.style.rotate };"""
SCROLL = "return [scrollY, document.documentElement.scrollHeight - innerHeight, innerHeight]"
CSV_COLUMNS = ["section", "metric", "figure", "value", "low", "high", "currency", "type", "role", "change", "direction",
               "sentiment", "period", "period_inferred", "prior", "source_text", "page_url", "captured_at"]
DOWNLOADS = pathlib.Path(tempfile.mkdtemp(prefix="frogbot-csv-"))


def load(d, name):
    open_page(d, name)
    d.execute_script("window.__errors = []; addEventListener('error', e => __errors.push(e.message));")
    add_css(d)


def facts_by_id(d):
    return {f["id"]: f for f in d.execute_script(EXPECTED)}


def click_row(d, selector):
    d.execute_script(f"({CARD}.querySelector(arguments[0])).click()", selector)


def check_jump(d, fact, reduced=False):
    """After a row click: the fact's exact figure is pulsed (or outlined) and centred."""
    time.sleep(0.05 if reduced else 0.9)
    pulsed = d.execute_script(PULSED)
    scroll_y, max_y, height = d.execute_script(SCROLL)
    text = " ".join(p["text"] for p in pulsed if p["tag"] == "MARK")
    centred = all(abs(p["cy"] - height / 2) < 40 or scroll_y <= 1 or scroll_y >= max_y - 1 for p in pulsed)
    return pulsed, text == " ".join(fact["raw"].split()), centred


def copy_checks(d, name, row_count):
    d.execute_cdp_cmd("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
    button = d.execute_script(f"return {CARD}.querySelector('.copy')")
    button.click()  # a real click, so the page has user activation
    time.sleep(0.2)
    shown = d.execute_script(f"return {CARD}.querySelector('.copy').textContent")
    # Windows hands clipboard text back with CRLF line endings.
    text = d.execute_async_script("const done = arguments[0]; navigator.clipboard.readText().then(done, e => done('ERR ' + e))").replace("\r\n", "\n")
    lines = text.rstrip("\n").split("\n")
    ok = lines[0] == "Metric\tFigure\tChange\tDirection\tPeriod" and len(lines) == row_count + 1 and all(line.count("\t") == 4 for line in lines)
    report(f"{name}: Copy table puts tab-separated rows with a header on the clipboard (clipboard API)", shown == "Copied ✓" and ok, f"{shown!r}, {len(lines)} lines")
    time.sleep(1.6)
    report(f"{name}: button label returns after ~1.5s", d.execute_script(f"return {CARD}.querySelector('.copy').textContent") == "Copy table")
    # The clipboard API refused: the textarea + execCommand fallback.
    d.execute_script("""window.__copied = null; navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
      const orig = document.execCommand.bind(document);
      document.execCommand = (cmd) => { const a = document.querySelector('.frogbot-card-host').shadowRoot.activeElement;
        window.__copied = a && a.tagName === 'TEXTAREA' ? a.value : null; return orig(cmd); };""")
    button.click()
    time.sleep(0.2)
    shown = d.execute_script(f"return {CARD}.querySelector('.copy').textContent")
    copied = (d.execute_script("return __copied") or "").replace("\r\n", "\n")
    report(f"{name}: fallback (textarea + execCommand) copies the same text", shown == "Copied ✓" and copied == text, f"{shown!r}, same text {copied == text}")
    report(f"{name}: fallback textarea removed", d.execute_script(f"return {CARD}.querySelectorAll('textarea').length") == 0)
    time.sleep(1.6)
    d.execute_script("document.execCommand = () => false")
    button.click()
    time.sleep(0.2)
    report(f"{name}: 'Copy failed' when both methods fail", d.execute_script(f"return {CARD}.querySelector('.copy').textContent") == "Copy failed")


def download(d, name, site):
    """Click Download CSV; returns (raw bytes, parsed records) or None."""
    for f in DOWNLOADS.glob("*.csv"):
        f.unlink()
    d.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(DOWNLOADS)})
    d.execute_script(f"return {CARD}.querySelector('.csv')").click()
    end = time.time() + 10
    files = []
    while time.time() < end and not files:
        files = list(DOWNLOADS.glob("*.csv"))
        time.sleep(0.2)
    want = f"frogbot-{site}-{datetime.date.today().isoformat()}.csv"
    report(f"{name}: Download CSV saves {want}", [f.name for f in files] == [want], str([f.name for f in files]))
    if not files:
        return None
    raw = files[0].read_bytes()
    report(f"{name}: CSV starts with a UTF-8 BOM", raw[:3] == b"\xef\xbb\xbf")
    return raw, list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline="")))


def test_page_clicks():
    d = make_driver()
    media(d, "light", reduced=False)
    try:
        load(d, "test-page")
        before = d.execute_script("return document.body.innerHTML")
        release(d)
        wait_for_card(d)
        facts = facts_by_id(d)
        rows = d.execute_script(f"return [...{CARD}.querySelectorAll('tbody tr')].map(tr => [tr.dataset.factId, getComputedStyle(tr).display !== 'none', tr.getAttribute('role'), tr.tabIndex])")
        report("test-page: every row is a focusable button", bool(rows) and all(r[2] == "button" and r[3] == 0 for r in rows), str(rows[:2]))
        bad, angles = [], []
        for fid, visible, _, _ in rows:
            if not visible:
                continue
            click_row(d, f'tr[data-fact-id="{fid}"]')
            pulsed, exact, centred = check_jump(d, facts[fid])
            if not (pulsed and exact and centred and all(p["anims"] > 0 or "frogbot-outline" in p["cls"] for p in pulsed)):
                bad.append((facts[fid]["label"], facts[fid]["raw"], [p["text"] for p in pulsed], centred))
            frog = d.execute_script(FROG)
            if pulsed:
                p = pulsed[0]
                middle = d.execute_script("return innerHeight / 2")
                want = (math.degrees(math.atan2(middle - frog["cy"], p["cx"] - frog["cx"])) - 90) % 360
                got = float(frog["rotate"].replace("deg", "") or 0) % 360
                angles.append(min(abs(want - got), 360 - abs(want - got)))
            time.sleep(1.3)
        report("test-page: each main row scrolls its exact figure to the centre and pulses it", not bad, str(bad[:3]))
        report("test-page: the frog turns to face the figure", bool(angles) and max(angles) < 25, f"angle errors {[round(a) for a in angles]}")
        left = d.execute_script("return document.querySelectorAll('.frogbot-pulse, .frogbot-outline').length")
        report("test-page: pulses end and leave no classes behind", left == 0, f"{left} left")

        # Keyboard: Tab from the close button reaches a row; Enter and Space jump.
        d.execute_script(f"{CARD}.querySelector('.close').focus()")
        ActionChains(d).send_keys(Keys.TAB).perform()
        time.sleep(0.1)
        focused = d.execute_script(f"const a = {CARD}.activeElement; return a ? [a.tagName, a.dataset.factId || null] : null")
        ActionChains(d).send_keys(Keys.ENTER).perform()
        pulsed, exact, _ = check_jump(d, facts[focused[1]]) if focused and focused[1] else ([], False, False)
        report("keyboard: Tab to a row, Enter jumps to its figure", bool(focused) and focused[0] == "TR" and exact, f"{focused}, pulsed {[p['text'] for p in pulsed]}")
        time.sleep(1.3)
        d.execute_script(f"{CARD}.querySelector('tr[data-fact-id=\"{rows[1][0]}\"]').focus()")
        ActionChains(d).send_keys(Keys.SPACE).perform()
        pulsed, exact, _ = check_jump(d, facts[rows[1][0]])
        report("keyboard: Space works too", exact, str([p["text"] for p in pulsed]))

        # Escape mid-pulse: the page is restored exactly.
        click_row(d, "tbody tr")
        time.sleep(0.2)
        ActionChains(d).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.3)
        gone = d.execute_script("return [document.querySelectorAll('[data-frogbot], .frogbot-card-host, .frogbot-pulse, .frogbot-outline').length, document.body.innerHTML === arguments[0]]", before)
        report("Escape mid-pulse restores the page HTML exactly", gone == [0, True], str(gone))

        # A highlight that has gone (as if the site re-rendered): its block is outlined instead.
        d.execute_script("window.__frogbotDebug = true; window.__logs = []; const l = console.log; console.log = (...a) => { __logs.push(a.map(String).join(' ')); l(...a); };")
        release(d)
        wait_for_card(d)
        gp = [fid for fid, _, _, _ in rows if facts[fid]["label"] == "Gross profit"][0]
        d.execute_script("for (const x of document.querySelectorAll('mark.frogbot-num')) if (x.textContent.trim() === '$209.9') x.replaceWith(document.createTextNode(x.textContent));")
        cell = "[...document.querySelectorAll('td')].find(t => t.textContent.trim() === '$209.9')"
        original = d.execute_script(f"return {cell}.getAttribute('class')")
        click_row(d, f'tr[data-fact-id="{gp}"]')
        time.sleep(0.9)
        outlined = d.execute_script(f"return {cell}.classList.contains('frogbot-outline')")
        logged = d.execute_script("return __logs.filter(l => l.includes('has gone')).length")
        time.sleep(1.4)
        after = d.execute_script(f"return {cell}.getAttribute('class')")
        report("fallback: a lost highlight outlines its block, logs in debug, and restores the class exactly",
               outlined and logged == 1 and after == original, f"outlined {outlined}, logged {logged}, class {original!r} -> {after!r}")
        d.execute_script(f"{CARD}.querySelector('.close').click()")
        time.sleep(0.3)
        gone = d.execute_script("return [document.querySelectorAll('[data-frogbot], .frogbot-card-host').length, document.body.innerHTML === arguments[0]]", before)
        report("× after clicks and an outline restores the page HTML exactly", gone == [0, True], str(gone))

        # Releasing again after clicks.
        release(d)
        wait_for_card(d)
        click_row(d, "tbody tr")
        time.sleep(0.3)
        release(d)
        s = wait_for_card(d)
        report("releasing again after clicks gives one fresh card", s["hosts"] == 1 and s["frogs"] == 1)
        ActionChains(d).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.3)
        report("...and Escape restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))

        # Several sources: best first, then cycling (checked on the card directly).
        d.execute_script("""
          window.__jumps = [];
          const f = { id: 'f1', label: 'Revenue', display: '$482.6M', type: 'money', role: 'level', showOnCard: true, topic: 'revenue/sales',
            qualifiers: [], labelConfidence: 'high', periodConfidence: 'high', period: { text: 'Q3 2026' }, direction: 'up', sentiment: 'good',
            blockIndex: 7, matchStart: 30, sentence: 'Revenue was $482.6 million.', value: 482600000, low: null, high: null, currency: 'USD',
            sources: [{ blockIndex: 3, matchStart: 0 }, { blockIndex: 7, matchStart: 30 }] };
          FrogbotCard.show([f], { onJump: (fact, i) => __jumps.push(i) });""")
        badges = []
        for _ in range(3):
            click_row(d, "tbody tr")
            badges.append(d.execute_script(f"return {CARD}.querySelector('.count').textContent"))
        jumps = d.execute_script("return __jumps")
        report("two sources: best first, then cycles 1/2 -> 2/2 -> 1/2", badges == ["1/2", "2/2", "1/2"] and jumps == [1, 0, 1], f"badges {badges}, source indexes {jumps}")
        d.execute_script("FrogbotCard.hide()")
    finally:
        d.quit()


def reduced_motion_jump():
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        load(d, "test-page")
        release(d)
        s = wait_for_card(d)
        facts = facts_by_id(d)
        fid = [r["id"] for r in s["rows"] if facts[r["id"]]["label"] == "Net income"][0]
        d.execute_script("scrollTo(0, 0)")
        click_row(d, f'tr[data-fact-id="{fid}"]')
        pulsed, exact, centred = check_jump(d, facts[fid], reduced=True)
        report("reduced motion: instant jump with a static outline",
               exact and centred and bool(pulsed) and all("frogbot-outline" in p["cls"] and p["anims"] == 0 for p in pulsed), str(pulsed))
    finally:
        d.quit()


def file_page_exports():
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        load(d, "test-page")
        release(d)
        s = wait_for_card(d)
        copy_checks(d, "test-page (file://)", len(s["rows"]))
        got = download(d, "test-page (file://)", "local")
        if got:
            _, records = got
            report("test-page: CSV rows match the card", [[r["metric"], r["figure"]] for r in records if r["section"] == "main"] == [[c["cells"][0], c["cells"][1]] for c in s["rows"]])
        # A label with a comma and a quote, and £, € and – in the figures.
        d.execute_script("""
          const base = { type: 'money', role: 'level', showOnCard: true, topic: 'revenue/sales', qualifiers: [], labelConfidence: 'high', periodConfidence: 'high',
            direction: null, sentiment: null, blockIndex: 0, matchStart: 0, low: null, high: null, sources: [{ blockIndex: 0, matchStart: 0 }] };
          FrogbotCard.show([
            { ...base, id: 'f1', label: 'Sales, "core" – UK', display: '£1.2M', value: 1200000, currency: 'GBP', period: { text: 'H1 2026' },
              sentence: 'Sales, the "core" line, were £1.2 million – up again.' },
            { ...base, id: 'f2', label: 'Revenue', display: '€3.4B–€3.6B', value: null, low: 3.4e9, high: 3.6e9, currency: 'EUR', role: 'guidance', period: { text: 'FY 2026' },
              sentence: 'Revenue of €3.4 billion to €3.6 billion,\\nmaybe.' },
            { ...base, id: 'f3', label: 'a snippet, "quoted"', display: '5%', type: 'percent', value: 5, currency: null, showOnCard: false, labelConfidence: 'low', period: null,
              sentence: 'x' },
          ], {});""")
        got = download(d, "escaping", "local")
        if got:
            raw, records = got
            text = raw.decode("utf-8-sig")
            ok = (len(records) == 3 and records[0]["metric"] == 'Sales, "core" – UK' and records[0]["figure"] == "£1.2M" and records[1]["figure"] == "€3.4B–€3.6B"
                  and records[1]["low"] == "3400000000" and records[2]["section"] == "also caught" and records[2]["metric"] == 'a snippet, "quoted"'
                  and '"Sales, ""core"" – UK"' in text and records[0]["source_text"] == 'Sales, the "core" line, were £1.2 million – up again.')
            report("CSV escaping: commas, quotes and £/€/– survive a round trip", ok, json.dumps([{k: r[k] for k in ("section", "metric", "figure", "low")} for r in records], ensure_ascii=False))
    finally:
        d.quit()


def live_release_checks():
    """Live: Nvidia's release, for "Show all" and "Also caught" jumps and https exports."""
    if not available("nvidia-release"):
        return
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        load(d, "nvidia-release")
        release(d)
        s = wait_for_card(d)
        facts = facts_by_id(d)
        d.execute_script(f"{CARD}.querySelector('.more').click()")
        hidden = [r["id"] for r in s["rows"] if not r["shown"]]
        bad = []
        for fid in hidden:
            click_row(d, f'tr[data-fact-id="{fid}"]')
            pulsed, exact, centred = check_jump(d, facts[fid], reduced=True)
            if not (exact and centred):
                bad.append((facts[fid]["label"], facts[fid]["raw"], [p["text"] for p in pulsed]))
        report(f"[live] nvidia-release: all {len(hidden)} 'Show all' rows jump to their exact figures", bool(hidden) and not bad, str(bad[:3]))
        d.execute_script(f"{CARD}.querySelector('details').open = true")
        also = d.execute_script(f"return [...{CARD}.querySelectorAll('details li')].map(li => li.dataset.factId)")
        bad = []
        for fid in also:
            click_row(d, f'li[data-fact-id="{fid}"]')
            pulsed, exact, centred = check_jump(d, facts[fid], reduced=True)
            if not (exact and centred):
                bad.append((facts[fid]["label"], facts[fid]["raw"], [p["text"] for p in pulsed]))
        report(f"[live] nvidia-release: all {len(also)} 'Also caught' rows jump to their exact figures", bool(also) and not bad, str(bad[:3]))

        # The site's cookie-consent overlay covers the card until it's answered; a visitor would dismiss it first.
        d.execute_script("document.querySelectorAll('#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter').forEach(e => e.remove())")
        copy_checks(d, "[live] nvidia-release (https)", len(s["rows"]))
        got = download(d, "[live] nvidia-release", "nvidianews.nvidia.com")
        if got:
            _, records = got
            main_rows = [r for r in records if r["section"] == "main"]
            also_rows = [r for r in records if r["section"] == "also caught"]
            same = [[r["metric"], r["figure"]] for r in main_rows] == [[r["cells"][0], r["cells"][1]] for r in s["rows"]]
            report("[live] nvidia-release: CSV parses back to the card's rows (main + Show all, then Also caught)",
                   same and len(also_rows) == len(s["alsoItems"]) and list(records[0].keys()) == CSV_COLUMNS, f"{len(main_rows)} main, {len(also_rows)} also")
            first = main_rows[0]
            report("[live] nvidia-release: CSV values are plain numbers, source text trimmed, URL and time filled",
                   first["value"].replace(".", "").isdigit() and len(first["source_text"]) <= 200 and first["page_url"].startswith("https://") and first["captured_at"].endswith("Z"),
                   json.dumps({k: first[k] for k in ("figure", "value", "currency", "period")}))
    finally:
        d.quit()


def main():
    test_page_clicks()
    reduced_motion_jump()
    file_page_exports()
    live_release_checks()
    finish()


if __name__ == "__main__":
    main()
