"""M02 — đối chiếu ĐỘNG file Excel xuất với file Excel nguồn bất kỳ.

    python m02_excel.py --nguon <file nguồn .xlsx/.xlsm/.xls/.csv> --xuat <BaoCao_...xlsx> [--xuat ...] --out <thư mục>

Không phụ thuộc file mẫu: số sheet, số dòng, số cột, tên cột đều lấy từ chính file nguồn.
Không sửa file nguồn và file xuất (chỉ đọc), không thêm dữ liệu.

Hai cách đọc file nguồn, đối chiếu chéo với nhau:
  * Quy tắc xử lý đã thiết kế của Web App (excel_dashboard/parser.py): tìm dòng tiêu đề, bỏ dòng/cột
    trống, bỏ dòng "Tổng cộng" để không cộng trùng, chuẩn hoá số/ngày. File xuất phải khớp TỪNG Ô.
  * Đọc thô bằng openpyxl/xlrd (độc lập với parser): mỗi dòng của file xuất phải có trong file nguồn
    (không có dữ liệu không có trong nguồn, không nhân đôi).

Trạng thái: PASS, FAIL, SKIP (không áp dụng cho file này, ghi rõ lý do — KHÔNG tính là PASS).
Ghi m02_doi_chieu_excel.json + .md vào --out. Mã thoát 1 nếu có FAIL, 2 nếu không chạy được.
"""
import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from datetime import date, datetime, time
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
from excel_dashboard import parser as P  # noqa: E402  (quy tắc xử lý đã thiết kế của Web App)
import verify as V  # noqa: E402  (check/skip/package_check dùng chung)

DETAIL_HEADER_ROW = 4  # hàng tiêu đề bảng trong file xuất (3 hàng đầu: tiêu đề, phụ đề, trống)


def sanitize(base):
    return re.sub(r"[\[\]:*?/\\]", " ", base).strip()[:31] or "Sheet"


class SheetNamer:
    """Cùng thuật toán đặt tên sheet của Web App (độ dài 31, ký tự cấm, trùng tên → (2), (3)…)."""

    def __init__(self):
        self.used = set()

    def __call__(self, base):
        base = sanitize(base)
        n, i = base, 2
        while n.lower() in self.used:
            suffix = f" ({i})"
            n = base[: 31 - len(suffix)] + suffix
            i += 1
        self.used.add(n.lower())
        return n


def norm(v):
    """Giá trị so sánh, áp dụng như nhau cho file nguồn thô và file xuất."""
    if v is None:
        return None
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, datetime):
        return ("D", v.replace(microsecond=0).isoformat())
    if isinstance(v, date):
        return ("D", datetime(v.year, v.month, v.day).isoformat())
    if isinstance(v, time):
        v = v.strftime("%H:%M:%S")
    if isinstance(v, (int, float)):
        return ("N", round(float(v), 6))
    s = re.sub(r"\s+", " ", str(v)).strip()
    if not s:
        return None
    d = P.parse_date(s)
    if d:
        return ("D", d.isoformat())
    n = P.parse_number(s)
    if n is not None:
        return ("N", round(float(n), 6))
    return ("S", s)


def row_key(values):
    return tuple(sorted((x for x in (norm(v) for v in values) if x is not None), key=repr))


def read_raw(path):
    name = path.name
    content = path.read_bytes()
    ext = path.suffix.lower()
    reader = {".xlsx": P._read_xlsx, ".xlsm": P._read_xlsx, ".xls": P._read_xls, ".csv": P._read_csv}.get(ext)
    if not reader:
        raise SystemExit(f"Không hỗ trợ file nguồn {name} (chỉ .xlsx, .xlsm, .xls, .csv)")
    return dict(reader(content)), P.parse_spreadsheet(name, content)


def overview(wb):
    if "Tổng quan" not in wb.sheetnames:
        return {}
    return {str(r[0]).strip(): r[1] for r in wb["Tổng quan"].iter_rows(values_only=True) if r and r[0] is not None}


def export_value_for_compare(v, col):
    """Giá trị file xuất → dạng giá trị của parser (ngày = chuỗi ISO)."""
    if col["type"] == "date" and isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    return v


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= 1e-9 * max(1, abs(a), abs(b))
    return a == b


def check_detail(G, ws, src_sheet, raw_rows, filtered, declared):
    cols = src_sheet["columns"]
    ncol = len(cols)
    header = [c.value for c in ws[DETAIL_HEADER_ROW]][:ncol]
    names = [c["name"] for c in cols]
    V.check(G, "Tiêu đề cột đúng như file nguồn (theo thứ tự)", header == names, f"{ncol} cột" if header == names else f"xuất {header} ≠ nguồn {names}")
    rows = [list(r[:ncol]) for r in ws.iter_rows(min_row=DETAIL_HEADER_ROW + 1, values_only=True)
            if any(v is not None for v in r)]
    n, total = len(rows), src_sheet["row_count"]
    info = (f"xuất {n} dòng; nguồn {total} dòng dữ liệu theo quy tắc xử lý"
            + (f" (đã bỏ {src_sheet['skipped_total_rows']} dòng 'Tổng cộng')" if src_sheet["skipped_total_rows"] else ""))
    if declared is not None:
        V.check(G, "Số dòng khớp số dòng ghi ở sheet Tổng quan", declared[0] == n and declared[1] == total,
                f"Tổng quan ghi {declared[0]} / {declared[1]}; {info}")
    src = [[export_value_for_compare(v, c) for v, c in zip(r, cols)] for r in src_sheet["rows"]]
    got = [[export_value_for_compare(v, c) for v, c in zip(r, cols)] for r in rows]
    src_keys = Counter(tuple(norm(v) for v in r) for r in src)
    got_keys = Counter(tuple(norm(v) for v in r) for r in got)
    extra = got_keys - src_keys
    if not filtered:
        V.check(G, "Đúng số dòng dữ liệu thực tế (đối chiếu động với file nguồn)", n == total, info)
        missing = src_keys - got_keys
        V.check(G, "Không mất dữ liệu", not missing, f"thiếu {sum(missing.values())} dòng" if missing else f"đủ {total} dòng")
    else:
        V.check(G, "Số dòng sau lọc không vượt số dòng nguồn", n <= total, info + " — bản xuất có lọc")
        V.skip(G, "Không mất dữ liệu", "file xuất có bộ lọc: kiểm tra mất dữ liệu ở bản xuất 'Toàn bộ dữ liệu mọi sheet (không lọc)'")
    V.check(G, "Không nhân đôi / không thêm dòng không có trong nguồn", not extra,
            f"{sum(extra.values())} dòng thừa hoặc trùng" if extra else "mỗi dòng xuất đúng số lần như trong nguồn")
    # Order: rows keep the source order (subsequence when filtered).
    src_norm = [[norm(v) for v in r] for r in src]
    it = iter(range(len(src_norm)))
    ordered = True
    for r in got:
        k = [norm(v) for v in r]
        if next((i for i in it if src_norm[i] == k), None) is None:
            ordered = False
            break
    V.check(G, "Giữ nguyên thứ tự dòng của file nguồn", ordered,
            "đúng thứ tự" if ordered else "khác thứ tự — nếu đã sắp xếp trên Dashboard, xuất lại không sắp xếp để kiểm M02")
    if not filtered and n == total:
        diff = [f"dòng {i + 1}, cột '{names[c]}': xuất {a!r} ≠ nguồn {b!r}"
                for i, (ra, rb) in enumerate(zip(got, src)) for c, (a, b) in enumerate(zip(ra, rb)) if not same(a, b)]
        V.check(G, "Nội dung từng ô đúng như file nguồn (sau quy tắc xử lý)", not diff,
                f"{len(diff)} ô khác: {diff[:3]}" if diff else f"{n * ncol} ô khớp")
    # Independent raw check: every exported row exists in the raw source sheet.
    raw_pool = Counter(row_key(r) for r in raw_rows)
    not_found = 0
    for r in rows:
        k = row_key(r)
        if raw_pool[k] > 0:
            raw_pool[k] -= 1
        else:
            not_found += 1
    V.check(G, "Đối chiếu thô (không qua quy tắc xử lý): mọi dòng xuất có trong file nguồn", not_found == 0,
            f"{not_found} dòng không tìm thấy trong file nguồn" if not_found else f"{n} dòng tìm thấy")
    last = openpyxl.utils.get_column_letter(ncol)
    V.check(G, "Hàng tiêu đề: in đậm, bộ lọc (AutoFilter), cố định khi cuộn (Freeze Panes)",
            bool(ws.cell(DETAIL_HEADER_ROW, 1).font.bold) and ws.freeze_panes == f"A{DETAIL_HEADER_ROW + 1}"
            and ws.auto_filter.ref == f"A{DETAIL_HEADER_ROW}:{last}{DETAIL_HEADER_ROW + n}",
            f"freeze {ws.freeze_panes}, lọc {ws.auto_filter.ref}")
    date_cols = [i for i, c in enumerate(cols) if c["type"] == "date"]
    if not date_cols:
        V.skip(G, "Ngày hiển thị dd/mm/yyyy", "không áp dụng: sheet nguồn không có cột ngày tháng")
    else:
        bad = []
        for i in date_cols:
            fmt = ws.cell(DETAIL_HEADER_ROW + 1, i + 1).number_format if n else ""
            vals = [r[i] for r in rows if r[i] is not None]
            if not fmt.startswith("dd/mm/yyyy") or not all(isinstance(v, datetime) for v in vals):
                bad.append(f"{names[i]} ({fmt})")
        V.check(G, "Ngày dạng dd/mm/yyyy, là giá trị ngày thật (sắp xếp/lọc được)", not bad,
                f"sai: {bad}" if bad else ", ".join(names[i] for i in date_cols))


def chart_refs(xml):
    """Cell ranges a chart reads (c:f) — present only for a native, data-linked chart."""
    import xml.etree.ElementTree as ET

    return [e.text for e in ET.fromstring(xml).iter() if e.tag.rsplit("}", 1)[-1] == "f" and e.text]


def chart_parts(path):
    """{sheet name: [chart xml]} — chart objects with cell references = editable in Excel."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
    import posixpath
    import xml.etree.ElementTree as ET

    out = {}
    with zipfile.ZipFile(path) as z:
        wbx = ET.fromstring(z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}

        def resolve(base, target):
            return target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(base), target))

        def rels_of(part):
            rp = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
            if rp not in z.namelist():
                return []
            return [(r.get("Type", ""), resolve(part, r.get("Target"))) for r in ET.fromstring(z.read(rp))]

        for s in wbx.find("m:sheets", ns):
            part = resolve("xl/workbook.xml", rels[s.get(f"{{{ns['r']}}}id")])
            charts, pictures = [], 0
            for typ, drawing in rels_of(part):
                if typ.endswith("/drawing"):
                    for t2, target in rels_of(drawing):
                        if t2.endswith("/chart"):
                            charts.append(z.read(target).decode("utf-8", "replace"))
                        elif t2.endswith("/image"):
                            pictures += 1
            out[s.get("name")] = (charts, pictures)
    return out


def check_export(path, raw, parsed, src_name):
    G0 = f"File xuất {path.name}"
    V.package_check(G0, path, V.XLSX_REQUIRED)
    wb = openpyxl.load_workbook(path)
    ov = overview(wb)
    V.check(G0, "Có sheet 'Tổng quan' ghi thông tin báo cáo", bool(ov), wb.sheetnames[:3])
    V.check(G0, "Được xuất từ đúng file nguồn", Path(str(ov.get("File nguồn", ""))).name == src_name,
            f"Tổng quan ghi '{ov.get('File nguồn')}', file nguồn đang đối chiếu '{src_name}'")
    by_name = {s["name"]: s for s in parsed}
    all_sheets = ov.get("Sheet dữ liệu") == "Tất cả sheet"
    filt = str(ov.get("Bộ lọc", "")) if "Bộ lọc" in ov else None
    filtered = not all_sheets and not (filt or "").startswith("Không lọc")
    stats = [n for n in wb.sheetnames if n.startswith("TK")]
    namer = SheetNamer()
    expected = [namer("Tổng quan")]
    for i, n in enumerate(stats, start=1):
        expected.append(namer(f"TK{i:02d} {wb[n]['A1'].value}"))
    if all_sheets:
        pairs = [(namer(f"DL {s['name']}"), s) for s in parsed]
        expected += [p[0] for p in pairs]
    elif "Dữ liệu chi tiết" in wb.sheetnames:
        pairs = [(namer("Dữ liệu chi tiết"), by_name.get(ov.get("Sheet dữ liệu")))]
        expected.append(pairs[0][0])
    else:
        pairs = []
    V.check(G0, "Đúng tên và thứ tự các sheet", wb.sheetnames == expected,
            f"{len(wb.sheetnames)} sheet: {wb.sheetnames}" if wb.sheetnames == expected else f"xuất {wb.sheetnames} ≠ mong đợi {expected}")
    if all_sheets:
        skipped = [n for n in raw if n not in by_name]
        V.check(G0, "Xuất đủ mọi sheet có dữ liệu của file nguồn", all(p[0] in wb.sheetnames for p in pairs),
                f"{len(pairs)}/{len(raw)} sheet có dữ liệu dạng bảng"
                + (f"; bỏ qua theo thiết kế (không có bảng dữ liệu): {skipped}" if skipped else ""))
    declared = None
    m = re.match(r"([\d.]+)\s*/\s*([\d.]+)", str(ov.get("Số dòng trong báo cáo", "")))
    if m and not all_sheets:
        declared = (int(m.group(1).replace(".", "")), int(m.group(2).replace(".", "")))
    for sheet_name, src_sheet in pairs:
        G = f"{path.name} › {sheet_name}"
        if src_sheet is None or sheet_name not in wb.sheetnames:
            V.check(G, "Tìm thấy sheet dữ liệu tương ứng trong file nguồn", False, f"Tổng quan ghi sheet '{ov.get('Sheet dữ liệu')}'")
            continue
        V.check(G, "Đúng sheet nguồn", True, f"sheet nguồn '{src_sheet['name']}'")
        check_detail(G, wb[sheet_name], src_sheet, raw[src_sheet["name"]], filtered, declared)
    if not pairs:
        V.skip(G0, "Bảng dữ liệu chi tiết", "file xuất không chọn mục 'Dữ liệu chi tiết'")
    charts = chart_parts(path)
    if not stats:
        V.skip(G0, "Biểu đồ Excel là đối tượng chỉnh sửa được",
               "không áp dụng cho file này: bản xuất không có bảng thống kê (ví dụ 'Toàn bộ dữ liệu mọi sheet'). "
               "Kiểm biểu đồ ở bản xuất theo sheet hiện tại")
    for n in stats:
        G = f"{path.name} › {n}"
        ws = wb[n]
        xs, pics = charts.get(n, ([], 0))
        refs = [f for x in xs for f in chart_refs(x)]
        own = [f for f in refs if f.split("!")[0].strip("'").replace("''", "'") == n]
        V.check(G, "Biểu đồ Excel là đối tượng chỉnh sửa được (gắn với ô dữ liệu, không phải ảnh)",
                len(xs) == 1 and pics == 0 and bool(own) and len(own) == len(refs),
                f"{len(xs)} biểu đồ, {pics} ảnh; dữ liệu biểu đồ lấy từ ô: {', '.join(refs[:3]) or 'không có'}")
        vals = [r for r in ws.iter_rows(min_row=DETAIL_HEADER_ROW + 1, values_only=True) if r and r[0] is not None]
        body = [r for r in vals if r[0] != "Tổng cộng"]
        tot = [r for r in vals if r[0] == "Tổng cộng"]
        if tot:
            s = sum(r[1] for r in body if isinstance(r[1], (int, float)))
            V.check(G, "Dòng 'Tổng cộng' bằng tổng các nhóm", abs((tot[0][1] or 0) - s) <= 1e-6 * max(1, abs(s)), f"{tot[0][1]} / {s}")
        V.check(G, "Tiêu đề in đậm, bộ lọc, cố định hàng tiêu đề",
                bool(ws.cell(DETAIL_HEADER_ROW, 1).font.bold) and ws.freeze_panes == f"A{DETAIL_HEADER_ROW + 1}" and bool(ws.auto_filter.ref),
                f"freeze {ws.freeze_panes}, lọc {ws.auto_filter.ref}")
    return {"file": path.name, "sheets": wb.sheetnames, "xuat_toan_bo_sheet": all_sheets, "co_loc": filtered}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--nguon", required=True)
    ap.add_argument("--xuat", required=True, action="append")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    src = Path(a.nguon)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        raw, parsed = read_raw(src)
    except Exception as exc:  # noqa: BLE001
        print(f"[LỖI] Không đọc được file nguồn {src}: {exc}")
        return 2
    G = f"File nguồn {src.name}"
    V.check(G, "Đọc được file nguồn (chỉ đọc, không sửa)", True,
            f"{len(raw)} sheet; có bảng dữ liệu: " + "; ".join(f"'{s['name']}' {s['row_count']} dòng × {len(s['columns'])} cột" for s in parsed))
    files = []
    for x in a.xuat:
        p = Path(x)
        with V.block(f"File xuất {p.name}", "Đối chiếu"):
            files.append(check_export(p, raw, parsed, src.name))
    count = Counter(r[2] for r in V.ROWS)
    res = {"luc": datetime.now().isoformat(timespec="seconds"), "file_nguon": str(src),
           "sheet_nguon": [{"ten": s["name"], "so_dong": s["row_count"], "so_cot": len(s["columns"]),
                            "bo_dong_tong_cong": s["skipped_total_rows"]} for s in parsed],
           "file_xuat": files, "pass": count["PASS"], "fail": count["FAIL"], "skip": count["SKIP"], "tong": len(V.ROWS),
           "checks": [{"group": g, "name": n, "status": st, "detail": d} for g, n, st, d in V.ROWS]}
    (out / "m02_doi_chieu_excel.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# M02 — Đối chiếu file Excel xuất với file nguồn", "", f"- File nguồn: `{src}`",
          f"- File xuất: {', '.join(f'`{f}`' for f in a.xuat)}", f"- Lúc: {res['luc']}", "",
          "| Nhóm | Kiểm tra | Kết quả | Chi tiết |", "|---|---|---|---|"]
    md += [f"| {g} | {n} | {st} | {str(d).replace('|', '/')[:200]} |" for g, n, st, d in V.ROWS]
    md += ["", f"**{count['PASS']} PASS, {count['FAIL']} FAIL, {count['SKIP']} SKIP** (SKIP = không áp dụng cho file này, không tính là PASS)"]
    (out / "m02_doi_chieu_excel.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\nM02 TỰ ĐỘNG: {count['PASS']} PASS, {count['FAIL']} FAIL, {count['SKIP']} SKIP / {len(V.ROWS)}")
    return 1 if count["FAIL"] or not files else 0


if __name__ == "__main__":
    sys.exit(main())
