"""Fact records on real pages: every figure is on the page, nothing is junk.

Builds the fact records for each page's chosen targets (as main.js does) and checks that each
fact's figure appears in the page's text exactly as written and wasn't flagged as junk, and
lists the facts so they can be read through.

    python tests/browser/test_facts_pages.py [--skip-live] [--quiet]
"""

import sys

from common import PAGES, ROOT, available, finish, info, label, make_driver, open_page, report

LIB = "\n".join((ROOT / "content" / f"{name}.js").read_text(encoding="utf-8") for name in ("extract", "score", "facts"))
RUN = r"""
const blocks = FrogbotExtract.getBlocks(FrogbotExtract.findMainContainer());
const words = blocks.reduce((s, b) => s + b.text.split(/\s+/).length, 0);
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const { chosen } = FrogbotScore.rankUnits(units, { totalWords: words });
const byEl = new Map();
for (const u of chosen) { if (!byEl.has(u.element)) byEl.set(u.element, { element: u.element, units: [] }); byEl.get(u.element).units.push(u); }
const t0 = performance.now();
const facts = FrogbotFacts.buildFacts([...byEl.values()], blocks);
const ms = performance.now() - t0;
const pageText = document.body.innerText.replace(/\s+/g, ' ');
const junkRaws = new Set(chosen.flatMap(u => u.numbers.filter(n => n.junk).map(n => n.raw)));
return { ms: +ms.toFixed(1), facts: facts.map(f => ({ label: f.label, display: f.display, raw: f.raw, role: f.role,
  period: f.period ? f.period.text : null, card: f.showOnCard, direction: f.direction,
  onPage: pageText.includes(f.raw.replace(/\s+/g, ' ')), junk: junkRaws.has(f.raw) })) };
"""
NAMES = ["test-page", "captions-page", "mapping-page", "nvidia-wikipedia", "apple-wikipedia", "forbes", "nvidia-release", "apple-release", "bbc"]


def main():
    quiet = "--quiet" in sys.argv
    for name in NAMES:
        if not available(name):
            continue
        d = make_driver(page_timeout=60)
        try:
            open_page(d, name, wait=4 if PAGES[name][0] == "live" else 2)
            d.execute_script(LIB)
            r = d.execute_script(RUN)
        finally:
            d.quit()
        facts = r["facts"]
        bad = [f for f in facts if not f["onPage"] or f["junk"]]
        if not quiet:
            for f in facts:
                flag = "card " if f["card"] else "     "
                info(f"{flag}{f['label'][:36]:<36} {f['display']:<14} {f['role']:<8} {f['direction'] or '-':<5} {f['period'] or ''}")
        report(f"{label(name)}: facts built ({len(facts)} in {r['ms']} ms)", len(facts) > 0)
        report(f"{label(name)}: every fact's figure is on the page, none is junk", not bad, str([(f["label"], f["raw"]) for f in bad][:4]))
    finish()


if __name__ == "__main__":
    main()
