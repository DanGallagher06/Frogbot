"""The installed extension: welcome page, built-in demo, keyboard shortcut, popup and options.

These checks load Frogbot as an unpacked extension, which Edge and branded Chrome no longer
allow from the command line (--load-extension is ignored there). So this suite runs in Chrome
for Testing, which Selenium Manager downloads into its cache on first use (about 200 MB,
once). The other suites keep running in Edge.

Covers: the welcome page opening once on install and not on restart (and, running
background.js's handler with a stand-in chrome object, not on updates or reloads); its sections,
links, shortcut and version; "Try it now" opening the demo; the demo's full run (frog,
highlights, card, summary, exports, Escape restoring the page) from its button and from the
shortcut; the shortcut (a real Alt+Shift+F key press) on an ordinary page served over http, and
doing nothing on a browser page; PDF tabs (the shortcut does nothing, the popup says Frogbot
can't read PDFs yet); the popup (no debug toggle, the shortcut, the version, the
links); the options page (the debug toggle, stored and used by the next run). Screenshots of each
page, light and dark, go to test-pages/local/screens/.

    uv run --with selenium python tests/browser/test_extension.py
"""

import csv
import functools
import http.server
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import threading
import time
import urllib.request

os.environ.setdefault("SE_FORCE_BROWSER_DOWNLOAD", "true")  # Chrome for Testing, not branded Chrome
os.environ.setdefault("SE_AVOID_STATS", "true")  # no Selenium Manager usage stats

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from common import ROOT, SCREENS, finish, report, skip

MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
VERSION = MANIFEST["version"]
SHORTCUT = MANIFEST["commands"]["release-frog"]["suggested_key"]["default"]
CARD = "document.querySelector('.frogbot-card-host').shadowRoot"
STATE = """return { frog: !!document.querySelector('.frogbot-frog'), marks: document.querySelectorAll('mark').length,
  card: !!document.querySelector('.frogbot-card-host'), debug: document.querySelectorAll('.frogbot-debug-box').length,
  any: document.querySelectorAll('[data-frogbot]').length }"""


# A one-page PDF with a finance sentence in it, for the PDF notice.
PDF = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 55>>stream
BT /F1 18 Tf 20 70 Td (Revenue rose 12% to $5.2 billion) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The test pages, plus a PDF at /release.pdf and at /pdf-release?id=7 (no .pdf in the
    address, only its content type says it's a PDF)."""

    def do_GET(self):
        if self.path.startswith("/release.pdf") or self.path.startswith("/pdf-release"):
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(PDF)))
            self.end_headers()
            self.wfile.write(PDF)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


def serve_test_pages():
    """The test pages over http: the shortcut's activeTab grant doesn't cover file:// pages."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "test-pages")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def make_driver(profile, scheme="light", downloads=None):
    o = Options()
    o.add_argument("--headless=new")
    o.add_argument("--window-size=1300,1000")
    o.add_argument(f"--user-data-dir={profile}")
    o.add_argument(f"--load-extension={ROOT}")
    o.add_argument(f"--disable-extensions-except={ROOT}")
    o.add_experimental_option("excludeSwitches", ["disable-extensions"])
    try:
        d = webdriver.Chrome(options=o)
    except Exception:  # the browser occasionally fails to start on a busy machine: once more
        time.sleep(3)
        d = webdriver.Chrome(options=o)
    d.set_page_load_timeout(30)
    d.execute_cdp_cmd("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-color-scheme", "value": scheme}]})
    if downloads:
        d.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(downloads)})
    return d


def targets(d):
    addr = d.capabilities["goog:chromeOptions"]["debuggerAddress"]
    return json.load(urllib.request.urlopen(f"http://{addr}/json"))


def wait(d, js, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if d.execute_script("return " + js):
            return True
        time.sleep(0.2)
    return False


def extension_id(d, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        for t in targets(d):
            if t["type"] == "service_worker" and t["url"].endswith("/background.js"):
                return t["url"].split("/")[2]
        time.sleep(0.3)
    return None


def welcome_tabs(d):
    return [t["id"] for t in targets(d) if t["type"] == "page" and t["url"].endswith("/pages/welcome.html")]


def show(d, url):
    """Open a page in the driver's own tab, in front (a tab in the background doesn't animate)."""
    d.execute_cdp_cmd("Page.bringToFront", {})
    d.get(url)
    time.sleep(0.5)


def press_shortcut(d):
    """A real Alt+Shift+F key press: the browser, not the page, turns it into the command."""
    for kind in ("rawKeyDown", "keyUp"):
        d.execute_cdp_cmd("Input.dispatchKeyEvent", {"type": kind, "modifiers": 1 | 8, "key": "F", "code": "KeyF",
                                                     "windowsVirtualKeyCode": 70, "nativeVirtualKeyCode": 70})


def screenshot(d, name, element_js=None):
    SCREENS.mkdir(parents=True, exist_ok=True)
    path = SCREENS / f"{name}.png"
    if element_js:
        d.execute_script(f"return {element_js}").screenshot(str(path))
    else:
        # The whole page, however long.
        height = d.execute_script("return document.documentElement.scrollHeight")
        d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": 1100, "height": min(height, 4000), "deviceScaleFactor": 1, "mobile": False})
        time.sleep(0.3)
        d.save_screenshot(str(path))
        d.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})


HANDLER = r"""
const done = arguments[arguments.length - 1];
const opened = [];
const store = {};
const listeners = [];
const fake = {
  runtime: { OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    onInstalled: { addListener: (f) => listeners.push(f) }, getURL: (p) => 'ext/' + p },
  tabs: { create: async (o) => opened.push(o.url), query: async () => [] },
  storage: { local: { get: async (d) => ({ ...d, ...store }), set: async (o) => Object.assign(store, o) } },
  commands: { onCommand: { addListener() {} } },
};
const run = new Function('chrome', 'importScripts', 'FrogbotRelease', arguments[0]);
run(fake, () => {}, { release: async () => ({ ok: true }) });
(async () => {
  const reasons = [];
  for (const reason of ['update', 'chrome_update', 'shared_module_update', 'install', 'install', 'update']) {
    const before = opened.length;
    for (const f of listeners) await f({ reason });
    if (opened.length > before) reasons.push(reason);
  }
  done(reasons);
})();
"""


def handler_check(d):
    """The reasons for which background.js's onInstalled handler opens the welcome page."""
    return d.execute_async_script(HANDLER, (ROOT / "background.js").read_text(encoding="utf-8"))


def install_checks(profile):
    """Fresh install: the welcome page opens once. Reloading the extension or restarting the
    browser doesn't open it again."""
    d = make_driver(profile)
    try:
        ext = extension_id(d)
        report("the extension loads, with its service worker", bool(ext), str(ext))
        if not ext:
            return None
        end = time.time() + 10
        while time.time() < end and not welcome_tabs(d):
            time.sleep(0.3)
        first = welcome_tabs(d)
        report("fresh install opens the welcome page once", len(first) == 1, str(first))
        # Reloads and updates: Chrome unloads a command-line extension on chrome.runtime.reload()
        # rather than reloading it, so background.js's handler is run here against a stand-in
        # chrome object, with every reason the browser can give.
        opened_for = handler_check(d)
        report("updates, browser updates and reloads never open the welcome page; a repeated 'install' doesn't either",
               opened_for == ["install"], str(opened_for))
    finally:
        d.quit()
    # Restart with the same profile: still installed, so no welcome page. (This browser reports
    # "install" again on every launch for a command-line extension; the stored flag holds.)
    d = make_driver(profile)
    try:
        ext = extension_id(d)
        time.sleep(3)
        report("restarting the browser doesn't open the welcome page", bool(ext) and not welcome_tabs(d), str(welcome_tabs(d)))
    finally:
        d.quit()
    return ext


def welcome_checks(ext, scheme):
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    d = make_driver(profile, scheme)
    try:
        extension_id(d)
        show(d, f"chrome-extension://{ext}/pages/welcome.html")
        if scheme == "light":
            info = d.execute_script("""
              const text = (s) => (document.querySelector(s) || {}).textContent || '';
              const gif = document.querySelector('.demo-gif');
              return {
                title: document.title,
                headings: [...document.querySelectorAll('h2')].map(h => h.textContent.replace(/\\s+/g, ' ').trim()),
                gif: gif && gif.complete && gif.naturalWidth > 0,
                pinArt: !!document.querySelector('svg.pin-art title'),
                tryHref: document.getElementById('try-it').getAttribute('href'),
                shortcut: text('.shortcut'),
                version: text('.version'),
                links: [...document.querySelectorAll('.links a')].map(a => a.href),
                privacy: text('#privacy + p'),
              };""")
            report("welcome: hello, pin, try it, use it, privacy sections in order",
                   info["headings"] == ["Hello!", "1 Pin the frog", "2 Try it now", "3 Use it on real pages", "Privacy"], str(info["headings"]))
            report("welcome: the demo GIF loads, and the pin illustration is drawn in SVG", info["gif"] and info["pinArt"])
            report(f"welcome: shows the current shortcut ({SHORTCUT}) and the version", info["shortcut"] == SHORTCUT and info["version"] == f"Version {VERSION}",
                   f"{info['shortcut']!r} {info['version']!r}")
            report("welcome: links to GitHub, Issues and the export format doc",
                   info["links"] == ["https://github.com/DanGallagher06/Frogbot", "https://github.com/DanGallagher06/Frogbot/issues",
                                     "https://github.com/DanGallagher06/Frogbot/blob/main/docs/export-format.md"], str(info["links"]))
            report("welcome: privacy in two lines", "only runs" in info["privacy"] and "Nothing leaves your browser" in info["privacy"], info["privacy"][:120])
        screenshot(d, f"welcome-{scheme}")
        bg = d.execute_script("return getComputedStyle(document.body).backgroundColor")
        report(f"welcome ({scheme}): follows the colour scheme", (bg == "rgb(20, 26, 22)") == (scheme == "dark"), bg)
        if scheme == "light":
            d.find_element("id", "try-it").click()
            time.sleep(0.8)
            report("welcome: 'Try it now' opens the demo page", d.current_url == f"chrome-extension://{ext}/pages/demo.html", d.current_url)
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)


def demo_checks(ext, scheme):
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    downloads = pathlib.Path(tempfile.mkdtemp(prefix="frogbot-dl-"))
    d = make_driver(profile, scheme, downloads)
    try:
        extension_id(d)
        show(d, f"chrome-extension://{ext}/pages/demo.html")
        before = d.execute_script("return document.body.innerHTML")
        d.execute_script("window.__errors = []; addEventListener('error', e => /^ResizeObserver loop/.test(e.message) || __errors.push(e.message));")
        d.find_element("id", "demo-release").click()
        wait(d, "document.querySelectorAll('mark').length >= 2", 30)
        SCREENS.mkdir(parents=True, exist_ok=True)
        d.save_screenshot(str(SCREENS / f"demo-running-{scheme}.png"))
        carded = wait(d, f"!!document.querySelector('.frogbot-card-host') && {CARD}.querySelector('.card:not(.measuring)')", 60)
        time.sleep(0.6)
        d.save_screenshot(str(SCREENS / f"demo-card-{scheme}.png"))
        if scheme == "dark":
            return
        s = d.execute_script(f"""const sr = {CARD};
          return {{ rows: sr.querySelectorAll('tbody tr').length, company: (sr.querySelector('.company') || {{}}).textContent,
            summary: sr.querySelectorAll('.summary li, .summary p').length, buttons: [...sr.querySelectorAll('.actions button')].map(b => b.textContent) }}""")
        state = d.execute_script(STATE)
        report("demo: 'Release the frog' runs the full flow: frog, highlights, card, summary",
               carded and state["frog"] and state["marks"] >= 10 and s["rows"] == 6 and s["summary"] > 0 and s["company"] == "Lilypad Holdings, Inc. (LILY)",
               json.dumps({**state, **s}))
        d.execute_script(f"{CARD}.querySelector('.csv').click()")
        end = time.time() + 10
        files = []
        while time.time() < end and not files:
            files = list(downloads.glob("*.csv"))
            time.sleep(0.2)
        time.sleep(0.3)
        rows = list(csv.DictReader(io.StringIO(files[0].read_text(encoding="utf-8-sig")))) if files else []
        report("demo: Download CSV works there", len(rows) == 6 and rows[0]["company"] == "Lilypad Holdings, Inc." and rows[0]["page_url"].startswith("chrome-extension://"),
               str([f.name for f in files]))
        d.execute_script(f"{CARD}.querySelector('.xlsx').click()")
        end = time.time() + 10
        xlsx = []
        while time.time() < end and not xlsx:
            xlsx = list(downloads.glob("*.xlsx"))
            time.sleep(0.2)
        report("demo: Download Excel works there", bool(xlsx), str([f.name for f in xlsx]))
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
        time.sleep(0.5)
        state = d.execute_script(STATE)
        after = d.execute_script("return document.body.innerHTML")
        report("demo: Escape cleans up: no frog, marks or card, and the page HTML is exactly as before",
               not state["frog"] and not state["marks"] and not state["card"] and state["any"] == 0 and after == before, json.dumps(state))
        report("demo: no errors", d.execute_script("return __errors") == [], str(d.execute_script("return __errors")))
        # The shortcut on the demo page: extension pages can't be injected into, so the demo runs itself.
        d.execute_script("document.activeElement && document.activeElement.blur()")
        press_shortcut(d)
        ran = wait(d, "!!document.querySelector('.frogbot-frog')", 10)
        report(f"demo: {SHORTCUT} releases the frog on the demo page too", ran)
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(downloads, ignore_errors=True)


def shortcut_checks(ext, base):
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    d = make_driver(profile)
    try:
        extension_id(d)
        show(d, f"{base}/earnings-sample.html")
        press_shortcut(d)
        ran = wait(d, "!!document.querySelector('.frogbot-frog')", 10)
        carded = wait(d, "!!document.querySelector('.frogbot-card-host')", 60)
        state = d.execute_script(STATE)
        report(f"shortcut: {SHORTCUT} releases the frog on the test page (http), through to the card", ran and carded and state["marks"] >= 10, json.dumps(state))
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
        # A browser page: nothing happens, and the shortcut still works afterwards.
        show(d, "chrome://version")
        press_shortcut(d)
        time.sleep(1.5)
        quiet = d.execute_script("return !document.querySelector('.frogbot-frog')")
        show(d, f"{base}/mapping.html")
        press_shortcut(d)
        again = wait(d, "!!document.querySelector('.frogbot-frog')", 10)
        report("shortcut: does nothing on a browser page, and still works on the next page", quiet and again)
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)


PDF_NOTICE = "Frogbot can't read PDFs yet. Open the HTML version of the page if there is one."
# In a popup opened as a tab, "the active tab" is the popup itself, so its query is pointed at
# the other tab (the PDF) before clicking Release.
POPUP_ON_OTHER_TAB = """const done = arguments[0];
chrome.tabs.getCurrent(async (me) => {
  const other = (await chrome.tabs.query({})).find((t) => t.id !== me.id);
  chrome.tabs.query = async () => [other];
  document.getElementById('release').click();
  const end = Date.now() + 5000;
  const wait = () => { const m = document.getElementById('message');
    if (!m.hidden || Date.now() > end) done({ shown: !m.hidden, text: m.textContent }); else setTimeout(wait, 100); };
  wait();
});"""


def pdf_checks(ext, base):
    """A PDF tab: the shortcut does nothing, and the popup says Frogbot can't read PDFs yet."""
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    d = make_driver(profile)
    try:
        extension_id(d)
        for path, kind in (("/release.pdf", "a .pdf address"), ("/pdf-release?id=7", "a PDF without .pdf in its address")):
            show(d, base + path)
            time.sleep(1)
            is_pdf = d.execute_script("return document.contentType") == "application/pdf"
            press_shortcut(d)
            time.sleep(2.5)
            nothing = d.execute_script("return !document.querySelector('.frogbot-frog, [data-frogbot]')")
            report(f"PDF ({kind}): the shortcut does nothing", is_pdf and nothing)
            pdf_tab = d.current_window_handle
            d.switch_to.new_window("tab")
            d.get(f"chrome-extension://{ext}/popup/popup.html")
            time.sleep(0.5)
            got = d.execute_async_script(POPUP_ON_OTHER_TAB)
            report(f"PDF ({kind}): the popup says Frogbot can't read PDFs yet", got["shown"] and got["text"] == PDF_NOTICE, got["text"])
            d.close()
            d.switch_to.window(pdf_tab)
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)


def popup_and_options_checks(ext, base, scheme):
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    d = make_driver(profile, scheme)
    try:
        extension_id(d)
        show(d, f"chrome-extension://{ext}/popup/popup.html")
        wait(d, "!document.getElementById('shortcut').hidden", 5)
        if scheme == "light":
            p = d.execute_script("""return {
              debug: !!document.getElementById('debug'), text: document.body.innerText,
              hint: document.getElementById('shortcut').textContent, version: document.getElementById('version').textContent,
              links: [...document.querySelectorAll('.foot a')].map(a => a.textContent), ai: !!document.getElementById('use-ai'),
              logo: document.querySelector('.head img').naturalWidth > 0 }""")
            report("popup: no debug toggle", not p["debug"] and "Show what Frogbot reads" not in p["text"])
            report(f"popup: shows the shortcut and the version", p["hint"] == f"or press {SHORTCUT}" and p["version"] == f"v{VERSION}", f"{p['hint']!r} {p['version']!r}")
            report("popup: frog header, AI switch, Help and Report a problem", p["logo"] and p["ai"] and p["links"] == ["Help", "Report a problem"], str(p["links"]))
        screenshot(d, f"popup-{scheme}", "document.body")

        show(d, f"chrome-extension://{ext}/pages/options.html")
        screenshot(d, f"options-{scheme}")
        if scheme == "dark":
            return
        o = d.execute_script("""return { heading: [...document.querySelectorAll('h2')].map(h => h.textContent),
          checked: document.getElementById('debug').checked, shortcut: document.querySelector('.shortcut').textContent,
          version: document.querySelector('.version').textContent }""")
        report("options: 'Show what Frogbot reads' under a Developer heading, off by default",
               "Developer" in o["heading"] and o["checked"] is False and o["shortcut"] == SHORTCUT and o["version"] == f"Version {VERSION}", json.dumps(o))
        d.find_element("id", "debug").click()
        time.sleep(0.3)
        stored = d.execute_async_script("const done = arguments[0]; chrome.storage.local.get({debug: false}).then(v => done(v.debug))")
        report("options: the toggle is stored", stored is True)
        show(d, f"{base}/earnings-sample.html")
        press_shortcut(d)
        outlined = wait(d, "document.querySelectorAll('.frogbot-debug-box').length > 5", 10)
        report("options: the next run shows what Frogbot reads (debug outlines)", outlined, str(d.execute_script(STATE)))
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
        show(d, f"chrome-extension://{ext}/pages/options.html")
        d.find_element("id", "debug").click()
        time.sleep(0.3)
        show(d, f"{base}/earnings-sample.html")
        press_shortcut(d)
        wait(d, "!!document.querySelector('.frogbot-frog')", 10)
        time.sleep(1)
        report("options: turned off again, the next run has no outlines", d.execute_script("return document.querySelectorAll('.frogbot-debug-box').length") == 0)
        d.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")
        # "Extension options" and Help reach the right pages.
        show(d, f"chrome-extension://{ext}/popup/popup.html")
        known = {t["id"] for t in targets(d)}
        d.execute_script("chrome.runtime.openOptionsPage()")
        time.sleep(1)
        opened = [t["url"] for t in targets(d) if t["id"] not in known and t["type"] == "page"]
        report("options: chrome.runtime.openOptionsPage opens the options page", any(u.endswith("/pages/options.html") for u in opened), str(opened))
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)


def main():
    sys.path.insert(0, str(ROOT / "tools"))
    import build_demo

    report("pages/demo.html is up to date with the test page (python tools/build_demo.py)",
           build_demo.DEMO.read_text(encoding="utf-8") == build_demo.build())
    profile = tempfile.mkdtemp(prefix="frogbot-ext-")
    try:
        try:
            ext = install_checks(profile)
        except Exception as error:  # no Chrome for Testing (offline first run)
            skip(f"extension checks need Chrome for Testing: {str(error).splitlines()[0][:160]}")
            finish()
            return
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not ext:
        finish()
        return
    server, base = serve_test_pages()
    try:
        groups = [(f, scheme) for scheme in ("light", "dark") for f in (welcome_checks, demo_checks)]
        groups += [(lambda e, s: popup_and_options_checks(e, base, s), "light"), (lambda e, s: popup_and_options_checks(e, base, s), "dark")]
        groups += [(lambda e, s: shortcut_checks(e, base), "light"), (lambda e, s: pdf_checks(e, base), "light")]
        for check, scheme in groups:
            try:
                check(ext, scheme)
            except Exception as error:  # one group's crash is reported, and the rest still run
                report(f"{getattr(check, '__name__', 'checks')} ({scheme}) ran to the end", False, str(error).splitlines()[0][:200])
    finally:
        server.shutdown()
    finish()


if __name__ == "__main__":
    main()
