// Frogbot: the on-device AI summary (milestone 3, step 16). Defines window.FrogbotAI.
//
// Uses the browser's built-in Summarizer API, which runs a small model on the user's own
// computer: no servers, no API keys, no network calls (apart from the browser's one-time model
// download, which only starts when the user clicks the card's button). Everything the model
// writes goes through FrogbotSummary.checkSummary() before it's shown, and anything that fails,
// errors, or takes too long falls back to the rules summary.
(() => {
  if (window.FrogbotAI) return;

  const TIMEOUT_MS = 20000;
  const OPTIONS = {
    type: "key-points",
    format: "plain-text",
    length: "short",
    expectedInputLanguages: ["en"],
    outputLanguage: "en",
  };
  const SHARED_CONTEXT =
    "These are the key sentences and table rows from a financial article. Summarise them using only the figures given. " +
    "Do not add, round, estimate or change any numbers, and do not mention figures that are not in the text.";

  // Tests stand in for the model with window.__frogbotMockSummarizer (headless browsers don't
  // have it). It's only honoured with window.__frogbotTestMode set, and never when running as
  // the real extension: there, content scripts run in their own isolated world, where a web
  // page's globals (a planted mock or test flag) aren't visible, and chrome.runtime.id is set.
  function api() {
    let inExtension = false;
    try {
      inExtension = Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch {
      inExtension = false;
    }
    if (!inExtension && window.__frogbotTestMode === true && window.__frogbotMockSummarizer) return window.__frogbotMockSummarizer;
    return typeof self !== "undefined" && "Summarizer" in self ? self.Summarizer : null;
  }

  // The popup's "Use on-device AI" switch (on unless it's been turned off).
  const enabled = () => window.__frogbotUseAI !== false;

  // "available", "downloadable", "downloading", "unavailable", or "off" (switch off: no API
  // calls at all). A site whose permissions policy blocks the API reads as "unavailable".
  async function availability() {
    if (!enabled()) return "off";
    const Summarizer = api();
    if (!Summarizer) return "unavailable";
    try {
      return await Summarizer.availability(OPTIONS);
    } catch {
      return "unavailable";
    }
  }

  // The model's key points as sentences: bullets and numbering removed, each line ending in a
  // full stop, so the checker can judge them one at a time.
  function tidy(text) {
    return String(text || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•‣·]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .map((line) => (/[.!?]["”')]?$/.test(line) ? line : `${line}.`))
      .join(" ");
  }

  // Writes the summary from the chosen sentences and rows, then checks it. Resolves to
  // { status, summary?, checked?, reason? } where status is "accepted", "rejected", "empty",
  // "error", "aborted" or "timeout". The summarizer is always destroyed afterwards, so its memory
  // is released straight away.
  //
  // Call it synchronously from a click when the model still has to be downloaded:
  // Summarizer.create() needs that user activation, so it's called before anything is awaited.
  // options.onProgress(fraction) follows the download.
  function generate({ sources, facts, signal, onProgress }) {
    const Summarizer = api();
    if (!Summarizer) return Promise.resolve({ status: "error", reason: "the Summarizer API isn't available" });
    const controller = new AbortController();
    const relay = () => controller.abort(signal && signal.reason);
    if (signal) {
      if (signal.aborted) return Promise.resolve({ status: "aborted" });
      signal.addEventListener("abort", relay);
    }
    let created;
    try {
      created = Summarizer.create({
        ...OPTIONS,
        sharedContext: SHARED_CONTEXT,
        signal: controller.signal,
        monitor: onProgress
          ? (m) => m.addEventListener("downloadprogress", (event) => onProgress(Math.max(0, Math.min(1, event.loaded || 0))))
          : undefined,
      });
    } catch (error) {
      created = Promise.reject(error);
    }
    return (async () => {
      let summarizer = null;
      let timer = null;
      try {
        summarizer = await created;
        // The time limit covers writing, not the one-time model download.
        timer = setTimeout(() => controller.abort(new DOMException("Frogbot's AI summary took too long", "TimeoutError")), TIMEOUT_MS);
        const raw = await summarizer.summarize(sources.join("\n"), { signal: controller.signal });
        if (controller.signal.aborted) throw controller.signal.reason || new DOMException("Aborted", "AbortError");
        const text = tidy(raw);
        if (!text) return { status: "empty" };
        const checked = window.FrogbotSummary.checkSummary(text, facts, sources);
        if (checked.rejected) return { status: "rejected", checked };
        return { status: "accepted", checked, summary: { kind: "ai", sentences: checked.sentences, dropped: checked.dropped } };
      } catch (error) {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          return { status: reason && reason.name === "TimeoutError" ? "timeout" : "aborted" };
        }
        return { status: "error", reason: (error && error.message) || String(error) };
      } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", relay);
        if (!summarizer) {
          // An aborted create() can still resolve; release whatever it made.
          Promise.resolve(created)
            .then((late) => late && late.destroy && late.destroy())
            .catch(() => {});
        } else {
          try {
            summarizer.destroy();
          } catch {
            // Already gone.
          }
        }
      }
    })();
  }

  window.FrogbotAI = { availability, generate, tidy, TIMEOUT_MS };
})();
