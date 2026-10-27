// Scoring test cases for content/score.js (scoreUnit and pickTargets), run by
// tests/run-tests.html and tools/run_tests.py as the "Scoring" section.
//
// A unit is a sentence string, or { text, row: true, headers: [...], context: {...} } for a
// table row (cells joined with " | ", headers = the column headers above its figures).
// Kinds:
//   beats:   { a, b }          a must score higher than b
//   passes:  { unit }          score >= MIN_SCORE
//   fails:   { unit }          score < MIN_SCORE
//   below:   { unit, than }    score < than
//   picks:   { units, expect } pickTargets chooses exactly these indexes (in page order)
//   same:    { a, b }          a and b score the same
//   topic:   { text, topic }   topicOf(text) is this topic
//   pageYear: { texts, currentYear, expect }  the page's reference year for recency
//   figures: { text, expect: [[figure, [attached periods]]] }  what step 9 highlights
(() => {
  const row = (text, headers = [], context = {}) => ({ text, row: true, headers, context });
  const cases = [
    // ---- Comparisons ----
    { kind: "beats", a: "Revenue rose 8% to $12.4 billion in Q3 compared with $11.5 billion a year ago", b: "The company has 4,000 employees in 12 countries" },
    { kind: "beats", a: "Net income rose 28% to $61.3 million.", b: "The company was founded in 1998 in Pond City." },
    { kind: "beats", a: "Diluted EPS was $1.27, up from $1.12 a year earlier.", b: "The stock trades on Nasdaq under the ticker LILY." },
    { kind: "beats", a: "Gross margin expanded 180 basis points to 43.5%.", b: "The company opened 12 new stores in 2026." },
    { kind: "beats", a: "The company raised its full-year revenue guidance to $1.88 billion.", b: "The company raised its full-year revenue guidance." },
    { kind: "beats", a: "Revenue grew 14% year over year to $482.6 million.", b: "Revenue was $482.6 million." },
    { kind: "beats", a: "Operating income of $84.0 million, an operating margin of 17.4%.", b: "Lilypad will host a conference call on October 22, 2026 at 5:00 p.m." },
    { kind: "beats", a: row("Revenue | $12.4B | $11.5B | +8%", ["Q3 2026", "Q3 2025", "Change"]), b: row("Employees | 4,000 | 3,800") },
    // Column headers that are periods earn the period point; rows with headers don't also get
    // a free "in table" point, so non-period headers score lower than period headers.
    { kind: "beats", a: row("Revenue | $12.4B | $11.5B | +8%", ["Q3 2026", "Q3 2025", "Change"]), b: row("Revenue | $12.4B | $11.5B | +8%", ["Segment A", "Segment B", "Change"]) },
    { kind: "beats", a: "Free cash flow rose to $55.8 million.", b: "There are about 12,250 data centres around the world." },
    { kind: "beats", a: "Shares fell 5% after the company missed estimates.", b: "Shares fell after the company missed estimates." },
    { kind: "beats", a: "The stock trades at 25 times forward earnings, above its 10-year average.", b: "The company has 25 offices." },
    { kind: "beats", a: "Revenue is expected to be $54.0 billion, plus or minus 2%.", b: "Nvidia was founded on April 5, 1993." },
    { kind: "beats", a: "EPS of $1.42 beat the consensus estimate of $1.35.", b: "The company employs 1,200 engineers." },
    { kind: "beats", a: "Data centre revenue jumped 56% to $41.1 billion.", b: "GeForce RTX 4090 graphics cards went on sale in 2022." },

    // ---- Threshold: should pass ----
    { kind: "passes", unit: "Revenue rose to $482.6 million, up 14.2% year over year, driven by strong demand for loungers." },
    { kind: "passes", unit: "Diluted earnings per share were $1.27, ahead of the $1.12 reported a year earlier." },
    { kind: "passes", unit: "Gross margin expanded 180 basis points to 43.5%, reflecting lower resin costs." },
    { kind: "passes", unit: "For the fourth quarter of 2026, Lilypad expects revenue between $505 million and $525 million." },
    { kind: "passes", unit: "NVIDIA today reported revenue for the second quarter ended July 27, 2025, of $46.7 billion, up 6% from the previous quarter and up 56% from a year ago." },
    { kind: "passes", unit: "The Company posted quarterly revenue of $102.5 billion, up 8 percent year over year." },
    { kind: "passes", unit: "Revenue for the companies that have reported is 5.9% above estimates." },
    { kind: "passes", unit: row("Revenue | $12.4B | $11.5B | +8%", ["Q3 2026", "Q3 2025", "Change"]) },
    { kind: "passes", unit: row("Net income | $26,422 | $18,775 | $16,599 | 41% | 59%", ["Q2 FY26", "Q1 FY26", "Q2 FY25", "Q/Q", "Y/Y"]) },
    { kind: "passes", unit: row("Revenue | US$215.9 billion (FY26)") },
    { kind: "passes", unit: { text: "Net sales rose 12% to $8.4 billion.", context: { bold: true } } },

    // ---- Threshold: should fail ----
    { kind: "fails", unit: "179 S&P 500 companies are scheduled to report" },
    { kind: "fails", unit: "The company has 4,000 employees in 12 countries" },
    { kind: "fails", unit: "Founded in 1998, Lilypad designs outdoor furniture sold through more than 2,400 retail partners." },
    { kind: "fails", unit: "Lilypad will host a conference call to discuss these results on October 22, 2026 at 5:00 p.m. Eastern Time." },
    { kind: "fails", unit: "In 1996, Huang laid off more than half of Nvidia's employees, reducing headcount from 100 to 40." },
    { kind: "fails", unit: "With $40,000 in the bank, the company was born." },
    { kind: "fails", unit: "The iPhone 17 lineup launched in September." },
    { kind: "fails", unit: "The quarter ended September 30, 2026." },
    { kind: "fails", unit: row("Employees | 4,000 | 3,800") },
    { kind: "fails", unit: "Apple will provide live streaming of its Q4 2025 financial results conference call." },

    // ---- Below zero ----
    { kind: "below", than: 0, unit: "© 2025 Apple Inc. All rights reserved." },
    { kind: "below", than: 0, unit: "To join by phone, dial (555) 014-7781 and reference conference ID 4471." },
    { kind: "below", than: 0, unit: "Investor Relations · 742 Bullrush Avenue, Pond City, OR 97999" },
    { kind: "below", than: 0, unit: "Page 1 of 3" },
    { kind: "below", than: 0, unit: "IR contact: ir@example.com · Tel. (555) 014-7700" },

    // ---- Picking ----
    {
      // The same revenue figure in a sentence and a table row: the row drops below the
      // others once the sentence is picked, so the other rows win the remaining slots.
      kind: "picks",
      units: [
        "Revenue rose 8% to $12.4 billion in Q3 compared with $11.5 billion a year ago.",
        row("Revenue | $12.4B | $11.5B | +8%", ["Q3 2026", "Q3 2025", "Change"]),
        row("Net income | $2.1B | $1.8B | +17%", ["Q3 2026", "Q3 2025", "Change"]),
        row("Operating income | $3.0B | $2.6B | +15%", ["Q3 2026", "Q3 2025", "Change"]),
      ],
      totalWords: 300, // 3 targets
      expect: [0, 2, 3],
    },
    {
      // Duplicates go by each unit's main figure. The Data Center sentence shares "56%" with
      // the headline by coincidence but its main figure ($41.1B) is new, so it isn't penalised.
      // The table's "$46,743" (in millions) is the headline's "$46.7 billion", so the revenue
      // row drops below the Gaming sentence and misses out.
      kind: "picks",
      units: [
        "NVIDIA reported revenue of $46.7 billion, up 6% from the previous quarter and up 56% from a year ago.",
        "Data Center revenue was $41.1 billion, up 5% from the previous quarter and up 56% from a year ago.",
        row("Revenue | $46,743 | $44,062 | 6% | 56%", ["Q2 FY26", "Q1 FY26", "Q/Q", "Y/Y"]),
        "Gaming revenue was $4.3 billion, up 14% from the previous quarter.",
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 3],
    },
    {
      // Percentages match exactly: TSMC's 35.1% isn't Nvidia's 35%, so nothing is penalised.
      kind: "picks",
      units: [
        "GAAP net income rose 94% year-over-year and 35% quarter-over-quarter to approximately $43 billion.",
        "Its manufacturing partner TSMC reported a 35.1% year-on-year jump in quarterly revenue.",
        "Gaming revenue rose 2% to $4.1 billion in the quarter.",
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 2],
    },
    {
      // Spread: at most 4 rows from one table, even when they all score well.
      kind: "picks",
      units: [1, 2, 3, 4, 5, 6].map((n) => row(`Segment ${n} revenue | $${n}.1B | $${n}.0B | +${n}%`, ["Q3 2026", "Q3 2025", "Change"], { table: "t1" })),
      totalWords: 1800, // 12 targets wanted
      expect: [0, 1, 2, 3],
    },
    {
      // Spread: at most 2 sentences from the same block.
      kind: "picks",
      units: [
        { text: "Revenue rose 8% to $12.4 billion.", group: 1 },
        { text: "Net income rose 17% to $2.1 billion.", group: 1 },
        { text: "Operating income rose 15% to $3.0 billion.", group: 1 },
        { text: "Free cash flow grew 9% to $1.1 billion.", group: 2 },
      ],
      totalWords: 600,
      expect: [0, 1, 3],
    },
    {
      // Ties: prose sentences beat table rows. All four score 9; with 3 slots the row misses out.
      kind: "picks",
      units: [
        row("Net income | $2.1B | $1.8B | +17%", ["Q3 2026", "Q3 2025", "Change"]),
        "Free cash flow was $1.1 billion versus $0.9 billion, 9% of sales.",
        "Net debt was $4.2 billion versus $4.6 billion, 12% of assets.",
        "Buybacks totalled $2 billion versus $1.5 billion, 4% of market value.",
      ],
      totalWords: 300, // 3 targets
      expect: [1, 2, 3],
    },
    {
      // Variety: once revenue is covered, the other revenue sentences lose 1 for selection,
      // so the EPS sentence (same score) gets a slot ahead of them.
      kind: "picks",
      units: [
        "Revenue rose 8% to $12.4 billion compared with $11.5 billion.",
        "Data centre revenue rose 9% to $4.1 billion.",
        "Gaming revenue rose 7% to $2.2 billion.",
        "Diluted EPS rose 5% to $1.20.",
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 3],
    },
    {
      // Target count: 300 words would give 3, but with 5+ units passing the minimum is 5.
      kind: "picks",
      units: [1, 2, 3, 4, 5, 6].map((n) => `Segment ${n} revenue rose ${n}% to $${n}.5 billion.`),
      totalWords: 300,
      expect: [0, 1, 2, 3, 4],
    },
    {
      // First-row exemption: the infobox Revenue row is the first table row on revenue, so it
      // isn't penalised for the two revenue sentences already picked and beats the "other"
      // sentence (without the exemption it would drop to 3).
      kind: "picks",
      units: [
        "Revenue rose 8% to $12.4 billion compared with $11.5 billion.",
        "Data centre revenue rose 9% to $4.1 billion.",
        row("Revenue | US$215.9 billion (FY26)"),
        "The company paid $6.9 billion to buy Mellanox.",
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 2],
    },
    {
      // The exemption is for named topics only: an "other" row (Total assets) is penalised
      // like any other unit once "other" is covered, so a prose "other" sentence wins the tie.
      kind: "picks",
      units: [
        "Revenue rose 8% to $12.4 billion compared with $11.5 billion.",
        "The company paid $6.9 billion to buy Mellanox.",
        row("Total assets | US$206.8 billion (FY26)"),
        "It spent $2.1 billion to expand its campus.",
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 3],
    },
    {
      // Escalation: the 3rd revenue unit loses 4, so the operating income row gets the slot.
      kind: "picks",
      units: [
        "Revenue rose 8% to $12.4 billion compared with $11.5 billion.",
        "Data centre revenue rose 9% to $4.1 billion.",
        "Gaming revenue rose 7% to $2.2 billion.",
        row("Operating income | $3.0B | $2.6B | +15%", ["Q3 2026", "Q3 2025", "Change"]),
      ],
      totalWords: 300, // 3 targets
      expect: [0, 1, 3],
    },
    {
      // Nothing above the threshold: no targets at all.    {
      // Nothing above the threshold: no targets at all.
      kind: "picks",
      units: ["The company has 4,000 employees.", "It was founded in 1998.", "© 2025 Lilypad Holdings."],
      totalWords: 600,
      expect: [],
    },

    // ---- Topics: profit split ----
    { kind: "topic", text: "Gross profit | $209.9 | $176.2 | +19.1%", topic: "gross profit" },
    { kind: "topic", text: "Operating income rose 26.7% to $84.0 million.", topic: "operating income" },
    { kind: "topic", text: "Net income for Q3 2026 was $61.3 million.", topic: "net income" },
    { kind: "topic", text: "Diluted earnings per share were $1.27.", topic: "EPS/per share" },

    // ---- Topics: guidance is the company's own forward-looking statements ----
    { kind: "topic", text: "For the fourth quarter of 2026, Lilypad expects revenue between $505 million and $525 million.", topic: "guidance/outlook/forecast" },
    { kind: "topic", text: "The company is raising its full-year 2026 revenue guidance to $1.86 billion.", topic: "guidance/outlook/forecast" },
    { kind: "topic", text: "The outlook for Q4 calls for revenue of $9 billion.", topic: "guidance/outlook/forecast" },
    { kind: "topic", text: "Margins should improve next quarter to about 45%.", topic: "guidance/outlook/forecast" },
    // Passive: only with a company metric.
    { kind: "topic", text: "Revenue is expected to be $54.0 billion, plus or minus 2%.", topic: "guidance/outlook/forecast" },
    { kind: "topic", text: "US third-quarter economic growth is expected to be robust, with GDP growth at 3.1%.", topic: "growth/estimates" },
    // Analyst and consensus language is growth/estimates, never guidance.
    { kind: "topic", text: "Apple reports on Thursday, with analysts expecting revenue of about $102 billion.", topic: "growth/estimates" },
    { kind: "topic", text: "Analysts expected revenue of $10 billion.", topic: "growth/estimates" },
    { kind: "topic", text: "Nvidia's second-quarter revenue forecast fell short of market estimates.", topic: "growth/estimates" },
    // No forward-looking cue: the normal topic order applies.
    { kind: "topic", text: "Revenue came in above expectations at $5.2 billion.", topic: "revenue/sales" },

    // ---- Recency (page's newest year 2025) ----
    {
      kind: "beats",
      a: { text: "In 2025, Apple raised its dividend to $1.04 per share.", context: { pageNewestYear: 2025 } },
      b: { text: "In 2018, Apple raised its dividend to $1.04 per share.", context: { pageNewestYear: 2025 } },
    },
    {
      kind: "beats",
      a: { text: "In 2018, Apple raised its dividend to $1.04 per share.", context: { pageNewestYear: 2025 } },
      b: { text: "In 2012, Apple raised its dividend to $1.04 per share.", context: { pageNewestYear: 2025 } },
    },
    {
      kind: "fails",
      unit: { text: "On March 19, 2012, Apple announced plans for a $2.65-per-share dividend.", context: { pageNewestYear: 2025 } },
    },
    {
      // No explicit year: no penalty.
      kind: "same",
      a: { text: "In 2025, revenue rose 8% to $12.4 billion.", context: { pageNewestYear: 2025 } },
      b: { text: "Revenue rose 8% to $12.4 billion.", context: { pageNewestYear: 2025 } },
    },
    {
      // A current period ("third-quarter") means no penalty, even with an old year in the sentence.
      kind: "same",
      a: { text: "Third-quarter revenue rose 8% to $12.4 billion, compared with $9 billion in 2012.", context: { pageNewestYear: 2025 } },
      b: { text: "Third-quarter revenue rose 8% to $12.4 billion, compared with $9 billion previously.", context: { pageNewestYear: 2025 } },
    },
    {
      // Without a page year (e.g. a page with no dates) nothing is penalised.
      kind: "same",
      a: { text: "In 2012, Apple raised its dividend to $1.04 per share." },
      b: { text: "Apple raised its dividend to $1.04 per share." },
    },

    // ---- Page reference year: capped at the current year, inflation notes ignored ----
    { kind: "pageYear", texts: ["In 2024 revenue rose 8%.", "In 2025 revenue rose 9%."], currentYear: 2026, expect: 2025 },
    { kind: "pageYear", texts: ["In 2025 revenue rose 9%.", "Revenue could reach $1 trillion by 2031."], currentYear: 2026, expect: 2026 },
    { kind: "pageYear", texts: ["It was introduced at a price of $666.66 (equivalent to $3,770 in 2025).", "Founded in 1976."], currentYear: 2026, expect: 1976 },
    { kind: "pageYear", texts: ["Apple reported revenue of $416 billion.", "© 2026 Apple Inc."], currentYear: 2026, expect: null },
    {
      // An inflation note doesn't make an old figure look current: the 1976 price is still old.
      kind: "beats",
      a: { text: "In 2025, the price rose to $3,770.", context: { pageNewestYear: 2025 } },
      b: { text: "In 1976, it was introduced at a price of $666.66 (equivalent to $3,770 in 2025).", context: { pageNewestYear: 2025 } },
    },

    // ---- Junk masking: words inside junk never count as context signals ----
    {
      // The inflation note's "to" isn't a change word, so the note adds nothing.
      kind: "same",
      a: "It was introduced at a price of $666.66 (equivalent to $3,770 in 2025).",
      b: "It was introduced at a price of $666.66.",
    },
    { kind: "fails", unit: "Together they raised $1,300 (equivalent to about $7,400 in 2025)." },
    {
      // Finance terms and comparisons inside junk don't count either (the URL here).
      kind: "same",
      a: "Shares rose 3% to $41.20, see www.example.com/revenue-vs-2025-guidance for details.",
      b: "Shares rose 3% to $41.20, see the website for details.",
    },

    // ---- What gets highlighted (step 9) ----
    { kind: "figures", text: "Revenue rose 12% to $12.4B in Q3 2026, the company said.", expect: [["12%", []], ["$12.4B", ["Q3 2026"]]] },
    { kind: "figures", text: "Revenue was US$215.9 billion in fiscal 2026, up 114% on the year before.", expect: [["US$215.9 billion", ["fiscal 2026"]], ["114%", []]] },
    // Comparison markers aren't dates; a period across a clause break isn't attached.
    { kind: "figures", text: "Revenue rose to $482.6 million, up 14.2% year over year.", expect: [["$482.6 million", []], ["14.2%", []]] },
    { kind: "figures", text: "For the fourth quarter of 2026, Lilypad expects revenue of $505 million.", expect: [["$505 million", []]] },
    // Junk and plain counts are never highlighted.
    { kind: "figures", text: "Call (555) 014-7781 about the $2 million fund for 30 schools.", expect: [["$2 million", []]] },
    { kind: "figures", text: "Revenue | $482.6 | $422.6 | +14.2%", row: true, expect: [["$482.6", []], ["$422.6", []], ["+14.2%", []]] },
  ];

  if (typeof window !== "undefined") window.FrogbotScoreCases = cases;
  if (typeof module !== "undefined" && module.exports) module.exports = cases;
})();
