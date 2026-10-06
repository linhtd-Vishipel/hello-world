import io
from datetime import datetime

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
