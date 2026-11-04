const releaseButton = document.getElementById("release");
const debugCheckbox = document.getElementById("debug");
const aiSwitch = document.getElementById("use-ai");
const aiNote = document.getElementById("ai-note");
const message = document.getElementById("message");

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

// Remember "Show what Frogbot reads" between popup openings.
chrome.storage.local.get({ debug: false }).then(({ debug }) => {
  debugCheckbox.checked = debug;
});
debugCheckbox.addEventListener("change", () => {
  chrome.storage.local.set({ debug: debugCheckbox.checked });
});

// "Use on-device AI": on by default. Being on never downloads anything by itself; the model is
// only downloaded when the user clicks the button on the card.
chrome.storage.local.get({ useAI: true }).then(({ useAI }) => {
  aiSwitch.checked = useAI;
});
aiSwitch.addEventListener("change", () => {
  chrome.storage.local.set({ useAI: aiSwitch.checked });
});

// Say so when this computer can't run the on-device model (no Summarizer API, or the browser
// reports it unavailable), so the switch doesn't promise something it can't do.
(async () => {
  let state = "unavailable";
  try {
    if ("Summarizer" in self) {
      state = await Summarizer.availability({
        type: "key-points",
        format: "plain-text",
        length: "short",
        expectedInputLanguages: ["en"],
        outputLanguage: "en",
      });
    }
  } catch {
    state = "unavailable";
  }
  aiNote.hidden = state !== "unavailable";
})();

releaseButton.addEventListener("click", async () => {
  releaseButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      throw new Error("No active tab");
    }

    const target = { tabId: tab.id };
    // Same (isolated) world as the content scripts, so main.js can read the flag.
    await chrome.scripting.executeScript({
      target,
      func: (debug, useAI) => {
        window.__frogbotDebug = debug;
        window.__frogbotUseAI = useAI;
      },
      args: [debugCheckbox.checked, aiSwitch.checked],
    });
    await chrome.scripting.insertCSS({ target, files: ["content/frogbot.css"] });
    await chrome.scripting.executeScript({
      target,
      files: [
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
      ],
    });

    window.close();
  } catch (error) {
    // Restricted pages (chrome://, the Web Store, file:// without access) reject injection.
    console.warn("Frogbot injection failed:", error);
    showMessage("Frogbot can't hop on this page.");
    releaseButton.disabled = false;
  }
});
