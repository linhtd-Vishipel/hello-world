"""Report export: builds real .xlsx / .pdf / .docx files from what the
dashboard is showing.

The browser sends the exact row indices left after its filters, date
range, search and sort, plus the KPI values and chart groups it rendered
(and chart images for PDF/Word). The server re-reads the stored rows by
index and independently recomputes the KPIs and chart totals from them;
if anything disagrees, the export is refused instead of producing a
report that differs from the dashboard (see `verify`).
"""
import base64
import io
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

FONT_DIR = Path(__file__).parent / "fonts"
PDF_MAX_DETAIL_ROWS = int(os.environ.get("EXCEL_DASHBOARD_PDF_MAX_ROWS", "20000"))
DOCX_MAX_DETAIL_ROWS = int(os.environ.get("EXCEL_DASHBOARD_DOCX_MAX_ROWS", "5000"))
MAX_IMAGE_BYTES = 4 * 1024 * 1024

MEDIA_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

ACCENT = "1F5FAD"
ACCENT_LIGHT = "DCE8F7"
ZEBRA = "F5F8FC"
BORDER = "B7C4D6"
SERIES = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"]
OTHER = "A3A29C"


class ExportError(ValueError):
    """Request cannot be exported; message is shown to the user."""


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class FilterItem(BaseModel):
    label: str = Field(..., max_length=300)
    value: str = Field(..., max_length=500)


class KpiItem(BaseModel):
    label: str = Field(..., max_length=300)
    value: Optional[float] = None
    sub: str = Field("", max_length=300)
    column: Optional[str] = Field(None, max_length=300)
    mode: Literal["count", "sum", "avg"]


class GroupItem(BaseModel):
    label: str = Field(..., max_length=500)
    value: Optional[float] = None
    other: bool = False


class ChartItem(BaseModel):
    id: str = Field(..., max_length=64)
    title: str = Field(..., max_length=300)
    type: Literal["bar", "hbar", "line", "doughnut", "hist"]
    dimension: str = Field(..., max_length=300)
    measure: Optional[str] = Field(None, max_length=300)
    agg: Literal["sum", "avg", "count", "min", "max"]
    dimension_label: str = Field(..., max_length=300)
    value_label: str = Field(..., max_length=300)
    groups: list[GroupItem] = Field(default_factory=list, max_length=5000)
    image: Optional[str] = None  # data:image/png;base64,...


class Sections(BaseModel):
    overview: bool = True
    stats: bool = True
    detail: bool = True


class ExportRequest(BaseModel):
    sheet: str = Field(..., max_length=300)
    author: str = Field("", max_length=100)
    scope: Literal["current", "all_sheets"] = "current"
    sections: Sections = Field(default_factory=Sections)
    # Indices into the stored sheet rows, in display order. None = all rows.
    row_indices: Optional[list[int]] = None
    filters: list[FilterItem] = Field(default_factory=list, max_length=50)
    kpis: list[KpiItem] = Field(default_factory=list, max_length=20)
    charts: list[ChartItem] = Field(default_factory=list, max_length=50)


# ---------------------------------------------------------------------------
# Report context
# ---------------------------------------------------------------------------


@dataclass
class DetailTable:
    name: str
    columns: list  # column info dicts from the parser
    rows: list


@dataclass
class Report:
    title: str
    meta: dict
    sheet_name: str
    author: str
    generated_at: datetime
    filters: list
    kpis: list
    charts: list
    details: list = field(default_factory=list)  # list[DetailTable]
    row_count: int = 0
    total_rows: int = 0
    sections: Sections = field(default_factory=Sections)


def report_tz():
    name = os.environ.get("EXCEL_DASHBOARD_TZ", "Asia/Ho_Chi_Minh")
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # tzdata missing (e.g. Windows without tzdata package)
        return timezone(timedelta(hours=7), "UTC+07")


def _slug(title: str) -> str:
    title = title.replace("đ", "d").replace("Đ", "D")
    ascii_ = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    words = re.findall(r"[A-Za-z0-9]+", ascii_)
    slug = "".join(w[:1].upper() + w[1:] for w in words)
    return slug[:60] or "BaoCao"


def report_filename(title: str, ext: str, now: datetime) -> str:
    """BaoCao_TenBaoCao_YYYYMMDD_HHMM.ext"""
    return f"BaoCao_{_slug(title)}_{now:%Y%m%d_%H%M}.{ext}"


def _find_sheet(sheets, name):
    for s in sheets:
        if s["name"] == name:
            return s
    raise ExportError(f'Không tìm thấy sheet "{name}" trong bộ dữ liệu. Hãy bấm Làm mới dữ liệu.')


def _select_rows(sheet, indices):
    rows = sheet["rows"]
    if indices is None:
        return list(rows)
    n = len(rows)
    if len(set(indices)) != len(indices) or any(i < 0 or i >= n for i in indices):
        raise ExportError("Danh sách dòng không hợp lệ so với dữ liệu trên máy chủ. Hãy bấm Làm mới dữ liệu.")
    return [rows[i] for i in indices]


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6)


def verify(sheet, rows, req: ExportRequest):
    """Recompute KPIs and additive chart totals from the selected rows and
    refuse the export if they differ from what the dashboard displayed."""
    col_idx = {c["name"]: i for i, c in enumerate(sheet["columns"])}
    for k in req.kpis:
        if k.mode == "count":
            expected = float(len(rows))
        else:
            if k.column not in col_idx:
                raise ExportError(f'Chỉ số "{k.label}" tham chiếu cột không tồn tại.')
            i = col_idx[k.column]
            vals = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
            if not vals:
                expected = None
            elif k.mode == "sum":
                expected = float(sum(vals))
            else:
                expected = sum(vals) / len(vals)
        if not _close(expected, k.value):
            raise ExportError(
                f'Số liệu "{k.label}" trên Dashboard ({k.value}) khác dữ liệu máy chủ ({expected}). '
                "Hãy bấm Làm mới dữ liệu rồi xuất lại."
            )
    for c in req.charts:
        if c.agg not in ("sum", "count") or not c.groups:
            continue
        total = sum(g.value or 0 for g in c.groups)
        if c.type == "hist":
            i = col_idx.get(c.measure)
            expected = float(sum(1 for r in rows if i is not None and isinstance(r[i], (int, float))))
        elif c.agg == "count" or not c.measure:
            expected = float(len(rows))
        else:
            i = col_idx.get(c.measure)
            if i is None:
                raise ExportError(f'Biểu đồ "{c.title}" tham chiếu cột không tồn tại.')
            expected = float(sum(r[i] for r in rows if isinstance(r[i], (int, float))))
        if not _close(expected, total):
            raise ExportError(
                f'Tổng của biểu đồ "{c.title}" không khớp dữ liệu máy chủ. Hãy bấm Làm mới dữ liệu rồi xuất lại.'
            )


def build_report(meta: dict, sheets: list, req: ExportRequest, fmt: str) -> Report:
    s = req.sections
    if not (s.overview or s.stats or s.detail):
        raise ExportError("Chưa chọn nội dung nào để xuất.")
    now = datetime.now(report_tz())
    if req.scope == "all_sheets":
        if fmt != "xlsx":
            raise ExportError("Xuất toàn bộ các sheet chỉ hỗ trợ định dạng Excel.")
        details = [DetailTable(sh["name"], sh["columns"], list(sh["rows"])) for sh in sheets]
        total = sum(len(d.rows) for d in details)
        if total == 0:
            raise ExportError("Bộ dữ liệu không có dòng nào để xuất.")
        return Report(
            title=meta["title"], meta=meta, sheet_name="Tất cả sheet", author=req.author.strip(),
            generated_at=now, filters=[], kpis=[], charts=[], details=details,
            row_count=total, total_rows=total, sections=Sections(overview=True, stats=False, detail=True),
        )

    sheet = _find_sheet(sheets, req.sheet)
    rows = _select_rows(sheet, req.row_indices)
    if not rows:
        raise ExportError("Không có dữ liệu phù hợp với bộ lọc hiện tại. Hãy đổi bộ lọc trước khi xuất báo cáo.")
    verify(sheet, rows, req)
    limit = {"pdf": PDF_MAX_DETAIL_ROWS, "docx": DOCX_MAX_DETAIL_ROWS}.get(fmt)
    if s.detail and limit and len(rows) > limit:
        raise ExportError(
            f"Dữ liệu chi tiết có {len(rows):,} dòng, vượt giới hạn {limit:,} dòng của file {fmt.upper()}. "
            "Hãy xuất Excel (không giới hạn), lọc bớt dữ liệu, hoặc bỏ chọn mục Dữ liệu chi tiết.".replace(",", ".")
        )
    return Report(
        title=meta["title"], meta=meta, sheet_name=sheet["name"], author=req.author.strip(),
        generated_at=now, filters=req.filters, kpis=req.kpis, charts=req.charts,
        details=[DetailTable(sheet["name"], sheet["columns"], rows)] if s.detail else [],
        row_count=len(rows), total_rows=len(sheet["rows"]), sections=s,
    )


# ---------------------------------------------------------------------------
# Formatting helpers (match the dashboard: vi-VN, max 2 decimals)
# ---------------------------------------------------------------------------


def fmt_num(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer()):
        s = f"{int(v):,}"
    else:
        s = f"{v:,.2f}".rstrip("0").rstrip(".")
    return s.replace(",", "\0").replace(".", ",").replace("\0", ".")


def fmt_date(iso) -> str:
    if not iso:
        return ""
    d, _, t = str(iso).partition("T")
    y, m, dd = d.split("-")
    return f"{dd}/{m}/{y}" + (f" {t[:5]}" if t and t != "00:00:00" else "")


def fmt_cell(v, col) -> str:
    if v is None:
        return ""
    if col["type"] == "date":
        return fmt_date(v)
    if isinstance(v, (int, float)):
        return fmt_num(v)
    return str(v)


def _decimals(v: float) -> int:
    r = repr(v)
    if "e" in r:
        return 99
    return len(r.split(".")[1]) if "." in r else 0


def _share(chart, g):
    if chart.agg not in ("sum", "count") or chart.type == "line":
        return None
    total = sum(x.value or 0 for x in chart.groups)
    if not total or g.value is None:
        return None
    return g.value / total


def _stat_total(chart):
    if chart.agg in ("sum", "count") and chart.groups:
        return sum(g.value or 0 for g in chart.groups)
    return None


def _decode_image(data_url):
    if not data_url or not data_url.startswith("data:image/png;base64,"):
        return None
    raw = base64.b64decode(data_url.split(",", 1)[1], validate=False)
    if len(raw) > MAX_IMAGE_BYTES or not raw.startswith(b"\x89PNG"):
        return None
    return raw


def _info_rows(rep: Report):
    m = rep.meta
    return [
        ("Tên báo cáo", rep.title),
        ("Sheet dữ liệu", rep.sheet_name),
        ("File nguồn", m.get("filename", "")),
        ("Người tải dữ liệu", m.get("uploader") or "Ẩn danh"),
        ("Người lập báo cáo", rep.author or "—"),
        ("Thời gian lập", rep.generated_at.strftime("%d/%m/%Y %H:%M")),
        ("Số dòng trong báo cáo", f"{fmt_num(rep.row_count)} / {fmt_num(rep.total_rows)} dòng"),
    ]


def _filter_rows(rep: Report):
    return [(f.label, f.value) for f in rep.filters] or [("Bộ lọc", "Không lọc — toàn bộ dữ liệu")]


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------


def to_xlsx(rep: Report) -> bytes:
    from openpyxl import Workbook
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    from openpyxl.styles import Alignment, Border, Font, NamedStyle, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    thin = Side(style="thin", color=BORDER)
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    title_font = Font(name="Arial", size=16, bold=True, color=ACCENT)
    sub_font = Font(name="Arial", size=10, italic=True, color="52514E")
    h2_font = Font(name="Arial", size=12, bold=True, color=ACCENT)

    hdr = NamedStyle(name="hdr")
    hdr.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    hdr.fill = PatternFill("solid", fgColor=ACCENT)
    hdr.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    hdr.border = border
    wb.add_named_style(hdr)
    for name, fill in (("cell", None), ("cell_z", ZEBRA)):
        st = NamedStyle(name=name)
        st.font = Font(name="Arial", size=10)
        st.border = border
        st.alignment = Alignment(vertical="top")
        if fill:
            st.fill = PatternFill("solid", fgColor=fill)
        wb.add_named_style(st)
    total_font = Font(name="Arial", size=10, bold=True)
    total_fill = PatternFill("solid", fgColor=ACCENT_LIGHT)

    def clean(v):
        return ILLEGAL_CHARACTERS_RE.sub("", v) if isinstance(v, str) else v

    def put(ws, r, c, v, style=None, fmt=None):
        cell = ws.cell(row=r, column=c, value=clean(v))
        if isinstance(v, str) and v.startswith("="):
            cell.data_type = "s"  # never let file content become a formula
        if style:
            cell.style = style
        if fmt:
            cell.number_format = fmt
        return cell

    def title_block(ws, title, subtitle, width):
        put(ws, 1, 1, title).font = title_font
        put(ws, 2, 1, subtitle).font = sub_font
        ws.row_dimensions[1].height = 24
        if width > 1:
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(width, 4))

    def autosize(ws, widths, min_w=8, max_w=60):
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = max(min_w, min(max_w, w + 2))

    used_names = set()

    def sheet_name(base):
        base = re.sub(r"[\[\]:*?/\\]", " ", base).strip()[:31] or "Sheet"
        name, n = base, 2
        while name.lower() in used_names:
            suffix = f" ({n})"
            name = base[: 31 - len(suffix)] + suffix
            n += 1
        used_names.add(name.lower())
        return name

    filt_text = "; ".join(f"{a}: {b}" for a, b in _filter_rows(rep))
    subtitle = f"Lập lúc {rep.generated_at:%d/%m/%Y %H:%M} · {filt_text}"

    # ---- Overview -------------------------------------------------------
    ws = wb.active
    ws.title = sheet_name("Tổng quan")
    title_block(ws, f"BÁO CÁO: {rep.title.upper()}", f"Lập lúc {rep.generated_at:%d/%m/%Y %H:%M}", 3)
    r = 4
    put(ws, r, 1, "THÔNG TIN BÁO CÁO").font = h2_font
    r += 1
    for k, v in _info_rows(rep):
        put(ws, r, 1, k, "cell").font = total_font
        put(ws, r, 2, v, "cell")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
        r += 1
    r += 1
    put(ws, r, 1, "ĐIỀU KIỆN LỌC").font = h2_font
    r += 1
    for k, v in _filter_rows(rep):
        put(ws, r, 1, k, "cell").font = total_font
        put(ws, r, 2, v, "cell")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
        r += 1
    if rep.sections.overview and rep.kpis:
        r += 1
        put(ws, r, 1, "CHỈ SỐ TỔNG HỢP").font = h2_font
        r += 1
        for c, h in enumerate(("Chỉ số", "Giá trị", "Ghi chú"), start=1):
            put(ws, r, c, h, "hdr")
        r += 1
        for i, k in enumerate(rep.kpis):
            st = "cell_z" if i % 2 else "cell"
            put(ws, r, 1, k.label, st)
            v = int(k.value) if k.value is not None and float(k.value).is_integer() else k.value
            put(ws, r, 2, v, st, "#,##0" if isinstance(v, int) else "#,##0.00")
            put(ws, r, 3, k.sub, st)
            r += 1
    autosize(ws, [28, 40, 40])

    # ---- Stats sheets with native charts ---------------------------------
    if rep.sections.stats:
        from openpyxl.chart import BarChart, LineChart, PieChart, Reference
        from openpyxl.chart.series import DataPoint

        for n, ch in enumerate(rep.charts, start=1):
            if not ch.groups:
                continue
            ws = wb.create_sheet(sheet_name(f"TK{n:02d} {ch.title}"))
            title_block(ws, ch.title, subtitle, 3)
            has_share = any(_share(ch, g) is not None for g in ch.groups)
            heads = [ch.dimension_label, ch.value_label] + (["Tỷ trọng"] if has_share else [])
            hr = 4
            for c, h in enumerate(heads, start=1):
                put(ws, hr, c, h, "hdr")
            r = hr + 1
            for i, g in enumerate(ch.groups):
                st = "cell_z" if i % 2 else "cell"
                put(ws, r, 1, g.label, st)
                v = g.value
                is_int = v is not None and float(v).is_integer()
                put(ws, r, 2, int(v) if is_int else v, st, "#,##0" if is_int else "#,##0.00")
                if has_share:
                    put(ws, r, 3, _share(ch, g), st, "0.0%")
                r += 1
            last = r - 1
            total = _stat_total(ch)
            if total is not None:
                put(ws, r, 1, "Tổng cộng", "cell").font = total_font
                put(ws, r, 2, total, "cell", "#,##0" if float(total).is_integer() else "#,##0.00").font = total_font
                if has_share:
                    put(ws, r, 3, 1, "cell", "0.0%").font = total_font
                for c in range(1, len(heads) + 1):
                    ws.cell(row=r, column=c).fill = total_fill
            ws.freeze_panes = ws.cell(row=hr + 1, column=1)
            ws.auto_filter.ref = f"A{hr}:{get_column_letter(len(heads))}{last}"
            autosize(ws, [max(len(heads[0]), *(len(g.label) for g in ch.groups)), max(14, len(heads[1])), 12])

            if ch.type == "doughnut":
                chart = PieChart()
            elif ch.type == "line":
                chart = LineChart()
            else:
                chart = BarChart()
                chart.type = "bar" if ch.type == "hbar" else "col"
                chart.gapWidth = 10 if ch.type == "hist" else 60
                if ch.type == "hbar":
                    chart.x_axis.scaling.orientation = "maxMin"
            chart.title = ch.title
            chart.width = 18
            chart.height = max(9, min(30, 0.6 * len(ch.groups) + 3)) if ch.type == "hbar" else 9
            data = Reference(ws, min_col=2, min_row=hr, max_row=last)
            cats = Reference(ws, min_col=1, min_row=hr + 1, max_row=last)
            chart.add_data(data, titles_from_data=True)
            chart.set_categories(cats)
            s0 = chart.series[0]
            if ch.type == "doughnut":
                for i, g in enumerate(ch.groups):
                    pt = DataPoint(idx=i)
                    pt.graphicalProperties.solidFill = OTHER if g.other else SERIES[i % len(SERIES)]
                    s0.dPt.append(pt)
            else:
                chart.legend = None
                if ch.type == "line":
                    s0.graphicalProperties.line.solidFill = SERIES[0]
                    s0.graphicalProperties.line.width = 22000
                    s0.smooth = False
                else:
                    s0.graphicalProperties.solidFill = SERIES[0]
                    s0.graphicalProperties.line.noFill = True
                chart.x_axis.delete = False
                chart.y_axis.delete = False
            ws.add_chart(chart, f"{get_column_letter(len(heads) + 2)}{hr}")

    # ---- Detail data ------------------------------------------------------
    for d in rep.details:
        name = "Dữ liệu chi tiết" if len(rep.details) == 1 else f"DL {d.name}"
        ws = wb.create_sheet(sheet_name(name))
        ncol = len(d.columns)
        title_block(ws, f"DỮ LIỆU CHI TIẾT — {d.name}", f"{subtitle} · {fmt_num(len(d.rows))} dòng", ncol)
        hr = 4
        for c, col in enumerate(d.columns, start=1):
            put(ws, hr, c, col["name"], "hdr")
        fmts, widths = [], []
        for ci, col in enumerate(d.columns):
            vals = [row[ci] for row in d.rows]
            if col["type"] == "date":
                has_time = any(v and not str(v).endswith("T00:00:00") for v in vals)
                fmts.append("dd/mm/yyyy hh:mm" if has_time else "dd/mm/yyyy")
                widths.append(17 if has_time else 12)
            elif col["type"] == "number":
                nums = [v for v in vals if isinstance(v, (int, float))]
                if all(isinstance(v, int) for v in nums):
                    fmts.append("#,##0")
                else:
                    decimals = max(_decimals(v) for v in nums if isinstance(v, float))
                    fmts.append("#,##0.00" if decimals <= 2 else "General")
                widths.append(max((len(fmt_num(v)) for v in nums[:5000]), default=8))
            else:
                fmts.append(None)
                widths.append(max((len(str(v)) for v in vals[:5000] if v is not None), default=8))
            widths[-1] = max(widths[-1], min(len(col["name"]), 30))
        r = hr + 1
        for i, row in enumerate(d.rows):
            st = "cell_z" if i % 2 else "cell"
            for ci, col in enumerate(d.columns):
                v = row[ci]
                if v is not None and col["type"] == "date":
                    v = datetime.fromisoformat(v)
                put(ws, r, ci + 1, v, st, fmts[ci])
            r += 1
        ws.freeze_panes = ws.cell(row=hr + 1, column=1)
        ws.auto_filter.ref = f"A{hr}:{get_column_letter(ncol)}{max(hr, r - 1)}"
        ws.row_dimensions[hr].height = 30
        autosize(ws, widths)

    for w in wb.worksheets:
        w.sheet_view.showGridLines = False
        w.page_setup.orientation = "landscape"
        w.page_setup.paperSize = w.PAPERSIZE_A4
        w.page_setup.fitToWidth = 1
        w.page_setup.fitToHeight = 0
        w.sheet_properties.pageSetUpPr.fitToPage = True
        w.print_options.horizontalCentered = True
    wb.properties.title = f"Báo cáo {rep.title}"
    wb.properties.creator = rep.author or "Excel Dashboard"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

_fonts_registered = False


def _register_fonts():
    global _fonts_registered
    if _fonts_registered:
        return
    from reportlab.lib.fonts import addMapping
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pdfmetrics.registerFont(TTFont("DejaVu", str(FONT_DIR / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
    addMapping("DejaVu", 0, 0, "DejaVu")
    addMapping("DejaVu", 1, 0, "DejaVu-Bold")
    addMapping("DejaVu", 0, 1, "DejaVu")
    addMapping("DejaVu", 1, 1, "DejaVu-Bold")
    _fonts_registered = True


def _esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def to_pdf(rep: Report) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import (
        BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, NextPageTemplate,
        PageBreak, PageBreakIfNotEmpty, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    _register_fonts()
    accent = colors.HexColor("#" + ACCENT)
    accent_light = colors.HexColor("#" + ACCENT_LIGHT)
    zebra = colors.HexColor("#" + ZEBRA)
    grid = colors.HexColor("#" + BORDER)
    muted = colors.HexColor("#52514E")

    base = ParagraphStyle("base", fontName="DejaVu", fontSize=9.5, leading=12.5)
    st = {
        "title": ParagraphStyle("title", parent=base, fontName="DejaVu-Bold", fontSize=18, leading=23, textColor=accent, alignment=TA_CENTER),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontSize=10, textColor=muted, alignment=TA_CENTER),
        "h1": ParagraphStyle("h1", parent=base, fontName="DejaVu-Bold", fontSize=13, leading=17, textColor=accent, spaceBefore=10, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=base, fontName="DejaVu-Bold", fontSize=10.5, leading=14, spaceBefore=12, spaceAfter=4),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=10.5),
        "cellb": ParagraphStyle("cellb", parent=base, fontName="DejaVu-Bold", fontSize=8.5, leading=10.5),
        "num": ParagraphStyle("num", parent=base, fontSize=8.5, leading=10.5, alignment=TA_RIGHT),
        "hdr": ParagraphStyle("hdr", parent=base, fontName="DejaVu-Bold", fontSize=8.5, leading=10.5, textColor=colors.white),
        "kpi_label": ParagraphStyle("kl", parent=base, fontSize=8, leading=10, textColor=muted),
        "kpi_value": ParagraphStyle("kv", parent=base, fontName="DejaVu-Bold", fontSize=14, leading=18),
        "kpi_sub": ParagraphStyle("ks", parent=base, fontSize=7, leading=9, textColor=muted),
        "note": ParagraphStyle("note", parent=base, fontSize=8, textColor=muted),
    }
    P = lambda text, style="cell": Paragraph(_esc(text), st[style])  # noqa: E731

    margin = 14 * mm
    portrait_size, landscape_size = A4, landscape(A4)
    footer_text = f"{rep.title} · Lập lúc {rep.generated_at:%d/%m/%Y %H:%M}"

    class NumberedCanvas(rl_canvas.Canvas):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            for state in self._saved:
                self.__dict__.update(state)
                w, h = self._pagesize
                self.setFont("DejaVu", 7.5)
                self.setFillColor(muted)
                self.drawString(margin, 8 * mm, footer_text[:120])
                self.drawRightString(w - margin, 8 * mm, f"Trang {self._pageNumber}/{total}")
                self.setStrokeColor(grid)
                self.line(margin, 11 * mm, w - margin, 11 * mm)
                super().showPage()
            super().save()

    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=portrait_size, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=16 * mm,
        title=f"Báo cáo {rep.title}", author=rep.author or "Excel Dashboard", creator="Excel Dashboard",
        initialFontName="DejaVu", initialFontSize=9.5,
    )

    def frame(size):
        return Frame(margin, 16 * mm, size[0] - 2 * margin, size[1] - margin - 16 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def set_size(size):
        return lambda canv, d: canv.setPageSize(size)

    doc.addPageTemplates([
        PageTemplate(id="portrait", frames=[frame(portrait_size)], pagesize=portrait_size, onPage=set_size(portrait_size)),
        PageTemplate(id="landscape", frames=[frame(landscape_size)], pagesize=landscape_size, onPage=set_size(landscape_size)),
    ])
    pw = portrait_size[0] - 2 * margin

    def grid_table(data, widths, header=True, numeric_cols=(), total_row=False):
        t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
        cmds = [
            ("GRID", (0, 0), (-1, -1), 0.4, grid),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("FONTNAME", (0, 0), (-1, -1), "DejaVu"), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ]
        if header:
            cmds += [("BACKGROUND", (0, 0), (-1, 0), accent), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                     ("FONTNAME", (0, 0), (-1, 0), "DejaVu-Bold"), ("VALIGN", (0, 0), (-1, 0), "MIDDLE")]
        start = 1 if header else 0
        for i in range(start, len(data)):
            if (i - start) % 2:
                cmds.append(("BACKGROUND", (0, i), (-1, i), zebra))
        for c in numeric_cols:
            cmds.append(("ALIGN", (c, start), (c, -1), "RIGHT"))
        if total_row:
            cmds += [("BACKGROUND", (0, -1), (-1, -1), accent_light), ("FONTNAME", (0, -1), (-1, -1), "DejaVu-Bold")]
        t.setStyle(TableStyle(cmds))
        return t

    story = [
        Paragraph(_esc(f"BÁO CÁO {rep.title.upper()}"), st["title"]),
        Paragraph(_esc(f"Sheet: {rep.sheet_name} · Lập lúc {rep.generated_at:%H:%M} ngày {rep.generated_at:%d/%m/%Y}"), st["subtitle"]),
        Spacer(1, 6 * mm),
    ]
    sec = 0

    def heading(text):
        nonlocal sec
        sec += 1
        return Paragraph(_esc(f"{sec}. {text}"), st["h1"])

    story.append(heading("Thông tin báo cáo"))
    story.append(grid_table([[P(k, "cellb"), P(v)] for k, v in _info_rows(rep)], [55 * mm, pw - 55 * mm], header=False))
    story.append(Paragraph("Điều kiện lọc áp dụng", st["h2"]))
    story.append(grid_table([[P(k, "cellb"), P(v)] for k, v in _filter_rows(rep)], [55 * mm, pw - 55 * mm], header=False))

    if rep.sections.overview and rep.kpis:
        story.append(heading("Chỉ số tổng hợp"))
        per_row = 3
        cells = [
            [P(k.label, "kpi_label"), Paragraph(_esc(fmt_num(k.value) if k.value is not None else "–"), st["kpi_value"]), P(k.sub, "kpi_sub")]
            for k in rep.kpis
        ]
        while len(cells) % per_row:
            cells.append("")
        rows = [cells[i:i + per_row] for i in range(0, len(cells), per_row)]
        t = Table(rows, colWidths=[pw / per_row] * per_row)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "DejaVu"),
            ("BOX", (0, 0), (-1, -1), 0.4, grid), ("INNERGRID", (0, 0), (-1, -1), 0.4, grid),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFBFD")),
        ]))
        story.append(t)

    if rep.sections.stats and rep.charts:
        # The section heading travels with the first chart so it is never orphaned.
        pending = [heading("Biểu đồ và bảng thống kê")]
        for n, ch in enumerate(rep.charts, start=1):
            if n > 1:
                story.append(CondPageBreak(60 * mm))
            block = pending + [Paragraph(_esc(f"{sec}.{n}. {ch.title}"), st["h2"])]
            pending = []
            raw = _decode_image(ch.image)
            if raw:
                img = Image(io.BytesIO(raw))
                ratio = img.imageHeight / img.imageWidth
                w = pw
                h = min(w * ratio, 120 * mm)
                w = h / ratio
                img.drawWidth, img.drawHeight = w, h
                block.append(img)
                block.append(Spacer(1, 3 * mm))
            if not ch.groups:
                block.append(P("Không có dữ liệu cho biểu đồ này.", "note"))
                story.append(KeepTogether(block))
                continue
            has_share = any(_share(ch, g) is not None for g in ch.groups)
            data = [[P(ch.dimension_label, "hdr"), P(ch.value_label, "hdr")] + ([P("Tỷ trọng", "hdr")] if has_share else [])]
            for g in ch.groups:
                row = [P(g.label), P(fmt_num(g.value), "num")]
                if has_share:
                    s = _share(ch, g)
                    row.append(P("" if s is None else fmt_num(round(s * 100, 1)) + "%", "num"))
                data.append(row)
            total = _stat_total(ch)
            if total is not None:
                data.append([P("Tổng cộng", "cellb"), Paragraph(_esc(fmt_num(total)), ParagraphStyle("nb", parent=st["num"], fontName="DejaVu-Bold"))]
                            + ([Paragraph("100%", ParagraphStyle("nb2", parent=st["num"], fontName="DejaVu-Bold"))] if has_share else []))
            widths = [pw * 0.5, pw * 0.3] + ([pw * 0.2] if has_share else [])
            if not has_share:
                widths = [pw * 0.6, pw * 0.4]
            table = grid_table(data, widths, numeric_cols=(1, 2) if has_share else (1,), total_row=total is not None)
            if len(data) <= 15:
                story.append(KeepTogether(block + [table]))
            else:
                story.append(KeepTogether(block))
                story.append(table)

    for d in rep.details:
        cols = d.columns
        wide = len(cols) > 6
        story.append(NextPageTemplate("landscape" if wide else "portrait"))
        story.append(PageBreakIfNotEmpty())
        story.append(heading(f"Dữ liệu chi tiết ({fmt_num(len(d.rows))} dòng)"))
        fw = (landscape_size if wide else portrait_size)[0] - 2 * margin
        font_size = 8 if len(cols) <= 10 else 7
        cs = ParagraphStyle("dc", parent=st["cell"], fontSize=font_size, leading=font_size + 2)
        cn = ParagraphStyle("dn", parent=cs, alignment=TA_RIGHT)
        ch_ = ParagraphStyle("dh", parent=st["hdr"], fontSize=font_size, leading=font_size + 2)
        texts = [[fmt_cell(r[i], c) for i, c in enumerate(cols)] for r in d.rows]
        pad = 8
        sample = texts[:3000]
        natural = []
        for i, c in enumerate(cols):
            w_head = min(stringWidth(c["name"], "DejaVu-Bold", font_size), 90)
            w_body = max((stringWidth(t[i], "DejaVu", font_size) for t in sample), default=0)
            natural.append(max(28, min(max(w_head, w_body) + pad, 200)))
        # Split columns into chunks that fit the page width; repeat the first
        # column in every chunk so rows stay identifiable.
        chunks, cur, cur_w = [], [], 0
        first_w = natural[0]
        for i in range(len(cols)):
            w = natural[i]
            if cur and cur_w + w > fw:
                chunks.append(cur)
                cur, cur_w = [0], first_w
            cur.append(i)
            cur_w += w
        if cur:
            chunks.append(cur)
        for ci, chunk in enumerate(chunks):
            widths = [natural[i] for i in chunk]
            scale = fw / sum(widths)
            widths = [w * scale for w in widths] if scale > 1 else widths
            if len(chunks) > 1:
                names = ", ".join(cols[i]["name"] for i in chunk[1 if ci else 0:])
                story.append(Paragraph(_esc(f"Phần {ci + 1}/{len(chunks)} — các cột: {names}"), st["note"]))
                story.append(Spacer(1, 2 * mm))
            numeric = [j for j, i in enumerate(chunk) if cols[i]["type"] == "number"]
            data = [[Paragraph(_esc(cols[i]["name"]), ch_) for i in chunk]]
            for t in texts:
                row = []
                for j, i in enumerate(chunk):
                    txt = t[i]
                    if stringWidth(txt, "DejaVu", font_size) + pad > widths[j]:
                        row.append(Paragraph(_esc(txt), cn if j in numeric else cs))
                    else:
                        row.append(txt)
                data.append(row)
            table = grid_table(data, widths, numeric_cols=numeric)
            table.setStyle(TableStyle([("FONTSIZE", (0, 1), (-1, -1), font_size), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
            story.append(table)
            if ci < len(chunks) - 1:
                story.append(PageBreak())
        story.append(CondPageBreak(1))

    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Word
# ---------------------------------------------------------------------------


def to_docx(rep: Report) -> bytes:
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    for name in ("Heading 1", "Heading 2", "Title"):
        s = doc.styles[name]
        s.font.name = "Arial"
        s.font.color.rgb = RGBColor.from_string(ACCENT)
        rpr = s.element.get_or_add_rPr()
        rpr.get_or_add_rFonts().set(qn("w:eastAsia"), "Arial")
        rpr.get_or_add_rFonts().set(qn("w:ascii"), "Arial")
        rpr.get_or_add_rFonts().set(qn("w:hAnsi"), "Arial")

    sec0 = doc.sections[0]
    sec0.page_width, sec0.page_height = Cm(21), Cm(29.7)
    for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(sec0, side, Cm(1.8))
    content_w = Cm(21 - 3.6)

    def shade(cell, hex_):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hex_)
        tcPr.append(shd)

    def set_cell(cell, text, bold=False, align=None, color=None, size=9):
        cell.text = ""
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = bold
        if color:
            run.font.color.rgb = RGBColor.from_string(color)
        if align:
            p.alignment = align

    def repeat_header(row):
        trPr = row._tr.get_or_add_trPr()
        el = OxmlElement("w:tblHeader")
        el.set(qn("w:val"), "true")
        trPr.append(el)

    def table(headers, rows, widths=None, numeric=(), total=False, size=9):
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, h in enumerate(headers):
            c = t.rows[0].cells[i]
            set_cell(c, h, bold=True, color="FFFFFF", size=size)
            shade(c, ACCENT)
        repeat_header(t.rows[0])
        for ri, r in enumerate(rows):
            cells = t.add_row().cells
            for i, v in enumerate(r):
                set_cell(cells[i], v, size=size, align=WD_ALIGN_PARAGRAPH.RIGHT if i in numeric else None,
                         bold=total and ri == len(rows) - 1)
                if total and ri == len(rows) - 1:
                    shade(cells[i], ACCENT_LIGHT)
                elif ri % 2:
                    shade(cells[i], ZEBRA)
        if widths:
            for row in t.rows:
                for i, w in enumerate(widths):
                    row.cells[i].width = w
        return t

    def kv_table(pairs):
        t = doc.add_table(rows=0, cols=2)
        t.style = "Table Grid"
        for k, v in pairs:
            cells = t.add_row().cells
            set_cell(cells[0], k, bold=True)
            shade(cells[0], ACCENT_LIGHT)
            set_cell(cells[1], v)
            cells[0].width, cells[1].width = Cm(5), content_w - Cm(5)
        return t

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run(f"BÁO CÁO {rep.title.upper()}")
    run.bold = True
    run.font.size = Pt(18)
    run.font.color.rgb = RGBColor.from_string(ACCENT)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = sub.add_run(f"Sheet: {rep.sheet_name} · Lập lúc {rep.generated_at:%H:%M} ngày {rep.generated_at:%d/%m/%Y}")
    r.italic = True
    r.font.color.rgb = RGBColor.from_string("52514E")

    sec = 0

    def heading(text):
        nonlocal sec
        sec += 1
        doc.add_heading(f"{sec}. {text}", level=1)

    heading("Thông tin báo cáo")
    kv_table(_info_rows(rep))
    doc.add_heading("Điều kiện lọc áp dụng", level=2)
    kv_table(_filter_rows(rep))

    if rep.sections.overview and rep.kpis:
        heading("Chỉ số tổng hợp")
        table(["Chỉ số", "Giá trị", "Ghi chú"],
              [[k.label, fmt_num(k.value) if k.value is not None else "–", k.sub] for k in rep.kpis],
              widths=[Cm(5.5), Cm(4), content_w - Cm(9.5)], numeric=(1,))

    if rep.sections.stats and rep.charts:
        heading("Biểu đồ và bảng thống kê")
        for n, ch in enumerate(rep.charts, start=1):
            doc.add_heading(f"{sec}.{n}. {ch.title}", level=2)
            raw = _decode_image(ch.image)
            if raw:
                doc.add_picture(io.BytesIO(raw), width=content_w)
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            if not ch.groups:
                doc.add_paragraph("Không có dữ liệu cho biểu đồ này.")
                continue
            has_share = any(_share(ch, g) is not None for g in ch.groups)
            rows = []
            for g in ch.groups:
                row = [g.label, fmt_num(g.value)]
                if has_share:
                    s = _share(ch, g)
                    row.append("" if s is None else fmt_num(round(s * 100, 1)) + "%")
                rows.append(row)
            total = _stat_total(ch)
            if total is not None:
                rows.append(["Tổng cộng", fmt_num(total)] + (["100%"] if has_share else []))
            heads = [ch.dimension_label, ch.value_label] + (["Tỷ trọng"] if has_share else [])
            table(heads, rows, numeric=(1, 2), total=total is not None)
            doc.add_paragraph()

    for d in rep.details:
        cols = d.columns
        sec_d = doc.add_section()
        if len(cols) > 6:
            sec_d.orientation = WD_ORIENT.LANDSCAPE
            sec_d.page_width, sec_d.page_height = Cm(29.7), Cm(21)
        for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(sec_d, side, Cm(1.5))
        heading(f"Dữ liệu chi tiết ({fmt_num(len(d.rows))} dòng)")
        size = 8 if len(cols) <= 10 else 7
        numeric = tuple(i for i, c in enumerate(cols) if c["type"] == "number")
        table([c["name"] for c in cols], [[fmt_cell(r[i], c) for i, c in enumerate(cols)] for r in d.rows],
              numeric=numeric, size=size)

    for s in doc.sections:
        fp = s.footer.paragraphs[0]
        fp.text = f"{rep.title} · Lập lúc {rep.generated_at:%d/%m/%Y %H:%M}"
        fp.runs[0].font.size = Pt(8)
        fp.runs[0].font.color.rgb = RGBColor.from_string("52514E")

    doc.core_properties.title = f"Báo cáo {rep.title}"
    doc.core_properties.author = rep.author or "Excel Dashboard"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


BUILDERS = {"xlsx": to_xlsx, "pdf": to_pdf, "docx": to_docx}
