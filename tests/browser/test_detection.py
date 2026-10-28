"""Number detection in the page: debug counts, speed, junk, and the frog scrolling into view.

Covers: the debug view's number counts, detection speed across each page, every junk number on
the test page flagged as junk, and (live) the frog scrolling into view before its first hop on
a BBC article in a short window.

    python tests/browser/test_detection.py [--skip-live]
"""

import json
import time

from common import add_css, available, escape, finish, label, make_driver, open_page, release, report

SETUP = r"""
window.__errors = []; window.__tables = []; window.__logs = [];
const oe = console.error; console.error = (...a) => { __errors.push(a.join(' ')); oe(...a); };
console.table = (rows) => { __tables.push(JSON.parse(JSON.stringify(rows))); };
const ol = console.log; console.log = (...a) => { __logs.push(a.map(String).join(' ')); ol(...a); };
addEventListener('error', e => __errors.push('error: ' + e.message));
addEventListener('unhandledrejection', e => __errors.push('rejection: ' + (e.reason && e.reason.message)));
window.__frogbotDebug = arguments[0];
"""
PAGES = ["test-page", "nvidia-wikipedia", "bbc", "nvidia-release", "apple-release", "captions-page", "mapping-page"]


def main():
    d = make_driver(eager=False)
    try:
        for name in PAGES:
            if not available(name):
                continue
            open_page(d, name, wait=None if name.endswith("-release") or name == "bbc" else 0.3)
            d.execute_script(SETUP, True)
            add_css(d)
            release(d)
            time.sleep(0.5)
            tables = d.execute_script("return __tables")
            logs = d.execute_script("return __logs")
            numline = [line for line in logs if line.startswith("Frogbot: found")]
            counts = tables[1] if len(tables) > 1 else None
            report(f"{label(name)}: debug logs number counts by type", bool(counts) and bool(numline),
                   (numline[0] if numline else "") + " | " + json.dumps({r["type"]: r["count"] for r in counts}) if counts else "")
            # Detection only, five runs over the extracted blocks.
            ms = d.execute_script("""const b = FrogbotExtract.getBlocks(); const out = [];
                for (let i = 0; i < 5; i++) { const t = performance.now(); for (const x of b) FrogbotScore.detectNumbers(x.text); out.push(+(performance.now() - t).toFixed(1)); } return out""")
            report(f"{label(name)}: detection across the page under 50ms", max(ms) < 50, f"ms {ms}")
            errors = d.execute_script("return __errors")
            report(f"{label(name)}: no Frogbot errors", [e for e in errors if "Frogbot" in e or "rejection" in e] == [], json.dumps(errors))
            if name == "test-page":
                junk = d.execute_script(r"""const texts = [...FrogbotExtract.getBlocks().map(b => b.text), ...[...document.querySelectorAll('footer p')].map(p => p.innerText)];
                    const out = []; for (const t of texts) for (const m of FrogbotScore.detectNumbers(t)) if (m.junk) out.push(m.junkReason + ': ' + m.raw); return out""")
                need = ["phone: (555) 014-7781", "phone: (555) 014-7700", "page: Page 1 of 3", "footnote: 1", "footnote: 2", "copyright: 2026", "address: 742", "postcode: 97999"]
                report("test-page: every junk number detected as junk", all(n in junk for n in need), json.dumps(junk))
                eps = d.execute_script("return FrogbotScore.detectNumbers('It reported EPS of $1.42.').map(m => [m.raw, m.type])")
                report('"$1.42" in "EPS of $1.42" appears once, as perShare', eps == [["$1.42", "perShare"]], json.dumps(eps))
            escape(d)
    finally:
        d.quit()

    # Live, BBC in a short window: the frog starts off-screen and scrolls into view before its
    # first hop. (A known issue: BBC sometimes switches to scrolling inside a box, and this fails.)
    if available("bbc"):
        d = make_driver(1300, 600, eager=False)
        try:
            open_page(d, "bbc", wait=3)
            d.execute_script(SETUP, False)
            add_css(d)
            d.execute_script("window.__trace = []; const t0 = performance.now(); const tick = () => { const f = document.querySelector('.frogbot-frog'); if (f) { const r = f.getBoundingClientRect(); __trace.push({t: performance.now() - t0, top: r.top, bottom: r.bottom, translate: f.style.translate, hopping: f.classList.contains('frogbot-hopping'), scrollY}); } if (performance.now() - t0 < 4000) requestAnimationFrame(tick); }; requestAnimationFrame(tick);")
            release(d)
            time.sleep(4.5)
            tr = d.execute_script("return __trace")
            inner = d.execute_script("return innerHeight")
            if not tr:
                report("[live] bbc short window: frog appears", False, "no frog seen")
            else:
                first = tr[0]
                first_hop = next((x for x in tr if x["hopping"]), None)
                before = [x for x in tr if first_hop is None or x["t"] < first_hop["t"]]
                settled = before[-1]
                report("[live] bbc short window: frog starts off-screen", first["top"] > inner or first["bottom"] < 0, f"start top {first['top']:.0f}, window {inner}")
                report("[live] bbc short window: scrolled smoothly into view before the first hop (known issue: can fail on BBC)",
                       0 <= settled["top"] and settled["bottom"] <= inner and abs(float(settled["translate"].split("px")[1]) - float(first["translate"].split("px")[1])) < 40 and len({round(x["scrollY"]) for x in before}) > 3,
                       f"before hop: top {settled['top']:.0f}, scrollY {first['scrollY']}->{settled['scrollY']}, {len({round(x['scrollY']) for x in before})} scroll steps")
        finally:
            d.quit()
    finish()


if __name__ == "__main__":
    main()
