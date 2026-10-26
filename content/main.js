// Frogbot: entry point, injected after frog.js each time "Release the frog" is clicked.
(() => {
  const Frogbot = window.Frogbot;

  // Guard against double injection: one frog at a time.
  if (!Frogbot || Frogbot.isShowing()) return;

  console.log("Frogbot here");
  Frogbot.show();

  function onKeyDown(event) {
    if (event.key === "Escape") Frogbot.remove();
  }

  document.addEventListener("keydown", onKeyDown, true);
  // Runs on any remove(), so the listener never outlives the frog.
  Frogbot.onRemove(() => document.removeEventListener("keydown", onKeyDown, true));
})();
