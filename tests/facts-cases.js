// Fact-record test cases for content/facts.js (buildFacts), run by tests/run-tests.html and
// tools/run_tests.py as the "Facts" section.
//
// A case gives one or more units and the facts expected from them, in order. Every fact
// produced must be expected; only the fields listed are checked.
//   unit:   a sentence string, { text, heading } (sentence under a heading), or
//           { row: [cells], headers: [column headers], title, scale } (a table row)
//   context: { pagePeriod: { text, value } } stands in for the page's dominant period
//   expect: [{ label, display, role, period (text or null), periodSource, confidence,
//              qualifiers, change (display of the linked change), linked (true), sources (count),
//              sentenceStarts (start of the kept record's sentence) }]
(() => {
  const Q3 = { pagePeriod: { text: "Q3 2026", value: 2026 } };
  const cases = [
    // ---- Several figures in one sentence each get their own label ----
    {
      units: ["Revenue rose to $12.4B while net income fell to $2.1B in Q3 2026."],
      expect: [
        { label: "Revenue", display: "$12.4B", role: "level", period: "Q3 2026", periodSource: "sentence", confidence: "medium" },
        { label: "Net income", display: "$2.1B", role: "level", period: "Q3 2026", periodSource: "clause", confidence: "high" },
      ],
    },
    {
      units: ["Gross profit was $209.9 million and operating income was $84.0 million in Q3 2026."],
      expect: [
        { label: "Gross profit", display: "$209.9M", period: "Q3 2026", periodSource: "clause" },
        { label: "Operating income", display: "$84M", period: "Q3 2026", periodSource: "clause", confidence: "high" },
      ],
    },
    {
      units: ["Net income for Q3 2026 was $61.3 million, compared with $47.9 million in Q3 2025."],
      expect: [
        { label: "Net income", display: "$61.3M", period: "Q3 2026", periodSource: "clause", confidence: "high" },
        { label: "Net income", display: "$47.9M", period: "Q3 2025", periodSource: "clause", confidence: "high" },
      ],
    },
    {
      units: ["Free cash flow of $55.8 million; cash and equivalents of $310.2 million at quarter end."],
      context: Q3,
      expect: [
        { label: "Free cash flow", display: "$55.8M", period: "Q3 2026", periodSource: "page", confidence: "low" },
        { label: "Cash", display: "$310.2M", period: "Q3 2026", periodSource: "page", confidence: "low" },
      ],
    },
    {
      units: ["Operating income of $84.0 million, an operating margin of 17.4%."],
      expect: [
        { label: "Operating income", display: "$84M", role: "level" },
        { label: "Operating margin", display: "17.4%", role: "level" },
      ],
    },

    // ---- Qualifiers and segments ----
    {
      units: ["For the quarter, GAAP and non-GAAP gross margins were 72.4% and 72.7%, respectively."],
      expect: [
        { label: "GAAP gross margin", display: "72.4%", qualifiers: ["GAAP"] },
        { label: "Non-GAAP gross margin", display: "72.7%", qualifiers: ["non-GAAP"] },
      ],
    },
    {
      units: ["Second-quarter Gaming revenue was $4.3 billion, up 14% from the previous quarter."],
      expect: [
        { label: "Gaming revenue", display: "$4.3B", role: "level", qualifiers: ["Gaming"], change: "14%" },
        { label: "Gaming revenue", display: "14%", role: "change", linked: true },
      ],
    },
    {
      units: ["NVIDIA’s Blackwell Data Center revenue grew 17% sequentially."],
      expect: [{ label: "Blackwell Data Center revenue", display: "17%", role: "change", period: null }],
    },
    {
      units: [{ text: "Second-quarter revenue was $601 million, up 18% from the previous quarter.", heading: "Professional Visualization" }],
      expect: [
        { label: "Professional Visualization revenue", display: "$601M", change: "18%" },
        { label: "Professional Visualization revenue", display: "18%", role: "change", linked: true },
      ],
    },
    {
      // A section heading isn't a segment name.
      units: [{ text: "Revenue was $5.1 billion.", heading: "Highlights" }],
      expect: [{ label: "Revenue", display: "$5.1B", qualifiers: [] }],
    },
    { units: ["Adjusted EPS was $2.15."], expect: [{ label: "Adjusted EPS", display: "$2.15", qualifiers: ["adjusted"] }] },
    { units: ["Diluted earnings per share were $1.27."], expect: [{ label: "Diluted EPS", display: "$1.27", qualifiers: ["diluted"] }] },
    {
      units: ["The Outdoor Living segment generated revenue of $331.4 million, up 11.8%, while the newer Garden Water segment grew 19.7% to $151.2 million."],
      expect: [
        { label: "Outdoor Living revenue", display: "$331.4M", role: "level", change: "11.8%" },
        { label: "Outdoor Living revenue", display: "11.8%", role: "change", linked: true },
        { label: "Garden Water revenue", display: "19.7%", role: "change", linked: true },
        { label: "Garden Water revenue", display: "$151.2M", role: "level", change: "19.7%", confidence: "medium" },
      ],
    },

    // ---- GAAP vs non-GAAP tables ----
    {
      units: [{ row: ["Net income", "$26,422", "$18,775"], headers: [null, "Q2 FY26", "Q1 FY26"], title: "GAAP", scale: "million" }],
      expect: [
        { label: "GAAP net income", display: "$26.4B", period: "Q2 FY26", periodSource: "table", confidence: "medium" },
        { label: "GAAP net income", display: "$18.8B", period: "Q1 FY26", periodSource: "table" },
      ],
    },
    {
      // Same value in the GAAP and non-GAAP tables: never merged.
      units: [
        { row: ["Revenue", "$46,743"], headers: [null, "Q2 FY26"], title: "GAAP", scale: "million" },
        { row: ["Revenue", "$46,743"], headers: [null, "Q2 FY26"], title: "Non-GAAP", scale: "million" },
      ],
      expect: [
        { label: "GAAP revenue", display: "$46.7B", qualifiers: ["GAAP"], sources: 1 },
        { label: "Non-GAAP revenue", display: "$46.7B", qualifiers: ["non-GAAP"], sources: 1 },
      ],
    },
    {
      units: [{ row: ["EBITDA", "$1,234"], headers: [null, "FY2025"], title: "Adjusted", scale: "million" }],
      expect: [{ label: "Adjusted EBITDA", display: "$1.2B", period: "FY2025", qualifiers: ["adjusted"] }],
    },
    {
      // "except per share": per-share rows aren't scaled by "in millions".
      units: [{ row: ["Diluted earnings per share", "$1.08", "$0.76"], headers: [null, "Q2 FY26", "Q1 FY26"], title: "GAAP", scale: "million" }],
      expect: [
        { label: "GAAP diluted EPS", display: "$1.08", period: "Q2 FY26" },
        { label: "GAAP diluted EPS", display: "$0.76", period: "Q1 FY26" },
      ],
    },

    // ---- Ranges ----
    {
      units: ["Revenue is expected to be between $1.86 billion and $1.88 billion."],
      expect: [{ label: "Guidance: Revenue", display: "$1.86B–$1.88B", role: "guidance" }],
    },
    {
      units: ["The company expects gross margin of 42% to 44% for the fourth quarter."],
      expect: [{ label: "Guidance: Gross margin", display: "42%–44%", role: "guidance", period: "fourth quarter", periodSource: "clause" }],
    },

    // ---- Guidance ----
    {
      units: ["For the fourth quarter of 2026, Lilypad expects revenue between $505 million and $525 million and diluted EPS between $1.30 and $1.38."],
      expect: [
        { label: "Guidance: Revenue", display: "$505M–$525M", role: "guidance", period: "fourth quarter of 2026", periodSource: "clause", labelConfidence: "medium", periodConfidence: "high", confidence: "medium", showOnCard: true },
        { label: "Guidance: Diluted EPS", display: "$1.30–$1.38", role: "guidance", period: "fourth quarter of 2026" },
      ],
    },
    {
      units: ["Revenue is expected to be $54.0 billion, plus or minus 2%."],
      expect: [
        { label: "Guidance: Revenue", display: "$54B", role: "guidance" },
        { label: "Guidance: Revenue", display: "2%", role: "guidance" },
      ],
    },
    {
      units: ["The company is raising its full-year 2026 revenue guidance to $1.86 billion."],
      expect: [{ label: "Guidance: Revenue", display: "$1.9B", role: "guidance", period: "full-year 2026", periodSource: "clause" }],
    },
    {
      // Guidance never takes the page's (backward-looking) period.
      units: ["The company expects revenue of about $9 billion."],
      context: Q3,
      expect: [{ label: "Guidance: Revenue", display: "$9B", period: null }],
    },

    // ---- Estimates ----
    {
      units: ["Diluted EPS was $3.05, beating the $2.98 consensus."],
      expect: [
        { label: "Diluted EPS", display: "$3.05", role: "level" },
        { label: "Diluted EPS", display: "$2.98", role: "estimate" },
      ],
    },
    { units: ["Analysts expected revenue of $10.2 billion."], expect: [{ label: "Revenue", display: "$10.2B", role: "estimate" }] },
    {
      units: ["EPS of $1.42 beat the consensus estimate of $1.35."],
      expect: [
        { label: "EPS", display: "$1.42", role: "level" },
        { label: "EPS", display: "$1.35", role: "estimate" },
      ],
    },

    // ---- Changes linked to levels ----
    {
      units: ["Revenue rose 14.2% to $482.6 million."],
      expect: [
        { label: "Revenue", display: "14.2%", role: "change", linked: true },
        { label: "Revenue", display: "$482.6M", role: "level", change: "14.2%" },
      ],
    },
    {
      units: ["Gross margin expanded 180 basis points to 43.5%."],
      expect: [
        { label: "Gross margin", display: "180 bps", role: "change", linked: true },
        { label: "Gross margin", display: "43.5%", role: "level", change: "180 bps" },
      ],
    },
    {
      units: ["Operating expenses increased by $3 million to $45 million."],
      expect: [
        { label: "Operating expenses", display: "$3M", role: "change", linked: true },
        { label: "Operating expenses", display: "$45M", role: "level", change: "$3M" },
      ],
    },
    {
      units: ["The dividend was raised 4% to $0.26 per share."],
      expect: [
        { label: "Dividend", display: "4%", role: "change", linked: true },
        { label: "Dividend", display: "$0.26", role: "level", change: "4%" },
      ],
    },
    {
      units: [{ row: ["Revenue", "$482.6", "$422.6", "+14.2%"], headers: [null, "Q3 2026", "Q3 2025", "Change"], scale: "million" }],
      expect: [
        { label: "Revenue", display: "$482.6M", period: "Q3 2026", periodSource: "table", change: "+14.2%" },
        { label: "Revenue", display: "$422.6M", period: "Q3 2025" },
        { label: "Revenue", display: "+14.2%", role: "change", linked: true, period: null },
      ],
    },
    {
      // A change about a different metric isn't linked.
      units: ["Revenue was $5 billion and operating income rose 12%."],
      expect: [
        { label: "Revenue", display: "$5B", role: "level" },
        { label: "Operating income", display: "12%", role: "change" },
      ],
    },

    // ---- Period sources ----
    {
      units: ["In Q3 2026, revenue was $5 billion, and net income was $1 billion."],
      expect: [
        { label: "Revenue", display: "$5B", period: "Q3 2026", periodSource: "clause", confidence: "high" },
        { label: "Net income", display: "$1B", period: "Q3 2026", periodSource: "sentence", confidence: "medium" },
      ],
    },
    { units: ["Revenue rose to $482.6 million."], context: Q3, expect: [{ label: "Revenue", period: "Q3 2026", periodSource: "page", confidence: "low" }] },
    { units: ["Revenue was $5 billion."], expect: [{ label: "Revenue", period: null, periodSource: null, periodConfidence: null, labelConfidence: "high", confidence: "high", periodInferred: false }] },
    {
      // A period in the figure's own cell beats the column header.
      units: [{ row: ["Revenue", "US$215.9 billion (FY26)"], headers: [] }],
      expect: [{ label: "Revenue", display: "$215.9B", period: "FY26", periodSource: "clause", confidence: "high" }],
    },
    {
      // A real period is preferred over a date in the same clause.
      units: ["NVIDIA reported revenue for the second quarter ended July 27, 2025, of $46.7 billion."],
      expect: [{ label: "Revenue", display: "$46.7B", period: "second quarter", periodSource: "clause" }],
    },

    // ---- Fallback labels are low confidence ----
    { units: ["The figure came in at $5 billion."], expect: [{ display: "$5B", confidence: "low" }] },
    { units: ["The stock trades at 25 times forward earnings."], expect: [{ display: "25x", role: "level", confidence: "low" }] },

    // ---- Junk is never a fact ----
    { units: ["Call (555) 014-7781 about the $2 million fund."], expect: [{ display: "$2M" }] },
    { units: ["© 2025 Apple Inc. All rights reserved."], expect: [] },
    { units: ["The company has 4,000 employees in 12 countries."], expect: [] },

    // ---- Fixes found on real pages ----
    {
      // "35% quarter-over-quarter" is a change, and both changes link to the level.
      units: ["GAAP net income rose 94% year-over-year and 35% quarter-over-quarter to approximately $43 billion."],
      expect: [
        { label: "GAAP net income", display: "94%", role: "change", linked: true },
        { label: "GAAP net income", display: "35%", role: "change", linked: true },
        { label: "GAAP net income", display: "$43B", role: "level", change: "94%" },
      ],
    },
    {
      // "above consensus estimates" describes the 83%, it doesn't make the 24% an estimate.
      units: ["According to FactSet, 83% of S&P 500 companies are reporting earnings above consensus estimates, with 24% having released results."],
      expect: [{ display: "83%", role: "level" }, { display: "24%", role: "level" }],
    },
    {
      units: ["The blended growth rate for the quarter is 29.5% year-over-year, slightly above the 29.2% expectation."],
      expect: [{ display: "29.5%", role: "change" }, { display: "29.2%", role: "estimate" }],
    },
    {
      // A section heading in sentence case isn't a segment name.
      units: [{ text: "Its revenue rose 2% to $83 billion.", heading: "Criticism and controversies" }],
      expect: [
        { label: "Revenue", display: "2%", role: "change", qualifiers: [] },
        { label: "Revenue", display: "$83B", role: "level", qualifiers: [] },
      ],
    },
    {
      units: ["Annual sales increased from $775,000 to $118 million, a growth rate of 533%."],
      expect: [
        { label: "Revenue", display: "$775,000", role: "level" },
        { label: "Revenue", display: "$118M", role: "level" },
        { label: "Revenue", display: "533%", role: "change", linked: true },
      ],
    },

    {
      units: ["Revenue was lower than in 2021, where the increase was at 36%."],
      expect: [{ label: "Revenue", display: "36%", role: "change" }],
    },

    // ---- List-intro and heading periods ----
    {
      // Nvidia's outlook bullets: the period is in the line that introduces the list.
      units: [{ text: "Revenue is expected to be $54.0 billion, plus or minus 2%.", listIntro: "NVIDIA's outlook for the third quarter of fiscal 2026 is as follows:" }],
      expect: [
        { label: "Guidance: Revenue", display: "$54B", role: "guidance", period: "third quarter of fiscal 2026", periodSource: "listIntro", periodConfidence: "medium", showOnCard: true },
        { display: "2%", role: "guidance", periodSource: "listIntro" },
      ],
    },
    {
      // The list intro comes before the heading.
      units: [{ text: "Gross margin of 72.5%.", listIntro: "For the fourth quarter of 2026:", heading: "Q3 2026 Results" }],
      expect: [{ label: "Gross margin", display: "72.5%", period: "fourth quarter of 2026", periodSource: "listIntro" }],
    },
    {
      units: [{ text: "Revenue was $41.1 billion, up 5% from the previous quarter.", heading: "Fiscal 2026 Highlights" }],
      expect: [
        { label: "Revenue", display: "$41.1B", period: "Fiscal 2026", periodSource: "heading", periodConfidence: "medium", qualifiers: [] },
        { label: "Revenue", display: "5%", role: "change", periodSource: "heading" },
      ],
    },
    {
      // A release's title is a heading until the first real heading.
      units: [{ text: "Revenue rose to $482.6 million, up 14.2% year over year.", pageTitle: "Lilypad Holdings Reports Third Quarter 2026 Results" }],
      context: { pagePeriod: { text: "Q3 2026", value: null } },
      expect: [
        { label: "Revenue", display: "$482.6M", period: "Third Quarter 2026", periodSource: "heading", periodInferred: false, showOnCard: true, qualifiers: [] },
        { display: "14.2%", role: "change", linked: true, showOnCard: false },
      ],
    },
    {
      // A heading period applies to table rows with no period in their column headers.
      units: [{ row: ["Revenue", "$1,204"], headers: ["", "Amount"], heading: "Fiscal 2025 Results" }],
      expect: [{ label: "Revenue", period: "Fiscal 2025", periodSource: "heading", labelConfidence: "high", periodConfidence: "medium" }],
    },
    {
      // Guidance never takes the page's period; a level in the same run does.
      units: ["Revenue is expected to be about $54 billion.", "Net income was $26.4 billion."],
      context: { pagePeriod: { text: "Q2 FY26", value: null } },
      expect: [
        { label: "Guidance: Revenue", role: "guidance", period: null, periodSource: null, periodInferred: false, showOnCard: true },
        { label: "Net income", period: "Q2 FY26", periodSource: "page", periodConfidence: "low", periodInferred: true, confidence: "low", labelConfidence: "high", showOnCard: true },
      ],
    },

    {
      // Change columns in a table don't take the heading's period.
      units: [{ row: ["Net income", "$61.3", "+28.0%"], headers: ["", "Amount", "Change"], heading: "Fiscal 2025 Results" }],
      expect: [
        { label: "Net income", period: "Fiscal 2025", periodSource: "heading" },
        { role: "change", period: null, periodSource: null },
      ],
    },
    {
      units: ["Meta Platforms META earnings came in at $9.9 billion."],
      expect: [{ label: "Meta Platforms earnings", display: "$9.9B" }],
    },

    // ---- Split confidence ----
    {
      // Qualifiers make the label medium; a period elsewhere in the sentence is medium.
      units: ["In the third quarter, GAAP net income was $26.4 billion; operating income was $2 billion."],
      expect: [
        { label: "GAAP net income", labelConfidence: "medium", periodSource: "clause", periodConfidence: "high", confidence: "medium" },
        { label: "Operating income", labelConfidence: "high", periodSource: "sentence", periodConfidence: "medium", confidence: "medium" },
      ],
    },
    {
      units: [{ text: "Second-quarter revenue was $41.1 billion.", heading: "Data Center" }],
      expect: [{ label: "Data Center revenue", labelConfidence: "medium", periodConfidence: "high", showOnCard: true }],
    },
    {
      // A term borrowed from an earlier clause is medium.
      units: ["Revenue was flat in the quarter, while it reached $5 billion for the year."],
      expect: [{ label: "Revenue", display: "$5B", labelConfidence: "medium" }],
    },

    // ---- Card eligibility ----
    {
      // A snippet label stays off the card even with a good period.
      units: ["In 2020, Nvidia agreed to buy Arm from SoftBank Group for $40 billion."],
      expect: [{ display: "$40B", labelConfidence: "low", periodConfidence: "high", confidence: "low", showOnCard: false }],
    },
    {
      // A change with no level to link to gets its own row.
      units: ["Operating income rose 12% in the third quarter."],
      expect: [{ label: "Operating income", role: "change", linked: false, showOnCard: true }],
    },
    {
      // Estimates aren't card rows.
      units: ["Analysts expected revenue of $10.2 billion."],
      expect: [{ display: "$10.2B", role: "estimate", showOnCard: false }],
    },
    {
      // Linked changes sit with their level, in tables too.
      units: [{ row: ["Net income", "$61.3", "$47.9", "+28.0%"], headers: ["", "Q3 2026", "Q3 2025", "Change"], scale: "million" }],
      expect: [
        { label: "Net income", display: "$61.3M", showOnCard: true },
        { label: "Net income", display: "$47.9M", showOnCard: true },
        { label: "Net income", display: "+28%", role: "change", linked: true, showOnCard: false },
      ],
    },

    // ---- Merging ----
    {
      // The same revenue in a sentence and the table: one fact, two sources; the table's
      // period (medium) beats the sentence's page-default period (low).
      units: ["Revenue rose to $482.6 million.", { row: ["Revenue", "$482.6"], headers: [null, "Q3 2026"], scale: "million" }],
      context: Q3,
      expect: [{ label: "Revenue", display: "$482.6M", sources: 2, confidence: "medium", periodSource: "table" }],
    },
    {
      // Different periods: not the same fact.
      units: [{ row: ["Revenue", "$482.6"], headers: [null, "Q3 2026"], scale: "million" }, "Revenue was $482.6 million in Q3 2025."],
      expect: [
        { label: "Revenue", period: "Q3 2026", sources: 1 },
        { label: "Revenue", period: "Q3 2025", sources: 1 },
      ],
    },
    {
      // Equal confidence: the prose record is kept, with both sources.
      units: ["In Q2 FY26, the company reported strong results, and revenue was $46.7 billion.", { row: ["Revenue", "$46,743"], headers: [null, "Q2 FY26"], scale: "million" }],
      expect: [{ label: "Revenue", display: "$46.7B", sources: 2, confidence: "medium", sentenceStarts: "In Q2 FY26" }],
    },
  ];

  if (typeof window !== "undefined") window.FrogbotFactsCases = cases;
  if (typeof module !== "undefined" && module.exports) module.exports = cases;
})();
