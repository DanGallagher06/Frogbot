// Frogbot: entry point, injected after frog.js and highlight.js each time
// "Release the frog" is clicked.
(() => {
  const Frogbot = window.Frogbot;
  const Highlight = window.FrogbotHighlight;

  // Guard against double injection: one frog (and one run) at a time.
  if (!Frogbot || !Highlight || Frogbot.isShowing()) return;

  const MAX_FALLBACK_TARGETS = 4;
  const MIN_PARAGRAPH_CHARS = 80;
  const EXCLUDED_AREAS =
    "nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary']";

  let cancelled = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  // Test pages mark targets explicitly. Elsewhere, fall back to the first few
  // substantial paragraphs of the main content (temporary until extract.js exists).
  function findTargets() {
    const marked = [...document.querySelectorAll("[data-frogbot-target]")];
    if (marked.length) {
      return marked.sort(
        (a, b) => Number(a.dataset.frogbotTarget) - Number(b.dataset.frogbotTarget)
      );
    }

    const scope =
      document.querySelector("main, [role='main'], article") || document.body;
    return [...scope.querySelectorAll("p")]
      .filter(
        (p) =>
          !p.closest(EXCLUDED_AREAS) &&
          p.textContent.replace(/\s+/g, " ").trim().length >= MIN_PARAGRAPH_CHARS &&
          isVisible(p)
      )
      .slice(0, MAX_FALLBACK_TARGETS);
  }

  async function run() {
    const targets = findTargets();

    if (!targets.length) {
      Frogbot.say("Nothing to catch here");
      await sleep(3000);
      if (!cancelled) Frogbot.remove();
      return;
    }

    await sleep(500);
    for (const target of targets) {
      if (cancelled) return;
      await Frogbot.hopTo(target);
      if (cancelled) return;
      await sleep(200);
      if (cancelled) return;
      await Frogbot.tongueTo(target, Highlight.mark);
      if (cancelled) return;
      await sleep(400);
    }
    // The frog stays at the last target; highlights stay until Escape.
  }

  function onKeyDown(event) {
    if (event.key === "Escape") Frogbot.remove();
  }

  console.log("Frogbot here");
  Frogbot.show();

  document.addEventListener("keydown", onKeyDown, true);
  // Runs on any remove(), so nothing outlives the frog.
  Frogbot.onRemove(() => {
    cancelled = true;
    document.removeEventListener("keydown", onKeyDown, true);
    Highlight.clearAll();
  });

  run().catch((error) => {
    // Removing the frog mid-animation rejects with AbortError; that's expected.
    if (!cancelled && error.name !== "AbortError") console.error("Frogbot:", error);
  });
})();
