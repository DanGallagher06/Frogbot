// Frogbot: "release the frog" on a tab, shared by the popup's button, the keyboard shortcut
// (background.js) and the built-in demo page, so they all run the same files in the same order.
// Defines globalThis.FrogbotRelease. Plain script: the popup loads it with a <script> tag and the
// service worker with importScripts().
(() => {
  if (globalThis.FrogbotRelease) return;

  // The content scripts, in order. main.js runs the frog; the others define the globals it uses
  // (and skip themselves if already defined, so releasing again only re-runs main.js).
  const FILES = [
    "content/frog.js",
    "content/highlight.js",
    "content/extract.js",
    "content/score.js",
    "content/facts.js",
    "content/summary.js",
    "content/ai-summary.js",
    "content/xlsx.js",
    "content/card.js",
    "content/main.js",
  ];
  const CSS = ["content/frogbot.css"];

  // The stored settings: "Show what Frogbot reads" (options page) and "Use on-device AI" (popup).
  const DEFAULTS = { debug: false, useAI: true };
  const settings = () => chrome.storage.local.get(DEFAULTS);

  // Is the tab showing a PDF? Its address ends in .pdf, or its document is one (a PDF served
  // from an address without .pdf). Frogbot can't read PDFs yet.
  async function isPdf(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && /\.pdf$/i.test(new URL(tab.url).pathname)) return true;
    } catch {
      // No address to go on (or no access to it): ask the document below.
    }
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.contentType });
      return Boolean(result && result.result === "application/pdf");
    } catch {
      return false;
    }
  }

  // Injects Frogbot into a tab. Resolves to { ok: true }, { ok: false, reason: "pdf" } for a
  // PDF, or { ok: false, error }: pages Frogbot can't run on (the browser's own pages, the web
  // store, file:// without access, other extensions' pages) reject the injection.
  async function release(tabId) {
    if (await isPdf(tabId)) return { ok: false, reason: "pdf" };
    try {
      const { debug, useAI } = await settings();
      const target = { tabId };
      // Same (isolated) world as the content scripts, so main.js can read the flags.
      await chrome.scripting.executeScript({
        target,
        func: (debugOn, aiOn) => {
          window.__frogbotDebug = debugOn;
          window.__frogbotUseAI = aiOn;
        },
        args: [debug, useAI],
      });
      await chrome.scripting.insertCSS({ target, files: CSS });
      await chrome.scripting.executeScript({ target, files: FILES });
      return { ok: true };
    } catch (error) {
      // Frogbot's own demo page can't be injected into (it's an extension page), but runs
      // Frogbot itself when asked.
      if (await askDemo(tabId)) return { ok: true };
      console.warn("Frogbot can't run on this page:", error && error.message ? error.message : error);
      return { ok: false, error };
    }
  }

  // Asks a demo page in that tab to release the frog; true if one did.
  async function askDemo(tabId) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "frogbot-release", tabId });
      return Boolean(reply && reply.ok);
    } catch {
      return false; // no extension page listening
    }
  }

  globalThis.FrogbotRelease = { FILES, CSS, DEFAULTS, settings, release };
})();
