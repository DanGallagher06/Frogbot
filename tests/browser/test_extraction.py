"""Page extraction, the debug view and the frog's start position.

Covers: what the captions page keeps and skips, the debug outlines and console tables, table
cells as blocks, the frog starting clear of text and site headers, and extraction on the saved
Wikipedia page and live BBC, Nvidia and Apple pages.

    python tests/browser/test_extraction.py [--skip-live]
"""

import json
import time

from common import add_css, available, escape, finish, label, make_driver, open_page, release, report, ROOT, info

SETUP = r"""
window.__errors = []; window.__tables = []; window.__logs = [];
const oe = console.error; console.error = (...a) => { __errors.push(a.join(' ')); oe(...a); };
const ot = console.table; console.table = (rows) => { __tables.push(rows); };
const ol = console.log; console.log = (...a) => { __logs.push(a.map(String).join(' ')); ol(...a); };
addEventListener('error', e => __errors.push('error: ' + e.message));
addEventListener('unhandledrejection', e => __errors.push('rejection: ' + (e.reason && e.reason.message)));
window.__frogbotDebug = arguments[0];
"""
# Implementation-independent: every visible text node against the frog's box.
START_CHECK = r"""
const f = document.querySelector('.frogbot-frog').getBoundingClientRect();
const ov = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const r = document.createRange(); const hits = [];
while (w.nextNode()) { const n = w.currentNode; if (!n.data.trim() || n.parentElement.closest('[data-frogbot], script, style, noscript') || !n.parentElement.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
  r.selectNodeContents(n); for (const rr of r.getClientRects()) if (rr.width > 0 && ov(rr, f)) { hits.push(n.data.trim().slice(0, 40)); break; } }
const headers = [...document.querySelectorAll("header, [role='banner']")].filter(h => !h.closest("main, article, [role='main']")).filter(h => ov(h.getBoundingClientRect(), f)).map(h => h.tagName + '.' + (h.getAttribute('class') || '').slice(0, 30));
return {frog: [Math.round(f.left + scrollX), Math.round(f.top + scrollY)], textUnderFrog: hits, headerUnderFrog: headers, onScreen: f.top >= 0 && f.bottom <= innerHeight};
"""
# Do any debug outlines overlap the elements matching a selector?
OVERLAP = r"""
const boxes = [...document.querySelectorAll('.frogbot-debug-box:not(.frogbot-debug-container)')].map(b => b.getBoundingClientRect());
const hit = sel => [...document.querySelectorAll(sel)].some(el => { const r = el.getBoundingClientRect();
  return boxes.some(b => b.left < r.right - 1 && b.right > r.left + 1 && b.top < r.bottom - 1 && b.bottom > r.top + 1); });
return hit(arguments[0]);
"""
COUNTS = "{frog: document.querySelectorAll('.frogbot-frog').length, debug: document.querySelectorAll('.frogbot-debug-box').length, any: document.querySelectorAll('[data-frogbot]').length, hl: document.querySelectorAll('.frogbot-hl, mark.frogbot-num-on').length}"


def main():
    d = make_driver(eager=False)
    q = lambda js, *args: d.execute_script("return " + js, *args)

    def load(name, debug):
        open_page(d, name, wait=None if name not in ("test-page", "captions-page") else 0.2)
        d.execute_script(SETUP, debug)
        add_css(d)
        release(d)
        time.sleep(0.3)

    def start_check(name):
        r = d.execute_script(START_CHECK)
        report(f"{label(name)}: frog starts clear of text and site header", not r["textUnderFrog"] and not r["headerUnderFrog"] and r["frog"][1] >= 0, json.dumps(r))

    try:
        # ---------- The captions page: what extraction keeps and skips ----------
        open_page(d, "captions-page", wait=0.3)
        d.execute_script((ROOT / "content" / "extract.js").read_text(encoding="utf-8"))
        r = d.execute_script(r"""
          const t0 = performance.now(); const blocks = FrogbotExtract.getBlocks(); const ms = performance.now() - t0;
          const got = new Set(blocks.map(b => b.element));
          const rows = [...document.querySelectorAll('[data-expect]')].map(el => ({want: el.dataset.expect, got: got.has(el), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 70)}));
          const unexpected = blocks.filter(b => !b.element.hasAttribute('data-expect')).map(b => b.text.slice(0, 70));
          return {rows, unexpected, ms: +ms.toFixed(1), container: FrogbotExtract.findMainContainer().tagName};""")
        wrong = [row for row in r["rows"] if (row["want"] == "keep") != row["got"]]
        for row in wrong:
            info(f"wrong: {row['want']} but {'extracted' if row['got'] else 'skipped'}: {row['text']}")
        report("captions-page: captions, credits, key points, collapsed and hidden content skipped; article text kept",
               not wrong and not r["unexpected"], f"{len(wrong)} wrong, unexpected {r['unexpected']}, {r['ms']} ms, container {r['container']}")

        # ---------- Test page, no debug ----------
        load("test-page", False)
        report("no debug: no outlines and no console.table", q(COUNTS)["debug"] == 0 and q("__tables.length") == 0)
        start_check("test-page")
        dl = q("(() => { const f = document.querySelector('.frogbot-frog').getBoundingClientRect(), t = document.querySelector('.dateline').getBoundingClientRect(); return {frogRight: f.right, dlLeft: t.left, frogBottom: f.bottom, dlTop: t.top} })()")
        report("test-page: frog clear of the 'Press release' line", dl["frogRight"] <= dl["dlLeft"] or dl["frogBottom"] <= dl["dlTop"], json.dumps(dl))
        escape(d)

        # ---------- Test page, debug view ----------
        load("test-page", True)
        n_blocks = q("FrogbotExtract.getBlocks().length")
        c = q(COUNTS)
        report("debug: one outline per block + red container", c["debug"] == n_blocks + 1, f"{c['debug']} boxes for {n_blocks} blocks")
        report("debug: container outline is red", "229, 57, 53" in q("getComputedStyle(document.querySelector('.frogbot-debug-container')).borderTopColor"))
        colours = q("""Object.fromEntries(['paragraph','list','table','heading','quote'].map(t => { const b = document.querySelector('.frogbot-debug-' + t); return [t, b && getComputedStyle(b).borderTopColor + ' ' + getComputedStyle(b).borderTopStyle]; }))""")
        report("debug: dashed outlines coloured by type", all(v and "dashed" in v for v in colours.values()) and len(set(colours.values())) == 5, json.dumps(colours))
        tag = q("document.querySelector('.frogbot-debug-paragraph .frogbot-debug-label').textContent")
        report("debug: corner label shows index, type and score", tag.startswith("0 paragraph · "), tag)
        report("debug: nav not outlined", not q(OVERLAP, "header nav"))
        report("debug: footer (phone, copyright, address) not outlined", not q(OVERLAP, "footer p"))
        tbl = q("__tables[0]")
        report("debug: console.table with index/type/text/chars", bool(tbl) and len(tbl) == n_blocks and set(tbl[0].keys()) == {"index", "type", "text", "chars"} and all(len(x["text"]) <= 60 for x in tbl),
               json.dumps(tbl[1]) if tbl else "none")
        timing = [line for line in q("__logs") if "extracted" in line]
        report("debug: extraction time logged", bool(timing), timing[0][:80] if timing else "")
        cells = q(r"""(() => { const set = new Set(FrogbotExtract.getBlocks().map(b => b.element));
            const cells = [...document.querySelectorAll('table td, table th')].filter(c => /\d/.test(c.textContent));
            return {cells: cells.length, extracted: cells.filter(c => set.has(c)).length} })()""")
        report("every table cell with a figure is its own block", cells["cells"] == cells["extracted"] > 0, json.dumps(cells))
        time.sleep(1)
        escape(d)
        report("Escape removes frog, highlights and debug outlines", q(COUNTS) == {"frog": 0, "debug": 0, "any": 0, "hl": 0}, json.dumps(q(COUNTS)))
        report("test-page: no errors", q("__errors") == [], json.dumps(q("__errors")))

        # ---------- Saved Wikipedia page ----------
        if available("nvidia-wikipedia"):
            load("nvidia-wikipedia", True)
            w = q(r"""(() => {
                const c = FrogbotExtract.findMainContainer();
                const times = []; let blocks;
                for (let i = 0; i < 5; i++) { const t = performance.now(); blocks = FrogbotExtract.getBlocks(c); times.push(+(performance.now() - t).toFixed(1)); }
                const inside = sel => blocks.filter(b => b.element.closest(sel)).length;
                return {container: c.id, n: blocks.length, times,
                  infobox: inside('table.infobox'), navbox: inside('.navbox'), refs: inside('.reflist, ol.references, .references'),
                  toc: inside('#vector-toc, .vector-toc, #mw-panel, .vector-main-menu'),
                  markers: blocks.filter(b => /\[\s*(\d+|[a-z]|note \d+|edit)\s*\]/i.test(b.text)).map(b => b.text.slice(0, 80)),
                  editText: blocks.filter(b => /\bedit\]/.test(b.text)).length};
            })()""")
            start_check("nvidia-wikipedia")
            endsec = q(r"""(() => { const bl = FrogbotExtract.getBlocks(); const txt = bl.map(b => b.text).join(' | ');
                return {furtherReading: /Thinking Machine/.test(txt), externalLinks: /OpenSecrets/.test(txt), seeAlso: /Huang's law/.test(txt), neutrality: /neutrality of this section/i.test(txt),
                        notices: bl.filter(b => b.element.closest('.ambox, .ombox, .tmbox, .metadata, .hatnote, [role=note]')).length} })()""")
            report("nvidia-wikipedia: See also / Further reading / External links / notice box gone", not any(v for k, v in endsec.items() if k != "notices") and endsec["notices"] == 0, json.dumps(endsec))
            report("nvidia-wikipedia: main container is the article body", w["container"] == "mw-content-text", w["container"])
            report("nvidia-wikipedia: infobox cells extracted", w["infobox"] >= 10, f"{w['infobox']} cells")
            report("nvidia-wikipedia: no navbox / references / contents-menu blocks", w["navbox"] == 0 and w["refs"] == 0 and w["toc"] == 0, json.dumps({k: w[k] for k in ("navbox", "refs", "toc")}))
            report("nvidia-wikipedia: no citation or edit markers in text", not w["markers"] and w["editText"] == 0, json.dumps(w["markers"][:3]))
            report("nvidia-wikipedia: getBlocks under 50ms", max(w["times"]) < 50, f"{w['n']} blocks, ms {w['times']}")
            report("nvidia-wikipedia: sidebar/contents not outlined", not q(OVERLAP, "#vector-toc, .vector-column-start, .vector-column-end"))
            time.sleep(1)
            escape(d)
            report("nvidia-wikipedia: Escape clears everything, no errors", q(COUNTS)["any"] == 0 and q("__errors") == [], json.dumps(q("__errors")))

        # ---------- Live: BBC ----------
        if available("bbc"):
            load("bbc", True)
            b = q(r"""(() => { const c = FrogbotExtract.findMainContainer(); const blocks = FrogbotExtract.getBlocks(c);
                const junk = blocks.filter(x => { for (let n = x.element; n; n = n.parentElement) { const s = ((n.getAttribute && n.getAttribute('class')) || '') + ' ' + (n.id || '') + ' ' + ((n.getAttribute && n.getAttribute('data-component')) || '');
                    if (/related|share|cookie|consent|promo|links-block|byline|tag/i.test(s)) return true; } return false; });
                return {container: c.tagName, n: blocks.length, paras: blocks.filter(x => x.type === 'paragraph').length, junk: junk.map(x => x.text.slice(0, 60)), first: blocks[0] && blocks[0].text.slice(0, 70)} })()""")
            start_check("bbc")
            report("[live] bbc: story paragraphs extracted from the article", b["paras"] >= 20, json.dumps({k: b[k] for k in ("container", "n", "paras", "first")}))
            report("[live] bbc: no related / share / cookie blocks", not b["junk"], json.dumps(b["junk"][:3]))
            report("[live] bbc: related-stories and share areas not outlined", not q(OVERLAP, "[data-component='links-block'], [data-testid*='share'], [class*='Share'], [class*='Related'], #onetrust-banner-sdk, .fc-consent-root"))
            time.sleep(1)
            escape(d)

        # ---------- Live: Nvidia's earnings release ----------
        if available("nvidia-release"):
            load("nvidia-release", True)
            n = q(r"""(() => { const blocks = FrogbotExtract.getBlocks(); const t = performance.now(); FrogbotExtract.getBlocks(); const ms = performance.now() - t;
                return {n: blocks.length, paras: blocks.filter(x => x.type === 'paragraph').length, cells: blocks.filter(x => x.type === 'table').length, ms: +ms.toFixed(1),
                        firstPara: (blocks.find(x => x.type === 'paragraph') || {}).text.slice(0, 80)} })()""")
            start_check("nvidia-release")
            report("[live] nvidia-release: release text and tables extracted", n["paras"] >= 5 and n["cells"] >= 100 and n["ms"] < 50, json.dumps(n))
            time.sleep(1)
            escape(d)

        # ---------- Live: Apple's newsroom ----------
        if available("apple-release"):
            load("apple-release", True)
            a = q(r"""(() => { const t = performance.now(); const bl = FrogbotExtract.getBlocks(); const ms = performance.now() - t;
                const nested = bl.filter(x => bl.some(y => y !== x && y.element.contains(x.element))).length;
                return {n: bl.length, divParas: bl.filter(x => x.element.tagName === 'DIV' && x.type === 'paragraph').length, nested, ms: +ms.toFixed(1)} })()""")
            report("[live] apple-release: release paragraphs extracted (text-only divs), no nesting", a["divParas"] >= 5 and a["nested"] == 0 and a["ms"] < 50, json.dumps(a))
            start_check("apple-release")
            for _ in range(12):
                if q("document.querySelectorAll('.frogbot-hl, mark.frogbot-num-on').length") >= 1:
                    break
                time.sleep(0.5)
            report("[live] apple-release: frog finds targets (no 'Nothing to catch here')",
                   not q("document.querySelector('.frogbot-bubble')") and q("document.querySelectorAll('.frogbot-hl, mark.frogbot-num-on').length") >= 1)
            escape(d)
    finally:
        d.quit()
    finish()


if __name__ == "__main__":
    main()
