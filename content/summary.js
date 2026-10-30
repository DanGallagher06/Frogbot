// Frogbot: the written summary (milestone 3). Pure: it reads fact records and never touches the
// page.
//
// rulesSummary() writes 2-4 short sentences from the facts on the card, using only their display
// values, so every number in it comes from the page by construction. It is also the fallback for
// summaries written any other way.
//
// checkSummary() is the gatekeeper for summaries written by anything else (such as an on-device
// AI model): a sentence is kept only if every number in it can be traced to a fact or to one of
// the sentences the summary was written from, attributed to the same metric, and described as
// moving the same way. Sentences that fail are dropped, never "fixed"; if too many fail, the whole
// summary is rejected so the caller can fall back to the rules summary.
(() => {
  const Score =
    (typeof window !== "undefined" && window.FrogbotScore) ||
    (typeof require !== "undefined" ? require("./score.js") : null);
  const Facts =
    (typeof window !== "undefined" && window.FrogbotFacts) ||
    (typeof require !== "undefined" ? require("./facts.js") : null);

  const MAX_SENTENCES = 4;
  const VERB = { up: "rose", down: "fell" };
  const PLURAL = /(?:earnings|sales|expenses|margins|revenues|dividends|buybacks|repurchases)$/i;
  const WHEN = new Set(["period", "date", "year"]);
  // Comparisons, not periods: "year over year", "Y/Y", "sequentially".
  const COMPARISON = /over|on[\s-]year|sequential|yoy|qoq|[yq]\/[yq]/i;
  // Labels that name the same metric.
  const SAME_METRIC = { Profit: "Net income", Earnings: "Net income" };
  const isSegment = (q) => /^[A-Z]/.test(q) && !/^(?:GAAP|non-GAAP)$/.test(q);

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  const metricText = (label) => label.replace(/^Guidance:\s*/, "");
  const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // A label in the middle of a sentence: "net income", "non-GAAP operating income", but
  // "EPS", "GAAP net income" and segment names ("Data Center revenue") keep their capitals.
  function midSentence(fact) {
    const label = metricText(fact.label);
    if (/^Non-GAAP\b/.test(label)) return "non-GAAP" + label.slice(8);
    const first = label.split(" ")[0];
    if (/^[A-Z]{2,}/.test(first) || (fact.qualifiers || []).some((q) => isSegment(q) && label.startsWith(q))) return label;
    return label.charAt(0).toLowerCase() + label.slice(1);
  }

  // The metric a fact's label names, with its qualifiers ({ label: "Operating income", qualifiers: ["non-GAAP"] }).
  function factMetric(fact) {
    const text = metricText(fact.label);
    return Facts.metricNear(text, text.length);
  }

  const canonical = (label) => SAME_METRIC[label] || label;

  // Same metric: the same canonical term, no conflicting GAAP / non-GAAP qualifier, and the
  // same segment (or none on both sides: a segment's figure isn't the company's).
  function sameMetric(a, b) {
    if (!a || !b || canonical(a.label) !== canonical(b.label)) return false;
    const gaap = (m) => m.qualifiers.find((q) => /^(?:GAAP|non-GAAP)$/.test(q)) || null;
    const segment = (m) => (m.qualifiers.find(isSegment) || "").toLowerCase() || null;
    if (gaap(a) && gaap(b) && gaap(a) !== gaap(b)) return false;
    return segment(a) === segment(b);
  }

  // Two figures are the same if they're the same kind and currency, and money is within 0.5%
  // (per-share amounts and anything under 1,000 exactly), percentages, basis points and
  // multiples exactly; ranges by both ends. Signs are ignored: "fell 3%" is the "-3%" change.
  function sameNumber(a, b) {
    const kind = (x) => (x.type === "perShare" ? "money" : x.type);
    if (kind(a) !== kind(b) || kind(a) === undefined) return false;
    if (a.currency && b.currency && a.currency !== b.currency) return false;
    const close = (x, y) => {
      if (typeof x !== "number" || typeof y !== "number") return false;
      const [p, q] = [Math.abs(x), Math.abs(y)];
      if (kind(a) !== "money" || Math.max(p, q) < 1000) return Math.abs(p - q) < 0.005;
      return Math.abs(p - q) <= 0.005 * q;
    };
    const ranged = (x) => x.low != null && x.high != null;
    if (ranged(a) !== ranged(b)) return false;
    return ranged(a) ? close(a.low, b.low) && close(a.high, b.high) : close(a.value, b.value);
  }

  // Periods compared loosely: "the second quarter" = "Second-quarter", "Q3 2026" = "third
  // quarter of 2026", "FY26" = "fiscal 2026" = "fiscal year 2026".
  const ORDINAL = ["", "first", "second", "third", "fourth"];
  const normaliseWhen = (s) =>
    s
      .toLowerCase()
      .replace(/[-–—]/g, " ")
      .replace(/\bq([1-4])\b/g, (_, q) => `${ORDINAL[q]} quarter`)
      .replace(/\bfy\s*['’]?(\d{2})\b/g, (_, y) => `fiscal 20${y}`)
      .replace(/\bfy\s*(\d{4})\b/g, "fiscal $1")
      .replace(/\bfiscal year\b/g, "fiscal")
      .replace(/\b(?:the|of|in)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // One period fits another if either's words appear, in order, inside the other's ("fourth
  // quarter" fits "fourth quarter 2026"; "2026" fits "Q3 2026").
  const fits = (a, b) => ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);

  // ---------------------------------------------------------------------------
  // The rules summary
  // ---------------------------------------------------------------------------

  // A period as it reads in a sentence ("Third Quarter 2026" -> "the third quarter of 2026").
  function periodPhrase(text) {
    const t = text.trim().replace(/^(first|second|third|fourth)-quarter$/i, "$1 quarter");
    const lower = t
      .replace(/\b(?:First|Second|Third|Fourth|Quarter|Fiscal|Year|Half|Full|Of)\b/g, (w) => w.toLowerCase())
      .replace(/\b(quarter|half) ((?:19|20)\d{2})\b/, "$1 of $2");
    return /^(?:first|second|third|fourth)\b|^full[\s-]year|^(?:first|second) half/i.test(lower) ? `the ${lower}` : lower;
  }

  // One fact as something to say, or null if there's nothing safe to say about it. A guessed
  // (inferred) period is left out rather than stated as fact, and so is a span of years (a
  // section heading's "1984–1991" isn't the figure's reporting period).
  const SPAN_OF_YEARS = /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|present)\b/i;
  function item(fact) {
    const stated = fact.period && !fact.periodInferred && !SPAN_OF_YEARS.test(fact.period.text);
    const period = stated ? periodPhrase(fact.period.text) : null;
    if (fact.role === "guidance") return { kind: "guidance", fact, period };
    if (fact.role === "level") return { kind: "level", fact, period };
    if (fact.role === "change" && VERB[fact.direction]) return { kind: "change", fact, period };
    return null;
  }

  // Pairs that read well in one sentence, for the same period: GAAP and non-GAAP figures for
  // the same metric, operating income then net income, or two changes.
  function canPair(a, b) {
    if (!b || a.kind === "guidance" || b.kind === "guidance" || a.period !== b.period) return false;
    if (a.kind === "change" && b.kind === "change") return true;
    if (a.kind !== "level" || b.kind !== "level") return false;
    const ma = factMetric(a.fact);
    const mb = factMetric(b.fact);
    if (!ma || !mb) return false;
    if (ma.label === "Operating income" && mb.label === "Net income") return true;
    const gaap = (m) => m.qualifiers.find((q) => /^(?:GAAP|non-GAAP)$/.test(q));
    return ma.label === mb.label && gaap(ma) && gaap(mb) && gaap(ma) !== gaap(mb);
  }

  // Sentences are built as parts: plain text, and numbers linked to their facts.
  function clause(it, first) {
    const f = it.fact;
    const subject = first ? capitalise(metricText(f.label)) : midSentence(f);
    const be = PLURAL.test(metricText(f.label)) ? "were" : "was";
    const num = (raw, factId) => ({ raw, factId });
    const unsigned = (s) => s.replace(/^[+\-−]/, "");
    if (it.kind === "change") return [`${subject} ${VERB[f.direction]} `, num(unsigned(f.display), f.id)];
    if (VERB[f.direction] && f.change) {
      return [`${subject} ${VERB[f.direction]} `, num(unsigned(f.change.display), f.change.factId), " to ", num(f.display, f.id)];
    }
    if (VERB[f.direction]) return [`${subject} ${VERB[f.direction]} to `, num(f.display, f.id)];
    if (f.direction === "flat") return [`${subject} ${be} unchanged at `, num(f.display, f.id)];
    return [`${subject} ${be} `, num(f.display, f.id)];
  }

  function guidanceSentence(a, b) {
    const num = (it) => ({ raw: it.fact.display, factId: it.fact.id });
    if (a.period) {
      const parts = [`For ${a.period}, the company guided ${midSentence(a.fact)} of `, num(a)];
      if (b) parts.push(` and ${midSentence(b.fact)} of `, num(b));
      return [...parts, "."];
    }
    const parts = [`${capitalise(metricText(a.fact.label))} guidance is `, num(a)];
    if (b) parts.push(`, and ${midSentence(b.fact)} guidance is `, num(b));
    return [...parts, "."];
  }

  function finish(parts) {
    let text = "";
    const numbers = [];
    for (const part of parts) {
      if (typeof part === "string") {
        text += part;
      } else {
        numbers.push({ raw: part.raw, factId: part.factId });
        text += part.raw;
      }
    }
    return { text, numbers };
  }

  // { kind: "rules", sentences: [{ text, numbers: [{ raw, factId }] }] }, or null when the card
  // has nothing to say. Follows the card's order: headline metrics first (up to three
  // sentences), then the guidance.
  function rulesSummary(facts) {
    const items = Facts.cardRows(facts)
      .rows.filter((r) => r.primary)
      .map((r) => item(r.fact))
      .filter(Boolean);
    const headline = items.filter((it) => it.kind !== "guidance");
    const guidance = items.filter((it) => it.kind === "guidance");
    const budget = MAX_SENTENCES - (guidance.length ? 1 : 0);
    const sentences = [];
    for (let i = 0; i < headline.length && sentences.length < budget; ) {
      const a = headline[i];
      const b = canPair(a, headline[i + 1]) ? headline[i + 1] : null;
      const parts = [...clause(a, true), ...(b ? [" and ", ...clause(b, false)] : [])];
      if (a.period) parts.push(` in ${a.period}`);
      sentences.push(finish([...parts, "."]));
      i += b ? 2 : 1;
    }
    if (guidance.length) {
      const [a, b] = guidance;
      sentences.push(finish(guidanceSentence(a, b && b.period === a.period ? b : null)));
    }
    return sentences.length ? { kind: "rules", sentences } : null;
  }

  // ---------------------------------------------------------------------------
  // The number checker
  // ---------------------------------------------------------------------------

  // The fact a number in a summary sentence refers to: the same value, about the same metric as
  // the sentence names for it. With no metric named near it, the value alone decides. A
  // "±2%" matches a guidance figure's tolerance.
  function matchFact(n, metric, facts) {
    if (/^±/.test(n.raw)) {
      return facts.find((f) => f.tolerance && f.tolerance.type === n.type && Math.abs(f.tolerance.value - Math.abs(n.value)) < 1e-9) || null;
    }
    const candidates = facts.filter((f) => sameNumber(n, f));
    if (!metric) return candidates[0] || null;
    return candidates.find((f) => sameMetric(factMetric(f), metric)) || null;
  }

  // The number appears in a source sentence, about the same metric (when the summary names one).
  function inSources(n, metric, sources) {
    return sources.some((s) =>
      s.numbers.some((m) => {
        if (WHEN.has(m.type) || !sameNumber(n, m)) return false;
        return !metric || sameMetric(Facts.metricNear(s.text, m.start, m.end), metric);
      })
    );
  }

  function checkSummary(summaryText, facts, sourceSentences = []) {
    const sources = sourceSentences.map((text) => ({ text, numbers: Score.detectNumbers(text).filter((n) => !n.junk) }));
    // Periods that are on the page: the facts' periods and those in the sources.
    const when = [];
    for (const f of facts) if (f.period) when.push(normaliseWhen(f.period.text));
    for (const s of sources) for (const n of s.numbers) if (WHEN.has(n.type)) when.push(normaliseWhen(n.raw));
    const onPage = (raw) => when.some((w) => fits(normaliseWhen(raw), w));

    const kept = [];
    const dropped = [];
    let verifiedCount = 0;
    for (const sentence of Score.splitSentences(summaryText)) {
      const text = sentence.text;
      const numbers = Score.detectNumbers(text).filter((n) => !n.junk && !(WHEN.has(n.type) && COMPARISON.test(n.raw)));
      const figures = numbers.filter((n) => !WHEN.has(n.type));
      const links = [];
      let reason = null;
      const stated = numbers.filter((n) => WHEN.has(n.type)).map((n) => n.raw);
      for (const n of numbers) {
        if (WHEN.has(n.type)) {
          if (onPage(n.raw)) {
            verifiedCount += 1;
            continue;
          }
          reason = `unverified period "${n.raw}"`;
          break;
        }
        const i = figures.indexOf(n);
        const metric = Facts.metricNear(text, n.start, n.end);
        const fact = matchFact(n, metric, facts);
        if (fact) {
          const from = i > 0 ? figures[i - 1].end : 0;
          const to = i < figures.length - 1 ? figures[i + 1].start : text.length;
          const said = Facts.directionNear(text, n.start, n.end, from, to);
          if (said && fact.direction && said !== fact.direction && fact.role !== "guidance") {
            reason = `"${n.raw}" is described as ${said}, but ${fact.label} went ${fact.direction}`;
            break;
          }
          // A period stated in the sentence must fit the figure's own period (when it has a
          // real one): "revenue of $482.6M in Q4 2026" is wrong if that was Q3's revenue.
          const own = fact.period && !fact.periodInferred ? normaliseWhen(fact.period.text) : null;
          if (own && stated.length && !stated.some((raw) => fits(normaliseWhen(raw), own))) {
            reason = `"${n.raw}" is for ${fact.period.text}, not ${stated.join(", ")}`;
            break;
          }
          links.push({ raw: n.raw, factId: fact.id });
          verifiedCount += 1;
          continue;
        }
        // Only a figure no fact holds can be verified from the sources: when a fact has this
        // value, the fact (which knows its table, heading and qualifiers) decides.
        if (!facts.some((f) => sameNumber(n, f)) && inSources(n, metric, sources)) {
          links.push({ raw: n.raw, factId: null });
          verifiedCount += 1;
          continue;
        }
        reason = `unverified number "${n.raw}"${metric ? ` for ${metric.label.toLowerCase()}` : ""}`;
        break;
      }
      if (reason) dropped.push({ text, reason });
      else kept.push({ text, numbers: links });
    }
    const total = kept.length + dropped.length;
    return {
      sentences: kept,
      dropped,
      verifiedCount,
      droppedCount: dropped.length,
      rejected: kept.length === 0 || dropped.length > total / 2,
    };
  }

  // The summary as plain text, one sentence per line.
  const plainText = (summary) => (summary && summary.sentences.length ? summary.sentences.map((s) => s.text).join("\n") + "\n" : "");

  const FrogbotSummary = { rulesSummary, checkSummary, plainText };
  if (typeof window !== "undefined" && !window.FrogbotSummary) window.FrogbotSummary = FrogbotSummary;
  if (typeof module !== "undefined" && module.exports) module.exports = FrogbotSummary;
})();
