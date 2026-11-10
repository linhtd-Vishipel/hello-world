import ExcelJS from 'exceljs';
import { pad2, type DayInfo } from '../domain/calendar';
import { excelCriteria, ruleAt } from '../domain/codes';
import { sheetCalendar, sheetCodes, sheetRows } from '../domain/sheet';
import { computeSheetSummary, makeContext, summaryCodes, type SheetSummary } from '../domain/summary';
import type { AttendanceCode, Employee, ExcelTemplateConfig, MonthSheet, SheetRowSnapshot, Unit } from '../domain/types';
import { DEFAULT_TEMPLATE } from '../domain/unit';
import { base64ToBytes } from './base64';

export const ROW_HEADER_START = 7;

export function exportFileName(unit: Unit, year: number, month: number): string {
  const pattern = unit.template.fileNamePattern || DEFAULT_TEMPLATE.fileNamePattern;
  const name = pattern
    .replace(/\{MaDonVi\}/g, unit.code)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{MM\}/g, pad2(month))
    .replace(/[\\/:*?"<>|]/g, '_');
  return `${name}.xlsx`;
}

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

export interface ExportInput {
  unit: Unit;
  sheet: MonthSheet;
  employees: Employee[];
  codes: AttendanceCode[];
}

interface GridLayout {
  rows: SheetRowSnapshot[];
  days: DayInfo[];
  codes: AttendanceCode[];
  sumCodes: AttendanceCode[];
  summary: SheetSummary;
  hasPosition: boolean;
  firstDayCol: number;
  lastDayCol: number;
  firstSumCol: number;
  workCol: number;
  totalCol: number;
  noteCol: number;
  lastCol: number;
}

function layoutFor(input: ExportInput, startCol: number): GridLayout {
  const { unit, sheet } = input;
  const codes = sheetCodes(sheet, input.codes);
  const calendar = sheetCalendar(sheet, unit);
  const ctx = makeContext(sheet.year, sheet.month, codes, unit.codeGroups, calendar);
  const summary = computeSheetSummary(sheet, input.employees, ctx);
  const hasPosition = unit.template.showPosition;
  const fixed = hasPosition ? 4 : 3;
  const firstDayCol = startCol + fixed;
  const lastDayCol = firstDayCol + ctx.days.length - 1;
  const sumCodes = summaryCodes(codes, sheet);
  const firstSumCol = lastDayCol + 1;
  const workCol = firstSumCol + sumCodes.length;
  const totalCol = workCol + 1;
  const noteCol = totalCol + 1;
  return {
    rows: sheetRows(sheet, input.employees),
    days: ctx.days,
    codes,
    sumCodes,
    summary,
    hasPosition,
    firstDayCol,
    lastDayCol,
    firstSumCol,
    workCol,
    totalCol,
    noteCol,
    lastCol: noteCol,
  };
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function countIf(range: string, code: string) {
  return `COUNTIF(${range},"${excelCriteria(code)}")`;
}

/**
 * Ghi lưới chấm công (3 dòng tiêu đề + dữ liệu) từ (startRow, startCol).
 * Trả về dòng cuối cùng đã ghi.
 */
function writeGrid(ws: ExcelJS.Worksheet, L: GridLayout, input: ExportInput, startRow: number, startCol: number): number {
  const t = input.unit.template;
  const font = { name: t.fontName, size: t.fontSize };
  const bold = { ...font, bold: true };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const h1 = startRow;
  const h2 = startRow + 1;
  const h3 = startRow + 2;

  const header = (r: number, c: number, v: string) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = bold;
    cell.alignment = center;
    cell.border = BORDER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  };
  const mergeHeader = (r1: number, c1: number, r2: number, c2: number, v: string) => {
    header(r1, c1, v);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) header(r, c, '');
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
  };

  const fixedHeaders = ['STT', 'Mã NV', 'Họ và tên', ...(L.hasPosition ? ['Chức vụ'] : [])];
  fixedHeaders.forEach((h, i) => mergeHeader(h1, startCol + i, h3, startCol + i, h));
  mergeHeader(h1, L.firstDayCol, h1, L.lastDayCol, 'Ngày trong tháng');
  if (L.sumCodes.length) mergeHeader(h1, L.firstSumCol, h1, L.workCol - 1, 'Quy ra công (số ngày theo mã)');
  mergeHeader(h1, L.workCol, h3, L.workCol, 'Ngày làm việc thực tế');
  mergeHeader(h1, L.totalCol, h3, L.totalCol, 'Tổng công quy đổi');
  mergeHeader(h1, L.noteCol, h3, L.noteCol, 'Ghi chú');

  const dayFill = (d: DayInfo): ExcelJS.Fill | undefined =>
    d.holiday
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(t.holidayColor) } }
      : d.isWeekend
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(t.weekendColor) } }
        : undefined;

  L.days.forEach((d, i) => {
    const c = L.firstDayCol + i;
    header(h2, c, String(d.day));
    ws.getCell(h2, c).value = d.day;
    header(h3, c, d.weekdayShort);
    const f = dayFill(d);
    if (f) {
      ws.getCell(h2, c).fill = f;
      ws.getCell(h3, c).fill = f;
    }
  });
  L.sumCodes.forEach((code, i) => {
    const c = L.firstSumCol + i;
    header(h2, c, code.code);
    header(h3, c, code.name.length > 12 ? code.code : code.name);
    ws.getCell(h3, c).font = { ...font, size: Math.max(6, t.fontSize - 3) };
  });

  let r = h3;
  L.rows.forEach((row, idx) => {
    r = h3 + 1 + idx;
    const s = L.summary.rows[row.employeeId];
    const cellsRow = input.sheet.cells[row.employeeId] ?? {};
    const vals: (string | number)[] = [idx + 1, row.code, row.fullName, ...(L.hasPosition ? [row.position] : [])];
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, startCol + i);
      cell.value = v;
      cell.font = font;
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', horizontal: i === 2 || i === 3 ? 'left' : 'center', wrapText: i >= 2 };
    });
    L.days.forEach((d, i) => {
      const cell = ws.getCell(r, L.firstDayCol + i);
      const v = cellsRow[String(d.day)] ?? '';
      cell.value = v || null;
      cell.font = font;
      cell.border = BORDER;
      cell.alignment = center;
      const f = dayFill(d);
      if (f) cell.fill = f;
      const note = input.sheet.cellNotes[row.employeeId]?.[String(d.day)];
      if (note) cell.note = note;
    });
    const range = `${colLetter(L.firstDayCol)}${r}:${colLetter(L.lastDayCol)}${r}`;
    L.sumCodes.forEach((code, i) => {
      const cell = ws.getCell(r, L.firstSumCol + i);
      cell.value = { formula: countIf(range, code.code), result: s?.counts[code.code] ?? 0 };
      cell.font = font;
      cell.border = BORDER;
      cell.alignment = center;
    });
    const workCodes = L.codes.filter((c) => ruleAt(c, input.sheet.year, input.sheet.month).isActualWork);
    const totalParts = L.codes
      .map((c) => ({ c, rule: ruleAt(c, input.sheet.year, input.sheet.month) }))
      .filter((x) => x.rule.countsInTotal && x.rule.value !== null && x.rule.value !== 0);
    const workCell = ws.getCell(r, L.workCol);
    workCell.value = workCodes.length
      ? { formula: workCodes.map((c) => countIf(range, c.code)).join('+'), result: s?.actualWorkDays ?? 0 }
      : 0;
    const totalCell = ws.getCell(r, L.totalCol);
    totalCell.value = totalParts.length
      ? {
          formula: totalParts.map((x) => `${countIf(range, x.c.code)}*${x.rule.value}`).join('+'),
          result: s?.convertedTotal ?? 0,
        }
      : 0;
    const noteCell = ws.getCell(r, L.noteCol);
    noteCell.value = input.sheet.rowNotes[row.employeeId] ?? null;
    for (const c of [workCell, totalCell, noteCell]) {
      c.font = c === totalCell ? bold : font;
      c.border = BORDER;
      c.alignment = c === noteCell ? { vertical: 'middle', wrapText: true } : center;
    }
    totalCell.numFmt = '0.##';
  });
  return r;
}

function setColumnWidths(ws: ExcelJS.Worksheet, L: GridLayout, startCol: number) {
  const widths = [5, 9, 24, ...(L.hasPosition ? [13] : [])];
  widths.forEach((w, i) => (ws.getColumn(startCol + i).width = w));
  for (let c = L.firstDayCol; c <= L.lastDayCol; c++) ws.getColumn(c).width = 4;
  for (let c = L.firstSumCol; c < L.workCol; c++) ws.getColumn(c).width = 5;
  ws.getColumn(L.workCol).width = 8;
  ws.getColumn(L.totalCol).width = 8;
  ws.getColumn(L.noteCol).width = 16;
}

function applyPrintSetup(ws: ExcelJS.Worksheet, t: ExcelTemplateConfig, lastCol: number, lastRow: number, headerRows: [number, number]) {
  const paper = t.paperSize === 'auto' ? (lastCol > 46 ? 'A3' : 'A4') : t.paperSize;
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: (paper === 'A3' ? 8 : 9) as unknown as ExcelJS.PaperSize,
    orientation: t.orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    printArea: `A1:${colLetter(lastCol)}${lastRow}`,
    printTitlesRow: `${headerRows[0]}:${headerRows[1]}`,
  };
  ws.headerFooter = { oddFooter: '&C&8Trang &P/&N' };
}

function writeFooter(ws: ExcelJS.Worksheet, L: GridLayout, input: ExportInput, afterRow: number): number {
  const t = input.unit.template;
  const font = { name: t.fontName, size: t.fontSize };
  let r = afterRow + 2;
  if (t.showLegend) {
    const legend = L.codes
      .filter((c) => c.active || L.sumCodes.includes(c))
      .map((c) => `${c.code}: ${c.name}`)
      .join(';   ');
    ws.mergeCells(r, 1, r, L.lastCol);
    const cell = ws.getCell(r, 1);
    cell.value = `Ký hiệu chấm công:   ${legend}`;
    cell.font = { ...font, italic: true };
    cell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = Math.max(18, Math.ceil(legend.length / 180) * 15);
    r += 1;
  }
  if (input.sheet.locked) {
    ws.mergeCells(r, 1, r, L.lastCol);
    ws.getCell(r, 1).value = `Bảng đã khóa lúc ${new Date(input.sheet.lockedAt ?? '').toLocaleString('vi-VN')} bởi ${input.sheet.lockedBy ?? ''}.`;
    ws.getCell(r, 1).font = { ...font, italic: true, size: Math.max(7, t.fontSize - 2) };
    r += 1;
  }
  r += 1;
  const signers = t.signers.length ? t.signers : DEFAULT_TEMPLATE.signers;
  const span = Math.max(1, Math.floor(L.lastCol / signers.length));
  // Dòng ngày tháng phía trên người ký cuối cùng
  const lastStart = 1 + span * (signers.length - 1);
  ws.mergeCells(r, lastStart, r, L.lastCol);
  ws.getCell(r, lastStart).value = `${t.place ? t.place + ', ' : ''}ngày ..... tháng ..... năm ${input.sheet.year}`;
  ws.getCell(r, lastStart).font = { ...font, italic: true };
  ws.getCell(r, lastStart).alignment = { horizontal: 'center' };
  r += 1;
  signers.forEach((s, i) => {
    const c1 = 1 + span * i;
    const c2 = i === signers.length - 1 ? L.lastCol : c1 + span - 1;
    const put = (row: number, v: string, f: Partial<ExcelJS.Font>) => {
      ws.mergeCells(row, c1, row, c2);
      const cell = ws.getCell(row, c1);
      cell.value = v;
      cell.font = { ...font, ...f };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    };
    put(r, s.title, { bold: true });
    put(r + 1, '(Ký, ghi rõ họ tên)', { italic: true, size: Math.max(7, t.fontSize - 1) });
    put(r + 5, s.name, { bold: true });
  });
  return r + 5;
}

/** Xuất theo mẫu mặc định của ứng dụng. */
function buildDefault(wb: ExcelJS.Workbook, input: ExportInput): void {
  const { unit, sheet } = input;
  const t = unit.template;
  const ws = wb.addWorksheet('Bang cham cong', {
    views: [{ state: 'frozen', xSplit: t.showPosition ? 4 : 3, ySplit: ROW_HEADER_START + 2 }],
  });
  const L = layoutFor(input, 1);
  setColumnWidths(ws, L, 1);
  const font = { name: t.fontName, size: t.fontSize };
  const snap = sheet.locked ? sheet.lockSnapshot : undefined;
  const leftSpan = Math.min(L.lastCol, 3 + (L.hasPosition ? 1 : 0) + 6);
  const rightStart = Math.max(leftSpan + 1, L.lastCol - 11);
  const put = (r: number, c1: number, c2: number, v: string, f: Partial<ExcelJS.Font>, h: 'left' | 'center' = 'center') => {
    ws.mergeCells(r, c1, r, c2);
    const cell = ws.getCell(r, c1);
    cell.value = v;
    cell.font = { ...font, ...f };
    cell.alignment = { horizontal: h, vertical: 'middle' };
  };
  put(1, 1, leftSpan, (snap?.parentOrg ?? unit.parentOrg) || '', { bold: false });
  put(2, 1, leftSpan, `Đơn vị: ${snap?.unitName ?? unit.name}`, { bold: true });
  put(1, rightStart, L.lastCol, t.formCode, { bold: true });
  put(2, rightStart, L.lastCol, t.formNote, { italic: true, size: Math.max(7, t.fontSize - 1) });
  put(4, 1, L.lastCol, t.title + (unit.isSample ? ' (DỮ LIỆU MẪU – KHÔNG DÙNG CHÍNH THỨC)' : ''), { bold: true, size: t.fontSize + 6 });
  put(5, 1, L.lastCol, `Tháng ${pad2(sheet.month)} năm ${sheet.year}`, { italic: true, size: t.fontSize + 2 });
  ws.getRow(4).height = 24;
  const lastData = writeGrid(ws, L, input, ROW_HEADER_START, 1);
  ws.getRow(ROW_HEADER_START).height = 20;
  ws.getRow(ROW_HEADER_START + 2).height = 26;
  const end = writeFooter(ws, L, input, lastData);
  applyPrintSetup(ws, t, L.lastCol, end, [ROW_HEADER_START, ROW_HEADER_START + 2]);
}

function buildSummarySheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const { unit, sheet } = input;
  const t = unit.template;
  const L = layoutFor(input, 1);
  const ws = wb.addWorksheet('Tong hop');
  const font = { name: t.fontName, size: t.fontSize };
  const headers = [
    'STT', 'Mã NV', 'Họ và tên', 'Chức vụ', 'Bộ phận',
    ...L.sumCodes.map((c) => c.code),
    ...unit.codeGroups.map((g) => `Nhóm: ${g.name}`),
    'Ngày có ghi mã', 'Ngày làm việc thực tế', 'Tổng công quy đổi', 'Số ô thiếu', 'Cảnh báo',
  ];
  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `TỔNG HỢP CHẤM CÔNG THÁNG ${pad2(sheet.month)}/${sheet.year} – ${unit.name}`;
  ws.getCell(1, 1).font = { ...font, bold: true, size: t.fontSize + 4 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  const hr = 3;
  headers.forEach((h, i) => {
    const c = ws.getCell(hr, i + 1);
    c.value = h;
    c.font = { ...font, bold: true };
    c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });
  ws.getRow(hr).height = 32;
  L.rows.forEach((row, idx) => {
    const s = L.summary.rows[row.employeeId];
    const vals = [
      idx + 1, row.code, row.fullName, row.position, row.department,
      ...L.sumCodes.map((c) => s?.counts[c.code] ?? 0),
      ...unit.codeGroups.map((g) => s?.groupCounts[g.id] ?? 0),
      s?.markedDays ?? 0, s?.actualWorkDays ?? 0, s?.convertedTotal ?? 0, s?.missingDays.length ?? 0,
      s?.issues.map((i) => i.message).join(' ') ?? '',
    ];
    vals.forEach((v, i) => {
      const c = ws.getCell(hr + 1 + idx, i + 1);
      c.value = v;
      c.font = font;
      c.border = BORDER;
      c.alignment = { vertical: 'middle', wrapText: i === vals.length - 1 };
    });
  });
  [5, 9, 24, 13, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let i = 6; i <= headers.length - 1; i++) ws.getColumn(i).width = 8;
  ws.getColumn(headers.length).width = 40;

  // Bảng ký hiệu và quy tắc tính áp dụng cho tháng
  let r = hr + L.rows.length + 3;
  const legendHead = ['Mã', 'Tên', 'Nhóm', 'Hệ số quy đổi', 'Tính vào tổng công', 'Làm việc thực tế', 'Hiệu lực từ', 'Trạng thái'];
  ws.getCell(r - 1, 1).value = 'DANH MỤC MÃ CÔNG VÀ QUY TẮC ÁP DỤNG';
  ws.getCell(r - 1, 1).font = { ...font, bold: true };
  legendHead.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { ...font, bold: true };
    c.border = BORDER;
  });
  for (const code of L.codes) {
    r++;
    const rule = ruleAt(code, sheet.year, sheet.month);
    const vals = [
      code.code, code.name, unit.codeGroups.find((g) => g.id === code.groupId)?.name ?? '',
      rule.value === null ? 'Chưa quy định' : rule.value, rule.countsInTotal ? 'Có' : 'Không',
      rule.isActualWork ? 'Có' : 'Không', rule.effectiveFrom, code.active ? 'Đang dùng' : 'Ngừng dùng',
    ];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.font = font;
      c.border = BORDER;
    });
  }
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9 as unknown as ExcelJS.PaperSize,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${hr}:${hr}`,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
}

export const PLACEHOLDERS = [
  '{{CO_QUAN_CHU_QUAN}}', '{{TEN_DON_VI}}', '{{MA_DON_VI}}', '{{TIEU_DE}}', '{{THANG}}', '{{NAM}}',
  '{{SO_NHAN_SU}}', '{{CHUC_DANH_KY_1}}', '{{TEN_KY_1}}', '{{CHUC_DANH_KY_2}}', '{{TEN_KY_2}}',
  '{{CHUC_DANH_KY_3}}', '{{TEN_KY_3}}', '{{BANG_CHAM_CONG}}',
];

/**
 * Xuất theo mẫu Excel riêng của Đài: thay placeholder trong mẫu, chèn lưới chấm công
 * tại ô {{BANG_CHAM_CONG}} và dời phần nội dung bên dưới (khối ký) xuống sau lưới.
 */
async function buildFromTemplate(wb: ExcelJS.Workbook, input: ExportInput): Promise<void> {
  const { unit, sheet } = input;
  const t = unit.template;
  await wb.xlsx.load(base64ToBytes(t.customTemplate!.dataBase64) as unknown as ArrayBuffer);
  const guide = wb.getWorksheet('Huong dan');
  if (guide) wb.removeWorksheet(guide.id);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Mẫu Excel không có trang tính.');
  const L0 = sheetRows(sheet, input.employees);
  const signers = t.signers;
  const map: Record<string, string> = {
    '{{CO_QUAN_CHU_QUAN}}': sheet.lockSnapshot?.parentOrg ?? unit.parentOrg,
    '{{TEN_DON_VI}}': sheet.lockSnapshot?.unitName ?? unit.name,
    '{{MA_DON_VI}}': unit.code,
    '{{TIEU_DE}}': t.title,
    '{{THANG}}': pad2(sheet.month),
    '{{NAM}}': String(sheet.year),
    '{{SO_NHAN_SU}}': String(L0.length),
  };
  for (let i = 0; i < 3; i++) {
    map[`{{CHUC_DANH_KY_${i + 1}}}`] = signers[i]?.title ?? '';
    map[`{{TEN_KY_${i + 1}}}`] = signers[i]?.name ?? '';
  }
  let anchor: { row: number; col: number } | null = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value !== 'string') return;
      if (cell.value.includes('{{BANG_CHAM_CONG}}')) {
        anchor = { row: Number(cell.row), col: Number(cell.col) };
        cell.value = null;
        return;
      }
      let v = cell.value;
      for (const [k, val] of Object.entries(map)) v = v.split(k).join(val);
      cell.value = v;
    });
  });
  if (!anchor) throw new Error('Mẫu Excel thiếu ô đánh dấu {{BANG_CHAM_CONG}}.');
  const { row: aRow, col: aCol } = anchor as { row: number; col: number };

  // Lưu phần nội dung dưới ô neo để dời xuống sau lưới
  const lastRow = ws.rowCount;
  const footer: { r: number; height?: number; cells: { c: number; value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }[] }[] = [];
  for (let r = aRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const cells: { c: number; value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      cells.push({ c, value: cell.value, style: JSON.parse(JSON.stringify(cell.style ?? {})) });
    });
    footer.push({ r, height: row.height, cells });
  }
  const merges: string[] = ((ws.model as unknown as { merges?: string[] }).merges ?? []).slice();
  const footerMerges: { r1: number; c1: number; r2: number; c2: number }[] = [];
  for (const m of merges) {
    const [a, b] = m.split(':');
    const ca = ws.getCell(a);
    const cb = ws.getCell(b ?? a);
    if (Number(ca.row) > aRow) {
      footerMerges.push({ r1: Number(ca.row), c1: Number(ca.col), r2: Number(cb.row), c2: Number(cb.col) });
      ws.unMergeCells(m);
    }
  }
  for (const f of footer) {
    for (const cell of f.cells) {
      const target = ws.getCell(f.r, cell.c);
      target.value = null;
      target.style = {};
    }
  }

  const L = layoutFor(input, aCol);
  const lastData = writeGrid(ws, L, input, aRow, aCol);
  const shift = lastData - aRow;
  for (const f of footer) {
    const nr = f.r + shift;
    if (f.height) ws.getRow(nr).height = f.height;
    for (const cell of f.cells) {
      const target = ws.getCell(nr, cell.c);
      target.value = cell.value;
      target.style = cell.style;
    }
  }
  for (const m of footerMerges) ws.mergeCells(m.r1 + shift, m.c1, m.r2 + shift, m.c2);
  const lastCol = Math.max(L.lastCol, ws.columnCount);
  applyPrintSetup(ws, t, lastCol, Math.max(ws.rowCount, lastData), [aRow, aRow + 2]);
}

export async function buildAttendanceWorkbook(input: ExportInput): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dashboard chấm công Đài TTDH';
  wb.created = new Date();
  if (input.unit.template.customTemplate) await buildFromTemplate(wb, input);
  else buildDefault(wb, input);
  if (input.unit.template.includeSummarySheet) buildSummarySheet(wb, input);
  return wb;
}

export async function exportAttendanceXlsx(input: ExportInput): Promise<Uint8Array> {
  const wb = await buildAttendanceWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ---------- Danh sách nhân sự

export const EMPLOYEE_HEADERS = ['STT', 'Mã NV', 'Họ và tên', 'Chức vụ', 'Bộ phận', 'Trạng thái', 'Ngày bắt đầu', 'Ngày kết thúc', 'Ghi chú'];

export async function exportEmployeesXlsx(unit: Unit, employees: Employee[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Nhan su');
  const font = { name: unit.template.fontName, size: 11 };
  ws.mergeCells(1, 1, 1, EMPLOYEE_HEADERS.length);
  ws.getCell(1, 1).value = `DANH SÁCH NHÂN SỰ – ${unit.name}`;
  ws.getCell(1, 1).font = { ...font, bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  EMPLOYEE_HEADERS.forEach((h, i) => {
    const c = ws.getCell(3, i + 1);
    c.value = h;
    c.font = { ...font, bold: true };
    c.border = BORDER;
  });
  employees.forEach((e, idx) => {
    const vals = [
      idx + 1, e.code, e.fullName, e.position, e.department,
      e.status === 'active' ? 'Đang làm việc' : 'Đã nghỉ', e.startDate ?? '', e.endDate ?? '', e.note ?? '',
    ];
    vals.forEach((v, i) => {
      const c = ws.getCell(4 + idx, i + 1);
      c.value = v;
      c.font = font;
      c.border = BORDER;
    });
  });
  [5, 10, 28, 18, 18, 14, 13, 13, 24].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

