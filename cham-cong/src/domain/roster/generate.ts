import { shiftInterval } from './config';
import { capOf, demandsForDay, isEmployedOnDay, targetDaysOf, type RosterContext } from './context';
import type { Assignment, Demand } from './types';

export interface GenerateOptions {
  /** Giữ các ô xếp tay (manual). Mặc định true. */
  keepManual?: boolean;
  /** Giữ toàn bộ lịch hiện có, chỉ bổ sung chỗ còn thiếu. */
  keepExisting?: boolean;
  attempts?: number;
  seed?: number;
}

export interface Shortage {
  day: number;
  shiftId: string;
  positionId: string;
  missing: number;
  /** Lý do từng người không xếp được */
  reasons: { employeeId: string; reason: string }[];
}

export interface GenerateResult {
  assignments: Assignment[];
  shortages: Shortage[];
  attempts: number;
}

interface State {
  lastEnd: number | null;
  lastWasNight: boolean;
  lastDay: number;
  consecWork: number;
  consecNights: number;
  posRun: Record<string, number>;
  days: number;
  nights: number;
  weekendDays: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Tự động lập lịch phân ca cho cả tháng. Không bao giờ xếp vi phạm quy tắc cứng:
 * vị trí không đủ người được để trống và báo lý do cụ thể trong `shortages`.
 */
export function generateRoster(ctx: RosterContext, existing: Assignment[], opts: GenerateOptions = {}): GenerateResult {
  const attempts = Math.max(1, opts.attempts ?? 40);
  let best: { assignments: Assignment[]; shortages: Shortage[]; score: number } | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = runAttempt(ctx, existing, opts, i === 0 ? null : rng((opts.seed ?? 20261) + i * 7919));
    const score = attemptScore(ctx, res.assignments, res.shortages);
    if (!best || score < best.score) best = { ...res, score };
    if (best.shortages.length === 0 && i >= 9 && score < 1000) break;
  }
  return { assignments: best!.assignments, shortages: best!.shortages, attempts };
}

function attemptScore(ctx: RosterContext, assignments: Assignment[], shortages: Shortage[]): number {
  const missing = shortages.reduce((n, s) => n + s.missing, 0);
  const days = new Map<string, Set<number>>();
  const nights = new Map<string, number>();
  for (const a of assignments) {
    days.set(a.employeeId, (days.get(a.employeeId) ?? new Set()).add(a.day));
    if (ctx.shifts.get(a.shiftId)?.isNight) nights.set(a.employeeId, (nights.get(a.employeeId) ?? 0) + 1);
  }
  const truc = ctx.participants.filter((id) => ctx.profiles.get(id)?.workType === 'truc_ca');
  const spread = (vals: number[]) => (vals.length ? Math.max(...vals) - Math.min(...vals) : 0);
  const dayVals = truc.map((id) => (days.get(id)?.size ?? 0) + (ctx.leaves.get(id)?.size ?? 0));
  const nightVals = truc.map((id) => nights.get(id) ?? 0);
  let excess = 0;
  for (const id of ctx.participants) excess += Math.max(0, (days.get(id)?.size ?? 0) - targetDaysOf(ctx, id));
  return missing * 1000 + spread(dayVals) * 10 + spread(nightVals) * 6 + excess;
}

function runAttempt(ctx: RosterContext, existing: Assignment[], opts: GenerateOptions, rand: (() => number) | null) {
  const keepManual = opts.keepManual !== false;
  const fixed = existing.filter((a) => opts.keepExisting || (keepManual && a.manual));
  const fixedByDay = new Map<number, Assignment[]>();
  const fixedByEmp = new Map<string, Assignment[]>();
  for (const a of fixed) {
    fixedByDay.set(a.day, [...(fixedByDay.get(a.day) ?? []), a]);
    fixedByEmp.set(a.employeeId, [...(fixedByEmp.get(a.employeeId) ?? []), a]);
  }
  const states = new Map<string, State>();
  for (const id of ctx.participants) {
    const c = ctx.carry.get(id);
    states.set(id, {
      lastEnd: c?.lastEnd ?? null,
      lastWasNight: c?.lastWasNight ?? false,
      lastDay: c && c.consecWork > 0 ? 0 : -99,
      consecWork: c?.consecWork ?? 0,
      consecNights: c?.consecNights ?? 0,
      posRun: { ...(c?.consecAtPos ?? {}) },
      days: 0,
      nights: 0,
      weekendDays: 0,
    });
  }
  const out: Assignment[] = [...fixed];
  const shortages: Shortage[] = [];

  for (let d = 1; d <= ctx.nDays; d++) {
    const today = new Map<string, Assignment[]>();
    for (const a of fixedByDay.get(d) ?? []) today.set(a.employeeId, [...(today.get(a.employeeId) ?? []), a]);
    const demands = demandsForDay(ctx, d);
    const primaryToday = new Set(demands.map((dm) => dm.positionId));
    const slots = demands
      .map((dm) => ({ dm, need: dm.minStaff - (fixedByDay.get(d) ?? []).filter((a) => a.shiftId === dm.shiftId && a.positionId === dm.positionId).length }))
      .filter((s) => s.need > 0)
      .sort((x, y) => slotRank(ctx, x.dm) - slotRank(ctx, y.dm));

    // Mỗi ngày: ghép người–vị trí bằng bài toán phân công chi phí nhỏ nhất (Hungarian),
    // bảo đảm phủ được nhiều vị trí nhất có thể rồi mới tối ưu công bằng.
    const units: Demand[] = [];
    for (const slot of slots) for (let k = 0; k < slot.need; k++) units.push(slot.dm);
    const people = ctx.participants;
    const BIG = 1e7;
    const UNFILLED = 1e6;
    const reasonsBySlot = new Map<Demand, { employeeId: string; reason: string }[]>();
    const cost: number[][] = units.map((dm) => {
      const reasons: { employeeId: string; reason: string }[] = [];
      const row = people.map((id) => {
        const why = ineligible(ctx, states.get(id)!, id, dm, d, today, fixedByEmp);
        if (why) {
          reasons.push({ employeeId: id, reason: why });
          return BIG;
        }
        return score(ctx, states.get(id)!, id, dm, d, primaryToday) + slotRank(ctx, dm) * 0.01 + (rand ? rand() * 3 : 0);
      });
      reasonsBySlot.set(dm, reasons);
      // Cột giả cho trường hợp không xếp được
      return [...row, ...units.map(() => UNFILLED)];
    });
    const match = units.length ? hungarian(cost) : [];
    units.forEach((dm, i) => {
      const col = match[i];
      if (col === undefined || col >= people.length || cost[i][col] >= BIG) {
        const existingShort = shortages.find((x) => x.day === d && x.shiftId === dm.shiftId && x.positionId === dm.positionId);
        if (existingShort) existingShort.missing++;
        else shortages.push({ day: d, shiftId: dm.shiftId, positionId: dm.positionId, missing: 1, reasons: reasonsBySlot.get(dm) ?? [] });
        return;
      }
      const id = people[col];
      const a: Assignment = { day: d, shiftId: dm.shiftId, positionId: dm.positionId, employeeId: id, manual: false };
      out.push(a);
      today.set(id, [...(today.get(id) ?? []), a]);
    });

    // Cập nhật trạng thái cuối ngày
    for (const id of ctx.participants) {
      const st = states.get(id)!;
      const arr = today.get(id);
      if (!arr?.length) {
        st.consecWork = 0;
        st.consecNights = 0;
        st.posRun = {};
        continue;
      }
      st.consecWork++;
      st.days++;
      st.lastDay = d;
      if (ctx.dayTypes[d - 1] !== 'weekday') st.weekendDays++;
      const night = arr.some((a) => ctx.shifts.get(a.shiftId)?.isNight);
      st.consecNights = night ? st.consecNights + 1 : 0;
      if (night) st.nights++;
      const posToday = new Set(arr.map((a) => a.positionId));
      const next: Record<string, number> = {};
      for (const p of posToday) next[p] = (st.posRun[p] ?? 0) + 1;
      st.posRun = next;
      for (const a of arr) {
        const sh = ctx.shifts.get(a.shiftId);
        if (!sh) continue;
        const end = shiftInterval(sh, d)[1];
        if (st.lastEnd === null || end >= st.lastEnd) {
          st.lastEnd = end;
          st.lastWasNight = sh.isNight;
        }
      }
    }
  }

  out.sort((x, y) => x.day - y.day || (startOf(ctx, x) - startOf(ctx, y)) || x.positionId.localeCompare(y.positionId));
  return { assignments: out, shortages };
}

function startOf(ctx: RosterContext, a: Assignment) {
  const s = ctx.shifts.get(a.shiftId);
  return s ? shiftInterval(s, a.day)[0] : 0;
}

/** Thứ tự xử lý: ca đêm (ràng buộc chặt nhất) → vị trí hành chính → các ca còn lại. */
function slotRank(ctx: RosterContext, dm: Demand): number {
  const sh = ctx.shifts.get(dm.shiftId);
  const pos = ctx.positions.get(dm.positionId);
  if (sh?.isNight) return 0;
  if (pos?.kind === 'hanh_chinh') return 1;
  return 2;
}

/** Lý do không thể xếp (null = được phép). */
export function ineligible(
  ctx: RosterContext,
  st: State,
  id: string,
  dm: Demand,
  d: number,
  today: Map<string, Assignment[]>,
  fixedByEmp: Map<string, Assignment[]>,
): string | null {
  const r = ctx.config.rules;
  const prof = ctx.profiles.get(id);
  const sh = ctx.shifts.get(dm.shiftId);
  const pos = ctx.positions.get(dm.positionId);
  if (!prof || !sh || !pos) return 'không có thiết lập';
  if (!prof.participates) return 'không tham gia phân ca';
  if (!isEmployedOnDay(ctx, id, d)) return 'ngoài thời gian làm việc';
  const leave = ctx.leaves.get(id)?.get(d);
  if (leave) return `nghỉ (${leave.code})`;
  if (today.get(id)?.length) return 'đã có ca trong ngày';
  if (!prof.positionIds.includes(dm.positionId) && prof.primaryPositionId !== dm.positionId) return `không đảm nhận vị trí ${pos.short || pos.name}`;
  if (sh.isNight && prof.noNight) return 'không trực đêm';
  if (prof.unavailableWeekdays.includes(ctx.weekdays[d - 1])) return 'đăng ký không làm thứ này';
  if (prof.workType === 'hanh_chinh' && r.adminRestOnWeekend && ctx.dayTypes[d - 1] !== 'weekday') {
    if (!(r.allowWeekendRotation && prof.weekendRotation)) return 'nghỉ cuối tuần/lễ (hành chính)';
  }
  if (st.days >= capOf(ctx, id)) return `đủ trần ${capOf(ctx, id)} công`;
  if (st.lastDay === d - 1 && st.consecWork >= r.maxConsecutiveWorkDays) return `đã làm ${st.consecWork} ngày liên tiếp`;
  if (sh.isNight && st.lastDay === d - 1 && st.consecNights >= r.maxConsecutiveNights) return `đã trực ${st.consecNights} đêm liên tiếp`;
  if (pos.maxConsecutiveDays > 0 && st.lastDay === d - 1 && (st.posRun[pos.id] ?? 0) >= pos.maxConsecutiveDays) {
    return `đã ở vị trí ${pos.short || pos.name} ${st.posRun[pos.id]} ngày liên tiếp`;
  }
  const [start, end] = shiftInterval(sh, d);
  if (st.lastEnd !== null) {
    const gap = (start - st.lastEnd) / 60;
    if (gap < r.minRestHours) return `chưa đủ ${r.minRestHours} giờ nghỉ`;
    if (st.lastWasNight && gap < r.restAfterNightHours && (!r.restAfterNightOnlyTruc || pos.kind === 'truc_ca')) {
      return `chưa đủ ${r.restAfterNightHours} giờ sau ca đêm`;
    }
  }
  // Không phá vỡ ca xếp tay ở các ngày sau
  const nextFixed = (fixedByEmp.get(id) ?? []).filter((a) => a.day > d).sort((a, b) => a.day - b.day)[0];
  if (nextFixed) {
    const ns = ctx.shifts.get(nextFixed.shiftId);
    const np = ctx.positions.get(nextFixed.positionId);
    if (ns && np) {
      const gap = (shiftInterval(ns, nextFixed.day)[0] - end) / 60;
      if (gap < r.minRestHours) return 'vướng ca đã xếp tay ngày sau';
      if (sh.isNight && gap < r.restAfterNightHours && (!r.restAfterNightOnlyTruc || np.kind === 'truc_ca')) return 'vướng ca đã xếp tay ngày sau';
    }
  }
  return null;
}

function score(ctx: RosterContext, st: State, id: string, dm: Demand, d: number, demandPositionsToday: Set<string>): number {
  const prof = ctx.profiles.get(id)!;
  const sh = ctx.shifts.get(dm.shiftId)!;
  const pos = ctx.positions.get(dm.positionId)!;
  const hist = ctx.history.get(id);
  const target = Math.max(1, targetDaysOf(ctx, id) - (ctx.leaves.get(id)?.size ?? 0));
  let s = (st.days / target) * 20;
  if (st.days >= target) s += 25;
  s += st.consecWork * 1.5;
  const offDay = ctx.dayTypes[d - 1] !== 'weekday';
  const adminResting = prof.workType === 'hanh_chinh' && ctx.config.rules.adminRestOnWeekend && offDay;
  // Khối hành chính luân phiên cuối tuần chỉ dùng khi thiếu người
  if (adminResting) s += 80;
  if (pos.kind === 'hanh_chinh') {
    if (prof.primaryPositionId === pos.id && !adminResting) s -= 100;
    else if (st.lastWasNight && st.lastDay === d - 1) s -= 10; // người vừa hết ca đêm: dùng cho hành chính hỗ trợ
  } else {
    if (prof.workType === 'hanh_chinh') s += 15;
    if (prof.workType === 'kiem_nhiem') s += 8;
  }
  // Giữ người chính cho vị trí hành chính của họ
  if (prof.primaryPositionId && prof.primaryPositionId !== pos.id && demandPositionsToday.has(prof.primaryPositionId) && !adminResting) s += 60;
  if (sh.isNight) {
    if (st.lastWasNight && st.lastDay === d - 1 && st.consecNights < ctx.config.rules.maxConsecutiveNights) s -= 30;
    s += st.nights * 4 + (hist ? hist.nights / Math.max(1, hist.months) : 0) * 0.5;
  }
  if (offDay) {
    s += st.weekendDays * 4 + (hist ? hist.weekendDays / Math.max(1, hist.months) : 0) * 0.5;
  }
  return s;
}

/**
 * Bài toán phân công chi phí nhỏ nhất (Hungarian, O(n²m)) cho ma trận n × m, n ≤ m.
 * Trả về cột được chọn cho từng dòng.
 */
export function hungarian(a: number[][]): number[] {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array<number>(n);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}
