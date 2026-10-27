// Frogbot: number detection (step 7) and scoring (step 8).
// Pure functions with no DOM access, so they can be tested on their own:
// open tests/run-tests.html, or run `python tools/run_tests.py`.
// Page code (extract.js) turns blocks into units; this file scores them and picks targets.
(() => {
  // ---------------------------------------------------------------------------
  // Scoring weights: every number that decides what the frog visits lives here.
  // Change them only with evidence (tests/score-cases.js and the page snapshots).
  // ---------------------------------------------------------------------------

  const WEIGHTS = {
    money: 3, // contains money (non-junk)
    percent: 3, // contains a percent or basis points
    perShare: 3, // contains a per-share figure
    changeWord: 2, // a number within CHANGE_WINDOW words of rose/fell/grew/up/down...
    financeTerm: 2, // revenue, margin, EPS, guidance...
    period: 1, // a period reference, or a quarter/year in a table header
    comparison: 1, // versus, compared with, from X to Y, year-over-year, consensus...
    context: 1, // bold, under a heading containing a number, or a table row without column headers
    multiple: 1, // a valuation multiple
    onlyCounts: -2, // only counts/years and no money, percent or per-share figure
    onlyJunk: -4, // numbers, but all of them junk (phones, copyright years...)
    rambling: -1, // over RAMBLING_WORDS words
    duplicate: -3, // its main figure was already picked in a higher-scoring unit
    topicCovered: -2, // selection only, per chosen unit already on its topic: -2, -4, -6...
    recencyDated: -2, // newest explicit year is 5-9 years older than the newest year on the page
    recencyOld: -4, // ... 10 or more years older

    // Topics for variety, in priority order (a unit takes the topic of its earliest finance
    // term; on a tie the topic listed first wins, so "earnings per share" is EPS, not net
    // income). The company's own forward-looking statements are guidance whatever their first
    // term (see forwardTopic). Units with no finance term are "other", a topic like the rest.
    topics: [
      ["EPS/per share", /\bEPS\b|earnings\s+per\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share|per[-\s](?:diluted\s+)?share/i],
      ["revenue/sales", /\brevenues?\b|\bsales\b/i],
      ["margin", /\bmargins?\b/i],
      ["gross profit", /\bgross profits?\b/i],
      ["operating income", /\boperating (?:income|profits?|loss)\b|\bEBITD?A?\b/i],
      ["net income", /\bnet (?:income|profits?|earnings|loss)\b|\bprofits?\b|\bincome\b|\bearnings\b/i],
      ["guidance/outlook/forecast", /\bguidance\b|\boutlook\b|\bforecasts?\b/i],
      ["cash flow", /\bcash flow\b/i],
      ["debt", /\bdebt\b/i],
      ["dividend/buyback", /\bdividends?\b|\bbuybacks?\b|\brepurchases?\b/i],
      ["growth/estimates", /\bgrowth\b|\bestimates?\b|\bconsensus\b/i],
    ],
  };
  const MIN_SCORE = 5;
  const RECENCY_DATED_YEARS = 5;
  const RECENCY_OLD_YEARS = 10;
  const CHANGE_WINDOW = 4;
  const RAMBLING_WORDS = 60;
  const WORDS_PER_TARGET = 100;
  const MIN_TARGETS = 3;
  const MIN_TARGETS_WHEN_RICH = 5; // when at least this many units pass MIN_SCORE
  const MAX_TARGETS = 12;
  const MAX_PER_BLOCK = 2;
  const MAX_ROWS_PER_TABLE = 4;

  // ---------------------------------------------------------------------------
  // Building blocks
  // ---------------------------------------------------------------------------

  // 1,250.50 | 12.5 | 300. Leading-dot decimals (".5") are deliberately not numbers,
  // so footnote markers like "loungers.1" aren't read as 0.1.
  const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  // Stops a number from being shortened by backtracking ("12.5" must not become "12").
  const NUM_END = String.raw`(?!\d|[.,]\d)`;
  const SCALE_WORDS = String.raw`thousand|million|billion|trillion|mln|bln|mn|bn|tn`;
  // Scale words may follow a space; single letters must be attached ("$12.4B", "£300m").
  const SCALE = String.raw`(?:\s?(?:${SCALE_WORDS})|[kKmMbBT])(?![A-Za-z])`;
  const DASH = String.raw`\s?[-–—]\s?`;
  // A dash range's second number must not belong to a following percent ("$46 - 6%").
  const NOT_PERCENT = String.raw`(?!\s?(?:%|per\s?cent|bps|basis|pts?\b))`;

  const CURRENCY_PREFIX =
    String.raw`(?<![A-Za-z])(?:US\$|USD ?|C\$|CA\$|CAD ?|A\$|AU\$|AUD ?|NZ\$|HK\$|HKD ?|S\$|SGD ?|` +
    String.raw`NT\$|R\$|\$|£|GBP ?|€|EUR ?|¥|JPY ?|CNY ?|RMB ?|₹|INR ?|CHF ?)(?:\s(?=\d))?`;
  const CURRENCY_CODES = {
    "US$": "USD", $: "USD", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD", "NZ$": "NZD",
    "HK$": "HKD", "S$": "SGD", "NT$": "TWD", "R$": "BRL", "£": "GBP", "€": "EUR", "¥": "JPY",
    "₹": "INR", RMB: "CNY", dollars: "USD", "U.S. dollars": "USD", euro: "EUR", euros: "EUR",
    pounds: "GBP", "pounds sterling": "GBP", sterling: "GBP", yen: "JPY",
  };
  const currencyCode = (raw) => {
    const key = raw.trim();
    return CURRENCY_CODES[key] || key.toUpperCase();
  };

  const MONTH =
    String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|` +
    String.raw`Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?`;
  const TIMEZONE = String.raw`(?:\s?(?:ET|EST|EDT|CT|CST|CDT|MT|PT|PST|PDT|GMT|BST|UTC|CET|CEST)\b)?`;

  // What a "times" multiple is measured against: "3 times earnings", "12 times forward EBITDA".
  const VALUATION_BASIS =
    String.raw`(?:(?:forward|trailing|next[- ]year'?s?|annual|adjusted|projected|expected)\s+)?` +
    String.raw`(?:earnings|sales|revenues?|EBITDA|EBIT|book(?:\s+value)?|cash\s+flow|free\s+cash\s+flow|profits?|net\s+income|income|P\/E)\b`;

  // Video resolutions that look like pence ("1080p"), and money words that make "240p" pence.
  const RESOLUTIONS = new Set(["144", "360", "480", "576", "720", "1080", "1440", "2160", "4320"]);
  const PENCE_CONTEXT =
    /\b(?:shares?|stock|price|priced|dividend|pence|penny|rose|fell|gained|lost|dropped|climbed|jumped|slid|up|down|at|to|from|worth|cost|costs|paid|pay|pays|raised|cut)\b/i;

  const MULTIPLIER = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
  function scaleOf(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (/^(?:k|K|thousand)$/.test(s)) return "thousand";
    if (/^(?:m|M|mn|mln|million)$/.test(s)) return "million";
    if (/^(?:b|B|bn|bln|billion)$/.test(s)) return "billion";
    if (/^(?:T|tn|trillion)$/.test(s)) return "trillion";
    return null;
  }

  const toNumber = (s) => Number(s.replace(/,/g, ""));
  // Keeps 12.4 × 1e9 at 12400000000 rather than 12399999999.999998.
  const tidy = (n) => Number(n.toPrecision(12));
  const yearFrom = (s) => (!s ? null : s.length === 2 ? 2000 + Number(s) : Number(s));

  function makeMatch(text, start, end, type, fields = {}) {
    return {
      raw: text.slice(start, end),
      start,
      end,
      type,
      value: null,
      currency: null,
      scale: null,
      isNegative: false,
      low: null,
      high: null,
      junk: false,
      junkReason: null,
      decade: false,
      ...fields,
    };
  }

  const junkMatch = (text, start, end, reason, fields = {}) =>
    makeMatch(text, start, end, "other", { junk: true, junkReason: reason, ...fields });

  // Value, range and sign from the n1 / bn (bracketed) / n2 / scale / sign groups.
  function amountFields(g) {
    const scale = scaleOf(g.scale);
    const mult = scale ? MULTIPLIER[scale] : 1;
    const bracketed = g.bn !== undefined;
    const minus = /[-−]/.test(g.sign || "") || /[-−]/.test(g.sign2 || "");
    const isNegative = bracketed || minus;
    const first = toNumber(bracketed ? g.bn : g.n1) * (isNegative ? -1 : 1);
    if (g.n2 !== undefined) {
      const low = tidy(first * mult);
      const high = tidy(toNumber(g.n2) * mult);
      return { scale, low, high, value: tidy((low + high) / 2), isNegative: high < 0 };
    }
    return { scale, value: tidy(first * mult), isNegative };
  }

  // Start/end of a named group. Only patterns that call span() use the regex "d" flag,
  // since computing indices for every match is noticeably slower.
  const span = (m, name) => m.indices.groups[name];

  // ---------------------------------------------------------------------------
  // Patterns, in priority order: the first pattern to claim a stretch of text wins.
  // `when` (optional) is a cheap regex a text must pass before `re` is tried.
  // Each build() returns a match, an array of matches, or null to ignore it.
  // A match may carry `claim: [start, end]` to reserve more text than its raw span.
  // ---------------------------------------------------------------------------

  const PATTERNS = [
    // ---- Junk that contains digits but isn't a figure ----
    {
      // Inflation notes: "(equivalent to $3,770 in 2025)". Neither the amount nor the year is a
      // figure of the story; the note restates an older figure in today's money.
      when: /equivalent to/i,
      re: /\bequivalent to\s+(?:about\s+|approximately\s+|roughly\s+|around\s+)?(?:US\$|C\$|A\$|NZ\$|HK\$|\$|£|€|¥)?\d[\d,.]*(?:\s?(?:thousand|million|billion|trillion|mn|bn|[kKmMbB]))?\s+in\s+(?:19|20)\d{2}\b/gi,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "inflation"),
    },
    {
      re: /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi,
      when: /www\.|https?:/i,
      build: (m, t) => (/\d/.test(m[0]) ? junkMatch(t, m.index, m.index + m[0].length, "url") : null),
    },
    {
      re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
      when: /@/,
      build: (m, t) => (/\d/.test(m[0]) ? junkMatch(t, m.index, m.index + m[0].length, "email") : null),
    },
    {
      // Validated in build(): enough digits, sensible groups, and real phone separators.
      re: /(?<![\w$£€¥.,])\+?(?:\d|\(\d)[\d\s().-]{6,20}\d(?!\d)/g,
      when: /\d{3}[\s.-]\d{3}/,
      build: (m, t) => {
        const raw = m[0];
        const digits = raw.replace(/\D/g, "").length;
        if (digits < 10 || digits > 15) return null;
        const groups = raw.split(/[\s().-]+/).filter(Boolean);
        if (groups.length < 3 && !raw.includes("(")) return null;
        if (groups.slice(1).some((g) => g.length < 2)) return null;
        const hasPlus = raw.startsWith("+");
        const hasParen = raw.includes("(");
        if (hasParen && !/^\+?[\d\s]*\(\d{2,5}\)/.test(raw)) return null;
        if (!hasPlus && !hasParen && !/[-.]/.test(raw)) return null;
        return junkMatch(t, m.index, m.index + raw.length, "phone");
      },
    },
    {
      when: /:\d\d|\d\s?[ap]\.?m\b|\d\s?[AP]M\b/,
      re: new RegExp(
        String.raw`\b\d{1,2}(?::\d{2})?\s?(?:a\.m\.|p\.m\.|am\b|pm\b|AM\b|PM\b)${TIMEZONE}|\b\d{1,2}:\d{2}${TIMEZONE}`,
        "g"
      ),
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "time"),
    },
    {
      // Numeric dates: 2026-03-31, 03/31/2026.
      re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/g,
      when: /\d[-/]\d/,
      build: (m, t) => makeMatch(t, m.index, m.index + m[0].length, "date"),
    },
    {
      re: /(?:©|\(c\)|\bcopyright\b)\s*(?:©\s*)?(?<y>\d{4})(?:\s*[-–]\s*(?<y2>\d{4}))?/dgi,
      when: /©|\(c\)|copyright/i,
      build: (m, t) => {
        const [s] = span(m, "y");
        const e = m.groups.y2 ? span(m, "y2")[1] : span(m, "y")[1];
        return makeMatch(t, s, e, "year", {
          value: Number(m.groups.y),
          junk: true,
          junkReason: "copyright",
          claim: [m.index, m.index + m[0].length],
        });
      },
    },
    {
      re: /\b[Pp]age\s+(?<n>\d{1,4})(?:\s+of\s+\d{1,4})?\b|(?<![\w.,$])(?<n2>\d{1,4})\s+of\s+\d{1,4}(?![\d,.]?\d)(?!\s*(?:[A-Za-z%$€£]|\(\d))/g,
      when: /\bof\b|[Pp]age/,
      build: (m, t) =>
        junkMatch(t, m.index, m.index + m[0].length, "page", { value: Number(m.groups.n || m.groups.n2) }),
    },
    {
      // Street numbers: "742 Bullrush Avenue", "2788 San Tomas Expressway", "1 Infinite Loop".
      re: /\b(?<n>\d{1,6})\s+(?:(?:N|S|E|W|North|South|East|West)\.?\s+)?(?:[A-Z][A-Za-z']+\.?\s+){0,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Expressway|Expy|Parkway|Pkwy|Loop|Drive|Dr|Lane|Ln|Way|Place|Pl|Plaza|Court|Ct|Highway|Hwy|Square|Sq|Terrace|Circle|Cir)\b\.?|\b(?:Suite|Ste\.?|Floor|Unit|Apt\.?)\s+(?<n2>\d{1,5})\b/dg,
      when: /\b(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Expressway|Expy|Parkway|Pkwy|Loop|Drive|Dr|Lane|Ln|Way|Place|Pl|Plaza|Court|Ct|Highway|Hwy|Square|Sq|Terrace|Circle|Cir|Suite|Ste|Floor|Unit|Apt)\b/,
      build: (m, t) => {
        const [s, e] = span(m, m.groups.n ? "n" : "n2");
        return junkMatch(t, s, e, "address", {
          value: Number(m.groups.n || m.groups.n2),
          claim: [m.index, m.index + m[0].length],
        });
      },
    },
    {
      // US ZIP after a state ("OR 97999", "Calif. 95051") and UK postcodes ("SW1A 1AA").
      re: /\b(?:[A-Z]{2}|Calif\.|California|Oregon|Texas|Washington|New York)\,?\s+(?<zip>\d{5}(?:-\d{4})?)\b|\b(?<pc>[A-Z]{1,2}\d{1,2}[A-Z]?\s\d[A-Z]{2})\b/dg,
      when: /\d{5}|[A-Z]\d[A-Z\d]?\s\d[A-Z]/,
      build: (m, t) => {
        const [s, e] = span(m, m.groups.zip ? "zip" : "pc");
        return junkMatch(t, s, e, "postcode");
      },
    },
    {
      // Exchange codes that contain digits: "(HKEX: 0700)". "(NASDAQ: NVDA)" has none.
      re: /\((?:NASDAQ|Nasdaq|NYSE(?:\s+American)?|LSE|LON|TSX|TSXV|ASX|HKEX|SEHK|HKG|TYO|TSE|SGX|Euronext|XETRA|FWB|BSE|NSE|KRX|OTC(?:QX|QB)?)\s*:\s*(?<code>[A-Z0-9.]+)\)/dg,
      when: /:\s*[A-Z0-9.]*\d[A-Z0-9.]*\)/,
      build: (m, t) => {
        if (!/\d/.test(m.groups.code)) return null;
        const [s, e] = span(m, "code");
        return junkMatch(t, s, e, "ticker", { claim: [m.index, m.index + m[0].length] });
      },
    },
    {
      // ISIN (US0378331005), CUSIP with or without the label (67066G104), conference IDs.
      re: /\b[A-Z]{2}[A-Z0-9]{9}\d\b|\bCUSIP(?:\s+(?:No\.?|number|#))?\s*:?\s*(?<cusip>[0-9A-Z]{9})\b|\b\d{3}[0-9A-Z]{5}\d\b|\b(?:conference\s+ID|access\s+code|passcode|PIN|ID)\s*:?\s*#?(?<id>\d{3,})\b/dgi,
      when: /[A-Z]\d|\d[A-Z]|CUSIP|ID|PIN|code/i,
      build: (m, t) => {
        if (m.groups.cusip || m.groups.id) {
          const [s, e] = span(m, m.groups.cusip ? "cusip" : "id");
          return junkMatch(t, s, e, "code", { claim: [m.index, m.index + m[0].length] });
        }
        // Bare 9/12-character codes must mix letters and digits.
        if (!/[A-Z]/i.test(m[0]) || !/\d/.test(m[0])) return null;
        return junkMatch(t, m.index, m.index + m[0].length, "code");
      },
    },

    // ---- Periods (before model names, so "FY26", "Q3" and "H1" aren't junk) ----
    {
      // Quarter and half ranges: "Q1-Q3 2026", "Q1–Q3", "H1-H2". low/high are the quarter
      // or half numbers; value is the year when given.
      when: /[QH][1-4]\s?[-–—]\s?[QH]/,
      re: /\b(?<p>[QH])(?<a>[1-4])\s?[-–—]\s?\k<p>(?<b>[1-4])(?!\d)(?:\s?(?:FY\s?'?(?<y2>\d{2}|\d{4})|'(?<y3>\d{2})|(?:[Ff]iscal\s+)?(?<y4>\d{4})))?(?![\dA-Za-z])/g,
      build: (m, t) => {
        const { p, a, b } = m.groups;
        if (p === "H" && (Number(a) > 2 || Number(b) > 2)) return null;
        return makeMatch(t, m.index, m.index + m[0].length, "period", {
          low: Number(a),
          high: Number(b),
          value: yearFrom(m.groups.y2 || m.groups.y3 || m.groups.y4),
        });
      },
    },
    {
      // Decades: "1990s", "the '90s". value is the decade's first year.
      when: /\d0s\b/,
      re: /\b(?<full>(?:1[89]|20)\d0)s\b|(?<![\w'’])['’](?<short>\d)0s\b/g,
      build: (m, t) => {
        const { full, short } = m.groups;
        const decadeOf = (d) => (Number(d) >= 3 ? 1900 : 2000) + Number(d) * 10;
        const value = full ? Number(full) : decadeOf(short);
        return makeMatch(t, m.index, m.index + m[0].length, "period", { value, decade: true });
      },
    },
    {
      re: /\bQ(?<q>[1-4])(?!\d)(?:\s?(?:FY\s?'?(?<y2>\d{2}|\d{4})|'(?<y3>\d{2})|(?:[Ff]iscal\s+)?(?<y4>\d{4})))?(?!\d)|\b[1-4]Q\s?'?(?<y5>\d{2}|\d{4})?\b/g,
      when: /Q[1-4]|[1-4]Q/,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "period", {
          value: yearFrom(m.groups.y2 || m.groups.y3 || m.groups.y4 || m.groups.y5),
        }),
    },
    {
      re: /\b(?:fiscal\s+)?(?:first|second|third|fourth|1st|2nd|3rd|4th)[\s-]quarter(?:\s+(?:of\s+)?(?:fiscal\s+(?:year\s+)?)?(?<y>\d{4}))?/gi,
      when: /quarter/i,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "period", { value: yearFrom(m.groups.y) }),
    },
    {
      re: /\b(?:first|second|1st|2nd)\s+half(?:\s+(?:of\s+)?(?:fiscal\s+)?(?<y>\d{4}))?/gi,
      when: /half/i,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "period", { value: yearFrom(m.groups.y) }),
    },
    {
      re: /\b(?:[Ff]iscal(?:\s+[Yy]ear)?\s+(?<y4>\d{4})|FY\s?'?(?<y>\d{4}|\d{2}))(?!\d)|\b(?:full[\s-]year|calendar(?:\s+year)?)\s+(?<y5>\d{4})\b/g,
      when: /fiscal|FY|full[\s-]year|calendar/i,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "period", {
          value: yearFrom(m.groups.y4 || m.groups.y || m.groups.y5),
        }),
    },
    {
      re: /\bH(?<h>[12])(?!\d)(?:\s?(?:FY\s?'?(?<y2>\d{2}|\d{4})|'(?<y3>\d{2})|(?<y4>\d{4})))?(?![\dA-Za-z])/g,
      when: /H[12]/,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "period", {
          value: yearFrom(m.groups.y2 || m.groups.y3 || m.groups.y4),
        }),
    },
    {
      re: /\b(?:year[\s-]over[\s-]year|year[\s-]on[\s-]year|quarter[\s-]over[\s-]quarter|sequential(?:ly)?)\b|\b(?:YoY|QoQ)\b|(?<![\w/])[yq]\/[yq](?![\w/])/gi,
      when: /year|quarter|sequential|yoy|qoq|[yq]\/[yq]/i,
      build: (m, t) => makeMatch(t, m.index, m.index + m[0].length, "period"),
    },

    // ---- Dates ----
    {
      when: /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/,
      re: new RegExp(
        String.raw`\b${MONTH}\s+(?<d>\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(?<y>\d{4}))?(?!\d)|` +
          String.raw`\b(?<d2>\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}(?:,?\s+(?<y2>\d{4}))?(?![\w])|` +
          String.raw`\b${MONTH}\s+(?<y3>\d{4})\b`,
        "g"
      ),
      build: (m, t) => makeMatch(t, m.index, m.index + m[0].length, "date"),
    },

    // ---- Names and models with numbers in them ----
    {
      // Index names and SEC forms.
      re: /\b(?:S&P\s?(?:500|400|600|100)|Nasdaq[-\s]100|FTSE\s?(?:100|250|350)|Dow(?:\sJones)?\s30|Russell\s(?:1000|2000|3000)|Euro\sStoxx\s50|Fortune\s(?:500|100|50)|DAX\s?40|CAC\s?40|Nikkei\s225)\b|\b(?:Form\s+)?(?:10-K|10-Q|8-K|20-F|40-F|6-K|S-1|S-3|S-4|F-1)\b/g,
      when: /S&P|Nasdaq|FTSE|Dow|Russell|Stoxx|Fortune|DAX|CAC|Nikkei|\d-[A-Z]|[SF]-\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "name"),
    },
    {
      // Software versions.
      re: /\b(?:iOS|iPadOS|macOS|watchOS|tvOS|visionOS|Android|Windows|Office|Python|Java|Chrome|Firefox|Ubuntu|[Vv]ersion)\s?\d+(?:\.\d+)*\b|\bv\d+(?:\.\d+)*\b/g,
      when: /iOS|iPadOS|macOS|watchOS|tvOS|visionOS|Android|Windows|Office|Python|Java|Chrome|Firefox|Ubuntu|[Vv]ersion|\bv\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "version"),
    },
    {
      // Product and model names: "iPhone 17", "RTX 4090", "GeForce 256", "Apple Watch Series 11".
      re: /\b(?:iPhone|iPad|iPod|MacBook|Apple\sWatch(?:\sSeries)?|Series|Pixel|Galaxy\s?[A-Z]?|Xbox|PlayStation|RTX(?:\sPRO)?|GTX|GeForce(?:\s(?:RTX|GTX))?|RIVA|Titan|Quadro|Jetson|Ryzen(?:\s\d)?|Core\si[3579]|Snapdragon|Exynos|Model|Boeing|Airbus\sA|Llama|GPT|Gemini|Colossus|DGX|HGX)[\s-]?\d+(?:\.\d+)?[A-Za-z]*(?:\s(?:Ti|Pro|Max|Ultra|Plus|Super|Air|mini))?\b/g,
      when: /iPhone|iPad|iPod|MacBook|Watch|Series|Pixel|Galaxy|Xbox|PlayStation|RTX|GTX|GeForce|RIVA|Titan|Quadro|Jetson|Ryzen|Core|Snapdragon|Exynos|Model|Boeing|Airbus|Llama|GPT|Gemini|Colossus|DGX|HGX/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "model"),
    },
    {
      // Letter-digit codes ("H100", "GB200", "L2", "NV10"), hyphenated names ("COVID-19",
      // "DGX-1", "Llama-3.1-Nemotron-Ultra-253B-v1") and "3D"/"5G". Lowercase words ending
      // in digits ("income1") are footnotes, so codes need a capital or are 1-2 letters;
      // hyphenated names need a capital too ("3-for-1" and "mid-2025" aren't names).
      re: /\b(?=[a-z]{0,2}[A-Z]|[A-Za-z]{1,2}\d)[A-Za-z]+\d+[A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*\b|\b(?=[a-z]*[A-Z])(?!(?:Mid|Late|Early|Pre|Post|Non|Ex|Full|Half|End|Top|Over|Under|Sub|Multi|Year|Calendar|Fiscal)-)[A-Za-z]{2,}-\d+(?:\.\d+)*[A-Za-z0-9]*(?:-[A-Za-z0-9.]+)*\b|\b[2-5][DG]\b/g,
      when: /[A-Za-z]-?\d|\b[2-5][DG]\b/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "model"),
    },

    // ---- Money ----
    {
      // In tables, any bracketed amount is negative: "($1.2 million)". In prose those
      // brackets are often just an aside, so this only runs with { inTable: true }.
      tableOnly: true,
      when: /\([$£€¥₹]/,
      re: new RegExp(String.raw`\((?<cur>${CURRENCY_PREFIX})(?<bn>${NUM})${NUM_END}(?<scale>${SCALE})\)`, "g"),
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "money", {
          ...amountFields(m.groups),
          currency: currencyCode(m.groups.cur),
        }),
    },
    {
      // Tight accounting brackets around currency: "($1.2)".
      re: new RegExp(String.raw`\((?<cur>${CURRENCY_PREFIX})(?<bn>${NUM})${NUM_END}\)`, "g"),
      when: /[$£€¥₹]/,
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "money", {
          ...amountFields(m.groups),
          currency: currencyCode(m.groups.cur),
        }),
    },
    {
      when: /[$£€¥₹]|USD|GBP|EUR|JPY|CNY|RMB|INR|CHF|CAD|AUD|HKD|SGD/,
      re: new RegExp(
        String.raw`(?:(?<![\w.])(?<sign>[-−])\s?)?(?<cur>${CURRENCY_PREFIX})(?<sign2>[-−])?` +
          String.raw`(?:\((?<bn>${NUM})${NUM_END}\)|(?<n1>${NUM})${NUM_END})` +
          String.raw`(?:${DASH}(?<n2>${NUM})${NUM_END}${NOT_PERCENT})?` +
          String.raw`(?<scale>${SCALE})?` +
          String.raw`(?<per>\s+(?:per|a)\s+(?:diluted\s+|basic\s+)?(?:common\s+|ordinary\s+)?share\b)?`,
        "g"
      ),
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, m.groups.per ? "perShare" : "money", {
          ...amountFields(m.groups),
          currency: currencyCode(m.groups.cur),
        }),
    },
    {
      // Currency after the number: "4.2 billion euros", "300 million USD".
      when: /dollar|euro|pound|sterling|yen|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY/,
      re: new RegExp(
        String.raw`(?<![\w.,])(?<n1>${NUM})${NUM_END}(?<scale>${SCALE})?\s?` +
          String.raw`(?<cur>U\.S\. dollars|dollars|euros?|pounds sterling|pounds|sterling|yen|USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY)\b`,
        "g"
      ),
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "money", {
          ...amountFields(m.groups),
          currency: currencyCode(m.groups.cur),
        }),
    },

    // ---- Pence: "240p", "15.5p" (value in pounds). Video resolutions aren't money. ----
    {
      when: /\dp\b/,
      re: new RegExp(String.raw`(?<![\w.,$£€])(?<n1>${NUM})${NUM_END}p\b`, "g"),
      build: (m, t) => {
        const raw = m.groups.n1;
        if (RESOLUTIONS.has(raw)) return junkMatch(t, m.index, m.index + m[0].length, "resolution");
        // Whole-number pence need a money word nearby ("shares fell to 240p"); decimals don't.
        const lead = t.slice(Math.max(0, m.index - 60), m.index);
        if (!raw.includes(".") && !PENCE_CONTEXT.test(lead)) {
          return junkMatch(t, m.index, m.index + m[0].length, "unit");
        }
        return makeMatch(t, m.index, m.index + m[0].length, "money", {
          value: tidy(toNumber(raw) / 100),
          currency: "GBP",
        });
      },
    },

    // ---- Percentages, basis points, multiples ----
    {
      when: /%|per\s?cent|pct|pts?\b|percentage/i,
      re: new RegExp(
        String.raw`(?<![\w.,])(?<sign>[+\-−±])?(?:\((?<bn>${NUM})${NUM_END}\)|(?<n1>${NUM})${NUM_END})` +
          String.raw`(?:${DASH}(?<n2>${NUM})${NUM_END})?` +
          String.raw`\s?(?:%|percentage\s+points?|percent\b|per\s?cent\b|pct\b|pts?\b)`,
        "g"
      ),
      build: (m, t) => makeMatch(t, m.index, m.index + m[0].length, "percent", amountFields(m.groups)),
    },
    {
      when: /basis|bps?\b/,
      re: new RegExp(
        String.raw`(?<![\w.,])(?<sign>[+\-−])?(?<n1>${NUM})${NUM_END}(?:${DASH}(?<n2>${NUM})${NUM_END})?` +
          String.raw`\s?(?:basis[\s-]points?|bps|bp)\b`,
        "g"
      ),
      build: (m, t) =>
        makeMatch(t, m.index, m.index + m[0].length, "basisPoints", amountFields(m.groups)),
    },
    {
      // "2.5x", "3.1 times earnings". "4 times a year" is a frequency, so it stays a count.
      when: /\d\s?[xX×]|times/,
      re: new RegExp(
        String.raw`(?<![\w.,])(?<n1>${NUM})${NUM_END}(?:${DASH}(?<n2>${NUM})${NUM_END})?` +
          String.raw`(?:\s?[xX×](?![A-Za-z\d])|\s+times(?=\s+${VALUATION_BASIS}))`,
        "g"
      ),
      build: (m, t) => makeMatch(t, m.index, m.index + m[0].length, "multiple", amountFields(m.groups)),
    },

    // ---- Footnote markers ----
    {
      re: /\[(?<n>\d{1,3})\]/g,
      when: /\[\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "footnote", { value: Number(m.groups.n) }),
    },
    {
      // "(1)" right after a word: "net income (1)".
      re: /(?<=[A-Za-z]\s?)\((?<n>\d{1,2})\)(?![\d%])/g,
      when: /[A-Za-z]\s?\(\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "footnote", { value: Number(m.groups.n) }),
    },
    {
      // Superscript-style digits stuck to a lowercase word: "income1", "loungers.1".
      re: /(?<=[a-z]|[a-z][.,;:)"”’])(?<n>\d{1,2})(?=[\s,;:.)]|$)/g,
      when: /[a-z][.,;:)"”’]?\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "footnote", { value: Number(m.groups.n) }),
    },
    {
      // A marker opening a footnote: "1 Marsh Series includes...", "...unrounded. 2 Figures are".
      re: /(?:^|(?<=[.!?]["”’]?\s))(?<n>\d{1,2})(?=\s[A-Z][a-z])/g,
      when: /(?:^|[.!?]["”’]?\s)\d/,
      build: (m, t) => junkMatch(t, m.index, m.index + m[0].length, "footnote", { value: Number(m.groups.n) }),
    },

    // ---- Everything else: years and counts ----
    {
      re: new RegExp(
        String.raw`(?<![\w.,$£€¥₹])(?<sign>[-−]\s?)?(?:\((?<bn>${NUM})${NUM_END}\)|(?<n1>${NUM})${NUM_END})` +
          String.raw`(?:${DASH}(?<n2>${NUM})${NUM_END}${NOT_PERCENT})?` +
          String.raw`(?<scale>\s?(?:${SCALE_WORDS})(?![A-Za-z])|[kKMBT](?![A-Za-z]))?`,
        "g"
      ),
      build: (m, t) => {
        const g = m.groups;
        const plain = g.bn ?? g.n1;
        const isYear = (s) => /^(?:19|20)\d{2}$/.test(s);
        if (isYear(plain) && !g.sign && !g.scale) {
          // "(2025)" is a year in brackets, not a negative number. "2024–25" is a year range.
          const fields = { value: Number(plain) };
          if (g.n2 !== undefined && (isYear(g.n2) || /^\d{2}$/.test(g.n2))) {
            fields.low = Number(plain);
            fields.high = isYear(g.n2) ? Number(g.n2) : 2000 + Number(g.n2);
          } else if (g.n2 !== undefined) {
            return makeMatch(t, m.index, m.index + m[0].length, "count", amountFields(g));
          }
          let start = m.index;
          let end = m.index + m[0].length;
          if (g.bn !== undefined) [start, end] = [start + 1, end - 1];
          return makeMatch(t, start, end, "year", fields);
        }
        return makeMatch(t, m.index, m.index + m[0].length, "count", amountFields(g));
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------------

  const RANGEABLE = new Set(["money", "perShare", "percent", "basisPoints", "multiple", "count"]);

  // "8% to 10%", "$10 billion to $12 billion", "between $505 million and $525 million"
  // become one match. "from X to Y" is a change, not a range, so it's left alone.
  function joinable(a, b, text) {
    if (a.junk || b.junk || a.low !== null || b.low !== null) return null;
    if (!RANGEABLE.has(a.type) || !RANGEABLE.has(b.type)) return null;
    if (a.type !== b.type && a.type !== "count") return null;
    const sep = text.slice(a.end, b.start);
    const before = text.slice(Math.max(0, a.start - 12), a.start);
    if (sep === "" && /^[-–—]/.test(b.raw)) return "dash"; // "8%-10%": the dash was read as a sign
    if (/^\s*(?:to|–|—|-)\s*$/i.test(sep)) return /\bfrom\s+$/i.test(before) ? null : "to";
    if (/^\s+and\s+$/i.test(sep) && /\bbetween\s+$/i.test(before)) return "and";
    return null;
  }

  function join(a, b, how, text) {
    let low = a.value;
    let high = how === "dash" ? Math.abs(b.value) : b.value;
    // A shared scale: "$10 to $12 billion" means 10 billion.
    if (!a.scale && b.scale) low = tidy(low * MULTIPLIER[b.scale]);
    if (a.scale && !b.scale) high = tidy(high * MULTIPLIER[a.scale]);
    return {
      ...b,
      raw: text.slice(a.start, b.end),
      start: a.start,
      type: a.type === "count" ? b.type : a.type,
      currency: a.currency || b.currency,
      scale: b.scale || a.scale,
      low,
      high,
      value: tidy((low + high) / 2),
      isNegative: high < 0,
    };
  }

  // Per-share phrases. An unscaled dollar amount is per share only when one of these comes
  // shortly before it in the same clause ("EPS rose to $1.42"), not just anywhere earlier.
  const EPS_PHRASE =
    /\b(?:EPS|earnings\s+per\s+(?:diluted\s+|basic\s+)?(?:common\s+)?share|(?:net\s+)?(?:income|loss)\s+per\s+(?:diluted\s+|basic\s+)?share|per[-\s](?:diluted\s+|basic\s+)?share|a\s+share|dividends?\s+of)\b/gi;
  const MAX_EPS_GAP_WORDS = 6;
  const CLAUSE_BREAK = /[;:]|,\s+(?:and|but|while|whereas|although|though)\b|\.\s/i;

  function tiedToPerShare(text, sentenceStart, amountStart) {
    const lead = text.slice(sentenceStart, amountStart);
    let last = null;
    for (const m of lead.matchAll(EPS_PHRASE)) last = m;
    if (!last) return false;
    const gap = lead.slice(last.index + last[0].length);
    if (CLAUSE_BREAK.test(gap)) return false;
    return gap.split(/\s+/).filter(Boolean).length <= MAX_EPS_GAP_WORDS;
  }

  // ---------------------------------------------------------------------------
  // Scoring (step 8)
  // ---------------------------------------------------------------------------

  const CHANGE_WORDS = new Set(
    ("rose rise rises risen rising fell fall falls fallen falling grew grow grows growing " +
      "increased increase increases decreased decrease decreases declined decline declines " +
      "jumped jump jumps slipped slip slips up down beat beats missed miss misses topped tops " +
      "exceeded exceeds improved improves widened widens narrowed narrows from to").split(" ")
  );
  const CHANGE_TEST = new RegExp(`\\b(?:${[...CHANGE_WORDS].join("|")})\\b`, "i");
  const wordCount = (text) => (text.match(/\S+/g) || []).length;
  const FINANCE_TERM =
    /\b(?:revenues?|sales|profits?|net income|operating income|margins?|EPS|earnings|guidance|outlook|forecasts?|cash flow|debt|dividends?|buybacks?|repurchases?|growth|estimates?|consensus)\b/i;
  const COMPARISON =
    /\b(?:versus|vs\.?|compared (?:with|to)|year[\s-](?:over|on)[\s-]year|(?:above|below|ahead of|short of|in line with) (?:expectations|estimates|forecasts|consensus)|consensus|a year (?:ago|earlier)|prior[\s-]year)\b|\bfrom\b[^.;]{1,60}?\bto\b/i;
  // Types that count as "a figure" for change words and the only-counts penalty.
  const KEY_TYPES = new Set(["money", "perShare", "percent", "basisPoints", "multiple"]);
  const CHANGEABLE = new Set(["money", "perShare", "percent", "basisPoints", "multiple", "count"]);
  const PERIOD_LIKE = new Set(["period", "year", "date"]);

  const wordsOf = (text) => [...text.matchAll(/\S+/g)].map((m) => ({
    word: m[0].toLowerCase().replace(/^[^\w$£€¥%+-]+|[^\w%]+$/g, ""),
    start: m.index,
    end: m.index + m[0].length,
  }));

  // Is a change word within CHANGE_WINDOW words of this number?
  function nearChangeWord(words, match) {
    const first = words.findIndex((w) => w.end > match.start);
    let last = first;
    while (last + 1 < words.length && words[last + 1].start < match.end) last++;
    if (first === -1) return false;
    for (let i = Math.max(0, first - CHANGE_WINDOW); i <= Math.min(words.length - 1, last + CHANGE_WINDOW); i++) {
      if ((i < first || i > last) && CHANGE_WORDS.has(words[i].word)) return true;
    }
    return false;
  }

  // Score one unit: a sentence, or a table row joined with " | ".
  // numbers: detectNumbers() on unit.text. context: { inTable, bold, underNumberHeading,
  // headerNumbers } where headerNumbers are detected in the column headers above the
  // row's figures. Each signal counts once.
  function scoreUnit(unit, numbers, context = {}) {
    const reasons = [];
    let score = 0;
    const add = (name, label) => {
      score += WEIGHTS[name];
      reasons.push(`${label} ${WEIGHTS[name] > 0 ? "+" : ""}${WEIGHTS[name]}`);
    };
    const real = numbers.filter((n) => !n.junk);
    // Context signals ignore words inside junk: an inflation note's "equivalent to" isn't a
    // change word, and a phone number line's words aren't finance terms. Junk spans are
    // blanked out (same length, so number positions still line up).
    let text = unit.text;
    for (const n of numbers) {
      if (n.junk) text = text.slice(0, n.start) + " ".repeat(n.end - n.start) + text.slice(n.end);
    }
    const has = (...types) => real.some((n) => types.includes(n.type));

    if (has("money")) add("money", "money");
    if (has("percent", "basisPoints")) add("percent", "percent");
    if (has("perShare")) add("perShare", "per share");
    // The word-by-word check only runs if a change word appears at all (most rows have none).
    if (CHANGE_TEST.test(text)) {
      const words = wordsOf(text);
      if (real.some((n) => CHANGEABLE.has(n.type) && nearChangeWord(words, n))) add("changeWord", "change word");
    }
    if (FINANCE_TERM.test(text)) add("financeTerm", "finance term");
    const headerPeriod = (context.headerNumbers || []).some((n) => !n.junk && PERIOD_LIKE.has(n.type));
    if (has("period") || headerPeriod) add("period", "period");
    if (COMPARISON.test(text)) add("comparison", "comparison");
    // Rows with column headers already get the period point from them, so being in a table
    // only counts for rows without headers.
    const tableBonus = context.inTable && !context.hasHeaders;
    if (tableBonus || context.bold || context.underNumberHeading) {
      add("context", context.bold ? "bold" : context.underNumberHeading ? "under number heading" : "in table");
    }
    if (has("multiple")) add("multiple", "multiple");

    // Recency: compared with the page's newest year (capped at the current year; see
    // pageYear), not today's date, so older articles aren't penalised for their age. Skipped
    // when the unit names a current period ("Q3", "the third quarter") or has no explicit year.
    const unitYear = newestYear(real);
    if (context.pageNewestYear && unitYear && !hasCurrentPeriod(real)) {
      const age = context.pageNewestYear - unitYear;
      if (age >= RECENCY_OLD_YEARS) add("recencyOld", `${age} years older than the page`);
      else if (age >= RECENCY_DATED_YEARS) add("recencyDated", `${age} years older than the page`);
    }

    if (numbers.length && !real.length) add("onlyJunk", "only junk");
    else if (real.length && !real.some((n) => KEY_TYPES.has(n.type)) && has("count", "year")) {
      add("onlyCounts", "only counts/years");
    }
    if (wordCount(text) > RAMBLING_WORDS) add("rambling", "over 60 words");
    return { score, reasons };
  }

  // Figures for spotting the same number twice. Money and per-share figures compare by
  // significant digits, so "$46,743" in a table "(in millions)" matches "$46.7 billion" in
  // prose; a 0.5% tolerance absorbs that rounding (money only).
  const FIGURE_TOLERANCE = 0.005;
  function keyFigures(numbers) {
    const figures = [];
    for (const n of numbers) {
      if (n.junk || typeof n.value !== "number" || n.value === 0) continue;
      const v = Math.abs(n.value);
      if (n.type === "money" || n.type === "perShare") {
        figures.push({ group: "money", digits: v / 10 ** Math.floor(Math.log10(v)) });
      } else if (n.type === "percent" || n.type === "basisPoints") {
        figures.push({ group: n.type, digits: v });
      }
    }
    return figures;
  }
  // A unit's main figure: its first money figure, else its first percentage.
  const mainFigure = (figures) => figures.find((f) => f.group === "money") || figures[0] || null;
  // Only money gets the rounding tolerance; percentages are stated exactly ("35.1%" isn't "35%").
  const sameFigure = (a, b) =>
    a.group === b.group &&
    Math.abs(a.digits - b.digits) <= (a.group === "money" ? b.digits * FIGURE_TOLERANCE : 1e-9);

  // Explicit years in a unit's numbers: years, year ranges, dated periods ("fiscal 2026",
  // "Q3 2025") and dates ("March 31, 2026"). Junk (copyright years) never counts.
  const YEAR_IN_TEXT = /\b(?:19|20)\d{2}\b/g;
  function yearsOf(n) {
    if (n.junk) return [];
    if (n.type === "year") return [n.value, n.low, n.high].filter((y) => typeof y === "number");
    if (n.type === "period") return n.decade || typeof n.value !== "number" ? [] : [n.value];
    if (n.type === "date") return (n.raw.match(YEAR_IN_TEXT) || []).map(Number);
    return [];
  }
  function newestYear(numbers) {
    const years = numbers.flatMap(yearsOf);
    return years.length ? Math.max(...years) : null;
  }
  // The page's reference year for recency: its newest explicit year, but never later than
  // the current year, so forward-looking mentions ("by 2031") don't make today's figures
  // look old. currentYear is injectable for deterministic tests.
  function pageYear(numbers, currentYear = new Date().getFullYear()) {
    const newest = newestYear(numbers);
    return newest == null ? null : Math.min(newest, currentYear);
  }
  // A period with no year of its own ("Q3", "the third quarter", "H1"), but not the
  // year-over-year style markers, which say nothing about when.
  const hasCurrentPeriod = (numbers) =>
    numbers.some(
      (n) => n.type === "period" && n.value == null && !n.decade &&
        !/year|over|sequential|yoy|qoq|[yq]\/[yq]/i.test(n.raw)
    );

  // The company's own forward-looking statements are guidance; analysts' and the market's
  // expectations are growth/estimates. Returns null when neither applies.
  const ANALYST_LANGUAGE = /\b(?:analysts?|consensus|estimates?|expectations?|Wall Street|the Street|forecasters?|economists?)\b/i;
  const FORWARD_CUE = /\b(?:expects?|expected|expecting|anticipates?|anticipated|forecasts?|forecasted|projects?|projected|outlook|guidance|guides?)\b|\bnext (?:quarter|year)\b/i;
  // "Lilypad expects", "the company anticipates", "is raising its full-year guidance".
  const COMPANY_FORWARD = /\b(?:the company|company|we|management|the board|[A-Z][A-Za-z.&'-]+(?:\s+(?:Holdings|Inc\.?|Corp\.?|Corporation|Group|Platforms))?)\s+(?:now\s+|still\s+|also\s+)?(?:expects|anticipates|forecasts|projects|guides|raised its (?:\w+\s+)?(?:guidance|outlook|forecast)|is raising its (?:[\w-]+\s+){0,3}(?:guidance|outlook|forecast))\b/;
  // "outlook for Q4", "full-year guidance", "fiscal 2027 outlook", "next quarter".
  const PERIOD_FORWARD = /\b(?:outlook|guidance|forecast)\s+(?:for|of)\s+(?:the\s+)?(?:fourth|third|second|first|next|coming|full[\s-]year|fiscal|current|Q[1-4]|\d{4})|\b(?:full[\s-]year|annual|fiscal(?:\s+(?:year\s+)?\d{4})?|quarterly|next[\s-]quarter|\d{4})(?:\s+[\w-]+){0,2}\s+(?:guidance|outlook|forecast)\b|\bnext (?:quarter|year|fiscal year)\b/i;
  // A passive "is expected to" counts only with a company metric ("Revenue is expected to
  // be $54.0 billion"), not for the economy ("GDP growth is expected to be robust").
  const PASSIVE_FORWARD = /\b(?:is|are) expected to\b/i;
  const COMPANY_METRIC = /\b(?:revenues?|sales|margins?|EPS|earnings per share|operating (?:income|expenses?)|net income|gross profit|capital expenditures?|capex|cash flow|dividends?|buybacks?)\b/i;

  function forwardTopic(text) {
    if (!FORWARD_CUE.test(text)) return null;
    if (ANALYST_LANGUAGE.test(text)) return "growth/estimates";
    if (COMPANY_FORWARD.test(text) || PERIOD_FORWARD.test(text)) return "guidance/outlook/forecast";
    if (PASSIVE_FORWARD.test(text) && COMPANY_METRIC.test(text)) return "guidance/outlook/forecast";
    return null;
  }

  // A unit's topic: guidance or growth/estimates for forward-looking statements (above),
  // otherwise the topic of its earliest finance term, or "other".
  function topicOf(text) {
    const forward = forwardTopic(text);
    if (forward) return forward;
    let best = null;
    WEIGHTS.topics.forEach(([name, re], rank) => {
      const m = re.exec(text);
      if (m && (!best || m.index < best.index || (m.index === best.index && rank < best.rank))) {
        best = { name, index: m.index, rank };
      }
    });
    return best ? best.name : "other";
  }

  const positiveSignals = (unit) => (unit.reasons || []).filter((r) => / \+\d+$/.test(r)).length;

  // Ties: prose sentences before table rows, then more distinct positive signals, then page order.
  const rankOrder = (a, b, scoreA = a.score, scoreB = b.score) =>
    scoreB - scoreA ||
    (a.kind === "row") - (b.kind === "row") ||
    positiveSignals(b) - positiveSignals(a) ||
    a.order - b.order;

  // Choose targets from scored units ({ score, numbers, group, table, order, words, kind }).
  // Highest scores first (see rankOrder for ties). A unit whose main figure is already picked
  // loses WEIGHTS.duplicate, and one whose topic is already covered loses WEIGHTS.topicCovered
  // for selection; either way it goes back in the queue to compete at the lower score.
  // Spread limits per block and per table; the result is in page order (the frog only hops down).
  function pickTargets(units, options = {}) {
    const totalWords = options.totalWords ?? units.reduce((sum, u) => sum + (u.words || 0), 0);
    const passing = units.filter((u) => u.score >= MIN_SCORE);
    let wanted = Math.min(MAX_TARGETS, Math.max(MIN_TARGETS, Math.round(totalWords / WORDS_PER_TARGET)));
    if (passing.length >= MIN_TARGETS_WHEN_RICH) wanted = Math.max(wanted, MIN_TARGETS_WHEN_RICH);
    const ranked = passing.sort((a, b) => rankOrder(a, b));

    const chosen = [];
    const seen = []; // key figures of everything picked so far
    const perBlock = new Map();
    const perTable = new Map();
    const topicCounts = new Map(); // topic -> how many chosen units cover it
    const rowTopics = new Set(); // named topics that already have a table row chosen
    const queue = ranked.map((unit) => ({
      unit,
      score: unit.score,
      penalised: false,
      topicPenalty: 0,
      topic: (unit.topic = topicOf(unit.text)),
    }));
    const byScore = (a, b) => rankOrder(a.unit, b.unit, a.score, b.score);
    const requeue = (entry) => {
      if (entry.score >= MIN_SCORE) {
        queue.push(entry);
        queue.sort(byScore);
      }
    };
    while (queue.length && chosen.length < wanted) {
      const entry = queue.shift();
      const { unit } = entry;
      if ((perBlock.get(unit.group) || 0) >= MAX_PER_BLOCK) continue;
      if (unit.table != null && (perTable.get(unit.table) || 0) >= MAX_ROWS_PER_TABLE) continue;
      const figures = keyFigures(unit.numbers || []);
      const main = mainFigure(figures);
      if (!entry.penalised && main && seen.some((f) => sameFigure(main, f))) {
        // Its main figure is already covered: knock it down and let it compete again at the
        // lower score, rather than picking it ahead of units that are now better.
        entry.score += WEIGHTS.duplicate;
        entry.penalised = true;
        unit.reasons = [...(unit.reasons || []), `duplicate figure ${WEIGHTS.duplicate}`];
        requeue(entry);
        continue;
      }
      // Variety: WEIGHTS.topicCovered for each chosen unit already on this topic ("other"
      // included). The first table row on a named topic is exempt, so a headline row (an
      // infobox "Revenue") isn't crowded out by sentences. Selection only: never in the
      // displayed score, and never a reason to drop below MIN_SCORE; it reorders the queue.
      const covered = topicCounts.get(entry.topic) || 0;
      const exempt = unit.kind === "row" && entry.topic !== "other" && !rowTopics.has(entry.topic);
      const penalty = covered && !exempt ? WEIGHTS.topicCovered * covered : 0;
      if (penalty !== entry.topicPenalty) {
        entry.score += penalty - entry.topicPenalty;
        entry.topicPenalty = penalty;
        unit.reasons = [
          ...(unit.reasons || []).filter((r) => !r.startsWith("topic already covered")),
          ...(penalty ? [`topic already covered ${penalty}`] : []),
        ];
        queue.push(entry);
        queue.sort(byScore);
        continue;
      }
      unit.finalScore = unit.score + (entry.penalised ? WEIGHTS.duplicate : 0);
      chosen.push(unit);
      topicCounts.set(entry.topic, covered + 1);
      if (unit.kind === "row" && entry.topic !== "other") rowTopics.add(entry.topic);
      seen.push(...figures);
      perBlock.set(unit.group, (perBlock.get(unit.group) || 0) + 1);
      if (unit.table != null) perTable.set(unit.table, (perTable.get(unit.table) || 0) + 1);
    }
    for (const entry of queue) if (entry.penalised) entry.unit.finalScore = entry.unit.score + WEIGHTS.duplicate;
    return chosen.sort((a, b) => a.order - b.order);
  }

  // Score every unit and pick targets. Units come from FrogbotExtract.buildUnits():
  // { text, kind: "sentence" | "row", headers, context, group, table, order }.
  // options: { totalWords, currentYear } (currentYear defaults to today's; set it in tests).
  // Adds numbers / score / reasons / chosen to each unit and returns { units, chosen }.
  function rankUnits(units, options = {}) {
    for (const unit of units) {
      // Rows arrive with their numbers already detected cell by cell (see buildUnits).
      unit.numbers = unit.numbers || detectNumbers(unit.text, { inTable: unit.kind === "row" });
    }
    // The page's reference year for the recency penalty (options.currentYear for tests).
    const pageNewestYear = pageYear(units.flatMap((u) => u.numbers), options.currentYear);
    for (const unit of units) {      const headerNumbers = (unit.headers || []).flatMap((h) => detectNumbers(h));
      const hasHeaders = (unit.headers || []).length > 0;
      const { score, reasons } = scoreUnit(unit, unit.numbers, {
        ...unit.context,
        headerNumbers,
        hasHeaders,
        pageNewestYear,
      });
      unit.score = score;
      unit.reasons = reasons;
      unit.words = wordCount(unit.text);
      unit.chosen = false;
    }
    const chosen = pickTargets(units, options);
    for (const unit of chosen) unit.chosen = true;
    return { units, chosen };
  }

  // ---------------------------------------------------------------------------
  // What to highlight (step 9)
  // ---------------------------------------------------------------------------

  const HIGHLIGHT_TYPES = new Set(["money", "perShare", "percent", "basisPoints", "multiple"]);
  const WHEN_TYPES = new Set(["period", "date", "year"]);
  const ATTACH_CHARS = 15; // a period this close to a figure belongs to it ("$12.4B in Q3 2026")

  // The figures to highlight in a chosen sentence or row, in order: every non-junk money,
  // per-share, percent, basis-point and multiple figure, each with the periods, dates and
  // years attached to it (separated by a short connector and no clause break).
  // Returns [{ figure, extras: [periods...] }].
  function figureGroups(numbers, text) {
    const real = numbers.filter((n) => !n.junk);
    const groups = real
      .filter((n) => HIGHLIGHT_TYPES.has(n.type))
      .map((figure) => ({ figure, extras: [] }));
    for (const n of real) {
      // Comparison markers ("year over year", "sequentially") are typed period but aren't dates.
      if (!WHEN_TYPES.has(n.type) || n.decade || /over|on[\s-]year|sequential|yoy|qoq|[yq]\/[yq]/i.test(n.raw)) continue;
      let best = null;
      let bestGap = Infinity;
      for (const group of groups) {
        const f = group.figure;
        const between =
          n.start >= f.end ? text.slice(f.end, n.start) : n.end <= f.start ? text.slice(n.end, f.start) : null;
        if (between === null || between.length > ATTACH_CHARS || /[.;:|]|\band\b/.test(between)) continue;
        if (between.length < bestGap) {
          best = group;
          bestGap = between.length;
        }
      }
      if (best) best.extras.push(n);
    }
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const ABBREVIATIONS = new Set(
    (
      "inc corp ltd co llc plc lp vs e.g i.e approx no nos mr mrs ms dr prof st jr sr " +
      "a.m p.m u.s u.k u.n e.u jan feb mar apr jun jul aug sep sept oct nov dec calif fig est " +
      "dept gov sen rep gen lt col mt ft vol op ch pp"
    ).split(" ")
  );

  // Sentences with their character positions. Splits after . ! ? followed by a space and
  // a capital, digit or opening quote, except after abbreviations and initials.
  function splitSentences(text) {
    const sentences = [];
    let start = 0;
    const boundary = /[.!?]["'”’)\]]*\s+(?=["'“‘(\[]?[A-Z0-9])/g;
    for (const m of text.matchAll(boundary)) {
      const punct = m.index;
      if (text[punct] === ".") {
        const word = text.slice(0, punct).match(/(\S+)$/);
        const token = word ? word[1].replace(/^["'“‘(\[]+/, "") : "";
        if (ABBREVIATIONS.has(token.toLowerCase())) continue;
        if (/^(?:[A-Z]\.)*[A-Z]$/.test(token)) continue; // initials: "J.P", "U.S", "J"
      }
      const end = punct + m[0].trimEnd().length;
      pushSentence(sentences, text, start, end);
      start = m.index + m[0].length;
    }
    pushSentence(sentences, text, start, text.length);
    return sentences;
  }

  function pushSentence(sentences, text, start, end) {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) sentences.push({ text: text.slice(start, end), start, end });
  }

  // Results are cached by text: scoring runs the same column headers and cell values
  // through detection many times. Treat the returned arrays as read-only.
  const detectCache = new Map();
  const DETECT_CACHE_SIZE = 5000;

  // options.inTable: the text is a table cell, where bracketed amounts are always negative.
  function detectNumbers(text, options = {}) {
    const key = (options.inTable ? "T|" : "P|") + text;
    const cached = detectCache.get(key);
    if (cached) return cached;
    const result = detectNumbersUncached(text, options);
    if (detectCache.size >= DETECT_CACHE_SIZE) detectCache.clear();
    detectCache.set(key, result);
    return result;
  }

  function detectNumbersUncached(text, options) {
    if (!text || !/\d|year|quarter|half|sequential|yoy|qoq|[yq]\/[yq]/i.test(text)) return [];
    const taken = [];
    const free = (s, e) => taken.every(([ts, te]) => e <= ts || s >= te);

    const found = [];
    for (const pattern of PATTERNS) {
      // A cheap pre-check skips patterns that can't match this text.
      if (pattern.when && !pattern.when.test(text)) continue;
      if (pattern.tableOnly && !options.inTable) continue;
      pattern.re.lastIndex = 0;
      for (const m of text.matchAll(pattern.re)) {
        const built = pattern.build(m, text);
        if (!built) continue;
        for (const match of Array.isArray(built) ? built : [built]) {
          const [cs, ce] = match.claim || [match.start, match.end];
          if (!free(cs, ce)) continue;
          taken.push([cs, ce]);
          delete match.claim;
          found.push(match);
        }
      }
    }
    found.sort((a, b) => a.start - b.start);

    // Ranges.
    const merged = [];
    for (const m of found) {
      const prev = merged[merged.length - 1];
      const how = prev && joinable(prev, m, text);
      if (how) merged[merged.length - 1] = join(prev, m, how, text);
      else merged.push(m);
    }

    // Per-share figures tied to a phrase just before them ("EPS of $1.42"), and "negative $5m".
    let sentences = null;
    for (const m of merged) {
      if (m.type === "money" && !m.scale) {
        sentences = sentences || splitSentences(text);
        const sentence = sentences.find((s) => m.start >= s.start && m.start < s.end) || { start: 0 };
        if (tiedToPerShare(text, sentence.start, m.start)) m.type = "perShare";
      }
      if (!m.junk && !m.isNegative && /\bnegative\s+$/i.test(text.slice(Math.max(0, m.start - 12), m.start))) {
        m.isNegative = true;
        if (typeof m.value === "number") m.value = -Math.abs(m.value);
      }
    }
    return merged;
  }

  const FrogbotScore = {
    splitSentences,
    detectNumbers,
    scoreUnit,
    pickTargets,
    rankUnits,
    topicOf,
    pageYear,
    figureGroups,
    WEIGHTS,
    MIN_SCORE,
  };
  if (typeof window !== "undefined" && !window.FrogbotScore) window.FrogbotScore = FrogbotScore;
  if (typeof module !== "undefined" && module.exports) module.exports = FrogbotScore;
})();
