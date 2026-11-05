"""Build pages/demo.html, Frogbot's built-in demo, from the test page.

The demo is the fictional Lilypad Holdings earnings release (test-pages/earnings-sample.html),
packaged inside the extension so it works without "Allow access to file URLs". This copies the
test page and adds the demo's bar (a "Release the frog" button), Frogbot's stylesheet and the
scripts that run it (pages/demo.js loads the same content scripts, in the same order, as a
normal release). The test page stays the test fixture; rebuild the demo after changing it:

    python tools/build_demo.py           write pages/demo.html
    python tools/build_demo.py --check   exit 1 if pages/demo.html is out of date

Python standard library only.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "test-pages" / "earnings-sample.html"
DEMO = ROOT / "pages" / "demo.html"

NOTICE = "<!-- Built from test-pages/earnings-sample.html by tools/build_demo.py; don't edit by hand. -->\n"
HEAD = """  <link rel="icon" href="../assets/icon-32.png">
  <link rel="stylesheet" href="../content/frogbot.css">
  <link rel="stylesheet" href="demo.css">
"""
BAR = """  <aside class="demo-bar" aria-label="Frogbot demo">
    <img src="../assets/icon.svg" alt="">
    <p><strong>Frogbot demo.</strong> A made-up earnings release to try Frogbot on.</p>
    <button id="demo-release" class="demo-button" type="button">Release the frog</button>
    <span class="demo-hint" hidden>or press <kbd class="shortcut"></kbd></span>
  </aside>
"""
SCRIPTS = """  <script src="../shared/release.js"></script>
  <script src="demo.js"></script>
"""


def build() -> str:
    html = SOURCE.read_text(encoding="utf-8")
    html = html.replace("<!doctype html>\n", "<!doctype html>\n" + NOTICE, 1)
    html = re.sub(r"<title>(.*?)</title>", r"<title>Frogbot demo · \1</title>", html, count=1)
    html = html.replace("</head>", HEAD + "</head>", 1)
    html = re.sub(r"(<body[^>]*>\n)", lambda m: m.group(1) + BAR, html, count=1)
    html = html.replace("</body>", SCRIPTS + "</body>", 1)
    return html


def main() -> None:
    html = build()
    if "--check" in sys.argv[1:]:
        current = DEMO.read_text(encoding="utf-8") if DEMO.exists() else ""
        if current != html:
            sys.exit("pages/demo.html is out of date: run python tools/build_demo.py")
        print("pages/demo.html is up to date")
        return
    DEMO.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {DEMO.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
