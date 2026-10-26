// Frogbot: entry point, injected after frog.js, highlight.js, extract.js and score.js each time
// "Release the frog" is clicked. The popup sets window.__frogbotDebug first.
(() => {
  const Frogbot = window.Frogbot;
  const Highlight = window.FrogbotHighlight;
  const Extract = window.FrogbotExtract;
  const Score = window.FrogbotScore;

  // Guard against double injection: one frog (and one run) at a time.
  if (!Frogbot || !Highlight || !Extract || !Score || Frogbot.isShowing()) return;

  const debug = window.__frogbotDebug === true;
  const FROG_SIZE = 60;
  const START_CLEARANCE = 10; // gap between the frog's bottom edge and the first block
  const MAX_ABOVE_CONTAINER = 80; // how far above the main container the frog may start
  const SEARCH_STEP = 20; // grid spacing when looking for a clear start spot
  const SITE_HEADERS = "header, [role='banner']";

  let cancelled = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return {
      left: r.left + scrollX,
      top: r.top + scrollY,
      right: r.right + scrollX,
      bottom: r.bottom + scrollY,
      width: r.width,
      height: r.height,
    };
  }

  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const frogRectAt = (spot) => ({
    left: spot.x - FROG_SIZE / 2,
    top: spot.y - FROG_SIZE / 2,
    right: spot.x + FROG_SIZE / 2,
    bottom: spot.y + FROG_SIZE / 2,
  });

  // Score sentences and table rows, pick the best, and turn them into hop targets:
  // one per block or table row, in page order. Each target keeps the units (sentences or
  // row) it was chosen for, for exact-number highlighting later.
  function scoreAndPick(blocks) {
    const started = performance.now();
    const units = Extract.buildUnits(blocks, Score);
    const totalWords = blocks.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0);
    const { chosen } = Score.rankUnits(units, { totalWords });
    const byElement = new Map();
    for (const unit of chosen) {
      if (!byElement.has(unit.element)) {
        byElement.set(unit.element, { element: unit.element, highlight: unit.highlight, units: [] });
      }
      byElement.get(unit.element).units.push(unit);
    }
    return { units, targets: [...byElement.values()], ms: performance.now() - started };
  }

  // With ?frogbot-fixed in the URL, test pages use their hand-placed data-frogbot-target
  // elements instead of scoring (handy for checking the hop animation on its own).
  function fixedTargets() {
    if (!new URLSearchParams(location.search).has("frogbot-fixed")) return null;
    const marked = [...document.querySelectorAll("[data-frogbot-target]")];
    if (!marked.length) return null;
    return marked
      .sort((a, b) => Number(a.dataset.frogbotTarget) - Number(b.dataset.frogbotTarget))
      .map((el) => ({ element: el, highlight: el, units: [] }));
  }

  // ---- Start position ----

  // Site headers: <header>/banner elements outside the article itself
  // (Wikipedia's title bar is a <header> inside <main>, and that's fine to sit on).
  function siteHeaderRects(container) {
    return [...document.querySelectorAll(SITE_HEADERS)]
      .filter((h) => !container.contains(h) && !h.closest("main, article, [role='main']"))
      .map(docRect)
      .filter((r) => r.width > 0 && r.height > 0);
  }

  // Does any visible text (not just extracted blocks) fall inside this document rect?
  // Samples a grid of points with elementsFromPoint and measures the text nodes found.
  // Only possible on screen; off-screen spots rely on the block check alone.
  function coversText(rect) {
    const view = {
      left: rect.left - scrollX,
      top: rect.top - scrollY,
      right: rect.right - scrollX,
      bottom: rect.bottom - scrollY,
    };
    const checked = new Set();
    const range = document.createRange();
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const x = view.left + (view.right - view.left) * fx;
        const y = view.top + (view.bottom - view.top) * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        for (const el of document.elementsFromPoint(x, y)) {
          if (checked.has(el) || el === document.body || el === document.documentElement) continue;
          checked.add(el);
          for (const node of el.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
              if (r.width > 0 && overlaps(r, view)) return true;
            }
          }
        }
      }
    }
    return false;
  }

  // The frog should never start on top of text or the site header.
  // 1. Bottom edge START_CLEARANCE above the first block, centred on the main container
  //    (allowed up to MAX_ABOVE_CONTAINER above the container).
  // 2. Otherwise just left of the first block, using the same rules as hopping.
  // 3. Otherwise the nearest clear spot to (1) above or left of the first block.
  function startPosition(container, blocks) {
    if (!blocks.length) return undefined;
    const box = docRect(container);
    const first = docRect(blocks[0].element);
    const headers = siteHeaderRects(container);
    const blockRects = blocks.map((b) => docRect(b.element));
    const highestTop = Math.max(box.top - MAX_ABOVE_CONTAINER, 0);
    const lowestY = first.top - START_CLEARANCE - FROG_SIZE / 2;

    const isClear = (spot) => {
      const rect = frogRectAt(spot);
      return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        !headers.some((h) => overlaps(rect, h)) &&
        !blockRects.some((b) => overlaps(rect, b)) &&
        !coversText(rect)
      );
    };

    const above = { x: box.left + box.width / 2, y: lowestY };
    const aboveAllowed = above.y - FROG_SIZE / 2 >= highestTop;
    if (aboveAllowed && isClear(above)) return above;

    const left = Frogbot.landingSpotFor(blocks[0].element);
    const leftIsBeside = left.x < first.left;
    if (leftIsBeside && isClear(left)) return left;

    // Search: a grid across the container above the first block, plus a row
    // stretching left of it, nearest to the preferred spot first.
    const spots = [];
    for (let y = lowestY; y - FROG_SIZE / 2 >= highestTop; y -= SEARCH_STEP / 2) {
      for (let x = box.left + FROG_SIZE / 2; x <= box.right - FROG_SIZE / 2; x += SEARCH_STEP) {
        spots.push({ x, y });
      }
    }
    for (let x = first.left - FROG_SIZE / 2 - 30; x >= FROG_SIZE / 2; x -= SEARCH_STEP) {
      spots.push({ x, y: first.top + Math.min(first.height, FROG_SIZE) / 2 });
    }
    const distance = (s) => Math.hypot(s.x - above.x, s.y - above.y);
    spots.sort((a, b) => distance(a) - distance(b));
    const clear = spots.find(isClear);
    if (clear) return clear;

    // Nothing is clear: prefer the spec'd spots anyway, header permitting.
    if (aboveAllowed && !headers.some((h) => overlaps(frogRectAt(above), h))) return above;
    return leftIsBeside ? left : above;
  }

  function addDebugBox(el, className, label) {
    const rect = docRect(el);
    const box = document.createElement("div");
    box.className = `frogbot-debug-box ${className}`;
    box.setAttribute("data-frogbot", "");
    box.setAttribute("aria-hidden", "true");
    box.style.translate = `${rect.left}px ${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    if (label) {
      const tag = document.createElement("span");
      tag.className = "frogbot-debug-label";
      tag.textContent = label;
      box.appendChild(tag);
    }
    document.documentElement.appendChild(box);
  }

  function showDebug(container, blocks, ms, scoring) {
    addDebugBox(container, "frogbot-debug-container", "main container");
    // Each block's best unit score; chosen targets get a solid outline.
    const best = new Map();
    for (const unit of scoring.units) {
      for (const i of unit.blockIndexes) best.set(i, Math.max(best.get(i) ?? -Infinity, unit.score));
    }
    const chosenElements = new Set(scoring.targets.map((t) => t.element));
    for (const b of blocks) {
      const chosen = chosenElements.has(b.element) || [...chosenElements].some((el) => el.contains(b.element));
      const score = best.has(b.index) ? ` · ${best.get(b.index)}` : "";
      addDebugBox(
        b.element,
        `frogbot-debug-${b.type}${chosen ? " frogbot-debug-chosen" : ""}`,
        `${b.index} ${b.type}${score}`
      );
    }
    console.table(
      blocks.map((b) => ({
        index: b.index,
        type: b.type,
        text: b.text.slice(0, 60),
        chars: b.text.length,
      }))
    );
    console.log(`Frogbot: extracted ${blocks.length} blocks in ${ms.toFixed(1)} ms`, container);
    logNumbers(blocks);
    console.table(
      scoring.units.map((u, index) => ({
        index,
        score: u.finalScore ?? u.score,
        chosen: u.chosen ? "yes" : "no",
        reasons: u.reasons.join(", "),
        text: u.text.slice(0, 80),
      }))
    );
    console.log(
      `Frogbot: scored ${scoring.units.length} units and chose ${scoring.targets.length} targets in ${scoring.ms.toFixed(1)} ms`
    );
  }

  // Debug only: what detectNumbers finds across the page (no visual changes yet).
  function logNumbers(blocks) {
    const started = performance.now();
    const counts = {};
    let junk = 0;
    let total = 0;
    for (const block of blocks) {
      // Table cells read bracketed amounts as negatives ("($1.2 million)").
      for (const match of Score.detectNumbers(block.text, { inTable: block.type === "table" })) {
        total += 1;
        if (match.junk) {
          junk += 1;
          continue;
        }
        counts[match.type] = (counts[match.type] || 0) + 1;
      }
    }
    const ms = performance.now() - started;
    const rows = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
    rows.push({ type: "junk", count: junk });
    console.table(rows);
    console.log(`Frogbot: found ${total} numbers (${junk} junk) in ${blocks.length} blocks in ${ms.toFixed(1)} ms`);
  }

  async function run(targets) {
    await Frogbot.bringIntoView();
    // Scrolling can shift the page (lazy-loaded images, collapsing banners), so check
    // the start spot again now that the page is still, and nudge the frog if it moved.
    const settled = startPosition(container, blocks);
    if (settled) Frogbot.placeAt(settled);
    if (!targets.length) {
      Frogbot.say("Nothing to catch here");
      await sleep(3000);
      if (!cancelled) Frogbot.remove();
      return;
    }

    await sleep(500);
    for (const target of targets) {
      if (cancelled) return;
      await Frogbot.hopTo(target.element);
      if (cancelled) return;
      await sleep(200);
      if (cancelled) return;
      // Whole block (or whole table row) for now; exact numbers come in step 9.
      await Frogbot.tongueTo(target.element, () => Highlight.mark(target.highlight));
      if (cancelled) return;
      await sleep(400);
    }
    // The frog stays at the last target; highlights stay until Escape.
  }

  function onKeyDown(event) {
    if (event.key === "Escape") Frogbot.remove();
  }

  console.log("Frogbot here");

  const started = performance.now();
  const container = Extract.findMainContainer();
  const blocks = Extract.getBlocks(container);
  const extractMs = performance.now() - started;

  const scoring = scoreAndPick(blocks);
  const targets = fixedTargets() || scoring.targets;

  Frogbot.show(startPosition(container, blocks));
  if (debug) showDebug(container, blocks, extractMs, scoring);

  document.addEventListener("keydown", onKeyDown, true);
  // Runs on any remove(), so nothing outlives the frog. Debug boxes are
  // data-frogbot elements, so remove() clears them along with the frog.
  Frogbot.onRemove(() => {
    cancelled = true;
    document.removeEventListener("keydown", onKeyDown, true);
    Highlight.clearAll();
  });

  run(targets).catch((error) => {
    // Removing the frog mid-animation rejects with AbortError; that's expected.
    if (!cancelled && error.name !== "AbortError") console.error("Frogbot:", error);
  });
})();
