// Frogbot: the stat card (milestone 2, step 12). The figures the frog caught, delivered at the
// end of a run. Rendered inside a shadow root, so the page's CSS can't change it and its CSS
// can't leak out. Defines a single global, window.FrogbotCard.
(() => {
  if (window.FrogbotCard) return;

  const DROP_MS = 250;
  const ARROW = { up: "▲", down: "▼", flat: "▬" };
  const DIRECTION_WORD = { up: "up", down: "down", flat: "flat" };
  const DOT = { money: "gold", perShare: "gold", percent: "blue", basisPoints: "blue", percentagePoints: "blue" };

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      --accent: #2e9d4f;
      --accent-dark: #237a3d;
      --primary-bg: #237a3d;
      --primary-fg: #ffffff;
      --primary-hover: #1b5f30;
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
      /* --lift: room left for a cookie bar or sticky footer along the bottom of the window. */
      bottom: calc(16px + var(--lift, 0px));
      width: 360px;
      max-width: calc(100vw - 32px);
      max-height: min(60vh, calc(100vh - 32px - var(--lift, 0px)));
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
    .titles { flex: 1; min-width: 0; }
    .title { margin: 0; font-size: 14px; font-weight: 650; line-height: 1.3; }
    .company { margin: 1px 0 0; font-size: 12px; line-height: 1.3; opacity: 0.9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
    .body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0 6px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    /* The header stays put while the rows scroll under it: solid card background (also painted
       a little above it, so nothing shows through), above the rows, with a line under it. */
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 6px 8px 4px;
      background: var(--bg);
      box-shadow: 0 -8px 0 var(--bg), inset 0 -1px 0 var(--line);
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
    /* The summary: short bullets above the table, its numbers linked to their figures. */
    .summary { margin: 4px 14px 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
    .summary-toggle {
      display: flex;
      align-items: baseline;
      gap: 6px;
      width: 100%;
      padding: 4px 0;
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      text-align: left;
    }
    .summary-toggle .name { text-transform: uppercase; letter-spacing: 0.03em; }
    .summary-toggle .kind { font-weight: 500; }
    .summary-toggle .chev { margin-left: auto; transition: transform 150ms ease-out; }
    .summary.collapsed .chev { transform: rotate(-90deg); }
    .summary.collapsed .summary-list { display: none; }
    .summary-list { margin: 2px 0 2px; padding-left: 18px; font-size: 13px; line-height: 1.45; }
    .summary-list li { margin: 3px 0; }
    .num-link {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-decoration: underline dotted var(--grey);
      text-decoration-thickness: 1.5px;
      text-underline-offset: 2px;
      font-variant-numeric: tabular-nums;
    }
    .num-link.gold { text-decoration-color: var(--gold); }
    .num-link.blue { text-decoration-color: var(--blue); }
    .num-link:hover { background: var(--row-hover); }
    .num-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 2px; }
    .summary.collapsed .ai-status { display: none; }
    .ai-note { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
    .ai-writing::before { content: "✎ "; }
    .ai-dropped { cursor: help; }
    .ai-get {
      margin: 6px 0 2px;
      padding: 3px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--accent-dark);
      font-size: 11px;
      font-weight: 600;
    }
    .ai-get:hover { background: var(--row-hover); }
    .ai-get:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .ai-progress { height: 3px; margin: 6px 0 0; overflow: hidden; border-radius: 2px; background: var(--line); }
    .ai-progress-fill { height: 100%; background: var(--accent); transition: width 200ms linear; }
    @media (prefers-reduced-motion: reduce) { .ai-progress-fill { transition: none; } }
    @media (prefers-reduced-motion: reduce) { .summary-toggle .chev { transition: none; } }
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
    .action.primary { border-color: var(--primary-bg); background: var(--primary-bg); color: var(--primary-fg); }
    .action.primary:hover { background: var(--primary-hover); }
    .action.secondary { padding: 4px 6px; border-color: transparent; font-size: 11px; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
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
        --primary-bg: #3fb865;
        --primary-fg: #0d1a11;
        --primary-hover: #5fd283;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
      }
      .close:hover { background: #237a3d; }
    }
    /* Narrow windows: a full-width bottom sheet. */
    @media (max-width: 479.98px) {
      .card {
        left: 0;
        right: 0;
        bottom: var(--lift, 0px);
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

  const metricText = (f) => f.label.replace(/^Guidance:\s*/, "Guidance · ");

  // Clicking (or Enter / Space on) a row jumps to its figure on the page. A fact caught in
  // several places goes to its best source first, then cycles through the others, with a
  // "1/2" badge beside the figure.
  // Where a fact was caught best: the source its own record came from.
  const bestSource = (f) => Math.max(0, f.sources.findIndex((s) => s.blockIndex === f.blockIndex && s.matchStart === f.matchStart));

  function jumpable(node, f, figureEl, onJump) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${metricText(f)} ${f.display}: show on the page`);
    const count = f.sources.length;
    const best = bestSource(f);
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
    if (f.prior) change.title = `vs ${f.prior.display}${f.prior.period ? ` in ${f.prior.period}` : ""}`;
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

  // The summary section: a toggle, one bullet per sentence, and a status line for the AI summary
  // (writing, the download button, download progress, removed sentences). Each number linked to a
  // fact is a button that jumps to its figure. Open by default; open/closed is remembered.
  const SUMMARY_KIND = { rules: "Summary · built from page figures", ai: "AI summary · every number checked" };
  const OPEN_KEY = "summaryOpen";
  function store() {
    try {
      return globalThis.chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch {
      return null;
    }
  }

  let summaryView = null; // { section, kind, list, status, facts, onJump, onGetAI, summary }

  function fillSummary(view, summary) {
    const byId = new Map(view.facts.map((f) => [f.id, f]));
    view.summary = summary;
    const [name, ...rest] = SUMMARY_KIND[summary.kind].split(" · ");
    view.name.textContent = name;
    view.kind.textContent = `· ${rest.join(" · ")}`;
    view.list.replaceChildren();
    for (const sentence of summary.sentences) {
      const li = el("li");
      let at = 0;
      for (const n of sentence.numbers) {
        const i = sentence.text.indexOf(n.raw, at);
        const fact = byId.get(n.factId);
        if (i < 0 || !fact) continue;
        li.appendChild(document.createTextNode(sentence.text.slice(at, i)));
        const link = el("button", `num-link ${DOT[fact.type] || "grey"}`, n.raw);
        link.type = "button";
        link.dataset.factId = fact.id;
        link.setAttribute("aria-label", `${n.raw}: show ${metricText(fact)} on the page`);
        link.addEventListener("click", () => view.onJump && view.onJump(fact, bestSource(fact)));
        li.appendChild(link);
        at = i + n.raw.length;
      }
      li.appendChild(document.createTextNode(sentence.text.slice(at)));
      view.list.appendChild(li);
    }
  }

  // The status line under the summary, for the AI summary's progress: { phase, progress }.
  // phase: "writing", "downloadable" (the download button), "downloading", or anything else for
  // nothing. An accepted AI summary also notes how many sentences the checker removed.
  function fillStatus(view, ai) {
    const status = view.status;
    status.replaceChildren();
    const dropped = view.summary && view.summary.kind === "ai" ? view.summary.dropped || [] : [];
    if (dropped.length) {
      const note = el("p", "ai-note ai-dropped", `${dropped.length} sentence${dropped.length === 1 ? "" : "s"} removed (figure not on the page)`);
      note.title = dropped.map((d) => d.text).join("\n");
      status.appendChild(note);
    }
    if (!ai) return;
    if (ai.phase === "writing") {
      status.appendChild(el("p", "ai-note ai-writing", "Writing AI summary…"));
    } else if (ai.phase === "downloadable") {
      const get = el("button", "ai-get", "Get AI summaries (one-time download)");
      get.type = "button";
      // This click is the user activation the browser needs before it downloads the model.
      get.addEventListener("click", () => view.onGetAI && view.onGetAI());
      status.appendChild(get);
    } else if (ai.phase === "downloading") {
      const percent = Math.round((ai.progress || 0) * 100);
      const bar = el("div", "ai-progress");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", "Downloading the on-device model");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(percent));
      const fill = el("div", "ai-progress-fill");
      fill.style.width = `${percent}%`;
      bar.appendChild(fill);
      status.append(bar, el("p", "ai-note ai-downloading", `Downloading the on-device model… ${percent}%`));
    }
  }

  function summarySection(summary, facts, options) {
    const section = el("section", "summary");
    const toggle = el("button", "summary-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "true");
    const name = el("span", "name");
    const kind = el("span", "kind");
    const chev = el("span", "chev", "▾");
    chev.setAttribute("aria-hidden", "true");
    toggle.append(name, kind, chev);
    const list = el("ul", "summary-list");
    const status = el("div", "ai-status");
    const view = { section, name, kind, list, status, facts, onJump: options.onJump, onGetAI: options.onGetAI, summary: null };
    fillSummary(view, summary);
    fillStatus(view, options.ai);
    const setOpen = (open) => {
      section.classList.toggle("collapsed", !open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => {
      const open = section.classList.contains("collapsed");
      setOpen(open);
      const s = store();
      if (s) Promise.resolve(s.set({ [OPEN_KEY]: open })).catch(() => {});
    });
    const s = store();
    if (s) {
      Promise.resolve(s.get({ [OPEN_KEY]: true }))
        .then((got) => setOpen(got && got[OPEN_KEY] !== false))
        .catch(() => {});
    }
    section.append(toggle, list, status);
    summaryView = view;
    return section;
  }

  const summaryText = (summary) => summary.sentences.map((x) => x.text).join("\n") + "\n";

  function build(facts, options) {
    const { onClose, onJump, summary } = options;
    const hasSummary = Boolean(summary && summary.sentences && summary.sentences.length);
    // Row order and the "Also caught" list come from facts.js, shared with the summary.
    const { rows, also } = window.FrogbotFacts.cardRows(facts);
    const root = el("div", "card measuring");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Figures Frogbot caught on this page");

    const head = el("div", "head");
    const icon = el("span", "icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = FACE_SVG;
    head.appendChild(icon);
    const titles = el("div", "titles");
    titles.appendChild(el("h2", "title", `Frogbot caught ${facts.length} figure${facts.length === 1 ? "" : "s"}`));
    const who = companyText(options.page);
    if (who) titles.appendChild(el("p", "company", who));
    head.appendChild(titles);
    const close = el("button", "close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => onClose && onClose());
    head.appendChild(close);
    root.appendChild(head);

    const body = el("div", "body");
    if (hasSummary) body.appendChild(summarySection(summary, facts, options));
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
        const estimate = f.role === "estimate" && !/ vs estimates$/.test(f.label) ? " (estimate)" : "";
        const label = f.labelConfidence === "low" ? `“${f.label}”` : `${metricText(f)}${estimate}`;
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
      const ok = await copyText(tableText(rows, options.page), root);
      copy.textContent = ok ? "Copied ✓" : "Copy failed";
      copy.focus();
      setTimeout(() => (copy.textContent = "Copy table"), 1500);
    });
    const excel = el("button", "action primary xlsx", "Download Excel");
    excel.type = "button";
    excel.addEventListener("click", () => downloadXlsx(rows, also, root, options.page));
    const download = el("button", "action secondary csv", "Download CSV");
    download.type = "button";
    download.addEventListener("click", () => downloadCsv(rows, also, root, options.page));
    actions.appendChild(excel);
    actions.appendChild(copy);
    if (hasSummary) {
      const copySummary = el("button", "action copy-summary", "Copy summary");
      copySummary.type = "button";
      copySummary.addEventListener("click", async () => {
        // Whichever summary is showing: the AI one once it's accepted, else the rules one.
        const ok = await copyText(summaryText((summaryView && summaryView.summary) || summary), root);
        copySummary.textContent = ok ? "Copied ✓" : "Copy failed";
        copySummary.focus();
        setTimeout(() => (copySummary.textContent = "Copy summary"), 1500);
      });
      actions.appendChild(copySummary);
    }
    actions.appendChild(download);
    foot.appendChild(actions);
    foot.appendChild(el("div", "note", "Figures taken directly from this page · Not financial advice"));
    root.appendChild(foot);
    return root;
  }

  // ---- Export ----

  const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();
  const changeText = (f) => (f.direction && f.change ? f.change.display.replace(/^[+\-−]/, "") : "");

  // "NVIDIA (NVDA)", "NVIDIA", "NVDA" or "": the page's company, for the card's subtitle.
  function companyText(page) {
    if (!page) return "";
    if (page.company && page.ticker) return `${page.company} (${page.ticker})`;
    return page.company || page.ticker || "";
  }

  // The main table (with the "Show all" rows) as tab-separated text, values as displayed, with
  // each row's company first.
  function tableText(rows, page) {
    const cell = (v) => collapse(String(v ?? "")).replace(/\t/g, " ");
    const lines = [["Company", "Metric", "Figure", "Change", "Direction", "Period"]];
    for (const { fact: f } of rows) {
      const company = f.company || f.ticker ? companyText(f) : companyText(page);
      lines.push([company, metricText(f), f.display, changeText(f), f.direction || "", f.period ? f.period.text : ""]);
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

  // CSV format version 1, documented column by column in docs/export-format.md. Columns are only
  // ever added at the end, and a change in meaning bumps format_version.
  const CSV_VERSION = "1";
  const CSV_COLUMNS = [
    "format_version", "company", "ticker", "metric", "qualifiers", "figure", "value", "unit", "currency",
    "low", "high", "role", "period", "period_end_date", "period_inferred", "label_confidence",
    "period_confidence", "change_value", "change_unit", "direction", "prior_value", "prior_period",
    "vs_estimate", "source_text", "page_url", "published_date", "captured_at",
  ];
  const UNIT = {
    money: "money", percent: "percent", basisPoints: "basis_points", percentagePoints: "percentage_points",
    perShare: "per_share", multiple: "multiple", count: "count",
  };

  // A plain number Excel reads as a number: no symbols, separators or exponent noise
  // (482600000, 14.2, 1.24, -3).
  function plainNumber(v) {
    if (v == null || v === "" || !Number.isFinite(Number(v))) return "";
    const n = Number(Number(v).toPrecision(15));
    if (Math.abs(n) >= 1e21 || (n !== 0 && Math.abs(n) < 1e-6)) return n.toFixed(10).replace(/\.?0+$/, "");
    return String(n);
  }

  // Quote a field holding a comma, quote or line break, doubling any quotes.
  function csvField(value) {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // One CSV record for a fact. A change's value is signed by its direction (a 3% fall is -3).
  function csvRecord(f, page, capturedAt) {
    const change = f.direction && f.change ? f.change : null;
    let changeValue = change ? Math.abs(change.value) : null;
    if (change && f.direction === "down") changeValue = -changeValue;
    if (change && f.direction === "flat") changeValue = 0;
    const own = f.company || f.ticker;
    const company = own ? f.company : page && page.company;
    return {
      format_version: CSV_VERSION,
      company,
      ticker: own ? f.ticker : page && page.ticker,
      metric: f.metric,
      // The company has its own column ("Meta Platforms earnings" is qualified by nothing).
      qualifiers: (f.qualifiers || []).filter((q) => q !== company).join(";"),
      figure: f.display,
      // A range's midpoint never appears on the page, so a range has only low and high.
      value: f.low != null && f.high != null ? "" : plainNumber(f.value),
      unit: f.unit || UNIT[f.type] || f.type,
      currency: f.currency,
      low: plainNumber(f.low),
      high: plainNumber(f.high),
      role: f.role,
      period: f.period ? f.period.text : "",
      period_end_date: f.periodEnd,
      period_inferred: f.periodInferred ? "true" : "false",
      label_confidence: f.labelConfidence,
      period_confidence: f.periodConfidence,
      change_value: plainNumber(changeValue),
      change_unit: change ? UNIT[change.type] || change.type : "",
      direction: f.direction,
      prior_value: f.prior && f.prior.value != null ? plainNumber(f.prior.value) : "",
      prior_period: f.prior ? f.prior.period : "",
      vs_estimate: f.vsEstimate,
      source_text: collapse(f.sentence).slice(0, 200),
      page_url: location.href,
      published_date: page && page.publishedDate,
      captured_at: capturedAt,
    };
  }

  // Every row (main, "Show all" and "Also caught") as CSV, with a UTF-8 BOM so Excel reads
  // £, € and – correctly.
  function csvText(rows, also, page) {
    const capturedAt = new Date().toISOString();
    const records = [...rows.map((r) => r.fact), ...also].map((f) => csvRecord(f, page, capturedAt));
    const lines = [CSV_COLUMNS.join(","), ...records.map((r) => CSV_COLUMNS.map((c) => csvField(r[c])).join(","))];
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  // ---- Excel export ----

  // The Excel sheet has the CSV's columns in the same order, apart from "figure": its "value"
  // column holds the number, with a number format that displays it as the card does ($482.6M,
  // 14.2%, 40 bps, $1.24, 2.5x). Ranges show low and high, each formatted, with value blank.
  const XLSX_COLUMNS = CSV_COLUMNS.filter((c) => c !== "figure");
  const MAX_WIDTH = 40;
  const WIDE = { source_text: 60 }; // wrapped, at this width
  const MONEY_SCALE = [
    [1e12, ",,,,", "T"],
    [1e9, ",,,", "B"],
    [1e6, ",,", "M"],
  ];

  const quoted = (s) => `"${s}"`;
  // The decimal places a displayed figure uses ("$54.0B" -> 1, "$1.24" -> 2, "14%" -> 0).
  const decimalsIn = (text) => {
    const m = String(text || "").match(/\d[\d,]*(?:\.(\d+))?/);
    return m && m[1] ? m[1].length : 0;
  };
  const digits = (decimals) => (decimals ? `0.${"0".repeat(decimals)}` : "0");

  // An Excel cell for a number in a unit, formatted like `shown` (how the card displays it):
  // { value, format, text }. Negative numbers show the card's "−"; "+" stays where it's shown.
  function formattedCell(value, unit, currency, shown) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    const d = digits(decimalsIn(shown));
    const sym = quoted(window.FrogbotFacts.symbol(currency) || "");
    let v = Number(value);
    let pos;
    if (unit === "money") {
      const scale = MONEY_SCALE.find(([at]) => Math.abs(v) >= at);
      pos = scale ? `${sym}#,##${d}${scale[1]}"${scale[2]}"` : `${sym}#,##${d}`;
    } else if (unit === "per_share") pos = `${sym}#,##0.00`;
    else if (unit === "percent") {
      v /= 100; // Excel keeps percentages as fractions
      pos = `${d}%`;
    } else if (unit === "basis_points") pos = `${d}" bps"`;
    else if (unit === "percentage_points") {
      // Points are a change, so a rise always shows its sign: "+1.4 pts".
      const points = `${d}" pts"`;
      return { value: Number(v.toPrecision(15)), format: `"+"${points};"−"${points};${points}`, text: String(shown || value) };
    }
    else if (unit === "multiple") pos = `${d}"x"`;
    else pos = d; // counts show no thousands separator on the card either
    const plus = /^\+/.test(String(shown || "").trim()) ? '"+"' : "";
    const format = `${plus}${pos};"−"${pos};${pos}`;
    return { value: Number(v.toPrecision(15)), format, text: String(shown || value) };
  }

  // A range's display split into its ends ("$505M–$525M" -> ["$505M", "$525M"]).
  const rangeEnds = (display) => String(display || "").split(/\s*[–—]\s*|\s+to\s+/);
  // The figure alone, without a guidance tolerance ("$54.0B ±2%" -> "$54.0B").
  const figureOnly = (display) => String(display || "").split(/\s+±/)[0];

  function xlsxRow(f, page, capturedAt) {
    const r = csvRecord(f, page, capturedAt);
    const unit = r.unit;
    const range = f.low != null && f.high != null;
    const [lowShown, highShown] = rangeEnds(f.display);
    const change = f.direction && f.change ? f.change : null;
    const cells = {
      format_version: Number(CSV_VERSION),
      value: range ? null : formattedCell(f.value, unit, f.currency, figureOnly(f.display)),
      low: range ? formattedCell(f.low, unit, f.currency, lowShown) : null,
      high: range ? formattedCell(f.high, unit, f.currency, highShown) : null,
      change_value: change && r.change_value !== "" ? formattedCell(Number(r.change_value), r.change_unit, f.currency, change.display) : null,
      prior_value: f.prior && r.prior_value !== "" ? formattedCell(f.prior.value, f.prior.unit || unit, f.currency, f.prior.display) : null,
      period_end_date: r.period_end_date ? { date: r.period_end_date, text: r.period_end_date } : null,
      published_date: r.published_date ? { date: r.published_date, text: r.published_date } : null,
      captured_at: { dateTime: r.captured_at, text: "2026-01-01 00:00:00" },
    };
    return XLSX_COLUMNS.map((c) => (c in cells ? cells[c] : r[c] == null || r[c] === "" ? null : String(r[c])));
  }

  // Every row (main, "Show all" and "Also caught") as an .xlsx file's bytes.
  function xlsxBytes(rows, also, page) {
    const capturedAt = new Date().toISOString();
    const data = [...rows.map((r) => r.fact), ...also].map((f) => xlsxRow(f, page, capturedAt));
    // Widths fitted to the longest text in each column (and the header, plus room for its
    // filter button), up to a maximum; source_text wraps at a fixed width.
    const columns = XLSX_COLUMNS.map((header, i) => {
      const longest = data.reduce((most, row) => {
        const cell = row[i];
        const text = cell == null ? "" : typeof cell === "object" ? cell.text : String(cell);
        return Math.max(most, text.length);
      }, header.length + 3);
      if (WIDE[header]) return { header, width: Math.min(WIDE[header], longest + 2), wrap: true };
      return { header, width: Math.min(MAX_WIDTH, Math.max(8, longest + 2)) };
    });
    return window.FrogbotXlsx.build({ sheet: "Frogbot", columns, rows: data.map((row) => row.map(stripText)) });
  }
  const stripText = (cell) => (cell && typeof cell === "object" ? Object.fromEntries(Object.entries(cell).filter(([k]) => k !== "text")) : cell);

  // frogbot-<site>-<yyyy-mm-dd>.<ext>
  function exportName(ext) {
    const site = (location.hostname.replace(/^www\./, "") || "local").replace(/[^a-z0-9.-]+/gi, "-");
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `frogbot-${site}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`;
  }

  function downloadXlsx(rows, also, container, page) {
    save(new Blob([xlsxBytes(rows, also, page)], { type: window.FrogbotXlsx.MIME }), exportName("xlsx"), container);
  }

  // frogbot-<site>-<yyyy-mm-dd>.csv.
  function downloadCsv(rows, also, container, page) {
    save(new Blob([csvText(rows, also, page)], { type: "text/csv;charset=utf-8" }), exportName("csv"), container);
  }

  // Saves a Blob with a temporary download link.
  function save(blob, name, container) {
    const url = URL.createObjectURL(blob);
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

  // ---- Keeping clear of bars along the bottom of the window ----

  // How far up the card must sit to clear fixed or sticky elements along the bottom of the
  // window under it (cookie bars, sticky footers). Anything taller than half the window is a
  // full-screen dialog: the card waits underneath it, as before. Frogbot's own elements are
  // skipped.
  const MAX_BAR = 0.5;
  function bottomBars() {
    if (!card || !host) return 0;
    const lift = parseFloat(card.style.getPropertyValue("--lift")) || 0;
    const r = card.getBoundingClientRect();
    // The visible area, without a horizontal scrollbar (innerHeight includes it).
    const h = document.documentElement.clientHeight || window.innerHeight;
    const w = document.documentElement.clientWidth || window.innerWidth;
    let top = h;
    const checked = new Set();
    for (const fx of [0.05, 0.3, 0.5, 0.7, 0.95]) {
      const x = Math.min(w - 1, Math.max(0, r.left + r.width * fx));
      // From the bottom edge up to where the card's bottom would be without any lift.
      for (const y of [h - 2, h - 12, h - 30, h - 60, h - 100, h - 160]) {
        if (y < r.bottom + lift - h * MAX_BAR) break;
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === host || el.closest("[data-frogbot], .frogbot-card-host")) continue;
          for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
            if (checked.has(e)) break;
            checked.add(e);
            const style = getComputedStyle(e);
            if (style.position !== "fixed" && style.position !== "sticky") continue;
            if (style.visibility === "hidden" || Number(style.opacity) === 0) break;
            const b = e.getBoundingClientRect();
            if (b.height > h * MAX_BAR || b.width === 0 || b.height === 0) break; // a full-screen dialog
            if (b.bottom < h - 4) break; // not along the bottom
            top = Math.min(top, b.top);
            break;
          }
        }
      }
    }
    return Math.max(0, Math.round(h - top));
  }

  let watch = null;
  // Moves the card up (or back down) to clear bottom bars; true if it moved.
  function placeAboveBars() {
    if (!card) return false;
    const now = parseFloat(card.style.getPropertyValue("--lift")) || 0;
    const lift = bottomBars();
    if (Math.abs(lift - now) < 2) return false;
    card.style.setProperty("--lift", `${lift}px`);
    return true;
  }

  window.FrogbotCard = {
    // Renders the card. options.hidden: lay it out invisibly (to measure where the frog
    // should land) until reveal(). options.onClose: the × button. options.onJump(fact,
    // sourceIndex): a row or a summary number was clicked. options.summary: { kind, sentences }
    // from summary.js, shown above the table. options.ai: the AI summary's progress ({ phase,
    // progress }), and options.onGetAI(): the download button was clicked. options.onMove():
    // the card moved to clear (or stop clearing) a bar along the bottom of the window.
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
      // Clear any cookie bar or sticky footer now, then again whenever the window resizes or a
      // bar comes or goes; options.onMove() is told so the frog can follow.
      placeAboveBars();
      const recheck = () => {
        if (placeAboveBars() && options.onMove) options.onMove();
      };
      watch = { timer: setInterval(recheck, 700), recheck };
      window.addEventListener("resize", recheck);
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

    // The AI summary's progress changed: { phase, progress, summary }. An accepted AI summary
    // (phase "done") replaces the rules summary.
    updateAI(ai) {
      if (!summaryView || !card || !summaryView.section.isConnected) return;
      if (ai.phase === "done" && ai.summary && ai.summary.sentences.length) fillSummary(summaryView, ai.summary);
      fillStatus(summaryView, ai);
    },

    isShowing() {
      return Boolean(host && host.isConnected);
    },

    hide() {
      if (watch) {
        clearInterval(watch.timer);
        window.removeEventListener("resize", watch.recheck);
        watch = null;
      }
      summaryView = null;
      if (host) host.remove();
      host = null;
      card = null;
    },
  };
})();
