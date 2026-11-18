# Frogbot export formats

The stat card has two downloads with the same rows and columns:

- **Download Excel** (the main button) saves `frogbot-<site>-<yyyy-mm-dd>.xlsx`, a workbook laid
  out for reading: figures display as they do on the card, dates are real dates, and the header
  is frozen with filters on. See [The Excel export](#the-excel-export).
- **Download CSV** (the smaller link beside it) saves `frogbot-<site>-<yyyy-mm-dd>.csv` in CSV
  format version 1: plain values for scripts and databases. Every column is described below.

# CSV format, version 1

## The file

- UTF-8 with a byte-order mark (so Excel shows £, € and – correctly), CRLF line endings, a
  header row, and one row per caught figure.
- Fields holding a comma, a double quote or a line break are wrapped in double quotes, with any
  quotes inside doubled (`"Sales, ""core"" – UK"`). This is standard CSV (RFC 4180).
- Row order: the card's main table, including the rows behind "Show all", in the card's order;
  then the "Also caught" figures.
- A blank field means "not known" or "doesn't apply". Frogbot leaves a field blank rather than
  guess.
- Numeric columns (`value`, `low`, `high`, `change_value`, `prior_value`) are plain numbers
  with no currency symbols, thousands separators, units or exponents (`482600000`, `14.2`,
  `1.24`, `-3`), so spreadsheets read them as numbers.
- Columns keep their names and meaning within a format version. New columns are only ever
  added at the end; any other change bumps `format_version`.

## Columns

| # | Column | Meaning | Example | Can be blank? |
| --- | --- | --- | --- | --- |
| 1 | `format_version` | The version of this format. | `1` | No |
| 2 | `company` | The company the figure is about: the one its own sentence names with a ticker ("Meta Platforms (META) earnings…"), else the page's company. The page's company comes from a company infobox (Wikipedia's "Traded as" row, with the infobox's name or the article title), an exchange ticker in the text ("NVIDIA (NASDAQ: NVDA)"), the page's structured data, or a "<Company> reports … results" title. Blank when the page names several companies equally (a market round-up) or none. | `NVIDIA` | Yes |
| 3 | `ticker` | The company's stock ticker, found the same way, without the exchange. | `NVDA` | Yes |
| 4 | `metric` | The metric on its own, without qualifiers. One of the standard names (Revenue, Gross profit, Operating income, EBITDA, EBIT, Net income, EPS, Gross margin, Operating margin, Net margin, Free cash flow, Operating cash flow, Cash, Debt, Net debt, Net cash, …). Blank when no metric was found (`label_confidence` is then `low`; the card shows a snippet of the text instead, and `source_text` holds the sentence). | `Operating income` | Yes (no metric found) |
| 5 | `qualifiers` | What narrows the metric, separated by semicolons: GAAP / non-GAAP, adjusted, diluted, organic, a segment name, a table title. | `non-GAAP;diluted` | Yes |
| 6 | `figure` | The figure as the card shows it, with its symbol and scale, and a range or tolerance where there is one. | `$46.7B` | No |
| 7 | `value` | The figure as a plain number in its unit: money in whole currency units, percentages as the percentage (`14.2` for 14.2%), per-share amounts in currency units. Blank for a range: its midpoint never appears on the page, so `low` and `high` hold the ends instead. | `46700000000` | Yes (a range) |
| 8 | `unit` | What `value` measures: `money`, `percent`, `basis_points`, `percentage_points`, `per_share`, `multiple` or `count`. | `money` | No |
| 9 | `currency` | ISO 4217 code for money and per-share figures. | `USD` | Yes (not money) |
| 10 | `low` | The low end of a range ("$505 million to $525 million"), as a plain number. | `505000000` | Yes (not a range) |
| 11 | `high` | The high end of a range, as a plain number. | `525000000` | Yes (not a range) |
| 12 | `role` | What kind of figure it is: `level` (an amount for a period), `change` (a rise or fall, shown standalone), `guidance` (the company's own forecast) or `estimate` (analysts' or consensus figures). | `level` | No |
| 13 | `period` | The period as the page writes it. | `Q2 FY26` | Yes |
| 14 | `period_end_date` | The last day of the period, as `YYYY-MM-DD`, when the page states it ("quarter ended July 27, 2025", "Three Months Ended July 27, 2025"). | `2025-07-27` | Yes |
| 15 | `period_inferred` | `true` when the period wasn't stated near the figure and was taken from the page's most common period; else `false`. | `false` | No |
| 16 | `label_confidence` | How sure Frogbot is of the metric: `high` (a table row header, or a finance term in the figure's own clause), `medium` (with qualifiers or a segment, borrowed from an earlier clause, or guidance), `low` (a snippet). | `high` | No |
| 17 | `period_confidence` | How sure Frogbot is of the period: `high` (same clause), `medium` (same sentence, table column, list intro or heading), `low` (inferred from the page). | `medium` | Yes (no period) |
| 18 | `change_value` | The change linked to this figure, as a plain number in `change_unit`, signed by direction: negative for a fall, `0` when unchanged. | `-3.5` | Yes (no linked change) |
| 19 | `change_unit` | The unit of `change_value`: usually `percent`, sometimes `basis_points`, `percentage_points` or `money`. | `percent` | Yes |
| 20 | `direction` | `up`, `down` or `flat`, when the page makes it plain. | `up` | Yes |
| 21 | `prior_value` | In a table with current and earlier period columns, the earlier figure this one is compared with, as a plain number in `unit`. | `19937000000` | Yes |
| 22 | `prior_period` | The period of `prior_value`, as the page writes it. | `Q2 FY25` | Yes |
| 23 | `vs_estimate` | `above` or `below` when the page says the figure beat or missed estimates. | `above` | Yes |
| 24 | `source_text` | The sentence or table row the figure came from (up to 200 characters, spaces collapsed). | `NVIDIA today reported revenue for the second quarter…` | No |
| 25 | `page_url` | The address of the page. | `https://nvidianews.nvidia.com/news/…` | No |
| 26 | `published_date` | When the page was published, as `YYYY-MM-DD`: from its `article:published_time` meta tag, its structured data's `datePublished`, a `<time datetime>` by the headline, or a date on its own line by the headline. Always blank on Wikipedia (see below). | `2025-08-27` | Yes |
| 27 | `captured_at` | When the CSV was saved, as an ISO 8601 UTC timestamp. | `2026-11-02T09:14:03.512Z` | No |

## The Excel export

The .xlsx file is built in the browser by `content/xlsx.js`, a small hand-written writer (an
.xlsx file is a zip of XML parts): no library, no network, nothing loaded from elsewhere. It has
one sheet, "Frogbot", with the same rows as the CSV, in the same order.

- **Columns**: the CSV v1 columns, with the same names and in the same order, apart from
  `figure`, which the Excel sheet doesn't have: its `value`, `low` and `high` cells display the
  figure instead.
- **Figures** are numbers, each with its own number format, so they display like the card but
  still add up, sort and filter as numbers:

  | Unit | Stored | Displays as |
  | --- | --- | --- |
  | money | 482600000 | $482.6M (B and T for billions and trillions; under a million in full, as $450,000), with the figure's own currency symbol: $, £, €, ¥, ₹, C$, A$, HK$ |
  | per_share | 1.24 | $1.24 |
  | percent | 0.142 | 14.2% (Excel stores percentages as fractions, so 14.2% is 0.142; the CSV writes 14.2) |
  | basis_points | 40 | 40 bps |
  | percentage_points | 1.4 | +1.4 pts (always signed: points are a change) |
  | multiple | 2.5 | 2.5x |
  | count | 1250 | 1250 |

  The number of decimal places follows the card ("$54.0B" keeps its decimal), a fall shows the
  card's "−" sign, and a signed change ("+19.1%") keeps its "+". A guidance tolerance ("±2%") is
  not part of the number; it's in `source_text`.
- **Ranges**: `value` is blank, and `low` and `high` each hold one end, formatted the same way.
- **change_value**: a number formatted to match `change_unit` (a percent, basis points or an
  amount), negative for a fall, as in the CSV.
- **prior_value**: formatted like `value`.
- **Dates**: `period_end_date` and `published_date` are Excel dates shown as `yyyy-mm-dd`;
  `captured_at` is an Excel date and time (`yyyy-mm-dd hh:mm:ss`, in UTC).
- `format_version` is the number 1. Every other column is text, exactly as in the CSV.
- **Layout**: a bold header row, frozen so it stays in view, with filters on every column.
  Column widths fit their longest entry (up to 40 characters); `source_text` is 60 characters
  wide and wraps.

## Notes

- `company` and `ticker` are about the figure, not the publisher: a news site's own name is
  never used.
- Wikipedia's structured data gives the date the article was first created as `datePublished`
  (2002 for Nvidia's article), which says nothing about when its figures were written, and the
  article is edited continuously after that. So `published_date` is left blank on Wikipedia
  pages (recognised by their address, or by the MediaWiki generator tag on a saved copy).
- On Wikipedia, the company and ticker come from the infobox's "Traded as" row ("Nasdaq: NVDA";
  the first ticker when there are several share classes) and the infobox's name. Reading the
  row for this doesn't change what Frogbot scores: the infobox's cells are scored like any other
  table cells, as they were before.
- Copy table on the card copies the main table as tab-separated text with the columns Company,
  Metric, Figure, Change, Direction and Period, values as displayed, for pasting into a
  spreadsheet by hand. The CSV is the format for anything automated.
