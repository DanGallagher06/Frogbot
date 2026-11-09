"""Checks for Frogbot's .xlsx exports, used by test_card_actions.py and runnable on its own.

    uv run --with openpyxl python tests/browser/xlsx_check.py file.xlsx [...]

- structure(path): the zip and every XML part parse, every part has a content type, every
  relationship points at a part that exists, cells are in order, and every style a cell uses
  exists. Returns a list of problems (empty when it's sound).
- read(path): the sheet through openpyxl: header, rows (values and number formats), column
  widths, frozen pane, filter range, header bold.
- excel(path): opens the file in Microsoft Excel (when it's installed) and returns each cell's
  displayed text, and whether Excel had to repair the file (it writes a repair log to %TEMP%).
  Returns None without Excel.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n, int(ref[len(letters):])


def structure(path):
    problems = []
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        return [f"not a zip: {e}"]
    bad = z.testzip()
    if bad:
        problems.append(f"bad CRC in {bad}")
    names = set(z.namelist())
    trees = {}
    for name in names:
        try:
            trees[name] = ET.fromstring(z.read(name))
        except ET.ParseError as e:
            problems.append(f"{name}: XML doesn't parse ({e})")
    if problems:
        return problems
    types = trees.get("[Content_Types].xml")
    if types is None:
        return ["no [Content_Types].xml"]
    defaults = {d.get("Extension") for d in types.iter(f"{CT}Default")}
    overrides = {o.get("PartName").lstrip("/") for o in types.iter(f"{CT}Override")}
    for name in names - {"[Content_Types].xml"}:
        if name not in overrides and name.rsplit(".", 1)[-1] not in defaults:
            problems.append(f"{name}: no content type")
    for o in overrides - names:
        problems.append(f"content type for a missing part: {o}")
    for name in [n for n in names if n.endswith(".rels")]:
        base = name.replace("_rels/", "").replace(".rels", "")
        folder = base.rsplit("/", 1)[0] + "/" if "/" in base else ""
        for rel in trees[name].iter(f"{REL}Relationship"):
            target = os.path.normpath(folder + rel.get("Target")).replace("\\", "/")
            if target not in names:
                problems.append(f"{name}: relationship to a missing part {target}")
    sheets = sorted(n for n in names if n.startswith("xl/worksheets/sheet"))
    styles = trees.get("xl/styles.xml")
    if not sheets or styles is None:
        return problems + ["missing sheet or styles"]
    xfs = styles.find(f"{S}cellXfs")
    if int(xfs.get("count")) != len(xfs):
        problems.append("cellXfs count doesn't match")
    fmts = styles.find(f"{S}numFmts")
    fmt_ids = {int(f.get("numFmtId")) for f in fmts} if fmts is not None else set()
    if fmts is not None and int(fmts.get("count")) != len(fmts):
        problems.append("numFmts count doesn't match")
    for xf in xfs:
        n = int(xf.get("numFmtId"))
        if n >= 164 and n not in fmt_ids:
            problems.append(f"cell format uses a missing number format {n}")
    for name in sheets:
        problems += _sheet_problems(name, trees[name], len(xfs))
    return problems


def _sheet_problems(name, sheet, style_count):
    problems = []
    # Worksheet children must come in the schema's order.
    order = ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "autoFilter", "dataValidations", "pageMargins"]
    seen = [child.tag.replace(S, "") for child in sheet]
    if [t for t in order if t in seen] != [t for t in seen if t in order]:
        problems.append(f"{name}: worksheet elements out of order: {seen}")
    validations = sheet.find(f"{S}dataValidations")
    if validations is not None and int(validations.get("count")) != len(validations):
        problems.append(f"{name}: dataValidations count doesn't match")
    last_row = 0
    for row in sheet.iter(f"{S}row"):
        r = int(row.get("r"))
        if r <= last_row:
            problems.append(f"{name}: row {r} out of order")
        last_row = r
        last_col = 0
        for c in row:
            col, cr = _col_index(c.get("r"))
            if cr != r or col <= last_col:
                problems.append(f"{name}: cell {c.get('r')} out of order in row {r}")
            last_col = col
            s = int(c.get("s", 0))
            if s >= style_count:
                problems.append(f"{name}: cell {c.get('r')} uses a missing style {s}")
            if c.get("t") is None and c.find(f"{S}v") is not None:
                float(c.find(f"{S}v").text)  # numbers must be numbers
    return problems


def read(path):
    import openpyxl

    wb = openpyxl.load_workbook(path)
    ws = wb.worksheets[0]
    header = [c.value for c in ws[1]]
    rows = []
    for row in ws.iter_rows(min_row=2):
        rows.append({header[i]: {"value": c.value, "format": c.number_format, "type": c.data_type} for i, c in enumerate(row)})
    widths = {header[i]: ws.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width for i in range(len(header))}
    return {
        "header": header,
        "rows": rows,
        "widths": widths,
        "freeze": ws.freeze_panes,
        "filter": ws.auto_filter.ref,
        "dimensions": ws.dimensions,
        "headerBold": all(c.font.b for c in ws[1]),
        "wrap": {header[i]: bool(ws.cell(2, i + 1).alignment.wrap_text) for i in range(len(header))} if ws.max_row > 1 else {},
    }


EXCEL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$before = @(Get-ChildItem -Path $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$x = New-Object -ComObject Excel.Application
$x.DisplayAlerts = $false
$x.Visible = $false
try {
  $wb = $x.Workbooks.Open($args[0], 0, $true)
  $ws = $wb.Worksheets.Item(1)
  $used = $ws.UsedRange
  $out = @()
  for ($r = 1; $r -le $used.Rows.Count; $r++) {
    $row = @()
    for ($c = 1; $c -le $used.Columns.Count; $c++) { $row += [string]$ws.Cells.Item($r, $c).Text }
    $out += ,$row
  }
  $info = @{ rows = $out; filter = [bool]$ws.AutoFilterMode; frozen = [bool]$x.ActiveWindow.FreezePanes; splitRow = $x.ActiveWindow.SplitRow }
  $wb.Close($false)
} finally { $x.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($x) }
$after = @(Get-ChildItem -Path $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$info.repaired = @($after | Where-Object { $before -notcontains $_ }).Count -gt 0
$info | ConvertTo-Json -Depth 5 -Compress
"""


def excel(path):
    """Each cell's text as Excel displays it, or None when Excel isn't installed."""
    if sys.platform != "win32":
        return None
    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8-sig") as f:
        f.write(EXCEL_SCRIPT)
        script = f.name
    try:
        done = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, str(pathlib.Path(path).resolve())],
                              capture_output=True, text=True, encoding="utf-8", timeout=120)
    finally:
        os.unlink(script)
    if done.returncode != 0 or not done.stdout.strip():
        if "Excel.Application" in done.stderr or "80040154" in done.stderr:
            return None
        raise RuntimeError(done.stderr.strip()[:500])
    data = json.loads(done.stdout)
    rows = data["rows"]
    header = rows[0]
    data["header"] = header
    data["rows"] = [dict(zip(header, r)) for r in rows[1:]]
    return data


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(p, "structure:", structure(p) or "ok")
        info = read(p)
        print("  openpyxl:", {k: info[k] for k in ("freeze", "filter", "dimensions", "headerBold")})
        shown = excel(p)
        if shown is None:
            print("  (no Excel)")
        else:
            print("  excel: repaired", shown["repaired"], "filter", shown["filter"], "frozen", shown["frozen"], "splitRow", shown["splitRow"])
            for row in shown["rows"]:
                print("   ", {k: row[k] for k in ("metric", "value", "low", "high", "change_value", "prior_value", "period_end_date", "captured_at")})
