"""Helpers shared by the card suites: reading the card's state, the facts behind it, and the
card's row order rebuilt in Python to check against."""

import math
import re
import time

from common import report

CARD = "document.querySelector('.frogbot-card-host').shadowRoot"

# Everything the checks need from the card (in its shadow root) and the frog.
CARD_STATE = r"""
const host = document.querySelector('.frogbot-card-host');
const frog = document.querySelector('.frogbot-frog');
if (!host) return { card: false, running: window.__frogbotRunning, hosts: 0 };
const sr = host.shadowRoot, card = sr.querySelector('.card');
const cs = (el) => getComputedStyle(el);
const r = card.getBoundingClientRect();
const fr = frog ? frog.getBoundingClientRect() : null;
return {
  card: true, measuring: card.classList.contains('measuring'), running: window.__frogbotRunning,
  hosts: document.querySelectorAll('.frogbot-card-host').length, frogs: document.querySelectorAll('.frogbot-frog').length,
  role: card.getAttribute('role'), aria: card.getAttribute('aria-label'),
  title: sr.querySelector('.title').textContent,
  rows: [...sr.querySelectorAll('tbody tr')].map(tr => ({ id: tr.dataset.factId, shown: cs(tr).display !== 'none',
    cells: [...tr.cells].map(td => td.textContent), inferred: tr.cells[3].classList.contains('inferred'),
    periodStyle: cs(tr.cells[3]).fontStyle, periodColour: cs(tr.cells[3]).color, periodTitle: tr.cells[3].title,
    changeColour: cs(tr.cells[2]).color, changeClass: tr.cells[2].className, changeTitle: tr.cells[2].title })),
  more: sr.querySelector('.more') ? sr.querySelector('.more').textContent : null,
  also: sr.querySelector('details summary') ? sr.querySelector('details summary').textContent : null,
  alsoItems: [...sr.querySelectorAll('details li')].map(li => li.textContent),
  empty: sr.querySelector('.empty') ? sr.querySelector('.empty').textContent : null,
  rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
  view: { w: document.documentElement.clientWidth, h: innerHeight },
  frogRect: fr && { left: fr.left, top: fr.top, cx: fr.left + fr.width / 2, cy: fr.top + fr.height / 2 },
  frogPosition: frog ? cs(frog).position : null,
  style: { font: cs(card).fontSize + ' ' + cs(card).fontFamily, bg: cs(card).backgroundColor, fg: cs(card).color,
           head: cs(sr.querySelector('.head')).backgroundColor, radius: cs(card).borderTopLeftRadius,
           muted: cs(sr.querySelector('.foot')).color, width: cs(card).width, numeric: cs(sr.querySelector('.body')).fontVariantNumeric,
           tableNumeric: sr.querySelector('table') ? cs(sr.querySelector('table')).fontVariantNumeric : null,
           figureAlign: sr.querySelector('td.figure') ? cs(sr.querySelector('td.figure')).textAlign : null },
  animations: card.getAnimations().length,
  hostDisplay: cs(host).display,
  marks: document.querySelectorAll('mark.frogbot-num-on, .frogbot-hl').length,
};
"""

# The facts main.js built, recomputed the same way (it's deterministic), for the expected rows.
EXPECTED = r"""
const blocks = FrogbotExtract.getBlocks(FrogbotExtract.findMainContainer());
const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
const totalWords = blocks.reduce((s, b) => s + b.text.split(/\s+/).length, 0);
const { chosen } = FrogbotScore.rankUnits(units, { totalWords });
const byEl = new Map();
for (const u of chosen) { if (!byEl.has(u.element)) byEl.set(u.element, { element: u.element, units: [] }); byEl.get(u.element).units.push(u); }
const facts = FrogbotFacts.buildFacts([...byEl.values()], blocks);
return facts.map(f => ({ id: f.id, label: f.label, topic: f.topic, role: f.role, display: f.display, raw: f.raw, sources: f.sources,
  showOnCard: f.showOnCard, linkedTo: f.linkedTo || null, change: f.change ? f.change.display : null, direction: f.direction,
  sentiment: f.sentiment, periodInferred: f.periodInferred, labelConfidence: f.labelConfidence, periodConfidence: f.periodConfidence,
  qualifiers: f.qualifiers, priorPeriod: f.priorPeriod, prior: f.prior, period: f.period ? f.period.text : null, score: f.score }));
"""

TOPIC_ORDER = ["revenue/sales", "gross profit", "operating income", "net income", "EPS/per share", "margin", "cash flow"]
CONF = {"high": 3, "medium": 2, "low": 1}
ORDINAL = {"first": 1, "second": 2, "third": 3, "fourth": 4}


def wait_for_card(driver, timeout=150):
    """The card's state once the run has finished and the card is fully in."""
    end = time.time() + timeout
    while time.time() < end:
        s = driver.execute_script(CARD_STATE)
        if s["card"] and not s["measuring"] and s["running"] is False:
            return s
        time.sleep(0.25)
    return driver.execute_script(CARD_STATE)


def contrast(a, b):
    """WCAG contrast ratio between two rgb()/rgba() colours."""
    def luminance(colour):
        nums = [float(x) for x in colour[colour.index("(") + 1 : colour.index(")")].split(",")[:3]]

        def channel(v):
            v /= 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

        r, g, b = (channel(v) for v in nums)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _rank(f):
    if f["role"] == "guidance":
        return len(TOPIC_ORDER)
    if f["topic"] not in TOPIC_ORDER:
        return len(TOPIC_ORDER) + 2
    segment = any(re.match(r"^[A-Z]", q) and q not in ("GAAP", "non-GAAP") for q in f["qualifiers"])
    return len(TOPIC_ORDER) + 1 if segment else TOPIC_ORDER.index(f["topic"])


def _recency(f):
    if not f["period"]:
        return -math.inf
    t = f["period"].lower()
    years = [
        (2000 + int(a) if len(a) == 2 else int(a)) if a else int(b)
        for a, b in re.findall(r"\b(?:fy|fiscal(?: year)?)\s*['’]?(\d{4}|\d{2})\b|\b((?:19|20)\d{2})\b", t)
    ]
    if not years:
        return -1e9
    q = re.search(r"\bq([1-4])\b", t) or re.search(r"\b(first|second|third|fourth)[\s-]quarter\b", t)
    quarter = (int(q.group(1)) if q.group(1).isdigit() else ORDINAL[q.group(1)]) if q else 0
    return max(years) * 10 + quarter


def expected_rows(facts):
    """The card's rows as [(fact id, shown before "Show all")], following card.js's rules."""
    pos = {f["id"]: i for i, f in enumerate(facts)}
    first = {}
    for i, f in enumerate(facts):
        first.setdefault(f["label"], i)
    shown = [f for f in facts if f["showOnCard"]]
    period = lambda f: (f["period"] or "").lower()
    groups, tucked = {}, {}
    for f in shown:
        if f["role"] == "change" and any(l["role"] == "level" and l["label"] == f["label"] and period(l) == period(f) for l in shown):
            tucked.setdefault((f["label"], "level"), []).append(f)
            continue
        groups.setdefault((f["label"], f["role"]), []).append(f)
    best = lambda f: (-_recency(f), -CONF[f["labelConfidence"]], -CONF.get(f["periodConfidence"], 0), -(f["score"] or 0), pos[f["id"]])
    lists = [(sorted(g, key=best), sorted(tucked.get(k, []), key=best)) for k, g in groups.items()]
    lists.sort(key=lambda x: (_rank(x[0][0]), 1 if x[0][0]["role"] == "change" else 0, first[x[0][0]["label"]], -(x[0][0]["score"] or 0), pos[x[0][0]["id"]]))
    out = []
    for i, (group, extra) in enumerate(lists):
        out += [(f["id"], j == 0 and i < 7) for j, f in enumerate(group)] + [(f["id"], False) for f in extra]
    return out


def check_rows(name, s, facts):
    """Row-level checks shared by every page: which rows, their order, and their cells."""
    by_id = {f["id"]: f for f in facts}
    shown = [f for f in facts if f["showOnCard"]]
    row_ids = [r["id"] for r in s["rows"]]
    report(f"{name}: one row per showOnCard fact", sorted(row_ids) == sorted(f["id"] for f in shown), f"{len(row_ids)} rows, {len(shown)} showOnCard")
    linked_rows = [i for i in row_ids if by_id.get(i, {}).get("linkedTo")]
    report(f"{name}: linked changes are never their own rows", not linked_rows, str(linked_rows))
    want = expected_rows(facts)
    got = [(r["id"], r["shown"]) for r in s["rows"]]
    report(f"{name}: rows in importance order, one main row per metric, 7 shown", got == want,
           f"shown: {[by_id[i]['label'] + ' ' + by_id[i]['display'] for i, v in got if v]}" + ("" if got == want else f" | want {want} got {got}"))
    shown_keys = [(by_id[i]["label"], by_id[i]["role"]) for i, v in got if v]
    report(f"{name}: at most one shown row per metric, at most 7, no earlier table columns",
           len(shown_keys) == len(set(shown_keys)) and len(shown_keys) <= 7 and not any(by_id[i]["priorPeriod"] for i in row_ids), str(shown_keys))
    wrong_tips = [
        (r["cells"][0], r["changeTitle"]) for r in s["rows"]
        if by_id[r["id"]]["prior"] and r["changeTitle"] != f"vs {by_id[r['id']]['prior']['display']} in {by_id[r['id']]['prior']['period']}"
    ]
    report(f"{name}: Change cell tooltips show the prior value", not wrong_tips, str(wrong_tips[:3]))
    bad = []
    for r in s["rows"]:
        f = by_id.get(r["id"])
        if not f:
            continue
        arrow = {"up": "▲", "down": "▼", "flat": "▬"}.get(f["direction"])
        change = "" if not arrow else (f"{arrow} {f['change'].lstrip('+-−')}" if f["change"] else arrow)
        if r["cells"][2] != change:
            bad.append((f["label"], r["cells"][2], change))
        if f["display"] not in r["cells"][1]:
            bad.append((f["label"], r["cells"][1], f["display"]))
        if f["periodInferred"] != r["inferred"]:
            bad.append((f["label"], "inferred", r["inferred"]))
    report(f"{name}: Figure, Change (arrow + linked change) and Period cells match the facts", not bad, str(bad[:4]))
    also = [f for f in facts if not f["showOnCard"] and not f["linkedTo"] and not f["priorPeriod"]]
    if also:
        report(f"{name}: 'Also caught (N)' lists the other facts", s["also"] == f"Also caught ({len(also)})" and len(s["alsoItems"]) == len(also),
               f"{s['also']} / {len(s['alsoItems'])} items")
    return shown, also
