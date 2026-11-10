import { isoDate, isValidIsoDate, weekdayOf } from '../calendar';
import type { Employee, Unit } from '../types';
import { nowIso, uid } from '../util';
import type { DayType, Demand, Position, RosterRules, ShiftConfig, ShiftDef, StaffProfile } from './types';

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  weekday: 'Ngày thường',
  weekend: 'Cuối tuần',
  holiday: 'Ngày lễ',
};

export const WORK_TYPE_LABELS = {
  truc_ca: 'Trực ca',
  hanh_chinh: 'Hành chính',
  kiem_nhiem: 'Kiêm nhiệm',
} as const;

/** Mặc định theo quy tắc đã áp dụng tại đài trực 24/7; quản trị viên sửa trong Cấu hình. */
export const DEFAULT_RULES: RosterRules = {
  monthlyCap: 26,
  monthlyTarget: 0,
  maxConsecutiveWorkDays: 6,
  maxConsecutiveNights: 2,
  minRestHours: 8,
  restAfterNightHours: 24,
  restAfterNightOnlyTruc: true,
  adminRestOnWeekend: true,
  allowWeekendRotation: true,
  fairnessTolerance: 2,
  historyMonths: 3,
  specialWorkdays: [],
};

export function defaultShiftConfig(unitId: string): ShiftConfig {
  const kt = { id: 'pos_kt', name: 'Trực canh khai thác', short: 'KT', kind: 'truc_ca' as const, maxConsecutiveDays: 0, note: '' };
  const ks = { id: 'pos_ks', name: 'Kiểm tra kiểm soát', short: 'KS', kind: 'hanh_chinh' as const, maxConsecutiveDays: 0, note: '' };
  const nd = { id: 'pos_nd', name: 'Vận hành nguồn điện', short: 'NĐ', kind: 'hanh_chinh' as const, maxConsecutiveDays: 0, note: '' };
  const shifts: ShiftDef[] = [
    { id: 'sh_ca1', name: 'Ca 1', short: 'C1', start: '06:00', end: '14:00', hours: 8, isNight: false, color: '#bfdbfe', attendanceCodeId: '', active: true },
    { id: 'sh_ca2', name: 'Ca 2', short: 'C2', start: '14:00', end: '22:00', hours: 8, isNight: false, color: '#c7d2fe', attendanceCodeId: '', active: true },
    { id: 'sh_ca3', name: 'Ca 3 (đêm)', short: 'C3', start: '22:00', end: '06:00', hours: 8, isNight: true, color: '#a5b4fc', attendanceCodeId: '', active: true },
    { id: 'sh_hc', name: 'Hành chính', short: 'HC', start: '07:30', end: '16:30', hours: 8, isNight: false, color: '#bbf7d0', attendanceCodeId: '', active: true },
  ];
  const all: DayType[] = ['weekday', 'weekend', 'holiday'];
  const demands: Demand[] = [
    { id: 'dm_1', shiftId: 'sh_ca1', positionId: kt.id, minStaff: 1, dayTypes: all },
    { id: 'dm_2', shiftId: 'sh_ca2', positionId: kt.id, minStaff: 1, dayTypes: all },
    { id: 'dm_3', shiftId: 'sh_ca3', positionId: kt.id, minStaff: 1, dayTypes: all },
    { id: 'dm_4', shiftId: 'sh_hc', positionId: ks.id, minStaff: 1, dayTypes: all },
    { id: 'dm_5', shiftId: 'sh_hc', positionId: nd.id, minStaff: 1, dayTypes: all },
  ];
  return { id: unitId, unitId, positions: [kt, ks, nd], shifts, demands, profiles: [], rules: { ...DEFAULT_RULES }, updatedAt: nowIso() };
}

export function newPosition(): Position {
  return { id: uid('pos'), name: '', short: '', kind: 'truc_ca', maxConsecutiveDays: 0, note: '' };
}

export function newShift(): ShiftDef {
  return { id: uid('sh'), name: '', short: '', start: '08:00', end: '16:00', hours: 8, isNight: false, color: '#e0f2fe', attendanceCodeId: '', active: true };
}

export function defaultProfile(emp: Employee, config: ShiftConfig): StaffProfile {
  // Mặc định: nhóm trực canh được bù cho mọi vị trí (kể cả hành chính khi người phụ trách nghỉ).
  const all = config.positions.map((p) => p.id);
  return {
    employeeId: emp.id,
    participates: emp.status === 'active',
    workType: 'truc_ca',
    group: '',
    positionIds: all,
    primaryPositionId: '',
    noNight: false,
    unavailableWeekdays: [],
    weekendRotation: false,
    targetDays: 0,
    maxDays: 0,
    note: '',
  };
}

/** Hồ sơ phân ca của nhân sự; tạo mặc định (chưa lưu) nếu chưa có. */
export function profileOf(config: ShiftConfig, emp: Employee): StaffProfile {
  return config.profiles.find((p) => p.employeeId === emp.id) ?? defaultProfile(emp, config);
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Thời lượng ca theo phút (ca qua đêm được tính sang ngày hôm sau). */
export function shiftDuration(s: Pick<ShiftDef, 'start' | 'end'>): number {
  const a = parseHHMM(s.start) ?? 0;
  const b = parseHHMM(s.end) ?? 0;
  return b > a ? b - a : b + 1440 - a;
}

/** Khoảng thời gian tuyệt đối (phút tính từ 00:00 ngày 1 của tháng). */
export function shiftInterval(s: ShiftDef, day: number): [number, number] {
  const start = (day - 1) * 1440 + (parseHHMM(s.start) ?? 0);
  return [start, start + shiftDuration(s)];
}

export function dayType(unit: Unit, rules: RosterRules, year: number, month: number, day: number): DayType {
  const date = isoDate(year, month, day);
  if (rules.specialWorkdays.includes(date)) return 'weekday';
  if (unit.calendar.holidays.some((h) => h.date === date)) return 'holiday';
  if (unit.calendar.weekendDays.includes(weekdayOf(year, month, day))) return 'weekend';
  return 'weekday';
}

export function validateShiftConfig(c: ShiftConfig, codeIds: Set<string>): string[] {
  const errors: string[] = [];
  const posIds = new Set<string>();
  for (const p of c.positions) {
    if (!p.name.trim()) errors.push('Vị trí công việc chưa có tên.');
    if (posIds.has(p.id)) errors.push(`Trùng mã vị trí ${p.id}.`);
    posIds.add(p.id);
    if (p.maxConsecutiveDays < 0) errors.push(`Vị trí ${p.name}: số ngày liên tiếp không hợp lệ.`);
  }
  const shiftIds = new Set<string>();
  for (const s of c.shifts) {
    if (!s.name.trim()) errors.push('Ca trực chưa có tên.');
    if (!s.short.trim()) errors.push(`Ca ${s.name}: thiếu ký hiệu ngắn.`);
    if (parseHHMM(s.start) === null || parseHHMM(s.end) === null) errors.push(`Ca ${s.name}: giờ bắt đầu/kết thúc phải dạng HH:MM.`);
    if (!(s.hours > 0 && s.hours <= 24)) errors.push(`Ca ${s.name}: số giờ làm việc phải trong khoảng 0–24.`);
    if (s.attendanceCodeId && !codeIds.has(s.attendanceCodeId)) errors.push(`Ca ${s.name}: mã chấm công không còn trong danh mục.`);
    shiftIds.add(s.id);
  }
  const seen = new Set<string>();
  for (const d of c.demands) {
    if (!shiftIds.has(d.shiftId)) errors.push('Nhu cầu nhân sự trỏ tới ca không tồn tại.');
    if (!posIds.has(d.positionId)) errors.push('Nhu cầu nhân sự trỏ tới vị trí không tồn tại.');
    if (!Number.isInteger(d.minStaff) || d.minStaff < 1 || d.minStaff > 50) errors.push('Số người tối thiểu phải là số nguyên 1–50.');
    if (!d.dayTypes.length) errors.push('Nhu cầu nhân sự cần chọn ít nhất một loại ngày.');
    const key = `${d.shiftId}|${d.positionId}|${[...d.dayTypes].sort().join(',')}`;
    if (seen.has(key)) errors.push('Trùng dòng nhu cầu nhân sự (cùng ca, vị trí, loại ngày).');
    seen.add(key);
  }
  for (const p of c.profiles) {
    if (p.primaryPositionId && !posIds.has(p.primaryPositionId)) errors.push('Hồ sơ phân ca trỏ tới vị trí chính không tồn tại.');
    if (p.targetDays < 0 || p.maxDays < 0) errors.push('Định mức/trần công cá nhân không hợp lệ.');
  }
  const r = c.rules;
  const nums: [number, string][] = [
    [r.monthlyCap, 'Trần công/tháng'], [r.maxConsecutiveWorkDays, 'Số ngày làm liên tiếp tối đa'],
    [r.maxConsecutiveNights, 'Số đêm liên tiếp tối đa'], [r.minRestHours, 'Giờ nghỉ tối thiểu'],
    [r.restAfterNightHours, 'Giờ nghỉ sau ca đêm'], [r.fairnessTolerance, 'Ngưỡng chênh lệch'],
  ];
  for (const [v, label] of nums) if (!Number.isFinite(v) || v < 0) errors.push(`${label} không hợp lệ.`);
  if (r.monthlyCap < 1 || r.monthlyCap > 31) errors.push('Trần công/tháng phải trong khoảng 1–31.');
  if (r.maxConsecutiveWorkDays < 1) errors.push('Số ngày làm liên tiếp tối đa phải ≥ 1.');
  for (const d of r.specialWorkdays) if (!isValidIsoDate(d)) errors.push(`Ngày làm việc đặc biệt không hợp lệ: ${d}`);
  return errors;
}
