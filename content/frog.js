// Frogbot: the frog sprite, its movement and its tongue.
// Injected before main.js. Defines a single global, window.Frogbot.
// All positions are document coordinates (viewport rect + scroll offsets).
(() => {
  // Re-injection (clicking the button again) must not redefine the global.
  if (window.Frogbot) return;

  const FROG_SIZE = 60;
  const TOP_MARGIN = 16;
  // Gap between the frog and the edge of the target it lands next to: the tongue's flick.
  const TONGUE_REACH = 70;
  const MIN_TONGUE_REACH = 30; // shrink to this before giving up on the left side
  const TONGUE_POKE = 12; // how far past the target's edge the tongue tip reaches
  const MOUTH_OFFSET = 18; // distance from the frog's centre to its mouth

  const HOP_MS = 400;
  const TURN_MS = 150;
  // Tongue extend/retract time per direction: ~150ms at TONGUE_REACH, clamped.
  const TONGUE_MS = 150;
  const TONGUE_MIN_MS = 100;
  const TONGUE_MAX_MS = 250;
  const SCROLL_SETTLE_MS = 100;
  const SCROLL_MAX_MS = 1500;

  // Same artwork as assets/frog.svg, inlined so the legs can be animated with CSS
  // and no web_accessible_resources are needed. Faces down the page.
  // FROG_SVG_START: generated from assets/frog.svg by tools/sync_frog_svg.py; don't edit by hand.
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
  // FROG_SVG_END

  let frogEl = null;
  let cleanups = [];
  let animations = new Set();
  // Bumped on every show() and remove(), so work started for an old frog stops.
  let generation = 0;
  // Frog centre and rotation. Rotation 0 means facing down the page.
  const state = { x: 0, y: 0, angle: 0 };

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = (ms) => (reducedMotion() ? 1 : ms);

  function cancelledError() {
    return new DOMException("Frogbot was removed", "AbortError");
  }

  // Throws if the frog this work was started for has gone.
  function checkAlive(gen) {
    if (gen !== generation || !frogEl) throw cancelledError();
  }

  function addFrogbotElement(className) {
    const el = document.createElement("div");
    el.className = className;
    el.setAttribute("data-frogbot", "");
    el.setAttribute("aria-hidden", "true");
    // Appended to <html> so it is positioned against the document itself,
    // not the viewport and not a host-styled <body>.
    document.documentElement.appendChild(el);
    return el;
  }

  // Runs a Web Animation that remove() can cancel. Rejects with AbortError if cancelled.
  async function animate(el, keyframes, options) {
    const animation = el.animate(keyframes, { fill: "none", ...options });
    animations.add(animation);
    try {
      await animation.finished;
    } finally {
      animations.delete(animation);
    }
  }

  const translateFor = (x, y) => `${x - FROG_SIZE / 2}px ${y - FROG_SIZE / 2}px`;

  function docRect(element) {
    const r = element.getBoundingClientRect();
    return {
      left: r.left + window.scrollX,
      top: r.top + window.scrollY,
      right: r.right + window.scrollX,
      bottom: r.bottom + window.scrollY,
      width: r.width,
      height: r.height,
    };
  }

  // Resolves once scrolling has stopped for SCROLL_SETTLE_MS, or after SCROLL_MAX_MS.
  function waitForScrollToSettle(gen) {
    return new Promise((resolve) => {
      const start = performance.now();
      let lastX = window.scrollX;
      let lastY = window.scrollY;
      let lastChange = start;
      const poll = () => {
        const now = performance.now();
        if (window.scrollX !== lastX || window.scrollY !== lastY) {
          lastX = window.scrollX;
          lastY = window.scrollY;
          lastChange = now;
        }
        const settled = now - lastChange >= SCROLL_SETTLE_MS;
        if (settled || now - start >= SCROLL_MAX_MS || gen !== generation) {
          resolve();
        } else {
          requestAnimationFrame(poll);
        }
      };
      requestAnimationFrame(poll);
    });
  }

  // TONGUE_REACH to the left of the element, vertically centred. If the page's left edge
  // is closer, the gap shrinks (down to MIN_TONGUE_REACH); failing that, land above.
  function landingSpotFor(element) {
    const rect = docRect(element);
    const roomOnLeft = rect.left - window.scrollX - FROG_SIZE;
    const gap = Math.min(TONGUE_REACH, roomOnLeft);
    if (gap >= MIN_TONGUE_REACH) {
      return { x: rect.left - gap - FROG_SIZE / 2, y: rect.top + rect.height / 2 };
    }
    return {
      x: rect.left + Math.min(rect.width / 2, FROG_SIZE),
      y: Math.max(rect.top - TONGUE_REACH - FROG_SIZE / 2, FROG_SIZE / 2),
    };
  }

  function mouthPosition() {
    const rad = (state.angle * Math.PI) / 180;
    // The mouth is straight "down" in the artwork, rotated with the frog.
    return {
      x: state.x - Math.sin(rad) * MOUTH_OFFSET,
      y: state.y + Math.cos(rad) * MOUTH_OFFSET,
    };
  }

  window.Frogbot = {
    isShowing() {
      return Boolean(frogEl && frogEl.isConnected);
    },

    // Shows the frog centred on `at` ({x, y} in document coordinates), or at the
    // top centre of the page if no position is given.
    show(at) {
      if (this.isShowing()) return frogEl;

      generation += 1;
      frogEl = addFrogbotElement("frogbot-frog");
      frogEl.innerHTML = FROG_SVG;

      state.x = at ? at.x : window.scrollX + document.documentElement.clientWidth / 2;
      state.y = at ? Math.max(at.y, FROG_SIZE / 2) : TOP_MARGIN + FROG_SIZE / 2;
      state.angle = 0;
      frogEl.style.translate = translateFor(state.x, state.y);
      frogEl.style.rotate = "0deg";

      return frogEl;
    },

    // Rotate to face a document coordinate, taking the shortest way round.
    async faceTowards(x, y) {
      const gen = generation;
      checkAlive(gen);
      const dx = x - state.x;
      const dy = y - state.y;
      if (Math.hypot(dx, dy) < 1) return;

      // atan2 measures from the +x axis; the artwork faces +y, hence the -90.
      const target = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
      const delta = ((((target - state.angle) % 360) + 540) % 360) - 180;
      const from = state.angle;
      state.angle = from + delta;
      frogEl.style.rotate = `${state.angle}deg`;
      await animate(
        frogEl,
        [{ rotate: `${from}deg` }, { rotate: `${state.angle}deg` }],
        { duration: duration(TURN_MS), easing: "ease-out" }
      );
    },

    async hopTo(element) {
      const gen = generation;
      checkAlive(gen);

      element.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      await waitForScrollToSettle(gen);
      checkAlive(gen);

      const spot = landingSpotFor(element);
      await this.faceTowards(spot.x, spot.y);
      checkAlive(gen);

      const from = translateFor(state.x, state.y);
      const mid = translateFor((state.x + spot.x) / 2, (state.y + spot.y) / 2);
      const to = translateFor(spot.x, spot.y);
      const keyframes = reducedMotion()
        ? [{ translate: from }, { translate: to }]
        : [
            { translate: from, scale: 1 },
            { translate: mid, scale: 1.25 },
            { translate: to, scale: 1 },
          ];

      const frog = frogEl;
      state.x = spot.x;
      state.y = spot.y;
      frog.style.translate = to;
      // Swaps the legs from "tucked" to "stretched" (see frogbot.css).
      frog.classList.add("frogbot-hopping");
      try {
        await animate(frog, keyframes, { duration: duration(HOP_MS), easing: "ease-in-out" });
      } finally {
        frog.classList.remove("frogbot-hopping");
      }
      checkAlive(gen);

      const rect = docRect(element);
      await this.faceTowards(rect.left + rect.width / 2, rect.top + rect.height / 2);
    },

    // Flick the tongue to the element's nearest edge; onHit runs at full extension.
    async tongueTo(element, onHit) {
      const gen = generation;
      checkAlive(gen);

      const mouth = mouthPosition();
      const rect = docRect(element);
      const nearX = Math.min(Math.max(mouth.x, rect.left), rect.right);
      const nearY = Math.min(Math.max(mouth.y, rect.top), rect.bottom);
      const dx = nearX - mouth.x;
      const dy = nearY - mouth.y;
      const distance = Math.hypot(dx, dy);
      // If the mouth is already over the element, point the way the frog faces.
      const angle =
        distance > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : state.angle + 90;
      // Aim just inside the nearest edge so the tip visibly touches the text.
      const length = distance + TONGUE_POKE;
      // At a normal landing the mouth is TONGUE_REACH plus the mouth's inset from the
      // frog's edge away from the target; that distance takes TONGUE_MS.
      const normalDistance = TONGUE_REACH + FROG_SIZE / 2 - MOUTH_OFFSET;
      const flickMs = Math.min(
        Math.max((TONGUE_MS * distance) / normalDistance, TONGUE_MIN_MS),
        TONGUE_MAX_MS
      );

      const tongue = addFrogbotElement("frogbot-tongue");
      tongue.style.translate = `${mouth.x}px ${mouth.y - 3}px`;
      tongue.style.rotate = `${angle}deg`;
      try {
        tongue.style.width = `${length}px`;
        await animate(tongue, [{ width: "0px" }, { width: `${length}px` }], {
          duration: duration(flickMs),
          easing: "ease-out",
        });
        checkAlive(gen);
        if (onHit) onHit(element);
        tongue.style.width = "0px";
        await animate(tongue, [{ width: `${length}px` }, { width: "0px" }], {
          duration: duration(flickMs),
          easing: "ease-in",
        });
      } finally {
        tongue.remove();
      }
    },

    // A small speech bubble under the frog.
    say(text) {
      checkAlive(generation);
      const bubble = addFrogbotElement("frogbot-bubble");
      bubble.textContent = text;
      // Centred under the frog; measured after insertion so the width is known.
      const x = state.x - bubble.offsetWidth / 2;
      bubble.style.translate = `${x}px ${state.y + FROG_SIZE / 2 + 10}px`;
      return bubble;
    },

    // Where hopTo() would land next to an element (centre point, document coordinates).
    landingSpotFor(element) {
      return landingSpotFor(element);
    },

    // Register teardown work (e.g. event listeners) to run on remove().
    onRemove(fn) {
      cleanups.push(fn);
    },

    remove() {
      generation += 1;
      frogEl = null;
      for (const animation of animations) animation.cancel();
      animations = new Set();
      const fns = cleanups;
      cleanups = [];
      for (const fn of fns) fn();
      document.querySelectorAll("[data-frogbot]").forEach((el) => el.remove());
    },
  };
})();
