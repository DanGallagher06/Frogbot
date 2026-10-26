"""Copy assets/frog.svg into content/frog.js.

frog.js embeds the frog artwork as an inline SVG string so the legs can be animated
with CSS. This script replaces everything between the // FROG_SVG_START and
// FROG_SVG_END marker lines in frog.js with the current contents of assets/frog.svg.

Usage (from anywhere):  python tools/sync_frog_svg.py
Then reload the extension in chrome://extensions.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG_PATH = ROOT / "assets" / "frog.svg"
JS_PATH = ROOT / "content" / "frog.js"

START = "// FROG_SVG_START"
END = "// FROG_SVG_END"
INDENT = "  "


def svg_for_js(svg: str) -> str:
    svg = svg.strip()
    # Comments and the fixed preview size only matter in the reference file.
    svg = re.sub(r"\s*<!--.*?-->", "", svg, flags=re.S)
    open_tag = re.match(r"<svg\b[^>]*>", svg)
    if not open_tag:
        sys.exit("frog.svg doesn't start with an <svg> tag.")
    tag = re.sub(r'\s(?:width|height)="[^"]*"', "", open_tag.group(0))
    tag = tag[:-1] + ' focusable="false">'
    svg = tag + svg[open_tag.end():]
    if "`" in svg or "${" in svg:
        sys.exit("frog.svg contains ` or ${, which would break the JavaScript template string.")
    lines = svg.splitlines()
    return "\n".join([lines[0]] + [INDENT * 2 + line for line in lines[1:]])


def main() -> None:
    svg = svg_for_js(SVG_PATH.read_text(encoding="utf-8"))
    js = JS_PATH.read_text(encoding="utf-8")

    lines = js.split("\n")
    try:
        start = next(i for i, line in enumerate(lines) if line.strip().startswith(START))
        end = next(i for i, line in enumerate(lines) if line.strip().startswith(END))
    except StopIteration:
        sys.exit(f"Couldn't find the {START} / {END} markers in {JS_PATH}.")
    if end <= start:
        sys.exit(f"{END} must come after {START} in {JS_PATH}.")

    generated = f"{INDENT}const FROG_SVG = `{svg}`;"
    new_js = "\n".join(lines[: start + 1] + [generated] + lines[end:])

    if new_js == js:
        print("frog.js is already up to date.")
        return
    JS_PATH.write_text(new_js, encoding="utf-8", newline="\n")
    print(f"Updated {JS_PATH.relative_to(ROOT)} from {SVG_PATH.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
