// Runs one set of detection and sentence-splitting cases against FrogbotScore and returns
// plain results data. run-tests.html calls it once for the development set and once for
// the held-out set, renders both, and tools/run_tests.py reads the results from that page.
// A case may carry `options` (e.g. { inTable: true }), passed to detectNumbers.
(() => {
  const CHECKED_FIELDS = ["type", "value", "currency", "scale", "isNegative", "low", "high", "junk", "junkReason", "decade"];
  const REAL_SOURCE_TYPES = ["money", "percent", "perShare"];

  const sameValue = (a, b) =>
    typeof a === "number" && typeof b === "number"
      ? Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9)
      : a === b;

  const category = (m) => (m.junk ? `junk:${m.junkReason}` : m.type);

  function fieldProblems(expected, actual) {
    const problems = [];
    for (const field of CHECKED_FIELDS) {
      if (!(field in expected)) continue;
      if (!sameValue(actual[field], expected[field])) {
        problems.push(`${field}: expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(actual[field])}`);
      }
    }
    return problems;
  }

  function runDetectCase(score, testCase) {
    const actual = score.detectNumbers(testCase.text, testCase.options || {});
    const used = new Set();
    const problems = [];
    const outcomes = testCase.expected.map((exp) => {
      const index = actual.findIndex((a, i) => !used.has(i) && a.raw === exp.raw);
      if (index === -1) {
        problems.push(`missing "${exp.raw}" (${category(exp)})`);
        return { expected: exp, ok: false };
      }
      used.add(index);
      const fp = fieldProblems(exp, actual[index]);
      for (const p of fp) problems.push(`"${exp.raw}" ${p}`);
      return { expected: exp, actual: actual[index], ok: fp.length === 0 };
    });
    const extras = actual.filter((_, i) => !used.has(i));
    for (const extra of extras) problems.push(`unexpected "${extra.raw}" (${category(extra)})`);
    // Order matters too: matched items must come out in the expected order.
    const order = outcomes.filter((o) => o.actual).map((o) => o.actual.start);
    if (order.some((s, i) => i > 0 && s < order[i - 1])) problems.push("matches out of order");
    return { ...testCase, actual, outcomes, extras, problems, pass: problems.length === 0 };
  }

  function runSplitCase(score, testCase) {
    const actual = score.splitSentences(testCase.text).map((s) => s.text);
    const positionsOk = score
      .splitSentences(testCase.text)
      .every((s) => testCase.text.slice(s.start, s.end) === s.text);
    const pass =
      positionsOk &&
      actual.length === testCase.expected.length &&
      actual.every((s, i) => s === testCase.expected[i]);
    return { ...testCase, actual, pass, problems: positionsOk ? [] : ["start/end don't match text"] };
  }

  function runTests(score, cases) {
    const started = Date.now();
    // Entries marked `example: true` only illustrate the format and are never run.
    const detect = (cases.detect || []).filter((c) => !c.example).map((c) => runDetectCase(score, c));
    const split = (cases.split || []).map((c) => runSplitCase(score, c));

    // Per-type accuracy: expected matches found with every checked field right.
    const perType = {};
    const bump = (key, field) => {
      perType[key] = perType[key] || { expected: 0, correct: 0, falsePositives: 0 };
      perType[key][field] += 1;
    };
    const real = {};
    for (const result of detect) {
      for (const o of result.outcomes) {
        bump(category(o.expected), "expected");
        if (o.ok) bump(category(o.expected), "correct");
        if (result.source !== "synthetic" && REAL_SOURCE_TYPES.includes(o.expected.type) && !o.expected.junk) {
          real[o.expected.type] = real[o.expected.type] || { expected: 0, correct: 0 };
          real[o.expected.type].expected += 1;
          if (o.ok) real[o.expected.type].correct += 1;
        }
      }
      for (const extra of result.extras) bump(category(extra), "falsePositives");
    }

    const detectPassed = detect.filter((r) => r.pass).length;
    const splitPassed = split.filter((r) => r.pass).length;
    const total = detect.length + split.length;
    return {
      detect,
      split,
      perType,
      real,
      summary: {
        detectTotal: detect.length,
        detectPassed,
        splitTotal: split.length,
        splitPassed,
        total,
        passed: detectPassed + splitPassed,
        failed: total - detectPassed - splitPassed,
        accuracy: total ? Math.round(((detectPassed + splitPassed) / total) * 1000) / 10 : null,
        ms: Date.now() - started,
      },
    };
  }

  const harness = { runTests };
  if (typeof window !== "undefined") window.FrogbotTestHarness = harness;
  if (typeof module !== "undefined" && module.exports) module.exports = harness;
})();
