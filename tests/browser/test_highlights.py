"""Exact-number highlighting and exact restore.

Covers: every expected figure on the mapping page highlighted exactly (data-expect-figures),
clearAll() restoring the HTML exactly, the test page's headline figures highlighted, and the
page HTML byte-identical after Escape, both after a run and mid-run, on all three test pages.

    python tests/browser/test_highlights.py
"""

import time

from common import CSS, ROOT, add_css, escape, finish, info, make_driver, open_page, release, report

LIB = "\n".join((ROOT / "content" / f"{name}.js").read_text(encoding="utf-8") for name in ("highlight", "extract", "score"))
# Mark every expected case on the mapping page directly, whichever targets would win.
MAP_CHECK = r"""
const blocks = FrogbotExtract.getBlocks();
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const before = document.body.innerHTML;
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const results = [];
for (const el of document.querySelectorAll('[data-expect-figures]')) {
  const expected = el.dataset.expectFigures.split('|');
  const got = [];
  let problem = null;
  if (el.tagName === 'TR') {
    const unit = units.find(u => u.kind === 'row' && u.highlight === el);
    if (!unit) problem = 'row not extracted';
    else for (const g of FrogbotScore.figureGroups(FrogbotScore.detectNumbers(unit.text, {inTable: true}), unit.text)) {
      for (const n of [g.figure, ...g.extras]) {
        const cell = unit.cells.find(c => n.start >= c.start && n.start < c.end);
        const els = FrogbotHighlight.markNumber({element: cell.element, text: cell.text}, {...n, start: n.start - cell.start, end: n.end - cell.start});
        got.push(els ? clean(els.map(e => e.textContent).join('')) : 'UNMAPPED ' + n.raw);
      }
    }
  } else {
    const block = blocks.find(b => b.element === el);
    if (!block) problem = 'block not extracted';
    else for (const g of FrogbotScore.figureGroups(FrogbotScore.detectNumbers(block.text), block.text)) {
      for (const n of [g.figure, ...g.extras].sort((a, b) => a.start - b.start)) {
        const els = FrogbotHighlight.markNumber(block, n);
        got.push(els ? clean(els.map(e => e.textContent).join('')) : 'UNMAPPED ' + n.raw);
      }
    }
  }
  got.sort((a, b) => el.textContent.indexOf(a.split(' ')[0]) - el.textContent.indexOf(b.split(' ')[0]));
  results.push({expected, got, problem, ok: !problem && JSON.stringify([...expected].sort()) === JSON.stringify([...got].sort()),
                text: clean(el.textContent).slice(0, 60)});
}
const visible = [...document.querySelectorAll('mark.frogbot-num.frogbot-num-on')].length;
FrogbotHighlight.clearAll();
return {results, visible, restored: document.body.innerHTML === before};
"""


def main():
    d = make_driver(reduced=True, page_timeout=60)
    try:
        # The mapping page: exact figures, then an exact restore.
        open_page(d, "mapping-page", wait=0.5)
        add_css(d)
        d.execute_script(LIB)
        r = d.execute_script(MAP_CHECK)
        for x in r["results"]:
            if not x["ok"]:
                info(f"BAD {x['text']}: expected {x['expected']}, got {x['got']}" + (f" ({x['problem']})" if x["problem"] else ""))
        report("mapping-page: every expected figure highlighted exactly", all(x["ok"] for x in r["results"]),
               f"{sum(x['ok'] for x in r['results'])}/{len(r['results'])} cases, {r['visible']} visible marks")
        report("mapping-page: clearAll restores body.innerHTML exactly", r["restored"])

        # Full runs: HTML identical after Escape, after the run and mid-run.
        for name in ("test-page", "mapping-page", "captions-page"):
            for when in ("after the run", "mid-run"):
                open_page(d, name, wait=0.3)
                d.execute_script("window.__errors = []; addEventListener('error', e => __errors.push(e.message));")
                add_css(d)
                before = d.execute_script("return document.body.innerHTML")
                release(d)
                if when == "after the run":
                    end = time.time() + 40
                    last, still = -1, 0
                    while time.time() < end:
                        n = d.execute_script("return document.querySelectorAll('mark.frogbot-num-on, .frogbot-hl').length")
                        still = still + 1 if n == last else 0
                        last = n
                        if n and still >= 6:
                            break
                        time.sleep(0.5)
                    if name == "test-page":
                        shown = " ".join(d.execute_script("return [...document.querySelectorAll('mark.frogbot-num-on')].map(m => m.textContent)"))
                        want = ["$482.6 million", "$209.9", "$84.0", "$61.3", "$505 million"]
                        report("test-page: revenue, gross profit, operating income, net income and guidance figures highlighted",
                               all(w in shown for w in want), f"missing {[w for w in want if w not in shown]}")
                else:
                    end = time.time() + 20
                    while time.time() < end and not d.execute_script("return !!document.querySelector('.frogbot-tongue') && !!document.querySelector('mark.frogbot-num')"):
                        time.sleep(0.02)
                had = d.execute_script("return document.querySelectorAll('mark.frogbot-num').length")
                escape(d)
                same = d.execute_script("return document.body.innerHTML") == before
                leftovers = d.execute_script("return document.querySelectorAll('mark.frogbot-num, .frogbot-hl, [data-frogbot]').length")
                report(f"{name}: body.innerHTML identical after Escape ({when})", same and leftovers == 0 and had > 0,
                       f"{had} marks before Escape, leftovers {leftovers}, errors {d.execute_script('return __errors')}")
    finally:
        d.quit()
    finish()


if __name__ == "__main__":
    main()
