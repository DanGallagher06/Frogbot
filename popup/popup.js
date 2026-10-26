const releaseButton = document.getElementById("release");
const message = document.getElementById("message");

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

releaseButton.addEventListener("click", async () => {
  releaseButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      throw new Error("No active tab");
    }

    const target = { tabId: tab.id };
    await chrome.scripting.insertCSS({ target, files: ["content/frogbot.css"] });
    await chrome.scripting.executeScript({
      target,
      files: ["content/frog.js", "content/highlight.js", "content/main.js"],
    });

    window.close();
  } catch (error) {
    // Restricted pages (chrome://, the Web Store, file:// without access) reject injection.
    console.warn("Frogbot injection failed:", error);
    showMessage("Frogbot can't hop on this page.");
    releaseButton.disabled = false;
  }
});
