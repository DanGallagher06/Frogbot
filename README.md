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
4. The frog appears just above the article (`Frogbot here` is logged in the page's DevTools
   console), then hops down the page to the sentences and table rows with the most important
   numbers, flicking its tongue at each one to highlight it. Press **Escape** at any point to
   remove the frog and all highlights.

Add `?frogbot-fixed` to the test page's URL to make the frog hop to the four hand-placed
`data-frogbot-target` elements instead of scored targets (useful for checking the animation).

### Debug view: "Show what Frogbot reads"

Tick **Show what Frogbot reads** in the popup before releasing the frog (the setting is
remembered). Frogbot then outlines everything it extracted from the page:

- the chosen main content container in solid red
- every text block in a dashed outline coloured by type, with a small `index type · score`
  label (the best score of the block's sentences or table row): paragraph grey, list green,
  table blue, heading purple, quote orange
- the chosen targets with a solid outline instead of a dashed one

It also logs a `console.table` of the blocks (index, type, first 60 characters, length) and the
extraction time to the page's DevTools console, followed by a table of the numbers found on
the page by type (plus how many were junk, like phone numbers and footnote markers) and how
long detection took, then a table of every scored sentence and table row (score, whether it
was chosen, and the reasons) and how long scoring took. Escape clears the outlines with the frog.

The sample page is a fictional earnings release for "Lilypad Holdings". It contains real-looking
financial figures plus junk numbers (phone numbers, a street address, a page number, footnote
markers, a copyright year) for the future scorer to ignore.

`test-pages/captions-and-collapsed.html` is a news-style article for checking what extraction
skips: photo captions and credits without `<figcaption>`, a key-points box, a collapsed AI
summary, a closed `<details>` and a squashed hidden box. Each block is marked
`data-expect="keep"` or `"skip"`; tick **Show what Frogbot reads** to compare.

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
tests/               Detection, scoring and held-out test cases, the browser test runner,
                     and snapshots of the targets picked on each test page
tools/               Developer scripts (not part of the extension)
```

## Running the tests

`content/score.js` is plain string code with no page access, so it is tested on its own
against the cases in `tests/detect-cases.js` and `tests/holdout-cases.js` (number detection
and sentence splitting; see "Measuring accuracy honestly" below).

- **In the browser:** open `tests/run-tests.html` straight from the file system in Edge or
  Chrome. It shows a summary, accuracy for each number type, and a row per case; failed
  rows show what was expected and what was found. Reload after editing the code or cases.
The page has three sections: the development detection cases, the scoring cases
(`tests/score-cases.js`) and the held-out set.

- **From the command line:** `python tools/run_tests.py` runs the same page in headless
  Edge or Chrome and prints the summary and any failures for each set (exit status 1 if
  anything fails).
  Set `FROGBOT_BROWSER` to a browser executable if it isn't found automatically.

To add a case, copy one in `tests/detect-cases.js`: give the text, where it came from, and
the numbers you expect. Only the fields you list are checked, but every number found must
be expected.

## How the frog chooses targets

`extract.js` turns the page's blocks into units: each sentence of a paragraph, list item or
quote, and each table row (its cells joined with " | ", plus the column headers above its
figures). `score.js` scores every unit with `scoreUnit()` and picks targets with
`pickTargets()`:

- Points for money, percentages and per-share figures, a change word near a number, finance
  terms, periods, comparisons and context (bold text, a heading with a number, or a table row
  without column headers; rows with headers get the period point from them instead), and
  penalties for units with only counts or years, only junk, or over 60 words, and for old
  figures: a unit whose newest explicit year is 5-9 years older than the newest year on the
  page loses 2, and 10 or more years older loses 4 (not when it names a current period such
  as "Q3", or has no year). Every weight, and the topic list below, is in the `WEIGHTS`
  object at the top of `score.js`.
- Units below `MIN_SCORE` are dropped. Ties go to prose sentences over table rows, then to
  units with more distinct positive signals, then to page order.
- While picking, a unit whose main figure was already picked loses points and has to compete
  again (so a figure isn't caught twice). For variety, a unit also loses 2 for each chosen
  unit already on its topic (-2, -4, -6...). Topics are revenue, gross profit, operating
  income, net income, EPS, margin, guidance, cash flow, debt, dividends/buybacks,
  growth/estimates and other. A sentence is guidance only when it's the company's own
  forward-looking statement ("Lilypad expects", "full-year guidance", "next quarter", or
  "revenue is expected to"); analysts' expectations are growth/estimates. The first table row
  on a named topic is exempt, so a headline row like an infobox "Revenue" isn't crowded out
  by sentences. The topic penalty only reorders the queue; it never drops a unit below
  `MIN_SCORE` and isn't included in the displayed score.
- About one target per 100 words of article (3 to 12, and at least 5 when 5 or more units
  pass the threshold), at most 2 from one block and 4 rows from one table, then sorted into
  page order so the frog only hops downward.

After changing weights, run `python tools/snapshot_targets.py`. It prints how the picks
changed on each test page compared with `tests/snapshots/`; run it with `--update` to save
the new picks once you're happy with them.

## Measuring accuracy honestly

There are two sets of test cases, and the runner reports them separately:

- **Development set** (`tests/detect-cases.js`): the cases `score.js` was built and fixed
  against. Every time a bug turns up, a case for it goes here and the code is changed until
  it passes. That makes this set's accuracy close to 100% by construction, so it shows that
  known problems stay fixed, not how well detection works on pages it hasn't seen.
- **Held-out set** (`tests/holdout-cases.js`): cases written by hand from pages that were
  never used in development, and never used as a reason to change the code. Its accuracy is
  the honest estimate of how Frogbot does on a new article.

To add held-out cases:

1. Pick a page that hasn't been used for development (not the test pages, the Wikipedia
   Nvidia article, the BBC data centre article, or the Nvidia and Apple releases used so far).
2. Copy sentences or table cells into `tests/holdout-cases.js` in the same format as the
   development cases, with the page's URL as `source`, and write down the numbers you expect
   *before* running the tests.
3. Run the tests and record the held-out accuracy. If a case fails, don't change the code to
   fix that case. Write a new development case that shows the same problem, fix against that,
   and leave the held-out case untouched. Then add fresh held-out cases from another new page
   from time to time, since the old ones slowly stop being "unseen".

The three entries already in `holdout-cases.js` are format examples marked `example: true`;
the runner skips them, so it reports "No held-out cases yet" until real ones are added.

## Known issues

- **Pages that scroll inside a box.** Some sites (currently BBC) scroll the article inside
  an inner container instead of scrolling the page itself, sometimes switching to that only
  after the frog appears. The frog is positioned on the page, so its scroll-in check can fail
  there. It still lands next to its targets. To be handled in a later step.
- **Start position on those pages.** The same layout switch occasionally moves BBC's first
  paragraph under the frog after it has appeared, so the frog can end up sitting on text.

## Backlog

- Detect numbers during extraction, so scoring doesn't compute them a second time. Scoring
  takes about 30ms on a big earnings release (the Nvidia release), which is acceptable for now.
- "to" and "from" are loose change words (they match "returned $24.3 billion to
  shareholders" as readily as "rose to $1.2 billion"). Consider counting them only in patterns
  like "from X to Y" or right after a change verb ("rose to", "fell from").
- Tighten the passive "is expected to" guidance rule to require a company subject. At the
  moment it can tag industry-wide forecasts as guidance (for example BBC's "the tech industry
  is expected to spend a combined $765bn" sentence).

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
  - Step 8: scoring sentences and table rows and choosing the frog's targets (done)
- **Milestone 2: Find the numbers.** Extract numbers from the article text and score them by
  importance, ignoring junk such as phone numbers, dates in boilerplate and page numbers.
- **Milestone 3: Tongue highlights.** The frog hops to each important number and highlights it
  with a tongue flick.
