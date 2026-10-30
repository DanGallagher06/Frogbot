"""Record docs/demo.gif and the README stills from the fictional test page.

    pip install selenium pillow      (only this script needs them)
    python tools/record_demo.py

Runs Frogbot on test-pages/earnings-sample.html in headless Edge and writes:

- docs/demo.gif: the frog hopping down the page with its tongue flicks and highlights, the
  card drop, and a click on the card's Revenue row (about 15 seconds, played back slightly
  faster than real time, 800px wide)
- docs/highlights.png: a close-up of the opening paragraph's highlights
- docs/card-light.png and docs/card-dark.png: the card in light and dark mode

Only the test page is recorded, so no third-party content ends up in the repo.
"""

import base64
import io
import pathlib
import time

from PIL import Image
from selenium import webdriver
from selenium.webdriver.edge.options import Options

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
URL = (ROOT / "test-pages" / "earnings-sample.html").as_uri()
CSS = (ROOT / "content" / "frogbot.css").read_text(encoding="utf-8")
SCRIPTS = ("frog", "highlight", "extract", "score", "facts", "summary", "card", "main")  # popup.js's order
JS = "\n".join((ROOT / "content" / f"{name}.js").read_text(encoding="utf-8") for name in SCRIPTS)
CARD = "document.querySelector('.frogbot-card-host').shadowRoot"

GIF_SIZE = (800, 560)
GIF_SECONDS = 15  # playback is sped up to fit
GIF_COLOURS = 128
MAX_GIF_BYTES = 4_800_000


def open_page(width, height, scale=1, scheme="light", reduced=False):
    """Headless Edge on the test page, with Frogbot's CSS added as the extension would."""
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--hide-scrollbars")
    options.add_argument("--window-size=1200,1000")
    driver = webdriver.Edge(options=options)
    driver.execute_cdp_cmd(
        "Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False}
    )
    driver.execute_cdp_cmd(
        "Emulation.setEmulatedMedia",
        {
            "features": [
                {"name": "prefers-color-scheme", "value": scheme},
                {"name": "prefers-reduced-motion", "value": "reduce" if reduced else "no-preference"},
            ]
        },
    )
    driver.get(URL)
    time.sleep(0.8)
    driver.execute_script("const s = document.createElement('style'); s.textContent = arguments[0]; document.head.appendChild(s);", CSS)
    return driver


def grab(driver):
    data = driver.execute_cdp_cmd("Page.captureScreenshot", {"format": "png"})["data"]
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


def card_delivered(driver):
    return driver.execute_script(
        "const h = document.querySelector('.frogbot-card-host');"
        "if (!h || window.__frogbotRunning !== false) return false;"
        "const card = h.shadowRoot.querySelector('.card');"
        "return !card.classList.contains('measuring') && !card.getAnimations().length;"
    )


def record(driver, seconds, frames, until=None):
    end = time.time() + seconds
    while time.time() < end:
        frames.append((time.time(), grab(driver)))
        if until and until():
            break


def wait_for_card(driver, timeout=60):
    end = time.time() + timeout
    while time.time() < end and not card_delivered(driver):
        time.sleep(0.2)


def save_gif(frames, path):
    # Durations from the real timings, identical neighbours merged, then sped up to fit.
    merged = []
    for i, (when, image) in enumerate(frames):
        following = frames[i + 1][0] if i + 1 < len(frames) else when + 1.2
        ms = max(20, round((following - when) * 1000))
        if merged and merged[-1][0].tobytes() == image.tobytes():
            merged[-1][1] += ms
        else:
            merged.append([image, ms])
    speed = max(1.0, sum(ms for _, ms in merged) / 1000 / GIF_SECONDS)
    for item in merged:
        item[1] = max(20, round(item[1] / speed))

    def write(items):
        palette = items[len(items) // 2][0].quantize(colors=GIF_COLOURS, method=Image.Quantize.MEDIANCUT)
        images = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image, _ in items]
        images[0].save(path, save_all=True, append_images=images[1:], duration=[ms for _, ms in items], loop=0, optimize=True, disposal=1)

    write(merged)
    step = 2
    while path.stat().st_size > MAX_GIF_BYTES and step < 6:  # thin out frames until it fits
        write([[merged[i][0], sum(ms for _, ms in merged[i : i + step])] for i in range(0, len(merged), step)])
        step += 1
    seconds = sum(ms for _, ms in merged) / 1000
    print(f"{path.relative_to(ROOT)}: {len(merged)} frames, {seconds:.1f}s at {speed:.2f}x, {path.stat().st_size / 1e6:.2f} MB")


def record_gif():
    driver = open_page(*GIF_SIZE)
    frames = []
    try:
        record(driver, 0.8, frames)
        driver.execute_script(JS)
        record(driver, 40, frames, until=lambda: card_delivered(driver))
        record(driver, 1.4, frames)
        # Click the card's Revenue row: the page jumps back to the figure and pulses it.
        driver.execute_script(f"[...{CARD}.querySelectorAll('tbody tr')].find(tr => tr.cells[0].textContent === 'Revenue').click()")
        record(driver, 2.6, frames)
    finally:
        driver.quit()
    save_gif(frames, DOCS / "demo.gif")


def save_card_still(scheme, name):
    driver = open_page(1000, 760, scale=2, scheme=scheme, reduced=True)
    try:
        driver.execute_script(JS)
        wait_for_card(driver)
        left, top, right, bottom = driver.execute_script(
            f"const r = {CARD}.querySelector('.card').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]"
        )
        # Just the card and the frog perched on it: hide the article behind them.
        driver.execute_script("document.body.style.setProperty('visibility', 'hidden', 'important')")
        time.sleep(0.2)
        box = (int(left * 2) - 24, int(top * 2) - 110, int(right * 2) + 24, int(bottom * 2) + 24)
        grab(driver).crop(box).save(DOCS / name)
        print(f"docs/{name}")
    finally:
        driver.quit()


def save_highlights_still():
    driver = open_page(1000, 760, scale=2, reduced=True)
    try:
        driver.execute_script(JS)
        wait_for_card(driver)
        # The opening paragraph and its highlights, without the frog and card.
        driver.execute_script(
            "document.querySelectorAll('[data-frogbot]').forEach(e => e.style.setProperty('visibility', 'hidden', 'important'));"
            "document.querySelector('[data-frogbot-target=\"1\"]').scrollIntoView({block: 'center'})"
        )
        time.sleep(0.4)
        left, top, right, bottom = driver.execute_script(
            "const r = document.querySelector('[data-frogbot-target=\"1\"]').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]"
        )
        grab(driver).crop((int(left * 2) - 30, int(top * 2) - 24, int(right * 2) + 30, int(bottom * 2) + 24)).save(DOCS / "highlights.png")
        print("docs/highlights.png")
    finally:
        driver.quit()


def main():
    DOCS.mkdir(exist_ok=True)
    record_gif()
    save_card_still("light", "card-light.png")
    save_card_still("dark", "card-dark.png")
    save_highlights_still()


if __name__ == "__main__":
    main()
