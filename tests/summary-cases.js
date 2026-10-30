// Summary cases: the rules summary, and the number checker run on fake "AI" summaries.
//
// Each case builds fact records from `units` (sentences and table rows, as in facts-cases.js).
// Rules cases list the sentences rulesSummary() should write (an empty list means no summary).
// Checker cases give a fake summary and what checkSummary() should do with it, sentence by
// sentence: `keep` (true to keep, false to drop), `rejected`, and optionally `links` (a figure
// as written -> the label of the fact it should link to). The source sentences given to the
// checker are the units' text unless a case lists `sources`.
(() => {
  // A small earnings release: a headline sentence, three table rows and the outlook.
  const LILYPAD = [
    "Revenue rose to $482.6 million, up 14.2% year over year, in Q3 2026.",
    { row: ["Gross profit", "$209.9", "$176.2", "+19.1%"], headers: ["", "Q3 2026", "Q3 2025", "Change"], scale: "million" },
    { row: ["Operating income", "$84.0", "$66.3", "+26.7%"], headers: ["", "Q3 2026", "Q3 2025", "Change"], scale: "million" },
    { row: ["Net income", "$61.3", "$47.9", "+28.0%"], headers: ["", "Q3 2026", "Q3 2025", "Change"], scale: "million" },
    "For the fourth quarter of 2026, Lilypad expects revenue between $505 million and $525 million and diluted EPS between $1.30 and $1.38.",
  ];
  const BUYBACK = "Lilypad repurchased 1.1 million shares for $48.5 million during the quarter.";
  // GAAP and non-GAAP tables, segment revenue and an outlook list, as in Nvidia's releases.
  const NVIDIA = [
    "NVIDIA today reported revenue for the second quarter of $46.7 billion, up 56% from a year ago.",
    { row: ["Operating income", "$28,440", "$18,642", "53%"], headers: ["", "Q2 FY26", "Q2 FY25", "Y/Y"], title: "GAAP", scale: "million" },
    { row: ["Operating income", "$30,165", "$19,937", "51%"], headers: ["", "Q2 FY26", "Q2 FY25", "Y/Y"], title: "Non-GAAP", scale: "million" },
    { text: "Revenue is expected to be $54.0 billion, plus or minus 2%.", listIntro: "NVIDIA's outlook for the third quarter of fiscal 2026 is as follows:" },
  ];
  const SEGMENT = [
    "NVIDIA today reported revenue for the second quarter of $46.7 billion, up 56% from a year ago.",
    { text: "Second-quarter revenue was $41.1 billion, up 5% from the previous quarter.", heading: "Data Center" },
  ];
  const NEGATIVES = { negativesShown: true };

  const rules = [
    {
      name: "the sample release: headline, a row, a pair, and the outlook",
      units: LILYPAD,
      expect: [
        "Revenue rose 14.2% to $482.6M in Q3 2026.",
        "Gross profit rose 19.1% to $209.9M in Q3 2026.",
        "Operating income rose 26.7% to $84.0M and net income rose 28% to $61.3M in Q3 2026.",
        "For the fourth quarter of 2026, the company guided revenue of $505M–$525M and diluted EPS of $1.30–$1.38.",
      ],
    },
    { name: "a level with no direction", units: ["Gross profit was $209.9 million in Q3 2026."], expect: ["Gross profit was $209.9M in Q3 2026."] },
    { name: "a fall, with no period", units: ["Net income fell 3% to $61.3 million."], expect: ["Net income fell 3% to $61.3M."] },
    { name: "a rise with no change figure", units: ["Revenue climbed to $5.2 billion in Q3 2026."], expect: ["Revenue rose to $5.2B in Q3 2026."] },
    { name: "unchanged", units: ["Gross margin was unchanged at 42% in Q3 2026."], expect: ["Gross margin was unchanged at 42% in Q3 2026."] },
    { name: "plural metrics take 'were'", units: ["Operating expenses were $45.0 million in Q3 2026."], expect: ["Operating expenses were $45.0M in Q3 2026."] },
    { name: "guidance with no period, and its tolerance", units: ["Revenue is expected to be $54.0 billion, plus or minus 2%."], expect: ["Revenue guidance is $54.0B ±2%."] },
    {
      name: "GAAP and non-GAAP stay distinct, then guidance from the list intro",
      units: NVIDIA,
      context: NEGATIVES,
      expect: [
        "Revenue rose 56% to $46.7B in the second quarter.",
        "GAAP operating income rose 53% to $28.4B and non-GAAP operating income rose 51% to $30.2B in Q2 FY26.",
        "For the third quarter of fiscal 2026, the company guided revenue of $54.0B ±2%.",
      ],
    },
    {
      name: "an inferred period isn't stated",
      units: ["The blended earnings growth rate is 29.5% year-over-year."],
      context: { pagePeriod: { text: "third-quarter", value: null } },
      expect: ["Earnings rose 29.5%."],
    },
    { name: "two standalone changes share a sentence", units: ["Revenue rose 26% in the quarter.", "Earnings rose 29.5% in the quarter."], expect: ["Revenue rose 26% and earnings rose 29.5%."] },
    { name: "a segment keeps its capitals", units: SEGMENT, expect: ["Revenue rose 56% to $46.7B in the second quarter.", "Data Center revenue rose 5% to $41.1B in the second quarter."] },
    {
      name: "a heading's period reads naturally",
      units: [{ text: "Revenue rose to $482.6 million, up 14.2% year over year.", pageTitle: "Lilypad Holdings Reports Third Quarter 2026 Results" }],
      expect: ["Revenue rose 14.2% to $482.6M in the third quarter of 2026."],
    },
    {
      name: "a span of years from a section heading isn't stated",
      units: [{ text: "Its gross margin was 55%.", heading: "1984–1991: Macintosh and new ventures" }],
      expect: ["Gross margin was 55%."],
    },
    { name: "no card facts, no summary", units: ["According to FactSet, 83% of S&P 500 companies have reported results."], expect: [] },
    {
      name: "at most four sentences, guidance kept",
      units: [
        "Revenue rose 10% to $5.0 billion in Q3 2026.",
        "Gross profit rose 9% to $2.0 billion in Q3 2026.",
        "Operating margin rose to 21% in Q3 2026.",
        "Free cash flow rose 5% to $900 million in Q3 2026.",
        "Cash rose to $3.0 billion in Q3 2026.",
        "For the fourth quarter of 2026, the company expects revenue of $5.2 billion.",
      ],
      expect: [
        "Revenue rose 10% to $5.0B in Q3 2026.",
        "Gross profit rose 9% to $2.0B in Q3 2026.",
        "Operating margin rose to 21% in Q3 2026.",
        "For the fourth quarter of 2026, the company guided revenue of $5.2B.",
      ],
    },
  ];

  const checker = [
    // ---- Correct summaries are kept ----
    {
      name: "the rules summary itself",
      units: LILYPAD,
      summary:
        "Revenue rose 14.2% to $482.6M in Q3 2026. Gross profit rose 19.1% to $209.9M in Q3 2026. Operating income rose 26.7% to $84.0M and net income rose 28% to $61.3M in Q3 2026. For the fourth quarter of 2026, the company guided revenue of $505M–$525M and diluted EPS of $1.30–$1.38.",
      expect: { keep: [true, true, true, true], rejected: false, links: { "$482.6M": "Revenue", "14.2%": "Revenue", "$61.3M": "Net income", "$1.30–$1.38": "Guidance: Diluted EPS" } },
    },
    { name: '"million" for "M"', units: LILYPAD, summary: "Revenue rose 14.2% to $482.6 million in Q3 2026.", expect: { keep: [true], links: { "$482.6 million": "Revenue" } } },
    { name: '"percent" for "%"', units: LILYPAD, summary: "Revenue was up 14.2 percent year over year at $482.6M.", expect: { keep: [true], links: { "14.2 percent": "Revenue" } } },
    { name: "rounded within 0.5%", units: LILYPAD, summary: "Revenue rose to about $483M.", expect: { keep: [true], links: { "$483M": "Revenue" } } },
    { name: "a synonym verb", units: LILYPAD, summary: "Revenue jumped 14.2% to $482.6M.", expect: { keep: [true] } },
    { name: "the metric after the figure", units: LILYPAD, summary: "Lilypad booked $482.6M in sales this quarter.", expect: { keep: [true], links: { "$482.6M": "Revenue" } } },
    { name: '"Q3" written out', units: LILYPAD, summary: "In the third quarter of 2026, revenue rose 14.2% to $482.6M.", expect: { keep: [true] } },
    { name: "a guidance range", units: LILYPAD, summary: "Lilypad guided fourth-quarter revenue of $505M–$525M.", expect: { keep: [true], links: { "$505M–$525M": "Guidance: Revenue" } } },
    { name: "per-share figures exactly", units: LILYPAD, summary: "Diluted EPS guidance is $1.30–$1.38.", expect: { keep: [true] } },
    { name: "a figure from the sources that isn't a fact", units: LILYPAD, sources: [...LILYPAD.filter((u) => typeof u === "string"), BUYBACK], summary: "Lilypad spent $48.5M buying back shares.", expect: { keep: [true] } },
    { name: "a tolerance", units: NVIDIA, context: NEGATIVES, summary: "Revenue guidance is $54.0B ±2%.", expect: { keep: [true], links: { "$54.0B": "Guidance: Revenue", "±2%": "Guidance: Revenue" } } },
    { name: '"plus or minus" written out', units: NVIDIA, context: NEGATIVES, summary: "Revenue is expected to be $54.0 billion, plus or minus 2%.", expect: { keep: [true] } },
    {
      name: "GAAP and non-GAAP correctly attributed",
      units: NVIDIA,
      context: NEGATIVES,
      summary: "GAAP operating income rose 53% to $28.4B, while non-GAAP operating income rose 51% to $30.2B.",
      expect: { keep: [true], links: { "$28.4B": "GAAP operating income", "$30.2B": "Non-GAAP operating income" } },
    },
    { name: "a segment correctly attributed", units: SEGMENT, summary: "Data Center revenue rose 5% to $41.1B.", expect: { keep: [true], links: { "$41.1B": "Data Center revenue" } } },

    // ---- Every way to sneak in a wrong number: the sentence is dropped ----
    { name: "a made-up figure", units: LILYPAD, summary: "Revenue rose 14.2% to $482.6M. Free cash flow was $55.0M.", expect: { keep: [true, false], rejected: false } },
    { name: "rounded too far", units: LILYPAD, summary: "Revenue was about $480M.", expect: { keep: [false], rejected: true } },
    { name: "a made-up percentage", units: LILYPAD, summary: "Revenue rose 15% to $482.6M.", expect: { keep: [false], rejected: true } },
    { name: "a figure moved to the wrong metric", units: LILYPAD, summary: "Net income was $482.6M.", expect: { keep: [false], rejected: true } },
    { name: "two figures swapped between metrics", units: LILYPAD, summary: "Revenue rose 28% to $61.3M and net income rose 14.2% to $482.6M.", expect: { keep: [false] } },
    { name: "a source figure given to the wrong metric", units: LILYPAD, sources: [...LILYPAD.filter((u) => typeof u === "string"), BUYBACK], summary: "Net income was $48.5M.", expect: { keep: [false] } },
    { name: "the contradicting direction (change)", units: LILYPAD, summary: "Revenue fell 14.2% to $482.6M.", expect: { keep: [false] } },
    { name: "the contradicting direction (level)", units: LILYPAD, summary: "Gross profit fell to $209.9M.", expect: { keep: [false] } },
    { name: "the contradicting direction (down)", units: LILYPAD, summary: "Operating income was down 26.7%.", expect: { keep: [false] } },
    { name: "the wrong period", units: LILYPAD, summary: "Revenue rose 14.2% to $482.6M in Q4 2026.", expect: { keep: [false] } },
    { name: "the wrong year", units: LILYPAD, summary: "Revenue rose 14.2% to $482.6M in 2025.", expect: { keep: [false] } },
    { name: "a period that isn't on the page", units: LILYPAD, summary: "Revenue rose 14.2% to $482.6M in Q1 2027.", expect: { keep: [false] } },
    { name: "GAAP and non-GAAP swapped", units: NVIDIA, context: NEGATIVES, summary: "Non-GAAP operating income was $28.4B.", expect: { keep: [false] } },
    { name: "a segment's figure given to the company", units: SEGMENT, summary: "Revenue was $41.1B in the second quarter.", expect: { keep: [false] } },
    { name: "the company's figure given to a segment", units: SEGMENT, summary: "Data Center revenue was $46.7B.", expect: { keep: [false] } },
    { name: "the wrong tolerance", units: NVIDIA, context: NEGATIVES, summary: "Revenue guidance is $54.0B ±3%.", expect: { keep: [false] } },
    { name: "a per-share range one cent out", units: LILYPAD, summary: "Diluted EPS guidance is $1.30–$1.39.", expect: { keep: [false] } },
    { name: "a count that isn't on the page", units: LILYPAD, summary: "Lilypad opened 12 new stores in Q3 2026.", expect: { keep: [false] } },

    // ---- How much may be dropped ----
    {
      name: "half dropped is still a summary",
      units: LILYPAD,
      summary: "Revenue rose 14.2% to $482.6M. Net income rose 28% to $61.3M. Revenue fell to $482.6M. Cash was $90.0M.",
      expect: { keep: [true, true, false, false], rejected: false },
    },
    {
      name: "mostly wrong: rejected",
      units: LILYPAD,
      summary: "Revenue rose 14.2% to $482.6M. Revenue fell 3%. Net income was $482.6M.",
      expect: { keep: [true, false, false], rejected: true },
    },
    { name: "all wrong: rejected", units: LILYPAD, summary: "Revenue rose 9% to $500M. Profit doubled to $120M.", expect: { keep: [false, false], rejected: true } },
    { name: "no numbers at all", units: LILYPAD, summary: "Lilypad had a strong quarter.", expect: { keep: [true], rejected: false } },
  ];

  const cases = { rules, checker };
  if (typeof window !== "undefined") window.FrogbotSummaryCases = cases;
  if (typeof module !== "undefined" && module.exports) module.exports = cases;
})();
