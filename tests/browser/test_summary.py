"""The written summary on the card.

Covers: the rules summary on each page (and the number checker passing it, given the page's
own source sentences), every summary number jumping to its exact figure, GAAP / non-GAAP kept
distinct, inferred periods not stated, no summary without card facts, Copy summary, the
open/closed state remembered between runs, and Escape / × / releasing again restoring the
page exactly after summary clicks.

    python tests/browser/test_summary.py [--skip-live]
"""

import json
import time

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from card_helpers import CARD, EXPECTED, wait_for_card
from common import add_css, available, finish, info, label, make_driver, media, open_page, release, report

# The summary as the card shows it, plus what the checker makes of it given the facts and the
# chosen sentences (the same sources an AI summariser would be given).
SUMMARY_STATE = r"""
const sec = document.querySelector('.frogbot-card-host').shadowRoot.querySelector('.summary');
const blocks = FrogbotExtract.getBlocks(FrogbotExtract.findMainContainer());
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const totalWords = blocks.reduce((s, b) => s + b.text.split(/\s+/).length, 0);
const { chosen } = FrogbotScore.rankUnits(units, { totalWords });
const byEl = new Map();
for (const u of chosen) { if (!byEl.has(u.element)) byEl.set(u.element, { element: u.element, units: [] }); byEl.get(u.element).units.push(u); }
const facts = FrogbotFacts.buildFacts([...byEl.values()], blocks);
const rules = FrogbotSummary.rulesSummary(facts);
const checked = rules ? FrogbotSummary.checkSummary(rules.sentences.map(s => s.text).join(' '), facts, chosen.map(u => u.text)) : null;
return {
  shown: !!sec,
  label: sec ? [...sec.querySelector('.summary-toggle').children].map(c => c.textContent).slice(0, 2).join(' ') : null,
  collapsed: sec ? sec.classList.contains('collapsed') : null,
  items: sec ? [...sec.querySelectorAll('li')].map(li => li.textContent) : [],
  links: sec ? [...sec.querySelectorAll('.num-link')].map(b => ({ text: b.textContent, id: b.dataset.factId })) : [],
  numbersInText: rules ? rules.sentences.reduce((n, s) => n + s.numbers.length, 0) : 0,
  dropped: checked ? checked.dropped : [],
  inferred: facts.filter(f => f.showOnCard && f.periodInferred && f.period).map(f => f.period.text),
};
"""
# The pulsed figure's text (a figure split across elements has several marks).
PULSED = "return [...document.querySelectorAll('mark.frogbot-outline, mark.frogbot-pulse')].map(m => m.textContent).join('')"
# A stand-in for chrome.storage.local that lives as long as the page (the real one persists).
FAKE_STORAGE = r"""
window.__store = window.__store || {};
window.chrome = window.chrome || {};
window.chrome.storage = { local: {
  get: (defaults) => Promise.resolve(Object.assign({}, defaults, window.__store)),
  set: (items) => { Object.assign(window.__store, items); return Promise.resolve(); },
} };
"""
PAGES = ["test-page", "captions-page", "mapping-page", "nvidia-wikipedia", "apple-wikipedia", "forbes", "nvidia-release", "apple-release", "bbc"]


def load(d, name):
    open_page(d, name)
    d.execute_script("window.__errors = []; addEventListener('error', e => __errors.push(e.message));")
    add_css(d)


def per_page_checks():
    for name in PAGES:
        if not available(name):
            continue
        d = make_driver()
        media(d, "light", reduced=True)
        try:
            load(d, name)
            release(d)
            wait_for_card(d)
            s = d.execute_script(SUMMARY_STATE)
            info(f"{name}: " + (" / ".join(s["items"]) if s["shown"] else "(no summary)"))
            if name == "bbc":
                report("[live] bbc: no summary section (no card facts)", not s["shown"])
                continue
            report(f"{label(name)}: summary shown, labelled as built from page figures", s["shown"] and s["label"] == "Summary · built from page figures" and 1 <= len(s["items"]) <= 4,
                   f"{s['label']!r}, {len(s['items'])} sentences")
            report(f"{label(name)}: every number in the summary is a link", len(s["links"]) == s["numbersInText"] > 0, f"{len(s['links'])} links, {s['numbersInText']} numbers")
            report(f"{label(name)}: the number checker keeps every sentence of the rules summary", not s["dropped"], json.dumps(s["dropped"])[:200])
            text = " ".join(s["items"])
            stated = [p for p in s["inferred"] if p.lower() in text.lower()]
            report(f"{label(name)}: no inferred period stated", not stated, str(stated))
            # Every linked number jumps to its exact figure.
            facts = {f["id"]: f for f in d.execute_script(EXPECTED)}
            bad = []
            for i, link in enumerate(s["links"]):
                d.execute_script(f"{CARD}.querySelectorAll('.summary .num-link')[arguments[0]].click()", i)
                time.sleep(0.08)
                pulsed = d.execute_script(PULSED)
                want = facts[link["id"]]["raw"]
                if "".join(pulsed.split()) != "".join(want.split()):
                    bad.append((link["text"], want, pulsed))
            report(f"{label(name)}: every summary number jumps to its exact figure", not bad, str(bad[:3]))
            if name == "test-page":
                report("test-page: revenue with its 14.2% rise, operating and net income, and the guidance range",
                       "Revenue rose 14.2% to $482.6M" in text and "operating income" in text.lower() and "net income" in text and "$505M–$525M" in text, text)
            if name == "nvidia-release":
                both = [x for x in s["items"] if "GAAP operating income" in x and "non-GAAP operating income" in x]
                report("[live] nvidia-release: GAAP and non-GAAP stay distinct", bool(both), str(both))
                report("[live] nvidia-release: the guidance shows ±2%", any("±2%" in x for x in s["items"]), text)
            if name == "forbes":
                report("forbes: the inferred period (third-quarter) isn't stated", "third" not in text.lower() and bool(s["inferred"]), f"inferred periods {s['inferred']}")
            report(f"{label(name)}: no Frogbot errors", d.execute_script("return __errors") == [], str(d.execute_script("return __errors"))[:200])
        except Exception as e:  # one page's trouble shouldn't stop the others
            report(f"{label(name)}: run", False, str(e)[:160])
        finally:
            d.quit()


def card_checks():
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        load(d, "test-page")
        before = d.execute_script("return document.body.innerHTML")
        d.execute_script(FAKE_STORAGE)
        release(d)
        wait_for_card(d)
        s = d.execute_script(SUMMARY_STATE)
        report("summary is open by default", s["collapsed"] is False)

        # Copy summary: the sentences as plain text, one per line.
        d.execute_cdp_cmd("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
        d.execute_script(f"return {CARD}.querySelector('.copy-summary')").click()
        time.sleep(0.2)
        shown = d.execute_script(f"return {CARD}.querySelector('.copy-summary').textContent")
        text = d.execute_async_script("const done = arguments[0]; navigator.clipboard.readText().then(done, e => done('ERR ' + e))").replace("\r\n", "\n")
        report("Copy summary copies the sentences as plain text", shown == "Copied ✓" and text == "\n".join(s["items"]) + "\n", f"{shown!r} {text[:80]!r}")
        buttons = d.execute_script(f"return [...{CARD}.querySelectorAll('.actions button')].map(b => b.className)")
        report("Copy summary sits next to Copy table", buttons[:2] == ["action copy", "action copy-summary"], str(buttons))

        # Collapse, then the next run remembers it.
        d.execute_script(f"{CARD}.querySelector('.summary-toggle').click()")
        time.sleep(0.1)
        collapsed = d.execute_script(SUMMARY_STATE)["collapsed"]
        stored = d.execute_script("return window.__store")
        ActionChains(d).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.3)
        report("Escape after summary clicks and copying restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))
        release(d)
        wait_for_card(d)
        time.sleep(0.2)
        again = d.execute_script(SUMMARY_STATE)["collapsed"]
        report("collapsing is remembered for the next run", collapsed is True and stored == {"summaryOpen": False} and again is True, f"collapsed {collapsed}, stored {stored}, next run collapsed {again}")
        d.execute_script(f"{CARD}.querySelector('.summary-toggle').click()")
        time.sleep(0.1)
        report("opening it again is remembered too", d.execute_script("return window.__store") == {"summaryOpen": True} and d.execute_script(SUMMARY_STATE)["collapsed"] is False)

        # A summary number click, then ×; then releasing again; then Escape.
        d.execute_script(f"{CARD}.querySelector('.summary .num-link').click()")
        time.sleep(0.2)
        d.execute_script(f"{CARD}.querySelector('.close').click()")
        time.sleep(0.3)
        report("× after a summary click restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))
        release(d)
        wait_for_card(d)
        d.execute_script(f"{CARD}.querySelector('.summary .num-link').click()")
        release(d)
        s2 = wait_for_card(d)
        report("releasing again after a summary click gives one fresh card", s2["hosts"] == 1 and s2["frogs"] == 1)
        ActionChains(d).send_keys(Keys.ESCAPE).perform()
        time.sleep(0.3)
        report("...and Escape restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))
    finally:
        d.quit()


def main():
    per_page_checks()
    card_checks()
    finish()


if __name__ == "__main__":
    main()
