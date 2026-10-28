"""Hopping, the tongue and clean-up, on the test page's four hand-placed targets.

Covers: hits in order, the tongue's reach and timing, leg animation and turning, scrolling to
later targets, Escape at any point (after the run, mid-hop, mid-tongue), releasing again during
a run, the "Nothing to catch here" bubble, a narrow window, reduced motion, and a run on the
saved Nvidia Wikipedia page.

    python tests/browser/test_hops.py [--skip-live]
"""

import json
import time

from common import add_css, available, escape, finish, get, make_driver, open_page, release, report, url

SETUP = r"""
window.__errors = [];
window.__events = [];
const oe = console.error; console.error = (...a) => { __errors.push('console.error: ' + a.join(' ')); oe(...a); };
addEventListener('error', e => __errors.push('error: ' + e.message));
addEventListener('unhandledrejection', e => __errors.push('rejection: ' + (e.reason && e.reason.message)));
"""
# Wrap the highlighter once it exists, to log each hit: when, where, and where the tongue's tip is.
INSTRUMENT = r"""
const H = window.FrogbotHighlight;
window.__tongueStart = null;
if (!window.__mo) { window.__mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('frogbot-tongue')) __tongueStart = performance.now(); }); __mo.observe(document.documentElement, {childList: true}); }
if (H && !H.__wrapped) { const m = H.mark; H.mark = function(el){
  const t = document.querySelector('.frogbot-tongue'); let tip = null;
  if (t) { const [x, y] = t.style.translate.split(' ').map(parseFloat); const a = parseFloat(t.style.rotate) * Math.PI / 180; const w = parseFloat(getComputedStyle(t).width);
    const ex = x + Math.cos(a) * w, ey = y + 3 + Math.sin(a) * w; const r = el.getBoundingClientRect();
    const L = r.left + scrollX, T = r.top + scrollY, R = r.right + scrollX, B = r.bottom + scrollY;
    tip = {len: Math.round(w), inside: ex >= L && ex <= R && ey >= T && ey <= B, depth: Math.round(Math.min(ex - L, R - ex, ey - T, B - ey)), extendMs: Math.round(performance.now() - __tongueStart)}; }
  __events.push({t: performance.now()|0, target: el.dataset.frogbotTarget || el.textContent.trim().slice(0,40), scrollY: scrollY|0, tongue: !!t, tip}); return m.call(this, el); };
  const rv = H.reveal; H.reveal = function (els) { __events.push({t: performance.now()|0, target: 'figure', scrollY: scrollY|0, tongue: !!document.querySelector('.frogbot-tongue'), tip: null}); return rv.call(this, els); };
H.__wrapped = true; }
"""
COUNTS = "{frog: document.querySelectorAll('.frogbot-frog').length, tongue: document.querySelectorAll('.frogbot-tongue').length, any: document.querySelectorAll('[data-frogbot]').length, hl: document.querySelectorAll('.frogbot-hl').length}"
EMPTY = {"frog": 0, "tongue": 0, "any": 0, "hl": 0}
FIXED = "?frogbot-fixed"


def q(d, js):
    return d.execute_script("return " + js)


def setup(d):
    d.execute_script(SETUP)
    add_css(d)


def go(d):
    # The first injection defines the globals; wrap the highlighter before the first hit (500ms+).
    release(d)
    d.execute_script(INSTRUMENT)


def wait_for(d, js, timeout=15, interval=0.01):
    end = time.time() + timeout
    while time.time() < end:
        if q(d, js):
            return True
        time.sleep(interval)
    return False


def full_run_checks(d):
    rects_before = q(d, "[...document.querySelectorAll('[data-frogbot-target]')].map(e => {const r=e.getBoundingClientRect(); return [r.width, r.height, r.top+scrollY]})")
    doc_h_before = q(d, "document.documentElement.scrollHeight")
    go(d)
    leg_samples, positions = [], []
    t0 = time.time()
    while time.time() - t0 < 20:
        st = q(d, """(() => { const f = document.querySelector('.frogbot-frog'); if (!f) return null;
            const leg = f.querySelector('.frogbot-leg-back-left');
            return {hopping: f.classList.contains('frogbot-hopping'), legT: getComputedStyle(leg).transform, rot: f.style.rotate,
                    tongue: !!document.querySelector('.frogbot-tongue'), hits: __events.length} })()""")
        if st is None:
            break
        leg_samples.append((st["hopping"], st["legT"]))
        positions.append(st["rot"])
        if st["hits"] >= 4 and not st["tongue"]:
            break
        time.sleep(0.02)
    time.sleep(0.6)
    ev = q(d, "__events")
    report("hits all 4 targets in order", [e["target"] for e in ev] == ["1", "2", "3", "4"], json.dumps([e["target"] for e in ev]))
    report("tongue is out at the moment of each hit", bool(ev) and all(e["tongue"] for e in ev))
    tips = [e["tip"] for e in ev if e["tip"]]
    report("tongue crosses a visible gap at every target (length > 70px)", len(tips) == 4 and all(t["len"] > 70 for t in tips), json.dumps([t["len"] for t in tips]))
    report("tongue tip ends just inside each target (~12px)", len(tips) == 4 and all(t["inside"] and 8 <= t["depth"] <= 14 for t in tips), json.dumps([(t["inside"], t["depth"]) for t in tips]))
    report("extend time 100-250ms, ~150ms at the normal gap", len(tips) == 4 and all(95 <= t["extendMs"] <= 270 for t in tips), json.dumps([t["extendMs"] for t in tips]))
    report("page scrolled to bring later targets into view", bool(ev) and ev[-1]["scrollY"] > ev[0]["scrollY"], f"scrollY at hits: {[e['scrollY'] for e in ev]}")
    report("frog in view at the end", q(d, "(() => { const f=document.querySelector('.frogbot-frog').getBoundingClientRect(); return f.top >= 0 && f.bottom <= innerHeight })()"))
    stretched = [t for h, t in leg_samples if h]
    tucked = [t for h, t in leg_samples if not h]
    report("legs change pose during hops", any(t != "none" for t in stretched) and all(t == "none" for t in tucked[-3:]), f"{len(stretched)} hopping samples")
    report("frog rotates (faces travel / target)", len(set(positions)) > 3, f"{len(set(positions))} distinct rotations")
    fv = q(d, """(() => { const f=document.querySelector('.frogbot-frog').getBoundingClientRect(); const t=document.querySelector('[data-frogbot-target="4"]').getBoundingClientRect();
        return {frogRight: f.right|0, targetLeft: t.left|0, frogMidY: (f.top+f.bottom)/2|0, targetMidY: (t.top+t.bottom)/2|0} })()""")
    report("frog lands ~70px left of the last target, vertically centred",
           68 <= fv["targetLeft"] - fv["frogRight"] <= 72 and abs(fv["frogMidY"] - fv["targetMidY"]) <= 2, json.dumps(fv))
    rects_after = q(d, "[...document.querySelectorAll('[data-frogbot-target]')].map(e => {const r=e.getBoundingClientRect(); return [r.width, r.height, r.top+scrollY]})")
    report("highlights don't shift layout", rects_before == rects_after and doc_h_before == q(d, "document.documentElement.scrollHeight"))
    c = q(d, COUNTS)
    # Fixed targets catch no figures, so there are no facts and no card: the frog stays put.
    report("frog stays, highlights stay, no tongue left", c == {"frog": 1, "tongue": 0, "any": 1, "hl": 4}, json.dumps(c))
    report("highlight is a yellow background", "255, 224, 70" in q(d, "getComputedStyle(document.querySelector('.frogbot-hl')).backgroundColor"))
    d.execute_script("window.scrollTo(0,0)")
    time.sleep(0.2)
    link_ok = q(d, "(() => { const a=[...document.querySelectorAll('.nav a')][2]; const r=a.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === a })()")
    report("links still clickable (frog is pointer-events: none)", link_ok)
    report("no errors during full run", q(d, "__errors") == [], json.dumps(q(d, "__errors")))


def main():
    d = make_driver(1200, 900, eager=False)
    try:
        get(d, url("test-page") + FIXED)
        setup(d)
        full_run_checks(d)

        # Escape at the end, then releasing again during a run.
        escape(d)
        report("Escape after run clears everything", q(d, COUNTS) == EMPTY, json.dumps(q(d, COUNTS)))
        d.execute_script("__events.length = 0; scrollTo(0,0)")
        go(d)
        time.sleep(0.3)
        go(d)  # clicked again mid-run
        time.sleep(0.2)
        go(d)
        wait_for(d, "__events.length >= 4 && !document.querySelector('.frogbot-tongue')", 20)
        time.sleep(1.0)
        report("releasing during a run doesn't start a second frog/run", q(d, COUNTS)["frog"] == 1 and len(q(d, "__events")) == 4,
               f"frogs={q(d, COUNTS)['frog']} hits={len(q(d, '__events'))}")
        escape(d)

        # Escape mid-hop.
        d.execute_script("__events.length = 0; __errors.length = 0; scrollTo(0,0)")
        go(d)
        ok = wait_for(d, "!!document.querySelector('.frogbot-frog.frogbot-hopping')", 5, 0.002)
        escape(d)
        c1 = q(d, COUNTS)
        time.sleep(2.5)
        c2 = q(d, COUNTS)
        report("Escape mid-hop removes everything and nothing comes back", ok and c1 == c2 == EMPTY, f"caught hop={ok} {c1} {c2}")

        # Escape mid-tongue, after a highlight exists.
        d.execute_script("__events.length = 0; scrollTo(0,0)")
        go(d)
        wait_for(d, "__events.length >= 1", 10)
        ok = wait_for(d, "!!document.querySelector('.frogbot-tongue')", 10, 0.002)
        escape(d)
        c1 = q(d, COUNTS)
        time.sleep(2.5)
        c2 = q(d, COUNTS)
        report("Escape mid-tongue removes frog, tongue and highlights", ok and c1 == c2 == EMPTY, f"caught tongue={ok} {c1} {c2}")
        report("no console errors after Escapes", q(d, "__errors") == [], json.dumps(q(d, "__errors")))

        # Releasing after Escape: a fresh, clean run.
        d.execute_script("__events.length = 0; scrollTo(0,0)")
        go(d)
        wait_for(d, "__events.length >= 4 && !document.querySelector('.frogbot-tongue')", 20)
        time.sleep(0.5)
        report("release after Escape starts a clean new run", [e["target"] for e in q(d, "__events")] == ["1", "2", "3", "4"] and q(d, COUNTS)["frog"] == 1)
        escape(d)

        # A page with nothing to catch.
        get(d, "data:text/html,<html><body><nav><p>" + "Menu item text that is long enough to qualify if it were not inside navigation. " * 2 + "</p></nav><main><h1>Hi</h1><p>Short.</p></main></body></html>")
        setup(d)
        go(d)
        time.sleep(0.3)
        bubble = q(d, "(() => { const b=document.querySelector('.frogbot-bubble'); if(!b) return null; const r=b.getBoundingClientRect(), f=document.querySelector('.frogbot-frog').getBoundingClientRect(); return {text:b.textContent, below: r.top > f.bottom - 1, centred: Math.abs((r.left+r.right)/2 - (f.left+f.right)/2) < 2} })()")
        report("'Nothing to catch here' bubble under the frog", bool(bubble) and bubble["text"] == "Nothing to catch here" and bubble["below"] and bubble["centred"], json.dumps(bubble))
        time.sleep(2.0)
        still = q(d, COUNTS)["frog"]
        time.sleep(1.3)
        report("frog leaves after ~3s", still == 1 and q(d, COUNTS)["any"] == 0, f"at 2.3s frogs={still}, at 3.6s any={q(d, COUNTS)['any']}")
        report("no errors on empty page", q(d, "__errors") == [], json.dumps(q(d, "__errors")))

        # A real page: scored targets, all in the article body.
        if available("nvidia-wikipedia"):
            d.set_page_load_timeout(30)
            open_page(d, "nvidia-wikipedia")
            setup(d)
            go(d)
            wait_for(d, "__events.length >= 3 && !document.querySelector('.frogbot-tongue')", 40)
            time.sleep(1)
            ev = q(d, "__events")
            bad = q(d, "[...document.querySelectorAll('.frogbot-hl, mark.frogbot-num-on')].filter(e => e.closest('nav, header, footer, aside, .vector-menu, #mw-panel')).length")
            inbody = q(d, "[...document.querySelectorAll('.frogbot-hl, mark.frogbot-num-on')].every(e => e.closest('#mw-content-text'))")
            report("nvidia-wikipedia: scored targets, all in the article body", len(ev) >= 3 and bad == 0 and inbody, f"{len(ev)} hits so far")
            report("nvidia-wikipedia: no errors", q(d, "__errors") == [], json.dumps(q(d, "__errors")))
    finally:
        d.quit()

    # A narrow window: the frog lands above its target instead of beside it.
    d = make_driver(520, 900, eager=False)
    try:
        get(d, url("test-page") + FIXED)
        setup(d)
        go(d)
        wait_for(d, "__events.length >= 1", 10)
        pos = q(d, """(() => { const f=document.querySelector('.frogbot-frog').getBoundingClientRect(); const t=document.querySelector('[data-frogbot-target="1"]').getBoundingClientRect();
            return {frogBottom: f.bottom|0, targetTop: t.top|0, frogLeft: f.left|0, targetLeft: t.left|0} })()""")
        ev = q(d, "__events")
        report("narrow window: lands above the target", pos["frogBottom"] <= pos["targetTop"], json.dumps(pos))
        report("narrow window: tongue still reaches inside", bool(ev) and bool(ev[0]["tip"]) and ev[0]["tip"]["inside"], json.dumps(ev[0]["tip"] if ev else None))
        wait_for(d, "__events.length >= 4 && !document.querySelector('.frogbot-tongue')", 20)
        report("narrow window: all 4 hit, no errors", len(q(d, "__events")) == 4 and q(d, "__errors") == [], json.dumps(q(d, "__errors")))
    finally:
        d.quit()

    # Reduced motion: same hits, no scaling, quick.
    d = make_driver(1200, 900, reduced=True, eager=False)
    try:
        get(d, url("test-page") + FIXED)
        setup(d)
        report("reduced-motion media query active", q(d, "matchMedia('(prefers-reduced-motion: reduce)').matches"))
        scales = []
        go(d)
        t0 = time.time()
        while time.time() - t0 < 15:
            scales.append(q(d, "(() => { const f=document.querySelector('.frogbot-frog'); return f ? getComputedStyle(f).scale : null })()"))
            if q(d, "__events.length >= 4 && !document.querySelector('.frogbot-tongue')"):
                break
            time.sleep(0.005)
        ev = q(d, "__events")
        report("reduced motion: same order, no scale, fast", [e["target"] for e in ev] == ["1", "2", "3", "4"] and all(s in ("none", "1", None) for s in scales),
               f"elapsed {time.time() - t0:.1f}s, scales seen {sorted(set(map(str, scales)))}")
        report("no errors in reduced motion", q(d, "__errors") == [], json.dumps(q(d, "__errors")))
    finally:
        d.quit()
    finish()


if __name__ == "__main__":
    main()
