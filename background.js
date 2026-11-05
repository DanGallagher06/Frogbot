// Frogbot's service worker. It does two things only: opens the welcome page when Frogbot is
// first installed, and runs the "release the frog" keyboard shortcut. Nothing else runs in the
// background.
importScripts("shared/release.js");

const WELCOME = "pages/welcome.html";

// First install only: not on updates, reloads or browser restarts. The stored flag makes sure
// of it even where the browser reports "install" again (it does for an extension loaded with
// --load-extension, on every launch).
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  const { welcomed } = await chrome.storage.local.get({ welcomed: false });
  if (welcomed) return;
  await chrome.storage.local.set({ welcomed: true });
  await chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME) });
});

// The shortcut (Alt+Shift+F unless the user changed it) does exactly what the popup's button
// does. On a page Frogbot can't run on it quietly does nothing.
async function onCommand(command, tab) {
  if (command !== "release-frog") return;
  if (!tab || tab.id === undefined) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  await FrogbotRelease.release(tab.id);
}
chrome.commands.onCommand.addListener(onCommand);
