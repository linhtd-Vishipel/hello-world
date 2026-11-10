import { defaultShiftConfig } from '../src/domain/roster/config';
import { buildContext } from '../src/domain/roster/context';
import type { Roster, ShiftConfig, StaffProfile } from '../src/domain/roster/types';
import type { AttendanceCode, Employee } from '../src/domain/types';
import { newUnit } from '../src/domain/unit';
import { makeCode, SUGGESTED_CODES } from '../src/domain/codes';

export function fixture(opts: { truc?: number; year?: number; month?: number } = {}) {
  const unit = newUnit({ code: 'CMR', name: 'Đài TTDH Cà Mau' });
  unit.calendar.holidays = [];
  const config: ShiftConfig = defaultShiftConfig(unit.id);
  const t = new Date().toISOString();
  const mk = (i: number, name: string): Employee => ({
    id: `e${i}`, unitId: unit.id, code: `NV${i}`, fullName: name, position: '', department: '',
    status: 'active', order: i, createdAt: t, updatedAt: t,
  });
  const trucNames = ['An', 'Bình', 'Cường', 'Dung', 'Em', 'Giang', 'Hùng', 'Khánh'].slice(0, opts.truc ?? 6);
  const employees: Employee[] = [
    ...trucNames.map((n, i) => mk(i + 1, n)),
    mk(20, 'Long'), mk(21, 'Duy Linh'),
  ];
  const base = (e: Employee): StaffProfile => ({
    employeeId: e.id, participates: true, workType: 'truc_ca', group: 'Trực canh',
    positionIds: ['pos_kt', 'pos_ks', 'pos_nd'], primaryPositionId: '', noNight: false,
    unavailableWeekdays: [], weekendRotation: false, targetDays: 0, maxDays: 0, note: '',
  });
  config.profiles = employees.map(base);
  const long = config.profiles.find((p) => p.employeeId === 'e20')!;
  Object.assign(long, { workType: 'hanh_chinh', primaryPositionId: 'pos_ks', positionIds: ['pos_ks'], group: 'Hành chính', weekendRotation: true });
  const linh = config.profiles.find((p) => p.employeeId === 'e21')!;
  Object.assign(linh, { workType: 'hanh_chinh', primaryPositionId: 'pos_nd', positionIds: ['pos_nd'], group: 'Hành chính', weekendRotation: true });
  const codes: AttendanceCode[] = SUGGESTED_CODES.map((s, i) => makeCode(unit.id, s, i + 1, '2020-01', true));
  const extra = (code: string, name: string) => makeCode(unit.id, { code, name, groupId: 'lam_viec', color: '#fff', value: 1, countsInTotal: true, isActualWork: true }, 50, '2020-01', true);
  codes.push(extra('K1', 'Trực canh ca 1'), extra('K2', 'Trực canh ca 2'), extra('CĐ', 'Ca đêm'), extra('K', 'Hành chính'));
  const byCode = (c: string) => codes.find((x) => x.code === c)!.id;
  config.shifts.find((s) => s.id === 'sh_ca1')!.attendanceCodeId = byCode('K1');
  config.shifts.find((s) => s.id === 'sh_ca2')!.attendanceCodeId = byCode('K2');
  config.shifts.find((s) => s.id === 'sh_ca3')!.attendanceCodeId = byCode('CĐ');
  config.shifts.find((s) => s.id === 'sh_hc')!.attendanceCodeId = byCode('K');
  const year = opts.year ?? 2026;
  const month = opts.month ?? 11;
  const roster: Roster = {
    id: `${unit.id}:${year}-${String(month).padStart(2, '0')}`, unitId: unit.id, year, month, status: 'nhap',
    participants: employees.map((e) => e.id), assignments: [], leaves: {}, dayNotes: {}, createdAt: t, updatedAt: t,
  };
  const ctx = (r: Roster = roster, prev: Roster[] = [], sheet = null) =>
    buildContext({ unit, config, roster: r, employees, codes, previousRosters: prev, sheet });
  return { unit, config, employees, codes, roster, ctx, byCode };
}
