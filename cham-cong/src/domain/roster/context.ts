import { daysInMonth, isoDate, monthKey, shiftMonth, weekdayOf } from '../calendar';
import { findCode } from '../codes';
import { isEmployedOn } from '../employees';
import type { AttendanceCode, Employee, MonthSheet, Unit } from '../types';
import { dayType, profileOf, shiftInterval } from './config';
import type { Assignment, DayType, Position, Roster, ShiftConfig, ShiftDef, StaffProfile } from './types';

export interface LeaveMark {
  /** Ký hiệu mã công hiển thị */
  code: string;
  codeId?: string;
  source: 'lich' | 'cham_cong';
}

export interface CarryState {
  /** Thời điểm kết thúc ca gần nhất (phút, tương đối với 00:00 ngày 1 tháng này; âm = tháng trước). */
  lastEnd: number | null;
  lastWasNight: boolean;
  consecWork: number;
  consecNights: number;
  /** Số ngày liên tiếp ở từng vị trí, tính đến ngày cuối tháng trước. */
  consecAtPos: Record<string, number>;
}

export interface HistoryStats {
  shifts: number;
  nights: number;
  weekendDays: number;
  months: number;
}

export interface RosterContext {
  unit: Unit;
  config: ShiftConfig;
  year: number;
  month: number;
  nDays: number;
  dayTypes: DayType[]; // index = day - 1
  weekdays: number[];
  employees: Map<string, Employee>;
  profiles: Map<string, StaffProfile>;
  participants: string[];
  shifts: Map<string, ShiftDef>;
  positions: Map<string, Position>;
  leaves: Map<string, Map<number, LeaveMark>>;
  carry: Map<string, CarryState>;
  history: Map<string, HistoryStats>;
  /** Mã công do ca trực sinh ra (dùng để phân biệt với mã nghỉ phép/chế độ). */
  shiftCodeIds: Set<string>;
}

export interface ContextInput {
  unit: Unit;
  config: ShiftConfig;
  roster: Pick<Roster, 'year' | 'month' | 'participants' | 'leaves'>;
  employees: Employee[];
  codes: AttendanceCode[];
  /** Bảng chấm công cùng tháng (nếu có): mã nghỉ đã nhập được coi là ngày nghỉ đã duyệt. */
  sheet?: MonthSheet | null;
  /** Các lịch phân ca các tháng trước (để nối trạng thái và cân đối công bằng). */
  previousRosters?: Roster[];
}

export function buildContext(input: ContextInput): RosterContext {
  const { unit, config, roster, employees, codes } = input;
  const { year, month } = roster;
  const nDays = daysInMonth(year, month);
  const dayTypes: DayType[] = [];
  const weekdays: number[] = [];
  for (let d = 1; d <= nDays; d++) {
    dayTypes.push(dayType(unit, config.rules, year, month, d));
    weekdays.push(weekdayOf(year, month, d));
  }
  const empMap = new Map(employees.filter((e) => e.unitId === unit.id).map((e) => [e.id, e]));
  const profiles = new Map<string, StaffProfile>();
  for (const id of roster.participants) {
    const e = empMap.get(id);
    if (e) profiles.set(id, profileOf(config, e));
  }
  const shiftCodeIds = new Set(config.shifts.map((s) => s.attendanceCodeId).filter(Boolean));
  const codeById = new Map(codes.map((c) => [c.id, c]));

  const leaves = new Map<string, Map<number, LeaveMark>>();
  const mark = (emp: string, day: number, m: LeaveMark) => {
    if (!leaves.has(emp)) leaves.set(emp, new Map());
    const row = leaves.get(emp)!;
    if (!row.has(day) || m.source === 'cham_cong') row.set(day, m);
  };
  for (const [emp, row] of Object.entries(roster.leaves)) {
    for (const [d, codeId] of Object.entries(row)) {
      mark(emp, Number(d), { code: codeById.get(codeId)?.code ?? '?', codeId, source: 'lich' });
    }
  }
  // Mã nghỉ phép/chế độ đã nhập ở bảng chấm công: không phải mã sinh từ ca → ngày nghỉ được tôn trọng.
  if (input.sheet) {
    for (const [emp, row] of Object.entries(input.sheet.cells)) {
      for (const [d, v] of Object.entries(row)) {
        const c = v ? findCode(codes, v) : undefined;
        if (!v || (c && shiftCodeIds.has(c.id))) continue;
        mark(emp, Number(d), { code: v, codeId: c?.id, source: 'cham_cong' });
      }
    }
  }

  const shifts = new Map(config.shifts.map((s) => [s.id, s]));
  const prev = (input.previousRosters ?? []).filter((r) => r.unitId === unit.id);
  const carry = computeCarry(prev, year, month, shifts);
  const history = computeHistory(prev, unit, config, year, month, shifts);

  return {
    unit, config, year, month, nDays, dayTypes, weekdays,
    employees: empMap, profiles, participants: roster.participants.filter((id) => empMap.has(id)),
    shifts, positions: new Map(config.positions.map((p) => [p.id, p])),
    leaves, carry, history, shiftCodeIds,
  };
}

function computeCarry(prev: Roster[], year: number, month: number, shifts: Map<string, ShiftDef>): Map<string, CarryState> {
  const out = new Map<string, CarryState>();
  const p = shiftMonth(year, month, -1);
  const last = prev.find((r) => r.year === p.year && r.month === p.month);
  if (!last) return out;
  const n = daysInMonth(p.year, p.month);
  const offset = n * 1440;
  const byEmp = new Map<string, Assignment[]>();
  for (const a of last.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, []);
    byEmp.get(a.employeeId)!.push(a);
  }
  for (const [emp, list] of byEmp) {
    const days = new Map(list.map((a) => [a.day, a]));
    let consecWork = 0;
    let consecNights = 0;
    const consecAtPos: Record<string, number> = {};
    for (let d = n; d >= 1 && days.has(d); d--) consecWork++;
    for (let d = n; d >= 1 && days.has(d) && shifts.get(days.get(d)!.shiftId)?.isNight; d--) consecNights++;
    const lastA = days.get(n);
    if (lastA) {
      let k = 0;
      for (let d = n; d >= 1 && days.get(d)?.positionId === lastA.positionId; d--) k++;
      consecAtPos[lastA.positionId] = k;
    }
    let lastEnd: number | null = null;
    let lastWasNight = false;
    for (const a of list) {
      const s = shifts.get(a.shiftId);
      if (!s) continue;
      const end = shiftInterval(s, a.day)[1] - offset;
      if (lastEnd === null || end > lastEnd) {
        lastEnd = end;
        lastWasNight = s.isNight;
      }
    }
    out.set(emp, { lastEnd, lastWasNight, consecWork, consecNights, consecAtPos });
  }
  return out;
}

function computeHistory(prev: Roster[], unit: Unit, config: ShiftConfig, year: number, month: number, shifts: Map<string, ShiftDef>) {
  const out = new Map<string, HistoryStats>();
  const keys = new Set<string>();
  for (let i = 1; i <= config.rules.historyMonths; i++) {
    const p = shiftMonth(year, month, -i);
    keys.add(monthKey(p.year, p.month));
  }
  for (const r of prev) {
    if (!keys.has(monthKey(r.year, r.month))) continue;
    const seen = new Set<string>();
    for (const a of r.assignments) {
      const h = out.get(a.employeeId) ?? { shifts: 0, nights: 0, weekendDays: 0, months: 0 };
      h.shifts++;
      if (shifts.get(a.shiftId)?.isNight) h.nights++;
      if (dayType(unit, config.rules, r.year, r.month, a.day) !== 'weekday') h.weekendDays++;
      if (!seen.has(a.employeeId)) {
        h.months++;
        seen.add(a.employeeId);
      }
      out.set(a.employeeId, h);
    }
  }
  return out;
}

export function isEmployedOnDay(ctx: RosterContext, empId: string, day: number): boolean {
  const e = ctx.employees.get(empId);
  if (!e) return false;
  return isEmployedOn(e, isoDate(ctx.year, ctx.month, day));
}

/** Định mức công tháng của một người. */
export function targetDaysOf(ctx: RosterContext, empId: string): number {
  const p = ctx.profiles.get(empId);
  if (p?.targetDays) return p.targetDays;
  if (ctx.config.rules.monthlyTarget) return ctx.config.rules.monthlyTarget;
  return ctx.dayTypes.filter((t) => t === 'weekday').length;
}

export function capOf(ctx: RosterContext, empId: string): number {
  const p = ctx.profiles.get(empId);
  return p?.maxDays || ctx.config.rules.monthlyCap;
}

/** Các nhu cầu áp dụng cho ngày d. */
export function demandsForDay(ctx: RosterContext, day: number) {
  const t = ctx.dayTypes[day - 1];
  return ctx.config.demands.filter((d) => d.dayTypes.includes(t) && ctx.shifts.get(d.shiftId)?.active !== false);
}
