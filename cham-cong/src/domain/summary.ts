import { buildMonthDays, type DayInfo } from './calendar';
import { findCode, ruleAt } from './codes';
import { isEmployedOn } from './employees';
import type { AttendanceCode, CodeGroup, Employee, MonthSheet, WorkCalendar } from './types';
import { formatNumber, round2 } from './util';

export interface CellIssue {
  employeeId: string;
  day: number;
  kind: 'invalid_code' | 'missing' | 'outside_employment' | 'undefined_value';
  value?: string;
  message: string;
}

export interface EmployeeSummary {
  employeeId: string;
  /** Số lần xuất hiện theo mã (mã chuẩn). */
  counts: Record<string, number>;
  groupCounts: Record<string, number>;
  /** Số ngày có ghi mã (kể cả mã không hợp lệ). */
  markedDays: number;
  /** Số ngày làm việc thực tế (mã được cấu hình là làm việc thực tế). */
  actualWorkDays: number;
  /** Tổng công quy đổi theo hệ số đã cấu hình. */
  convertedTotal: number;
  missingDays: number[];
  issues: CellIssue[];
  explanation: string[];
  abnormal: boolean;
}

export interface SummaryContext {
  year: number;
  month: number;
  days: DayInfo[];
  codes: AttendanceCode[];
  groups: CodeGroup[];
  calendar: WorkCalendar;
}

export function makeContext(
  year: number,
  month: number,
  codes: AttendanceCode[],
  groups: CodeGroup[],
  calendar: WorkCalendar,
): SummaryContext {
  return { year, month, days: buildMonthDays(year, month, calendar), codes, groups, calendar };
}

export function computeEmployeeSummary(
  employeeId: string,
  row: Record<string, string> | undefined,
  employee: Employee | undefined,
  ctx: SummaryContext,
): EmployeeSummary {
  const counts: Record<string, number> = {};
  const groupCounts: Record<string, number> = {};
  const issues: CellIssue[] = [];
  const missingDays: number[] = [];
  let markedDays = 0;
  let actualWorkDays = 0;
  let totalHundredths = 0;
  const undefinedCodes = new Set<string>();

  for (const d of ctx.days) {
    const raw = row?.[String(d.day)]?.trim() ?? '';
    const employed = employee ? isEmployedOn(employee, d.date) : true;
    if (!raw) {
      if (employed && (ctx.calendar.mode === 'truc_ca' || !d.isOff)) missingDays.push(d.day);
      continue;
    }
    markedDays++;
    if (!employed) {
      issues.push({ employeeId, day: d.day, kind: 'outside_employment', value: raw, message: `Ngày ${d.day}: ngoài thời gian làm việc của nhân sự.` });
    }
    const code = findCode(ctx.codes, raw);
    if (!code) {
      issues.push({ employeeId, day: d.day, kind: 'invalid_code', value: raw, message: `Ngày ${d.day}: mã "${raw}" không có trong danh mục.` });
      continue;
    }
    counts[code.code] = (counts[code.code] ?? 0) + 1;
    groupCounts[code.groupId] = (groupCounts[code.groupId] ?? 0) + 1;
    const rule = ruleAt(code, ctx.year, ctx.month);
    if (rule.isActualWork) actualWorkDays++;
    if (rule.countsInTotal) {
      if (rule.value === null) undefinedCodes.add(code.code);
      else totalHundredths += Math.round(rule.value * 100);
    }
  }

  for (const c of undefinedCodes) {
    issues.push({ employeeId, day: 0, kind: 'undefined_value', value: c, message: `Mã "${c}" tính vào tổng công nhưng chưa quy định hệ số.` });
  }

  const convertedTotal = round2(totalHundredths / 100);
  const explanation: string[] = [];
  for (const code of ctx.codes) {
    const n = counts[code.code];
    if (!n) continue;
    const rule = ruleAt(code, ctx.year, ctx.month);
    if (!rule.countsInTotal) explanation.push(`${code.code} (${code.name}) × ${n}: không tính vào tổng công`);
    else if (rule.value === null) explanation.push(`${code.code} (${code.name}) × ${n}: CHƯA QUY ĐỊNH HỆ SỐ – chưa cộng`);
    else explanation.push(`${code.code} (${code.name}) × ${n} × ${formatNumber(rule.value)} = ${formatNumber(round2(n * rule.value))}`);
  }
  explanation.push(`Tổng công quy đổi = ${formatNumber(convertedTotal)}`);
  explanation.push(`Ngày làm việc thực tế = ${actualWorkDays}; ngày có ghi mã = ${markedDays}`);

  return {
    employeeId,
    counts,
    groupCounts,
    markedDays,
    actualWorkDays,
    convertedTotal,
    missingDays,
    issues,
    explanation,
    abnormal: issues.length > 0,
  };
}

export interface SheetSummary {
  rows: Record<string, EmployeeSummary>;
  totalConverted: number;
  totalActualWork: number;
  missingCells: number;
  invalidCells: number;
  abnormalEmployees: number;
  issues: CellIssue[];
}

export function computeSheetSummary(sheet: MonthSheet, employees: Employee[], ctx: SummaryContext): SheetSummary {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const rows: Record<string, EmployeeSummary> = {};
  let total = 0;
  let work = 0;
  let missing = 0;
  let invalid = 0;
  let abnormal = 0;
  const issues: CellIssue[] = [];
  for (const id of sheet.employeeIds) {
    const s = computeEmployeeSummary(id, sheet.cells[id], byId.get(id), ctx);
    rows[id] = s;
    total += Math.round(s.convertedTotal * 100);
    work += s.actualWorkDays;
    missing += s.missingDays.length;
    invalid += s.issues.filter((i) => i.kind === 'invalid_code').length;
    if (s.abnormal) abnormal++;
    issues.push(...s.issues);
  }
  return {
    rows,
    totalConverted: round2(total / 100),
    totalActualWork: work,
    missingCells: missing,
    invalidCells: invalid,
    abnormalEmployees: abnormal,
    issues,
  };
}

/** Mã công cần hiện cột tổng hợp: đang dùng hoặc có xuất hiện trong bảng. */
export function summaryCodes(codes: AttendanceCode[], sheet: MonthSheet | null): AttendanceCode[] {
  const used = new Set<string>();
  if (sheet) {
    for (const row of Object.values(sheet.cells)) {
      for (const v of Object.values(row)) {
        const c = v ? findCode(codes, v) : undefined;
        if (c) used.add(c.id);
      }
    }
  }
  return [...codes].filter((c) => c.active || used.has(c.id)).sort((a, b) => a.order - b.order);
}
