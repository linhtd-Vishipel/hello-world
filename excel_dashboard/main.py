"""Excel Dashboard web app.

Staff upload an Excel/CSV file; the server parses it, infers column types
and roles, and stores it. The browser then builds a dashboard automatically
(KPIs, trend, breakdowns, distribution, data table) and lets staff add
their own charts, which are saved per dataset and shared with everyone.

Run:  uvicorn excel_dashboard.main:app --host 0.0.0.0 --port 8000
"""
import os
from pathlib import Path
from typing import Literal, Optional

from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from excel_dashboard import downloads, export, storage
from excel_dashboard.parser import SpreadsheetError, parse_spreadsheet

MAX_UPLOAD_BYTES = int(os.environ.get("EXCEL_DASHBOARD_MAX_MB", "20")) * 1024 * 1024
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Excel Dashboard")


class ChartSpec(BaseModel):
    id: str = Field(..., max_length=64)
    title: str = Field("", max_length=200)
    type: Literal["bar", "hbar", "line", "doughnut"]
    dimension: str = Field(..., max_length=300)
    measure: Optional[str] = Field(None, max_length=300)
    agg: Literal["sum", "avg", "count", "min", "max"] = "sum"
    time_grain: Optional[Literal["day", "month", "quarter", "year"]] = None


class DashboardConfig(BaseModel):
    # sheet name -> custom charts added by staff
    charts: dict[str, list[ChartSpec]] = Field(default_factory=dict)


def _not_found():
    return HTTPException(status_code=404, detail="Không tìm thấy bộ dữ liệu")


@app.post("/api/datasets", status_code=201)
async def upload_dataset(
    file: UploadFile = File(...),
    uploader: str = Form("", max_length=100),
    title: str = Form("", max_length=200),
):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="Thiếu tên file")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File vượt quá {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if not content:
        raise HTTPException(status_code=400, detail="File rỗng")
    try:
        sheets = parse_spreadsheet(filename, content)
    except SpreadsheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return storage.save_dataset(filename, content, sheets, uploader.strip(), title.strip())


@app.get("/api/datasets")
def list_datasets():
    return storage.list_datasets()


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    try:
        return {
            "meta": storage.get_meta(dataset_id),
            "sheets": storage.get_sheets(dataset_id),
            "dashboard": storage.get_dashboard(dataset_id),
        }
    except KeyError:
        raise _not_found()


@app.put("/api/datasets/{dataset_id}/dashboard")
def save_dashboard(dataset_id: str, config: DashboardConfig):
    try:
        return storage.save_dashboard(dataset_id, config.model_dump())
    except KeyError:
        raise _not_found()


@app.get("/api/datasets/{dataset_id}/file")
def download_original(dataset_id: str):
    try:
        meta = storage.get_meta(dataset_id)
        path = storage.original_path(dataset_id)
    except KeyError:
        raise _not_found()
    return FileResponse(path, filename=meta["filename"])


def _build_export(dataset_id: str, fmt: str, req: export.ExportRequest):
    """(content, filename, rows) of a real report file built from what the dashboard shows."""
    try:
        meta = storage.get_meta(dataset_id)
        sheets = storage.get_sheets(dataset_id)
    except KeyError:
        raise _not_found()
    try:
        report = export.build_report(meta, sheets, req, fmt)
    except export.ExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    content = export.BUILDERS[fmt](report)
    filename = export.report_filename(meta["title"], fmt, report.generated_at)
    return content, filename, report.row_count


def _file_response(content: bytes, fmt: str, filename: str, rows: int, inline: bool = False):
    disposition = "inline" if inline and fmt == "pdf" else "attachment"
    return Response(
        content,
        media_type=export.MEDIA_TYPES[fmt],
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}',
            "Cache-Control": "no-store",
            "X-Report-Rows": str(rows),
        },
    )


@app.post("/api/datasets/{dataset_id}/export/{fmt}")
def export_report(
    dataset_id: str,
    fmt: Literal["xlsx", "pdf", "docx"],
    req: export.ExportRequest,
    inline: bool = Query(False, description="Content-Disposition inline (PDF preview)"),
):
    """Build a real report file from the rows/KPIs/charts the dashboard is
    showing. Returns the file bytes with a download filename
    BaoCao_<TenBaoCao>_<YYYYMMDD>_<HHMM>.<ext>."""
    content, filename, rows = _build_export(dataset_id, fmt, req)
    return _file_response(content, fmt, filename, rows, inline)


@app.post("/api/datasets/{dataset_id}/export/{fmt}/prepare")
def prepare_export(dataset_id: str, fmt: Literal["xlsx", "pdf", "docx"], req: export.ExportRequest):
    """Build the report and keep it on the server for a short time. The page then
    lets the browser download it from GET /api/exports/<token> — an ordinary HTTP
    download (Content-Disposition: attachment) that follows the browser's own
    download settings (download folder, "ask where to save", Ctrl+J list)."""
    content, filename, rows = _build_export(dataset_id, fmt, req)
    token = downloads.put(content, fmt, filename, rows)
    return {"token": token, "url": f"/api/exports/{token}", "filename": filename, "size": len(content), "rows": rows,
            "expires_in": downloads.TTL_SECONDS}


@app.get("/api/exports/{token}")
def get_export(token: str, inline: bool = Query(False, description="PDF preview inside the page")):
    item = downloads.get(token)
    if item is None:
        raise HTTPException(status_code=404, detail="File báo cáo đã hết hạn hoặc không tồn tại. Hãy bấm Xuất lại.")
    return _file_response(item["content"], item["fmt"], item["filename"], item["rows"], inline)


@app.delete("/api/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str):
    try:
        storage.delete_dataset(dataset_id)
    except KeyError:
        raise _not_found()


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
