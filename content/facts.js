// Frogbot: fact records (milestone 2, step 10). One clean record per figure the frog caught,
// the data behind the end-of-run stat card. Pure: it reads the chosen targets' units (from
// extract.js and score.js) and never touches the page.
(() => {
  const Score =
    (typeof window !== "undefined" && window.FrogbotScore) ||
    (typeof require !== "undefined" ? require("./score.js") : null);

  // ---------------------------------------------------------------------------
  // Vocabulary
  // ---------------------------------------------------------------------------

  // Finance terms and their canonical labels. Specific terms come first: on the same end
  // position the longer match wins anyway ("gross margin" over "margin").
  const TERMS = [
    ["Free cash flow", /\bfree cash flows?\b/gi],
    ["Operating cash flow", /\b(?:operating cash flows?|cash (?:flow )?from operations)\b/gi],
    ["Gross margin", /\bgross margins?\b/gi],
    ["Operating margin", /\boperating margins?\b/gi],
    ["Gross profit", /\bgross profits?\b/gi],
    ["Operating income", /\b(?:operating (?:income|profits?|loss)|income from operations)\b/gi],
    ["Operating expenses", /\b(?:operating expenses?|opex)\b/gi],
    ["Net income", /\bnet (?:income|profits?|earnings|loss)\b/gi],
    ["EPS", /\b(?:EPS|(?:net )?(?:income|earnings) per (?:diluted |basic )?(?:common )?share|earnings per (?:diluted |basic )?(?:common )?share)\b/gi],
    ["Capital expenditure", /\b(?:capital (?:expenditures?|spending)|capex)\b/gi],
    ["Dividend", /\bdividends?\b/gi],
    ["Buyback", /\b(?:buybacks?|share repurchases?|repurchases?)\b/gi],
    ["Revenue", /\b(?:revenues?|net sales|sales|turnover)\b/gi],
    ["Cash", /\bcash(?: and (?:cash )?equivalents)?\b/gi],
    ["Debt", /\b(?:net )?debt\b/gi],
    ["Margin", /\bmargins?\b/gi],
    ["Profit", /\bprofits?\b/gi],
    ["Earnings", /\bearnings\b/gi],
    ["Market cap", /\bmarket (?:cap|capitalization|value)\b/gi],
  ];
  const TOPIC_OF_LABEL = {
    Revenue: "revenue/sales",
    "Gross profit": "gross profit",
    "Operating income": "operating income",
    "Net income": "net income",
    Profit: "net income",
    Earnings: "net income",
    EPS: "EPS/per share",
    "Gross margin": "margin",
    "Operating margin": "margin",
    Margin: "margin",
    "Free cash flow": "cash flow",
    "Operating cash flow": "cash flow",
    Debt: "debt",
    Dividend: "dividend/buyback",
    Buyback: "dividend/buyback",
  };
  const PER_SHARE_LABELS = new Set(["EPS", "Dividend"]);

  // Words that change a figure's meaning. Segment names are found separately.
  const FIXED_QUALIFIER = /^(?:GAAP|non-GAAP|adjusted|diluted|basic|organic|constant-currency)$/i;
  // Capitalised words that aren't segment names when they sit before a finance term.
  const NOT_SEGMENT = /^(?:The|A|An|Its|Their|Our|His|Her|This|That|Total|Quarterly|Annual|Record|New|Strong|Overall|Company|Group|Full-year|Fiscal|Second-quarter|Third-quarter|Fourth-quarter|First-quarter|Q[1-4]|H[12]|GAAP|Non-GAAP|Adjusted|Diluted|Basic)$/;
  // Headings that are section titles rather than segment names.
  const GENERIC_HEADING = /^(?:highlights?|summary|overview|outlook|results?|financial|quarterly|full[\s-]year|fourth|third|second|first|q[1-4]|recent|business|key|about|forward|conference|cfo|commentary|earnings|segments?|performance|guidance|dividends?|capital|returns?|news|update)\b/i;

  const KEY_TYPES = new Set(["money", "perShare", "percent", "basisPoints", "multiple"]);
  const WHEN_TYPES = new Set(["period", "date", "year"]);
  const CHANGE_BEFORE =
    /\b(?:up|down|rose|rise|fell|fall|grew|grow|increased?|decreased?|declined?|jumped|climbed|slipped|gained|lost|expanded|contracted|improved|widened|narrowed|dropped|surged|soared|plunged|slid|raised|cut|lowered|boosted|trimmed|by|increase of|decrease of|decline of|growth(?: rate)? of|gain of|drop of|rise of|(?:increase|decrease|decline|growth|gain|drop|rise) (?:was|were|is)(?:\s+at)?)\s+(?:by\s+)?(?:about\s+|approximately\s+|roughly\s+|nearly\s+|almost\s+|more than\s+)?$/i;
  const CHANGE_AFTER = /^\s*(?:(?:year|quarter)[\s-](?:over|on)[\s-](?:year|quarter)|sequential(?:ly)?\b|from\b|higher|lower|increase|decrease|growth|rise|gain|jump|drop|decline)/i;
  const CHANGE_HEADER = /\b(?:change|chg|q\/q|y\/y|yoy|qoq|growth|vs\.?|increase|decrease|%)\b|%/i;
  // Estimates: "Analysts expected revenue of $10.2B" (an analyst subject, no comma between),
  // "the consensus estimate of $1.35", or "the $2.98 consensus" / "the 29.2% expectation".
  // "above consensus estimates, with 24% having reported" is not an estimate.
  const ESTIMATE_SUBJECT = /\b(?:analysts?|Wall Street|the Street|economists?|forecasters?)\b[^.;,]{0,40}$/i;
  const ESTIMATE_DIRECT = /\b(?:consensus|estimates?|expectations?|forecasts?)\s+(?:estimates?\s+)?(?:of|for|at|was|were|is|stood at|calls? for|called for)\s+(?:about\s+|around\s+|approximately\s+|roughly\s+)?$/i;
  const ESTIMATE_AFTER = /^\s*(?:consensus|analyst|estimate|expectation|expected by analysts)/i;
  const CLAUSE_BREAK = /;|:\s|,\s*(?:and|but|while|whereas|although|though)\s|\s(?:while|whereas|but)\s/gi;
  const COMPARISON_MARKER = /over|on[\s-]year|sequential|yoy|qoq|[yq]\/[yq]/i;

  const CURRENCY_SYMBOL = { USD: "$", GBP: "£", EUR: "€", JPY: "¥", INR: "₹", CAD: "C$", AUD: "A$", HKD: "HK$" };
  const SCALE_FACTOR = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
  const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
  const PERIOD_CONFIDENCE = { clause: "high", sentence: "medium", table: "medium", listIntro: "medium", heading: "medium", page: "low" };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const collapse = (s) => (s || "").replace(/\s+/g, " ").trim();

  // [start, end) ranges of the clauses in a text.
  function clauses(text) {
    const cuts = [0];
    CLAUSE_BREAK.lastIndex = 0;
    for (const m of text.matchAll(CLAUSE_BREAK)) cuts.push(m.index + 1);
    cuts.push(text.length);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) out.push([cuts[i], cuts[i + 1]]);
    return out;
  }
  const clauseIndex = (ranges, pos) => ranges.findIndex(([s, e]) => pos >= s && pos < e);

  // The finance term ending closest before `pos` within [from, pos): { label, start, end }.
  function termBefore(text, from, pos) {
    const slice = text.slice(from, pos);
    let best = null;
    for (const [label, re] of TERMS) {
      re.lastIndex = 0;
      for (const m of slice.matchAll(re)) {
        const end = m.index + m[0].length;
        if (!best || end > best.end || (end === best.end && m[0].length > best.length)) {
          best = { label, start: from + m.index, end: from + end, length: m[0].length };
        }
      }
    }
    return best;
  }

  // Qualifiers written directly before a term: "non-GAAP", "diluted", or a segment name
  // ("Data Center", "Gaming"); plus "<Name> segment" anywhere earlier in the clause.
  function qualifiersBefore(text, clauseStart, termStart) {
    const words = text.slice(clauseStart, termStart).trim().split(/\s+/).filter(Boolean);
    const fixed = [];
    const segment = [];
    for (let i = words.length - 1; i >= 0 && words.length - i <= 4; i--) {
      const w = words[i].replace(/[,()]/g, "");
      if (FIXED_QUALIFIER.test(w)) fixed.unshift(w);
      else if (/^[A-Z][\w&.-]*$/.test(w) && !NOT_SEGMENT.test(w) && !/'s$|’s$/.test(w) && !fixed.length) segment.unshift(w);
      else break;
    }
    const seg = segmentPhrase(text.slice(clauseStart, termStart));
    // A ticker repeating the name adds nothing: "Meta Platforms META earnings".
    const named = segment.filter((w, i) => !segment.slice(0, i).some((x) => x.toUpperCase() === w.toUpperCase()));
    const segmentName = named.length ? named.join(" ") : seg;
    return [...fixed.map(normaliseQualifier), ...(segmentName ? [segmentName] : [])];
  }
  // "<Name> segment" -> "Name", without a leading "The"/"Its".
  function segmentPhrase(text) {
    const m = text.match(/\b((?:[A-Z][\w&-]*\s){1,4})segment\b/);
    if (!m) return null;
    const words = m[1].trim().split(/\s+/);
    while (words.length && NOT_SEGMENT.test(words[0])) words.shift();
    return words.length ? words.join(" ") : null;
  }

  const normaliseQualifier = (q) => (/^non-gaap$/i.test(q) ? "non-GAAP" : /^gaap$/i.test(q) ? "GAAP" : q.toLowerCase());

  // "GAAP and non-GAAP gross margins were 72.4% and 72.7%, respectively": qualifier per figure.
  function respectively(text, clauseRange) {
    const clause = text.slice(...clauseRange);
    if (!/respectively/i.test(clause)) return null;
    const m = clause.match(/\b(GAAP|non-GAAP|adjusted|basic|diluted)\s+and\s+(GAAP|non-GAAP|adjusted|basic|diluted)\b/i);
    return m ? [normaliseQualifier(m[1]), normaliseQualifier(m[2])] : null;
  }

  const labelFrom = (qualifiers, base) => {
    const lowerBase = /^(?:EPS|[A-Z]{2,})\b/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1);
    const text = qualifiers.length ? `${qualifiers.join(" ")} ${lowerBase}` : base;
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  // A table row's header cell, cleaned: "Diluted earnings per share (1)" -> "Diluted earnings per share".
  const cleanRowHeader = (s) => collapse(s.replace(/\(\s*\d+\s*\)|\[\s*\d+\s*\]|\d+$/g, "").replace(/[:*†‡]+$/, ""));

  // Canonical label and qualifiers for a row header ("Diluted earnings per share" -> EPS, diluted).
  function labelForText(text) {
    const term = termBefore(text, 0, text.length);
    if (!term) return { base: text, qualifiers: [] };
    return { base: term.label, qualifiers: qualifiersBefore(text, 0, term.start) };
  }

  function periodOf(n) {
    if (!n) return null;
    return { text: n.raw, value: typeof n.value === "number" ? n.value : null };
  }
  const isPeriodNumber = (n) => !n.junk && WHEN_TYPES.has(n.type) && !n.decade && !COMPARISON_MARKER.test(n.raw);
  // The best period in a list intro or heading (real periods first, then the one nearest the end).
  function periodIn(text) {
    if (!text) return null;
    const found = Score.detectNumbers(text).filter(isPeriodNumber);
    return found.length ? bestPeriod(found, { start: text.length }) : null;
  }
  const periodKey = (p) => (p ? collapse(p.text).toLowerCase() : "");

  function symbol(currency) {
    if (!currency) return "";
    return CURRENCY_SYMBOL[currency] || `${currency} `;
  }

  function formatMoney(v, currency, perShare, decimals = 1) {
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    const sym = symbol(currency);
    if (perShare) return `${sign}${sym}${a.toFixed(2)}`;
    const one = (x) => (decimals === 1 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(decimals));
    if (a >= 1e12) return `${sign}${sym}${one(a / 1e12)}T`;
    if (a >= 1e9) return `${sign}${sym}${one(a / 1e9)}B`;
    if (a >= 1e6) return `${sign}${sym}${one(a / 1e6)}M`;
    return `${sign}${sym}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }

  function formatValue(v, f, decimals = 1) {
    if (f.type === "money" || f.type === "perShare") return formatMoney(v, f.currency, f.perShare, decimals);
    const sign = f.signed && v > 0 ? "+" : v < 0 ? "−" : "";
    const a = Math.abs(v);
    if (f.type === "percent") return `${sign}${a}%`;
    if (f.type === "basisPoints") return `${sign}${a} bps`;
    if (f.type === "multiple") return `${a}x`;
    return `${sign}${a}`;
  }

  function display(f) {
    if (f.low != null && f.high != null) {
      // "$1.86 billion to $1.88 billion" mustn't become "$1.9B–$1.9B": add a decimal if needed.
      let lo = formatValue(f.low, f);
      let hi = formatValue(f.high, { ...f, signed: false });
      if (lo === hi) {
        lo = formatValue(f.low, f, 2);
        hi = formatValue(f.high, { ...f, signed: false }, 2);
      }
      return `${lo}–${hi}`;
    }
    return formatValue(f.value, f);
  }

  // Same figure for merging: money compares significant digits within 0.5% (a table's
  // "$46,743" in millions is "$46.7 billion"); everything else must match exactly.
  function sameFigure(a, b) {
    const group = (t) => (t === "money" || t === "perShare" ? "money" : t);
    if (group(a.type) !== group(b.type)) return false;
    if (a.value === 0 || b.value === 0) return a.value === b.value;
    if (group(a.type) !== "money") return a.value === b.value;
    const digits = (v) => Math.abs(v) / 10 ** Math.floor(Math.log10(Math.abs(v)));
    return Math.abs(digits(a.value) - digits(b.value)) <= digits(b.value) * 0.005;
  }

  // ---------------------------------------------------------------------------
  // Facts from one unit
  // ---------------------------------------------------------------------------

  function factsFromUnit(unit, ctx) {
    const numbers = unit.numbers || Score.detectNumbers(unit.text, { inTable: unit.kind === "row" });
    const groups = Score.figureGroups(numbers, unit.text);
    if (!groups.length) return [];
    return unit.kind === "row" ? rowFacts(unit, numbers, groups, ctx) : sentenceFacts(unit, numbers, groups, ctx);
  }

  function baseFact(unit, n, ctx) {
    const scale = n.scale || null;
    return {
      id: null,
      label: null,
      topic: null,
      qualifiers: [],
      value: n.value,
      low: n.low ?? null,
      high: n.high ?? null,
      type: n.type,
      currency: n.currency || null,
      scale,
      display: null,
      raw: n.raw,
      role: "level",
      period: null,
      periodSource: null,
      sentence: unit.text,
      blockIndex: unit.blockIndexes ? unit.blockIndexes[0] : null,
      matchStart: (unit.sentence ? unit.sentence.start : 0) + n.start,
      matchEnd: (unit.sentence ? unit.sentence.start : 0) + n.end,
      sources: [],
      labelConfidence: "low",
      periodConfidence: null,
      confidence: "low",
      periodInferred: false,
      showOnCard: false,
      kind: unit.kind,
      signed: /^\+/.test(n.raw),
      _unit: unit,
      _n: n,
    };
  }

  function sentenceFacts(unit, numbers, groups, ctx) {
    const text = unit.text;
    const ranges = clauses(text);
    const periods = numbers.filter(isPeriodNumber);
    const isGuidance = Score.topicOf(text) === "guidance/outlook/forecast";
    const facts = [];

    groups.forEach((group, gi) => {
      const n = group.figure;
      const f = baseFact(unit, n, ctx);
      const ci = clauseIndex(ranges, n.start);
      const [cs, ce] = ranges[ci];
      const before = text.slice(cs, n.start);
      const after = text.slice(n.end, ce);

      // Label: the nearest finance term before the figure in its clause, else in an earlier
      // clause of the sentence (medium), else a guidance metric, else a snippet (low).
      let labelSource = "term";
      let term = termBefore(text, cs, n.start);
      if (!term) {
        term = termBefore(text, 0, cs);
        labelSource = term ? "sentence" : "fallback";
      }
      let qualifiers = term ? qualifiersBefore(text, term.start >= cs ? cs : 0, term.start) : [];
      // A segment named before the figure in its own clause ("the Garden Water segment grew").
      if (term && term.start < cs) {
        const seg = segmentPhrase(text.slice(cs, n.start));
        if (seg && !qualifiers.includes(seg)) qualifiers = [...qualifiers.filter((q) => !/^[A-Z]/.test(q) || FIXED_QUALIFIER.test(q)), seg];
      }
      const resp = respectively(text, ranges[ci]);
      if (resp) {
        const inClause = groups.filter((g) => clauseIndex(ranges, g.figure.start) === ci);
        const idx = inClause.indexOf(group);
        if (idx >= 0 && idx < resp.length) {
          qualifiers = [resp[idx], ...qualifiers.filter((q) => !FIXED_QUALIFIER.test(q))];
        }
      }
      // The heading as a segment name ("Data Center" above "Second-quarter revenue was ...").
      if (term && !qualifiers.some((q) => /^[A-Z]/.test(q) && !/^(?:GAAP|non-GAAP)$/.test(q)) && unit.heading) {
        const h = collapse(unit.heading);
        const titleCase = h.split(" ").every((w) => /^(?:and|&|of|the|for)$/.test(w) || /^[A-Z]/.test(w));
        if (h.split(" ").length <= 4 && titleCase && !GENERIC_HEADING.test(h) && !/\d/.test(h)) qualifiers.push(h);
      }

      // Role.
      if (isGuidance) f.role = "guidance";
      else if (ESTIMATE_SUBJECT.test(before) || ESTIMATE_DIRECT.test(before) || ESTIMATE_AFTER.test(after)) f.role = "estimate";
      else if (isChange(n, before, after)) f.role = "change";

      // Label text.
      const base = term ? term.label : null;
      if (base) {
        f.label = labelFrom(qualifiers, base);
        f.topic = TOPIC_OF_LABEL[base] || "other";
      } else {
        const words = collapse(before).split(" ").filter((w) => /\w/.test(w)).slice(-5);
        const snippet = words.length >= 2 ? words.join(" ") : collapse(after).split(" ").slice(0, 5).join(" ");
        f.label = snippet.replace(/[,(]+$/, "") || n.raw;
        f.topic = "other";
      }
      if (f.role === "guidance") f.label = `Guidance: ${f.label}`;
      if (f.role === "guidance") f.topic = "guidance/outlook/forecast";
      f.qualifiers = qualifiers;
      f.perShare = n.type === "perShare" || (base && PER_SHARE_LABELS.has(base) && Math.abs(n.value) < 1000);

      // Period: attached / same clause, then elsewhere in the sentence, then the line that
      // introduces the list, then the nearest heading (or the page title before any
      // heading), then the page's. Guidance never takes the page's period: it's usually the
      // quarter just reported, not the one being guided.
      const inClause = periods.filter((p) => clauseIndex(ranges, p.start) === ci);
      const attached = group.extras.filter(isPeriodNumber);
      const candidates = [...new Set([...attached, ...inClause])];
      let intro;
      let heading;
      if (candidates.length) {
        f.period = periodOf(bestPeriod(candidates, n));
        f.periodSource = "clause";
      } else if (periods.length) {
        f.period = periodOf(bestPeriod(periods, n));
        f.periodSource = "sentence";
      } else if ((intro = periodIn(unit.listIntro))) {
        f.period = periodOf(intro);
        f.periodSource = "listIntro";
      } else if ((heading = periodIn(unit.heading || unit.pageTitle))) {
        f.period = periodOf(heading);
        f.periodSource = "heading";
      } else if (ctx.pagePeriod && f.role !== "guidance") {
        f.period = { ...ctx.pagePeriod };
        f.periodSource = "page";
      }

      f._labelSource = labelSource;
      f._clause = ci;
      facts.push(f);
    });

    // Changes link to the level in the same clause with the same label.
    for (const c of facts) {
      if (c.role !== "change") continue;
      const level = facts
        .filter((l) => l.role === "level" && l._clause === c._clause && l.label === c.label)
        .sort((a, b) => Math.abs(a._n.start - c._n.start) - Math.abs(b._n.start - c._n.start))[0];
      if (level) link(level, c);
    }
    return facts;
  }

  function isChange(n, before, after) {
    if (n.type === "multiple") return false;
    if (/^[+\-−]/.test(n.raw)) return true;
    // Before the to/at check: "the increase was at 36%" is a change, "rose to $83B" isn't.
    if (CHANGE_BEFORE.test(before)) return true;
    if (/\bto\s+$/i.test(before) || /\bat\s+$/i.test(before)) return false;
    if (n.type === "percent" || n.type === "basisPoints") return CHANGE_AFTER.test(after) || n.type === "basisPoints";
    return false;
  }

  function rowFacts(unit, numbers, groups, ctx) {
    const cells = unit.cells || [];
    const cellAt = (pos) => cells.find((c) => pos >= c.start && pos < c.end);
    const headerCell = cells[0];
    const firstHasFigure = groups.some((g) => cellAt(g.figure.start) === headerCell);
    const rowHeader = headerCell && !firstHasFigure ? cleanRowHeader(headerCell.text) : null;
    const { base, qualifiers: rowQualifiers } = rowHeader ? labelForText(rowHeader) : { base: null, qualifiers: [] };
    const titleQualifier = (unit.tableTitle || "").match(/\b(non-GAAP|GAAP|adjusted)\b/i);
    const qualifiers = [...(titleQualifier ? [normaliseQualifier(titleQualifier[1])] : []), ...rowQualifiers];
    const facts = [];

    for (const group of groups) {
      const n = group.figure;
      const f = baseFact(unit, n, ctx);
      const cell = cellAt(n.start);
      const header = cell && cell.header ? collapse(cell.header) : null;
      f.matchStart = n.start;
      f.matchEnd = n.end;

      if (base) {
        f.label = labelFrom(qualifiers, base === rowHeader ? rowHeader : base);
        f.topic = TOPIC_OF_LABEL[base] || "other";
      } else {
        f.label = rowHeader || n.raw;
        f.topic = "other";
      }
      f.qualifiers = qualifiers;
      f._labelSource = rowHeader ? "row" : "fallback";

      if (/^[+\-−]/.test(n.raw) || (header && CHANGE_HEADER.test(header) && !Score.detectNumbers(header).some(isPeriodNumber))) {
        f.role = "change";
      }
      f.perShare = n.type === "perShare" || (base && PER_SHARE_LABELS.has(base));
      // A table "in millions": scale money that has no scale word of its own.
      if (unit.tableScale && n.type === "money" && !n.scale && !f.perShare) {
        const factor = SCALE_FACTOR[unit.tableScale];
        f.value = n.value * factor;
        if (f.low != null) f.low *= factor;
        if (f.high != null) f.high *= factor;
        f.scale = unit.tableScale;
      }

      const headerPeriod = header ? Score.detectNumbers(header).find(isPeriodNumber) : null;
      const attached = group.extras.filter(isPeriodNumber);
      let heading;
      if (attached.length) {
        // A period in the figure's own cell: "US$215.9 billion (FY26)".
        f.period = periodOf(bestPeriod(attached, n));
        f.periodSource = "clause";
      } else if (headerPeriod) {
        f.period = { text: header, value: typeof headerPeriod.value === "number" ? headerPeriod.value : null };
        f.periodSource = "table";
      } else if (f.role === "change") {
        // A "Change" column compares two periods; it has no single period of its own.
      } else if ((heading = periodIn(unit.heading || unit.pageTitle))) {
        f.period = periodOf(heading);
        f.periodSource = "heading";
      } else if (ctx.pagePeriod) {
        f.period = { ...ctx.pagePeriod };
        f.periodSource = "page";
      }
      f._clause = 0;
      facts.push(f);
    }

    // Row changes ("+14.2%" under "Change") link to the row's first level (the current period).
    const firstLevel = facts.find((x) => x.role === "level");
    for (const c of facts) if (c.role === "change" && firstLevel) link(firstLevel, c);
    return facts;
  }

  // high: a table row header, or a finance term in the figure's own clause with nothing
  // added. medium: a label with qualifiers or a segment, a term from an earlier clause, or a
  // guidance label. low: a snippet of the text before the figure.
  function labelConfidenceOf(f) {
    if (f._labelSource === "fallback") return "low";
    if (f._labelSource === "row") return "high";
    if (f.role === "guidance" || f._labelSource === "sentence" || f.qualifiers.length) return "medium";
    return "high";
  }

  // Every change records its level; the level keeps the first change it was given.
  function link(level, change) {
    if (change._linkedTo) return;
    if (!level._changeOf) level._changeOf = change;
    change._linkedTo = level;
  }

  // Of several candidate periods, prefer a real period ("second quarter") over a year, and a
  // year over a date ("July 27, 2025"); then the one nearest the figure.
  const PERIOD_RANK = { period: 0, year: 1, date: 2 };
  function bestPeriod(list, n) {
    return list
      .slice()
      .sort((a, b) => PERIOD_RANK[a.type] - PERIOD_RANK[b.type] || Math.abs(a.start - n.start) - Math.abs(b.start - n.start))[0];
  }

  // ---------------------------------------------------------------------------
  // The page's dominant period
  // ---------------------------------------------------------------------------

  // The most common period among the chosen targets: their own periods (not guidance) and,
  // for table rows, periods in their cells or the column headers above their figures. Only
  // real periods count ("Q3 2026", "FY26"), not one-off dates or bare years. Ties go to the
  // first seen.
  function dominantPeriod(units) {
    const counts = new Map();
    const add = (text, value) => {
      const key = collapse(text).toLowerCase();
      const entry = counts.get(key) || { text: collapse(text), value, count: 0, order: counts.size };
      entry.count += 1;
      counts.set(key, entry);
    };
    for (const unit of units) {
      if (unit.kind === "row") {
        for (const n of unit.numbers || []) if (isPeriodNumber(n) && n.type === "period") add(n.raw, typeof n.value === "number" ? n.value : null);
        for (const cell of unit.cells || []) {
          if (!cell.header) continue;
          const p = Score.detectNumbers(cell.header).find((x) => isPeriodNumber(x) && x.type === "period");
          if (p && Score.detectNumbers(cell.text, { inTable: true }).some((x) => !x.junk && KEY_TYPES.has(x.type))) {
            add(cell.header, typeof p.value === "number" ? p.value : null);
          }
        }
        continue;
      }
      if (Score.topicOf(unit.text) === "guidance/outlook/forecast") continue;
      for (const n of unit.numbers || []) if (isPeriodNumber(n) && n.type === "period") add(n.raw, typeof n.value === "number" ? n.value : null);
    }
    let best = null;
    for (const e of counts.values()) {
      if (!best || e.count > best.count || (e.count === best.count && e.order < best.order)) best = e;
    }
    return best ? { text: best.text, value: best.value } : null;
  }

  // ---------------------------------------------------------------------------
  // Public: buildFacts
  // ---------------------------------------------------------------------------

  // targets: [{ units }] from main.js (chosen units grouped by element). blocks is accepted
  // for symmetry with the rest of the pipeline. context: { pagePeriod } overrides the page's
  // dominant period (tests). Returns fact records in page order (see README "Fact records").
  function buildFacts(targets, blocks, context = {}) {
    const units = targets.flatMap((t) => t.units || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const pagePeriod = context.pagePeriod !== undefined ? context.pagePeriod : dominantPeriod(units);
    const ctx = { pagePeriod };
    const all = units.flatMap((unit) => factsFromUnit(unit, ctx));

    for (const f of all) {
      f.display = display(f);
      f.labelConfidence = labelConfidenceOf(f);
      f.periodConfidence = f.periodSource ? PERIOD_CONFIDENCE[f.periodSource] : null;
      // Overall: the lower of the two (a missing period doesn't lower it).
      f.confidence =
        f.periodConfidence && CONFIDENCE_RANK[f.periodConfidence] < CONFIDENCE_RANK[f.labelConfidence] ? f.periodConfidence : f.labelConfidence;
      f.periodInferred = f.periodConfidence === "low";
      f.sources = [{ blockIndex: f.blockIndex, kind: f.kind, text: f.sentence, matchStart: f.matchStart, matchEnd: f.matchEnd }];
    }

    // Merge repeats: same figure, label, qualifiers, period and role. Keep the best-labelled
    // record (highest confidence; prose before table on ties) and list every source.
    const kept = [];
    for (const f of all) {
      const twin = kept.find(
        (k) =>
          k.label.toLowerCase() === f.label.toLowerCase() &&
          k.role === f.role &&
          k.qualifiers.join("|").toLowerCase() === f.qualifiers.join("|").toLowerCase() &&
          periodKey(k.period) === periodKey(f.period) &&
          sameFigure(k, f)
      );
      if (!twin) {
        kept.push(f);
        continue;
      }
      const better =
        CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[twin.confidence] ||
        (CONFIDENCE_RANK[f.confidence] === CONFIDENCE_RANK[twin.confidence] && f.kind === "sentence" && twin.kind === "row");
      const winner = better ? f : twin;
      const loser = better ? twin : f;
      winner.sources = [...twin.sources, ...f.sources].sort((a, b) => (a.blockIndex ?? 0) - (b.blockIndex ?? 0));
      loser._mergedInto = winner;
      if (better) kept[kept.indexOf(twin)] = f;
    }
    const resolve = (f) => {
      while (f && f._mergedInto) f = f._mergedInto;
      return f;
    };

    kept.forEach((f, i) => {
      f.id = `f${i + 1}`;
    });
    for (const f of kept) {
      const change = resolve(f._changeOf);
      if (change && kept.includes(change)) {
        f.change = { value: change.value, type: change.type, display: change.display, factId: change.id };
      }
      const level = resolve(f._linkedTo);
      if (level && kept.includes(level)) f.linkedTo = level.id;
    }
    // The stat card shows levels, guidance and changes with no level to sit beside, when the
    // label is a real one. Linked changes show with their level; snippet labels go in the
    // card's "Also caught" section.
    for (const f of kept) {
      const roleOk = f.role === "level" || f.role === "guidance" || (f.role === "change" && !f.linkedTo);
      f.showOnCard = f.labelConfidence !== "low" && roleOk;
    }
    return kept.map(({ _unit, _n, _labelSource, _clause, _changeOf, _linkedTo, _mergedInto, kind, perShare, signed, ...rest }) => rest);
  }

  const FrogbotFacts = { buildFacts, dominantPeriod };
  if (typeof window !== "undefined" && !window.FrogbotFacts) window.FrogbotFacts = FrogbotFacts;
  if (typeof module !== "undefined" && module.exports) module.exports = FrogbotFacts;
})();
