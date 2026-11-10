import { daysInMonth, formatMonth, isoDate, isValidIsoDate } from './calendar';
import type { Employee, MonthSheet } from './types';
import { foldVietnamese, normKey } from './util';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export type EmployeeDraft = Pick<Employee, 'code' | 'fullName' | 'position' | 'department' | 'status'> &
  Partial<Pick<Employee, 'id' | 'startDate' | 'endDate' | 'note'>>;

export function validateEmployee(draft: EmployeeDraft, others: Employee[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = draft.code?.trim() ?? '';
  const name = draft.fullName?.trim() ?? '';
  if (!code) errors.push('Mã nhân viên không được để trống.');
  if (!name) errors.push('Họ tên không được để trống.');
  if (code && /\s/.test(code)) errors.push('Mã nhân viên không được chứa khoảng trắng.');
  if (draft.startDate && !isValidIsoDate(draft.startDate)) errors.push('Ngày bắt đầu không hợp lệ.');
  if (draft.endDate && !isValidIsoDate(draft.endDate)) errors.push('Ngày kết thúc không hợp lệ.');
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.push('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.');
  }
  const rest = others.filter((e) => e.id !== draft.id);
  if (code) {
    const dup = rest.find((e) => normKey(e.code) === normKey(code));
    if (dup) errors.push(`Mã nhân viên "${code}" đã được dùng cho ${dup.fullName}.`);
  }
  if (name) {
    const sameName = rest.filter((e) => foldVietnamese(e.fullName) === foldVietnamese(name));
    if (sameName.length) {
      warnings.push(
        `Có ${sameName.length} nhân sự trùng họ tên (${sameName.map((e) => e.code).join(', ')}). Kiểm tra có phải trùng dữ liệu không.`,
      );
    }
  }
  if (draft.status === 'inactive' && !draft.endDate) {
    warnings.push('Nhân sự đã nghỉ nhưng chưa có ngày kết thúc: sẽ không được đưa vào các bảng mới.');
  }
  return { errors, warnings };
}

/** Nhân sự có thuộc bảng chấm công tháng này không (theo trạng thái và thời gian làm việc). */
export function isEligibleForMonth(emp: Employee, year: number, month: number): boolean {
  const first = isoDate(year, month, 1);
  const last = isoDate(year, month, daysInMonth(year, month));
  if (emp.startDate && emp.startDate > last) return false;
  if (emp.endDate && emp.endDate < first) return false;
  if (emp.status === 'inactive' && !emp.endDate) return false;
  return true;
}

export function isEmployedOn(emp: Employee, date: string): boolean {
  if (emp.startDate && date < emp.startDate) return false;
  if (emp.endDate && date > emp.endDate) return false;
  return true;
}

export function sortEmployees(list: Employee[]): Employee[] {
  return [...list].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code, 'vi'));
}

export function eligibleEmployees(list: Employee[], year: number, month: number): Employee[] {
  return sortEmployees(list.filter((e) => isEligibleForMonth(e, year, month)));
}

export function rowHasData(sheet: MonthSheet, employeeId: string): boolean {
  const row = sheet.cells[employeeId];
  const notes = sheet.cellNotes[employeeId];
  return (
    (!!row && Object.values(row).some((v) => v && v.trim() !== '')) ||
    (!!notes && Object.values(notes).some((v) => v && v.trim() !== '')) ||
    !!sheet.rowNotes[employeeId]?.trim()
  );
}

export function monthsWithData(employeeId: string, sheets: MonthSheet[]): string[] {
  return sheets
    .filter((s) => rowHasData(s, employeeId))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => formatMonth(s.year, s.month));
}

export function canDeleteEmployee(employeeId: string, sheets: MonthSheet[]): { ok: boolean; months: string[] } {
  const months = monthsWithData(employeeId, sheets);
  const inLocked = sheets.filter((s) => s.locked && s.employeeIds.includes(employeeId)).map((s) => formatMonth(s.year, s.month));
  const all = Array.from(new Set([...months, ...inLocked]));
  return { ok: all.length === 0, months: all };
}

export interface MembershipChange {
  sheetId: string;
  label: string;
  locked: boolean;
  toAdd: string[];
  toRemove: string[];
  /** Không còn thuộc tháng nhưng có dữ liệu → giữ lại và cảnh báo. */
  keptWithData: string[];
}

/**
 * Tính các thay đổi danh sách dòng của những bảng đã tạo khi danh sách nhân sự thay đổi.
 * Bảng đã khóa không bị thay đổi (chỉ thông báo).
 */
export function planMembership(employees: Employee[], sheets: MonthSheet[]): MembershipChange[] {
  const changes: MembershipChange[] = [];
  for (const s of sheets) {
    if (s.locked) continue;
    const eligible = new Set(eligibleEmployees(employees, s.year, s.month).map((e) => e.id));
    const toAdd = [...eligible].filter((id) => !s.employeeIds.includes(id));
    const toRemove: string[] = [];
    const keptWithData: string[] = [];
    for (const id of s.employeeIds) {
      if (eligible.has(id)) continue;
      if (rowHasData(s, id)) keptWithData.push(id);
      else toRemove.push(id);
    }
    if (toAdd.length || toRemove.length || keptWithData.length) {
      changes.push({ sheetId: s.id, label: formatMonth(s.year, s.month), locked: false, toAdd, toRemove, keptWithData });
    }
  }
  return changes;
}

export function applyMembership(sheet: MonthSheet, change: MembershipChange, employees: Employee[]): MonthSheet {
  if (sheet.locked) return sheet;
  const ids = sheet.employeeIds.filter((id) => !change.toRemove.includes(id));
  for (const id of change.toAdd) if (!ids.includes(id)) ids.push(id);
  const order = new Map(sortEmployees(employees).map((e, i) => [e.id, i]));
  ids.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  return { ...sheet, employeeIds: ids };
}

/** Bảng nào sẽ bị ảnh hưởng nếu áp dụng bản nháp nhân sự (thêm/sửa). */
export function previewEmployeeImpact(draft: Employee, employees: Employee[], sheets: MonthSheet[]) {
  const next = employees.some((e) => e.id === draft.id)
    ? employees.map((e) => (e.id === draft.id ? draft : e))
    : [...employees, draft];
  const changes = planMembership(next, sheets).filter(
    (c) => c.toAdd.includes(draft.id) || c.toRemove.includes(draft.id) || c.keptWithData.includes(draft.id),
  );
  const lockedUntouched = sheets
    .filter((s) => s.locked)
    .filter((s) => s.employeeIds.includes(draft.id) || isEligibleForMonth(draft, s.year, s.month))
    .map((s) => formatMonth(s.year, s.month));
  return {
    added: changes.filter((c) => c.toAdd.includes(draft.id)).map((c) => c.label),
    removed: changes.filter((c) => c.toRemove.includes(draft.id)).map((c) => c.label),
    keptWithData: changes.filter((c) => c.keptWithData.includes(draft.id)).map((c) => c.label),
    lockedUntouched,
  };
}
