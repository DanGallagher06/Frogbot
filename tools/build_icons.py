"""Render Frogbot's toolbar and extension icons from their SVG sources.

    python tools/build_icons.py

assets/icon.svg becomes assets/icon-32.png, icon-48.png and icon-128.png; the simplified
assets/icon-small.svg becomes assets/icon-16.png. Rendering uses a headless Edge or Chrome
(the same search as tools/run_tests.py; set FROGBOT_BROWSER to override), so the PNGs match
what the browser draws. Python standard library only.
"""

import pathlib
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from run_tests import find_browser  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SIZES = {16: "icon-small.svg", 32: "icon.svg", 48: "icon.svg", 128: "icon.svg"}


def png_size(path: pathlib.Path) -> tuple:
    data = path.read_bytes()
    return struct.unpack(">II", data[16:24])


def render(browser: str, svg: pathlib.Path, size: int, out: pathlib.Path, work: pathlib.Path) -> None:
    page = work / f"icon-{size}.html"
    page.write_text(
        f'<!doctype html><html><body style="margin:0;background:transparent">'
        f'<img src="{svg.as_uri()}" width="{size}" height="{size}" style="display:block"></body></html>',
        encoding="utf-8",
    )
    subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={size},{size}",
            f"--user-data-dir={work / 'profile'}",
            f"--screenshot={out}",
            page.as_uri(),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    if png_size(out) != (size, size):
        sys.exit(f"{out.name}: expected {size}x{size}, got {png_size(out)}")


def main() -> None:
    browser = find_browser()
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for size, source in SIZES.items():
            out = ASSETS / f"icon-{size}.png"
            render(browser, ASSETS / source, size, out, work)
            print(f"{out.relative_to(ROOT)}: {size}x{size} from {source}")


if __name__ == "__main__":
    main()
