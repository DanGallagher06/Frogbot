"""Fact records on real pages: every figure is on the page, nothing is junk.

Builds the fact records for each page's chosen targets (as main.js does) and checks that each
fact's figure appears in the page's text exactly as written and wasn't flagged as junk, and
lists the facts so they can be read through. Also checks the page's company, ticker and dates
where they're known (Nvidia's and Apple's releases, the test page, and Forbes, which names
several companies and so gets none).

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
const info = FrogbotExtract.pageInfo();
const facts = FrogbotFacts.buildFacts([...byEl.values()], blocks, { page: info });
const ms = performance.now() - t0;
const page = { ...FrogbotFacts.pageIdentity({ ...info, texts: blocks.map(b => b.text) }), publishedDate: info.publishedDate };
const pageText = document.body.innerText.replace(/\s+/g, ' ');
const junkRaws = new Set(chosen.flatMap(u => u.numbers.filter(n => n.junk).map(n => n.raw)));
return { ms: +ms.toFixed(1), page, facts: facts.map(f => ({ label: f.label, display: f.display, raw: f.raw, role: f.role,
  period: f.period ? f.period.text : null, card: f.showOnCard, direction: f.direction, metric: f.metric,
  company: f.company, ticker: f.ticker, periodEnd: f.periodEnd,
  onPage: pageText.includes(f.raw.replace(/\s+/g, ' ')), junk: junkRaws.has(f.raw) })) };
"""
# Expected page identity: (company, ticker, published date); None means blank.
IDENTITY = {
    "test-page": ("Lilypad Holdings, Inc.", "LILY", "2026-10-21"),
    "nvidia-release": ("NVIDIA", "NVDA", "2025-08-27"),
    "apple-release": ("Apple", None, "2025-10-30"),
    "forbes": (None, None, None),
    # Wikipedia: the infobox's "Traded as" row, and no published date (its datePublished is the
    # article's creation).
    "nvidia-wikipedia": ("Nvidia Corporation", "NVDA", None),
    "apple-wikipedia": ("Apple Inc.", "AAPL", None),
}
# Expected period end dates: page -> {period text: date}.
PERIOD_ENDS = {
    "test-page": {"Q3 2026": "2026-09-30", "Third Quarter 2026": "2026-09-30"},
    "nvidia-release": {"Q2 FY26": "2025-07-27"},
    "apple-release": {"fourth quarter": "2025-09-27"},
}
NAMES = ["test-page", "captions-page", "mapping-page", "nvidia-wikipedia", "apple-wikipedia", "forbes", "nvidia-release", "apple-release", "bbc"]


# The tables page (step 19b fixes), with every row and sentence as a target.
TABLES = r"""
const blocks = FrogbotExtract.getBlocks(FrogbotExtract.findMainContainer());
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const facts = FrogbotFacts.buildFacts(units.map(u => ({ units: [u] })), blocks, { page: FrogbotExtract.pageInfo() });
const { rows, also } = FrogbotFacts.cardRows(facts);
return { facts: facts.map(f => ({ label: f.label, display: f.display, role: f.role, period: f.period ? f.period.text : null, card: f.showOnCard,
  prior: f.priorPeriod, recon: !!f.reconciliation, unit: f.unit, priorOf: f.prior ? f.prior.display + ' in ' + f.prior.period : null, company: f.company })),
  card: rows.map(r => r.fact.label + ' ' + r.fact.display), also: also.map(f => f.label + ' ' + f.display) };
"""


def tables_page_checks():
    if not available("tables-page"):
        return
    d = make_driver()
    try:
        open_page(d, "tables-page")
        d.execute_script(LIB)
        r = d.execute_script(TABLES)
    finally:
        d.quit()
    facts = r["facts"]
    find = lambda **kw: [f for f in facts if all(f.get(k) == v for k, v in kw.items())]
    report("tables page: 'versus £2,265m in the prior year' is the prior of £2.4B, not its own row",
           bool(find(display="£2.3B", prior=True, period="prior year")) and not find(display="£2.3B", card=True), str(find(display="£2.3B")))
    report("tables page: raised guidance £1.1B, with the old £1.0B as its prior (not a second guidance row)",
           bool(find(display="£1.1B", role="guidance", card=True, priorOf="£1.0B in previous guidance")) and not find(display="£1.0B", card=True), str(find(role="guidance")))
    report("tables page: UK header row 'H1 26/27 | H1 25/26 | Change at actual rates' read as periods and changes",
           bool(find(display="£183M", period="H1 26/27", card=True, priorOf="£163M in H1 25/26")) and bool(find(display="12.3%", role="change"))
           and not find(display="12.3%", card=True), str([f for f in facts if "operating" in f["label"].lower()][:4]))
    report("tables page: '(£ millions)' on the line above a table scales its bare numbers",
           bool(find(label="Garden centres", display="£1.5B")) and bool(find(label="Online", display="£890M")), str([f for f in facts if f["label"] in ("Garden centres", "Online")]))
    recon = find(recon=True)
    report("tables page: header table above a reconciliation table: labelled by column, scaled, off the card, in Also caught",
           len(recon) == 6 and not any(f["card"] for f in recon) and "Operating income (Adjustments) −£12M" in r["also"], str([(f["label"], f["display"]) for f in recon]))
    report("tables page: '$152m' in '£120m ($152m)' is a conversion, not a figure", not any("152" in f["display"] for f in facts), str([f["display"] for f in facts if "$" in f["display"]]))
    report("tables page: '0.4 ppts' is percentage points", bool(find(display="0.4 pts", unit="percentage_points", role="change")), str(find(unit="percentage_points")))
    report("tables page: company from 'Pondweed Group PLC' in the headline", all(f["company"] == "Pondweed Group PLC" for f in facts), str({f["company"] for f in facts}))
    report("tables page: the same revenue in prose and table is one card row", r["card"].count("Revenue £2.4B") == 1, str(r["card"]))


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
        page = r["page"]
        if name in IDENTITY:
            got = (page["company"], page["ticker"], page["publishedDate"])
            report(f"{label(name)}: page company, ticker and published date are {IDENTITY[name]}", got == IDENTITY[name], str(got))
        if name in PERIOD_ENDS:
            wrong = [(f["period"], f["periodEnd"]) for f in facts if f["period"] in PERIOD_ENDS[name] and f["periodEnd"] != PERIOD_ENDS[name][f["period"]]]
            filled = sum(1 for f in facts if f["periodEnd"])
            report(f"{label(name)}: period end dates filled ({filled} facts)", filled > 0 and not wrong, str(wrong[:3]))
        if name == "forbes":
            meta = [f for f in facts if "Meta Platforms" in (f["label"] or "")]
            report("forbes: the Meta Platforms fact names its own company and ticker",
                   bool(meta) and all(f["company"] == "Meta Platforms" and f["ticker"] == "META" for f in meta), str([(f["display"], f["company"], f["ticker"]) for f in meta]))
            others = [f for f in facts if f not in meta and (f["company"] or f["ticker"])]
            report("forbes: other facts have no company (several are named equally)", not others, str([(f["label"], f["company"]) for f in others][:3]))
        if name in IDENTITY and name != "forbes" and not name.endswith("wikipedia"):
            names = {(f["company"], f["ticker"]) for f in facts}
            report(f"{label(name)}: every fact inherits the page's company", names == {(page["company"], page["ticker"])}, str(names))
    tables_page_checks()
    finish()


if __name__ == "__main__":
    main()
