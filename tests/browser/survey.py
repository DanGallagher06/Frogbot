"""Real-world survey: run Frogbot on saved finance pages and write a review workbook.

For every page in the corpus folder (default test-pages/local/corpus/, gitignored), this runs
the full flow in headless Edge and records what happened, then writes review.xlsx to the same
folder with Frogbot's own xlsx writer (content/xlsx.js):

- Summary: per page, the page type, currency, company and ticker, blocks extracted, likely junk
  blocks, likely missed paragraphs, targets, card rows, "Also caught", the summary used, console
  errors, timings, anything visibly broken, and a one-line verdict; plus precision columns
  (picks, labels, periods, directions) worked out by formulas from the Y/N answers on the other
  sheets, per page and for all pages.
- Picks: every target picked (page, sentence or row, score, top reasons) with an empty
  "Important? (Y/N)" column.
- Facts: every fact (metric, figure, period, role, direction, confidences, source text) with
  empty "Label right?", "Period right?" and "Direction right?" columns.

It also writes survey.json (everything recorded, for comparing runs). The survey doesn't
change anything: it reads Frogbot's results and the page.

Saved pages are loaded with their own scripts turned off (saved copies of news sites often
rebuild or redirect themselves offline), then Frogbot runs normally. A corpus.json beside the
pages can set, per file: {"scripts": true} to let the page's scripts run, "type" to override the
page-type guess, and "url" (the original address, for the report).

    uv run --with selenium python tests/browser/survey.py [--dir FOLDER] [--known] [--out FILE] [--only a,b]

--known also surveys the pages the browser suites already use (the test pages, the saved
Wikipedia and Forbes pages, and the live Nvidia, Apple and BBC pages unless --skip-live).
"""

import base64
import json
import pathlib
import statistics
import sys
import time

from card_helpers import CARD
from common import JS, LOCAL, PAGES, ROOT, available, get, make_driver, media, open_page

LIB = "\n".join((ROOT / "content" / f"{name}.js").read_text(encoding="utf-8") for name in ("extract", "score", "facts", "summary"))
XLSX = (ROOT / "content" / "xlsx.js").read_text(encoding="utf-8")
CSS = (ROOT / "content" / "frogbot.css").read_text(encoding="utf-8")
KNOWN = ["test-page", "captions-page", "mapping-page", "nvidia-wikipedia", "apple-wikipedia", "forbes", "nvidia-release", "apple-release", "bbc"]

# What Frogbot extracts, picks and records on the page, as main.js does it, plus heuristics for
# junk that got through and paragraphs that were missed.
ANALYZE = r"""
const t0 = performance.now();
const container = FrogbotExtract.findMainContainer();
const blocks = FrogbotExtract.getBlocks(container);
const t1 = performance.now();
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const totalWords = blocks.reduce((s, b) => s + b.text.split(/\s+/).length, 0);
const { chosen } = FrogbotScore.rankUnits(units, { totalWords });
const byEl = new Map();
for (const u of chosen) { if (!byEl.has(u.element)) byEl.set(u.element, { element: u.element, highlight: u.highlight, units: [] }); byEl.get(u.element).units.push(u); }
const t2 = performance.now();
const info = FrogbotExtract.pageInfo();
const facts = FrogbotFacts.buildFacts([...byEl.values()], blocks, { page: info });
const t3 = performance.now();
const identity = FrogbotFacts.pageIdentity({ ...info, texts: blocks.map(b => b.text) });
const { rows, also } = FrogbotFacts.cardRows(facts);
const summary = FrogbotSummary.rulesSummary(facts);

const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim();
const JUNK = /^(advertisement|sponsored|subscribe|sign up|sign in|log in|read more|related( articles| stories)?|share( this)?|follow us|newsletter|accept( all)? cookies|cookie|all rights reserved|copyright|©|privacy policy|terms of (use|service)|click here|watch:|listen|most (read|popular)|trending|recommended|more from|get the app|download the app)\b/i;
const linkShare = (el) => { const t = collapse(el.textContent).length || 1; let a = 0; for (const l of el.querySelectorAll('a')) a += collapse(l.textContent).length; return a / t; };
const junk = blocks.filter(b => JUNK.test(b.text) || /cookie|consent/i.test(b.text) && b.text.length < 300 || (b.text.length < 200 && linkShare(b.element) > 0.7)).map(b => b.text.slice(0, 100));
const blockEls = blocks.map(b => b.element);
const FIN = /\b(revenues?|sales|profits?|net income|earnings|EPS|margins?|guidance|outlook|cash flow|EBITDA|operating income|dividends?|shares?|stock|quarter|fiscal)\b/i;
const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const missed = [...document.querySelectorAll('p, li')].filter(el => {
  const t = collapse(el.textContent);
  if (t.length < 80 || !/\d/.test(t) || !FIN.test(t)) return false;
  if (el.closest('nav, header, footer, aside, [data-frogbot], .references, .reflist, .mw-references-wrap, cite, .citation') || !visible(el)) return false;
  // Summary and key-point boxes the extractor skips on purpose (a site's own AI summary).
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (/(^|[\s_-])(summary|key-?points|key-?takeaways|takeaways|tldr)/i.test(typeof e.className === 'string' ? e.className : '')) return false;
  }
  if (/\b(Retrieved|Archived from)\b/.test(t)) return false; // reference lists
  return !blockEls.some(b => b === el || b.contains(el) || el.contains(b));
}).map(el => collapse(el.textContent).slice(0, 120));

// Page type: a guess from the address and the text.
const text = collapse(document.body.innerText);
const words = text.split(' ').length;
const finance = (text.match(/\b(revenues?|net income|earnings per share|EPS|operating income|gross margin|guidance|outlook|fiscal|quarter|dividend|EBITDA|cash flow)\b/gi) || []).length;
let type = 'news';
if (info.wiki) type = 'reference (wiki)';
else if (/(^|\.)sec\.gov$/.test(location.hostname) || /SECURITIES AND EXCHANGE COMMISSION/.test(text) || /\bFORM\s+(10-K|10-Q|8-K|20-F|6-K)\b/.test(text)) type = 'SEC filing';
else if (words < 1500 && /\b(market cap|prev(ious)? close|52[- ]week|day'?s range|P\/E)\b/i.test(text)) type = 'quote page';
else if (words < 600 && /\b(subscribe|subscription|subscriber|sign in to (read|continue)|create a free account|to continue reading)\b/i.test(text)) type = 'paywall';
else if (finance < 3) type = 'non-finance';
else if (identity.ticker && /\b(today )?(announced|reports?|reported) .{0,80}\bresults\b/i.test(text)) type = 'company release';
const currencies = {};
for (const f of facts) if (f.currency) currencies[f.currency] = (currencies[f.currency] || 0) + 1;
const currency = Object.entries(currencies).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || null;
const reasons = (u) => (u.reasons || []).filter(r => / \+\d+$/.test(r)).sort((a, b) => Number(b.match(/(\d+)$/)[1]) - Number(a.match(/(\d+)$/)[1])).slice(0, 3);
return {
  type, words, currency, company: identity.company, ticker: identity.ticker, published: info.publishedDate,
  container: container ? (container.id ? '#' + container.id : container.tagName.toLowerCase()) : null,
  blocks: blocks.length, junk, missed,
  ms: { extract: +(t1 - t0).toFixed(1), score: +(t2 - t1).toFixed(1), facts: +(t3 - t2).toFixed(1) },
  picks: chosen.map(u => ({ text: collapse(u.text).slice(0, 300), fullText: u.text, score: u.finalScore ?? u.score, kind: u.kind, reasons: reasons(u).join('; ') })),
  facts: facts.map(f => ({ label: f.label, metric: f.metric, display: f.display, raw: f.raw, period: f.period ? f.period.text : null,
    role: f.role, direction: f.direction, labelConfidence: f.labelConfidence, periodConfidence: f.periodConfidence,
    sentence: collapse(f.sentence).slice(0, 300), card: f.showOnCard })),
  cardRows: rows.length, also: also.length, summarySentences: summary ? summary.sentences.length : 0,
};
"""

# Watch hooks for the real run: errors, and the page as it was.
BEFORE = r"""
window.__surveyErrors = [];
addEventListener('error', e => /^ResizeObserver loop/.test(e.message) || __surveyErrors.push(e.message));
const orig = console.error.bind(console);
console.error = (...a) => { __surveyErrors.push(a.map(String).join(' ').slice(0, 200)); orig(...a); };
return { html: document.body.innerHTML, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
"""
# The frog's position, and the scroll position: it only counts as off-screen while the page is
# still (during a smooth scroll to the next target it's behind by design).
FROG = r"""const f = document.querySelector('.frogbot-frog'); if (!f) return null; const r = f.getBoundingClientRect();
const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
return { off: cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight, y: scrollY };"""
AFTER = r"""
const host = document.querySelector('.frogbot-card-host');
const sr = host && host.shadowRoot;
const card = sr && sr.querySelector('.card');
let covered = 0, points = 0;
if (card) {
  const r = card.getBoundingClientRect();
  for (const [fx, fy] of [[0.2, 0.1], [0.8, 0.1], [0.5, 0.5], [0.2, 0.9], [0.8, 0.9]]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    points++;
    if (document.elementFromPoint(x, y) !== host) covered++;
  }
}
const marks = [...document.querySelectorAll('mark')];
// A highlight is odd if it's empty, has no size, or its text isn't in any picked sentence or row
// (a figure split across the page's markup gives several marks, and periods are marked too).
const picked = arguments[0].map(t => t.replace(/\s+/g, ' '));
const odd = marks.filter(m => { const t = m.textContent.replace(/\s+/g, ' ').trim(); const r = m.getBoundingClientRect();
  return !t || r.width === 0 || r.height === 0 || !picked.some(p => p.includes(t)); }).map(m => m.textContent.slice(0, 40));
return {
  card: !!card, cardRows: sr ? sr.querySelectorAll('tbody tr').length : 0, also: sr ? sr.querySelectorAll('details li').length : 0,
  summary: sr && sr.querySelector('.summary-toggle') ? sr.querySelector('.summary-toggle').textContent.replace(/[▾▸]/g, '').replace(/\s+/g, ' ').trim() : '',
  company: sr ? (sr.querySelector('.company') || {}).textContent || '' : '',
  covered, points, marks: marks.length, oddMarks: odd,
  width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  errors: window.__surveyErrors || [], said: (document.querySelector('.frogbot-bubble') || {}).textContent || '',
};
"""


def load(d, page):
    if page["known"]:
        open_page(d, page["name"])
        return
    if not page.get("scripts"):
        d.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": True})
    get(d, page["path"].as_uri())
    if not page.get("scripts"):
        d.execute_cdp_cmd("Emulation.setScriptExecutionDisabled", {"value": False})
    time.sleep(1)


def survey_page(page):
    # A browser session occasionally drops on a busy machine: once more before giving up.
    record = survey_once(page)
    if any("closed the connection" in p for p in record["problems"]):
        record = survey_once(page)
    return record


def survey_once(page):
    record = {"page": page["label"], "url": page.get("url"), "problems": []}
    d = make_driver(page_timeout=60)
    media(d, "light", reduced=False)
    try:
        load(d, page)
        # Is the page changing by itself (its own scripts)? Then "Escape restores the page" can't be judged.
        first = d.execute_script("return document.body.innerHTML")
        time.sleep(1.5)
        self_changing = d.execute_script("return document.body.innerHTML") != first
        d.execute_script(LIB)
        analysis = d.execute_script(ANALYZE)
        record.update(analysis)
        if page.get("type"):
            record["type"] = page["type"]
    except Exception as error:
        record["problems"].append(f"analysis failed: {str(error).splitlines()[0][:300]}")
        record["verdict"] = verdict(record)
        d.quit()
        return record
    d.quit()

    # The real run, in a fresh browser: release, watch the frog, wait for the card, then Escape.
    d = make_driver(page_timeout=60)
    media(d, "light", reduced=False)
    try:
        load(d, page)
        d.execute_script("if (!document.getElementById('__frogbot_css')) { const s = document.createElement('style'); s.id = '__frogbot_css'; s.textContent = arguments[0]; document.head.appendChild(s); }", CSS)
        before = d.execute_script(BEFORE)
        started = time.time()
        d.execute_script(JS)
        offscreen = samples = 0
        last_y = None
        card = False
        while time.time() - started < 150:
            frog = d.execute_script(FROG)
            if frog is None and not d.execute_script("return !!window.__frogbotRunning"):
                break
            if frog is not None:
                if frog["y"] == last_y:
                    samples += 1
                    offscreen += bool(frog["off"])
                last_y = frog["y"]
            if d.execute_script("const h = document.querySelector('.frogbot-card-host'); return !!(h && h.shadowRoot.querySelector('.card:not(.measuring)'))"):
                card = True
                time.sleep(0.8)
                break
            time.sleep(0.25)
        record["runSeconds"] = round(time.time() - started, 1)
        after = d.execute_script(AFTER, [p["fullText"] for p in record.get("picks", [])])
        record["run"] = after
        record["frogOffscreen"] = f"{offscreen}/{samples}"
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
        time.sleep(0.6)
        restored = d.execute_script("return document.body.innerHTML") == before["html"]
        leftovers = d.execute_script("return document.querySelectorAll('[data-frogbot], mark.frogbot-num, .frogbot-hl').length")

        problems = record["problems"]
        if record.get("facts") and not card:
            problems.append("no card although facts were found")
        if samples and offscreen / samples > 0.2:
            problems.append(f"frog off-screen in {offscreen} of {samples} checks")
        if after["covered"]:
            problems.append(f"card covered at {after['covered']} of {after['points']} points")
        if after["oddMarks"]:
            problems.append(f"{len(after['oddMarks'])} highlights empty, hidden or not a figure")
        if after["overflow"] and not before["overflow"]:
            problems.append("page scrolls sideways after the run")
        elif not self_changing and before["height"] and abs(after["height"] - before["height"]) / before["height"] > 0.02:
            problems.append(f"page height changed {before['height']} -> {after['height']}")
        if after["errors"]:
            problems.append(f"{len(after['errors'])} console errors")
        if leftovers:
            problems.append(f"{leftovers} Frogbot elements left after Escape")
        if self_changing:
            record["escape"] = "n/a (page changes itself)"
        else:
            record["escape"] = "restored" if restored else "NOT restored"
            if not restored:
                problems.append("Escape didn't restore the page exactly")
    except Exception as error:
        record["problems"].append(f"run failed: {str(error).splitlines()[0][:150]}")
    finally:
        d.quit()
    record["verdict"] = verdict(record)
    return record


def verdict(r):
    if any(p.startswith(("analysis failed", "run failed")) for p in r["problems"]):
        return "Broken: " + r["problems"][0]
    if not r.get("facts"):
        return "Nothing caught" + (" (expected: " + r.get("type", "") + ")" if r.get("type") in ("non-finance", "paywall") else "")
    issues = len(r["problems"]) + (len(r.get("junk", [])) > 3) + (len(r.get("missed", [])) > 3)
    who = f"{r.get('company') or 'no company'}" + (f" ({r['ticker']})" if r.get("ticker") else "")
    rows = r.get("run", {}).get("cardRows", r.get("cardRows", 0))
    if not issues:
        return f"OK: {rows} card rows, {who}"
    return f"Check: {rows} card rows, {who}; " + "; ".join(r["problems"][:2] or ["junk/missed content"])


# ---- The workbook ----

def text(v):
    return None if v in (None, "") else str(v)


def precision(sheet, answer_col, page_cell=None):
    """A formula for the share of Y among the Y/N answers in a column, for one page or all."""
    if page_cell:
        y = f'COUNTIFS({sheet}!$A:$A,{page_cell},{sheet}!${answer_col}:${answer_col},"Y")'
        n = f'COUNTIFS({sheet}!$A:$A,{page_cell},{sheet}!${answer_col}:${answer_col},"N")'
    else:
        y = f'COUNTIF({sheet}!${answer_col}:${answer_col},"Y")'
        n = f'COUNTIF({sheet}!${answer_col}:${answer_col},"N")'
    return {"formula": f'IFERROR({y}/({y}+{n}),"")', "format": "0%"}


def workbook_spec(records):
    YN = ["Y", "N"]
    picks = [[r["page"], p["text"], p["score"], p["reasons"], None] for r in records for p in r.get("picks", [])]
    facts = [[r["page"], f["metric"] or f["label"], f["display"], f["period"], f["role"], f["direction"],
              f["labelConfidence"], f["periodConfidence"], f["sentence"], None, None, None] for r in records for f in r.get("facts", [])]
    summary = []
    for i, r in enumerate(records):
        row = i + 2
        run = r.get("run", {})
        cell = f"$A{row}"
        summary.append([
            r["page"], text(r.get("type")), text(r.get("currency")), text(r.get("company")), text(r.get("ticker")),
            r.get("blocks"), len(r.get("junk", [])), len(r.get("missed", [])), len(r.get("picks", [])),
            run.get("cardRows"), run.get("also"), text(run.get("summary")), len(run.get("errors", [])),
            (r.get("ms") or {}).get("extract"), (r.get("ms") or {}).get("score"), r.get("runSeconds"),
            text(r.get("escape")), text("; ".join(r["problems"])), r.get("verdict"),
            precision("Picks", "E", cell), precision("Facts", "J", cell), precision("Facts", "K", cell), precision("Facts", "L", cell),
        ])
    summary.append(["All pages"] + [None] * 18 + [precision("Picks", "E"), precision("Facts", "J"), precision("Facts", "K"), precision("Facts", "L")])
    col = lambda header, width, **kw: {"header": header, "width": width, **kw}
    return {"sheets": [
        {"sheet": "Summary", "columns": [
            col("page", 34), col("type", 15), col("currency", 9), col("company", 22), col("ticker", 8), col("blocks", 8),
            col("junk blocks", 11), col("missed paragraphs", 12), col("targets", 8), col("card rows", 9), col("also caught", 10),
            col("summary", 22), col("console errors", 10), col("extract ms", 10), col("score ms", 9), col("run s", 7),
            col("Escape", 12), col("problems", 50, wrap=True), col("verdict", 50, wrap=True),
            col("picks precision", 11), col("label precision", 11), col("period precision", 11), col("direction precision", 11)],
         "rows": summary},
        {"sheet": "Picks", "columns": [
            col("page", 30), col("sentence or row", 80, wrap=True), col("score", 7), col("top reasons", 40, wrap=True),
            col("Important? (Y/N)", 16, choices=YN)], "rows": picks},
        {"sheet": "Facts", "columns": [
            col("page", 30), col("metric", 22), col("figure", 14), col("period", 18), col("role", 10), col("direction", 10),
            col("label confidence", 11), col("period confidence", 11), col("source text", 70, wrap=True),
            col("Label right? (Y/N)", 14, choices=YN), col("Period right? (Y/N)", 14, choices=YN), col("Direction right? (Y/N)", 16, choices=YN)],
         "rows": facts},
    ]}


def write_workbook(spec, out):
    d = make_driver()
    try:
        d.get("data:text/html,<title>xlsx</title>")
        d.execute_script(XLSX)
        b64 = d.execute_script("const bytes = FrogbotXlsx.build(arguments[0]); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);", spec)
    finally:
        d.quit()
    out.write_bytes(base64.b64decode(b64))


def corpus_pages(folder):
    options = {}
    config = folder / "corpus.json"
    if config.exists():
        options = json.loads(config.read_text(encoding="utf-8"))
    pages = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in (".html", ".htm", ".mhtml", ".mht") or path.name.startswith("review"):
            continue
        pages.append({"label": path.stem[:60], "path": path, "known": False, **options.get(path.name, {})})
    return pages


def main():
    args = sys.argv[1:]
    folder = pathlib.Path(args[args.index("--dir") + 1]) if "--dir" in args else LOCAL / "corpus"
    out = pathlib.Path(args[args.index("--out") + 1]) if "--out" in args else folder / "review.xlsx"
    pages = corpus_pages(folder) if folder.exists() else []
    only = args[args.index("--only") + 1].split(",") if "--only" in args else None
    if not folder.exists():
        print(f"No corpus folder at {folder}")
    if "--known" in args:
        pages += [{"label": name, "name": name, "known": True, "url": PAGES[name][1]} for name in KNOWN if available(name)]
    if only:
        pages = [p for p in pages if p["label"] in only or p.get("name") in only]
    if not pages:
        sys.exit("No pages to survey.")
    records = []
    for page in pages:
        print(f"surveying {page['label']} ...", flush=True)
        record = survey_page(page)
        records.append(record)
        run = record.get("run", {})
        print(f"  {record.get('type')}: {record.get('blocks')} blocks, {len(record.get('picks', []))} picks, {len(record.get('facts', []))} facts, "
              f"{run.get('cardRows')} card rows; {record['verdict']}", flush=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    (out.parent / (out.stem + ".json")).write_text(json.dumps(records, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    write_workbook(workbook_spec(records), out)
    print(f"wrote {out} and {out.stem}.json")


if __name__ == "__main__":
    main()
