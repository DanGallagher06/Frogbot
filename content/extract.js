// Frogbot: finds the page's article content as a list of text blocks.
// Defines window.FrogbotExtract with findMainContainer() and getBlocks().
(() => {
  if (window.FrogbotExtract) return;

  const MAX_BLOCKS = 1500;
  const MIN_CONTAINER_CHARS = 500;
  const MIN_PLAIN_CHARS = 25; // shorter blocks are kept only if they contain a digit
  const MAX_LINK_SHARE = 0.6;
  const MIN_DIV_CHARS = 40; // a text-only <div>/<span> needs this much text to count

  // Checked in order. Wikipedia's article body comes first: it's more specific than
  // its <main>, which also holds the page title bar and tools.
  const CONTAINER_SELECTORS = ["#mw-content-text", "article", "main", "[role='main']", "#content"];

  const BLOCK_TAGS = new Set(["P", "LI", "TD", "TH", "H2", "H3", "H4", "BLOCKQUOTE", "FIGCAPTION", "DD"]);
  // Anything block-level. A <div> or <span> containing none of these is "text-only" and
  // can be a paragraph itself (some sites, e.g. Apple's newsroom, write paragraphs as divs).
  const BLOCK_LEVEL_TAGS = new Set(
    ("P DIV LI UL OL DL DT DD TABLE TR TD TH SECTION ARTICLE ASIDE NAV HEADER FOOTER MAIN " +
      "FORM FIGURE FIGCAPTION BLOCKQUOTE PRE H1 H2 H3 H4 H5 H6").split(" ")
  );
  const BLOCKISH_DISPLAY = new Set(["block", "flex", "grid", "flow-root", "list-item"]);
  const EXCLUDED_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM", "BUTTON"]);
  // Notice and maintenance boxes (Wikipedia's hatnotes, "neutrality disputed" etc.).
  const NOTICE_CLASSES = ["ambox", "ombox", "tmbox", "metadata", "hatnote"];
  // End-of-article sections. Everything after one of these h2s is skipped, up to the next h2.
  const END_SECTION = /^(?:see also|references|notes|citations|sources|further reading|external links|bibliography)$/i;

  // Matched against class names and ids at a word start ("site-nav", "mainMenu", "navbox"),
  // so "lead-in" doesn't match "ad-" and "canvas" doesn't match "nav".
  const JUNK_NAME =
    /(?:^|[\s_-])(?:nav|menu|footer|sidebar|breadcrumb|comment|related|share(?!holder)|social|promo|advert|ad-|sponsor|cookie|newsletter|subscribe|popup|modal|navbox|reflist|references)/;

  // Wikipedia-style citation and edit markers: [1], [a], [note 3], [citation needed], [edit].
  const MARKERS =
    /\[\s*(?:\d+|[a-z]{1,2}|(?:note|nb|n)\s*\d+|citation needed|clarification needed|edit)\s*\]/gi;

  const collapse = (text) => text.replace(/\s+/g, " ").trim();

  function junkName(el) {
    // className is an object on SVG elements; getAttribute works everywhere.
    const names = `${el.getAttribute("class") || ""} ${el.id || ""}`;
    if (names.length < 2) return false;
    // Split camelCase so "relatedStories" reads as "related-stories".
    return JUNK_NAME.test(names.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
  }

  // display:none (on it or any ancestor), visibility:hidden, or zero size.
  function isRendered(el) {
    if (!el.checkVisibility({ visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasEnoughText(el) {
    return (
      el.textContent.length >= MIN_CONTAINER_CHARS &&
      !el.closest("[aria-hidden='true']") &&
      isRendered(el)
    );
  }

  // Visible text. Plain-text elements (most table cells) can use the much cheaper
  // textContent; anything with child elements needs innerText to skip hidden parts.
  const visibleText = (el) =>
    collapse((el.childElementCount ? el.innerText : el.textContent).replace(MARKERS, ""));

  // Score div/section elements by the non-link paragraph text they hold.
  // Each paragraph credits its nearest container fully and the next one up by half.
  function bestScoringContainer() {
    const scores = new Map();
    const credit = (el, points) => {
      if (el) scores.set(el, (scores.get(el) || 0) + points);
    };
    for (const p of document.body.querySelectorAll("p")) {
      let linkChars = 0;
      for (const a of p.querySelectorAll("a")) linkChars += collapse(a.textContent).length;
      const points = collapse(p.textContent).length - linkChars;
      if (points <= 0) continue;
      const parent = p.parentElement && p.parentElement.closest("div, section");
      const grandparent = parent && parent.parentElement && parent.parentElement.closest("div, section");
      credit(parent, points);
      credit(grandparent, points / 2);
    }
    let best = null;
    let bestScore = 0;
    for (const [el, score] of scores) {
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function findMainContainer() {
    for (const selector of CONTAINER_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && hasEnoughText(el)) return el;
    }
    return bestScoringContainer() || document.body;
  }

  function typeOf(el) {
    switch (el.tagName) {
      case "LI":
      case "DD":
        return "list";
      case "TD":
      case "TH":
        return "table";
      case "H2":
      case "H3":
      case "H4":
        return "heading";
      case "BLOCKQUOTE":
        return "quote";
      default:
        // A <p> or <figcaption> takes the type of the structure it sits in.
        if (el.closest("blockquote")) return "quote";
        if (el.closest("td, th")) return "table";
        if (el.closest("li, dd")) return "list";
        return "paragraph";
    }
  }

  const isNotice = (el) =>
    el.getAttribute("role") === "note" || NOTICE_CLASSES.some((c) => el.classList.contains(c));

  // True if any ancestor (below the container) is in `set`.
  function hasAncestorIn(el, set, container) {
    for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
      if (set.has(node)) return true;
    }
    return false;
  }

  function getBlocks(container = findMainContainer()) {
    // One backwards walk over every element, checking tag names in Sets: several times
    // faster than querySelectorAll with long selector lists on big pages. Walking
    // backwards means an element's descendants have all been seen before it.
    const all = container.getElementsByTagName("*");
    const hasBlockInside = new Set();
    const candidates = [];
    const standard = new Set();
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i];
      const tag = el.tagName;
      if (BLOCK_TAGS.has(tag)) {
        candidates.push(el);
        standard.add(el);
      } else if (
        // A div or span qualifies only if it holds no block-level elements and enough text.
        (tag === "DIV" || tag === "SPAN") &&
        !hasBlockInside.has(el) &&
        el.textContent.length >= MIN_DIV_CHARS
      ) {
        candidates.push(el);
      }
      if (BLOCK_LEVEL_TAGS.has(tag) || hasBlockInside.has(el)) hasBlockInside.add(el.parentElement);
    }
    candidates.reverse(); // back to document order

    // Innermost blocks only: an <li> holding a <p> gives way to the <p>.
    const hasInnerBlock = new Set();
    for (const el of standard) {
      for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
        if (standard.has(node)) {
          hasInnerBlock.add(node);
          break;
        }
      }
    }
    // A text-only div/span inside another candidate is part of that block, not a new one.
    const textOnly = new Set();
    function acceptTextOnly(el) {
      if (hasAncestorIn(el, standard, container) || hasAncestorIn(el, textOnly, container)) return false;
      if (el.tagName === "SPAN" && !BLOCKISH_DISPLAY.has(getComputedStyle(el).display)) return false;
      textOnly.add(el);
      return true;
    }

    // Ancestor verdicts are cached: neighbouring blocks share most of their ancestors.
    const excludedCache = new Map();
    function inExcludedArea(el) {
      const chain = [];
      let node = el;
      let verdict = false;
      while (node && node !== container) {
        if (excludedCache.has(node)) {
          verdict = excludedCache.get(node);
          break;
        }
        chain.push(node);
        if (
          EXCLUDED_TAGS.has(node.tagName) ||
          node.getAttribute("aria-hidden") === "true" ||
          junkName(node) ||
          isNotice(node) ||
          (typeof node.className === "string" && node.className.includes("frogbot-"))
        ) {
          verdict = true;
          break;
        }
        node = node.parentElement;
      }
      for (const n of chain) excludedCache.set(n, verdict);
      return verdict;
    }

    const blocks = [];
    let inEndSection = false;
    for (const el of candidates) {
      if (blocks.length >= MAX_BLOCKS) break;
      // End sections: h2s are candidates too, and candidates are in document order,
      // so each h2 switches skipping on or off for everything after it.
      if (el.tagName === "H2") {
        inEndSection = END_SECTION.test(collapse(el.textContent.replace(MARKERS, "")));
      }
      if (inEndSection) continue;

      const isStandard = standard.has(el);
      if (isStandard ? hasInnerBlock.has(el) : !acceptTextOnly(el)) continue;
      if (inExcludedArea(el)) continue;

      // Cheap text checks first: they drop empty and label cells before any layout work.
      const text = visibleText(el);
      if (!text) continue;
      if (isStandard ? text.length < MIN_PLAIN_CHARS && !/\d/.test(text) : text.length < MIN_DIV_CHARS) {
        continue;
      }
      if (!isRendered(el)) continue;

      const links = el.getElementsByTagName("a");
      if (links.length) {
        let linkChars = 0;
        // textContent is close enough for link text and far cheaper than innerText.
        for (const a of links) linkChars += collapse(a.textContent.replace(MARKERS, "")).length;
        if (linkChars / text.length > MAX_LINK_SHARE) continue;
      }

      blocks.push({ element: el, text, type: typeOf(el), index: blocks.length });
    }
    return blocks;
  }

  window.FrogbotExtract = { findMainContainer, getBlocks };
})();
