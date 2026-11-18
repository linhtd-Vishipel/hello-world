"""Reconcile every layer of the export pipeline and check the exported files.

    python tools/acceptance/verify.py --samples <dir> --out <accept.js out dir> [--base http://127.0.0.1:8000]

Layers compared: source workbook (read raw with openpyxl, independent of the
app's parser) -> processed data (API) -> dashboard (recorded by accept.js)
-> Excel -> PDF -> Word.

Only libraries already used by the project are needed:
  * Excel: openpyxl + zipfile/XML (structure, sheet names, rows/columns,
    header, number and date formats, totals);
  * PDF: pdfcheck.py (Python standard library only — no Poppler): structure,
    pages, A4 size, embedded fonts, Vietnamese text, blank pages, orphaned
    headings, text inside the margins, page numbering;
  * Word: python-docx + zipfile/XML (structure, relationships, tables fit the
    page, header rows, fonts, Vietnamese text, figures).
Optional extra checks run only when the tool is present, otherwise they are
reported as SKIP (never as PASS): Poppler cross-check of the PDF text, and
LibreOffice rendering of the Word files.
Writes verify_results.json + acceptance_report.md; exit 1 on any FAIL.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

import docx
import httpx
import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdfcheck  # noqa: E402

ROWS = []  # (group, name, status PASS/FAIL/SKIP, detail)


def check(group, name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    ROWS.append((group, name, status, str(detail)))
    print(f"{status} [{group}] {name}" + (f"  — {detail}" if detail else ""))


def skip(group, name, reason):
    """Not run because an OPTIONAL tool is missing. Never counted as PASS."""
    ROWS.append((group, name, "SKIP", str(reason)))
    print(f"SKIP [{group}] {name}  — {reason}")


def vn(v):
    """Format like the dashboard / report: vi-VN, max 2 decimals."""
    if isinstance(v, int) or float(v).is_integer():
        s = f"{int(round(v)):,}"
    else:
        s = f"{v:,.2f}".rstrip("0").rstrip(".")
    return s.replace(",", "\0").replace(".", ",").replace("\0", ".")


def parse_vn(s):
    s = s.strip().replace("\u00a0", " ")
    mult = 1
    for suf, m in ((" T", 1e9), (" Tr", 1e6), (" N", 1e3)):
        if s.endswith(suf):
            s, mult = s[: -len(suf)], m
    return float(s.replace(".", "").replace(",", ".")) * mult


def run(*cmd):
    # Optional Poppler cross-check only. UTF-8, never the Windows ANSI code page.
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


class block:
    """Run one group of checks; an exception becomes a FAIL instead of
    aborting the whole verification (e.g. a file missing because a UI step failed)."""

    def __init__(self, group, name):
        self.group, self.name = group, name

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            return False
        check(self.group, f"{self.name}: không thực hiện được", False, f"{et.__name__}: {str(ev)[:200]}")
        traceback.print_exception(et, ev, tb, file=sys.stderr)
        return True


def one(out, pattern):
    files = sorted(glob.glob(str(out / pattern)))
    if not files:
        raise FileNotFoundError(f"không có file {pattern} (bước tải trong 04 bị lỗi?)")
    return files[-1]


# ---------------------------------------------------------------------------
# Source of truth (raw workbook)
# ---------------------------------------------------------------------------


def source_rows(path, sheet, header_row):
    ws = openpyxl.load_workbook(path, data_only=True)[sheet]
    header = [c.value for c in ws[header_row]]
    rows = []
    for r in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if r[0] is None or (isinstance(r[0], str) and r[0].startswith("Tổng")):
            continue
        rows.append(list(r))
    return header, rows


# ---------------------------------------------------------------------------
# Office Open XML package (xlsx / docx) — zipfile + XML only
# ---------------------------------------------------------------------------


def package_check(group, path, required):
    """ZIP integrity, every XML part well-formed, required parts present, internal
    relationships point to existing parts."""
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        names = set(z.namelist())
        broken_xml = []
        for n in names:
            if n.endswith((".xml", ".rels")):
                try:
                    ET.fromstring(z.read(n))
                except ET.ParseError as exc:
                    broken_xml.append(f"{n}: {exc}")
        missing = [r for r in required if r not in names]
        dangling = []
        for n in names:
            if not n.endswith(".rels"):
                continue
            base = n.replace("_rels/", "").rsplit(".rels", 1)[0]
            folder = base.rsplit("/", 1)[0] if "/" in base else ""
            for rel in ET.fromstring(z.read(n)):
                if rel.get("TargetMode") == "External":
                    continue
                target = rel.get("Target", "")
                full = target.lstrip("/") if target.startswith("/") else os.path.normpath(f"{folder}/{target}").replace("\\", "/").lstrip("./")
                if full not in names:
                    dangling.append(f"{n} -> {target}")
    check(group, "Cấu trúc file hợp lệ (ZIP, XML, thành phần bắt buộc, liên kết nội bộ)",
          bad is None and not broken_xml and not missing and not dangling,
          f"{len(names)} thành phần" + "".join(f"; {k}: {v[:3]}" for k, v in
                                                 (("ZIP hỏng", [bad] if bad else []), ("XML lỗi", broken_xml),
                                                  ("thiếu", missing), ("liên kết hỏng", dangling)) if v))
    return names


XLSX_REQUIRED = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml"]
DOCX_REQUIRED = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]


def expected_sheet_names(chart_titles, detail=True):
    used, names = set(), []

    def name(base):
        base = re.sub(r"[\[\]:*?/\\]", " ", base).strip()[:31] or "Sheet"
        n, i = base, 2
        while n.lower() in used:
            suffix = f" ({i})"
            n = base[: 31 - len(suffix)] + suffix
            i += 1
        used.add(n.lower())
        return n

    names.append(name("Tổng quan"))
    for i, t in enumerate(chart_titles, start=1):
        names.append(name(f"TK{i:02d} {t}"))
    if detail:
        names.append(name("Dữ liệu chi tiết"))
    return names


def xlsx_detail_check(group, path, rows, cols, header=None):
    package_check(group, path, XLSX_REQUIRED)
    wb = openpyxl.load_workbook(path)
    ws = wb["Dữ liệu chi tiết"]
    n_rows = sum(1 for r in ws.iter_rows(min_row=5, values_only=True) if any(v is not None for v in r))
    n_cols = sum(1 for c in ws[4] if c.value is not None)
    check(group, "Số dòng và số cột của bảng chi tiết", n_rows == rows and n_cols == cols, f"{n_rows} dòng × {n_cols} cột")
    if header is not None:
        check(group, "Tiêu đề bảng đúng như file gốc", [c.value for c in ws[4]][:cols] == header, [c.value for c in ws[4]][:cols])
    check(group, "Hàng tiêu đề định dạng + cố định + bộ lọc", ws["A4"].font.bold and ws.freeze_panes == "A5"
          and ws.auto_filter.ref == f"A4:{openpyxl.utils.get_column_letter(cols)}{4 + rows}",
          f"freeze {ws.freeze_panes}, filter {ws.auto_filter.ref}")
    return wb, ws


# ---------------------------------------------------------------------------
# PDF — pdfcheck (standard library), no Poppler
# ---------------------------------------------------------------------------

MARGIN_PT = 14 * 72 / 25.4  # report margin (14 mm)
HEADING_RE = re.compile(r"^\s*\d+\.(\d+\.)?\s+\S")
A4 = {(595, 842), (842, 595)}
LAYOUT_CHECKS = ["Cấu trúc PDF hợp lệ (header, xref, %%EOF)", "Mở được, có trang", "Khổ giấy A4", "Font được nhúng",
                 "Không có trang trắng", "Tiêu đề mục không bị tách khỏi nội dung", "Không có chữ tràn lề / bị cắt"]


def pdf_layout(group, path, margin=MARGIN_PT, expect_footer=True):
    pdf = pdfcheck.Pdf(path)
    check(group, LAYOUT_CHECKS[0], pdf.header_ok and pdf.xref_ok and pdf.eof_ok and pdf.size > 1000,
          f"PDF {pdf.version}, {pdf.size // 1024} KB")
    n = len(pdf.pages)
    check(group, LAYOUT_CHECKS[1], n > 0, f"{Path(path).name}: {n} trang")
    sizes = {(round(p.width), round(p.height)) for p in pdf.pages}
    check(group, LAYOUT_CHECKS[2], sizes <= A4, ", ".join(f"{w}×{h} pt" for w, h in sorted(sizes)))
    fonts = pdf.all_fonts()
    not_emb = [f.name for f in fonts if not f.embedded]
    check(group, LAYOUT_CHECKS[3], fonts and not not_emb,
          ", ".join(sorted({f.name.split("+")[-1] for f in fonts})) + (f"; KHÔNG nhúng: {not_emb}" if not_emb else ""))
    blank, orphan, numbering, over = [], [], [], []
    for i, page in enumerate(pdf.pages, start=1):
        lines = page.lines()
        body = [l for l in lines if "Trang " not in l and "Lập lúc" not in l] if expect_footer else lines
        if expect_footer and not any(f"Trang {i}/{n}" in l for l in lines):
            numbering.append(i)
        if not body and not page.images:
            blank.append(i)
        elif body and HEADING_RE.match(body[-1]) and i < n:
            orphan.append(f"tr.{i}: {body[-1].strip()[:50]}")
        for r in page.runs:
            if r.text.strip() and (r.x0 < margin - 3 or r.x1 > page.width - margin + 3 or r.y < 5 or r.y > page.height - 5):
                over.append(f"tr.{i}: {r.text.strip()[:25]}")
    check(group, LAYOUT_CHECKS[4], not blank, f"trang trắng: {blank}" if blank else "")
    check(group, LAYOUT_CHECKS[5], not orphan, "; ".join(orphan))
    if expect_footer:
        check(group, "Đánh số 'Trang x/y' đúng trên mọi trang", not numbering, f"thiếu ở trang {numbering}" if numbering else f"{n}/{n}")
    check(group, LAYOUT_CHECKS[6], not over, f"{len(over)} đoạn tràn: {over[:5]}" if over else "")
    return pdfcheck.text(pdf), pdf


def poppler_crosscheck(group, path):
    """OPTIONAL: compare pdfcheck with Poppler. SKIP when Poppler is not installed."""
    names = ["Đối chiếu chéo với Poppler: số trang", "Đối chiếu chéo với Poppler: toàn bộ ký tự"]
    if not shutil.which("pdftotext") or not shutil.which("pdfinfo"):
        for nme in names:
            skip(group, nme, "Poppler không có trên máy (công cụ tùy chọn, không bắt buộc)")
        return
    pdf = pdfcheck.Pdf(path)
    pages = int(re.search(r"Pages:\s+(\d+)", run("pdfinfo", path)).group(1))
    check(group, names[0], pages == len(pdf.pages), f"pdfcheck {len(pdf.pages)} / Poppler {pages}")

    def chars(t):  # Poppler removes the hyphen when it re-joins a word wrapped at '-': ignore '-'
        return "".join(unicodedata.normalize("NFC", t.replace("\u00a0", " ")).split()).replace("-", "")
    a, b = chars(pdfcheck.text(pdf)), chars(run("pdftotext", "-nopgbrk", path, "-"))
    check(group, names[1], sorted(a) == sorted(b), f"{len(a)} ký tự")


# ---------------------------------------------------------------------------
# Word — python-docx + XML, no LibreOffice
# ---------------------------------------------------------------------------

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_text(path):
    d = docx.Document(path)
    paras = "\n".join(p.text for p in d.paragraphs)
    tables = [[[c.text for c in r.cells] for r in t.rows] for t in d.tables]
    return d, paras, tables


def docx_structure(group, path, min_rows_header=20):
    """Layout guarantees that do not need an office suite to render the file."""
    package_check(group, path, DOCX_REQUIRED)
    d = docx.Document(path)
    # Which section each table belongs to: a paragraph carrying w:sectPr ends a section.
    usable = [s.page_width - s.left_margin - s.right_margin for s in d.sections]
    idx, too_wide, no_header, tables = 0, [], [], 0
    for el in d.element.body.iterchildren():
        if el.tag == W + "p" and el.find(f"{W}pPr/{W}sectPr") is not None:
            idx += 1
        elif el.tag == W + "tbl":
            tables += 1
            grid = el.find(W + "tblGrid")
            width = sum(int(g.get(W + "w", 0)) for g in grid.findall(W + "gridCol")) * 635 if grid is not None else 0
            sect = min(idx, len(usable) - 1)
            if width > usable[sect] + 0.05 * 360000:
                too_wide.append(f"bảng {tables}: {width / 360000:.1f} > {usable[sect] / 360000:.1f} cm")
            rows = el.findall(W + "tr")
            if len(rows) > min_rows_header and rows[0].find(f"{W}trPr/{W}tblHeader") is None:
                no_header.append(f"bảng {tables}")
    check(group, "Mọi bảng nằm trong lề trang (không tràn ra ngoài khổ giấy)", not too_wide,
          f"{tables} bảng" + (f"; tràn: {too_wide[:3]}" if too_wide else ""))
    check(group, "Bảng dài lặp lại hàng tiêu đề ở mỗi trang", not no_header, f"thiếu: {no_header}" if no_header else "")
    widths = [c.width for t in d.tables for c in t.columns if c.width]
    narrow = min(widths) / 360000 if widths else 0
    check(group, "Mọi cột bảng rộng ≥ 1,2 cm (chữ không bị xuống dòng từng ký tự)", narrow >= 1.2, f"cột hẹp nhất {narrow:.2f} cm")
    kwn = all(d.styles[n].paragraph_format.keep_with_next for n in ("Heading 1", "Heading 2"))
    check(group, "Tiêu đề mục luôn đi cùng nội dung (keep with next)", kwn)
    check(group, "Font Arial có sẵn trên Windows (hỗ trợ tiếng Việt)", d.styles["Normal"].font.name == "Arial", d.styles["Normal"].font.name)
    text = "\n".join(p.text for p in d.paragraphs)
    check(group, "Tiếng Việt Unicode đọc được", "BÁO CÁO" in text and "Thông tin báo cáo" in text)
    return d


def find_soffice():
    """LibreOffice (OPTIONAL): NGHIEMTHU_SOFFICE, PATH, or the standard Windows install folders."""
    cands = [os.environ.get("NGHIEMTHU_SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice")]
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), r"C:\Program Files", r"C:\Program Files (x86)"):
        if base:
            cands.append(os.path.join(base, "LibreOffice", "program", "soffice.exe"))
    return next((c for c in cands if c and os.path.isfile(c)), None)


def office_to_pdf(path, workdir):
    """OPTIONAL rendering with LibreOffice (private profile; output under the results folder)."""
    soffice = find_soffice()
    if not soffice:
        return None
    workdir = Path(workdir)
    d = workdir / Path(path).stem
    d.mkdir(parents=True, exist_ok=True)
    profile = (workdir / "_ho_so_libreoffice").resolve().as_uri()
    env = {**os.environ, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    subprocess.run([soffice, f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", d, path],
                   capture_output=True, env=env, timeout=600)
    pdfs = glob.glob(os.path.join(str(d), "*.pdf"))
    return pdfs[0] if pdfs else None


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    print("Công cụ tùy chọn: Poppler", "có" if shutil.which("pdftotext") else "KHÔNG có (các kiểm tra chéo sẽ SKIP)",
          "| LibreOffice", "có" if find_soffice() else "KHÔNG có (các kiểm tra dựng trang Word sẽ SKIP)")
    S, OUT = Path(a.samples), Path(a.out)
    t_start = time.time()
    rec = json.loads((OUT / "dashboard_record.json").read_text(encoding="utf-8"))
    api = httpx.Client(base_url=a.base, timeout=120, trust_env=False)
    ctx = {}
    G = "Đồng bộ"
    with block(G, "Tầng 1–3: file gốc → dữ liệu xử lý → Dashboard"):
        check_layers_123(S, rec, api, G, ctx)
    with block(G, "Tầng 4: Excel"):
        check_excel(OUT, ctx, G)
    with block(G, "Tầng 5: PDF"):
        check_pdf(OUT, ctx, G)
    with block(G, "Tầng 6: Word"):
        check_word(OUT, ctx, G)
    with block(G, "Excel không lọc / toàn bộ sheet / từng bảng"):
        check_excel_scopes(OUT, ctx, G)
    with block("Quy tắc Giá", "Quy tắc Giá"):
        check_price_rule(S, OUT, rec)
    check_layouts(S, OUT)
    write_reports(OUT, rec, t_start)


def check_layers_123(S, rec, api, G, ctx):
    header, src = source_rows(S / "SoTheoDoi_DoanhThu_2026.xlsx", "Doanh thu 2026", 4)
    check(G, "1. File gốc: đọc độc lập", len(src) == 1200, f"{len(src)} dòng, bỏ dòng 'Tổng cộng'")
    processed = api.get(f"/api/datasets/{rec['datasetIds']['main']}").json()["sheets"][0]
    prow = processed["rows"]
    same = len(prow) == len(src) and all(
        [datetime.fromisoformat(v) if isinstance(v, str) and j == 1 else v for j, v in enumerate(p)] == s for p, s in zip(prow, src))
    check(G, "2. Dữ liệu sau xử lý == file gốc (từng ô)", same and [c["name"] for c in processed["columns"]] == header, f"{len(prow)} dòng")

    sel = [r for r in src if r[2] == "Cà Mau" and datetime(2026, 3, 1) <= r[1] < datetime(2026, 7, 1)]
    sel_sorted = sorted(sel, key=lambda r: -r[8])
    tt, sl = sum(r[8] for r in sel), sum(r[5] for r in sel)
    dg, ck = sum(r[6] for r in sel) / len(sel), sum(r[7] for r in sel) / len(sel)
    exp_kpi = {"Số dòng": len(sel), "Thành tiền": tt, "Số lượng": sl, "Đơn giá (TB)": dg, "Tỷ lệ chiết khấu (TB)": ck}
    ctx.update(header=header, src=src, sel=sel, sel_sorted=sel_sorted, tt=tt, sl=sl, dg=dg, exp_kpi=exp_kpi, dash=rec["main_filtered"])
    dk = {k["label"]: k for k in rec["main_filtered"]["kpis"]}
    ok = (parse_vn(dk["Số dòng"]["value"]) == len(sel) and f"= {vn(tt)}" in dk["Thành tiền"]["sub"]
          and parse_vn(dk["Số lượng"]["value"]) == sl and abs(parse_vn(dk["Đơn giá (TB)"]["value"]) - dg) / dg < 0.05
          and parse_vn(dk["Tỷ lệ chiết khấu (TB)"]["value"]) == round(ck, 2))
    check(G, "3. Dashboard == file gốc (lọc Cà Mau, 01/03–30/06/2026)", ok, f"{len(sel)} dòng, Thành tiền {vn(tt)}, Số lượng {sl}")


def check_excel(OUT, ctx, G):
    sel, sel_sorted, exp_kpi, dash, header = ctx["sel"], ctx["sel_sorted"], ctx["exp_kpi"], ctx["dash"], ctx["header"]
    path = one(OUT, "main_filtered_xlsx__*.xlsx")
    wb, det = xlsx_detail_check("Excel", path, len(sel), len(header), header)
    expect = expected_sheet_names([c["title"] for c in dash["charts"]])
    check("Excel", "Tên các sheet chính xác", wb.sheetnames == expect, wb.sheetnames)
    rows = [list(r) for r in det.iter_rows(min_row=5, values_only=True)]
    check(G, "4a. Excel: chi tiết == file gốc (từng ô, đúng thứ tự sắp xếp)", rows == sel_sorted, f"{len(rows)} dòng")
    # Number/date formats per column: integers '#,##0', decimals ≤ 2 '#,##0.00', date+time, text General.
    want = {"A": "#,##0", "B": "dd/mm/yyyy hh:mm", "C": "General", "D": "General", "E": "General",
            "F": "#,##0", "G": "#,##0", "H": "#,##0.00", "I": "#,##0"}
    got = {c: det[f"{c}5"].number_format for c in want}
    types_ok = all(isinstance(r[1], datetime) and all(isinstance(r[i], (int, float)) for i in (0, 5, 6, 7, 8)) for r in rows)
    check("Excel", "Định dạng số và ngày tháng đúng từng cột (giá trị là số/ngày thật)", got == want and types_ok,
          ", ".join(f"{c}={v}" for c, v in got.items()))
    ov = {r[0]: r[1:] for r in wb["Tổng quan"].iter_rows(values_only=True) if r[0]}
    okk = all(abs((ov[k][0] or 0) - v) < 1e-6 for k, v in exp_kpi.items())
    check(G, "4b. Excel: chỉ số tổng hợp == tính từ file gốc", okk, {k: ov[k][0] for k in exp_kpi})
    check(G, "4c. Excel: ghi đúng điều kiện lọc", ov.get("Chi nhánh", [None])[0] == "Cà Mau" and "từ 01/03/2026 đến 30/06/2026" in ov.get("Ngày hoá đơn", [""])[0])
    stats = [n for n in wb.sheetnames if n.startswith("TK")]
    mism = []
    for name, ch in zip(stats, dash["charts"]):
        vals = [r for r in wb[name].iter_rows(min_row=5, values_only=True) if r[0] and r[0] != "Tổng cộng"]
        for (lab, val, *_), (dl, dv) in zip(vals, ch["rows"]):
            if lab != dl or abs(val - parse_vn(dv)) > 0.006:
                mism.append(f"{name}: {lab}")
        if len(vals) != len(ch["rows"]):
            mism.append(f"{name}: số nhóm")
    check(G, "4d. Excel: mọi bảng thống kê == Dashboard", len(stats) == len(dash["charts"]) and not mism, f"{len(stats)} bảng" + (f"; lệch: {mism[:3]}" if mism else ""))
    check(G, "4e. Excel: tổng Thành tiền của bảng chi tiết == Dashboard", sum(r[8] for r in rows) == ctx["tt"], vn(sum(r[8] for r in rows)))
    check("Excel", "Định dạng: tiêu đề, AutoFilter, Freeze Panes, độ rộng cột",
          det.freeze_panes == "A5" and det.auto_filter.ref == f"A4:I{4 + len(sel)}" and det["A4"].font.bold
          and all((det.column_dimensions[c].width or 0) >= 8 for c in "ABCDEFGHI") and det["B5"].number_format == "dd/mm/yyyy hh:mm",
          f"freeze {det.freeze_panes}, filter {det.auto_filter.ref}")
    check("Excel", "Mỗi bảng thống kê có biểu đồ Excel + AutoFilter + Freeze", all(len(wb[n]._charts) == 1 and wb[n].auto_filter.ref and wb[n].freeze_panes == "A5" for n in stats))


def check_pdf(OUT, ctx, G):
    sel, sel_sorted, dash, tt, sl, dg = ctx["sel"], ctx["sel_sorted"], ctx["dash"], ctx["tt"], ctx["sl"], ctx["dg"]
    path = one(OUT, "main_filtered_pdf__*.pdf")
    t, pdf = pdf_layout("PDF dài vừa (70 dòng)", path)
    missing_rows = [r[0] for r in sel_sorted if not re.search(rf"(?m)^\s*{re.escape(vn(r[0]))}\s+{r[1]:%d/%m/%Y}.*{re.escape(vn(r[8]))}\s*$", t)]
    check(G, "5a. PDF: đủ từng dòng chi tiết (STT, ngày, thành tiền)", not missing_rows, f"thiếu: {missing_rows[:5]}" if missing_rows else f"{len(sel_sorted)} dòng")
    check(G, "5b. PDF: chỉ số + điều kiện lọc", all(x in t for x in (vn(tt), vn(sl), vn(round(dg, 2)), "Cà Mau", "từ 01/03/2026 đến 30/06/2026", f"{len(sel)} / 1.200 dòng")))
    tn = t.replace(" ", " ")
    miss = [f"{ch['title']}: {r[0]}" for ch in dash["charts"] for r in ch["rows"]
            if not re.search(re.escape(r[0].replace(" ", " ")[:25]) + r".*\s" + re.escape(vn(parse_vn(r[1]))) + r"(\s|$)", tn)]
    check(G, "5c. PDF: mọi bảng thống kê == Dashboard", not miss, f"lệch: {miss[:3]}" if miss else f"{sum(len(c['rows']) for c in dash['charts'])} dòng thống kê")
    images = sum(p.images for p in pdf.pages)
    check("PDF", "Có ảnh biểu đồ", images >= len(dash["charts"]), f"{images} ảnh / {len(dash['charts'])} biểu đồ")
    check("PDF", "Tiếng Việt Unicode trích xuất đúng", "BÁO CÁO DOANH THU DỊCH VỤ KỸ THUẬT 2026" in t and "Người lập báo cáo" in t and "Trần Thị Mai" in t)
    pv = one(OUT, "preview__*.pdf")

    def no_time(x):
        return re.sub(r"\d{2}:\d{2}", "", x)
    check("PDF", "Bản xem trước có cùng nội dung với file tải xuống", no_time(pdfcheck.text(pv)) == no_time(t))
    poppler_crosscheck("PDF dài vừa — đối chiếu chéo (tùy chọn)", path)


def check_word(OUT, ctx, G):
    header, sel_sorted, exp_kpi, dash = ctx["header"], ctx["sel_sorted"], ctx["exp_kpi"], ctx["dash"]
    path = one(OUT, "main_filtered_docx__*.docx")
    d = docx_structure("Word dài vừa", path)
    _, paras, tables = docx_text(path)
    dt = tables[-1]
    exp = [[vn(r[0]), f"{r[1]:%d/%m/%Y %H:%M}" if r[1].hour else f"{r[1]:%d/%m/%Y}", r[2], r[3], r[4], vn(r[5]), vn(r[6]), vn(r[7]), vn(r[8])] for r in sel_sorted]
    check(G, "6a. Word: chi tiết == file gốc (từng ô)", dt[0] == header and dt[1:] == exp, f"{len(dt) - 1} dòng")
    kt = next(tb for tb in tables if tb[0] == ["Chỉ số", "Giá trị", "Ghi chú"])
    check(G, "6b. Word: chỉ số == file gốc", {r[0]: r[1] for r in kt[1:]} == {k: vn(round(v, 2)) for k, v in exp_kpi.items()}, {r[0]: r[1] for r in kt[1:]})
    heads = [c["head"][:2] for c in dash["charts"]]
    wst = [tb for tb in tables if tb[0][:2] in heads and tb is not dt]
    wm = [ch["title"] for tb, ch in zip(wst, dash["charts"]) if [(r[0], parse_vn(r[1])) for r in tb[1:] if r[0] != "Tổng cộng"] != [(r[0], parse_vn(r[1])) for r in ch["rows"]]]
    check(G, "6c. Word: mọi bảng thống kê == Dashboard", len(wst) == len(dash["charts"]) and not wm, f"{len(wst)} bảng" + (f"; lệch {wm}" if wm else ""))
    check(G, "6d. Word: điều kiện lọc", any(tb for tb in tables if ["Chi nhánh", "Cà Mau"] in tb))
    check("Word", "Có ảnh biểu đồ, chi tiết in ngang", len(d.inline_shapes) == len(dash["charts"]) and d.sections[-1].page_width > d.sections[-1].page_height)
    check("Word", "Tiêu đề và các mục nội dung đầy đủ",
          all(x in paras for x in ("BÁO CÁO DOANH THU DỊCH VỤ KỸ THUẬT 2026", "1. Thông tin báo cáo", "2. Chỉ số tổng hợp",
                                   "3. Biểu đồ và bảng thống kê", "4. Dữ liệu chi tiết (70 dòng)")))


def check_excel_scopes(OUT, ctx, G):
    src, header = ctx["src"], ctx["header"]
    full = one(OUT, "main_full_xlsx__*.xlsx")
    _, ws = xlsx_detail_check("Excel không lọc", full, len(src), len(header), header)
    full_rows = [list(r) for r in ws.iter_rows(min_row=5, values_only=True)]
    check(G, "Excel không lọc == toàn bộ file gốc (dòng 'Tổng cộng' không bị cộng trùng)", full_rows == src, f"{len(full_rows)} dòng, tổng {vn(sum(r[8] for r in full_rows))}")
    wa = openpyxl.load_workbook(one(OUT, "main_allsheets_xlsx__*.xlsx"))
    check(G, "Excel toàn bộ sheet: đủ 2 sheet dữ liệu", wa.sheetnames == ["Tổng quan", "DL Doanh thu 2026", "DL Danh mục thiết bị"], wa.sheetnames)
    wc = openpyxl.load_workbook(one(OUT, "main_chart3_xlsx__*.xlsx"))
    check(G, "Excel theo từng bảng thống kê: chỉ chứa bảng đó", len([s for s in wc.sheetnames if s.startswith("TK")]) == 1 and "Dữ liệu chi tiết" not in wc.sheetnames, wc.sheetnames)


def check_price_rule(S, OUT, rec):
    """'Giá' rule: dashboard == Excel == PDF == Word (rule itself unchanged)."""
    G2 = "Quy tắc Giá"
    ph, ps = source_rows(S / "QuyTac_Gia.xlsx", "Quy tắc Giá", 1)
    col = {n: i for i, n in enumerate(ph)}
    pdash = rec["price"]["kpis"]
    px = {r[0]: r[1] for r in openpyxl.load_workbook(one(OUT, "price_xlsx__*.xlsx"))["Tổng quan"].iter_rows(values_only=True) if r[0]}
    ptxt = pdfcheck.text(one(OUT, "price_pdf__*.pdf"))
    _, _, ptables = docx_text(one(OUT, "price_docx__*.docx"))
    pword = {r[0]: r[1] for tb in ptables if tb[0] == ["Chỉ số", "Giá trị", "Ghi chú"] for r in tb[1:]}
    for k in pdash[1:]:
        name, avg = (k["label"][:-5], True) if k["label"].endswith(" (TB)") else (k["label"], False)
        vals = [r[col[name]] for r in ps]
        expect = sum(vals) / len(vals) if avg else sum(vals)
        disp = parse_vn(k["value"])
        okd = abs(disp - expect) / max(abs(expect), 1) < 0.05
        check(G2, f"'{name}' → {'TRUNG BÌNH' if avg else 'TỔNG'}: Dashboard = Excel = PDF = Word",
              okd and abs(px[k["label"]] - expect) < 1e-6 and vn(round(expect, 2)) in ptxt and pword.get(k["label"]) == vn(round(expect, 2)),
              f"giá trị {vn(round(expect, 2))}")


def check_layouts(S, OUT):
    for label, pat in (("PDF ngắn (3 dòng)", "short_pdf__*.pdf"), ("PDF 18 cột", "equipment_pdf__*.pdf"),
                       ("PDF 40 cột, chữ dài", "wide_pdf__*.pdf"), ("PDF quy tắc Giá", "price_pdf__*.pdf"),
                       ("PDF 25.000 dòng lọc Cà Mau", "mid_camau_pdf__*.pdf")):
        with block(label, "Kiểm tra trình bày"):
            pdf_layout(label, one(OUT, pat))
    with block("PDF 40 cột, chữ dài", "Mã tham chiếu dài"):
        wide = pdfcheck.text(one(OUT, "wide_pdf__*.pdf"))
        w_src_h, w_src = source_rows(S / "RatRong_40Cot.xlsx", "Rất rộng", 1)
        lost = [r[38] for r in w_src if r[38].replace(" ", "")[:20] not in wide.replace(" ", "").replace("\n", "")]
        check("PDF 40 cột, chữ dài", "Mã tham chiếu dài 60 ký tự không bị mất", not lost, f"mất {len(lost)}" if lost else f"{len(w_src)} mã")
    with block("PDF ngắn (3 dòng)", "Nội dung"):
        sh = pdfcheck.text(one(OUT, "short_pdf__*.pdf"))
        check("PDF ngắn (3 dòng)", "Đủ 3 dòng + tổng", all(x in sh for x in ("Thay ắc quy UPS trạm Hòn Khoai", "Sửa anten VHF kênh 16", "24.550.000")))
    with block("PDF 40 cột — đối chiếu chéo (tùy chọn)", "Đối chiếu chéo"):
        poppler_crosscheck("PDF 40 cột — đối chiếu chéo (tùy chọn)", one(OUT, "wide_pdf__*.pdf"))
    soffice = find_soffice()
    for label, pat in (("Word ngắn", "short_docx__*.docx"), ("Word 18 cột", "equipment_docx__*.docx"),
                       ("Word 40 cột", "wide_docx__*.docx")):
        with block(label, "Kiểm tra cấu trúc và trình bày"):
            docx_structure(label, one(OUT, pat))
    for label, pat in (("Word ngắn", "short_docx__*.docx"), ("Word 18 cột", "equipment_docx__*.docx"),
                       ("Word 40 cột", "wide_docx__*.docx"), ("Word dài vừa", "main_filtered_docx__*.docx")):
        g = f"{label} — dựng trang bằng LibreOffice (tùy chọn)"
        if not soffice:
            for nme in ["Mở được bằng LibreOffice"] + LAYOUT_CHECKS:
                skip(g, nme, "LibreOffice không có trên máy (công cụ tùy chọn, không bắt buộc)")
            continue
        with block(g, "Dựng trang"):
            conv = office_to_pdf(one(OUT, pat), OUT / "_chuyen_doi_office")
            check(g, "Mở được bằng LibreOffice", conv is not None, "" if conv else "LibreOffice không chuyển đổi được file")
            if conv:
                pdf_layout(g, conv, margin=1.5 * 72 / 2.54 - 6, expect_footer=False)
    for label, pat, rows, cols in (("Excel 40 cột", "wide_xlsx__*.xlsx", 60, 40), ("Excel ngắn", "short_xlsx__*.xlsx", 3, 3),
                                   ("Excel 25.000 dòng", "mid_xlsx__*.xlsx", 25000, 9)):
        with block(label, "Mở file"):
            wb, _ = xlsx_detail_check(label, one(OUT, pat), rows, cols)
            check(label, "Tên các sheet chính xác", wb.sheetnames[0] == "Tổng quan" and wb.sheetnames[-1] == "Dữ liệu chi tiết", wb.sheetnames)


def write_reports(OUT, rec, t_start):
    ui_file = OUT / "ui_results.json"
    ui = json.loads(ui_file.read_text(encoding="utf-8")) if ui_file.exists() else []
    browser = rec.get("browser") or {}
    count = {k: sum(r[2] == k for r in ROWS) for k in ("PASS", "FAIL", "SKIP")}
    (OUT / "verify_results.json").write_text(json.dumps({
        "finished": datetime.now().isoformat(timespec="seconds"),
        "seconds": round(time.time() - t_start, 1),
        "browser": browser, "total": len(ROWS), "passed": count["PASS"], "failed": count["FAIL"], "skipped": count["SKIP"],
        "checks": [{"group": g, "name": n, "status": st, "pass": st == "PASS", "detail": d} for g, n, st, d in ROWS],
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# Kết quả nghiệm thu xuất báo cáo", "",
             f"- Trình duyệt: {browser.get('name')} {browser.get('version')}",
             f"- User agent: `{browser.get('userAgent')}`", f"- Thời điểm: {datetime.now():%d/%m/%Y %H:%M}", "",
             "## A. Kiểm thử giao diện (accept.js)", "", "| Mã | Bài kiểm thử | Kết quả | Chi tiết |", "|---|---|---|---|"]
    lines += [f"| {s['id']} | {s['name']} | {'PASS' if s['pass'] else '**FAIL**'} | {s['detail'].replace('|', '/')[:160]} |" for s in ui]
    lines += ["", "## B. Đối chiếu dữ liệu và kiểm tra file (verify.py)", "", "| Nhóm | Kiểm tra | Kết quả | Chi tiết |", "|---|---|---|---|"]
    lines += [f"| {g} | {n} | {st if st != 'FAIL' else '**FAIL**'} | {d.replace('|', '/')[:160]} |" for g, n, st, d in ROWS]
    lines += ["", f"**verify.py: {count['PASS']} PASS, {count['FAIL']} FAIL, {count['SKIP']} SKIP (công cụ tùy chọn không có — không tính là PASS)**"]
    (OUT / "acceptance_report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nVERIFY: {count['PASS']} PASS, {count['FAIL']} FAIL, {count['SKIP']} SKIP / {len(ROWS)}")
    sys.exit(1 if count["FAIL"] else 0)


if __name__ == "__main__":
    main()
