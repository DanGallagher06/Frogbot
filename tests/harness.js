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

  // ---- Scoring cases (tests/score-cases.js) ----

  // A case's unit: a sentence string, or { text, row, headers, context, group }.
  function toUnit(spec, index) {
    const u = typeof spec === "string" ? { text: spec } : spec;
    const isRow = Boolean(u.row);
    return {
      text: u.text,
      kind: isRow ? "row" : "sentence",
      headers: u.headers || [],
      context: { inTable: isRow, ...(u.context || {}) },
      group: u.group ?? `unit:${index}`,
      table: isRow ? (u.context && u.context.table) || "table" : null,
      order: index,
    };
  }

  function scored(score, spec, index = 0) {
    const unit = toUnit(spec, index);
    unit.numbers = score.detectNumbers(unit.text, { inTable: unit.kind === "row" });
    const headerNumbers = unit.headers.flatMap((h) => score.detectNumbers(h));
    const hasHeaders = unit.headers.length > 0;
    Object.assign(unit, score.scoreUnit(unit, unit.numbers, { ...unit.context, headerNumbers, hasHeaders }));
    unit.words = unit.text.split(/\s+/).filter(Boolean).length;
    return unit;
  }

  const describe = (u) => `${u.score} (${u.reasons.join(", ") || "no signals"})`;

  function runScoreCase(score, c) {
    const min = score.MIN_SCORE;
    if (c.kind === "picks") {
      const units = c.units.map((spec, i) => scored(score, spec, i));
      const chosen = score.pickTargets(units, { totalWords: c.totalWords }).map((u) => u.order);
      const pass = chosen.length === c.expect.length && chosen.every((v, i) => v === c.expect[i]);
      return {
        ...c,
        label: `picks [${c.expect.join(", ")}] from ${units.length} units`,
        detail: `chose [${chosen.join(", ")}]; scores ${units.map((u) => u.finalScore ?? u.score).join(", ")}`,
        pass,
      };
    }
    if (c.kind === "figures") {
      const numbers = score.detectNumbers(c.text, { inTable: Boolean(c.row) });
      const got = score.figureGroups(numbers, c.text).map((g) => [g.figure.raw, g.extras.map((e) => e.raw)]);
      const pass = JSON.stringify(got) === JSON.stringify(c.expect);
      return { ...c, label: `figures to highlight in "${c.text}"`, detail: JSON.stringify(got), pass };
    }
    if (c.kind === "pageYear") {
      const numbers = c.texts.flatMap((text) => score.detectNumbers(text));
      const got = score.pageYear(numbers, c.currentYear);
      return { ...c, label: `page year is ${c.expect} (current year ${c.currentYear})`, detail: `got ${got}`, pass: got === c.expect };
    }
    if (c.kind === "topic") {
      const got = score.topicOf(c.text);
      return { ...c, label: `"${c.text}" is topic ${c.topic}`, detail: `topic ${got}`, pass: got === c.topic };
    }
    if (c.kind === "same") {
      const a = scored(score, c.a);
      const b = scored(score, c.b, 1);
      return { ...c, label: `"${a.text}" scores the same as "${b.text}"`, detail: `A ${describe(a)} vs B ${describe(b)}`, pass: a.score === b.score };
    }
    if (c.kind === "beats") {
      const a = scored(score, c.a);
      const b = scored(score, c.b, 1);
      return { ...c, label: `"${a.text}" beats "${b.text}"`, detail: `A ${describe(a)} vs B ${describe(b)}`, pass: a.score > b.score };
    }
    const u = scored(score, c.unit);
    const tests = {
      passes: [u.score >= min, `passes MIN_SCORE ${min}`],
      fails: [u.score < min, `stays below MIN_SCORE ${min}`],
      below: [u.score < c.than, `scores below ${c.than}`],
    };
    const [pass, what] = tests[c.kind];
    return { ...c, label: `"${u.text}" ${what}`, detail: describe(u), pass };
  }

  function runScoreTests(score, cases) {
    const started = Date.now();
    const results = (cases || []).map((c) => runScoreCase(score, c));
    const passed = results.filter((r) => r.pass).length;
    const byKind = {};
    for (const r of results) {
      byKind[r.kind] = byKind[r.kind] || { total: 0, passed: 0 };
      byKind[r.kind].total += 1;
      if (r.pass) byKind[r.kind].passed += 1;
    }
    return {
      results,
      byKind,
      summary: {
        total: results.length,
        passed,
        failed: results.length - passed,
        accuracy: results.length ? Math.round((passed / results.length) * 1000) / 10 : null,
        ms: Date.now() - started,
      },
    };
  }

  // ---- Fact cases (tests/facts-cases.js) ----

  // Units for a facts case: sentences, sentences under a heading, or table rows.
  function factUnits(score, specs) {
    return specs.map((spec, i) => {
      if (typeof spec === "string" || spec.text) {
        const text = typeof spec === "string" ? spec : spec.text;
        return {
          kind: "sentence",
          text,
          numbers: score.detectNumbers(text),
          sentence: { start: 0, end: text.length },
          blockText: text,
          heading: spec.heading || null,
          pageTitle: spec.pageTitle || null,
          listIntro: spec.listIntro || null,
          blockIndexes: [i],
          order: i,
        };
      }
      let offset = 0;
      const cells = spec.row.map((text, k) => {
        const cell = { start: offset, end: offset + text.length, text, header: (spec.headers || [])[k] || null };
        offset += text.length + 3;
        return cell;
      });
      const text = spec.row.join(" | ");
      return {
        kind: "row",
        text,
        numbers: score.detectNumbers(text, { inTable: true }),
        cells,
        headers: (spec.headers || []).filter(Boolean),
        tableTitle: spec.title || "",
        tableScale: spec.scale || null,
        heading: spec.heading || null,
        blockIndexes: [i],
        order: i,
      };
    });
  }

  function factProblems(exp, got) {
    const problems = [];
    const check = (field, actual) => {
      if (!(field in exp)) return;
      if (JSON.stringify(actual) !== JSON.stringify(exp[field])) {
        problems.push(`${field}: expected ${JSON.stringify(exp[field])}, got ${JSON.stringify(actual)}`);
      }
    };
    check("label", got.label);
    check("display", got.display);
    check("role", got.role);
    check("period", got.period ? got.period.text : null);
    check("periodSource", got.periodSource);
    check("confidence", got.confidence);
    check("labelConfidence", got.labelConfidence);
    check("periodConfidence", got.periodConfidence);
    check("showOnCard", got.showOnCard);
    check("periodInferred", got.periodInferred);
    check("direction", got.direction);
    check("directionSource", got.directionSource);
    check("sentiment", got.sentiment);
    check("vsEstimate", got.vsEstimate);
    check("tolerance", got.tolerance ? got.tolerance.display : null);
    check("changeDirection", got.change ? got.change.direction : null);
    check("priorPeriod", got.priorPeriod);
    check("prior", got.prior ? `${got.prior.display} in ${got.prior.period}` : null);
    check("qualifiers", got.qualifiers);
    check("change", got.change ? got.change.display : null);
    check("linked", Boolean(got.linkedTo));
    check("sources", got.sources.length);
    if ("sentenceStarts" in exp && !got.sentence.startsWith(exp.sentenceStarts)) {
      problems.push(`sentence: expected to start "${exp.sentenceStarts}", got "${got.sentence.slice(0, 40)}"`);
    }
    return problems;
  }

  function runFactsTests(facts, score, cases) {
    const started = Date.now();
    const results = (cases || []).map((c) => {
      const units = factUnits(score, c.units);
      const got = facts.buildFacts([{ units }], [], c.context || {});
      const problems = [];
      if (got.length !== c.expect.length) problems.push(`expected ${c.expect.length} facts, got ${got.length}`);
      c.expect.forEach((exp, i) => {
        if (!got[i]) return;
        for (const p of factProblems(exp, got[i])) problems.push(`fact ${i + 1} ${p}`);
      });
      const summary = got.map((f) => `${f.label}: ${f.display} (${f.role}, ${f.period ? f.period.text : "no period"} [${f.periodSource}], label ${f.labelConfidence}, period ${f.periodConfidence}${f.showOnCard ? ", card" : ""}${f.direction ? `, ${f.direction} [${f.directionSource}]` : ""}${f.sentiment ? `, ${f.sentiment}` : ""}${f.vsEstimate ? `, ${f.vsEstimate} estimates` : ""}${f.sources.length > 1 ? `, ${f.sources.length} sources` : ""})`);
      const text = c.units.map((u) => (typeof u === "string" ? u : u.text || u.row.join(" | "))).join("  +  ");
      return { text, expect: c.expect, got: summary, problems, pass: problems.length === 0 };
    });
    const passed = results.filter((r) => r.pass).length;
    return {
      results,
      summary: {
        total: results.length,
        passed,
        failed: results.length - passed,
        accuracy: results.length ? Math.round((passed / results.length) * 1000) / 10 : null,
        ms: Date.now() - started,
      },
    };
  }

  const harness = { runTests, runScoreTests, runFactsTests };
  if (typeof window !== "undefined") window.FrogbotTestHarness = harness;
  if (typeof module !== "undefined" && module.exports) module.exports = harness;
})();
