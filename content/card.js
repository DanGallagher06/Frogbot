// Frogbot: the stat card (milestone 2, step 12). The figures the frog caught, delivered at the
// end of a run. Rendered inside a shadow root, so the page's CSS can't change it and its CSS
// can't leak out. Defines a single global, window.FrogbotCard.
(() => {
  if (window.FrogbotCard) return;

  const VISIBLE_ROWS = 7;
  const DROP_MS = 250;
  // Importance on the card: headline metrics by topic, then guidance, then segment figures
  // ("Data Center revenue"), then everything else.
  const TOPIC_ORDER = ["revenue/sales", "gross profit", "operating income", "net income", "EPS/per share", "margin", "cash flow"];
  const GUIDANCE_RANK = TOPIC_ORDER.length;
  const SEGMENT_RANK = TOPIC_ORDER.length + 1;
  const OTHER_RANK = TOPIC_ORDER.length + 2;
  const CONFIDENCE = { high: 3, medium: 2, low: 1 };
  const ORDINAL_QUARTER = { first: 1, second: 2, third: 3, fourth: 4 };
  const ARROW = { up: "▲", down: "▼", flat: "▬" };
  const DIRECTION_WORD = { up: "up", down: "down", flat: "flat" };
  const DOT = { money: "gold", perShare: "gold", percent: "blue", basisPoints: "blue" };

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      --accent: #2e9d4f;
      --accent-dark: #237a3d;
      --bg: #ffffff;
      --fg: #1c2a1e;
      --muted: #6b766d;
      --line: #e5ebe6;
      --row-hover: #f4f8f4;
      --good: #1a8a3a;
      --bad: #d0342c;
      --neutral: #8a9089;
      --gold: #f2b300;
      --blue: #3d8fe0;
      --grey: #9e9e9e;
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 360px;
      max-width: calc(100vw - 32px);
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 12px;
      background: var(--bg);
      color: var(--fg);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      pointer-events: auto;
    }
    .card.measuring { visibility: hidden; }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
      padding: 9px 8px 9px 40px;
      background: var(--accent);
      color: #ffffff;
    }
    .icon { flex: none; width: 24px; height: 24px; }
    .icon svg { display: block; width: 24px; height: 24px; }
    .title { flex: 1; margin: 0; font-size: 14px; font-weight: 650; line-height: 1.3; }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .close {
      flex: none;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      font-size: 20px;
      line-height: 28px;
    }
    .close:hover { background: var(--accent-dark); }
    .close:focus-visible { outline-color: #ffffff; outline-offset: -2px; }
    .body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0 6px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th {
      position: sticky;
      top: 0;
      padding: 6px 8px 4px;
      background: var(--bg);
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      text-align: left;
      white-space: nowrap;
    }
    td { padding: 6px 8px; border-top: 1px solid var(--line); vertical-align: top; }
    tbody tr:hover td { background: var(--row-hover); }
    th:first-child, td:first-child { padding-left: 14px; }
    th:last-child, td:last-child { padding-right: 14px; }
    .num { text-align: right; white-space: nowrap; }
    .metric { min-width: 7.5em; overflow-wrap: anywhere; }
    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 5px;
      border-radius: 50%;
      vertical-align: 1px;
      background: var(--grey);
    }
    .dot.gold { background: var(--gold); }
    .dot.blue { background: var(--blue); }
    .change.good { color: var(--good); }
    .change.bad { color: var(--bad); }
    .change.neutral { color: var(--neutral); }
    .period { color: var(--fg); }
    .period.inferred { color: var(--muted); font-style: italic; opacity: 0.8; }
    tr.extra { display: none; }
    .expanded tr.extra { display: table-row; }
    .more {
      display: block;
      margin: 6px 14px 2px;
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 600;
    }
    .more:hover { background: var(--row-hover); }
    .empty { margin: 14px 14px 10px; color: var(--muted); font-size: 13px; }
    details { margin: 8px 14px 0; border-top: 1px solid var(--line); padding-top: 6px; }
    summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 600; padding: 2px 0; }
    details ul { margin: 4px 0 2px; padding: 0; list-style: none; }
    details li {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 3px 0;
      color: var(--muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    details li .fig { color: var(--fg); white-space: nowrap; }
    /* Rows are buttons: they jump to their figure on the page. */
    tr[role="button"], li[role="button"] { cursor: pointer; }
    tr[role="button"]:focus-visible, li[role="button"]:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    details li[role="button"] { margin: 0 -6px; padding: 3px 6px; border-radius: 4px; }
    details li[role="button"]:hover { background: var(--row-hover); }
    .count {
      margin-left: 5px;
      padding: 0 4px;
      border-radius: 4px;
      background: var(--line);
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
    }
    .foot {
      flex: none;
      padding: 8px 14px 9px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
    .action {
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 600;
    }
    .action:hover { background: var(--row-hover); }
    @media (prefers-color-scheme: dark) {
      .card {
        --bg: #1d2420;
        --fg: #e7eee8;
        --muted: #9eaba1;
        --line: #33403a;
        --row-hover: #26302b;
        --good: #5fd283;
        --bad: #ff7b6e;
        --neutral: #a3aaa5;
        --accent-dark: #3fb865;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
      }
      .close:hover { background: #237a3d; }
    }
    /* Narrow windows: a full-width bottom sheet. */
    @media (max-width: 479.98px) {
      .card {
        left: 0;
        right: 0;
        bottom: 0;
        width: auto;
        max-width: none;
        border-radius: 12px 12px 0 0;
      }
    }
  `;

  // The header icon: a simple frog face in white on the green strip.
  const FACE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round">
    <circle cx="7" cy="8" r="3.5"/><circle cx="17" cy="8" r="3.5"/>
    <circle cx="7" cy="8" r="1.2" fill="#ffffff" stroke="none"/><circle cx="17" cy="8" r="1.2" fill="#ffffff" stroke="none"/>
    <path d="M4.5 14.5c4 4.5 11 4.5 15 0"/></svg>`;

  let host = null;
  let card = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const isSegment = (q) => /^[A-Z]/.test(q) && !/^(?:GAAP|non-GAAP)$/.test(q);
  function rank(f) {
    if (f.role === "guidance") return GUIDANCE_RANK;
    const i = TOPIC_ORDER.indexOf(f.topic);
    if (i < 0) return OTHER_RANK;
    return (f.qualifiers || []).some(isSegment) ? SEGMENT_RANK : i;
  }

  // How recent a period is, for picking a metric's main row: "Q3 2026" > "FY26" > "2025".
  // A range counts by its last year; a period with no year comes after dated ones.
  function recency(f) {
    if (!f.period) return -Infinity;
    const t = f.period.text.toLowerCase();
    const years = [...t.matchAll(/\b(?:fy|fiscal(?: year)?)\s*['’]?(\d{4}|\d{2})\b|\b((?:19|20)\d{2})\b/g)].map((m) =>
      m[1] ? (m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])) : Number(m[2])
    );
    if (!years.length) return -1e9;
    const q = t.match(/\bq([1-4])\b/) || t.match(/\b(first|second|third|fourth)[\s-]quarter\b/);
    const quarter = q ? Number(q[1]) || ORDINAL_QUARTER[q[1]] : 0;
    return Math.max(...years) * 10 + quarter;
  }

  // Rows for the main table: one main row per metric (label, which carries its qualifiers,
  // plus role), by importance, levels before standalone changes, each followed by that
  // metric's other rows. A standalone change with a level for the same label and period
  // only appears under "Show all", after that level's metric. Only the first VISIBLE_ROWS
  // main rows show until "Show all". And the "Also caught" list: the rest, apart from changes
  // shown beside their level and earlier table columns shown as tooltips.
  function arrange(facts) {
    const position = new Map(facts.map((f, i) => [f, i]));
    const firstSeen = new Map();
    facts.forEach((f, i) => {
      if (!firstSeen.has(f.label)) firstSeen.set(f.label, i);
    });
    const shown = facts.filter((x) => x.showOnCard);
    const periodOf = (f) => (f.period ? f.period.text.toLowerCase() : "");
    const hasLevel = (c) => shown.some((l) => l.role === "level" && l.label === c.label && periodOf(l) === periodOf(c));
    const metrics = new Map();
    const tucked = new Map(); // level metric key -> its standalone changes, "Show all" only
    for (const f of shown) {
      if (f.role === "change" && hasLevel(f)) {
        const key = `${f.label}|level`;
        if (!tucked.has(key)) tucked.set(key, []);
        tucked.get(key).push(f);
        continue;
      }
      const key = `${f.label}|${f.role}`;
      if (!metrics.has(key)) metrics.set(key, []);
      metrics.get(key).push(f);
    }
    const best = (a, b) =>
      recency(b) - recency(a) ||
      CONFIDENCE[b.labelConfidence] - CONFIDENCE[a.labelConfidence] ||
      (CONFIDENCE[b.periodConfidence] || 0) - (CONFIDENCE[a.periodConfidence] || 0) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      position.get(a) - position.get(b);
    const groups = [...metrics.entries()].map(([key, list]) => {
      list.sort(best);
      return Object.assign(list, { extra: (tucked.get(key) || []).sort(best) });
    });
    const roleRank = (f) => (f.role === "change" ? 1 : 0);
    groups.sort(
      (a, b) =>
        rank(a[0]) - rank(b[0]) ||
        roleRank(a[0]) - roleRank(b[0]) ||
        firstSeen.get(a[0].label) - firstSeen.get(b[0].label) ||
        (b[0].score ?? 0) - (a[0].score ?? 0) ||
        position.get(a[0]) - position.get(b[0])
    );
    const rows = [];
    groups.forEach((list, i) => {
      list.forEach((f, j) => rows.push({ fact: f, visible: j === 0 && i < VISIBLE_ROWS }));
      for (const f of list.extra) rows.push({ fact: f, visible: false });
    });
    const also = facts.filter((f) => !f.showOnCard && !f.linkedTo && !f.priorPeriod);
    return { rows, also };
  }

  const metricText = (f) => f.label.replace(/^Guidance:\s*/, "Guidance · ");

  // Clicking (or Enter / Space on) a row jumps to its figure on the page. A fact caught in
  // several places goes to its best source first, then cycles through the others, with a
  // "1/2" badge beside the figure.
  function jumpable(node, f, figureEl, onJump) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${metricText(f)} ${f.display}: show on the page`);
    const count = f.sources.length;
    const best = Math.max(0, f.sources.findIndex((s) => s.blockIndex === f.blockIndex && s.matchStart === f.matchStart));
    let current = -1;
    const go = () => {
      current = current < 0 ? best : (current + 1) % count;
      if (count > 1) {
        let badge = figureEl.querySelector(".count");
        if (!badge) badge = figureEl.appendChild(el("span", "count"));
        badge.textContent = `${((current - best + count) % count) + 1}/${count}`;
      }
      if (onJump) onJump(f, current);
    };
    node.addEventListener("click", go);
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      go();
    });
  }

  function row(f, onJump) {
    const tr = el("tr");
    tr.dataset.factId = f.id;
    tr.appendChild(el("td", "metric", metricText(f)));

    const figure = el("td", "num figure");
    figure.appendChild(el("span", `dot ${DOT[f.type] || "grey"}`));
    figure.appendChild(document.createTextNode(f.display));
    tr.appendChild(figure);

    // The arrow, plus the linked change's figure (its sign is the arrow's job).
    const change = el("td", `num change ${f.sentiment || "neutral"}`);
    if (f.direction) {
      const text = f.change ? `${ARROW[f.direction]} ${f.change.display.replace(/^[+\-−]/, "")}` : ARROW[f.direction];
      change.textContent = text;
      change.setAttribute("aria-label", `${DIRECTION_WORD[f.direction]}${f.change ? ` ${f.change.display.replace(/^[+\-−]/, "")}` : ""}`);
    }
    // The earlier table column it's compared with.
    if (f.prior) change.title = `vs ${f.prior.display} in ${f.prior.period}`;
    tr.appendChild(change);

    const period = el("td", "period", f.period ? f.period.text : "");
    if (f.period && f.periodInferred) {
      period.classList.add("inferred");
      period.title = "Period inferred from the page";
    }
    tr.appendChild(period);
    jumpable(tr, f, figure, onJump);
    return tr;
  }

  function build(facts, options) {
    const { onClose, onJump } = options;
    const { rows, also } = arrange(facts);
    const root = el("div", "card measuring");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Figures Frogbot caught on this page");

    const head = el("div", "head");
    const icon = el("span", "icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = FACE_SVG;
    head.appendChild(icon);
    head.appendChild(el("h2", "title", `Frogbot caught ${facts.length} figure${facts.length === 1 ? "" : "s"}`));
    const close = el("button", "close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => onClose && onClose());
    head.appendChild(close);
    root.appendChild(head);

    const body = el("div", "body");
    if (rows.length) {
      const table = el("table");
      const thead = el("thead");
      const headRow = el("tr");
      [
        ["Metric", ""],
        ["Figure", "num"],
        ["Change", "num"],
        ["Period", ""],
      ].forEach(([text, cls]) => {
        const th = el("th", cls, text);
        th.scope = "col";
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const r of rows) {
        const tr = row(r.fact, onJump);
        if (!r.visible) tr.classList.add("extra");
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);
      if (rows.some((r) => !r.visible)) {
        const more = el("button", "more", `Show all (${rows.length})`);
        more.type = "button";
        more.setAttribute("aria-expanded", "false");
        more.addEventListener("click", () => {
          const open = body.classList.toggle("expanded");
          more.textContent = open ? "Show less" : `Show all (${rows.length})`;
          more.setAttribute("aria-expanded", String(open));
        });
        body.appendChild(more);
      }
    } else {
      body.appendChild(el("p", "empty", "No headline figures here"));
    }

    if (also.length) {
      const details = el("details", "also");
      details.appendChild(el("summary", null, `Also caught (${also.length})`));
      const list = el("ul");
      for (const f of also) {
        const li = el("li");
        li.dataset.factId = f.id;
        const label = f.labelConfidence === "low" ? `“${f.label}”` : `${metricText(f)}${f.role === "estimate" ? " (estimate)" : ""}`;
        li.appendChild(el("span", "label", label));
        const fig = li.appendChild(el("span", "fig", f.display));
        jumpable(li, f, fig, onJump);
        list.appendChild(li);
      }
      details.appendChild(list);
      body.appendChild(details);
    }
    root.appendChild(body);

    const foot = el("div", "foot");
    const actions = el("div", "actions");
    const copy = el("button", "action copy", "Copy table");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      const ok = await copyText(tableText(rows), root);
      copy.textContent = ok ? "Copied ✓" : "Copy failed";
      copy.focus();
      setTimeout(() => (copy.textContent = "Copy table"), 1500);
    });
    const download = el("button", "action csv", "Download CSV");
    download.type = "button";
    download.addEventListener("click", () => downloadCsv(rows, also, root));
    actions.append(copy, download);
    foot.appendChild(actions);
    foot.appendChild(el("div", "note", "Figures taken directly from this page · Not financial advice"));
    root.appendChild(foot);
    return root;
  }

  // ---- Export ----

  const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();
  const changeText = (f) => (f.direction && f.change ? f.change.display.replace(/^[+\-−]/, "") : "");

  // The main table (with the "Show all" rows) as tab-separated text, values as displayed.
  function tableText(rows) {
    const cell = (v) => collapse(String(v ?? "")).replace(/\t/g, " ");
    const lines = [["Metric", "Figure", "Change", "Direction", "Period"]];
    for (const { fact: f } of rows) {
      lines.push([metricText(f), f.display, changeText(f), f.direction || "", f.period ? f.period.text : ""]);
    }
    return lines.map((line) => line.map(cell).join("\t")).join("\n") + "\n";
  }

  // The clipboard API first; where it's refused (some file:// pages), a hidden textarea and
  // execCommand("copy"). The textarea lives in the card's shadow root, not the page.
  async function copyText(text, container) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back below.
    }
    const area = el("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position: fixed; left: -9999px; top: 0; opacity: 0;";
    container.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  const CSV_COLUMNS = [
    "section", "metric", "figure", "value", "low", "high", "currency", "type", "role", "change", "direction",
    "sentiment", "period", "period_inferred", "prior", "source_text", "page_url", "captured_at",
  ];

  // Quote a field holding a comma, quote or line break, doubling any quotes.
  function csvField(value) {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Every row (main, "Show all" and "Also caught") as CSV, with a UTF-8 BOM so Excel reads
  // £, € and – correctly.
  function csvText(rows, also) {
    const capturedAt = new Date().toISOString();
    const record = (f, section) => ({
      section,
      metric: metricText(f),
      figure: f.display,
      value: f.value,
      low: f.low,
      high: f.high,
      currency: f.currency,
      type: f.type,
      role: f.role,
      change: f.change ? f.change.display : "",
      direction: f.direction,
      sentiment: f.sentiment,
      period: f.period ? f.period.text : "",
      period_inferred: f.periodInferred ? "true" : "false",
      prior: f.prior ? `${f.prior.display} in ${f.prior.period}` : "",
      source_text: collapse(f.sentence).slice(0, 200),
      page_url: location.href,
      captured_at: capturedAt,
    });
    const records = [...rows.map((r) => record(r.fact, "main")), ...also.map((f) => record(f, "also caught"))];
    const lines = [CSV_COLUMNS.join(","), ...records.map((r) => CSV_COLUMNS.map((c) => csvField(r[c])).join(","))];
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  // frogbot-<site>-<yyyy-mm-dd>.csv, saved with a Blob and a temporary download link.
  function downloadCsv(rows, also, container) {
    const site = (location.hostname.replace(/^www\./, "") || "local").replace(/[^a-z0-9.-]+/gi, "-");
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const name = `frogbot-${site}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
    const url = URL.createObjectURL(new Blob([csvText(rows, also)], { type: "text/csv;charset=utf-8" }));
    const link = el("a");
    link.href = url;
    link.download = name;
    link.style.display = "none";
    container.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The host is a zero-size fixed box, so only the card itself takes clicks. Inline
  // !important styles beat anything the page's CSS says about it.
  function makeHost() {
    const node = document.createElement("div");
    node.className = "frogbot-card-host";
    node.setAttribute("data-frogbot", "");
    const styles = [
      ["all", "initial"],
      ["display", "block"],
      ["position", "fixed"],
      ["top", "0"],
      ["left", "0"],
      ["width", "0"],
      ["height", "0"],
      ["margin", "0"],
      ["padding", "0"],
      ["border", "0"],
      ["transform", "none"],
      ["filter", "none"],
      ["opacity", "1"],
      ["visibility", "visible"],
      ["pointer-events", "none"],
      ["z-index", "2147482995"],
    ];
    for (const [name, value] of styles) node.style.setProperty(name, value, "important");
    return node;
  }

  window.FrogbotCard = {
    // Renders the card. options.hidden: lay it out invisibly (to measure where the frog
    // should land) until reveal(). options.onClose: the × button. options.onJump(fact,
    // sourceIndex): a row was clicked.
    show(facts, options = {}) {
      this.hide();
      host = makeHost();
      const shadow = host.attachShadow({ mode: "open" });
      const style = el("style");
      style.textContent = STYLE;
      shadow.appendChild(style);
      card = build(facts, options);
      shadow.appendChild(card);
      document.documentElement.appendChild(host);
      if (!options.hidden) this.reveal(options);
      return card;
    },

    // The card's box in the window.
    rect() {
      return card ? card.getBoundingClientRect() : null;
    },

    // Shows a card laid out with show(facts, { hidden: true }). options.origin ({x, y} in
    // the window): where the drop animation grows from. options.animate: false for none.
    // Resolves once the card is fully in.
    async reveal(options = {}) {
      if (!card) return;
      card.classList.remove("measuring");
      if (options.animate === false || !options.origin) return;
      const r = card.getBoundingClientRect();
      card.style.transformOrigin = `${options.origin.x - r.left}px ${options.origin.y - r.top}px`;
      const drop = card.animate(
        [
          { transform: "scale(0.08)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: DROP_MS, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)" }
      );
      try {
        await drop.finished;
      } catch {
        // Cancelled by hide(); nothing to wait for.
      }
    },

    isShowing() {
      return Boolean(host && host.isConnected);
    },

    hide() {
      if (host) host.remove();
      host = null;
      card = null;
    },
  };
})();
