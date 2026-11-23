"""Excel Dashboard web app.

Staff upload an Excel/CSV file; the server parses it, infers column types
and roles, and stores it. The browser then builds a dashboard automatically
(KPIs, trend, breakdowns, distribution, data table) and lets staff add
their own charts, which are saved per dataset and shared with everyone.

Run:  uvicorn excel_dashboard.main:app --host 0.0.0.0 --port 8000
"""
import logging
import os
import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Literal, Optional

from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from excel_dashboard import downloads, export, storage
from excel_dashboard.parser import SpreadsheetError, parse_spreadsheet

MAX_UPLOAD_BYTES = int(os.environ.get("EXCEL_DASHBOARD_MAX_MB", "20")) * 1024 * 1024
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Excel Dashboard")

# Export diagnostics: one line per export step (also browser-side events sent to
# /api/client-log), written to stderr so it lands in the server log file.
log = logging.getLogger("excel_dashboard.export")
if not log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s [XUAT] %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    """Readable Vietnamese message instead of pydantic's English list (which the page showed as-is)."""
    parts = []
    for e in exc.errors()[:3]:
        where = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        parts.append(f"{where}: {e.get('msg')}")
    detail = "Dữ liệu gửi lên máy chủ không hợp lệ (" + "; ".join(parts) + "). Hãy bấm Làm mới dữ liệu rồi thử lại."
    if "/export/" in request.url.path:
        log.warning("422 %s %s", request.url.path, detail)
    return JSONResponse(status_code=422, content={"detail": detail})


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
    t0 = time.time()
    where = (f"dataset={dataset_id} fmt={fmt} sheet={req.sheet!r} scope={req.scope} "
             f"rows_selected={'all' if req.row_indices is None else len(req.row_indices)} charts={len(req.charts)} "
             f"images={sum(1 for c in req.charts if c.image)}")
    try:
        report = export.build_report(meta, sheets, req, fmt)
    except export.ExportError as exc:
        log.warning("TU CHOI %s: %s", where, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        content = export.BUILDERS[fmt](report)
    except Exception as exc:  # noqa: BLE001 — report the real cause instead of an opaque HTTP 500
        code = uuid.uuid4().hex[:8]
        log.error("LOI %s ma=%s: %s\n%s", where, code, exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Lỗi máy chủ khi tạo file {fmt.upper()} (mã lỗi {code}): "
                                                     f"{type(exc).__name__}: {exc}. Xem log máy chủ.") from exc
    filename = export.report_filename(meta["title"], fmt, report.generated_at)
    log.info("TAO %s rows=%s size=%s file=%s %.2fs", where, report.row_count, len(content), filename, time.time() - t0)
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
    log.info("SAN SANG token=%s… file=%s", token[:8], filename)
    return {"token": token, "url": f"/api/exports/{token}", "filename": filename, "size": len(content), "rows": rows,
            "expires_in": downloads.TTL_SECONDS}


@app.get("/api/exports/{token}")
def get_export(token: str, inline: bool = Query(False, description="PDF preview inside the page")):
    item = downloads.get(token)
    if item is None:
        log.warning("TAI token=%s… KHONG CO (het han hoac sai)", token[:8])
        raise HTTPException(status_code=404, detail="File báo cáo đã hết hạn hoặc không tồn tại. Hãy bấm Xuất lại.")
    log.info("TAI token=%s… file=%s size=%s%s", token[:8], item["filename"], len(item["content"]), " (xem truoc)" if inline else "")
    return _file_response(item["content"], item["fmt"], item["filename"], item["rows"], inline)


class ClientLog(BaseModel):
    event: str = Field(..., max_length=100)
    detail: str = Field("", max_length=2000)


@app.post("/api/client-log", status_code=204)
def client_log(entry: ClientLog):
    """Browser-side export events (click, server answer, download started, JS errors), so the
    server log shows what happened in the user's browser too."""
    log.info("TRINH DUYET %s %s", entry.event, entry.detail.replace("\n", " ")[:2000])
    return Response(status_code=204)


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
