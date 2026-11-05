// The welcome page: shows the current shortcut and the version.
(async () => {
  const version = chrome.runtime.getManifest().version;
  document.querySelector(".version").textContent = `Version ${version}`;

  // The shortcut as set now (the user can change or remove it on the extensions page).
  const [command] = (await chrome.commands.getAll()).filter((c) => c.name === "release-frog");
  const shortcut = command && command.shortcut;
  for (const kbd of document.querySelectorAll(".shortcut")) {
    if (shortcut) kbd.textContent = shortcut;
    else kbd.replaceWith(document.createTextNode("a keyboard shortcut you set on the extensions page"));
  }
})();
