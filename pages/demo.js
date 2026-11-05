// The built-in demo page. Extension pages can't have scripts injected into them, so "Release
// the frog" here loads Frogbot's content scripts itself: the same files, in the same order and
// with the same settings as a release on any other page (shared/release.js), so the run is the
// normal one (frog, highlights, card, summary, exports). The popup's button and the keyboard
// shortcut ask this page to do the same.
(() => {
  const { FILES, settings } = globalThis.FrogbotRelease;
  const button = document.getElementById("demo-release");
  const hint = document.querySelector(".demo-hint");

  // Runs one script file, as executeScript would. The <script> element is removed once it has
  // run, so the page's HTML is the same after Escape as before the run.
  function run(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(file);
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Couldn't load ${file}`));
      };
      document.head.appendChild(script);
    });
  }

  async function release() {
    const { debug, useAI } = await settings();
    window.__frogbotDebug = debug;
    window.__frogbotUseAI = useAI;
    for (const file of FILES) await run(file);
  }

  button.addEventListener("click", () => {
    button.blur(); // so Escape reaches the frog, not the button
    release();
  });

  // The popup's button or the shortcut, on this tab.
  chrome.tabs.getCurrent((tab) => {
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (!message || message.type !== "frogbot-release" || !tab || message.tabId !== tab.id) return false;
      release().then(
        () => reply({ ok: true }),
        () => reply({ ok: false })
      );
      return true; // replies asynchronously
    });
  });

  chrome.commands.getAll().then((commands) => {
    const command = commands.find((c) => c.name === "release-frog");
    if (!command || !command.shortcut) return;
    hint.querySelector(".shortcut").textContent = command.shortcut;
    hint.hidden = false;
  });
})();
