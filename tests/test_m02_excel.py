"""M02: dynamic comparison of an exported workbook with ANY source workbook
(no dependence on the generated sample file or on a fixed row count)."""
import io
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "tools" / "acceptance"


def _appendix_workbook():
    """Shaped like a real 'Phụ lục ... bảng tổng hợp đánh giá chất lượng': title rows, a merged
    header, STT, a 'Tổng cộng' row, sheets of 26 / 12 / 5 rows, and a notes sheet without a table."""
    wb = openpyxl.Workbook()
    specs = [("PL2.1 Đài TTDH", 26), ("PL2.2 Trạm VHF", 12), ("Tổng hợp quý", 5)]
    for si, (name, n) in enumerate(specs):
        ws = wb.active if si == 0 else wb.create_sheet()
        ws.title = name
        ws.append(["PHỤ LỤC 2 — BẢNG TỔNG HỢP ĐÁNH GIÁ CHẤT LƯỢNG THÁNG 2/2024"])
        ws.merge_cells("A1:F1")
        ws.append(["(Kèm theo báo cáo số 15/BC-ĐTT)"])
        ws.append([])
        ws.append(["STT", "Đơn vị / Thiết bị", "Ngày đánh giá", "Điểm chất lượng", "Tỷ lệ đạt (%)", "Ghi chú"])
        for i in range(1, n + 1):
            ws.append([i, f"Đơn vị {si + 1}.{i:02d} — Cà Mau", datetime(2024, 2, 1 + (i % 28)),
                       80 + (i * 7 + si) % 20 + 0.25, round(90 + (i % 9) * 1.1, 1), "Đạt" if i % 5 else "Cần khắc phục"])
        ws.append(["Tổng cộng", None, None, None, None, None])
    notes = wb.create_sheet("Ghi chú")
    notes.append(["Người lập: Trần Thị Mai"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), {n: c for n, c in specs}


@pytest.fixture
def m02(tmp_path, monkeypatch):
    monkeypatch.setenv("EXCEL_DASHBOARD_DATA_DIR", str(tmp_path / "data"))
    from excel_dashboard.main import app

    sys.path.insert(0, str(KIT))
    import importlib

    import verify
    importlib.reload(verify)
    mod = importlib.reload(importlib.import_module("m02_excel"))
    mod.V = verify
    yield TestClient(app), mod, verify, tmp_path
    sys.path.remove(str(KIT))


def _export(client, tmp_path, src_bytes, scope, name, sheet=None, rows=None):
    up = client.post("/api/datasets", files={"file": ("Phu luc 2 danh gia 2.2024.xlsx", src_bytes)},
                     data={"uploader": "Kiểm thử", "title": "Đánh giá chất lượng 2.2024"})
    assert up.status_code == 201, up.text
    ds = up.json()["id"]
    body = {"sheet": sheet or "PL2.1 Đài TTDH", "scope": scope, "row_indices": rows}
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=body)
    assert res.status_code == 200, res.text
    p = tmp_path / name
    p.write_bytes(res.content)
    return p


def test_m02_dynamic_rows_on_real_shaped_workbook(m02):
    client, mod, V, tmp = m02
    src_bytes, specs = _appendix_workbook()
    src = tmp / "Phu luc 2 danh gia 2.2024.xlsx"
    src.write_bytes(src_bytes)
    all_x = _export(client, tmp, src_bytes, "all_sheets", "toan_bo.xlsx")
    one_x = _export(client, tmp, src_bytes, "current", "mot_sheet.xlsx")
    code = mod.main(["--nguon", str(src), "--xuat", str(all_x), "--xuat", str(one_x), "--out", str(tmp / "kq")])
    res = json.loads((tmp / "kq" / "m02_doi_chieu_excel.json").read_text(encoding="utf-8"))
    fails = [c for c in res["checks"] if c["status"] == "FAIL"]
    assert code == 0 and not fails, fails
    # Row counts come from the source itself (26 / 12 / 5), never a fixed number.
    assert {s["ten"]: s["so_dong"] for s in res["sheet_nguon"]} == specs
    assert all(s["bo_dong_tong_cong"] == 1 for s in res["sheet_nguon"])
    names = {c["name"] for c in res["checks"] if c["status"] == "PASS"}
    for must in ("Đúng tên và thứ tự các sheet", "Đúng số dòng dữ liệu thực tế (đối chiếu động với file nguồn)",
                 "Không mất dữ liệu", "Không nhân đôi / không thêm dòng không có trong nguồn",
                 "Giữ nguyên thứ tự dòng của file nguồn", "Nội dung từng ô đúng như file nguồn (sau quy tắc xử lý)",
                 "Đối chiếu thô (không qua quy tắc xử lý): mọi dòng xuất có trong file nguồn",
                 "Hàng tiêu đề: in đậm, bộ lọc (AutoFilter), cố định khi cuộn (Freeze Panes)",
                 "Ngày dạng dd/mm/yyyy, là giá trị ngày thật (sắp xếp/lọc được)", "Xuất đủ mọi sheet có dữ liệu của file nguồn"):
        assert must in names, must
    detail = next(c for c in res["checks"] if c["name"] == "Xuất đủ mọi sheet có dữ liệu của file nguồn")["detail"]
    assert "Ghi chú" in detail  # sheet without a table: reported, skipped by design
    # A file without statistics sheets: the chart check is SKIP (not applicable), never PASS.
    chart = [c for c in res["checks"] if c["name"].startswith("Biểu đồ Excel")]
    assert chart and all(c["status"] == "SKIP" for c in chart)


@pytest.mark.parametrize("damage", ["drop_row", "duplicate_row", "change_cell", "swap_rows", "text_date", "wrong_sheet_name"])
def test_m02_detects_damaged_export(m02, damage):
    client, mod, V, tmp = m02
    src_bytes, _ = _appendix_workbook()
    src = tmp / "Phu luc 2 danh gia 2.2024.xlsx"
    src.write_bytes(src_bytes)
    x = _export(client, tmp, src_bytes, "all_sheets", "toan_bo.xlsx")
    wb = openpyxl.load_workbook(x)
    ws = wb["DL PL2.1 Đài TTDH"]
    if damage == "drop_row":
        ws.delete_rows(10)
    elif damage == "duplicate_row":
        ws.append([c.value for c in ws[6]])
    elif damage == "change_cell":
        ws["D7"] = (ws["D7"].value or 0) + 1
    elif damage == "swap_rows":
        a, b = [c.value for c in ws[5]], [c.value for c in ws[6]]
        for i, (va, vb) in enumerate(zip(a, b), start=1):
            ws.cell(5, i, vb)
            ws.cell(6, i, va)
    elif damage == "text_date":
        ws["C5"] = ws["C5"].value.strftime("%d/%m/%Y")
    elif damage == "wrong_sheet_name":
        ws.title = "Du lieu"
    wb.save(x)
    code = mod.main(["--nguon", str(src), "--xuat", str(x), "--out", str(tmp / "kq")])
    res = json.loads((tmp / "kq" / "m02_doi_chieu_excel.json").read_text(encoding="utf-8"))
    assert code == 1 and res["fail"] > 0, damage


def test_m02_charts_must_be_native_and_linked(m02, monkeypatch):
    client, mod, V, tmp = m02
    src_bytes, _ = _appendix_workbook()
    src = tmp / "Phu luc 2 danh gia 2.2024.xlsx"
    src.write_bytes(src_bytes)
    up = client.post("/api/datasets", files={"file": (src.name, src_bytes)}, data={"title": "Đánh giá 2.2024"}).json()
    body = {"sheet": "PL2.2 Trạm VHF", "sections": {"overview": True, "stats": True, "detail": True},
            "charts": [{"id": "c1", "title": "Số đơn vị theo Ghi chú", "type": "bar", "dimension": "Ghi chú", "agg": "count",
                        "dimension_label": "Ghi chú", "value_label": "Số dòng",
                        "groups": [{"label": "Đạt", "value": 10}, {"label": "Cần khắc phục", "value": 2}]}]}
    x = tmp / "tk.xlsx"
    x.write_bytes(client.post(f"/api/datasets/{up['id']}/export/xlsx", json=body).content)
    assert mod.main(["--nguon", str(src), "--xuat", str(x), "--out", str(tmp / "kq")]) == 0
    res = json.loads((tmp / "kq" / "m02_doi_chieu_excel.json").read_text(encoding="utf-8"))
    chart = next(c for c in res["checks"] if c["name"].startswith("Biểu đồ Excel"))
    assert chart["status"] == "PASS" and "TK01" in chart["detail"], chart
    # Replace the chart part by a picture-only drawing: the check must fail.
    bad = tmp / "tk_anh.xlsx"
    with zipfile.ZipFile(x) as zi, zipfile.ZipFile(bad, "w") as zo:
        for it in zi.infolist():
            data = zi.read(it.filename)
            if it.filename.startswith("xl/charts/chart"):
                data = data.replace(b"<f>", b"<v>").replace(b"</f>", b"</v>")
            zo.writestr(it, data)
    V.ROWS.clear()
    assert mod.main(["--nguon", str(src), "--xuat", str(bad), "--out", str(tmp / "kq2")]) == 1
