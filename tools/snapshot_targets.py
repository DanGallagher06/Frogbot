"""Snapshot which targets Frogbot picks on each test page, and show what changed.

For every page in test-pages/ (not test-pages/local/), this renders a temporary copy of the
page with content/extract.js and content/score.js added, in headless Edge or Chrome, runs
extraction and scoring, and records the chosen targets (unit index, score, kind, first 80
characters) in tests/snapshots/<page>.json.

  python tools/snapshot_targets.py           compare with the saved snapshots, print changes
  python tools/snapshot_targets.py --update  save the current picks as the new snapshots

A missing snapshot is created. Exits with status 1 when picks differ from a saved snapshot
(without --update), so a weight change that alters the picks is hard to miss.
Python standard library only.
"""

import html
import json
import pathlib
import re
import subprocess
import sys
import tempfile

from run_tests import find_browser  # same folder

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ROOT / "test-pages"
SNAPSHOTS = ROOT / "tests" / "snapshots"
SCRIPTS = [ROOT / "content" / "extract.js", ROOT / "content" / "score.js"]

RUNNER = """
<script>
(() => {
  const out = document.createElement("pre");
  out.id = "frogbot-snapshot";
  out.hidden = true;
  try {
    const blocks = FrogbotExtract.getBlocks();
    const units = FrogbotExtract.buildUnits(blocks, FrogbotScore);
    const totalWords = blocks.reduce((sum, b) => sum + b.text.split(/\\s+/).length, 0);
    const { chosen } = FrogbotScore.rankUnits(units, { totalWords });
    out.textContent = JSON.stringify(chosen.map((u) => ({
      index: units.indexOf(u),
      score: u.finalScore ?? u.score,
      kind: u.kind,
      text: u.text.slice(0, 80),
    })));
  } catch (error) {
    out.textContent = JSON.stringify({ error: String(error && error.stack || error) });
  }
  document.body.appendChild(out);
})();
</script>
"""


def picks_for(page: pathlib.Path, browser: str) -> list:
    source = page.read_text(encoding="utf-8")
    scripts = "".join(f"<script>\n{s.read_text(encoding='utf-8')}\n</script>\n" for s in SCRIPTS)
    injected = scripts + RUNNER
    copy_html = re.sub(r"</body>", lambda m: injected + m.group(0), source, count=1, flags=re.I)
    if copy_html == source:
        copy_html = source + injected
    with tempfile.TemporaryDirectory() as tmp:
        copy = pathlib.Path(tmp) / page.name
        copy.write_text(copy_html, encoding="utf-8")
        profile = pathlib.Path(tmp) / "profile"
        dom = subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--window-size=1300,1000",
             f"--user-data-dir={profile}", "--dump-dom", copy.as_uri()],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        ).stdout
    found = re.search(r'<pre id="frogbot-snapshot"[^>]*>(.*?)</pre>', dom, re.S)
    if not found:
        sys.exit(f"{page.name}: the page didn't produce a snapshot.")
    data = json.loads(html.unescape(found.group(1)))
    if isinstance(data, dict) and "error" in data:
        sys.exit(f"{page.name}: {data['error']}")
    return data


def describe_changes(old: list, new: list) -> list:
    old_by_text = {p["text"]: p for p in old}
    new_by_text = {p["text"]: p for p in new}
    lines = []
    for p in new:
        before = old_by_text.get(p["text"])
        if before is None:
            lines.append(f"  + now picked   [{p['score']:>3}] {p['kind']:<8} {p['text']}")
        elif before["score"] != p["score"]:
            lines.append(f"  ~ score {before['score']} -> {p['score']:<3} {p['kind']:<8} {p['text']}")
    for p in old:
        if p["text"] not in new_by_text:
            lines.append(f"  - no longer    [{p['score']:>3}] {p['kind']:<8} {p['text']}")
    if not lines and [p["text"] for p in old] != [p["text"] for p in new]:
        lines.append("  (same picks, different order)")
    return lines


def main() -> None:
    update = "--update" in sys.argv[1:]
    browser = find_browser()
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    changed = False
    for page in sorted(PAGES.glob("*.html")):
        picks = picks_for(page, browser)
        snapshot = SNAPSHOTS / f"{page.stem}.json"
        if not snapshot.exists() or update:
            existed = snapshot.exists()
            snapshot.write_text(json.dumps(picks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{page.name}: {'updated' if existed else 'created'} snapshot with {len(picks)} targets")
            continue
        old = json.loads(snapshot.read_text(encoding="utf-8"))
        lines = describe_changes(old, picks)
        if lines:
            changed = True
            print(f"{page.name}: picks changed ({len(old)} -> {len(picks)} targets)")
            print("\n".join(lines))
        else:
            print(f"{page.name}: unchanged ({len(picks)} targets)")
    if changed:
        print("\nIf these changes are intended, run with --update to save them.")
        sys.exit(1)


if __name__ == "__main__":
    main()
