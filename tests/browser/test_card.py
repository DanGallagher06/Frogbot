"""The summary card.

Covers: delivery after the last hop (with the drop animation, or none with reduced motion), the
frog perched on the card, position and size, rows and their order on every page, the Change and
Period cells, "Show all" / "Show less", "Also caught", the empty state, Escape / × / releasing
again, keyboard access, clicks outside the card, Shadow DOM isolation from hostile site CSS,
dark mode contrast, and the narrow-window bottom sheet. Screenshots of every page's card (light
and dark, plus the narrow sheet) go to test-pages/local/screens/ for review.

    python tests/browser/test_card.py [--skip-live]
"""

import json
import time

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from card_helpers import CARD, CARD_STATE, EXPECTED, check_rows, contrast, wait_for_card
from common import SCREENS, add_css, available, finish, label, make_driver, media, open_page, release, report

HOSTILE_CSS = (
    "* { color: red !important; font-size: 30px !important; font-family: 'Comic Sans MS' !important; line-height: 3 !important; }"
    " div { display: none !important; background: yellow !important; border: 4px solid blue !important; }"
    " table, td, th, tr { border: 5px solid magenta !important; padding: 20px !important; }"
    " button { background: black !important; } h2 { font-size: 50px !important; }"
    " .frogbot-card-host { display: none !important; position: static !important; }"
)
PAGES = ["test-page", "captions-page", "mapping-page", "nvidia-release", "apple-release", "nvidia-wikipedia", "apple-wikipedia", "forbes", "bbc"]


def load(d, name, hostile=False):
    open_page(d, name)
    d.execute_script("window.__errors = []; addEventListener('error', e => __errors.push(e.message));")
    add_css(d)
    if hostile:
        # A site with aggressive CSS: none of it may reach the card.
        d.execute_script("const s = document.createElement('style'); s.id = 'hostile'; s.textContent = arguments[0]; document.head.appendChild(s);", HOSTILE_CSS)


def test_page_checks():
    d = make_driver()
    media(d, "light", reduced=False)
    try:
        load(d, "test-page")
        before = d.execute_script("return document.body.innerHTML")
        release(d)
        # The card must only become visible after every highlight is in.
        first_visible, drop_animated = None, False
        end = time.time() + 120
        while time.time() < end:
            s = d.execute_script(CARD_STATE)
            if s["card"] and not s["measuring"]:
                first_visible = first_visible or s
                drop_animated = drop_animated or s["animations"] > 0
                if s["running"] is False:
                    break
            time.sleep(0.03)
        time.sleep(0.4)
        final = d.execute_script(CARD_STATE)
        facts = d.execute_script(EXPECTED)
        report("test-page: card appears after the last hop, with every highlight already in",
               first_visible is not None and first_visible["marks"] == final["marks"] and final["marks"] > 0,
               f"marks when card appeared {first_visible and first_visible['marks']}, final {final['marks']}")
        report("test-page: card drops in with an animation", drop_animated)
        report("test-page: frog perched on the card's top-left corner, position fixed",
               final["frogPosition"] == "fixed" and abs(final["frogRect"]["cx"] - (final["rect"]["left"] + 6)) < 3 and abs(final["frogRect"]["cy"] - (final["rect"]["top"] - 16)) < 3,
               f"frog centre {final['frogRect']}, card {final['rect']}")
        report("test-page: card fixed bottom-right, 16px from the edges, 360px wide",
               abs(final["view"]["w"] - final["rect"]["right"] - 16) < 1.5 and abs(final["view"]["h"] - final["rect"]["bottom"] - 16) < 1.5 and abs(final["rect"]["width"] - 360) < 1,
               json.dumps(final["rect"]))
        report("test-page: role=dialog with an aria-label", final["role"] == "dialog" and bool(final["aria"]), f"{final['role']} / {final['aria']}")
        report("test-page: title counts the figures", final["title"] == f"Frogbot caught {len(facts)} figures", final["title"])
        check_rows("test-page", final, facts)
        rows = final["rows"]
        report("test-page: Revenue ▲ 14.2% first", rows and rows[0]["cells"][:3] == ["Revenue", "$482.6M", "▲ 14.2%"], str(rows[0]["cells"] if rows else None))
        visible = [r["cells"][0] for r in rows if r["shown"]]
        report("test-page: main table is Revenue, Gross profit, Operating income, Net income and both guidance rows",
               visible == ["Revenue", "Gross profit", "Operating income", "Net income", "Guidance · Revenue", "Guidance · Diluted EPS"] and len(rows) == 6, str(visible))
        report("test-page: no Q3 2025 rows", not any(r["cells"][3] == "Q3 2025" for r in rows))
        gp = [r for r in rows if r["cells"][0] == "Gross profit"]
        report("test-page: Gross profit's Change cell tooltip shows the prior value", bool(gp) and gp[0]["changeTitle"] == "vs $176.2M in Q3 2025", gp[0]["changeTitle"] if gp else "")
        report("test-page: up arrows green (good sentiment)", all("good" in r["changeClass"] for r in rows if r["cells"][2].startswith("▲")))
        report("test-page: tabular numbers, Figure right-aligned", final["style"]["tableNumeric"] == "tabular-nums" and final["style"]["figureAlign"] == "right")
        report("test-page: no Frogbot errors", d.execute_script("return __errors") == [], str(d.execute_script("return __errors")))

        # The card and frog stay put while scrolling; clicks outside the card reach the page.
        d.execute_script("scrollBy(0, 400)")
        time.sleep(0.3)
        scrolled = d.execute_script(CARD_STATE)
        report("test-page: card and frog stay put while scrolling",
               scrolled["rect"] == final["rect"] and abs(scrolled["frogRect"]["cx"] - final["frogRect"]["cx"]) < 0.5 and abs(scrolled["frogRect"]["cy"] - final["frogRect"]["cy"]) < 0.5)
        hit = d.execute_script("const e = document.elementFromPoint(200, 200); return e ? (e.closest('[data-frogbot]') ? 'frogbot' : e.tagName) : null")
        inside = d.execute_script(f"const r = {CARD}.querySelector('.card').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 100, r.bottom - 40); return e && e.className")
        report("test-page: clicks outside the card reach the page; the card takes its own", hit not in ("frogbot", None) and inside == "frogbot-card-host", f"outside -> {hit}, inside -> {inside}")

        # Keyboard: the close button is focusable and Tab moves on to the next control.
        d.execute_script(f"{CARD}.querySelector('.close').focus()")
        f1 = d.execute_script(f"const a = {CARD}.activeElement; return a && a.className")
        ActionChains(d).send_keys(Keys.TAB).perform()
        time.sleep(0.1)
        f2 = d.execute_script(f"const a = {CARD}.activeElement; return a && (a.className || a.tagName)")
        report("test-page: close button focusable, Tab moves to the next control", f1 == "close" and f2 in ("summary-toggle", "more", "SUMMARY", "TR", "LI"), f"{f1} -> {f2}")
        d.save_screenshot(str(SCREENS / "test-page-scrolled-light.png"))

        # Escape: everything gone, page HTML byte-identical.
        ActionChains(d).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.3)
        gone = d.execute_script("return [document.querySelectorAll('[data-frogbot], .frogbot-card-host').length, document.body.innerHTML === arguments[0]]", before)
        report("test-page: Escape removes card, frog and highlights; body HTML identical", gone == [0, True], str(gone))

        # Releasing again after a finished run: the old card goes, one new card arrives.
        release(d)
        wait_for_card(d)
        d.execute_script("window.__oldHost = document.querySelector('.frogbot-card-host')")
        release(d)
        time.sleep(0.2)
        mid = d.execute_script("return [document.querySelectorAll('.frogbot-card-host').length, document.querySelectorAll('.frogbot-frog').length, !!(window.__oldHost && window.__oldHost.isConnected)]")
        s2 = wait_for_card(d)
        report("test-page: releasing again removes the old card first, then delivers one new card",
               mid[2] is False and mid[1] == 1 and s2["card"] and s2["hosts"] == 1 and s2["frogs"] == 1, f"right after: hosts/frogs/old={mid}")
        # Releasing mid-run still does nothing.
        d.execute_script(f"{CARD}.querySelector('.close').click()")
        time.sleep(0.2)
        release(d)
        time.sleep(1.0)
        release(d)
        time.sleep(0.3)
        report("test-page: releasing mid-run doesn't start a second frog", d.execute_script("return document.querySelectorAll('.frogbot-frog').length") == 1)
        wait_for_card(d)
        # The × button: the same clean-up.
        d.execute_script(f"{CARD}.querySelector('.close').click()")
        time.sleep(0.3)
        gone = d.execute_script("return [document.querySelectorAll('[data-frogbot], .frogbot-card-host').length, document.body.innerHTML === arguments[0]]", before)
        report("test-page: × removes card, frog and highlights; body HTML identical", gone == [0, True], str(gone))

        # Reduced motion: no drop animation; the card and frog simply appear.
        media(d, "light", reduced=True)
        load(d, "test-page")
        release(d)
        animated, s = False, {}
        end = time.time() + 90
        while time.time() < end:
            s = d.execute_script(CARD_STATE)
            if s["card"] and not s["measuring"]:
                animated = animated or s["animations"] > 0
                if s["running"] is False:
                    break
            time.sleep(0.02)
        report("test-page: reduced motion - card appears with no animation, frog perched", not animated and s.get("frogPosition") == "fixed", f"animations seen {animated}")
    finally:
        d.quit()


def isolation_checks():
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        load(d, "test-page")
        release(d)
        plain = wait_for_card(d)
        td_style = "const td = document.querySelector('main td'); const c = getComputedStyle(td); return [c.padding, c.fontSize, c.color, c.borderTopWidth]"
        page_td = d.execute_script(td_style)
        load(d, "test-page", hostile=True)
        release(d)
        hostile = wait_for_card(d)
        report("hostile site CSS doesn't change the card (Shadow DOM, inline host styles)",
               hostile["card"] and hostile["style"] == plain["style"] and hostile["hostDisplay"] == "block" and hostile["rect"] == plain["rect"],
               f"plain {plain['style']['font']} | hostile {hostile['style']['font']}, host {hostile['hostDisplay']}")
        d.execute_script("document.getElementById('hostile').remove()")
        report("card CSS doesn't leak onto the page", page_td == d.execute_script(td_style))
    finally:
        d.quit()


def page_checks():
    styles = {}
    for name in PAGES:
        if not available(name):
            continue
        facts = None
        for scheme in ("light", "dark"):
            d = make_driver()
            media(d, scheme, reduced=True)
            try:
                load(d, name)
                release(d)
                s = wait_for_card(d)
                if scheme == "light":
                    facts = d.execute_script(EXPECTED)
                if not s["card"]:
                    report(f"{label(name)}: card delivered ({scheme})", False, f"running={s['running']}")
                    continue
                styles.setdefault(scheme, {})[name] = {k: v for k, v in s["style"].items() if k not in ("tableNumeric", "figureAlign")}
                d.save_screenshot(str(SCREENS / f"{name}-{scheme}.png"))
                if scheme == "dark":
                    bg, fg, muted = s["style"]["bg"], s["style"]["fg"], s["style"]["muted"]
                    colours = {r["changeColour"] for r in s["rows"] if r["cells"][2]}
                    worst = min([contrast(c, bg) for c in colours] or [99])
                    report(f"{label(name)}: dark mode readable", contrast(fg, bg) >= 7 and contrast(muted, bg) >= 4.5 and worst >= 3 and contrast(bg, "rgb(0,0,0)") < 2,
                           f"text {contrast(fg, bg):.1f}:1, muted {contrast(muted, bg):.1f}:1, arrows >= {worst:.1f}:1")
                    continue
                _, also = check_rows(label(name), s, facts)
                page_specific(d, name, s, facts, also)
                report(f"{label(name)}: no Frogbot errors", d.execute_script("return __errors") == [], str(d.execute_script("return __errors"))[:200])
            except Exception as e:  # one page's trouble shouldn't stop the others
                report(f"{label(name)}: run ({scheme})", False, str(e)[:160])
            finally:
                d.quit()
    for scheme, per_page in styles.items():
        distinct = {json.dumps(v, sort_keys=True) for v in per_page.values()}
        report(f"card looks the same on every page ({scheme})", len(distinct) == 1, f"{len(per_page)} pages, {len(distinct)} distinct style sets")


def page_specific(d, name, s, facts, also):
    if name == "nvidia-release":
        visible = sum(r["shown"] for r in s["rows"])
        report("[live] nvidia-release: 7 rows by default with 'Show all (N)'", visible == 7 and s["more"] == f"Show all ({len(s['rows'])})", f"{visible} visible, button {s['more']!r}")
        top = [r for r in s["rows"] if r["shown"]]
        report("[live] nvidia-release: no prior-quarter rows in the top 7; net income and EPS there",
               not any(r["cells"][3] in ("Q1 FY26", "Q2 FY25") for r in top) and any("net income" in r["cells"][0] for r in top) and any("EPS" in r["cells"][0] for r in top),
               str([r["cells"][0] + " " + r["cells"][3] for r in top]))
        d.execute_script(f"{CARD}.querySelector('.more').click()")
        time.sleep(0.2)
        s2 = d.execute_script(CARD_STATE)
        report("[live] nvidia-release: 'Show all' reveals every row", all(r["shown"] for r in s2["rows"]) and s2["more"] == "Show less", f"button {s2['more']!r}")
        d.execute_script(f"{CARD}.querySelector('.more').click()")
        time.sleep(0.2)
        s3 = d.execute_script(CARD_STATE)
        report("[live] nvidia-release: 'Show less' back to 7", sum(r["shown"] for r in s3["rows"]) == 7 and s3["more"].startswith("Show all"))
        g = [r for r in s["rows"] if r["cells"][0] == "Guidance · Revenue"]
        report("[live] nvidia-release: guidance row reads $54.0B ±2%", bool(g) and g[0]["cells"][1] == "$54.0B ±2%", str(g[:1]))
    if name == "apple-wikipedia":
        rev = [r for r in s["rows"] if r["shown"] and r["cells"][0] == "Revenue"]
        report("apple-wikipedia: the top Revenue row is $416B (2025)", bool(rev) and rev[0]["cells"][1] == "$416B" and rev[0]["cells"][3] == "2025", str([r["cells"] for r in rev]))
    if name == "forbes":
        report("forbes: no 'Earnings 24%' in the main table", not any(r["cells"][0] == "Earnings" and r["cells"][1] == "24%" for r in s["rows"]), str([r["cells"][:2] for r in s["rows"]]))
        inferred = [r for r in s["rows"] if r["inferred"]]
        report("forbes: inferred periods lighter and italic with a tooltip",
               bool(inferred) and all(r["periodStyle"] == "italic" and r["periodTitle"] == "Period inferred from the page" for r in inferred)
               and all(contrast(r["periodColour"], s["style"]["bg"]) < contrast(s["style"]["fg"], s["style"]["bg"]) for r in inferred), f"{len(inferred)} inferred rows")
        snippets = [f for f in facts if f["labelConfidence"] == "low"]
        report("forbes: snippet facts are under 'Also caught', in quotes",
               bool(snippets) and all(any(f"“{f['label']}”" in item for item in s["alsoItems"]) for f in snippets), str(s["alsoItems"]))
    if name == "bbc":
        report("[live] bbc: 'No headline figures here' with its facts under 'Also caught'",
               s["empty"] == "No headline figures here" and len(s["alsoItems"]) == len(also) > 0, f"{s['empty']!r}, {s['also']}")


def narrow_checks():
    # Headless windows can't go below ~480px, so emulate a 400px-wide screen.
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 400, "height": 760, "deviceScaleFactor": 1, "mobile": False})
        load(d, "test-page")
        release(d)
        s = wait_for_card(d)
        d.save_screenshot(str(SCREENS / "test-page-narrow-light.png"))
        report("narrow window: full-width bottom sheet",
               s["card"] and abs(s["rect"]["left"]) < 0.5 and abs(s["rect"]["right"] - s["view"]["w"]) < 0.5 and abs(s["rect"]["bottom"] - s["view"]["h"]) < 0.5,
               json.dumps(s["rect"]) + f" view {s['view']}")
        report("narrow window: frog perched on the sheet, inside the window", s["frogRect"]["left"] >= 0 and s["frogRect"]["cy"] < s["rect"]["top"] + 10, json.dumps(s["frogRect"]))
        media(d, "dark", reduced=True)
        time.sleep(0.2)
        d.save_screenshot(str(SCREENS / "test-page-narrow-dark.png"))
    finally:
        d.quit()


def main():
    SCREENS.mkdir(parents=True, exist_ok=True)
    test_page_checks()
    isolation_checks()
    page_checks()
    narrow_checks()
    print(f"     screenshots in {SCREENS.relative_to(SCREENS.parents[2])}")
    finish()


if __name__ == "__main__":
    main()
