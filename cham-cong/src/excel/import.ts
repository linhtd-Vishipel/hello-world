import ExcelJS from 'exceljs';
import { daysInMonth, isValidIsoDate, pad2 } from '../domain/calendar';
import { findCode } from '../domain/codes';
import { validateEmployee, type EmployeeDraft } from '../domain/employees';
import { getCell, type CellEdit } from '../domain/sheet';
import type { AttendanceCode, Employee, EmployeeStatus, MonthSheet } from '../domain/types';
import { foldVietnamese, normKey } from '../domain/util';

export function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.normalize('NFC').trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').normalize('NFC').trim();
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      return r === undefined || r === null ? '' : String(r).normalize('NFC').trim();
    }
    if ('text' in v) return String((v as { text: unknown }).text).trim();
  }
  return String(v);
}

async function loadWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as ArrayBuffer);
  } catch (e) {
    throw new Error('Không đọc được file Excel (.xlsx). Kiểm tra định dạng file. ' + (e as Error).message);
  }
  return wb;
}

const CODE_HEADER = /^(m[ãa]\s*(nv|nhân\s*viên|nhan\s*vien|cb|cán\s*bộ|số)?|mã\s*nhân\s*sự)$/i;
const NAME_HEADER = /h[ọo]\s*(và)?\s*t[êe]n/i;
const STOP_WORDS = /^(ký hiệu|ky hieu|người lập|nguoi lap|cộng|tổng cộng|ghi chú:)/i;

export interface ParsedAttendance {
  sheetName: string;
  detectedMonth?: number;
  detectedYear?: number;
  headerRow: number;
  codeCol: number;
  nameCol: number;
  dayCols: Record<number, number>;
  rows: { rowNumber: number; code: string; name: string; cells: Record<number, string> }[];
  warnings: string[];
}

export async function parseAttendanceWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<ParsedAttendance> {
  const wb = await loadWorkbook(bytes);
  const errors: string[] = [];
  for (const ws of wb.worksheets) {
    const res = parseAttendanceSheet(ws);
    if ('error' in res) errors.push(`${ws.name}: ${res.error}`);
    else return res;
  }
  throw new Error('Không nhận diện được bảng chấm công. ' + errors.join(' | '));
}

function parseAttendanceSheet(ws: ExcelJS.Worksheet): ParsedAttendance | { error: string } {
  const warnings: string[] = [];
  let detectedMonth: number | undefined;
  let detectedYear: number | undefined;
  const maxScan = Math.min(ws.rowCount, 40);
  for (let r = 1; r <= Math.min(maxScan, 12) && !detectedYear; r++) {
    ws.getRow(r).eachCell((cell) => {
      const m = cellText(cell).match(/th[áa]ng\s*(\d{1,2})\s*(?:\/|-|n[ăa]m)\s*(\d{4})/i);
      if (m && !detectedYear) {
        detectedMonth = Number(m[1]);
        detectedYear = Number(m[2]);
      }
    });
  }
  let headerRow = 0;
  let codeCol = 0;
  let nameCol = 0;
  for (let r = 1; r <= maxScan && !headerRow; r++) {
    let cc = 0;
    let nc = 0;
    ws.getRow(r).eachCell((cell, c) => {
      const t = cellText(cell);
      if (!cc && CODE_HEADER.test(t)) cc = c;
      if (!nc && NAME_HEADER.test(t)) nc = c;
    });
    if (cc && nc) {
      headerRow = r;
      codeCol = cc;
      nameCol = nc;
    }
  }
  if (!headerRow) return { error: 'không tìm thấy dòng tiêu đề có "Mã NV" và "Họ và tên".' };

  let dayRow = 0;
  const dayCols: Record<number, number> = {};
  for (let r = headerRow; r <= headerRow + 3 && !dayRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (cellText(row.getCell(c)) !== '1') continue;
      let d = 1;
      while (cellText(row.getCell(c + d)) === String(d + 1)) d++;
      if (d >= 28) {
        dayRow = r;
        for (let i = 0; i < d; i++) dayCols[i + 1] = c + i;
        break;
      }
    }
  }
  if (!dayRow) return { error: 'không tìm thấy dãy cột ngày 1…28/31.' };

  const rows: ParsedAttendance['rows'] = [];
  let blank = 0;
  const headerCodeText = cellText(ws.getRow(headerRow).getCell(codeCol));
  let mergedWarned = false;
  for (let r = dayRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(codeCol));
    const name = cellText(row.getCell(nameCol));
    const first = cellText(row.getCell(1));
    if (STOP_WORDS.test(first) || STOP_WORDS.test(code) || STOP_WORDS.test(name)) break;
    if (code === headerCodeText) continue; // dòng thứ trong tuần thuộc vùng tiêu đề gộp
    if (!code && !name) {
      if (++blank >= 3) break;
      continue;
    }
    blank = 0;
    if (!code) {
      warnings.push(`Dòng ${r}: có họ tên "${name}" nhưng thiếu mã nhân viên – bỏ qua.`);
      continue;
    }
    const cells: Record<number, string> = {};
    for (const [day, col] of Object.entries(dayCols)) {
      const cell = row.getCell(col);
      if (cell.isMerged && !mergedWarned) {
        warnings.push(`Dòng ${r}: có ô gộp trong vùng ngày – giá trị ô gộp được lặp cho các ngày, cần kiểm tra.`);
        mergedWarned = true;
      }
      const v = cellText(cell);
      if (v) cells[Number(day)] = v;
    }
    rows.push({ rowNumber: r, code, name, cells });
  }
  if (!rows.length) warnings.push('Không có dòng dữ liệu nhân sự nào.');
  return { sheetName: ws.name, detectedMonth, detectedYear, headerRow, codeCol, nameCol, dayCols, rows, warnings };
}

export type ImportMode = 'add' | 'update' | 'replace';

export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  add: 'Nhập thêm – chỉ điền vào ô đang trống',
  update: 'Cập nhật – ghi đè ô có dữ liệu trong file, giữ ô file để trống',
  replace: 'Thay thế – thay toàn bộ dòng của nhân sự có trong file (kể cả xóa ô trống)',
};

export interface AttendanceImportPlan {
  mode: ImportMode;
  matched: { employeeId: string; code: string; fileName: string; currentName: string; nameMismatch: boolean }[];
  unknownEmployees: { rowNumber: number; code: string; name: string }[];
  notInSheet: { rowNumber: number; code: string; name: string }[];
  duplicateRows: { rowNumber: number; code: string }[];
  invalidCells: { rowNumber: number; code: string; day: number; value: string; reason: string }[];
  extraDays: number[];
  edits: CellEdit[];
  overwrites: number;
  monthMismatch?: string;
  warnings: string[];
}

export function planAttendanceImport(
  parsed: ParsedAttendance,
  sheet: MonthSheet,
  employees: Employee[],
  codes: AttendanceCode[],
  mode: ImportMode,
): AttendanceImportPlan {
  const plan: AttendanceImportPlan = {
    mode,
    matched: [],
    unknownEmployees: [],
    notInSheet: [],
    duplicateRows: [],
    invalidCells: [],
    extraDays: [],
    edits: [],
    overwrites: 0,
    warnings: [...parsed.warnings],
  };
  if (parsed.detectedYear && (parsed.detectedYear !== sheet.year || parsed.detectedMonth !== sheet.month)) {
    plan.monthMismatch = `File ghi tháng ${pad2(parsed.detectedMonth ?? 0)}/${parsed.detectedYear}, đang nhập vào bảng ${pad2(sheet.month)}/${sheet.year}.`;
  }
  const n = daysInMonth(sheet.year, sheet.month);
  plan.extraDays = Object.keys(parsed.dayCols).map(Number).filter((d) => d > n);
  const byCode = new Map(employees.map((e) => [normKey(e.code), e]));
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = normKey(row.code);
    if (seen.has(key)) {
      plan.duplicateRows.push({ rowNumber: row.rowNumber, code: row.code });
      continue;
    }
    seen.add(key);
    const emp = byCode.get(key);
    if (!emp) {
      plan.unknownEmployees.push({ rowNumber: row.rowNumber, code: row.code, name: row.name });
      continue;
    }
    if (!sheet.employeeIds.includes(emp.id)) {
      plan.notInSheet.push({ rowNumber: row.rowNumber, code: row.code, name: row.name });
      continue;
    }
    plan.matched.push({
      employeeId: emp.id,
      code: emp.code,
      fileName: row.name,
      currentName: emp.fullName,
      nameMismatch: !!row.name && foldVietnamese(row.name) !== foldVietnamese(emp.fullName),
    });
    for (let d = 1; d <= n; d++) {
      const raw = row.cells[d] ?? '';
      const current = getCell(sheet, emp.id, d);
      let value = '';
      if (raw) {
        const code = findCode(codes, raw);
        if (!code || !code.active) {
          plan.invalidCells.push({
            rowNumber: row.rowNumber,
            code: row.code,
            day: d,
            value: raw,
            reason: code ? 'Mã đã ngừng sử dụng' : 'Mã không có trong danh mục',
          });
          continue;
        }
        value = code.code;
      }
      if (mode === 'add' && (current || !value)) continue;
      if (mode === 'update' && !value) continue;
      if (value === current) continue;
      if (current) plan.overwrites++;
      plan.edits.push({ employeeId: emp.id, day: d, value });
    }
  }
  return plan;
}

// ---------- Danh sách nhân sự

const EMP_HEADER_MAP: [RegExp, keyof EmployeeRow][] = [
  [CODE_HEADER, 'code'],
  [NAME_HEADER, 'fullName'],
  [/^ch[ứu]c\s*v[ụu]|ch[ứu]c\s*danh/i, 'position'],
  [/b[ộo]\s*ph[ậa]n|ph[òo]ng|t[ổo]/i, 'department'],
  [/tr[ạa]ng\s*th[áa]i/i, 'status'],
  [/(ng[àa]y\s*)?b[ắa]t\s*đ[ầa]u|ng[àa]y\s*v[àa]o/i, 'startDate'],
  [/(ng[àa]y\s*)?k[ếe]t\s*th[úu]c|ng[àa]y\s*ngh[ỉi]/i, 'endDate'],
  [/ghi\s*ch[úu]/i, 'note'],
];

export interface EmployeeRow {
  rowNumber: number;
  code: string;
  fullName: string;
  position: string;
  department: string;
  status: string;
  startDate: string;
  endDate: string;
  note: string;
}

function parseDateText(s: string): string {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  return s;
}

export async function parseEmployeeWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<{ rows: EmployeeRow[]; warnings: string[] }> {
  const wb = await loadWorkbook(bytes);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File không có trang tính.');
  let headerRow = 0;
  const cols: Partial<Record<keyof EmployeeRow, number>> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 30) && !headerRow; r++) {
    const found: Partial<Record<keyof EmployeeRow, number>> = {};
    ws.getRow(r).eachCell((cell, c) => {
      const t = cellText(cell);
      for (const [re, key] of EMP_HEADER_MAP) {
        if (!found[key] && re.test(t)) {
          found[key] = c;
          break;
        }
      }
    });
    if (found.code && found.fullName) {
      headerRow = r;
      Object.assign(cols, found);
    }
  }
  if (!headerRow) throw new Error('Không tìm thấy dòng tiêu đề có "Mã NV" và "Họ và tên".');
  const rows: EmployeeRow[] = [];
  const warnings: string[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k: keyof EmployeeRow) => (cols[k] ? cellText(row.getCell(cols[k]!)) : '');
    const code = get('code');
    const fullName = get('fullName');
    if (!code && !fullName) continue;
    rows.push({
      rowNumber: r,
      code,
      fullName,
      position: get('position'),
      department: get('department'),
      status: get('status'),
      startDate: parseDateText(get('startDate')),
      endDate: parseDateText(get('endDate')),
      note: get('note'),
    });
  }
  if (!rows.length) warnings.push('Không có dòng nhân sự nào.');
  return { rows, warnings };
}

function parseStatus(s: string): EmployeeStatus {
  const f = foldVietnamese(s);
  return /nghi|inactive|thoi viec|da nghi/.test(f) ? 'inactive' : 'active';
}

export interface EmployeeImportPlan {
  toCreate: EmployeeDraft[];
  toUpdate: { employee: Employee; draft: EmployeeDraft; changes: string[] }[];
  unchanged: number;
  errors: { rowNumber: number; message: string }[];
  warnings: { rowNumber: number; message: string }[];
}

export function planEmployeeImport(rows: EmployeeRow[], existing: Employee[], mode: 'add' | 'upsert'): EmployeeImportPlan {
  const plan: EmployeeImportPlan = { toCreate: [], toUpdate: [], unchanged: 0, errors: [], warnings: [] };
  const byCode = new Map(existing.map((e) => [normKey(e.code), e]));
  const seen = new Set<string>();
  const pool: Employee[] = [...existing];
  for (const r of rows) {
    const key = normKey(r.code);
    if (seen.has(key)) {
      plan.errors.push({ rowNumber: r.rowNumber, message: `Mã "${r.code}" lặp lại trong file.` });
      continue;
    }
    seen.add(key);
    for (const [label, d] of [['Ngày bắt đầu', r.startDate], ['Ngày kết thúc', r.endDate]] as const) {
      if (d && !isValidIsoDate(d)) plan.errors.push({ rowNumber: r.rowNumber, message: `${label} "${d}" không hợp lệ (dùng dd/mm/yyyy).` });
    }
    const cur = byCode.get(key);
    const draft: EmployeeDraft = {
      id: cur?.id,
      code: r.code,
      fullName: r.fullName,
      position: r.position || cur?.position || '',
      department: r.department || cur?.department || '',
      status: r.status ? parseStatus(r.status) : cur?.status ?? 'active',
      startDate: (r.startDate && isValidIsoDate(r.startDate) ? r.startDate : undefined) ?? cur?.startDate,
      endDate: (r.endDate && isValidIsoDate(r.endDate) ? r.endDate : undefined) ?? cur?.endDate,
      note: r.note || cur?.note,
    };
    const v = validateEmployee(draft, pool);
    if (v.errors.length) {
      plan.errors.push(...v.errors.map((m) => ({ rowNumber: r.rowNumber, message: m })));
      continue;
    }
    v.warnings.forEach((m) => plan.warnings.push({ rowNumber: r.rowNumber, message: m }));
    if (!cur) {
      plan.toCreate.push(draft);
      pool.push({ ...(draft as Employee), id: `new_${r.rowNumber}` });
      continue;
    }
    if (mode === 'add') {
      plan.unchanged++;
      continue;
    }
    const changes: string[] = [];
    const fields: [keyof EmployeeDraft, string][] = [
      ['fullName', 'Họ tên'], ['position', 'Chức vụ'], ['department', 'Bộ phận'], ['status', 'Trạng thái'],
      ['startDate', 'Ngày bắt đầu'], ['endDate', 'Ngày kết thúc'], ['note', 'Ghi chú'],
    ];
    for (const [k, label] of fields) {
      if ((cur[k as keyof Employee] ?? '') !== (draft[k] ?? '')) changes.push(`${label}: "${cur[k as keyof Employee] ?? ''}" → "${draft[k] ?? ''}"`);
    }
    if (changes.length) plan.toUpdate.push({ employee: cur, draft, changes });
    else plan.unchanged++;
  }
  return plan;
}
