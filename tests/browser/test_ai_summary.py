"""The on-device AI summary, with a mock in place of the model.

Headless browsers don't have the on-device model, so these checks use a stand-in
(window.__frogbotMockSummarizer, honoured only with window.__frogbotTestMode set and never in the
real extension). It behaves like the Summarizer API: availability states, create() with a
download monitor (refusing to start a download without a user click), abort signals, and slow
or failing summarize() calls, and it records every call, including destroy().

Covers: each availability state, the download button and progress bar, an accepted summary
(numbers linked, removed sentences noted), made-up and wrong-metric figures removed, mostly-wrong
output, errors and the 20-second timeout falling back to the rules summary, Escape / × /
releasing again aborting generation, destroy() after every run, the switch turned off making no
calls at all, the mock being ignored outside test mode, Copy summary, and the page restoring
exactly.

    python tests/browser/test_ai_summary.py
"""

import time

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from card_helpers import CARD, EXPECTED, wait_for_card
from common import add_css, finish, info, make_driver, media, open_page, release, report

MOCK = r"""
const cfg = arguments[0];
window.__frogbotTestMode = cfg.testMode !== false;
if (cfg.useAI === false) window.__frogbotUseAI = false;
if (cfg.extensionId) window.chrome = Object.assign(window.chrome || {}, { runtime: { id: cfg.extensionId } });
window.__mockLog = { availability: 0, create: 0, summarize: 0, destroy: 0, aborted: 0, activation: [], options: null, input: null };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { __mockLog.aborted++; return reject(signal.reason || new DOMException('Aborted', 'AbortError')); }
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); __mockLog.aborted++; reject(signal.reason || new DOMException('Aborted', 'AbortError')); }, { once: true });
});
window.__frogbotMockSummarizer = {
  async availability() { __mockLog.availability++; return cfg.state; },
  create(opts) {
    __mockLog.create++;
    __mockLog.activation.push(navigator.userActivation.isActive);
    __mockLog.options = { type: opts.type, format: opts.format, length: opts.length, outputLanguage: opts.outputLanguage,
                          sharedContext: opts.sharedContext, monitor: !!opts.monitor, signal: !!opts.signal };
    // Like the real API: starting a download needs a user gesture.
    if (cfg.state === 'downloadable' && !navigator.userActivation.isActive) {
      return Promise.reject(new DOMException('Requires a user gesture', 'NotAllowedError'));
    }
    return (async () => {
      if (cfg.state === 'downloadable' || cfg.state === 'downloading') {
        const monitor = new EventTarget();
        if (opts.monitor) opts.monitor(monitor);
        for (const loaded of [0, 0.25, 0.5, 0.75, 1]) {
          const event = new Event('downloadprogress');
          event.loaded = loaded;
          monitor.dispatchEvent(event);
          await sleep(cfg.stepMs || 400, opts.signal);
        }
      }
      return {
        async summarize(text, options) {
          __mockLog.summarize++;
          __mockLog.input = text;
          await sleep(cfg.delayMs || 0, options && options.signal);
          if (cfg.error) throw new Error(cfg.error);
          return cfg.output;
        },
        destroy() { __mockLog.destroy++; },
      };
    })();
  },
};
"""
AI_STATE = r"""
const host = document.querySelector('.frogbot-card-host');
if (!host) return { card: false, label: null, items: [], writing: false, progress: null, log: window.__mockLog };
const sr = host.shadowRoot, sec = sr.querySelector('.summary');
const card = sr.querySelector('.card').getBoundingClientRect();
const frog = document.querySelector('.frogbot-frog');
const fr = frog ? frog.getBoundingClientRect() : null;
return {
  card: true, running: window.__frogbotRunning, measuring: sr.querySelector('.card').classList.contains('measuring'),
  label: sec ? sec.querySelector('.name').textContent + ' ' + sec.querySelector('.kind').textContent : null,
  items: sec ? [...sec.querySelectorAll('li')].map(li => li.textContent) : [],
  links: sec ? [...sec.querySelectorAll('.num-link')].map(b => ({ text: b.textContent, id: b.dataset.factId })) : [],
  writing: !!sr.querySelector('.ai-writing'),
  button: sr.querySelector('.ai-get') ? sr.querySelector('.ai-get').textContent : null,
  progress: sr.querySelector('.ai-progress') ? Number(sr.querySelector('.ai-progress').getAttribute('aria-valuenow')) : null,
  dropped: sr.querySelector('.ai-dropped') ? { text: sr.querySelector('.ai-dropped').textContent, title: sr.querySelector('.ai-dropped').title } : null,
  cardText: sr.querySelector('.card').textContent,
  perched: fr ? Math.abs(fr.left + fr.width / 2 - (card.left + 6)) < 3 && Math.abs(fr.top + fr.height / 2 - (card.top - 16)) < 3 : false,
  log: window.__mockLog,
};
"""
RULES = "Summary · built from page figures"
AI = "AI summary · every number checked"
GOOD = (
    "* Revenue rose 14.2% to $482.6 million in Q3 2026\n"
    "* Net income rose 28% to $61.3 million in Q3 2026\n"
    "* Lilypad expects fourth-quarter revenue of $505 million to $525 million"
)
GOOD_SENTENCES = [
    "Revenue rose 14.2% to $482.6 million in Q3 2026.",
    "Net income rose 28% to $61.3 million in Q3 2026.",
    "Lilypad expects fourth-quarter revenue of $505 million to $525 million.",
]
MADE_UP = GOOD + "\n* Free cash flow reached $72.0 million"
WRONG_METRIC = GOOD + "\n* Operating income was $61.3 million"
MOSTLY_WRONG = "* Revenue rose 14.2% to $482.6 million\n* Net income fell 28% to $61.3 million\n* Revenue reached $500 million"


def start(d, cfg):
    open_page(d, "test-page")
    add_css(d)
    d.execute_script(MOCK, cfg)
    before = d.execute_script("return document.body.innerHTML")
    release(d)
    return before


def state(d):
    return d.execute_script(AI_STATE)


def wait(d, test, timeout=40):
    end = time.time() + timeout
    s = state(d)
    while time.time() < end:
        s = state(d)
        if test(s):
            return s
        time.sleep(0.15)
    return s


def shown_card(s):
    return s["card"] and not s["measuring"] and s["running"] is False


def run_case(name, cfg, check, timeout=40):
    d = make_driver()
    media(d, "light", reduced=True)
    try:
        before = start(d, cfg)
        check(d, before)
    except Exception as e:  # one scenario's trouble shouldn't stop the others
        report(f"{name}: run", False, str(e)[:200])
    finally:
        d.quit()


def accepted_checks(d, before):
    first = wait(d, shown_card)
    report("available: the card drops with the rules summary and 'Writing AI summary…'", first["label"] == RULES and first["writing"], f"{first['label']!r}, writing {first['writing']}")
    s = wait(d, lambda x: x["label"] == AI)
    report("available: the checked AI summary replaces it", s["label"] == AI and s["items"] == GOOD_SENTENCES and not s["writing"], str(s["items"]))
    report("available: no 'removed' note when nothing was dropped", s["dropped"] is None)
    report("available: the frog stays perched as the card changes size", s["perched"])
    log = s["log"]
    report("available: one summarizer, created with key points / plain text / short / English", log["create"] == 1 and log["options"]["type"] == "key-points"
           and log["options"]["format"] == "plain-text" and log["options"]["length"] == "short" and log["options"]["outputLanguage"] == "en" and log["options"]["signal"], str(log["options"]))
    report("available: the shared context says to use only the figures given", "only the figures given" in (log["options"]["sharedContext"] or ""), log["options"]["sharedContext"])
    sources = d.execute_script(r"""const blocks = FrogbotExtract.getBlocks(FrogbotExtract.findMainContainer());
        const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
        const totalWords = blocks.reduce((s, b) => s + b.text.split(/\s+/).length, 0);
        return FrogbotScore.rankUnits(units, { totalWords }).chosen.slice().sort((a, b) => a.order - b.order).map(u => u.text)""")
    report("available: the input is the chosen sentences and rows only, in page order", log["input"] == "\n".join(sources), f"{len(log['input'] or '')} characters from {len(sources)} sentences/rows")
    report("available: destroy() called after generating", log["destroy"] == 1)
    # Every number in the AI summary jumps to its figure.
    facts = {f["id"]: f for f in d.execute_script(EXPECTED)}
    bad = []
    for i, link in enumerate(s["links"]):
        d.execute_script(f"{CARD}.querySelectorAll('.summary .num-link')[arguments[0]].click()", i)
        time.sleep(0.08)
        pulsed = d.execute_script("return [...document.querySelectorAll('mark.frogbot-outline, mark.frogbot-pulse')].map(m => m.textContent).join('')")
        if "".join(pulsed.split()) != "".join(facts[link["id"]]["raw"].split()):
            bad.append((link["text"], pulsed))
    report("available: every number in the AI summary is a link that jumps to its figure", len(s["links"]) >= 4 and not bad, f"{len(s['links'])} links, {bad[:2]}")
    # Copy summary copies the AI summary now.
    d.execute_cdp_cmd("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
    d.execute_script(f"return {CARD}.querySelector('.copy-summary')").click()
    time.sleep(0.2)
    text = d.execute_async_script("const done = arguments[0]; navigator.clipboard.readText().then(done, e => done('ERR ' + e))").replace("\r\n", "\n")
    report("available: Copy summary copies the AI summary", text == "\n".join(GOOD_SENTENCES) + "\n", repr(text[:80]))
    ActionChains(d).send_keys(Keys.ESCAPE).perform()
    time.sleep(0.3)
    report("available: Escape restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))


def removed_checks(label, bad_sentence, bad_figure):
    def check(d, before):
        s = wait(d, lambda x: x["label"] == AI)
        kept = s["items"] == GOOD_SENTENCES
        report(f"{label}: the bad sentence never reaches the card", kept and bad_figure not in s["cardText"].split("Also caught")[0].replace("$61.3M", ""), str(s["items"]))
        report(f"{label}: '1 sentence removed (figure not on the page)', the removed text in its tooltip",
               bool(s["dropped"]) and s["dropped"]["text"] == "1 sentence removed (figure not on the page)" and bad_sentence in s["dropped"]["title"], str(s["dropped"]))
        report(f"{label}: destroy() called", s["log"]["destroy"] == 1)
    return check


def fallback_checks(label, timeout=40, aborted=False):
    def check(d, before):
        wait(d, shown_card)
        s = wait(d, lambda x: x["log"]["destroy"] >= 1 and not x["writing"], timeout)
        report(f"{label}: the rules summary stays", s["label"] == RULES and len(s["items"]) == 4 and not s["writing"], f"{s['label']!r}, writing {s['writing']}")
        report(f"{label}: destroy() called", s["log"]["create"] == 1 and s["log"]["destroy"] == 1, str({k: s["log"][k] for k in ("create", "destroy", "aborted")}))
        if aborted:
            report(f"{label}: generation was aborted", s["log"]["aborted"] >= 1)
    return check


def unavailable_checks(d, before):
    s = wait(d, shown_card)
    time.sleep(0.5)
    s = state(d)
    report("unavailable: rules summary only, no button or progress, no create()", s["label"] == RULES and s["button"] is None and s["progress"] is None and not s["writing"] and s["log"]["create"] == 0,
           str({k: s[k] for k in ("label", "button", "progress", "writing")}))


def downloadable_checks(d, before):
    s = wait(d, shown_card)
    time.sleep(1.0)
    s = state(d)
    report("downloadable: rules summary plus 'Get AI summaries (one-time download)'", s["label"] == RULES and s["button"] == "Get AI summaries (one-time download)", f"{s['label']!r} {s['button']!r}")
    report("downloadable: nothing downloads before the click (no create())", s["log"]["create"] == 0)
    # A real click: the user activation the download needs.
    d.execute_script(f"return {CARD}.querySelector('.ai-get')").click()
    seen = set()
    end = time.time() + 15
    while time.time() < end:
        s = state(d)
        if s["progress"] is not None:
            seen.add(s["progress"])
        if s["label"] == AI:
            break
        time.sleep(0.05)
    report("downloadable: the click starts the download with a progress bar", len(seen) >= 2 and max(seen) >= 50, f"progress seen {sorted(seen)}")
    report("downloadable: create() ran inside the click, with a download monitor", s["log"]["create"] == 1 and s["log"]["activation"] == [True] and s["log"]["options"]["monitor"], str(s["log"]["activation"]))
    report("downloadable: then the AI summary for this page", s["label"] == AI and s["items"] == GOOD_SENTENCES and s["log"]["destroy"] == 1, str(s["items"])[:120])


def downloading_checks(d, before):
    seen = set()
    end = time.time() + 45
    s = state(d)
    while time.time() < end:
        s = state(d)
        if s["card"] and s["progress"] is not None:
            seen.add(s["progress"])
        if s["card"] and s["label"] == AI:
            break
        time.sleep(0.05)
    report("downloading: rules summary plus the progress bar", bool(seen), f"progress seen {sorted(seen)}")
    report("downloading: then the AI summary, summarizer destroyed", s["label"] == AI and s["log"]["destroy"] == 1)


def off_checks(d, before):
    s = wait(d, shown_card)
    time.sleep(1.0)
    s = state(d)
    report("switch off: no AI calls at all, rules summary only", s["log"]["availability"] == 0 and s["log"]["create"] == 0 and s["label"] == RULES and s["button"] is None,
           str({k: s["log"][k] for k in ("availability", "create")}))


def not_test_mode_checks(label):
    def check(d, before):
        s = wait(d, shown_card)
        time.sleep(1.0)
        s = state(d)
        report(f"{label}: the mock is ignored", s["log"]["availability"] == 0 and s["log"]["create"] == 0 and s["label"] == RULES, str({k: s["log"][k] for k in ("availability", "create")}))
    return check


def abort_checks(how):
    def check(d, before):
        s = wait(d, lambda x: shown_card(x) and x["writing"])
        report(f"{how} mid-generation: the card was waiting on the AI summary", s["writing"])
        if how == "Escape":
            ActionChains(d).send_keys(Keys.ESCAPE).perform()
        elif how == "×":
            d.execute_script(f"{CARD}.querySelector('.close').click()")
        time.sleep(0.4)
        log = d.execute_script("return window.__mockLog")
        report(f"{how} mid-generation: aborted, summarizer destroyed", log["aborted"] >= 1 and log["destroy"] == 1, str({k: log[k] for k in ("create", "aborted", "destroy")}))
        report(f"{how} mid-generation: page HTML restored exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))
        time.sleep(1.5)
        report(f"{how} mid-generation: nothing comes back afterwards", d.execute_script("return document.querySelectorAll('[data-frogbot], .frogbot-card-host').length") == 0)
    return check


def rerelease_checks(d, before):
    wait(d, lambda x: shown_card(x) and x["writing"])
    release(d)  # releasing again replaces the run, aborting its summary
    time.sleep(0.4)
    log = d.execute_script("return window.__mockLog")
    report("releasing again mid-generation: the old summary is aborted and destroyed", log["aborted"] >= 1 and log["destroy"] >= 1, str({k: log[k] for k in ("create", "aborted", "destroy")}))
    s = wait(d, lambda x: x["label"] == AI, 45)
    report("releasing again: the new run writes its own summary, and every summarizer is destroyed", s["label"] == AI and s["log"]["create"] == 2 and s["log"]["destroy"] == 2,
           str({k: s["log"][k] for k in ("create", "destroy")}))
    ActionChains(d).send_keys(Keys.ESCAPE).perform()
    time.sleep(0.3)
    report("releasing again: Escape restores the page HTML exactly", d.execute_script("return document.body.innerHTML === arguments[0]", before))


def main():
    # Long enough that the card drops before the summary is written.
    run_case("available", {"state": "available", "output": GOOD, "delayMs": 15000}, accepted_checks)
    run_case("made-up figure", {"state": "available", "output": MADE_UP}, removed_checks("made-up figure", "Free cash flow reached $72.0 million", "$72.0"))
    run_case("wrong metric", {"state": "available", "output": WRONG_METRIC}, removed_checks("wrong-metric figure", "Operating income was $61.3 million", "Operating income was"))
    run_case("mostly wrong", {"state": "available", "output": MOSTLY_WRONG}, fallback_checks("mostly-wrong output (rejected)"))
    run_case("error", {"state": "available", "output": GOOD, "error": "The model crashed"}, fallback_checks("an error"))
    run_case("empty", {"state": "available", "output": "   "}, fallback_checks("empty output"))
    info("the timeout case waits for the 20-second limit")
    run_case("timeout", {"state": "available", "output": GOOD, "delayMs": 30000}, fallback_checks("a slow response (20s timeout)", timeout=40, aborted=True))
    run_case("unavailable", {"state": "unavailable", "output": GOOD}, unavailable_checks)
    run_case("downloadable", {"state": "downloadable", "output": GOOD, "stepMs": 400}, downloadable_checks)
    run_case("downloading", {"state": "downloading", "output": GOOD, "stepMs": 3500}, downloading_checks)
    run_case("switch off", {"state": "available", "output": GOOD, "useAI": False}, off_checks)
    run_case("not test mode", {"state": "available", "output": GOOD, "testMode": False}, not_test_mode_checks("without the test flag"))
    run_case("in the extension", {"state": "available", "output": GOOD, "extensionId": "abcdefghijklmnop"}, not_test_mode_checks("inside the real extension (chrome.runtime.id set)"))
    run_case("escape", {"state": "available", "output": GOOD, "delayMs": 15000}, abort_checks("Escape"))
    run_case("close", {"state": "available", "output": GOOD, "delayMs": 15000}, abort_checks("×"))
    run_case("re-release", {"state": "available", "output": GOOD, "delayMs": 15000}, rerelease_checks)
    finish()


if __name__ == "__main__":
    main()
