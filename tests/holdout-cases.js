// Held-out test cases for content/score.js. Same format as tests/detect-cases.js.
//
// Written by hand from pages not used in development - do not tune code against these.
//
// The point of this set is an honest accuracy number: development cases are the ones the
// code was built and fixed against, so they will always look good. These come from fresh
// pages and are only ever run, never used as a reason to change score.js. If a held-out
// case fails, note it, then write a NEW development case for the problem and fix against
// that; leave the held-out case as it is.
//
// The three entries below are examples of the format, marked `example: true` so the runner
// skips them. Delete them (or leave them) once real cases are added.
(() => {
  const detect = [
    {
      example: true,
      source: "example (replace with a real page and its URL)",
      text: "Quarterly revenue rose 12% to $8.4 billion, while diluted EPS came in at $0.97.",
      expected: [
        { raw: "12%", type: "percent", value: 12 },
        { raw: "$8.4 billion", type: "money", value: 8400000000 },
        { raw: "$0.97", type: "perShare", value: 0.97 },
      ],
    },
    {
      example: true,
      source: "example (replace with a real page and its URL)",
      text: "The board approved a $5 billion buyback for fiscal 2027.",
      expected: [
        { raw: "$5 billion", type: "money", value: 5000000000 },
        { raw: "fiscal 2027", type: "period", value: 2027 },
      ],
    },
    {
      example: true,
      source: "example (replace with a real page and its URL)",
      text: "For media enquiries call +1 (212) 555-0147.",
      expected: [{ raw: "+1 (212) 555-0147", junk: true, junkReason: "phone" }],
    },
  ];

  const split = [];

  const cases = { detect, split };
  if (typeof window !== "undefined") window.FrogbotHoldoutCases = cases;
  if (typeof module !== "undefined" && module.exports) module.exports = cases;
})();
