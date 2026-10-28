// Test cases for content/score.js, used by tests/run-tests.html and tools/run_tests.py.
// detect: { text, source, expected: [{ raw, type?, value?, junk?, junkReason?, low?, high?,
//           isNegative?, currency?, scale? }] }. Only the fields given are checked;
//           expected matches must appear in order and nothing else may be found.
// split:  { text, expected: [sentence texts] }
// source: "synthetic" or the page a sentence was copied from.
(() => {
  const money = (raw, value, extra = {}) => ({ raw, type: "money", value, ...extra });
  const pct = (raw, value, extra = {}) => ({ raw, type: "percent", value, ...extra });
  const eps = (raw, value, extra = {}) => ({ raw, type: "perShare", value, ...extra });
  const period = (raw, extra = {}) => ({ raw, type: "period", ...extra });
  const date = (raw) => ({ raw, type: "date" });
  const year = (raw) => ({ raw, type: "year", value: Number(raw) });
  const count = (raw, value, extra = {}) => ({ raw, type: "count", value, ...extra });
  const bps = (raw, value, extra = {}) => ({ raw, type: "basisPoints", value, ...extra });
  const junk = (raw, junkReason) => ({ raw, junk: true, junkReason });

  const detect = [
    // ---- Money ----
    { source: "synthetic", text: "Revenue was $12.4B.", expected: [money("$12.4B", 12400000000, { currency: "USD", scale: "billion" })] },
    { source: "synthetic", text: "Sales hit £300m last year.", expected: [money("£300m", 300000000, { currency: "GBP", scale: "million" })] },
    { source: "synthetic", text: "It agreed a €4.2 billion deal.", expected: [money("€4.2 billion", 4200000000, { currency: "EUR" })] },
    { source: "synthetic", text: "The kit is priced at $1,250 each.", expected: [money("$1,250", 1250, { currency: "USD", scale: null })] },
    { source: "synthetic", text: "It paid US$3.1 million in fees.", expected: [money("US$3.1 million", 3100000, { currency: "USD" })] },
    { source: "synthetic", text: "An operating loss of $(1.2) million.", expected: [money("$(1.2) million", -1200000, { isNegative: true })] },
    { source: "synthetic", text: "Net loss was ($4.5) for the year.", expected: [money("($4.5)", -4.5, { isNegative: true })] },
    { source: "synthetic", text: "Toyota earned JPY 500 billion.", expected: [money("JPY 500 billion", 500000000000, { currency: "JPY" })] },
    { source: "synthetic", text: "Sony posted ¥2.3 trillion in sales.", expected: [money("¥2.3 trillion", 2300000000000, { currency: "JPY", scale: "trillion" })] },
    { source: "synthetic", text: "Revenue reached 4.2 billion euros.", expected: [money("4.2 billion euros", 4200000000, { currency: "EUR" })] },
    { source: "synthetic", text: "The bond raised 300 million USD.", expected: [money("300 million USD", 300000000, { currency: "USD" })] },
    { source: "synthetic", text: "Shopify spent C$45 million.", expected: [money("C$45 million", 45000000, { currency: "CAD" })] },
    { source: "synthetic", text: "A -$2.5M currency impact.", expected: [money("-$2.5M", -2500000, { isNegative: true })] },
    { source: "synthetic", text: "Net debt was negative $5 million.", expected: [money("$5 million", -5000000, { isNegative: true })] },
    { source: "synthetic", text: "It expects $10–12 billion in sales.", expected: [money("$10–12 billion", 11000000000, { low: 10000000000, high: 12000000000 })] },
    { source: "synthetic", text: "Guidance is $10 billion to $12 billion.", expected: [money("$10 billion to $12 billion", 11000000000, { low: 10000000000, high: 12000000000 })] },
    { source: "synthetic", text: "Sales rose from $422.6 million to $482.6 million.", expected: [money("$422.6 million", 422600000), money("$482.6 million", 482600000)] },
    { source: "synthetic", text: "Operating expenses increased by $3 million to $45 million.", expected: [money("$3 million", 3000000), money("$45 million", 45000000)] },
    { source: "Wikipedia", text: "Apple ran a US$1.5-million television advertisement.", expected: [money("US$1.5-million", 1500000)] },
    { source: "synthetic", text: "It costs $5bn to build.", expected: [money("$5bn", 5000000000, { scale: "billion" })] },
    { source: "synthetic", text: "Costs fell to $3.2 million, from $4.1 million.", expected: [money("$3.2 million", 3200000), money("$4.1 million", 4100000)] },
    { source: "synthetic", text: "Revenue was $5 million to $6 million (estimated).", expected: [money("$5 million to $6 million", 5500000, { low: 5000000, high: 6000000 })] },

    // ---- Percentages ----
    { source: "synthetic", text: "Sales were up 8% on last year.", expected: [pct("8%", 8)] },
    { source: "synthetic", text: "Revenue rose +12.5% year over year.", expected: [pct("+12.5%", 12.5), period("year over year")] },
    { source: "synthetic", text: "Volumes fell -3.1 percent.", expected: [pct("-3.1 percent", -3.1, { isNegative: true })] },
    { source: "synthetic", text: "Exports grew 12.5 per cent in May.", expected: [pct("12.5 per cent", 12.5)] },
    { source: "synthetic", text: "A (2.4)% decline in margin.", expected: [pct("(2.4)%", -2.4, { isNegative: true })] },
    { source: "synthetic", text: "Growth of 8% to 10% is expected.", expected: [pct("8% to 10%", 9, { low: 8, high: 10 })] },
    { source: "synthetic", text: "Growth of 8–10% is expected.", expected: [pct("8–10%", 9, { low: 8, high: 10 })] },
    { source: "synthetic", text: "Growth of 8%-10% is expected.", expected: [pct("8%-10%", 9, { low: 8, high: 10 })] },
    { source: "synthetic", text: "Market share is 92%, down from 95%.", expected: [pct("92%", 92), pct("95%", 95)] },
    { source: "synthetic", text: "Rates rose to 5.25%.", expected: [pct("5.25%", 5.25)] },

    // ---- Basis points ----
    { source: "synthetic", text: "Margin expanded 40 basis points.", expected: [bps("40 basis points", 40)] },
    { source: "synthetic", text: "The bank cut rates by 25 bps.", expected: [bps("25 bps", 25)] },
    { source: "synthetic", text: "A 150bp rise in yields.", expected: [bps("150bp", 150)] },
    { source: "synthetic", text: "Spreads widened between 50 and 75 basis points.", expected: [bps("50 and 75 basis points", 62.5, { low: 50, high: 75 })] },
    { source: "synthetic", text: "Margin fell -30 bps in the quarter.", expected: [bps("-30 bps", -30, { isNegative: true })] },

    // ---- Per share ----
    { source: "synthetic", text: "It reported EPS of $1.42.", expected: [eps("$1.42", 1.42, { currency: "USD" })] },
    { source: "synthetic", text: "It declared a dividend of $0.35 per share.", expected: [eps("$0.35 per share", 0.35)] },
    { source: "synthetic", text: "Profit was $2.10 per diluted share.", expected: [eps("$2.10 per diluted share", 2.1)] },
    { source: "synthetic", text: "Diluted EPS was $3.05, beating the $2.98 consensus.", expected: [eps("$3.05", 3.05), eps("$2.98", 2.98)] },
    { source: "synthetic", text: "Net income per diluted share rose to $4.12.", expected: [eps("$4.12", 4.12)] },
    { source: "synthetic", text: "EPS of $1.42 on revenue of $3.2 billion.", expected: [eps("$1.42", 1.42), money("$3.2 billion", 3200000000)] },

    // ---- Multiples ----
    { source: "synthetic", text: "The stock trades at 2.5x sales.", expected: [{ raw: "2.5x", type: "multiple", value: 2.5 }] },
    { source: "synthetic", text: "It trades at 3.1 times earnings.", expected: [{ raw: "3.1 times", type: "multiple", value: 3.1 }] },
    { source: "synthetic", text: "Investors made a 10X return.", expected: [{ raw: "10X", type: "multiple", value: 10 }] },

    // ---- Periods ----
    { source: "synthetic", text: "Q3 2026 revenue beat forecasts.", expected: [period("Q3 2026", { value: 2026 })] },
    { source: "synthetic", text: "In Q3, sales rose.", expected: [period("Q3")] },
    { source: "synthetic", text: "Sales slowed in the third quarter.", expected: [period("third quarter")] },
    { source: "synthetic", text: "Its fiscal 2025 results were strong.", expected: [period("fiscal 2025", { value: 2025 })] },
    { source: "synthetic", text: "FY26 guidance was raised.", expected: [period("FY26", { value: 2026 })] },
    { source: "synthetic", text: "The FY2026 outlook is unchanged.", expected: [period("FY2026", { value: 2026 })] },
    { source: "synthetic", text: "H1 revenue grew.", expected: [period("H1")] },
    { source: "synthetic", text: "Sales grew in the first half of 2025.", expected: [period("first half of 2025", { value: 2025 })] },
    { source: "synthetic", text: "Its full-year 2025 revenue fell.", expected: [period("full-year 2025", { value: 2025 })] },
    { source: "synthetic", text: "Sales were up 5% year-over-year.", expected: [pct("5%", 5), period("year-over-year")] },
    { source: "synthetic", text: "Revenue for Q2 FY26 rose.", expected: [period("Q2 FY26", { value: 2026 })] },
    { source: "synthetic", text: "Q4'25 margins improved.", expected: [period("Q4'25", { value: 2025 })] },
    { source: "synthetic", text: "Results for the third quarter of fiscal 2026 are due.", expected: [period("third quarter of fiscal 2026", { value: 2026 })] },
    { source: "synthetic", text: "Revenue grew 4% sequentially.", expected: [pct("4%", 4), period("sequentially")] },

    // ---- Dates ----
    { source: "synthetic", text: "The quarter ended March 31, 2026.", expected: [date("March 31, 2026")] },
    { source: "synthetic", text: "The quarter ended 31 March 2026.", expected: [date("31 March 2026")] },
    { source: "synthetic", text: "Balances as of 2026-03-31.", expected: [date("2026-03-31")] },
    { source: "synthetic", text: "It was released Oct. 21 in New York.", expected: [date("Oct. 21")] },
    { source: "bbc", text: "In the US, they've become a huge issue ahead of the midterm elections on 3 November, with both parties", expected: [date("3 November")] },
    { source: "wikipedia", text: "In April 2024, it was reported that Nvidia planned to open a new research center.", expected: [date("April 2024")] },
    { source: "test-page", text: "Press release · October 21, 2026", expected: [date("October 21, 2026")] },

    // ---- Years ----
    { source: "synthetic", text: "The firm was founded in 1998.", expected: [year("1998")] },
    { source: "synthetic", text: "The 2024–2025 season was strong.", expected: [{ raw: "2024–2025", type: "year", low: 2024, high: 2025 }] },
    { source: "synthetic", text: "Sales doubled between 2019 and 2023.", expected: [year("2019"), year("2023")] },

    // ---- Counts ----
    { source: "synthetic", text: "It has 4,000 employees.", expected: [count("4,000", 4000)] },
    { source: "synthetic", text: "It opened 12 stores.", expected: [count("12", 12)] },
    { source: "synthetic", text: "It now has 1.2 million customers.", expected: [count("1.2 million", 1200000, { scale: "million" })] },
    { source: "synthetic", text: "It launched 3 new products.", expected: [count("3", 3)] },
    { source: "synthetic", text: "(1,234)", expected: [count("(1,234)", -1234, { isNegative: true })] },
    { source: "synthetic", text: "Shipments of 10 to 12 million units.", expected: [count("10 to 12 million", 11000000, { low: 10000000, high: 12000000 })] },

    // ---- Junk ----
    { source: "synthetic", text: "Call 1-800-555-0199 today.", expected: [junk("1-800-555-0199", "phone")] },
    { source: "synthetic", text: "London office: +44 20 7946 0958.", expected: [junk("+44 20 7946 0958", "phone")] },
    { source: "synthetic", text: "Investor line (405) 555-0100.", expected: [junk("(405) 555-0100", "phone")] },
    { source: "synthetic", text: "Copyright 2025 Lilypad Holdings.", expected: [{ raw: "2025", type: "year", junk: true, junkReason: "copyright" }] },
    { source: "synthetic", text: "Net income[1] rose.", expected: [junk("[1]", "footnote")] },
    { source: "synthetic", text: "Net income (1) rose 5%.", expected: [junk("(1)", "footnote"), pct("5%", 5)] },
    { source: "synthetic", text: "Adjusted income1 rose.", expected: [junk("1", "footnote")] },
    { source: "synthetic", text: "Page 3", expected: [junk("Page 3", "page")] },
    { source: "synthetic", text: "3 of 12", expected: [junk("3 of 12", "page")] },
    { source: "synthetic", text: "One Apple Park Way and 1 Infinite Loop, Cupertino, CA 95014", expected: [junk("1", "address"), junk("95014", "postcode")] },
    { source: "synthetic", text: "Our office is at 10 Downing Street, London SW1A 2AA.", expected: [junk("10", "address"), junk("SW1A 2AA", "postcode")] },
    { source: "synthetic", text: "The call is at 9:00 a.m. ET.", expected: [junk("9:00 a.m. ET", "time")] },
    { source: "synthetic", text: "Trading closes at 16:30 GMT.", expected: [junk("16:30 GMT", "time")] },
    { source: "synthetic", text: "Slides at www.example.com/q3-2026 now.", expected: [junk("www.example.com/q3-2026", "url")] },
    { source: "synthetic", text: "Email ir2026@example.com for details.", expected: [junk("ir2026@example.com", "email")] },
    { source: "synthetic", text: "Tencent (HKEX: 0700) shares rose.", expected: [junk("0700", "ticker")] },
    { source: "synthetic", text: "Its ISIN is US0378331005.", expected: [junk("US0378331005", "code")] },
    { source: "synthetic", text: "CUSIP 67066G104", expected: [junk("67066G104", "code")] },
    { source: "synthetic", text: "Phones running iOS 18 sold well.", expected: [junk("iOS 18", "version")] },
    { source: "synthetic", text: "The RTX 4090 GPU launched.", expected: [junk("RTX 4090", "model")] },
    { source: "synthetic", text: "Windows 11 adoption grew.", expected: [junk("Windows 11", "version")] },
    { source: "synthetic", text: "Demand for H100 chips is high.", expected: [junk("H100", "model")] },
    { source: "synthetic", text: "It joined the S&P 500 index.", expected: [junk("S&P 500", "name")] },
    { source: "synthetic", text: "The COVID-19 pandemic hit sales.", expected: [junk("COVID-19", "model")] },
    { source: "synthetic", text: "NVIDIA (NASDAQ: NVDA) shares rose.", expected: [] },
    // Inflation notes: the restated amount and its year aren't figures of the story.
    { source: "wikipedia", text: "It was introduced at a price of $666.66 (equivalent to $3,770 in 2025).", expected: [money("$666.66", 666.66), junk("equivalent to $3,770 in 2025", "inflation")] },
    { source: "wikipedia", text: "Together they raised $1,300 (equivalent to about $7,400 in 2025).", expected: [money("$1,300", 1300), junk("equivalent to about $7,400 in 2025", "inflation")] },
    { source: "synthetic", text: "The club was sold for £5 million (equivalent to £9.1 million in 2024) in 1998.", expected: [money("£5 million", 5000000), junk("equivalent to £9.1 million in 2024", "inflation"), year("1998")] },
    { source: "synthetic", text: "Revenue in 2025 was equivalent to 3% of GDP.", expected: [year("2025"), pct("3%", 3)] },
    { source: "synthetic", text: "It announced a 3-for-1 stock split.", expected: [count("3", 3), count("1", 1)] },
    { source: "synthetic", text: "Prices should recover by mid-2025.", expected: [year("2025")] },

    // ---- Per share: only when tied to a per-share phrase in the same clause ----
    {
      source: "synthetic",
      text: "EPS of $1.42; capital expenditure was $350 million and the dividend was $0.10 per share",
      expected: [eps("$1.42", 1.42), money("$350 million", 350000000), eps("$0.10 per share", 0.1)],
    },
    { source: "synthetic", text: "EPS rose to $1.42, and the company spent $40 on each unit", expected: [eps("$1.42", 1.42), money("$40", 40)] },
    { source: "synthetic", text: "EPS was $2.10. The company also paid $15 for each widget.", expected: [eps("$2.10", 2.1), money("$15", 15)] },
    { source: "synthetic", text: "Diluted EPS of $0.88 compared with analysts' forecasts, while the average order value rose to $64.", expected: [eps("$0.88", 0.88), money("$64", 64)] },
    { source: "synthetic", text: "It earned $3.25 a share in the quarter.", expected: [eps("$3.25 a share", 3.25)] },
    { source: "synthetic", text: "Each $5 a shareholder paid was refunded.", expected: [money("$5", 5)] },

    // ---- Bracketed amounts: negative in tables, an aside in prose ----
    { source: "synthetic", text: "($1.2 million)", options: { inTable: true }, expected: [money("($1.2 million)", -1200000, { isNegative: true })] },
    { source: "synthetic", text: "($1.2 million)", expected: [money("$1.2 million", 1200000, { isNegative: false })] },
    { source: "synthetic", text: "Restructuring costs ($1.2 million) were lower than expected.", expected: [money("$1.2 million", 1200000, { isNegative: false })] },
    { source: "synthetic", text: "(£3.4bn)", options: { inTable: true }, expected: [money("(£3.4bn)", -3400000000, { isNegative: true, currency: "GBP" })] },
    { source: "synthetic", text: "Net loss ($0.45) per share", expected: [money("($0.45)", -0.45, { isNegative: true })] },

    // ---- Pence ----
    { source: "synthetic", text: "Shares fell 5 per cent to 240p.", expected: [pct("5 per cent", 5), money("240p", 2.4, { currency: "GBP" })] },
    { source: "synthetic", text: "The shares closed at 98.5p, up 3p.", expected: [money("98.5p", 0.985, { currency: "GBP" }), money("3p", 0.03, { currency: "GBP" })] },
    { source: "synthetic", text: "The final dividend is 15.5p.", expected: [money("15.5p", 0.155, { currency: "GBP" })] },
    { source: "synthetic", text: "It streams in 1080p and 720p.", expected: [junk("1080p", "resolution"), junk("720p", "resolution")] },
    { source: "synthetic", text: "Plug in the 4p connector.", expected: [junk("4p", "unit")] },

    // ---- Period ranges ----
    { source: "synthetic", text: "Revenue for Q1-Q3 2026 rose.", expected: [period("Q1-Q3 2026", { low: 1, high: 3, value: 2026 })] },
    { source: "synthetic", text: "Q1–Q3 margins improved.", expected: [period("Q1–Q3", { low: 1, high: 3, value: null })] },
    { source: "synthetic", text: "H1-H2 trends diverged.", expected: [period("H1-H2", { low: 1, high: 2 })] },

    // ---- Multiples vs frequencies ----
    { source: "synthetic", text: "It pays a dividend 4 times a year.", expected: [count("4", 4)] },
    { source: "synthetic", text: "The stock trades at 12 times forward earnings.", expected: [{ raw: "12 times", type: "multiple", value: 12 }] },
    { source: "synthetic", text: "The deal values it at 8 times EBITDA.", expected: [{ raw: "8 times", type: "multiple", value: 8 }] },
    { source: "synthetic", text: "Prices rose three times last year.", expected: [] },

    // ---- Decades ----
    { source: "synthetic", text: "Growth like the 1990s returned.", expected: [period("1990s", { value: 1990, decade: true })] },
    { source: "synthetic", text: "Rates last seen in the '90s are back.", expected: [period("'90s", { value: 1990, decade: true })] },
    { source: "synthetic", text: "Prices peaked in the 2000s.", expected: [period("2000s", { value: 2000, decade: true })] },
    { source: "synthetic", text: "Nvidia went public in 1999.", expected: [year("1999")] },

    // ---- Real sentences: test page ----
    {
      source: "test-page",
      text: "POND CITY, Oregon — Lilypad Holdings, Inc. (NASDAQ: LILY), a maker of wetland-friendly outdoor furniture, today announced financial results for the third quarter ended September 30, 2026. Revenue rose to $482.6 million, up 14.2% year over year, driven by strong demand for the company's Marsh Series loungers.1",
      expected: [period("third quarter"), date("September 30, 2026"), money("$482.6 million", 482600000), pct("14.2%", 14.2), period("year over year"), junk("1", "footnote")],
    },
    {
      source: "test-page",
      text: "Net income for Q3 2026 was $61.3 million, compared with $47.9 million in Q3 2025. Diluted earnings per share were $1.27, ahead of the $1.12 reported a year earlier. Gross margin expanded 180 basis points to 43.5%, reflecting lower resin costs and a more favourable product mix.",
      expected: [period("Q3 2026"), money("$61.3 million", 61300000), money("$47.9 million", 47900000), period("Q3 2025"), eps("$1.27", 1.27), eps("$1.12", 1.12), bps("180 basis points", 180), pct("43.5%", 43.5)],
    },
    {
      source: "test-page",
      text: "For the fourth quarter of 2026, Lilypad expects revenue between $505 million and $525 million and diluted EPS between $1.30 and $1.38. The company is raising its full-year 2026 revenue guidance to $1.86 billion to $1.88 billion, up from its previous range of $1.80 billion to $1.84 billion. Full-year gross margin is now expected to be around 43%, about 50 basis points higher than earlier guidance.",
      expected: [
        period("fourth quarter of 2026", { value: 2026 }),
        money("$505 million and $525 million", 515000000, { low: 505000000, high: 525000000 }),
        eps("$1.30 and $1.38", 1.34, { low: 1.3, high: 1.38 }),
        period("full-year 2026"),
        money("$1.86 billion to $1.88 billion", 1870000000, { low: 1860000000, high: 1880000000 }),
        money("$1.80 billion to $1.84 billion", 1820000000, { low: 1800000000, high: 1840000000 }),
        pct("43%", 43),
        bps("50 basis points", 50),
      ],
    },
    { source: "test-page", text: "Revenue of $482.6 million, up 14.2% from $422.6 million in the prior-year quarter.", expected: [money("$482.6 million", 482600000), pct("14.2%", 14.2), money("$422.6 million", 422600000)] },
    { source: "test-page", text: "Operating income of $84.0 million, an operating margin of 17.4%.", expected: [money("$84.0 million", 84000000), pct("17.4%", 17.4)] },
    { source: "test-page", text: "Direct-to-consumer sales grew 22% and now represent 38% of total revenue.", expected: [pct("22%", 22), pct("38%", 38)] },
    { source: "test-page", text: "Free cash flow of $55.8 million; cash and equivalents of $310.2 million at quarter end.", expected: [money("$55.8 million", 55800000), money("$310.2 million", 310200000)] },
    { source: "test-page", text: "Repurchased 1.1 million shares for $48.5 million.", expected: [count("1.1 million", 1100000), money("$48.5 million", 48500000)] },
    { source: "test-page", text: "The Outdoor Living segment generated revenue of $331.4 million, up 11.8%, while the newer Garden Water segment grew 19.7% to $151.2 million.", expected: [money("$331.4 million", 331400000), pct("11.8%", 11.8), pct("19.7%", 19.7), money("$151.2 million", 151200000)] },
    { source: "test-page", text: "International revenue increased 8.3% to $96.5 million. Excluding currency effects, international growth would have been 10.1%.", expected: [pct("8.3%", 8.3), money("$96.5 million", 96500000), pct("10.1%", 10.1)] },
    { source: "test-page", text: "Capital expenditures for fiscal 2026 are expected to be approximately $70 million, primarily for the expansion of the Pond City distribution centre.", expected: [period("fiscal 2026"), money("$70 million", 70000000)] },
    {
      source: "test-page",
      text: "Lilypad will host a conference call to discuss these results on October 22, 2026 at 5:00 p.m. Eastern Time. To join by phone, dial (555) 014-7781 and reference conference ID 4471. A replay will be available on the Events page for 30 days.",
      expected: [date("October 22, 2026"), junk("5:00 p.m.", "time"), junk("(555) 014-7781", "phone"), junk("4471", "code"), count("30", 30)],
    },
    { source: "test-page", text: "Founded in 1998, Lilypad Holdings designs and manufactures outdoor furniture and garden water features sold through more than 2,400 retail partners and its own online store. The company is headquartered at 742 Bullrush Avenue, Pond City, Oregon.", expected: [year("1998"), count("2,400", 2400), junk("742", "address")] },
    { source: "test-page", text: "1 Marsh Series includes loungers, side tables and planters launched in 2024. 2 Figures are unaudited. Percentages are calculated from unrounded amounts.", expected: [junk("1", "footnote"), year("2024"), junk("2", "footnote")] },
    { source: "test-page", text: "The table below compares the third quarter with the same period last year.2", expected: [period("third quarter"), junk("2", "footnote")] },
    { source: "test-page", text: "Page 1 of 3", expected: [junk("Page 1 of 3", "page")] },
    { source: "test-page", text: "Investor Relations · Lilypad Holdings, Inc. · 742 Bullrush Avenue, Pond City, OR 97999", expected: [junk("742", "address"), junk("97999", "postcode")] },
    { source: "test-page", text: "IR contact: ir@example.com · Tel. (555) 014-7700", expected: [junk("(555) 014-7700", "phone")] },
    { source: "test-page", text: "© 2026 Lilypad Holdings, Inc. All rights reserved. This is a fictional company used for testing.", expected: [{ raw: "2026", type: "year", junk: true, junkReason: "copyright" }] },
    { source: "test-page", text: "+180 bps", expected: [bps("+180 bps", 180)] },
    { source: "test-page", text: "+14.2%", expected: [pct("+14.2%", 14.2)] },
    { source: "test-page", text: "$1.27", expected: [money("$1.27", 1.27)] },
    { source: "test-page", text: "Q3 2026", expected: [period("Q3 2026", { value: 2026 })] },

    // ---- Real sentences: Nvidia Q2 FY26 release ----
    {
      source: "nvidia",
      text: "NVIDIA (NASDAQ: NVDA) today reported revenue for the second quarter ended July 27, 2025, of $46.7 billion, up 6% from the previous quarter and up 56% from a year ago.",
      expected: [period("second quarter"), date("July 27, 2025"), money("$46.7 billion", 46700000000), pct("6%", 6), pct("56%", 56)],
    },
    { source: "nvidia", text: "For the quarter, GAAP and non-GAAP gross margins were 72.4% and 72.7%, respectively.", expected: [pct("72.4%", 72.4), pct("72.7%", 72.7)] },
    { source: "nvidia", text: "For the quarter, GAAP and non-GAAP earnings per diluted share were $1.08 and $1.05, respectively.", expected: [eps("$1.08", 1.08), eps("$1.05", 1.05)] },
    { source: "nvidia", text: "During the first half of fiscal 2026, NVIDIA returned $24.3 billion to shareholders in the form of shares repurchased and cash dividends.", expected: [period("first half of fiscal 2026", { value: 2026 }), money("$24.3 billion", 24300000000)] },
    { source: "nvidia", text: "NVIDIA will pay its next quarterly cash dividend of $0.01 per share on October 2, 2025, to all shareholders of record on September 11, 2025.", expected: [eps("$0.01 per share", 0.01), date("October 2, 2025"), date("September 11, 2025")] },
    { source: "nvidia", text: "Revenue is expected to be $54.0 billion, plus or minus 2%.", expected: [money("$54.0 billion", 54000000000), pct("2%", 2)] },
    { source: "nvidia", text: "GAAP and non-GAAP gross margins are expected to be 73.3% and 73.5%, respectively, plus or minus 50 basis points.", expected: [pct("73.3%", 73.3), pct("73.5%", 73.5), bps("50 basis points", 50)] },
    { source: "nvidia", text: "Q2 Fiscal 2026 Summary", expected: [period("Q2 Fiscal 2026", { value: 2026 })] },
    { source: "nvidia", text: "11.9 pts", expected: [pct("11.9 pts", 11.9)] },
    { source: "nvidia", text: "(2.7) pts", expected: [pct("(2.7) pts", -2.7, { isNegative: true })] },
    { source: "nvidia", text: "$46,743", expected: [money("$46,743", 46743)] },
    { source: "nvidia", text: "2788 San Tomas Expressway, Santa Clara, Calif. 95051", expected: [junk("2788", "address"), junk("95051", "postcode")] },
    { source: "nvidia", text: "There were no H20 sales to China-based customers in the second quarter.", expected: [junk("H20", "model"), period("second quarter")] },

    // ---- Real sentences: Apple Q4 FY25 release ----
    {
      source: "apple",
      text: "CUPERTINO, CALIFORNIA Apple today announced financial results for its fiscal 2025 fourth quarter ended September 27, 2025.",
      expected: [period("fiscal 2025"), period("fourth quarter"), date("September 27, 2025")],
    },
    // The same patterns as the rest of that release, in our own words: "percent" spelled out,
    // "year over year", EPS named before the figure, and a footnote stuck to the full stop.
    { source: "synthetic", text: "Quarterly revenue was $9.4 billion, up 8 percent year over year.", expected: [money("$9.4 billion", 9400000000), pct("8 percent", 8), period("year over year")] },
    {
      source: "synthetic",
      text: "Diluted earnings per share was $2.15, up 13 percent year over year on an adjusted basis.1",
      expected: [eps("$2.15", 2.15), pct("13 percent", 13), period("year over year"), junk("1", "footnote")],
    },
    {
      source: "apple",
      text: "Apple’s board of directors has declared a cash dividend of $0.26 per share of the Company’s common stock.",
      expected: [eps("$0.26 per share", 0.26)],
    },
    {
      source: "synthetic",
      text: "The dividend is payable on May 14, 2026 to shareholders of record as of the close of business on May 11, 2026.",
      expected: [date("May 14, 2026"), date("May 11, 2026")],
    },
    {
      source: "apple",
      text: "Apple will provide live streaming of its Q4 2025 financial results conference call beginning at 2:00 p.m. PT on October 30, 2025 at apple.com/investor/earnings-call.",
      expected: [period("Q4 2025"), junk("2:00 p.m. PT", "time"), date("October 30, 2025")],
    },
    { source: "apple", text: "“Our September quarter results capped off a record fiscal year, with revenue reaching $416 billion, as well as double-digit EPS growth,” said Kevan Parekh.", expected: [money("$416 billion", 416000000000)] },
    { source: "apple", text: "© 2025 Apple Inc. All rights reserved.", expected: [{ raw: "2025", type: "year", junk: true, junkReason: "copyright" }] },
    { source: "apple", text: "The iPhone 17 lineup and Apple Watch Series 11 drove sales.", expected: [junk("iPhone 17", "model"), junk("Apple Watch Series 11", "model")] },

    // ---- Real sentences: Wikipedia and BBC ----
    { source: "wikipedia", text: "US$215.9 billion (FY26)", expected: [money("US$215.9 billion", 215900000000, { currency: "USD" }), period("FY26")] },
    { source: "wikipedia", text: "42,000 (FY26)", expected: [count("42,000", 42000), period("FY26")] },
    { source: "wikipedia", text: "With $40,000 in the bank (equivalent to $89,000 in 2025), the company was born.", expected: [money("$40,000", 40000), junk("equivalent to $89,000 in 2025", "inflation")] },
    { source: "wikipedia", text: "As of January 7, 2025, Nvidia's $3.66 trillion market cap was worth more than double.", expected: [date("January 7, 2025"), money("$3.66 trillion", 3660000000000)] },
    { source: "wikipedia", text: "Nvidia GeForce RTX 2080 Ti, part of the RTX 20 series, uses 256 KB of L2 cache.", expected: [junk("GeForce RTX 2080 Ti", "model"), junk("RTX 20", "model"), count("256", 256), junk("L2", "model")] },
    { source: "bbc", text: "There are about 12,250 data centres around the world, according to Data Center Map.", expected: [count("12,250", 12250)] },
    { source: "bbc", text: "This year, the tech industry is expected to spend a combined $765bn (£544bn) on AI infrastructure.", expected: [money("$765bn", 765000000000), money("£544bn", 544000000000, { currency: "GBP" })] },
    { source: "bbc", text: "Some 16 US states have proposed laws to ban or temporarily block new facilities.", expected: [count("16", 16)] },
  ];

  const split = [
    { text: "Revenue was $1.42 billion. Profit rose.", expected: ["Revenue was $1.42 billion.", "Profit rose."] },
    { text: "EPS of $1.42 beat estimates. Shares rose 3.5%.", expected: ["EPS of $1.42 beat estimates.", "Shares rose 3.5%."] },
    { text: "Apple Inc. Reported results today. Sales rose.", expected: ["Apple Inc. Reported results today.", "Sales rose."] },
    { text: "The U.S. Commerce Department said so. Shares fell.", expected: ["The U.S. Commerce Department said so.", "Shares fell."] },
    { text: "J.P. Morgan raised its target. The stock rose.", expected: ["J.P. Morgan raised its target.", "The stock rose."] },
    { text: "Revenue rose 8% vs. A year ago it fell. Margins improved.", expected: ["Revenue rose 8% vs. A year ago it fell.", "Margins improved."] },
    { text: "Costs, e.g. Freight, rose. Profit fell.", expected: ["Costs, e.g. Freight, rose.", "Profit fell."] },
    { text: "Approx. 40 stores closed. More will follow.", expected: ["Approx. 40 stores closed.", "More will follow."] },
    { text: "Mr. Huang spoke. Ms. Kress followed.", expected: ["Mr. Huang spoke.", "Ms. Kress followed."] },
    { text: "Dr. Lee joined on Jan. 5. She leads R&D.", expected: ["Dr. Lee joined on Jan. 5.", "She leads R&D."] },
    { text: "Lilypad Holdings Corp. Ltd. Co. Grew sales.", expected: ["Lilypad Holdings Corp. Ltd. Co. Grew sales."] },
    { text: "Wow! Sales doubled. Really?", expected: ["Wow!", "Sales doubled.", "Really?"] },
    { text: "He said \"Revenue grew.\" The board agreed.", expected: ["He said \"Revenue grew.\"", "The board agreed."] },
    { text: "Results beat forecasts. \"We are pleased,\" the CEO said.", expected: ["Results beat forecasts.", "\"We are pleased,\" the CEO said."] },
    { text: "$482.6", expected: ["$482.6"] },
    { text: "Revenue of $482.6 million, up 14.2%", expected: ["Revenue of $482.6 million, up 14.2%"] },
    { text: "", expected: [] },
    { text: "Sales rose 5%. 12 stores opened.", expected: ["Sales rose 5%.", "12 stores opened."] },
    { text: "The No. 1 seller grew. Others lagged.", expected: ["The No. 1 seller grew.", "Others lagged."] },
    { text: "The call starts at 5:00 p.m. Eastern Time. A replay follows.", expected: ["The call starts at 5:00 p.m. Eastern Time.", "A replay follows."] },
    { text: "Revenue reached $1.2 billion in the U.K. Last year it was lower.", expected: ["Revenue reached $1.2 billion in the U.K. Last year it was lower."] },
    { text: "Ford Motor Co. announced plans. Then GM followed.", expected: ["Ford Motor Co. announced plans.", "Then GM followed."] },
    { text: "Shares of J.P. Morgan Chase & Co. Rose 2%. Banks rallied.", expected: ["Shares of J.P. Morgan Chase & Co. Rose 2%.", "Banks rallied."] },
    {
      text: "Lilypad Holdings, Inc. (NASDAQ: LILY) announced results for the quarter ended September 30, 2026. Revenue rose to $482.6 million.",
      expected: ["Lilypad Holdings, Inc. (NASDAQ: LILY) announced results for the quarter ended September 30, 2026.", "Revenue rose to $482.6 million."],
    },
    { text: "Diluted earnings per share were $1.27, ahead of the $1.12 reported a year earlier. Gross margin expanded.", expected: ["Diluted earnings per share were $1.27, ahead of the $1.12 reported a year earlier.", "Gross margin expanded."] },
  ];

  const cases = { detect, split };
  if (typeof window !== "undefined") window.FrogbotTestCases = cases;
  if (typeof module !== "undefined" && module.exports) module.exports = cases;
})();
