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

The sample page is a fictional earnings release for "Lilypad Holdings". It contains real-looking
financial figures plus junk numbers (phone numbers, a street address, a page number, footnote
markers, a copyright year) for the future scorer to ignore.

## Project layout

```
manifest.json        MV3 manifest (activeTab + scripting only)
popup/               The toolbar popup with the "Release the frog" button
content/frog.js      window.Frogbot: the inline-SVG frog, hopping, tongue, show()/remove()
content/main.js      Entry point injected on click: finds targets, runs the hop sequence
content/frogbot.css  Frog styles (all classes prefixed frogbot-)
content/extract.js   Placeholder: number extraction
content/score.js     Placeholder: number scoring
content/highlight.js window.FrogbotHighlight: mark() and clearAll()
assets/frog.svg      Reference copy of the frog artwork
test-pages/          Local pages for testing
```

## Roadmap

- **Milestone 1: Frog on the page.**
  - Steps 1–3: skeleton, test page and a static frog injected on click (done)
  - Steps 4–5: hopping between fixed targets with leg animation, and a tongue flick that
    highlights each target (done)
- **Milestone 2: Find the numbers.** Extract numbers from the article text and score them by
  importance, ignoring junk such as phone numbers, dates in boilerplate and page numbers.
- **Milestone 3: Tongue highlights.** The frog hops to each important number and highlights it
  with a tongue flick.
