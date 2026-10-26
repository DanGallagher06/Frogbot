# Frogbot

Frogbot is a Chrome extension with a small top-down frog. Eventually it will hop down a finance
article and highlight the important numbers with its tongue: revenue, EPS, margins, guidance.
It runs only when you click it, has no background script, and uses only the `activeTab` and
`scripting` permissions.

## Load it unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `frogbot` folder.
4. Optional: pin Frogbot from the puzzle-piece menu so the icon is always visible.

After you change any file, click the reload icon on Frogbot's card in `chrome://extensions`.

## Test on the local sample page

1. On Frogbot's **Details** page in `chrome://extensions`, turn on **Allow access to file URLs**.
2. Open `test-pages/earnings-sample.html` in Chrome (drag it into a tab).
3. Click the Frogbot icon, then **Release the frog**.
4. The frog appears at the top centre of the page (`Frogbot here` is logged in the page's
   DevTools console), then hops to the four `data-frogbot-target` elements in order, flicking
   its tongue at each one to highlight it. Press **Escape** at any point to remove the frog and
   all highlights.

### Debug view: "Show what Frogbot reads"

Tick **Show what Frogbot reads** in the popup before releasing the frog (the setting is
remembered). Frogbot then outlines everything it extracted from the page:

- the chosen main content container in solid red
- every text block in a dashed outline coloured by type, with a small `index type` label:
  paragraph grey, list green, table blue, heading purple, quote orange

It also logs a `console.table` of the blocks (index, type, first 60 characters, length) and the
extraction time to the page's DevTools console, followed by a table of the numbers found on
the page by type (plus how many were junk, like phone numbers and footnote markers) and how
long detection took. Escape clears the outlines with the frog.

The sample page is a fictional earnings release for "Lilypad Holdings". It contains real-looking
financial figures plus junk numbers (phone numbers, a street address, a page number, footnote
markers, a copyright year) for the future scorer to ignore.

## Project layout

```
manifest.json        MV3 manifest (activeTab + scripting only)
popup/               The toolbar popup with the "Release the frog" button
content/frog.js      window.Frogbot: the inline-SVG frog, hopping, tongue, show()/remove()
content/main.js      Entry point injected on click: extracts, picks targets, runs the hops
content/frogbot.css  Frog styles (all classes prefixed frogbot-)
content/extract.js   window.FrogbotExtract: main-content detection and text blocks
content/score.js     window.FrogbotScore: sentence splitting and number detection
content/highlight.js window.FrogbotHighlight: mark() and clearAll()
assets/frog.svg      Reference copy of the frog artwork
test-pages/          Local pages for testing
tests/               Number-detection test cases and the browser test runner
tools/               Developer scripts (not part of the extension)
```

## Running the tests

`content/score.js` is plain string code with no page access, so it is tested on its own
against the cases in `tests/detect-cases.js` (number detection and sentence splitting).

- **In the browser:** open `tests/run-tests.html` straight from the file system in Edge or
  Chrome. It shows a summary, accuracy for each number type, and a row per case; failed
  rows show what was expected and what was found. Reload after editing the code or cases.
- **From the command line:** `python tools/run_tests.py` runs the same page in headless
  Edge or Chrome and prints the summary and any failures (exit status 1 if anything fails).
  Set `FROGBOT_BROWSER` to a browser executable if it isn't found automatically.

To add a case, copy one in `tests/detect-cases.js`: give the text, where it came from, and
the numbers you expect. Only the fields you list are checked, but every number found must
be expected.

## Editing the frog artwork

`assets/frog.svg` is the source of truth for the frog. `content/frog.js` holds a copy of it
between the `// FROG_SVG_START` and `// FROG_SVG_END` comments, so the legs can be animated
with CSS. After editing the SVG:

1. Run `python tools/sync_frog_svg.py` (Python 3, no extra packages).
2. Reload Frogbot in `chrome://extensions`.

Keep the leg groups' `frogbot-leg-*` classes, since the hop animation styles them.

## Roadmap

- **Milestone 1: Frog on the page.**
  - Steps 1–3: skeleton, test page and a static frog injected on click (done)
  - Steps 4–5: hopping between fixed targets with leg animation, and a tongue flick that
    highlights each target (done)
  - Step 6: reading the page with `extract.js`, which finds the main content and splits it
    into paragraph, list, table, heading and quote blocks, plus the debug view (done)
  - Step 7: number detection in `score.js`: every number in a text with its type (money,
    percent, basis points, per share, multiple, period, date, year, count), value, currency,
    scale, ranges and negatives, with junk like phone numbers flagged, plus a test suite (done)
- **Milestone 2: Find the numbers.** Extract numbers from the article text and score them by
  importance, ignoring junk such as phone numbers, dates in boilerplate and page numbers.
- **Milestone 3: Tongue highlights.** The frog hops to each important number and highlights it
  with a tongue flick.
