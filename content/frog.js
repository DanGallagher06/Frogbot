// Frogbot: the frog sprite and its lifecycle on the page.
// Injected before main.js. Defines a single global, window.Frogbot.
(() => {
  // Re-injection (clicking the button again) must not redefine the global.
  if (window.Frogbot) return;

  const FROG_WIDTH = 60;
  const TOP_MARGIN = 16;

  // Same artwork as assets/frog.svg, inlined so the legs can be animated with CSS
  // and no web_accessible_resources are needed. Faces down the page.
  const FROG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" focusable="false">
      <g class="frogbot-leg frogbot-leg-back-left" id="frogbot-leg-back-left" fill="#43a047" stroke="#2e6b2f" stroke-width="1.5">
        <ellipse cx="74" cy="27" rx="7" ry="15" transform="rotate(30 74 27)"/>
        <circle cx="88" cy="11" r="3"/>
        <circle cx="84" cy="6" r="3"/>
        <circle cx="79" cy="8" r="3"/>
      </g>
      <g class="frogbot-leg frogbot-leg-back-right" id="frogbot-leg-back-right" fill="#43a047" stroke="#2e6b2f" stroke-width="1.5">
        <ellipse cx="26" cy="27" rx="7" ry="15" transform="rotate(-30 26 27)"/>
        <circle cx="12" cy="11" r="3"/>
        <circle cx="16" cy="6" r="3"/>
        <circle cx="21" cy="8" r="3"/>
      </g>
      <g class="frogbot-leg frogbot-leg-front-left" id="frogbot-leg-front-left" fill="#43a047" stroke="#2e6b2f" stroke-width="1.5">
        <ellipse cx="73" cy="71" rx="4" ry="9" transform="rotate(-40 73 71)"/>
        <circle cx="81" cy="78" r="2.2"/>
        <circle cx="79" cy="82" r="2.2"/>
        <circle cx="75" cy="82" r="2.2"/>
      </g>
      <g class="frogbot-leg frogbot-leg-front-right" id="frogbot-leg-front-right" fill="#43a047" stroke="#2e6b2f" stroke-width="1.5">
        <ellipse cx="27" cy="71" rx="4" ry="9" transform="rotate(40 27 71)"/>
        <circle cx="19" cy="78" r="2.2"/>
        <circle cx="21" cy="82" r="2.2"/>
        <circle cx="25" cy="82" r="2.2"/>
      </g>
      <g class="frogbot-body">
        <ellipse cx="50" cy="48" rx="22" ry="27" fill="#4caf50" stroke="#2e6b2f" stroke-width="1.5"/>
        <ellipse cx="50" cy="71" rx="16" ry="12" fill="#4caf50" stroke="#2e6b2f" stroke-width="1.5"/>
        <ellipse cx="50" cy="56" rx="21" ry="22" fill="#4caf50"/>
        <circle cx="42" cy="38" r="3.5" fill="#3b8f3f"/>
        <circle cx="57" cy="32" r="2.8" fill="#3b8f3f"/>
        <circle cx="55" cy="48" r="3.2" fill="#3b8f3f"/>
        <circle cx="43" cy="54" r="2.4" fill="#3b8f3f"/>
        <circle cx="47" cy="81" r="0.9" fill="#2e6b2f"/>
        <circle cx="53" cy="81" r="0.9" fill="#2e6b2f"/>
      </g>
      <g class="frogbot-eyes">
        <circle cx="39" cy="74" r="6.5" fill="#8fd16a" stroke="#2e6b2f" stroke-width="1.5"/>
        <circle cx="61" cy="74" r="6.5" fill="#8fd16a" stroke="#2e6b2f" stroke-width="1.5"/>
        <circle cx="39" cy="75.5" r="3.6" fill="#1b1b1b"/>
        <circle cx="61" cy="75.5" r="3.6" fill="#1b1b1b"/>
        <circle cx="38" cy="74.3" r="1.1" fill="#ffffff"/>
        <circle cx="60" cy="74.3" r="1.1" fill="#ffffff"/>
      </g>
    </svg>`;

  let frogEl = null;
  let cleanups = [];

  window.Frogbot = {
    isShowing() {
      return Boolean(frogEl && frogEl.isConnected);
    },

    show() {
      if (this.isShowing()) return frogEl;

      frogEl = document.createElement("div");
      frogEl.className = "frogbot-frog";
      frogEl.setAttribute("data-frogbot", "");
      frogEl.setAttribute("aria-hidden", "true");
      frogEl.innerHTML = FROG_SVG;

      // Appended to <html> so it is positioned against the document itself,
      // not the viewport and not a host-styled <body>.
      const root = document.documentElement;
      const left = window.scrollX + root.clientWidth / 2 - FROG_WIDTH / 2;
      frogEl.style.setProperty("left", `${left}px`, "important");
      frogEl.style.setProperty("top", `${TOP_MARGIN}px`, "important");
      root.appendChild(frogEl);

      return frogEl;
    },

    // Register teardown work (e.g. event listeners) to run on remove().
    onRemove(fn) {
      cleanups.push(fn);
    },

    remove() {
      for (const fn of cleanups) fn();
      cleanups = [];
      document.querySelectorAll("[data-frogbot]").forEach((el) => el.remove());
      frogEl = null;
    },
  };
})();
