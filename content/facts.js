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
    ["Operating cash flow", /\b(?:operating cash flows?|cash (?:flow )?from operations|net cash (?:provided by|from|generated (?:by|from)) operating activities)\b/gi],
    ["Gross margin", /\bgross margins?\b/gi],
    ["Operating margin", /\boperating margins?\b/gi],
    ["Net margin", /\bnet (?:profit )?margins?\b/gi],
    // EBITDA and EBIT are their own metrics, not operating income ("Adjusted EBITDA" is EBITDA,
    // qualified "adjusted").
    ["EBITDA", /\bEBITDA\b/g],
    ["EBIT", /\bEBIT\b/g],
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
    // Net debt, debt and net cash are different figures; the longer match wins, so "net debt"
    // is never just "Debt".
    ["Net debt", /\bnet debt\b/gi],
    ["Net cash", /\bnet cash(?: position)?\b/gi],
    ["Debt", /\b(?:total |gross )?debt\b/gi],
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
    "Net margin": "margin",
    Margin: "margin",
    EBITDA: "EBIT/EBITDA",
    EBIT: "EBIT/EBITDA",
    "Free cash flow": "cash flow",
    "Operating cash flow": "cash flow",
    Debt: "debt",
    "Net debt": "debt",
    "Net cash": "debt",
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
  const CLAUSE_BREAK = /;|:\s|,\s*(?:and|but|yet|while|whereas|although|though)\s|\s(?:while|whereas|but)\s/gi;
  const COMPARISON_MARKER = /over|on[\s-]year|sequential|yoy|qoq|[yq]\/[yq]/i;

  // Direction (step 11). A word must make the direction plain; anything else gives none.
  // "Flip" words change meaning with their subject ("the loss narrowed", "the decline
  // eased"), so for now they give no direction either.
  const UP_WORD = /^(?:rose|rise|rises|rising|grew|grow|grows|growing|growth|increased|increase|increases|increasing|jumped|jump|jumps|climbed|climb|climbs|surged|surge|surges|gained|gain|gains|improved|improve|improves|expanded|expand|expands|up|higher|beat|beats|topped|tops|exceeded|exceeds|record)$/i;
  const DOWN_WORD = /^(?:fell|fall|falls|falling|declined|decline|declines|declining|decreased|decrease|decreases|dropped|drop|drops|slipped|slips|slid|slide|slides|shrank|shrink|shrinks|shrunk|contracted|contracts|contraction|down|lower|missed|miss|misses)$/i;
  const FLAT_WORD = /^(?:unchanged|flat|steady|stable)$/i;
  const FLIP_WORD = /^(?:narrowed|narrowing|narrows|widened|widening|widens|eased|easing|eases|moderated|moderating|softened|softening|slowed|slowing|slows|deepened|deepening|accelerated|accelerating|decelerated|decelerating)$/i;
  const NEGATION = /^(?:not|no|never|without|failed|fail|fails|longer|cannot)$|n['’]t$/i;
  // The earlier value in a comparison: "up 14.2% from $422.6 million".
  const PRIOR_BEFORE = /\b(?:from|compared (?:with|to)|versus|vs\.?|against)\s+(?:about\s+|approximately\s+|roughly\s+|around\s+)?$/i;
  // A table cell showing a fall: "(3)%", "($1.2)", "(2.7) pts", "(62" (some tables put the
  // closing bracket in the next cell), "-3%", "−0.4". Not a footnote marker like "(1)".
  const NEGATIVE_CELL =
    /^(?:\(\s*[$€£¥]?\s?(?:\d[\d,]*\.\d+|\d{2,}[\d,]*|\d+(?=\s*\)?\s*(?:%|pts?|bps)))\s*\)?\s*(?:%|pts?|bps)?|[-−]\s?[$€£¥]?\d[\d,.]*\s*(?:%|pts?|bps)?)$/;
  // A share of a group, not a metric: "83% of S&P 500 companies", "78% of companies",
  // "24% having released results". And "the five-year average of 78%" beside one of those.
  const SHARE_AFTER =
    /^\s*(?:of\s+(?:[\w&.-]+\s+){0,3}?(?:companies|firms|stocks|members|constituents|respondents|analysts|investors|businesses|households|people|issuers|them|those|these)\b|(?:having|have|has|had)\s+(?:already\s+)?(?:reported|released|beaten|beat|missed|topped|exceeded|posted))/i;
  const AVERAGE_BEFORE = /\baverage(?:\s+of)?\s+$/i;
  const TOLERANCE_BEFORE = /(?:plus or minus|\+\/-|\+\/−|±)\s*$/i;
  const ESTIMATE_NOUN = String.raw`(?:consensus|estimates?|expectations?|forecasts?|analysts?|the Street|Wall Street)`;
  const ABOVE_ESTIMATE = new RegExp(String.raw`\b(?:beat|beats|beating)\b|\b(?:above|ahead of|topped|exceeded|surpassed)\s+(?:[\w-]+\s+){0,2}?` + ESTIMATE_NOUN + String.raw`\b`, "i");
  // A surprise against estimates, written right after the figure: "5.9% above estimates",
  // "$0.12 short of consensus". The figure is the size of the beat or miss, not the metric.
  const SURPRISE_AFTER = new RegExp(
    String.raw`^\s*(above|ahead of|better than|below|short of|behind|worse than)\s+(?:[\w-]+\s+){0,2}?` + ESTIMATE_NOUN + String.raw`\b`,
    "i"
  );
  const BELOW_ESTIMATE = new RegExp(String.raw`\b(?:missed|misses|missing)\b|\b(?:below|short of|behind)\s+(?:[\w-]+\s+){0,2}?` + ESTIMATE_NOUN + String.raw`\b`, "i");
  // Sentiment: which way is good, for canonical metrics only.
  const UP_IS_GOOD = new Set([
    "Revenue", "EBITDA", "EBIT", "Net margin", "Net cash", "Gross profit", "Operating income", "Net income", "Profit", "Earnings", "EPS", "Gross margin",
    "Operating margin", "Margin", "Free cash flow", "Operating cash flow", "Cash", "Dividend", "Buyback",
  ]);
  const UP_IS_BAD = new Set(["Operating expenses", "Debt", "Net debt"]);
  const NEUTRAL_METRIC = new Set(["Capital expenditure"]);

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

  function formatMoney(v, currency, perShare, decimals = null) {
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    const sym = symbol(currency);
    if (perShare) return `${sign}${sym}${a.toFixed(2)}`;
    const one = (x) => (decimals == null ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(decimals));
    if (a >= 1e12) return `${sign}${sym}${one(a / 1e12)}T`;
    if (a >= 1e9) return `${sign}${sym}${one(a / 1e9)}B`;
    if (a >= 1e6) return `${sign}${sym}${one(a / 1e6)}M`;
    return `${sign}${sym}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }

  function formatValue(v, f, decimals = null) {
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
    return formatValue(f.value, f, pagePlaces(f));
  }

  // Decimal places as the page wrote them ("$54.0 billion" -> "$54.0B"), when the display
  // unit is the unit the page used.
  function pagePlaces(f) {
    if (f.type !== "money" || !f.scale) return null;
    const m = f.raw.match(/\d[\d,]*(?:\.(\d+))?/);
    const places = m && m[1] ? m[1].length : 0;
    if (!places || places > 2) return null;
    const a = Math.abs(f.value);
    const unit = a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : null;
    return unit === SCALE_FACTOR[f.scale] ? places : null;
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
      score: unit.finalScore ?? unit.score ?? null,
      direction: null,
      directionSource: null,
      sentiment: null,
      vsEstimate: null,
      tolerance: null,
      priorPeriod: false,
      prior: null,
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
    const tolerances = [];
    const shares = new Set(groups.map((g) => g.figure).filter((n) => n.type === "percent" && SHARE_AFTER.test(text.slice(n.end))));

    groups.forEach((group, gi) => {
      const n = group.figure;
      const ci = clauseIndex(ranges, n.start);
      const [cs, ce] = ranges[ci];
      const before = text.slice(cs, n.start);
      const after = text.slice(n.end, ce);
      // "plus or minus 2%" on a guidance figure is its tolerance, not a fact of its own.
      if (isGuidance && gi > 0 && (n.type === "percent" || n.type === "basisPoints") && (/^±/.test(n.raw) || TOLERANCE_BEFORE.test(before))) {
        tolerances.push({ n, ci });
        return;
      }
      const f = baseFact(unit, n, ctx);
      // The text between this figure and its neighbours in the clause.
      const prevEnd = Math.max(cs, ...groups.map((g) => g.figure.end).filter((e) => e <= n.start));
      const nextStart = Math.min(ce, ...groups.map((g) => g.figure.start).filter((st) => st >= n.end));
      const near = text.slice(prevEnd, n.start);
      const nearAfter = text.slice(n.end, nextStart);

      // Label: the nearest finance term before the figure in its clause, else in an earlier
      // clause of the sentence (medium), else a guidance metric, else a snippet (low).
      // A share of a group of companies takes no metric label from the words around it.
      const isShare = shares.has(n) || (shares.size > 0 && n.type === "percent" && AVERAGE_BEFORE.test(before));
      let labelSource = "term";
      let term = isShare ? null : termBefore(text, cs, n.start);
      if (!term) {
        // A clause about the stock doesn't borrow an earlier clause's metric ("revenue
        // forecast fell short, yet the stock rose 5%").
        term = isShare || /\b(?:stock|shares|share price)\b/i.test(before) ? null : termBefore(text, 0, cs);
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
      const surprise = !isGuidance && (n.type === "percent" || n.type === "money" || n.type === "perShare") ? after.match(SURPRISE_AFTER) : null;
      if (isGuidance) f.role = "guidance";
      else if (surprise) {
        f.role = "estimate";
        f.vsEstimate = /^(?:above|ahead|better)/i.test(surprise[1]) ? "above" : "below";
      } else if (ESTIMATE_SUBJECT.test(before) || ESTIMATE_DIRECT.test(before) || ESTIMATE_AFTER.test(after)) f.role = "estimate";
      else if (isChange(n, before, after)) f.role = "change";

      // Label text.
      const base = term ? term.label : null;
      f._base = base;
      f._loss = Boolean(term && /\b(?:loss|losses|deficit)\b/i.test(text.slice(term.start, term.end)));
      if (base) {
        f.label = labelFrom(qualifiers, base);
        f.topic = TOPIC_OF_LABEL[base] || "other";
      } else {
        // A share reads best from the words after it ("of S&P 500 companies are").
        const words = collapse(before).split(" ").filter((w) => /\w/.test(w)).slice(-5);
        const following = collapse(after).split(" ").filter((w) => /\w/.test(w)).slice(0, 5).join(" ");
        const snippet = (!isShare || !following) && words.length >= 2 ? words.join(" ") : following;
        f.label = snippet.replace(/[,(.;:]+$/, "") || n.raw;
        f.topic = "other";
      }
      if (f.role === "guidance") f.label = `Guidance: ${f.label}`;
      if (f.role === "guidance") f.topic = "guidance/outlook/forecast";
      if (surprise && base) f.label = `${f.label} vs estimates`;
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

      // Direction: an explicit sign, a change word, or "from $X to $Y". The earlier value in
      // a comparison has none of its own.
      f._prior = f.role === "level" && PRIOR_BEFORE.test(near);
      if (!f._prior) {
        const words = directionFromWords(near, nearAfter);
        // "$5.2 billion, up from $4.8 billion": the words give the direction, and the two
        // values must agree with them.
        const upDownFrom = nearAfter.match(/^\s*,?\s*(up|down)\s+from\s+(?:about\s+|approximately\s+|roughly\s+|around\s+)?$/i);
        const fromFigure = upDownFrom && groups[groups.indexOf(group) + 1] && groups[groups.indexOf(group) + 1].figure;
        if (f.role === "change" && /^[+]/.test(n.raw)) setDirection(f, "up", "sign");
        else if (f.role === "change" && /^[-−]/.test(n.raw)) setDirection(f, "down", "sign");
        else if (fromFigure) {
          const said = upDownFrom[1].toLowerCase();
          if (!comparable(n, fromFigure) || compare(n.value, fromFigure.value) === said) setDirection(f, said, "fromTo");
          else f._dirBlocked = true;
        } else if (words.blocked) f._dirBlocked = true;
        else if (words.direction) setDirection(f, words.direction, "verb");
        else {
          const other = fromToPartner(text, groups, group, cs, ce);
          if (other && comparable(n, other)) setDirection(f, compare(n.value, other.value), "fromTo");
        }
      }
      // Against estimates: the words must be about this figure, so after it, or before it
      // with no comma in between ("Revenue beat estimates at $10B", not "earnings were above
      // estimates, with 24% having reported").
      if (base && f.role !== "estimate" && f.role !== "guidance") {
        const vs = (re) => re.test(nearAfter) || (re.test(near) && !/,/.test(near.slice(near.search(re))));
        if (vs(ABOVE_ESTIMATE)) f.vsEstimate = "above";
        else if (vs(BELOW_ESTIMATE)) f.vsEstimate = "below";
      }

      f._labelSource = labelSource;
      f._clause = ci;
      facts.push(f);
    });

    // Tolerances attach to the guidance figures before them in their clause ("73.3% and
    // 73.5%, respectively, plus or minus 50 basis points"), else the nearest one before.
    for (const t of tolerances) {
      const open = facts.filter((f) => f.role === "guidance" && !f.tolerance && f._n.start < t.n.start);
      const inClause = open.filter((f) => f._clause === t.ci);
      const targets = inClause.length ? inClause : open.slice(-1);
      const value = Math.abs(t.n.value);
      const tolerance = { value, type: t.n.type, display: t.n.type === "percent" ? `±${value}%` : `±${value} bps` };
      for (const f of targets) f.tolerance = tolerance;
    }

    // Changes link to the level in the same clause with the same label (not an earlier value
    // it's compared with).
    for (const c of facts) {
      if (c.role !== "change") continue;
      const level = facts
        .filter((l) => l.role === "level" && !l._prior && l._clause === c._clause && l.label === c.label)
        .sort((a, b) => Math.abs(a._n.start - c._n.start) - Math.abs(b._n.start - c._n.start))[0];
      if (level) link(level, c);
    }
    return facts;
  }

  function setDirection(f, direction, source) {
    f.direction = direction;
    f.directionSource = direction ? source : null;
  }
  const compare = (now, before) => (now > before ? "up" : now < before ? "down" : "flat");
  const wordsOf = (s) => s.match(/[A-Za-z][A-Za-z'’]*/g) || [];

  function wordKind(word, next) {
    if (FLIP_WORD.test(word)) return "flip";
    if (/^up$/i.test(word) && next && /^to$/i.test(next)) return null; // "up to $5 billion" is a limit
    if (/^held$/i.test(word)) return next && /^(?:steady|flat|unchanged|stable|at)$/i.test(next) ? "flat" : null;
    if (UP_WORD.test(word)) return "up";
    if (DOWN_WORD.test(word)) return "down";
    if (FLAT_WORD.test(word)) return "flat";
    return null;
  }

  // The nearest change word before the figure (up to 10 words back, not past the previous
  // figure), else one of the two words right after it. A negation in the three words before
  // the change word, or a flip word, blocks a direction.
  function directionFromWords(before, after) {
    const words = wordsOf(before).slice(-10);
    for (let i = words.length - 1; i >= 0; i--) {
      const kind = wordKind(words[i], words[i + 1]);
      if (!kind) continue;
      // "record" describes the figure only when it's next to it ("a record $4.3 billion",
      // "record revenue of"), not "a record fiscal year, with revenue reaching".
      if (/^record$/i.test(words[i]) && i < words.length - 3) continue;
      if (kind === "flip" || words.slice(Math.max(0, i - 3), i).some((w) => NEGATION.test(w))) return { blocked: true };
      return { direction: kind };
    }
    // Comparison words don't count towards the two: "35.1% year-on-year revenue increase".
    const next = wordsOf(after).filter((w, i, all) => !all.slice(0, i + 1).every((x) => /^(?:year|quarter|over|on|to|date)$/i.test(x))).slice(0, 2);
    for (let i = 0; i < next.length; i++) {
      const kind = wordKind(next[i], next[i + 1]);
      if (kind === "flip") return { blocked: true };
      if (kind) return { direction: kind };
    }
    return {};
  }

  // The earlier value for "from $X to $Y" (when the figure is $Y) or "to $Y from $X".
  function fromToPartner(text, groups, group, cs, ce) {
    const i = groups.indexOf(group);
    const n = group.figure;
    const prev = groups[i - 1] && groups[i - 1].figure;
    const next = groups[i + 1] && groups[i + 1].figure;
    if (prev && prev.start >= cs && /^\s*to\s+(?:about\s+)?$/i.test(text.slice(prev.end, n.start)) && /\bfrom\s+(?:about\s+)?$/i.test(text.slice(cs, prev.start))) {
      return prev;
    }
    if (next && next.end <= ce && /^\s*,?\s*(?:up |down )?from\s+(?:about\s+)?$/i.test(text.slice(n.end, next.start))) return next;
    return null;
  }
  const comparable = (a, b) =>
    a.type === b.type && (a.currency || null) === (b.currency || null) && typeof a.value === "number" && typeof b.value === "number";

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
      f._base = base;
      f._loss = Boolean(rowHeader && /\b(?:loss|losses|deficit)\b/i.test(rowHeader));

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

    // Change columns: a signed or bracketed value says which way ("+8%", "(3)%", "-3%", "0%").
    for (const c of facts) {
      if (c.role !== "change") continue;
      if (/^\+/.test(c.raw) && c.value > 0) setDirection(c, "up", "changeColumn");
      else if (c.value < 0 || /^[-−(]/.test(c.raw)) setDirection(c, "down", "changeColumn");
      else if (c.value === 0) setDirection(c, "flat", "changeColumn");
    }
    const columns = tableColumnDirection(facts);
    // An unsigned change ("31%" under "Q/Q") counts as up only when the page shows its falls
    // with brackets or minus signs, and the period columns it compares agree.
    if (columns && ctx.negativesShown) {
      for (const c of facts) {
        if (c.role !== "change" || c.direction || c.value <= 0) continue;
        const cell = cells.find((x) => c._n.start >= x.start && c._n.start < x.end);
        const header = cell && cell.header ? cell.header : "";
        const prior = /q\/q|qoq|sequential|quarter/i.test(header) ? columns.sequential : /y\/y|yoy|year/i.test(header) ? columns.yearAgo : columns.prior;
        if (prior && columns.current.value > prior.value) setDirection(c, "up", "changeColumn");
      }
    }

    // Row changes ("+14.2%" under "Change") link to the row's first level (the current period).
    const firstLevel = facts.find((x) => x.role === "level");
    for (const c of facts) if (c.role === "change" && firstLevel) link(firstLevel, c);
    return facts;
  }

  // A row with current and prior period columns ("Q3 2026" and "Q3 2025"): the current
  // figure's direction is how it compares with the prior one (the same period a year earlier
  // if there is one, else the latest before it). Only when the headers are the same apart
  // from their dates, so they clearly name comparable periods.
  function tableColumnDirection(facts) {
    const levels = facts
      .filter((f) => f.role === "level" && f.periodSource === "table")
      .map((f) => ({ f, p: columnPeriod(f.period.text) }))
      .filter((x) => x.p);
    if (levels.length < 2) return null;
    const current = levels.reduce((a, b) => (b.p.key > a.p.key ? b : a));
    if (levels.filter((x) => x.p.key === current.p.key).length > 1) return null;
    const same = levels.filter((x) => x !== current && x.p.shape === current.p.shape && x.p.key < current.p.key);
    if (!same.length) return null;
    const yearAgo = same.find((x) => x.p.key === current.p.key - 4);
    const sequential = same.reduce((a, b) => (b.p.key > a.p.key ? b : a));
    const prior = yearAgo || sequential;
    // The earlier columns are comparisons: they stay off the card, and the current figure
    // carries the one it's compared with ("vs $422.6M in Q3 2025").
    for (const x of same) x.f.priorPeriod = true;
    current.f._priorOf = prior.f;
    if (!comparable(current.f, prior.f)) return null;
    setDirection(current.f, compare(current.f.value, prior.f.value), "tableColumns");
    const usable = (x) => (x && comparable(current.f, x.f) ? x.f : null);
    return { current: current.f, prior: prior.f, yearAgo: usable(yearAgo), sequential: usable(sequential) };
  }

  const ORDINAL_QUARTER = { first: 1, second: 2, third: 3, fourth: 4 };
  const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/g;
  function columnPeriod(text) {
    const t = collapse(text).toLowerCase();
    let q = null;
    let m = t.match(/\bq([1-4])\b/) || t.match(/\b([1-4])q\b/);
    if (m) q = Number(m[1]);
    m = t.match(/\b(first|second|third|fourth)[\s-]quarter\b/);
    if (m) q = ORDINAL_QUARTER[m[1]];
    m = t.match(/\b(?:fy|fiscal(?: year)?)\s*['’]?(\d{4}|\d{2})\b/) || t.match(/\b((?:19|20)\d{2})\b/) || t.match(/['’](\d{2})\b/);
    if (!m) return null;
    const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    // Headers must match apart from their numbers and months: "Q2 FY26" / "Q1 FY26".
    const shape = t.replace(MONTHS, "M").replace(/\d+/g, "#");
    return { year, q, key: year * 4 + (q || 0), shape };
  }

  // Sentiment for canonical metrics: which way is good. Unknown metrics get none.
  function sentimentOf(f) {
    const polarity = f._loss ? "bad" : UP_IS_GOOD.has(f._base) ? "good" : UP_IS_BAD.has(f._base) ? "bad" : NEUTRAL_METRIC.has(f._base) ? "neutral" : null;
    if (!polarity) return null;
    if (f.vsEstimate && polarity !== "neutral") {
      const beat = f.vsEstimate === "above";
      return beat === (polarity === "good") ? "good" : "bad";
    }
    if (!f.direction) return null;
    if (f.direction === "flat" || polarity === "neutral") return "neutral";
    return (f.direction === "up") === (polarity === "good") ? "good" : "bad";
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

  // Every change records its level. The level shows the first change it was given, or the
  // first percentage if that came later ("$68.1 billion, exceeding guidance by $3 billion, up
  // 20%" shows 20%).
  function link(level, change) {
    if (change._linkedTo) return;
    const percent = (c) => c.type === "percent" || c.type === "basisPoints";
    if (!level._changeOf || (percent(change) && !percent(level._changeOf))) level._changeOf = change;
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
    // The page's texts (or, without blocks, the units'), for its company and period end dates.
    // context.page: { title, jsonld, meta } read from the page by extract.js.
    const texts = (blocks || []).length ? blocks.map((b) => b.text) : units.map((u) => u.blockText || u.text);
    const pageInfo = context.page || {};
    const page = pageIdentity({ ...pageInfo, texts });
    const ends = periodEnds(texts, pageInfo.title || "");
    // Does the page write falls as "(3)%" or "-3%" in its tables? Then an unsigned change is a rise.
    const negativesShown =
      context.negativesShown !== undefined
        ? context.negativesShown
        : (blocks || []).some((b) => b.type === "table" && NEGATIVE_CELL.test(collapse(b.text))) ||
          units.some((u) => (u.cells || []).some((c) => NEGATIVE_CELL.test(collapse(c.text))));
    const ctx = { pagePeriod, negativesShown };
    const all = units.flatMap((unit) => factsFromUnit(unit, ctx));

    for (const f of all) {
      f.display = display(f) + (f.tolerance ? ` ${f.tolerance.display}` : "");
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
    // A linked change passes its direction to its level. If the level's own wording or
    // columns disagree, or a negation blocked it, the level gets none.
    for (const f of kept) {
      const change = resolve(f._changeOf);
      if (!change || !kept.includes(change) || !change.direction || f._dirBlocked) continue;
      if (f.direction && f.direction !== change.direction) setDirection(f, null, null);
      else if (!f.direction) setDirection(f, change.direction, change.directionSource);
    }
    for (const f of kept) f.sentiment = sentimentOf(f);
    for (const f of kept) {
      const change = resolve(f._changeOf);
      if (change && kept.includes(change)) {
        f.change = {
          value: change.value,
          type: change.type,
          display: change.display,
          factId: change.id,
          direction: change.direction,
          directionSource: change.directionSource,
          sentiment: change.sentiment,
        };
      }
      const level = resolve(f._linkedTo);
      if (level && kept.includes(level)) f.linkedTo = level.id;
    }
    // The stat card shows levels, guidance and changes with no level to sit beside, when the
    // label is a real one. Linked changes show with their level; snippet labels go in the
    // card's "Also caught" section.
    for (const f of kept) {
      const roleOk = f.role === "level" || f.role === "guidance" || (f.role === "change" && !f.linkedTo);
      f.showOnCard = f.labelConfidence !== "low" && roleOk && !f.priorPeriod;
      const prior = resolve(f._priorOf);
      if (prior && prior.period) f.prior = { display: prior.display, period: prior.period.text, value: prior.value, unit: unitOf(prior) };
      // For exports: the metric on its own ("Operating income", with "non-GAAP" in qualifiers),
      // its unit, the period's end date, and the company (the sentence's own, else the page's).
      // A low-confidence label is a snippet of text, not a metric: no metric then.
      f.metric = f.labelConfidence === "low" ? null : f._base || f.label;
      f.unit = unitOf(f);
      f.periodEnd = periodEndFor(f.periodInferred ? null : f.period, ends);
      const own = companyIn(f.sentence);
      f.company = own ? own.company : page.company;
      f.ticker = own ? own.ticker : page.ticker;
    }
    const internal = new Set(["kind", "perShare", "signed"]);
    return kept.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("_") && !internal.has(k))));
  }

  // ---------------------------------------------------------------------------
  // Card order (shared by the card and the summary)
  // ---------------------------------------------------------------------------

  const VISIBLE_ROWS = 7;
  // Importance on the card: headline metrics by topic, then guidance, then segment figures
  // ("Data Center revenue"), then everything else.
  const TOPIC_ORDER = ["revenue/sales", "gross profit", "operating income", "EBIT/EBITDA", "net income", "EPS/per share", "margin", "cash flow", "debt"];
  const isSegment = (q) => /^[A-Z]/.test(q) && !/^(?:GAAP|non-GAAP)$/.test(q);

  function cardRank(f) {
    if (f.role === "guidance") return TOPIC_ORDER.length;
    const i = TOPIC_ORDER.indexOf(f.topic);
    if (i < 0) return TOPIC_ORDER.length + 2;
    return (f.qualifiers || []).some(isSegment) ? TOPIC_ORDER.length + 1 : i;
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

  // The card's rows: one main row per metric (label, which carries its qualifiers, plus
  // role), by importance, levels before standalone changes, each followed by that metric's
  // other rows. A standalone change with a level for the same label and period only appears
  // under "Show all". `primary` marks each metric's main row; `visible` the first 7 of those.
  // `also`: the rest, apart from changes shown beside their level and earlier table columns.
  function cardRows(facts) {
    const position = new Map(facts.map((f, i) => [f, i]));
    const firstSeen = new Map();
    facts.forEach((f, i) => {
      if (!firstSeen.has(f.label)) firstSeen.set(f.label, i);
    });
    const shown = facts.filter((x) => x.showOnCard);
    const periodText = (f) => (f.period ? f.period.text.toLowerCase() : "");
    const hasLevel = (c) => shown.some((l) => l.role === "level" && l.label === c.label && periodText(l) === periodText(c));
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
      CONFIDENCE_RANK[b.labelConfidence] - CONFIDENCE_RANK[a.labelConfidence] ||
      (CONFIDENCE_RANK[b.periodConfidence] || 0) - (CONFIDENCE_RANK[a.periodConfidence] || 0) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      position.get(a) - position.get(b);
    const groups = [...metrics.entries()].map(([key, list]) => {
      list.sort(best);
      return Object.assign(list, { extra: (tucked.get(key) || []).sort(best) });
    });
    const roleRank = (f) => (f.role === "change" ? 1 : 0);
    groups.sort(
      (a, b) =>
        cardRank(a[0]) - cardRank(b[0]) ||
        roleRank(a[0]) - roleRank(b[0]) ||
        firstSeen.get(a[0].label) - firstSeen.get(b[0].label) ||
        (b[0].score ?? 0) - (a[0].score ?? 0) ||
        position.get(a[0]) - position.get(b[0])
    );
    const rows = [];
    groups.forEach((list, i) => {
      list.forEach((f, j) => rows.push({ fact: f, primary: j === 0, visible: j === 0 && i < VISIBLE_ROWS }));
      for (const f of list.extra) rows.push({ fact: f, primary: false, visible: false });
    });
    const also = facts.filter((f) => !f.showOnCard && !f.linkedTo && !f.priorPeriod);
    return { rows, also };
  }

  // ---------------------------------------------------------------------------
  // Reading figures in other text (used by the summary's number checker)
  // ---------------------------------------------------------------------------

  // The finance term starting earliest within [from, to): { label, start, end }.
  function termAfter(text, from, to) {
    const slice = text.slice(from, to);
    let best = null;
    for (const [label, re] of TERMS) {
      re.lastIndex = 0;
      const m = re.exec(slice);
      if (m && (!best || m.index < best.start - from || (m.index === best.start - from && m[0].length > best.length))) {
        best = { label, start: from + m.index, end: from + m.index + m[0].length, length: m[0].length };
      }
    }
    return best;
  }

  const clauseAround = (text, pos) => {
    const ranges = clauses(text);
    const i = clauseIndex(ranges, Math.min(Math.max(pos, 0), Math.max(text.length - 1, 0)));
    return ranges[i] || [0, text.length];
  };

  // The metric a figure at [start, end) in a sentence is about: the nearest finance term before
  // it in its clause, else the first one after it ("$482.6 million in revenue"). Returns the
  // canonical label and its qualifiers ({ label: "Operating income", qualifiers: ["non-GAAP"] })
  // or null.
  function metricNear(text, start, end = start) {
    const [cs, ce] = clauseAround(text, start);
    const term = termBefore(text, cs, start) || termAfter(text, end, ce);
    if (!term) return null;
    return { label: term.label, qualifiers: qualifiersBefore(text, cs, term.start) };
  }

  // The direction a sentence gives a figure at [start, end) ("rose", "fell", "unchanged"...),
  // looking no further back than `from` (the previous figure) or ahead than `to`. Null when it
  // says nothing, or a negation or flip word makes it unclear.
  function directionNear(text, start, end, from = 0, to = text.length) {
    const [cs, ce] = clauseAround(text, start);
    const words = directionFromWords(text.slice(Math.max(cs, from), start), text.slice(end, Math.min(ce, to)));
    return words.direction || null;
  }

  // ---------------------------------------------------------------------------
  // The page's company and ticker, and period end dates
  // ---------------------------------------------------------------------------

  const EXCHANGE = String.raw`(?:NASDAQ|Nasdaq|NYSE(?:\s+(?:American|Arca|MKT))?|AMEX|LSE|LON|TSX(?:-V)?|ASX|OTC(?:QX|QB)?|Euronext|XETRA|HKEX|SGX|NSE|BSE|TSE|JSE)`;
  const TICKER = String.raw`[A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,2})?`;
  // "(NASDAQ: NVDA)", "Nasdaq: AAPL", "LSE: BP."
  const EXCHANGE_TICKER = new RegExp(String.raw`\(?\b${EXCHANGE}\s*:\s*(${TICKER})(?![a-z])\.?\)?`, "g");
  // "Meta Platforms (META)": a name in capitals followed by a bare ticker.
  const NAME_WORD = String.raw`(?:[A-Z][\w&'’.-]*|&|and|of|plc|p\.l\.c\.|inc\.?|ltd\.?|corp\.?|co\.)`;
  const NAMED_TICKER = new RegExp(String.raw`([A-Z][\w&'’.-]*(?:,?\s+${NAME_WORD})*)\s*\((${TICKER})\)`, "g");
  // Capitals in brackets that aren't tickers.
  const NOT_TICKER = /^(?:GAAP|EPS|CEO|CFO|COO|CTO|AI|US|USA|UK|EU|USD|GBP|EUR|IPO|ETF|ESG|R&D|LLC|LP|PLC|NA|N\/A|FY|Q[1-4]|H[12]|YOY|TTM|EBITDA?|EBIT|FCF|ADR|SEC|IRS|FED|OPEC|GDP|CPI|PCE)$/;
  const NAME_BEFORE = new RegExp(String.raw`([A-Z][\w&'’.-]*(?:,?\s+${NAME_WORD})*)\s*$`);
  // Words before a name that aren't part of it: "Shares of Coca-Cola", "The Company".
  const NAME_STOP = /^(?:(?:The|Shares|Stock|Company|Today|On|of)\s+)+/;

  const cleanName = (name) => collapse(name).replace(NAME_STOP, "").replace(/,$/, "");
  const tickerOf = (s) => (s || "").replace(/\.$/, "").toUpperCase();

  // Companies named with a ticker in a text: [{ name, ticker, exchange }].
  function tickersIn(text) {
    const found = [];
    for (const m of text.matchAll(EXCHANGE_TICKER)) {
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      const name = (before.match(NAME_BEFORE) || [])[1];
      found.push({ name: name ? cleanName(name) : null, ticker: tickerOf(m[1]), exchange: true });
    }
    for (const m of text.matchAll(NAMED_TICKER)) {
      if (NOT_TICKER.test(m[2]) || found.some((f) => f.ticker === m[2])) continue;
      found.push({ name: cleanName(m[1]), ticker: m[2], exchange: false });
    }
    return found;
  }

  // The page's company and ticker: { company, ticker, confidence } from, in order, exchange
  // tickers in the text ("(NASDAQ: NVDA)"), structured data (JSON-LD with a ticker symbol, or an
  // article "about" one company; never the publisher), and a "<Company> Reports ... Results"
  // title. When several companies are equally likely, both are left blank rather than guessed.
  // page: { texts, title, jsonld: [objects], meta: { name: content } }.
  function pageIdentity(page = {}) {
    const texts = page.texts || [];
    const title = collapse(page.title || "");
    const blank = { company: null, ticker: null, confidence: null };
    const titleName = () => {
      const bare = title.split(/\s+[|–—-]\s+/)[0];
      return bare && bare.split(" ").length <= 4 ? bare : null;
    };

    // 0. A company infobox describes the page's own subject: its "Traded as" row's first ticker
    //    ("Nasdaq: NVDA"), with the infobox's name, else the title's.
    const box = page.infobox;
    const boxed = box && box.tradedAs ? [...box.tradedAs.matchAll(EXCHANGE_TICKER)] : [];
    if (boxed.length) return { company: box.name || titleName(), ticker: tickerOf(boxed[0][1]), confidence: "medium" };

    // 1. Exchange tickers in the text.
    const counts = new Map();
    for (const text of texts) {
      for (const t of tickersIn(text).filter((x) => x.exchange)) {
        const entry = counts.get(t.ticker) || { ticker: t.ticker, name: null, count: 0 };
        entry.count += 1;
        entry.name = entry.name || t.name;
        counts.set(t.ticker, entry);
      }
    }
    if (counts.size) {
      const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
      if (ranked[1] && ranked[1].count === ranked[0].count) return blank;
      const top = ranked[0];
      const name = top.name || titleName();
      return { company: name || null, ticker: top.ticker, confidence: top.name ? "high" : "medium" };
    }

    // 2. Structured data: a company with a ticker symbol, or the one company an article is about.
    const objects = [];
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      objects.push(o);
      if (o["@graph"]) walk(o["@graph"]);
    };
    walk(page.jsonld || []);
    const types = (o) => [].concat(o["@type"] || []).map(String);
    const withTicker = objects.filter((o) => o.tickerSymbol && o.name);
    const about = objects
      .filter((o) => types(o).some((t) => /Article|NewsArticle|Report/.test(t)))
      .flatMap((o) => [].concat(o.about || []))
      .filter((o) => o && typeof o === "object" && types(o).some((t) => /Organization|Corporation/.test(t)) && o.name);
    const structured = withTicker.length ? withTicker : about;
    const names = [...new Set(structured.map((o) => collapse(o.name)))];
    if (names.length === 1) {
      const o = structured[0];
      const ticker = o.tickerSymbol ? tickerOf(String(o.tickerSymbol).split(/[\s:]+/).pop()) : null;
      return { company: names[0], ticker, confidence: "medium" };
    }
    if (names.length > 1) return blank;
    const meta = page.meta || {};
    const metaTicker = meta.ticker || meta["stock-ticker"] || meta["og:ticker"];
    if (meta.company || metaTicker) return { company: meta.company || null, ticker: metaTicker ? tickerOf(metaTicker) : null, confidence: "medium" };

    // 3. The title: "NVIDIA Announces Financial Results for ...", "Apple reports fourth quarter results".
    const m = title.match(/^(.+?)\s+(?:announces|reports|posts|delivers|releases|reveals)\b.*\b(?:results|earnings)\b/i);
    if (m) return { company: cleanName(m[1]), ticker: null, confidence: "low" };
    return blank;
  }

  // The company a sentence itself names with a ticker ("Meta Platforms (META) earnings ..."), if
  // it names exactly one.
  function companyIn(text) {
    const found = tickersIn(text || "");
    const tickers = [...new Set(found.map((f) => f.ticker))];
    if (tickers.length !== 1) return null;
    const named = found.find((f) => f.name) || found[0];
    return { company: named.name, ticker: tickers[0] };
  }

  const MONTH = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const MONTH_NAME = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?`;
  const DATE_TEXT = String.raw`(?:${MONTH_NAME}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+${MONTH_NAME}\s+\d{4})`;
  const ENDED = new RegExp(
    String.raw`\b(?:(first|second|third|fourth)\s+(?:fiscal\s+)?quarter|(three|six|nine|twelve)\s+months|(fiscal\s+year|year))\s+(?:ended|ending)(?:\s+on)?\s+(${DATE_TEXT})`,
    "gi"
  );

  // "July 27, 2025" / "27 July 2025" -> "2025-07-27".
  function isoDate(text) {
    const t = collapse(text).replace(/\./g, "");
    let m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    let month;
    let day;
    let year;
    if (m) [, month, day, year] = m;
    else {
      m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      if (!m) return null;
      [, day, month, year] = m;
    }
    const key = Object.keys(MONTH).find((k) => k.startsWith(month.toLowerCase().slice(0, 3)));
    if (!key) return null;
    return `${year}-${String(MONTH[key]).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // The quarter and year a period names: "Q2 FY26" -> { quarter: 2, fiscal: 2026 },
  // "Q3 2026" -> { quarter: 3, year: 2026 }, "second quarter" -> { quarter: 2 }.
  function periodParts(text) {
    const t = collapse(text).toLowerCase();
    const q = t.match(/\bq([1-4])\b/) || t.match(/\b(first|second|third|fourth)[\s-]+(?:fiscal\s+)?quarter\b/);
    const fy = t.match(/\bfy\s*['’]?(\d{4}|\d{2})\b/) || t.match(/\bfiscal(?:\s+year)?\s+(\d{4})\b/);
    const year = t.match(/\b((?:19|20)\d{2})\b/);
    const toYear = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    return {
      quarter: q ? Number(q[1]) || ORDINAL_QUARTER[q[1]] : null,
      fiscal: fy ? toYear(fy[1]) : null,
      year: !fy && year ? Number(year[1]) : null,
      months: /\b(?:three|six|nine|twelve)\s+months\b/.test(t),
    };
  }

  // "Quarter ended July 27, 2025" phrases on the page: [{ quarter, year (of the end date),
  // fiscal (from the same sentence, or a title naming the same quarter), date }].
  function periodEnds(texts, title = "") {
    const out = [];
    const titleParts = periodParts(title || "");
    for (const text of texts) {
      for (const m of text.matchAll(ENDED)) {
        const date = isoDate(m[4]);
        if (!date) continue;
        const quarter = m[1] ? ORDINAL_QUARTER[m[1].toLowerCase()] : m[2] && m[2].toLowerCase() === "three" ? "months" : null;
        const sentence = text.slice(Math.max(0, m.index - 120), m.index + m[0].length);
        const own = periodParts(sentence);
        const fiscal = own.fiscal || (typeof quarter === "number" && titleParts.quarter === quarter ? titleParts.fiscal : null);
        out.push({ quarter, yearly: Boolean(m[3]) || (m[2] && m[2].toLowerCase() === "twelve"), year: Number(date.slice(0, 4)), fiscal, date });
      }
    }
    return out;
  }

  // The end date of a fact's period: a date in its own period text ("Three Months Ended July 27,
  // 2025"), else a matching "quarter ended" phrase from the page (same quarter, and the same
  // calendar or fiscal year when the period names one; a period with no year matches only when
  // one phrase fits).
  function periodEndFor(period, ends) {
    if (!period) return null;
    const own = period.text.match(new RegExp(String.raw`\b(?:ended|ending)(?:\s+on)?\s+(${DATE_TEXT})`, "i"));
    if (own) return isoDate(own[1]);
    const p = periodParts(period.text);
    const fits = ends.filter((e) => {
      if (p.quarter) {
        if (e.quarter !== p.quarter) return false;
      } else if (!e.yearly) return false;
      if (p.fiscal) return e.fiscal === p.fiscal;
      if (p.year) return e.year === p.year || e.fiscal === p.year;
      return true;
    });
    const dates = [...new Set(fits.map((e) => e.date))];
    return dates.length === 1 ? dates[0] : null;
  }

  // The unit a figure is measured in, for exports.
  function unitOf(f) {
    if (f.type === "perShare" || (f.type === "money" && f.perShare)) return "per_share";
    return { money: "money", percent: "percent", basisPoints: "basis_points", multiple: "multiple", count: "count" }[f.type] || f.type;
  }

  const FrogbotFacts = { buildFacts, dominantPeriod, cardRows, metricNear, directionNear, pageIdentity, periodEnds, periodEndFor, isoDate, symbol };
  if (typeof window !== "undefined" && !window.FrogbotFacts) window.FrogbotFacts = FrogbotFacts;
  if (typeof module !== "undefined" && module.exports) module.exports = FrogbotFacts;
})();
