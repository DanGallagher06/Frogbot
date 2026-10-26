const releaseButton = document.getElementById("release");
const debugCheckbox = document.getElementById("debug");
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
      func: (debug) => {
        window.__frogbotDebug = debug;
      },
      args: [debugCheckbox.checked],
    });
    await chrome.scripting.insertCSS({ target, files: ["content/frogbot.css"] });
    await chrome.scripting.executeScript({
      target,
      files: [
        "content/frog.js",
        "content/highlight.js",
        "content/extract.js",
        "content/score.js",
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
