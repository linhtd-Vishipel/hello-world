import io
from pathlib import Path
from datetime import datetime

import docx
import openpyxl
import pytest
from fastapi.testclient import TestClient

from excel_dashboard.parser import parse_date, parse_number, parse_spreadsheet


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EXCEL_DASHBOARD_DATA_DIR", str(tmp_path))
    from excel_dashboard.main import app

    return TestClient(app)


def _xlsx(rows, title_rows=()):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Doanh thu"
    for r in title_rows:
        ws.append(r)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SALES = [
    ["STT", "Ngày", "Chi nhánh", "Sản phẩm", "Số lượng", "Doanh thu", "Ghi chú"],
    [1, datetime(2026, 1, 5), "Cà Mau", "Thiết bị VHF", 2, 15000000, "Giao ngay"],
    [2, datetime(2026, 1, 20), "Bạc Liêu", "AIS", 1, 8000000, None],
    [3, datetime(2026, 2, 3), "Cà Mau", "AIS", 3, 24000000, "Khách quen"],
    [4, datetime(2026, 2, 14), "Kiên Giang", "Thiết bị VHF", 1, 7500000, None],
    ["Tổng cộng", None, None, None, 7, 54500000, None],
]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1.234.567", 1234567),
        ("1,234,567", 1234567),
        ("1.234,5", 1234.5),
        ("1,234.5", 1234.5),
        ("12,5", 12.5),
        ("15%", 0.15),
        ("500.000 đ", 500000),
        ("(200)", -200),
        (42, 42),
        ("abc", None),
        (True, None),
    ],
)
def test_parse_number(raw, expected):
    assert parse_number(raw) == expected


def test_parse_date_formats():
    assert parse_date("05/01/2026") == datetime(2026, 1, 5)
    assert parse_date("2026-01-05") == datetime(2026, 1, 5)
    assert parse_date("hello") is None


def test_infers_columns_and_skips_total_and_title_rows():
    content = _xlsx(SALES, title_rows=[["BÁO CÁO DOANH THU QUÝ I"], []])
    [sheet] = parse_spreadsheet("bao_cao.xlsx", content)
    roles = {c["name"]: (c["type"], c["role"]) for c in sheet["columns"]}
    assert roles["STT"] == ("number", "identifier")
    assert roles["Ngày"] == ("date", "time")
    assert roles["Chi nhánh"] == ("category", "dimension")
    assert roles["Doanh thu"] == ("number", "measure")
    assert roles["Số lượng"] == ("number", "measure")
    assert sheet["row_count"] == 4
    assert sheet["skipped_total_rows"] == 1
    assert sheet["rows"][0][1] == "2026-01-05T00:00:00"


def test_csv_with_semicolons_and_vietnamese_numbers():
    content = "Tỉnh;Doanh thu\nCà Mau;1.500.000\nBạc Liêu;2.000.000\n".encode("utf-8")
    [sheet] = parse_spreadsheet("data.csv", content)
    assert [c["type"] for c in sheet["columns"]] == ["category", "number"]
    assert sheet["rows"][1] == ["Bạc Liêu", 2000000]


def test_duplicate_and_blank_headers_are_named():
    content = _xlsx([["A", "A", None, "B"], [1, 2, 3, "x"], [4, 5, 6, "y"]])
    [sheet] = parse_spreadsheet("d.xlsx", content)
    assert [c["name"] for c in sheet["columns"]] == ["A", "A (2)", "Cột 3", "B"]


def test_rejects_unsupported_extension(client):
    res = client.post("/api/datasets", files={"file": ("x.txt", b"abc")})
    assert res.status_code == 422


def test_rejects_corrupt_excel(client):
    res = client.post("/api/datasets", files={"file": ("x.xlsx", b"not an excel file")})
    assert res.status_code == 422


def test_upload_list_get_dashboard_delete(client):
    res = client.post(
        "/api/datasets",
        files={"file": ("bao_cao.xlsx", _xlsx(SALES))},
        data={"uploader": "Nguyễn Văn A", "title": "Doanh thu Q1"},
    )
    assert res.status_code == 201, res.text
    meta = res.json()
    assert meta["title"] == "Doanh thu Q1"
    assert meta["sheets"][0]["row_count"] == 4

    assert [d["id"] for d in client.get("/api/datasets").json()] == [meta["id"]]

    full = client.get(f"/api/datasets/{meta['id']}").json()
    assert full["sheets"][0]["name"] == "Doanh thu"
    assert full["dashboard"] == {}

    chart = {"id": "c1", "type": "bar", "dimension": "Chi nhánh", "measure": "Doanh thu", "agg": "sum"}
    res = client.put(f"/api/datasets/{meta['id']}/dashboard", json={"charts": {"Doanh thu": [chart]}})
    assert res.status_code == 200
    saved = client.get(f"/api/datasets/{meta['id']}").json()["dashboard"]
    assert saved["charts"]["Doanh thu"][0]["dimension"] == "Chi nhánh"

    res = client.put(f"/api/datasets/{meta['id']}/dashboard", json={"charts": {"x": [{**chart, "type": "evil"}]}})
    assert res.status_code == 422

    assert client.get(f"/api/datasets/{meta['id']}/file").content[:2] == b"PK"

    assert client.delete(f"/api/datasets/{meta['id']}").status_code == 204
    assert client.get("/api/datasets").json() == []
    assert client.get(f"/api/datasets/{meta['id']}").status_code == 404


def test_rejects_path_traversal_ids(client):
    assert client.get("/api/datasets/..%2F..%2Fetc").status_code == 404
    assert client.delete("/api/datasets/../index").status_code in (404, 405)


def test_index_page_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "Excel Dashboard" in res.text


# ---------------------------------------------------------------------------
# Report export
# ---------------------------------------------------------------------------

from excel_dashboard import export as export_module  # noqa: E402


def _upload(client):
    res = client.post(
        "/api/datasets",
        files={"file": ("bao_cao.xlsx", _xlsx(SALES))},
        data={"uploader": "Nguyễn Văn A", "title": "Doanh thu Quý I"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _payload(indices=None, revenue=None, **extra):
    # Rows (after the "Tổng cộng" row is dropped): 0 Cà Mau 15tr, 1 Bạc Liêu 8tr, 2 Cà Mau 24tr, 3 Kiên Giang 7.5tr
    if indices is None:
        indices = [2, 0]  # Cà Mau only, sorted by revenue desc
    if revenue is None:
        revenue = 39000000
    body = {
        "sheet": "Doanh thu",
        "author": "Trần Thị Bé",
        "row_indices": indices,
        "filters": [{"label": "Chi nhánh", "value": "Cà Mau"}],
        "kpis": [
            {"label": "Số dòng", "value": len(indices), "mode": "count"},
            {"label": "Doanh thu", "value": revenue, "mode": "sum", "column": "Doanh thu"},
        ],
        "charts": [{
            "id": "c1", "title": "Tổng Doanh thu theo Sản phẩm", "type": "bar", "dimension": "Sản phẩm",
            "measure": "Doanh thu", "agg": "sum", "dimension_label": "Sản phẩm", "value_label": "Tổng Doanh thu",
            "groups": [{"label": "AIS", "value": 24000000}, {"label": "Thiết bị VHF", "value": 15000000}],
        }],
    }
    body.update(extra)
    return body


def test_report_filename():
    now = datetime(2026, 11, 17, 9, 5)
    assert export_module.report_filename("Doanh thu Quý I/2026", "xlsx", now) == "BaoCao_DoanhThuQuyI2026_20261117_0905.xlsx"
    assert export_module.report_filename("Đài TTDH", "pdf", now) == "BaoCao_DaiTTDH_20261117_0905.pdf"
    assert export_module.report_filename("!!!", "pdf", now) == "BaoCao_BaoCao_20261117_0905.pdf"


def test_export_xlsx_matches_filtered_dashboard(client):
    ds = _upload(client)
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=_payload())
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == export_module.MEDIA_TYPES["xlsx"]
    cd = res.headers["content-disposition"]
    assert cd.startswith('attachment; filename="BaoCao_DoanhThuQuyI_') and cd.endswith('.xlsx')
    assert res.headers["x-report-rows"] == "2"

    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert wb.sheetnames == ["Tổng quan", "TK01 Tổng Doanh thu theo Sản ph", "Dữ liệu chi tiết"]
    overview = [[c for c in r if c is not None] for r in wb["Tổng quan"].iter_rows(values_only=True)]
    assert ["Chi nhánh", "Cà Mau"] in overview
    assert ["Doanh thu", 39000000, ] == overview[[r[:1] for r in overview].index(["Doanh thu"])][:2]

    stats = wb["TK01 Tổng Doanh thu theo Sản ph"]
    assert stats.freeze_panes == "A5"
    assert stats.auto_filter.ref == "A4:C6"
    assert [c.value for c in stats[5]][:3] == ["AIS", 24000000, 24000000 / 39000000]
    assert [c.value for c in stats[7]][:2] == ["Tổng cộng", 39000000]
    assert len(stats._charts) == 1

    detail = wb["Dữ liệu chi tiết"]
    assert detail.freeze_panes == "A5"
    assert detail.auto_filter.ref == "A4:G6"
    assert [c.value for c in detail[4]] == SALES[0]
    # Rows come in the order the dashboard sent (sorted), with real dates and numbers.
    assert [c.value for c in detail[5]][:6] == [3, datetime(2026, 2, 3), "Cà Mau", "AIS", 3, 24000000]
    assert detail["B5"].number_format == "dd/mm/yyyy"
    assert detail["F5"].number_format == "#,##0"
    assert detail.max_row == 6
    assert detail.column_dimensions["G"].width >= 10


def test_export_all_sheets_xlsx_ignores_filters(client):
    ds = _upload(client)
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=_payload(scope="all_sheets"))
    assert res.status_code == 200, res.text
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert wb["Dữ liệu chi tiết"].max_row == 4 + 4


def test_export_pdf_and_docx(client):
    import docx

    ds = _upload(client)
    pdf = client.post(f"/api/datasets/{ds}/export/pdf", json=_payload())
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    assert b"DejaVu" in pdf.content  # Unicode font embedded for Vietnamese
    inline = client.post(f"/api/datasets/{ds}/export/pdf?inline=true", json=_payload())
    assert inline.headers["content-disposition"].startswith("inline;")

    res = client.post(f"/api/datasets/{ds}/export/docx", json=_payload())
    assert res.status_code == 200, res.text
    d = docx.Document(io.BytesIO(res.content))
    text = "\n".join(p.text for p in d.paragraphs)
    assert "BÁO CÁO DOANH THU QUÝ I" in text
    assert "Dữ liệu chi tiết (2 dòng)" in text
    detail = d.tables[-1]
    assert [c.text for c in detail.rows[0].cells] == SALES[0]
    assert [c.text for c in detail.rows[1].cells][:6] == ["3", "03/02/2026", "Cà Mau", "AIS", "3", "24.000.000"]
    assert len(detail.rows) == 3


@pytest.mark.parametrize(
    "body,message",
    [
        (_payload(indices=[], revenue=None), "Không có dữ liệu"),
        (_payload(revenue=39000001), "khác dữ liệu máy chủ"),
        (_payload(indices=[0, 99]), "không hợp lệ"),
        (_payload(indices=[0, 0]), "không hợp lệ"),
        ({**_payload(), "sections": {"overview": False, "stats": False, "detail": False}}, "Chưa chọn"),
    ],
)
def test_export_rejects_bad_requests(client, body, message):
    ds = _upload(client)
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=body)
    assert res.status_code == 422
    assert message in res.json()["detail"]


def test_export_chart_total_mismatch_rejected(client):
    ds = _upload(client)
    body = _payload()
    body["charts"][0]["groups"][0]["value"] = 1
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=body)
    assert res.status_code == 422 and "không khớp" in res.json()["detail"]


def test_export_limits_and_scope(client, monkeypatch):
    ds = _upload(client)
    assert client.post(f"/api/datasets/{ds}/export/pdf", json=_payload(scope="all_sheets")).status_code == 422
    monkeypatch.setattr(export_module, "PDF_MAX_DETAIL_ROWS", 1)
    res = client.post(f"/api/datasets/{ds}/export/pdf", json=_payload())
    assert res.status_code == 422 and "vượt giới hạn" in res.json()["detail"]
    ok = client.post(f"/api/datasets/{ds}/export/pdf", json={**_payload(), "sections": {"detail": False}})
    assert ok.status_code == 200
    assert client.post(f"/api/datasets/{ds}/export/csv", json=_payload()).status_code == 422
    assert client.post("/api/datasets/" + "0" * 32 + "/export/xlsx", json=_payload()).status_code == 404


def test_export_never_writes_formulas(client):
    csv_text = "Tên,Giá trị\n=1+1,1\nb,2\n"
    res = client.post("/api/datasets", files={"file": ("f.csv", csv_text.encode())})
    ds = res.json()["id"]
    out = client.post(f"/api/datasets/{ds}/export/xlsx", json={"sheet": "CSV", "sections": {"overview": False, "stats": False}})
    assert out.status_code == 200, out.text
    cell = openpyxl.load_workbook(io.BytesIO(out.content))["Dữ liệu chi tiết"]["A5"]
    assert cell.value == "=1+1" and cell.data_type == "s"


def test_limit_message_is_readable(client, monkeypatch):
    ds = _upload(client)
    monkeypatch.setattr(export_module, "DOCX_MAX_DETAIL_ROWS", 1)
    detail = client.post(f"/api/datasets/{ds}/export/docx", json=_payload()).json()["detail"]
    assert detail == (
        "Dữ liệu chi tiết có 2 dòng, vượt giới hạn 1 dòng của file Word. Hệ thống không tự cắt bớt dữ liệu. "
        "Cách xử lý: xuất Excel (không giới hạn dòng), hoặc lọc bớt dữ liệu, hoặc bỏ chọn mục Dữ liệu chi tiết."
    )


def test_docx_wide_table_is_split_not_squeezed(client):
    import docx

    header = ["Mã hồ sơ"] + [f"Chỉ tiêu kỹ thuật số {i:02d}" for i in range(1, 40)]
    lines = [",".join(header)] + [",".join([f"HS-{r:03d}"] + [f"{r * 1000 + c}.25" for c in range(1, 40)]) for r in range(1, 6)]
    ds = client.post("/api/datasets", files={"file": ("rong.csv", "\n".join(lines).encode())}).json()["id"]
    res = client.post(f"/api/datasets/{ds}/export/docx", json={"sheet": "CSV", "sections": {"overview": False, "stats": False}})
    assert res.status_code == 200, res.text
    d = docx.Document(io.BytesIO(res.content))
    detail = [t for t in d.tables if t.rows[0].cells[0].text == "Mã hồ sơ"]
    assert len(detail) > 1  # split into parts, first column repeated
    seen = {c.text for t in detail for c in t.rows[0].cells}
    assert seen == set(header)  # no column lost
    assert all(len(t.rows) == 6 for t in detail)  # no row lost
    narrowest_cm = min(c.width for t in detail for c in t.columns) / 360000
    assert narrowest_cm >= 1.2


def _chart_xml(content):
    import zipfile

    with zipfile.ZipFile(io.BytesIO(content)) as z:
        return [z.read(n).decode() for n in sorted(z.namelist()) if n.startswith("xl/charts/chart")]


def test_export_xlsx_chart_layout_title_never_overlaps_axis(client):
    """Regression (Windows acceptance 19/11, TK02/TK03): horizontal bar charts reversed the category
    axis without moving the value axis, so Excel drew the value labels at the top, under the title."""
    import re as _re

    ds = _upload(client)
    many = [{"label": f"Đài thông tin duyên hải số {i}", "value": 80 + i} for i in range(1, 9)]
    charts = [
        {"id": "h", "title": "Tổng Doanh thu theo Đơn vị", "type": "hbar", "dimension": "Sản phẩm", "measure": "Doanh thu",
         "agg": "avg", "dimension_label": "Đơn vị", "value_label": "Điểm", "groups": many},
        {"id": "b", "title": "Cột", "type": "bar", "dimension": "Sản phẩm", "measure": "Doanh thu", "agg": "avg",
         "dimension_label": "Đơn vị", "value_label": "Điểm", "groups": many},
        {"id": "d", "title": "Tỷ trọng", "type": "doughnut", "dimension": "Sản phẩm", "agg": "avg",
         "dimension_label": "Đơn vị", "value_label": "Điểm", "groups": many[:3]},
        {"id": "l", "title": "Đường", "type": "line", "dimension": "Sản phẩm", "measure": "Doanh thu", "agg": "avg",
         "dimension_label": "Đơn vị", "value_label": "Điểm", "groups": many},
    ]
    res = client.post(f"/api/datasets/{ds}/export/xlsx", json=_payload(charts=charts))
    assert res.status_code == 200, res.text
    hbar, bar, pie, line = _chart_xml(res.content)
    for x in (hbar, bar, pie, line):
        assert _re.search(r'<title>.*?<overlay val="0"\s*/>', x, _re.S), "title must sit above the plot area"
    cat = _re.search(r"<catAx>.*?</catAx>", hbar, _re.S).group(0)
    val = _re.search(r"<valAx>.*?</valAx>", hbar, _re.S).group(0)
    assert '<orientation val="maxMin"' in cat  # first group on top, as on the dashboard
    assert '<crosses val="max"' in val          # value axis at the bottom, away from the title
    assert '<min val="0"' in val
    vbar = _re.search(r"<valAx>.*?</valAx>", bar, _re.S).group(0)
    assert '<min val="0"' in vbar and 'crosses val="max"' not in vbar and "maxMin" not in bar
    assert "<min " not in line  # line charts keep automatic scaling
    # Data unchanged: every chart still reads its own sheet's cells.
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    tk = [n for n in wb.sheetnames if n.startswith("TK")]
    assert len(tk) == 4 and [r[0] for r in wb[tk[0]].iter_rows(min_row=5, values_only=True)][:8] == [g["label"] for g in many]


def test_prepare_then_http_download_is_the_same_file(client):
    """Download fix (Windows 10 + Edge 19/11): the page gets a URL and the browser downloads the
    report with an ordinary GET (Content-Disposition: attachment), not from a blob: URL."""
    ds = _upload(client)
    direct = client.post(f"/api/datasets/{ds}/export/docx", json=_payload())
    for fmt, media in (("xlsx", "spreadsheetml"), ("pdf", "application/pdf"), ("docx", "wordprocessingml")):
        prep = client.post(f"/api/datasets/{ds}/export/{fmt}/prepare", json=_payload())
        assert prep.status_code == 200, prep.text
        j = prep.json()
        assert j["url"] == f"/api/exports/{j['token']}" and j["filename"].endswith("." + fmt) and j["rows"] == 2
        assert j["filename"].startswith("BaoCao_DoanhThuQuyI_")
        a, b = client.get(j["url"]), client.get(j["url"])  # "Tải lại" = the very same file
        assert a.status_code == 200 and a.content == b.content and len(a.content) == j["size"] > 0
        assert media in a.headers["content-type"]
        assert a.headers["content-disposition"].startswith(f'attachment; filename="{j["filename"]}"')
        assert a.headers["cache-control"] == "no-store"
        if fmt == "pdf":
            assert client.get(j["url"] + "?inline=true").headers["content-disposition"].startswith("inline;")
        if fmt == "docx":
            assert len(a.content) == len(direct.content)  # same builder as the direct endpoint
    wb = openpyxl.load_workbook(io.BytesIO(client.get(client.post(f"/api/datasets/{ds}/export/xlsx/prepare", json=_payload()).json()["url"]).content))
    assert "Dữ liệu chi tiết" in wb.sheetnames


def test_prepare_refusals_and_unknown_token(client):
    ds = _upload(client)
    bad = client.post(f"/api/datasets/{ds}/export/pdf/prepare", json=_payload(revenue=1))
    assert bad.status_code == 422 and "Làm mới dữ liệu" in bad.json()["detail"]  # no file, no token
    assert client.post("/api/datasets/khongco/export/pdf/prepare", json=_payload()).status_code == 404
    r = client.get("/api/exports/khong-co-token")
    assert r.status_code == 404 and "hết hạn" in r.json()["detail"]


def test_download_store_expires_and_bounds_memory(monkeypatch):
    from excel_dashboard import downloads

    downloads._items.clear()
    t = downloads.put(b"x" * 10, "pdf", "a.pdf", 1)
    assert downloads.get(t)["filename"] == "a.pdf"
    monkeypatch.setattr(downloads.time, "time", lambda: 10 ** 12)
    assert downloads.get(t) is None  # expired
    monkeypatch.undo()
    monkeypatch.setattr(downloads, "MAX_BYTES", 25)
    t1 = downloads.put(b"1" * 10, "pdf", "1.pdf", 1)
    t2 = downloads.put(b"2" * 10, "pdf", "2.pdf", 1)
    t3 = downloads.put(b"3" * 10, "pdf", "3.pdf", 1)
    assert downloads.get(t1) is None and downloads.get(t2) and downloads.get(t3)
    big = downloads.put(b"9" * 100, "xlsx", "big.xlsx", 1)  # the newest file is always kept
    assert downloads.get(big) is not None
    downloads._items.clear()


def test_page_uses_http_downloads_not_blob_urls():
    js = (Path(__file__).resolve().parents[1] / "excel_dashboard" / "static" / "app.js").read_text(encoding="utf-8")
    assert "createObjectURL" not in js and "/prepare`" in js
    assert "thành công: ${name}" not in js  # no "saved" claim: the page cannot know what the user chose


# ---------------------------------------------------------------------------
# Windows acceptance 23/11 (Phụ lục 2 … 10.2026.signed.xls): exports after the first one failed
# ---------------------------------------------------------------------------


def _upload_rows(client, header, rows, name="pl2.csv"):
    import csv as _csv

    buf = io.StringIO()
    w = _csv.writer(buf, delimiter=";")
    w.writerow(header)
    w.writerows(rows)
    res = client.post("/api/datasets", files={"file": (name, buf.getvalue().encode("utf-8"))}, data={"title": "Phụ lục 2 Bảng tổng hợp 10.2026"})
    assert res.status_code == 201, res.text
    ds = res.json()["id"]
    return ds, client.get(f"/api/datasets/{ds}").json()["sheets"][0]


def _get_all(client, ds, body, formats):
    out = []
    for fmt in formats:
        prep = client.post(f"/api/datasets/{ds}/export/{fmt}/prepare", json=body)
        assert prep.status_code == 200, (fmt, prep.status_code, prep.text[:300])
        f = client.get(prep.json()["url"])
        assert f.status_code == 200 and len(f.content) == prep.json()["size"] > 0
        out.append((fmt, prep.json()["token"], f.content))
    return out


def test_word_export_with_control_characters_from_xls(client):
    """Cells of old .xls files can hold control characters (vertical tab, bell...); python-docx
    refused them and the Word export answered HTTP 500."""
    ds, sh = _upload_rows(client, ["STT", "Nội dung", "Ghi chú", "Điểm"],
                          [[1, "Chỉ tiêu 1", "Dòng\x0bxuống", 8], [2, "Chỉ tiêu 2", "\x07bell & <b>", 9], [3, "Chỉ tiêu\x01 3", "ok", 7]])
    files = _get_all(client, ds, {"sheet": sh["name"]}, ["docx", "pdf", "xlsx"])
    d = docx.Document(io.BytesIO(files[0][2]))
    cells = [c.text for t in d.tables for r in t.rows for c in r.cells]
    assert "Dòng xuống" in cells and "Chỉ tiêu  3" in cells  # control character -> space, text kept


def test_long_headers_and_labels_do_not_block_any_format(client):
    """Real report headers are long; a 300/500-character limit rejected Excel, PDF and Word (HTTP 422)."""
    long_h = ("Tỷ lệ phần trăm số bản tin an toàn hàng hải MSI được phát đúng giờ theo kế hoạch trên các kênh "
              "MF/HF/VHF/DSC/NAVTEX ") * 3
    long_v = "Đài thông tin duyên hải Cà Mau — " + "đạt yêu cầu về thời gian, nội dung và chất lượng âm thanh; " * 10
    rows = [[i, 90 + i % 5, long_v if i % 2 else "Đài B", 8] for i in range(1, 21)]
    ds, sh = _upload_rows(client, ["STT", long_h, "Đơn vị", "Điểm"], rows)
    meas = sh["columns"][1]["name"]
    assert len(meas) > 300 and len(long_v) > 500
    total_a = sum(r[1] for r in rows if r[2] == long_v)
    chart = {"id": "a", "title": f"Tổng {meas} theo Đơn vị", "type": "hbar", "dimension": "Đơn vị", "measure": meas, "agg": "sum",
             "dimension_label": "Đơn vị", "value_label": f"Tổng {meas}",
             "groups": [{"label": long_v, "value": total_a}, {"label": "Đài B", "value": sum(r[1] for r in rows) - total_a}]}
    kpi = {"label": f"Tổng {meas}", "value": sum(r[1] for r in rows), "mode": "sum", "column": meas}
    files = _get_all(client, ds, {"sheet": sh["name"], "charts": [chart], "kpis": [kpi]}, ["xlsx", "pdf", "docx"])
    wb = openpyxl.load_workbook(io.BytesIO(files[0][2]))
    assert wb.sheetnames[0] == "Tổng quan" and len(wb.sheetnames[1]) <= 31 and wb["Dữ liệu chi tiết"].max_row == 4 + 20


def test_consecutive_exports_each_give_their_own_file(client):
    """Excel x3 -> PDF -> Word -> Excel: every export answers 200, gets its own token, and 'Tải lại'
    (a second GET of the same token) returns that export's bytes, not another one's."""
    ds = _upload(client)
    seq = ["xlsx", "xlsx", "xlsx", "pdf", "docx", "xlsx", "pdf", "docx"]
    files = _get_all(client, ds, _payload(), seq)
    assert len({t for _, t, _ in files}) == len(seq)
    for fmt, token, content in files:
        again = client.get(f"/api/exports/{token}")
        assert again.content == content and again.headers["content-disposition"].endswith(f".{fmt}")
    assert files[3][2].startswith(b"%PDF") and files[4][2].startswith(b"PK") and files[0][2].startswith(b"PK")


def test_validation_errors_are_vietnamese_and_name_the_field(client):
    ds = _upload(client)
    bad = client.post(f"/api/datasets/{ds}/export/pdf/prepare", json={"sheet": "Doanh thu", "scope": "khong-co"})
    assert bad.status_code == 422
    detail = bad.json()["detail"]
    assert isinstance(detail, str) and detail.startswith("Dữ liệu gửi lên máy chủ không hợp lệ") and "scope" in detail


def test_client_log_endpoint_and_export_log_lines(client, caplog):
    import logging

    log = logging.getLogger("excel_dashboard.export")
    log.propagate = True
    try:
        with caplog.at_level(logging.INFO, logger="excel_dashboard.export"):
            assert client.post("/api/client-log", json={"event": "export-click", "detail": "xlsx sheet=TTXLTTHH"}).status_code == 204
            ds = _upload(client)
            tok = client.post(f"/api/datasets/{ds}/export/docx/prepare", json=_payload()).json()["token"]
            client.get(f"/api/exports/{tok}")
    finally:
        log.propagate = False
    text = caplog.text
    assert "TRINH DUYET export-click xlsx sheet=TTXLTTHH" in text and "TAO dataset=" in text and "fmt=docx" in text
    assert f"TAI token={tok[:8]}" in text
