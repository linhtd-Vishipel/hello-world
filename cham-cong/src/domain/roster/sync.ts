import { daysInMonth } from '../calendar';
import { findCode } from '../codes';
import type { CellEdit } from '../sheet';
import type { AttendanceCode, Employee, MonthSheet } from '../types';
import type { Roster, ShiftConfig } from './types';

export type SyncAction = 'them' | 'cap_nhat' | 'xoa' | 'giu_nguyen_nghi' | 'xung_dot';

export interface SyncChange {
  employeeId: string;
  day: number;
  action: SyncAction;
  from: string;
  to: string;
  note: string;
}

export interface SyncPlan {
  blockers: string[];
  changes: SyncChange[];
  edits: CellEdit[];
  /** Nhân sự có trong lịch nhưng không có dòng ở bảng chấm công. */
  missingRows: string[];
  counts: Record<SyncAction, number>;
}

export const SYNC_ACTION_LABELS: Record<SyncAction, string> = {
  them: 'Ghi mới',
  cap_nhat: 'Cập nhật theo lịch mới',
  xoa: 'Xóa mã ca (lịch đã bỏ ca)',
  giu_nguyen_nghi: 'Giữ nguyên mã nghỉ đã có',
  xung_dot: 'Xung đột: lịch xếp ca vào ngày đã có mã nghỉ',
};

/**
 * Lập kế hoạch chuyển lịch phân ca sang bảng chấm công.
 * - Mã công lấy từ ánh xạ ca → mã công do quản trị viên chọn (không tự suy diễn).
 * - Không ghi đè ô đang có mã khác mã sinh từ ca (nghỉ phép, chế độ, công tác...).
 * - Chỉ thay đổi những ô thực sự khác.
 */
export function planSync(
  roster: Roster,
  config: ShiftConfig,
  sheet: MonthSheet | null,
  codes: AttendanceCode[],
  employees: Employee[],
): SyncPlan {
  const plan: SyncPlan = {
    blockers: [], changes: [], edits: [], missingRows: [],
    counts: { them: 0, cap_nhat: 0, xoa: 0, giu_nguyen_nghi: 0, xung_dot: 0 },
  };
  if (roster.status !== 'da_chot') plan.blockers.push('Lịch phân ca chưa được chốt. Hãy kiểm tra và chốt lịch trước khi đồng bộ.');
  if (!sheet) plan.blockers.push('Chưa có bảng chấm công tháng này. Tạo bảng chấm công trước khi đồng bộ.');
  if (sheet?.locked) plan.blockers.push('Bảng chấm công tháng này đã khóa.');
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const usedShifts = new Set(roster.assignments.map((a) => a.shiftId));
  for (const s of config.shifts) {
    if (!usedShifts.has(s.id)) continue;
    const c = codeById.get(s.attendanceCodeId);
    if (!c) plan.blockers.push(`Ca "${s.name}" chưa được gán mã chấm công (Cấu hình → Danh mục ca trực).`);
    else if (!c.active) plan.blockers.push(`Mã chấm công "${c.code}" của ca "${s.name}" đã ngừng sử dụng.`);
  }
  if (plan.blockers.length || !sheet) return plan;

  const shiftCode = new Map(config.shifts.map((s) => [s.id, codeById.get(s.attendanceCodeId)?.code ?? '']));
  const shiftCodeSet = new Set([...shiftCode.values()].filter(Boolean));
  const leaveCode = (id: string) => codeById.get(id)?.code ?? '';
  const n = daysInMonth(roster.year, roster.month);
  const names = new Map(employees.map((e) => [e.id, e.fullName]));

  const target = new Map<string, Map<number, string>>();
  for (const a of roster.assignments) {
    if (!target.has(a.employeeId)) target.set(a.employeeId, new Map());
    target.get(a.employeeId)!.set(a.day, shiftCode.get(a.shiftId) ?? '');
  }
  const people = new Set([...roster.participants, ...target.keys()]);
  for (const emp of people) {
    if (!sheet.employeeIds.includes(emp)) {
      if (target.has(emp) || Object.keys(roster.leaves[emp] ?? {}).length) plan.missingRows.push(names.get(emp) ?? emp);
      continue;
    }
    for (let d = 1; d <= n; d++) {
      const cur = sheet.cells[emp]?.[String(d)] ?? '';
      const curCode = cur ? findCode(codes, cur)?.code ?? cur : '';
      const leaveId = roster.leaves[emp]?.[String(d)];
      const want = target.get(emp)?.get(d) ?? (leaveId ? leaveCode(leaveId) : '');
      const curIsShift = curCode !== '' && shiftCodeSet.has(curCode);
      const add = (action: SyncAction, to: string, note = '') => {
        plan.changes.push({ employeeId: emp, day: d, action, from: curCode, to, note });
        plan.counts[action]++;
        if (action === 'them' || action === 'cap_nhat' || action === 'xoa') plan.edits.push({ employeeId: emp, day: d, value: to });
      };
      if (curCode === want) continue;
      if (curCode && !curIsShift) {
        // Mã nghỉ phép/chế độ/công tác đã nhập: không bao giờ ghi đè
        if (target.get(emp)?.has(d)) add('xung_dot', curCode, `Lịch xếp ${want} nhưng bảng công đã có ${curCode}`);
        else if (want) add('giu_nguyen_nghi', curCode, `Lịch ghi nghỉ ${want}, bảng công giữ ${curCode}`);
        continue;
      }
      if (!curCode) add('them', want);
      else if (!want) add('xoa', '');
      else add('cap_nhat', want);
    }
  }
  return plan;
}
