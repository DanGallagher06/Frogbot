"""Scoring and target choice on real pages.

Covers: no junk targets on the test page, the headline revenue sentence and results-table rows
picked, the frog only hopping downward, debug labels and tables, ?frogbot-fixed, the infobox
rows on Wikipedia, at most 4 rows per table, no figure picked twice, and the scoring time on
Nvidia's release (informational: logged, and only fails above 150ms, since it varies with
machine load).

    python tests/browser/test_scoring.py [--skip-live]
"""

import json
import statistics
import time

from common import add_css, available, escape, finish, info, make_driver, open_page, release, report

SETUP = r"""
window.__errors = []; window.__tables = []; window.__logs = []; window.__marks = [];
const oe = console.error; console.error = (...a) => { __errors.push(a.join(' ')); oe(...a); };
console.table = (rows) => { try { __tables.push(JSON.parse(JSON.stringify(rows))); } catch (e) {} };
const ol = console.log; console.log = (...a) => { __logs.push(a.map(String).join(' ')); ol(...a); };
addEventListener('error', e => __errors.push('error: ' + e.message));
addEventListener('unhandledrejection', e => __errors.push('rejection: ' + (e.reason && e.reason.message)));
window.__frogbotDebug = arguments[0];
"""
# Record each catch: what was caught, where it is, and where the frog is.
INSTRUMENT = r"""
const H = window.FrogbotHighlight;
if (H && !H.__wrapped) { const m = H.mark; H.mark = function (el) {
  const r = el.getBoundingClientRect(); const f = document.querySelector('.frogbot-frog').getBoundingClientRect();
  __marks.push({tag: el.tagName, text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 100), top: Math.round(r.top + scrollY), frogY: Math.round(f.top + scrollY),
    target: el.dataset ? el.dataset.frogbotTarget : undefined});
  return m.call(this, el); };
  const rv = H.reveal; H.reveal = function (els) {
    const el = els && els.length ? (els[0].closest('tr') || els[0].closest('p, li, td, dd, blockquote, figcaption, div') || els[0]) : null;
    if (el && el !== window.__lastCatch) { window.__lastCatch = el;
      const r = el.getBoundingClientRect(); const f = document.querySelector('.frogbot-frog').getBoundingClientRect();
      __marks.push({tag: el.tagName, text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 100), top: Math.round(r.top + scrollY), frogY: Math.round(f.top + scrollY)}); }
    return rv.call(this, els); };
  H.__wrapped = true; }
"""


def downward(marks):
    ys = [m["frogY"] for m in marks]
    return all(b >= a - 5 for a, b in zip(ys, ys[1:])), ys


def main():
    d = make_driver(reduced=True, eager=False)

    def run(name, debug=True, query="", settle=3.0, max_wait=45):
        open_page(d, name, query=query, wait=None if name not in ("test-page",) else 0.3)
        d.execute_script(SETUP, debug)
        add_css(d)
        release(d)
        d.execute_script(INSTRUMENT)
        # The run is over when catches stop arriving (or the "nothing" bubble shows).
        end = time.time() + max_wait
        last, still = -1, 0
        while time.time() < end:
            n = d.execute_script("return __marks.length")
            if d.execute_script("return !!document.querySelector('.frogbot-bubble')"):
                break
            still = still + 1 if n == last else 0
            last = n
            if n and still * 0.5 >= settle:
                break
            time.sleep(0.5)

    def units_table():
        for t in d.execute_script("return __tables"):
            if t and isinstance(t, list) and "reasons" in t[0]:
                return t
        return []

    def chosen_units():
        return [u for u in units_table() if u["chosen"] == "yes"]

    def duplicates():
        return [u["text"][:60] for u in chosen_units() if "duplicate figure" in u["reasons"]]

    try:
        # ---------- Test page, real scoring ----------
        run("test-page")
        marks = d.execute_script("return __marks")
        table = units_table()
        texts = [m["text"] for m in marks]
        junk_words = ["014-7781", "014-7700", "Page 1 of 3", "©", "742 Bullrush", "All rights reserved"]
        report("test-page: no phone/page/copyright/address targets", not any(j in t for t in texts for j in junk_words))
        report("test-page: visits the headline revenue sentence and results-table rows",
               any("Revenue rose to $482.6 million" in t or t.startswith("POND CITY") for t in texts) and any(m["tag"] == "TR" for m in marks), f"{len(marks)} targets")
        ok, ys = downward(marks)
        report("test-page: frog only hops downward", ok, f"frog y at each catch {ys}")
        labels = d.execute_script("return [...document.querySelectorAll('.frogbot-debug-label')].map(l => l.textContent)")
        report("debug: labels show block score", any(" · " in x for x in labels), json.dumps([x for x in labels if " · " in x][:4]))
        solid = d.execute_script("return [...document.querySelectorAll('.frogbot-debug-chosen')].map(b => getComputedStyle(b).borderTopStyle)")
        report("debug: chosen targets have a solid outline", bool(solid) and all(s == "solid" for s in solid) and len(solid) >= len(marks), f"{len(solid)} solid boxes for {len(marks)} targets")
        report("debug: console.table of scored units (index, score, chosen, reasons, text)",
               bool(table) and set(table[0].keys()) == {"index", "score", "chosen", "reasons", "text"}, f"{len(table)} units")
        timing = [line for line in d.execute_script("return __logs") if line.startswith("Frogbot: scored")]
        report("debug: scoring time logged", bool(timing), timing[0] if timing else "")
        report("test-page: no errors", d.execute_script("return __errors") == [], json.dumps(d.execute_script("return __errors")))
        escape(d)

        # ---------- ?frogbot-fixed ----------
        run("test-page", debug=False, query="?frogbot-fixed")
        fixed = [m["target"] for m in d.execute_script("return __marks")]
        report("test-page ?frogbot-fixed: hops to the 4 fixed targets", fixed == ["1", "2", "3", "4"], json.dumps(fixed))
        escape(d)

        # ---------- Saved Wikipedia page ----------
        if available("nvidia-wikipedia"):
            run("nvidia-wikipedia", max_wait=60)
            chosen = chosen_units()
            rows = [u["text"] for u in chosen if " | " in u["text"]]
            report("nvidia-wikipedia: infobox revenue/income rows picked", any(r.startswith(("Revenue", "Operating income", "Net income")) for r in rows), json.dumps(rows))
            history = [u["text"][:70] for u in chosen if any(w in u["text"] for w in ("founded", "Denny's", "co-founders", "1993"))]
            report("nvidia-wikipedia: no founding-history or product-name picks",
                   not history and all(("money" in u["reasons"] or "percent" in u["reasons"] or "per share" in u["reasons"]) for u in chosen), json.dumps(history))
            ok, ys = downward(d.execute_script("return __marks"))
            report("nvidia-wikipedia: frog only hops downward", ok, f"{len(ys)} catches")
            report("nvidia-wikipedia: no figure picked twice", not duplicates(), json.dumps(duplicates()))
            escape(d)

        # ---------- Live: Nvidia's release ----------
        if available("nvidia-release"):
            run("nvidia-release", max_wait=60)
            chosen = chosen_units()
            per_table = d.execute_script("""const c = {}; for (const tr of new Set([...document.querySelectorAll('tr.frogbot-hl'), ...[...document.querySelectorAll('mark.frogbot-num-on')].map(m => m.closest('tr')).filter(Boolean)])) { const t = tr.closest('table'); c[t.dataset.k || (t.dataset.k = Math.random())] = (c[t.dataset.k] || 0) + 1; } return Object.values(c)""")
            report("[live] nvidia-release: headline results picked", any("today reported revenue" in u["text"] for u in chosen))
            report("[live] nvidia-release: at most 4 rows per table", all(n <= 4 for n in per_table), f"rows per table {per_table}")
            ok, ys = downward(d.execute_script("return __marks"))
            report("[live] nvidia-release: frog only hops downward", ok, f"{len(ys)} catches")
            report("[live] nvidia-release: no figure picked twice", not duplicates(), json.dumps(duplicates()))
            escape(d)

        # ---------- Live: Apple ----------
        if available("apple-release"):
            run("apple-release")
            chosen = chosen_units()
            report("[live] apple-release: copyright line never picked", not any("©" in u["text"] or "All rights reserved" in u["text"] for u in chosen))
            ok, _ = downward(d.execute_script("return __marks"))
            report("[live] apple-release: frog only hops downward", ok)
            escape(d)

        # ---------- Live: BBC, with and without figures ----------
        if available("bbc"):
            run("bbc", max_wait=60)
            chosen = chosen_units()
            report("[live] bbc: picks sentences containing figures", bool(chosen) and all(any(ch.isdigit() for ch in u["text"]) for u in chosen), f"{len(chosen)} targets")
            escape(d)
        if available("bbc-no-figures"):
            run("bbc-no-figures")
            bubble = d.execute_script("const b = document.querySelector('.frogbot-bubble'); return b && b.textContent")
            report("[live] bbc-no-figures: 'Nothing to catch here'", bubble == "Nothing to catch here", str(bubble))
            escape(d)
    finally:
        d.quit()

    # Live: scoring time on Nvidia's release, from the debug log of several fresh loads.
    # Informational: it varies with machine load, so only a time above 150ms fails.
    if available("nvidia-release"):
        times = []
        d = make_driver(eager=False)
        try:
            for _ in range(5):
                open_page(d, "nvidia-release", wait=6)
                d.execute_script("window.__logs = []; console.log = (...a) => __logs.push(a.map(String).join(' ')); console.table = () => {}; window.__frogbotDebug = true;")
                release(d)
                line = next((x for x in d.execute_script("return __logs") if x.startswith("Frogbot: scored")), None)
                if line:
                    times.append(float(line.split(" in ")[-1].split(" ms")[0]))
                escape(d)
        finally:
            d.quit()
        if times:
            info(f"Nvidia scoring time: median {statistics.median(times)} ms of {times}")
            report("[live] nvidia-release: scoring under 150ms (informational; varies with machine load)", statistics.median(times) < 150, f"median {statistics.median(times)} ms")
        else:
            report("[live] nvidia-release: scoring time logged", False, "no timing found")
    finish()


if __name__ == "__main__":
    main()
