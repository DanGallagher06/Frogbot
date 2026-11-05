// The options page: the developer setting "Show what Frogbot reads" (stored as `debug`, read
// when the frog is released), the current shortcut and the version.
const debugBox = document.getElementById("debug");

chrome.storage.local.get({ debug: false }).then(({ debug }) => {
  debugBox.checked = debug;
});
debugBox.addEventListener("change", () => {
  chrome.storage.local.set({ debug: debugBox.checked });
});

document.querySelector(".version").textContent = `Version ${chrome.runtime.getManifest().version}`;

chrome.commands.getAll().then((commands) => {
  const command = commands.find((c) => c.name === "release-frog");
  const text = document.getElementById("shortcut-text");
  if (command && command.shortcut) text.querySelector(".shortcut").textContent = command.shortcut;
  else text.textContent = "No shortcut is set for releasing the frog.";
});

// Browser pages can't be linked to directly; extensions can open them in a tab.
document.getElementById("shortcuts-link").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
