// Frogbot: highlighting what the frog catches.
// Exact figures are wrapped in <mark class="frogbot-num frogbot-num-<colour>"> elements, which
// stay invisible until revealed, so they can all be placed before the tongue flicks and shown
// one by one. Whole blocks or table rows get the frogbot-hl class (the fallback when a figure
// can't be mapped). pulse() draws attention back to a caught figure (from the stat card).
// clearAll() puts the page back exactly as it was.
(() => {
  if (window.FrogbotHighlight) return;

  const marked = new Map(); // element with frogbot-hl -> its original class attribute (or null)
  const marks = new Set(); // every <mark> we added
  const pulses = new Map(); // element -> { original class attribute, timer } while pulsing
  const PULSE_MS = 1300; // two ~600ms glows (see frogbot.css)
  const OUTLINE_MS = 1500;
  // Never touch text in form fields, editable areas, or Frogbot's own elements.
  const NO_EDIT = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-frogbot]";
  const COLOUR = {
    money: "money",
    perShare: "money",
    percent: "percent",
    basisPoints: "percent",
    period: "period",
    date: "period",
    year: "period",
    multiple: "count",
    count: "count",
  };

  // Whole element (block or table row).
  function mark(element) {
    if (!marked.has(element)) marked.set(element, element.getAttribute("class"));
    element.classList.add("frogbot-hl");
  }

  // Wrap several figures at once. items: [{ ranges, type }] where each Range sits inside one
  // text node. Wrapping goes from the end of the page backwards, so splitting a text node never
  // shifts the offsets of ranges still waiting to be wrapped. Returns, per item, its (hidden)
  // marks, or null if it couldn't be wrapped (no ranges, or inside an editable area).
  function prepare(items) {
    const results = items.map(() => []);
    const pieces = [];
    items.forEach((item, index) => {
      const ok =
        item.ranges &&
        item.ranges.length &&
        item.ranges.every((r) => {
          const parent = r.startContainer.parentElement;
          return parent && !parent.closest(NO_EDIT);
        });
      if (!ok) results[index] = null;
      else for (const range of item.ranges) pieces.push({ range, index, type: item.type });
    });
    pieces.sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range));
    for (const { range, index, type } of pieces) {
      if (!results[index]) continue;
      const el = document.createElement("mark");
      el.className = `frogbot-num frogbot-num-${COLOUR[type] || "count"}`;
      range.surroundContents(el);
      marks.add(el);
      results[index].unshift(el); // pieces were wrapped last-first; keep them in page order
    }
    return results;
  }

  function reveal(els) {
    for (const el of els || []) el.classList.add("frogbot-num-on");
  }

  // One figure, shown straight away: block = { element, text }, match from detectNumbers on
  // block.text. Returns its marks, or null if it couldn't be mapped or wrapped.
  function markNumber(block, match) {
    const ranges = window.FrogbotExtract.rangesFor(block, match.start, match.end);
    const [els] = prepare([{ ranges, type: match.type }]);
    reveal(els);
    return els;
  }

  // Puts an element's class attribute back exactly (including "no attribute") once our
  // class is removed, unless the page has changed the classes meanwhile.
  function restoreClass(el, original, cls) {
    el.classList.remove(cls);
    const tokens = (s) => (s || "").split(/\s+/).filter(Boolean).join(" ");
    if (original === null && !el.classList.length) el.removeAttribute("class");
    else if (original !== null && tokens(el.getAttribute("class")) === tokens(original)) {
      el.setAttribute("class", original);
    }
  }

  // A short glow, twice, on a figure's marks; or, with options.outline (reduced motion, or a
  // block whose marks have gone), a static outline. Pulsing again restarts it.
  function pulse(els, options = {}) {
    const cls = options.outline ? "frogbot-outline" : "frogbot-pulse";
    for (const el of els || []) {
      if (!el || !el.isConnected) continue;
      const current = pulses.get(el);
      if (current) {
        clearTimeout(current.timer);
        el.classList.remove("frogbot-pulse", "frogbot-outline");
      }
      const original = current ? current.original : el.getAttribute("class");
      void el.offsetWidth; // restart the animation
      el.classList.add(cls);
      const timer = setTimeout(() => {
        pulses.delete(el);
        restoreClass(el, original, cls);
      }, options.outline ? OUTLINE_MS : PULSE_MS);
      pulses.set(el, { original, timer });
    }
  }

  // Ends every pulse and outline now (jumping to another figure, or clearing up).
  function endPulses() {
    for (const [el, { original, timer }] of pulses) {
      clearTimeout(timer);
      el.classList.remove("frogbot-pulse");
      restoreClass(el, original, "frogbot-outline");
    }
    pulses.clear();
  }

  function clearAll() {
    endPulses();

    // Unwrap every mark and merge the text nodes it split, so the HTML is exactly as before.
    const parents = new Set();
    for (const el of marks) {
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parents.add(parent);
    }
    marks.clear();
    for (const parent of parents) parent.normalize();

    // Remove frogbot-hl, restoring the class attribute exactly (including "no attribute").
    for (const [el, original] of marked) restoreClass(el, original, "frogbot-hl");
    marked.clear();
  }

  window.FrogbotHighlight = { mark, prepare, reveal, markNumber, pulse, endPulses, clearAll };
})();
