// Frogbot: a small .xlsx writer for the card's Excel export. Defines window.FrogbotXlsx.
//
// An .xlsx file is a zip of XML parts (Office Open XML, ECMA-376). This writes the fewest parts
// Excel needs for one worksheet: content types, package and workbook relationships, the
// workbook, styles and the sheet. Strings are written inline (no shared-strings part), and the
// zip is "stored" (uncompressed), which every reader accepts. No network, no libraries.
//
// FrogbotXlsx.build({ sheet, columns, rows }) returns the file's bytes (a Uint8Array):
//   sheet:   the worksheet's name
//   columns: [{ header, width, wrap }]: width in characters; wrap wraps long text
//   rows:    [[cell, ...]], one per data row; a cell is null (empty), a string, a number, or
//            { value: number, format: "Excel number format" } or { date: "YYYY-MM-DD" } or
//            { dateTime: "ISO 8601 timestamp" }
// The header row is bold and frozen, with filters on.
(() => {
  if (window.FrogbotXlsx) return;

  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const DATE_FORMAT = "yyyy-mm-dd";
  const DATE_TIME_FORMAT = "yyyy-mm-dd hh:mm:ss";

  // ---- XML ----

  // Escapes text for XML, dropping characters XML 1.0 doesn't allow.
  function esc(text) {
    return String(text)
      .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // "A", "B", ... "Z", "AA", ...
  function columnName(index) {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }

  // Days since Excel's epoch (1899-12-30), as Excel stores dates.
  const EPOCH = Date.UTC(1899, 11, 30);
  function serial(ms) {
    return (ms - EPOCH) / 86400000;
  }
  function dateSerial(text) {
    const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? serial(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  }
  function dateTimeSerial(text) {
    const ms = Date.parse(text || "");
    return Number.isFinite(ms) ? serial(ms) : null;
  }

  // ---- Styles: one cell format (xf) per distinct number format ----

  function styleTable() {
    const formats = []; // custom number formats, ids from 164
    // cellXfs: 0 default, 1 bold header, 2 wrapped text; the rest are number formats.
    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    ];
    const byFormat = new Map();
    return {
      HEADER: 1,
      WRAP: 2,
      forFormat(code) {
        if (!byFormat.has(code)) {
          const id = 164 + formats.length;
          formats.push(`<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`);
          byFormat.set(code, xfs.length);
          xfs.push(`<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`);
        }
        return byFormat.get(code);
      },
      xml() {
        return (
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">` +
          (formats.length ? `<numFmts count="${formats.length}">${formats.join("")}</numFmts>` : "") +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
          '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
          "</styleSheet>"
        );
      },
    };
  }

  // ---- The worksheet ----

  function cellXml(ref, cell, styles, wrap) {
    if (cell == null || cell === "") return "";
    if (typeof cell === "number") return Number.isFinite(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : "";
    if (typeof cell === "object") {
      let value = cell.value;
      let format = cell.format;
      if (cell.date != null) [value, format] = [dateSerial(cell.date), DATE_FORMAT];
      if (cell.dateTime != null) [value, format] = [dateTimeSerial(cell.dateTime), DATE_TIME_FORMAT];
      if (typeof value !== "number" || !Number.isFinite(value)) return "";
      const style = format ? ` s="${styles.forFormat(format)}"` : "";
      return `<c r="${ref}"${style}><v>${value}</v></c>`;
    }
    const text = String(cell);
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    const style = wrap ? ` s="${styles.WRAP}"` : "";
    return `<c r="${ref}"${style} t="inlineStr"><is><t${space}>${esc(text)}</t></is></c>`;
  }

  function sheetXml({ columns, rows }, styles) {
    const last = columnName(columns.length - 1);
    const range = `A1:${last}${rows.length + 1}`;
    const cols = columns
      .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(c.width || 10).toFixed(2)}" customWidth="1"/>`)
      .join("");
    const header =
      `<row r="1">` +
      columns.map((c, i) => `<c r="${columnName(i)}1" s="${styles.HEADER}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join("") +
      "</row>";
    const body = rows
      .map((row, r) => `<row r="${r + 2}">` + row.map((cell, i) => cellXml(`${columnName(i)}${r + 2}`, cell, styles, columns[i] && columns[i].wrap)).join("") + "</row>")
      .join("");
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
      `<dimension ref="${range}"/>` +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      `<cols>${cols}</cols>` +
      `<sheetData>${header}${body}</sheetData>` +
      `<autoFilter ref="${range}"/>` +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      "</worksheet>"
    );
  }

  function parts(spec) {
    const styles = styleTable();
    const sheet = sheetXml(spec, styles); // first, so it registers its number formats
    const name = esc(String(spec.sheet || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
    const range = `$A$1:$${columnName(spec.columns.length - 1)}$${spec.rows.length + 1}`;
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    return [
      [
        "[Content_Types].xml",
        xml +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          "</Types>",
      ],
      [
        "_rels/.rels",
        xml +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ],
      [
        "xl/workbook.xml",
        xml +
          `<workbook xmlns="${NS}" xmlns:r="${REL_NS}">` +
          '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>' +
          `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
          // Excel's own record of the filter range; it's added on save if missing.
          `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!${range}</definedName></definedNames>` +
          "</workbook>",
      ],
      [
        "xl/_rels/workbook.xml.rels",
        xml +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      ],
      ["xl/worksheets/sheet1.xml", sheet],
      ["xl/styles.xml", styles.xml()],
    ];
  }

  // ---- Zip (stored, no compression) ----

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const [name, text] of files) {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true); // made by
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((sum, c) => sum + c.length, 0));
    let at = 0;
    for (const c of all) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  window.FrogbotXlsx = {
    MIME,
    build: (spec) => zip(parts(spec)),
    columnName,
    dateSerial,
  };
})();
