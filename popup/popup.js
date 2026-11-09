const releaseButton = document.getElementById("release");
const aiSwitch = document.getElementById("use-ai");
const aiNote = document.getElementById("ai-note");
const shortcutHint = document.getElementById("shortcut");
const message = document.getElementById("message");

const ISSUES = "https://github.com/DanGallagher06/Frogbot/issues";

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

// Opens a page in a new tab and closes the popup.
function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

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

// The shortcut as it's set now (the user can change or remove it), or a way to add one.
chrome.commands.getAll().then((commands) => {
  const command = commands.find((c) => c.name === "release-frog");
  shortcutHint.replaceChildren();
  if (command && command.shortcut) {
    const kbd = document.createElement("kbd");
    kbd.textContent = command.shortcut;
    shortcutHint.append("or press ", kbd);
  } else {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = "Add a keyboard shortcut";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openTab("chrome://extensions/shortcuts");
    });
    shortcutHint.append(link);
  }
  shortcutHint.hidden = false;
});

document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
document.getElementById("help").addEventListener("click", (event) => {
  event.preventDefault();
  openTab(chrome.runtime.getURL("pages/welcome.html"));
});
document.getElementById("report").addEventListener("click", (event) => {
  event.preventDefault();
  openTab(ISSUES);
});

// The same release as the keyboard shortcut (shared/release.js).
releaseButton.addEventListener("click", async () => {
  releaseButton.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { ok, reason } = tab && tab.id !== undefined ? await FrogbotRelease.release(tab.id) : { ok: false };
  if (ok) {
    window.close();
    return;
  }
  if (reason === "pdf") showMessage("Frogbot can't read PDFs yet. Open the HTML version of the page if there is one.");
  // Restricted pages (the browser's own pages, the web store, file:// without access).
  else showMessage("Frogbot can't hop on this page.");
  releaseButton.disabled = false;
});
