// Frogbot: highlighting of the things the frog catches.
// For now whole elements are marked; exact-number highlighting comes later.
(() => {
  if (window.FrogbotHighlight) return;

  const marked = new Set();

  window.FrogbotHighlight = {
    mark(element) {
      element.classList.add("frogbot-hl");
      marked.add(element);
    },

    clearAll() {
      for (const element of marked) element.classList.remove("frogbot-hl");
      marked.clear();
    },
  };
})();
