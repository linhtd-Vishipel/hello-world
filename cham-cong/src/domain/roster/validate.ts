import { formatNumber } from '../util';
import { shiftInterval } from './config';
import { capOf, demandsForDay, isEmployedOnDay, targetDaysOf, type RosterContext } from './context';
import type { Assignment } from './types';

export type IssueKind =
  | 'thieu_nguoi'
  | 'trung_ca'
  | 'nghi_phep'
  | 'ngoai_danh_sach'
  | 'khong_du_dieu_kien'
  | 'nghi_giua_ca'
  | 'lien_tiep'
  | 'dem_lien_tiep'
  | 'vi_tri_lien_tiep'
  | 'vuot_tran'
  | 'ngay_nghi'
  | 'cong_bang'
  | 'dinh_muc';

export const ISSUE_LABELS: Record<IssueKind, string> = {
  thieu_nguoi: 'Thiếu người',
  trung_ca: 'Trùng ca',
  nghi_phep: 'Xếp vào ngày nghỉ phép/chế độ',
  ngoai_danh_sach: 'Ngoài danh sách/thời gian làm việc',
  khong_du_dieu_kien: 'Không đủ điều kiện vị trí/ca',
  nghi_giua_ca: 'Không đủ thời gian nghỉ giữa ca',
  lien_tiep: 'Làm liên tiếp quá quy định',
  dem_lien_tiep: 'Trực đêm liên tiếp quá quy định',
  vi_tri_lien_tiep: 'Ở một vị trí liên tiếp quá quy định',
  vuot_tran: 'Vượt trần công',
  ngay_nghi: 'Bố trí vào ngày nghỉ của khối hành chính',
  cong_bang: 'Phân bổ chưa công bằng',
  dinh_muc: 'Thiếu/thừa công so với định mức',
};

export interface RosterIssue {
  severity: 'error' | 'warning';
  kind: IssueKind;
  day?: number;
  employeeId?: string;
  positionId?: string;
  shiftId?: string;
  message: string;
}

export interface PersonStats {
  employeeId: string;
  days: number;
  shifts: number;
  hours: number;
  nights: number;
  weekendDays: number;
  adminDays: number;
  leaveDays: number;
  byShift: Record<string, number>;
  byPosition: Record<string, number>;
  target: number;
  cap: number;
  /** Công đã bố trí + ngày nghỉ có mã − định mức */
  diff: number;
}

export function personStats(ctx: RosterContext, assignments: Assignment[]): Map<string, PersonStats> {
  const out = new Map<string, PersonStats>();
  for (const id of ctx.participants) {
    out.set(id, {
      employeeId: id, days: 0, shifts: 0, hours: 0, nights: 0, weekendDays: 0, adminDays: 0,
      leaveDays: ctx.leaves.get(id)?.size ?? 0, byShift: {}, byPosition: {},
      target: targetDaysOf(ctx, id), cap: capOf(ctx, id), diff: 0,
    });
  }
  const daysSeen = new Map<string, Set<number>>();
  for (const a of assignments) {
    const s = out.get(a.employeeId);
    const sh = ctx.shifts.get(a.shiftId);
    if (!s || !sh) continue;
    s.shifts++;
    s.hours += sh.hours;
    if (sh.isNight) s.nights++;
    s.byShift[a.shiftId] = (s.byShift[a.shiftId] ?? 0) + 1;
    s.byPosition[a.positionId] = (s.byPosition[a.positionId] ?? 0) + 1;
    if (ctx.positions.get(a.positionId)?.kind === 'hanh_chinh') s.adminDays++;
    const set = daysSeen.get(a.employeeId) ?? new Set<number>();
    if (!set.has(a.day)) {
      set.add(a.day);
      s.days++;
      if (ctx.dayTypes[a.day - 1] !== 'weekday') s.weekendDays++;
    }
    daysSeen.set(a.employeeId, set);
  }
  for (const s of out.values()) s.diff = s.days + s.leaveDays - s.target;
  return out;
}

/**
 * Kiểm tra độc lập toàn bộ lịch (không dùng lại trạng thái của thuật toán lập lịch).
 * Lỗi (error) phải xử lý trước khi chốt; cảnh báo (warning) cần người lập xem xét.
 */
export function validateRoster(ctx: RosterContext, assignments: Assignment[]): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const name = (id: string) => ctx.employees.get(id)?.fullName ?? id;
  const shiftName = (id: string) => ctx.shifts.get(id)?.name ?? id;
  const posName = (id: string) => ctx.positions.get(id)?.name ?? id;
  const r = ctx.config.rules;

  // 1. Thiếu người theo nhu cầu
  for (let d = 1; d <= ctx.nDays; d++) {
    for (const dm of demandsForDay(ctx, d)) {
      const have = assignments.filter((a) => a.day === d && a.shiftId === dm.shiftId && a.positionId === dm.positionId).length;
      if (have < dm.minStaff) {
        issues.push({
          severity: 'error', kind: 'thieu_nguoi', day: d, shiftId: dm.shiftId, positionId: dm.positionId,
          message: `Ngày ${d}: ${shiftName(dm.shiftId)} – ${posName(dm.positionId)} cần ${dm.minStaff} người, mới có ${have}.`,
        });
      }
    }
  }

  // 2. Kiểm tra theo từng người
  const byEmp = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, []);
    byEmp.get(a.employeeId)!.push(a);
  }
  for (const [emp, listRaw] of byEmp) {
    const nm = name(emp);
    const prof = ctx.profiles.get(emp);
    const list = [...listRaw].sort((x, y) => x.day - y.day || shiftStart(ctx, x) - shiftStart(ctx, y));
    if (!prof) {
      for (const a of list) {
        issues.push({ severity: 'error', kind: 'ngoai_danh_sach', day: a.day, employeeId: emp, message: `${nm} không thuộc danh sách tham gia phân ca.` });
      }
      continue;
    }
    const perDay = new Map<number, Assignment[]>();
    for (const a of list) perDay.set(a.day, [...(perDay.get(a.day) ?? []), a]);
    for (const [d, arr] of perDay) {
      if (arr.length > 1) {
        issues.push({ severity: 'error', kind: 'trung_ca', day: d, employeeId: emp, message: `Ngày ${d}: ${nm} được xếp ${arr.length} ca (${arr.map((a) => shiftName(a.shiftId)).join(', ')}).` });
      }
    }
    for (const a of list) {
      const sh = ctx.shifts.get(a.shiftId);
      const pos = ctx.positions.get(a.positionId);
      if (!sh || !pos) {
        issues.push({ severity: 'error', kind: 'khong_du_dieu_kien', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} được xếp vào ca/vị trí không còn trong cấu hình.` });
        continue;
      }
      const leave = ctx.leaves.get(emp)?.get(a.day);
      if (leave) {
        issues.push({ severity: 'error', kind: 'nghi_phep', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} đang nghỉ (${leave.code}) nhưng được xếp ${sh.name}.` });
      }
      if (!isEmployedOnDay(ctx, emp, a.day) || !prof.participates) {
        issues.push({ severity: 'error', kind: 'ngoai_danh_sach', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} ngoài thời gian làm việc hoặc không tham gia phân ca.` });
      }
      const qualified = prof.positionIds.includes(a.positionId) || prof.primaryPositionId === a.positionId;
      if (!qualified) {
        issues.push({ severity: 'error', kind: 'khong_du_dieu_kien', day: a.day, employeeId: emp, positionId: a.positionId, message: `Ngày ${a.day}: ${nm} chưa được thiết lập đảm nhận vị trí ${pos.name}.` });
      }
      if (sh.isNight && prof.noNight) {
        issues.push({ severity: 'error', kind: 'khong_du_dieu_kien', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} được thiết lập không trực đêm.` });
      }
      if (prof.unavailableWeekdays.includes(ctx.weekdays[a.day - 1])) {
        issues.push({ severity: 'error', kind: 'khong_du_dieu_kien', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} đăng ký không làm vào thứ này.` });
      }
      if (r.adminRestOnWeekend && prof.workType === 'hanh_chinh' && ctx.dayTypes[a.day - 1] !== 'weekday' && !(r.allowWeekendRotation && prof.weekendRotation)) {
        issues.push({ severity: 'warning', kind: 'ngay_nghi', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} (khối hành chính) được xếp vào ngày nghỉ cuối tuần/lễ.` });
      }
    }

    // Nghỉ giữa các ca (theo thời gian thực, kể cả nối từ tháng trước)
    const carry = ctx.carry.get(emp);
    let prevEnd = carry?.lastEnd ?? null;
    let prevNight = carry?.lastWasNight ?? false;
    for (const a of list) {
      const sh = ctx.shifts.get(a.shiftId);
      const pos = ctx.positions.get(a.positionId);
      if (!sh || !pos) continue;
      const [start, end] = shiftInterval(sh, a.day);
      if (prevEnd !== null) {
        const gapH = (start - prevEnd) / 60;
        if (gapH < 0) {
          issues.push({ severity: 'error', kind: 'trung_ca', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} có ca chồng thời gian với ca trước đó.` });
        } else if (gapH < r.minRestHours) {
          issues.push({ severity: 'error', kind: 'nghi_giua_ca', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} chỉ nghỉ ${formatNumber(gapH)} giờ trước ${sh.name} (tối thiểu ${r.minRestHours} giờ).` });
        } else if (prevNight && gapH < r.restAfterNightHours && (!r.restAfterNightOnlyTruc || pos.kind === 'truc_ca')) {
          issues.push({ severity: 'error', kind: 'nghi_giua_ca', day: a.day, employeeId: emp, message: `Ngày ${a.day}: ${nm} vừa hết ca đêm, chỉ nghỉ ${formatNumber(gapH)} giờ trước ${sh.name} (tối thiểu ${r.restAfterNightHours} giờ).` });
        }
      }
      prevEnd = prevEnd === null ? end : Math.max(prevEnd, end);
      prevNight = sh.isNight;
    }

    // Liên tiếp
    let run = carry?.consecWork ?? 0;
    let nightRun = carry?.consecNights ?? 0;
    const posRun: Record<string, number> = { ...(carry?.consecAtPos ?? {}) };
    let reportedRun = false;
    for (let d = 1; d <= ctx.nDays; d++) {
      const arr = perDay.get(d);
      if (!arr) {
        run = 0;
        nightRun = 0;
        for (const k of Object.keys(posRun)) posRun[k] = 0;
        reportedRun = false;
        continue;
      }
      run++;
      const night = arr.some((a) => ctx.shifts.get(a.shiftId)?.isNight);
      nightRun = night ? nightRun + 1 : 0;
      if (run > r.maxConsecutiveWorkDays && !reportedRun) {
        issues.push({ severity: 'error', kind: 'lien_tiep', day: d, employeeId: emp, message: `Ngày ${d}: ${nm} làm ${run} ngày liên tiếp (tối đa ${r.maxConsecutiveWorkDays}).` });
        reportedRun = true;
      }
      if (night && nightRun > r.maxConsecutiveNights) {
        issues.push({ severity: 'error', kind: 'dem_lien_tiep', day: d, employeeId: emp, message: `Ngày ${d}: ${nm} trực đêm ${nightRun} đêm liên tiếp (tối đa ${r.maxConsecutiveNights}).` });
      }
      const todayPos = new Set(arr.map((a) => a.positionId));
      for (const k of Object.keys(posRun)) if (!todayPos.has(k)) posRun[k] = 0;
      for (const pid of todayPos) {
        posRun[pid] = (posRun[pid] ?? 0) + 1;
        const lim = ctx.positions.get(pid)?.maxConsecutiveDays ?? 0;
        if (lim > 0 && posRun[pid] > lim) {
          issues.push({ severity: 'error', kind: 'vi_tri_lien_tiep', day: d, employeeId: emp, positionId: pid, message: `Ngày ${d}: ${nm} ở vị trí ${posName(pid)} ${posRun[pid]} ngày liên tiếp (tối đa ${lim}).` });
        }
      }
    }
  }

  // 3. Trần công, định mức, công bằng
  const stats = personStats(ctx, assignments);
  for (const s of stats.values()) {
    const nm = name(s.employeeId);
    if (s.days > s.cap) {
      issues.push({ severity: 'error', kind: 'vuot_tran', employeeId: s.employeeId, message: `${nm}: ${s.days} công, vượt trần ${s.cap} công/tháng.` });
    }
    if (Math.abs(s.diff) > r.fairnessTolerance) {
      issues.push({
        severity: 'warning', kind: 'dinh_muc', employeeId: s.employeeId,
        message: `${nm}: ${s.days} ngày làm + ${s.leaveDays} ngày nghỉ có mã = ${s.days + s.leaveDays}, định mức ${s.target} (${s.diff > 0 ? 'thừa' : 'thiếu'} ${Math.abs(s.diff)} công).`,
      });
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of ctx.participants) {
    const p = ctx.profiles.get(id)!;
    if (p.workType !== 'truc_ca') continue;
    const g = p.group || '(chung)';
    groups.set(g, [...(groups.get(g) ?? []), id]);
  }
  for (const [g, ids] of groups) {
    if (ids.length < 2) continue;
    /** withLeave: người nghỉ phép được tính bù số ngày nghỉ để không bị coi là "thiếu ca". */
    const check = (label: string, pick: (s: PersonStats) => number, withLeave = false) => {
      const vals = ids.map((id) => {
        const s = stats.get(id)!;
        return { id, v: pick(s) + (withLeave ? s.leaveDays : 0) };
      });
      const max = Math.max(...vals.map((x) => x.v));
      const min = Math.min(...vals.map((x) => x.v));
      if (max - min > r.fairnessTolerance) {
        const hi = vals.filter((x) => x.v === max).map((x) => name(x.id)).join(', ');
        const lo = vals.filter((x) => x.v === min).map((x) => name(x.id)).join(', ');
        issues.push({ severity: 'warning', kind: 'cong_bang', message: `Nhóm ${g}: ${label} chênh lệch ${max - min} (cao nhất ${hi}: ${max}; thấp nhất ${lo}: ${min}).` });
      }
    };
    check('số ngày trực (kể cả ngày nghỉ có mã)', (s) => s.days, true);
    check('số ca đêm', (s) => s.nights);
    check('số ngày cuối tuần/lễ', (s) => s.weekendDays);
  }
  return issues;
}

function shiftStart(ctx: RosterContext, a: Assignment): number {
  const s = ctx.shifts.get(a.shiftId);
  return s ? shiftInterval(s, a.day)[0] : 0;
}

export function countBySeverity(issues: RosterIssue[]) {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
}
