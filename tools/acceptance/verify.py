"""Reconcile every layer of the export pipeline and check the files' layout.

    python tools/acceptance/verify.py --samples <dir> --out <accept.js out dir> [--base http://127.0.0.1:8000]

Layers compared: source workbook (read raw with openpyxl, independent of the
app's parser) -> processed data (API) -> dashboard (recorded by accept.js)
-> Excel -> PDF -> Word. PDF/Word layout checks: blank pages, orphaned
headings, fonts embedded, text inside the page margins, page numbering.
Needs poppler-utils (pdftotext, pdfinfo, pdffonts, pdfimages); LibreOffice
(soffice) is used, when present, to prove .docx/.xlsx open in an office suite.
Writes acceptance_report.md and exits 1 if anything fails.
"""
import argparse
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import docx
import httpx
import openpyxl

ROWS = []


def check(group, name, ok, detail=""):
    ROWS.append((group, name, bool(ok), str(detail)))
    print(("PASS " if ok else "FAIL ") + f"[{group}] {name}" + (f"  — {detail}" if detail else ""))


def vn(v):
    """Format like the dashboard / report: vi-VN, max 2 decimals."""
    if isinstance(v, int) or float(v).is_integer():
        s = f"{int(round(v)):,}"
    else:
        s = f"{v:,.2f}".rstrip("0").rstrip(".")
    return s.replace(",", "\0").replace(".", ",").replace("\0", ".")


def parse_vn(s):
    s = s.strip().replace(" ", " ")
    mult = 1
    for suf, m in ((" T", 1e9), (" Tr", 1e6), (" N", 1e3)):
        if s.endswith(suf):
            s, mult = s[: -len(suf)], m
    return float(s.replace(".", "").replace(",", ".")) * mult


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def one(out, pattern):
    files = sorted(glob.glob(str(out / pattern)))
    return files[-1] if files else None


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
# PDF / DOCX layout checks
# ---------------------------------------------------------------------------

MARGIN_PT = 14 * 72 / 25.4  # report margin (14 mm)
HEADING_RE = re.compile(r"^\s*\d+\.(\d+\.)?\s+\S")


def pdf_layout(group, pdf, margin=MARGIN_PT, expect_footer=True):
    info = run("pdfinfo", pdf)
    pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
    fonts = run("pdffonts", pdf).splitlines()[2:]
    not_embedded = [f.split()[0] for f in fonts if f.split()[-5] != "yes"]  # columns: ... emb sub uni object ID
    check(group, f"{Path(pdf).name}: mở được, {pages} trang", pages > 0)
    check(group, "Font được nhúng (không phụ thuộc máy khác)", fonts and not not_embedded,
          ", ".join(sorted({f.split()[0].split('+')[-1] for f in fonts})) + (f"; KHÔNG nhúng: {not_embedded}" if not_embedded else ""))
    images = run("pdfimages", "-list", pdf).splitlines()[2:]
    img_pages = {int(l.split()[0]) for l in images if l.strip()}
    blank, orphan, numbering = [], [], []
    for i in range(1, pages + 1):
        text = run("pdftotext", "-layout", "-f", str(i), "-l", str(i), pdf, "-")
        lines = [l for l in text.splitlines() if l.strip()]
        body = [l for l in lines if "Trang " not in l and "Lập lúc" not in l] if expect_footer else lines
        if expect_footer and not any(f"Trang {i}/{pages}" in l for l in lines):
            numbering.append(i)
        if not body and i not in img_pages:
            blank.append(i)
        elif body and HEADING_RE.match(body[-1]) and i < pages:
            orphan.append(f"tr.{i}: {body[-1].strip()[:50]}")
    check(group, "Không có trang trắng", not blank, f"trang trắng: {blank}" if blank else "")
    check(group, "Tiêu đề mục không bị tách khỏi nội dung", not orphan, "; ".join(orphan))
    if expect_footer:
        check(group, "Đánh số 'Trang x/y' đúng trên mọi trang", not numbering, f"thiếu ở trang {numbering}" if numbering else f"{pages}/{pages}")
    # Every word must sit inside the page (no clipped / overflowing text).
    bbox = run("pdftotext", "-bbox", pdf, "-")
    over = []
    for pm in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', bbox, re.S):
        w, h = float(pm.group(1)), float(pm.group(2))
        for wm in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', pm.group(3)):
            x0, y0, x1, y1 = map(float, wm.groups()[:4])
            if x0 < margin - 3 or x1 > w - margin + 3 or y1 > h - 5:
                over.append(html.unescape(wm.group(5))[:30])
    check(group, "Không có chữ tràn lề / bị cắt", not over, f"{len(over)} từ tràn: {over[:5]}" if over else "")
    return run("pdftotext", "-layout", pdf, "-")


def office_to_pdf(path):
    """Convert with LibreOffice (proves the file opens in an office suite)."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    d = tempfile.mkdtemp()
    env = {**os.environ, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", d, path], capture_output=True, env=env, timeout=600)
    pdfs = glob.glob(os.path.join(d, "*.pdf"))
    return pdfs[0] if pdfs else None


def docx_text(path):
    d = docx.Document(path)
    paras = "\n".join(p.text for p in d.paragraphs)
    tables = [[[c.text for c in r.cells] for r in t.rows] for t in d.tables]
    return d, paras, tables


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    missing = [t for t in ("pdftotext", "pdfinfo", "pdffonts", "pdfimages") if not shutil.which(t)]
    if missing:
        sys.exit(f"Thiếu công cụ {', '.join(missing)} (Poppler). Cài Poppler và thêm thư mục bin vào PATH, "
                 "hoặc chép thư mục kết quả sang máy Linux có poppler-utils để chạy verify.py.")
    S, OUT = Path(a.samples), Path(a.out)
    rec = json.loads((OUT / "dashboard_record.json").read_text())
    api = httpx.Client(base_url=a.base, timeout=120, trust_env=False)

    # ===== Main file: source -> processed -> dashboard -> xlsx/pdf/docx =====
    G = "Đồng bộ"
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
    dash = rec["main_filtered"]
    dk = {k["label"]: k for k in dash["kpis"]}
    ok = (parse_vn(dk["Số dòng"]["value"]) == len(sel) and f"= {vn(tt)}" in dk["Thành tiền"]["sub"]
          and parse_vn(dk["Số lượng"]["value"]) == sl and abs(parse_vn(dk["Đơn giá (TB)"]["value"]) - dg) / dg < 0.05
          and parse_vn(dk["Tỷ lệ chiết khấu (TB)"]["value"]) == round(ck, 2))
    check(G, "3. Dashboard == file gốc (lọc Cà Mau, 01/03–30/06/2026)", ok, f"{len(sel)} dòng, Thành tiền {vn(tt)}, Số lượng {sl}")

    # Excel
    xl = one(OUT, "main_filtered_xlsx__*.xlsx")
    wb = openpyxl.load_workbook(xl)
    det = wb["Dữ liệu chi tiết"]
    rows = [list(r) for r in det.iter_rows(min_row=5, values_only=True)]
    check(G, "4a. Excel: chi tiết == file gốc (từng ô, đúng thứ tự sắp xếp)", rows == sel_sorted, f"{len(rows)} dòng")
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
    check("Excel", "Định dạng: tiêu đề, AutoFilter, Freeze Panes, độ rộng cột",
          det.freeze_panes == "A5" and det.auto_filter.ref == f"A4:I{4 + len(sel)}" and det["A4"].font.bold
          and all((det.column_dimensions[c].width or 0) >= 8 for c in "ABCDEFGHI") and det["B5"].number_format == "dd/mm/yyyy hh:mm",
          f"freeze {det.freeze_panes}, filter {det.auto_filter.ref}")
    check("Excel", "Mỗi bảng thống kê có biểu đồ Excel + AutoFilter + Freeze", all(len(wb[n]._charts) == 1 and wb[n].auto_filter.ref and wb[n].freeze_panes == "A5" for n in stats))

    # PDF
    pdf = one(OUT, "main_filtered_pdf__*.pdf")
    t = pdf_layout("PDF dài vừa (70 dòng)", pdf)
    missing_rows = [r[0] for r in sel_sorted if not re.search(rf"(?m)^\s*{re.escape(vn(r[0]))}\s+{r[1]:%d/%m/%Y}.*{re.escape(vn(r[8]))}\s*$", t)]
    check(G, "5a. PDF: đủ từng dòng chi tiết (STT, ngày, thành tiền)", not missing_rows, f"thiếu: {missing_rows[:5]}" if missing_rows else f"{len(sel_sorted)} dòng")
    check(G, "5b. PDF: chỉ số + điều kiện lọc", all(s in t for s in (vn(tt), vn(sl), vn(round(dg, 2)), "Cà Mau", "từ 01/03/2026 đến 30/06/2026", f"{len(sel)} / 1.200 dòng")))
    tn = t.replace("\u00a0", " ")  # pdftotext turns no-break spaces (from Intl compact labels) into spaces
    miss = [f"{ch['title']}: {r[0]}" for ch in dash["charts"] for r in ch["rows"]
            if not re.search(re.escape(r[0].replace("\u00a0", " ")[:25]) + r".*\s" + re.escape(vn(parse_vn(r[1]))) + r"(\s|$)", tn)]
    check(G, "5c. PDF: mọi bảng thống kê == Dashboard", not miss, f"lệch: {miss[:3]}" if miss else f"{sum(len(c['rows']) for c in dash['charts'])} dòng thống kê")
    check("PDF", "Có ảnh biểu đồ", len(run("pdfimages", "-list", pdf).splitlines()[2:]) >= len(dash["charts"]))
    check("PDF", "Tiếng Việt Unicode trích xuất đúng", "BÁO CÁO DOANH THU DỊCH VỤ KỸ THUẬT 2026" in t and "Người lập báo cáo" in t and "Trần Thị Mai" in t)
    pv = one(OUT, "preview__*.pdf")
    def no_time(x):
        return re.sub(r"\d{2}:\d{2}", "", x)
    check("PDF", "Bản xem trước có cùng nội dung với file tải xuống", pv and no_time(run("pdftotext", pv, "-")) == no_time(run("pdftotext", pdf, "-")))

    # Word
    dfile = one(OUT, "main_filtered_docx__*.docx")
    d, paras, tables = docx_text(dfile)
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

    # Unfiltered + all sheets + per-chart
    full_rows = [list(r) for r in openpyxl.load_workbook(one(OUT, "main_full_xlsx__*.xlsx"))["Dữ liệu chi tiết"].iter_rows(min_row=5, values_only=True)]
    check(G, "Excel không lọc == toàn bộ file gốc (dòng 'Tổng cộng' không bị cộng trùng)", full_rows == src, f"{len(full_rows)} dòng, tổng {vn(sum(r[8] for r in full_rows))}")
    wa = openpyxl.load_workbook(one(OUT, "main_allsheets_xlsx__*.xlsx"))
    check(G, "Excel toàn bộ sheet: đủ 2 sheet dữ liệu", [s for s in wa.sheetnames if s.startswith("DL ")] == ["DL Doanh thu 2026", "DL Danh mục thiết bị"])
    wc = openpyxl.load_workbook(one(OUT, "main_chart3_xlsx__*.xlsx"))
    check(G, "Excel theo từng bảng thống kê: chỉ chứa bảng đó", len([s for s in wc.sheetnames if s.startswith("TK")]) == 1 and "Dữ liệu chi tiết" not in wc.sheetnames, wc.sheetnames)

    # ===== "Giá" rule: dashboard == Excel == PDF == Word ======================
    G2 = "Quy tắc Giá"
    ph, ps = source_rows(S / "QuyTac_Gia.xlsx", "Quy tắc Giá", 1)
    col = {n: i for i, n in enumerate(ph)}
    pdash = rec["price"]["kpis"]
    px = {r[0]: r[1] for r in openpyxl.load_workbook(one(OUT, "price_xlsx__*.xlsx"))["Tổng quan"].iter_rows(values_only=True) if r[0]}
    ptxt = run("pdftotext", "-layout", one(OUT, "price_pdf__*.pdf"), "-")
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

    # ===== Layout of every other PDF / Word =================================
    for label, pat in (("PDF ngắn (3 dòng)", "short_pdf__*.pdf"), ("PDF 18 cột", "equipment_pdf__*.pdf"),
                       ("PDF 40 cột, chữ dài", "wide_pdf__*.pdf"), ("PDF quy tắc Giá", "price_pdf__*.pdf"),
                       ("PDF 25.000 dòng lọc Cà Mau", "mid_camau_pdf__*.pdf")):
        f = one(OUT, pat)
        if f:
            pdf_layout(label, f)
    wide = run("pdftotext", "-layout", one(OUT, "wide_pdf__*.pdf"), "-")
    w_src_h, w_src = source_rows(S / "RatRong_40Cot.xlsx", "Rất rộng", 1)
    lost = [r[38] for r in w_src if r[38].replace(" ", "")[:20] not in wide.replace(" ", "").replace("\n", "")]
    check("PDF 40 cột, chữ dài", "Mã tham chiếu dài 60 ký tự không bị mất", not lost, f"mất {len(lost)}" if lost else f"{len(w_src)} mã")
    sh = run("pdftotext", "-layout", one(OUT, "short_pdf__*.pdf"), "-")
    check("PDF ngắn (3 dòng)", "Đủ 3 dòng + tổng", all(x in sh for x in ("Thay ắc quy UPS trạm Hòn Khoai", "Sửa anten VHF kênh 16", "24.550.000")))
    for label, pat in (("Word ngắn", "short_docx__*.docx"), ("Word 18 cột", "equipment_docx__*.docx"),
                       ("Word 40 cột", "wide_docx__*.docx"), ("Word dài vừa", "main_filtered_docx__*.docx")):
        f = one(OUT, pat)
        dd_ = docx.Document(f)
        widths = [c.width for t in dd_.tables for c in t.columns if c.width]
        narrow = min(widths) / 360000 if widths else 0
        check(label, "Mọi cột bảng rộng ≥ 1,2 cm (chữ không bị xuống dòng từng ký tự)", narrow >= 1.2, f"cột hẹp nhất {narrow:.2f} cm")
        conv = office_to_pdf(f)
        if conv is None:
            check(label, "Mở bằng LibreOffice", False, "không chuyển đổi được")
            continue
        check(label, "Mở được bằng bộ Office (LibreOffice)", True)
        pdf_layout(label, conv, margin=1.5 * 72 / 2.54 - 6, expect_footer=False)
    for label, pat in (("Excel 40 cột", "wide_xlsx__*.xlsx"), ("Excel ngắn", "short_xlsx__*.xlsx"), ("Excel 25.000 dòng", "mid_xlsx__*.xlsx")):
        f = one(OUT, pat)
        wbx = openpyxl.load_workbook(f, read_only=True)
        n = sum(1 for r in wbx["Dữ liệu chi tiết"].iter_rows(min_row=5, values_only=True) if any(v is not None for v in r))
        check(label, "Mở được, đủ dòng", n > 0, f"{n} dòng")
    mid_rows = sum(1 for r in openpyxl.load_workbook(one(OUT, "mid_xlsx__*.xlsx"), read_only=True)["Dữ liệu chi tiết"].iter_rows(min_row=5, values_only=True) if r[0] is not None)
    check("Excel 25.000 dòng", "Đủ 25.000 dòng", mid_rows == 25000, mid_rows)

    # ===== Report =============================================================
    ui = json.loads((OUT / "ui_results.json").read_text())
    lines = ["# Kết quả nghiệm thu xuất báo cáo", "",
             f"- Trình duyệt: {rec['browser']['name']} {rec['browser']['version']}",
             f"- User agent: `{rec['browser']['userAgent']}`", f"- Thời điểm: {datetime.now():%d/%m/%Y %H:%M}", "",
             "## A. Kiểm thử giao diện (accept.js)", "", "| Mã | Bài kiểm thử | Kết quả | Chi tiết |", "|---|---|---|---|"]
    lines += [f"| {s['id']} | {s['name']} | {'PASS' if s['pass'] else '**FAIL**'} | {s['detail'].replace('|', '/')[:160]} |" for s in ui]
    lines += ["", "## B. Đối chiếu dữ liệu và kiểm tra file (verify.py)", "", "| Nhóm | Kiểm tra | Kết quả | Chi tiết |", "|---|---|---|---|"]
    lines += [f"| {g} | {n} | {'PASS' if ok else '**FAIL**'} | {d.replace('|', '/')[:160]} |" for g, n, ok, d in ROWS]
    total = len(ui) + len(ROWS)
    failed = sum(not s["pass"] for s in ui) + sum(not r[2] for r in ROWS)
    lines += ["", f"**Tổng: {total - failed}/{total} PASS**"]
    (OUT / "acceptance_report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nVERIFY: {len(ROWS) - sum(not r[2] for r in ROWS)}/{len(ROWS)} PASS — tổng cộng {total - failed}/{total}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
