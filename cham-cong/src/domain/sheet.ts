import { assertValidMonth, daysInMonth, sheetId } from './calendar';
import { findCode } from './codes';
import { eligibleEmployees } from './employees';
import type { AttendanceCode, Employee, MonthSheet, SheetRowSnapshot, Unit } from './types';
import { deepClone, nowIso } from './util';

export function createSheet(unit: Unit, year: number, month: number, employees: Employee[]): MonthSheet {
  assertValidMonth(year, month);
  const t = nowIso();
  return {
    id: sheetId(unit.id, year, month),
    unitId: unit.id,
    year,
    month,
    employeeIds: eligibleEmployees(employees.filter((e) => e.unitId === unit.id), year, month).map((e) => e.id),
    cells: {},
    cellNotes: {},
    rowNotes: {},
    locked: false,
    createdAt: t,
    updatedAt: t,
  };
}

export interface CellEdit {
  employeeId: string;
  day: number;
  /** Giá trị mới; chuỗi rỗng = xóa ô. */
  value: string;
}

export interface AppliedEdit extends CellEdit {
  previous: string;
}

export interface EditResult {
  sheet: MonthSheet;
  applied: AppliedEdit[];
  rejected: { edit: CellEdit; reason: string }[];
}

export function getCell(sheet: MonthSheet, employeeId: string, day: number): string {
  return sheet.cells[employeeId]?.[String(day)] ?? '';
}

/**
 * Ghi các ô chấm công. Kiểm tra: bảng chưa khóa, nhân sự thuộc bảng, ngày hợp lệ,
 * mã công tồn tại và đang sử dụng. Mã được chuẩn hóa về đúng ký hiệu trong danh mục.
 */
export function applyCellEdits(sheet: MonthSheet, edits: CellEdit[], codes: AttendanceCode[]): EditResult {
  const rejected: EditResult['rejected'] = [];
  const applied: AppliedEdit[] = [];
  if (sheet.locked) {
    return { sheet, applied, rejected: edits.map((edit) => ({ edit, reason: 'Bảng chấm công đã khóa.' })) };
  }
  const n = daysInMonth(sheet.year, sheet.month);
  const cells = { ...sheet.cells };
  for (const edit of edits) {
    if (!sheet.employeeIds.includes(edit.employeeId)) {
      rejected.push({ edit, reason: 'Nhân sự không thuộc bảng chấm công tháng này.' });
      continue;
    }
    if (!Number.isInteger(edit.day) || edit.day < 1 || edit.day > n) {
      rejected.push({ edit, reason: `Ngày ${edit.day} không có trong tháng.` });
      continue;
    }
    const raw = edit.value.normalize('NFC').trim();
    let value = '';
    if (raw) {
      const code = findCode(codes, raw);
      if (!code) {
        rejected.push({ edit, reason: `Mã công "${raw}" không có trong danh mục.` });
        continue;
      }
      if (!code.active) {
        rejected.push({ edit, reason: `Mã công "${code.code}" đã ngừng sử dụng.` });
        continue;
      }
      value = code.code;
    }
    const row = { ...(cells[edit.employeeId] ?? {}) };
    const previous = row[String(edit.day)] ?? '';
    if (previous === value) continue;
    if (value) row[String(edit.day)] = value;
    else delete row[String(edit.day)];
    cells[edit.employeeId] = row;
    applied.push({ ...edit, value, previous });
  }
  return { sheet: applied.length ? { ...sheet, cells, updatedAt: nowIso() } : sheet, applied, rejected };
}

/** Hoàn tác: ghi lại giá trị cũ, không kiểm tra mã (giá trị cũ có thể là mã đã ngừng dùng). */
export function revertEdits(sheet: MonthSheet, applied: AppliedEdit[]): MonthSheet {
  if (sheet.locked) return sheet;
  const cells = { ...sheet.cells };
  for (const a of [...applied].reverse()) {
    const row = { ...(cells[a.employeeId] ?? {}) };
    if (a.previous) row[String(a.day)] = a.previous;
    else delete row[String(a.day)];
    cells[a.employeeId] = row;
  }
  return { ...sheet, cells, updatedAt: nowIso() };
}

/** Các ô sẽ bị ghi đè (đang có mã khác) khi nhập hàng loạt. */
export function overwrittenCells(sheet: MonthSheet, edits: CellEdit[]): CellEdit[] {
  return edits.filter((e) => {
    const cur = getCell(sheet, e.employeeId, e.day);
    return cur !== '' && cur !== e.value.trim();
  });
}

export function setCellNote(sheet: MonthSheet, employeeId: string, day: number, note: string): MonthSheet {
  if (sheet.locked) throw new Error('Bảng chấm công đã khóa.');
  const cellNotes = { ...sheet.cellNotes };
  const row = { ...(cellNotes[employeeId] ?? {}) };
  if (note.trim()) row[String(day)] = note.trim();
  else delete row[String(day)];
  cellNotes[employeeId] = row;
  return { ...sheet, cellNotes, updatedAt: nowIso() };
}

export function setRowNote(sheet: MonthSheet, employeeId: string, note: string): MonthSheet {
  if (sheet.locked) throw new Error('Bảng chấm công đã khóa.');
  const rowNotes = { ...sheet.rowNotes };
  if (note.trim()) rowNotes[employeeId] = note.trim();
  else delete rowNotes[employeeId];
  return { ...sheet, rowNotes, updatedAt: nowIso() };
}

export function lockSheet(sheet: MonthSheet, unit: Unit, employees: Employee[], codes: AttendanceCode[], user: string): MonthSheet {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const rows: SheetRowSnapshot[] = sheet.employeeIds.map((id) => {
    const e = byId.get(id);
    return {
      employeeId: id,
      code: e?.code ?? '?',
      fullName: e?.fullName ?? '(không rõ)',
      position: e?.position ?? '',
      department: e?.department ?? '',
    };
  });
  return {
    ...sheet,
    locked: true,
    lockedAt: nowIso(),
    lockedBy: user,
    lockSnapshot: {
      codes: deepClone(codes),
      rows,
      unitName: unit.name,
      parentOrg: unit.parentOrg,
      calendar: deepClone(unit.calendar),
    },
    updatedAt: nowIso(),
  };
}

export function unlockSheet(sheet: MonthSheet): MonthSheet {
  const { lockSnapshot: _s, lockedAt: _a, lockedBy: _b, ...rest } = sheet;
  return { ...rest, locked: false, updatedAt: nowIso() };
}

/** Danh mục mã dùng để tính cho bảng: bảng đã khóa dùng ảnh chụp lúc khóa. */
export function sheetCodes(sheet: MonthSheet, current: AttendanceCode[]): AttendanceCode[] {
  return sheet.locked && sheet.lockSnapshot ? sheet.lockSnapshot.codes : current;
}

export function sheetCalendar(sheet: MonthSheet, unit: Unit) {
  return sheet.locked && sheet.lockSnapshot ? sheet.lockSnapshot.calendar : unit.calendar;
}

/** Thông tin dòng hiển thị: bảng khóa dùng tên/chức vụ tại thời điểm khóa. */
export function sheetRows(sheet: MonthSheet, employees: Employee[]): SheetRowSnapshot[] {
  if (sheet.locked && sheet.lockSnapshot) return sheet.lockSnapshot.rows;
  const byId = new Map(employees.map((e) => [e.id, e]));
  return sheet.employeeIds.map((id) => {
    const e = byId.get(id);
    return {
      employeeId: id,
      code: e?.code ?? '?',
      fullName: e?.fullName ?? '(đã xóa)',
      position: e?.position ?? '',
      department: e?.department ?? '',
    };
  });
}
