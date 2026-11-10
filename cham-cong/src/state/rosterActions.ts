import { formatMonth, monthKey, sheetId, shiftMonth } from '../domain/calendar';
import { eligibleEmployees } from '../domain/employees';
import type { Permission } from '../domain/permissions';
import { defaultProfile, validateShiftConfig } from '../domain/roster/config';
import { buildContext, type RosterContext } from '../domain/roster/context';
import { generateRoster, type GenerateOptions, type Shortage } from '../domain/roster/generate';
import { planSync, type SyncPlan } from '../domain/roster/sync';
import type { Assignment, Roster, RosterVersion, ShiftConfig, StaffProfile } from '../domain/roster/types';
import { countBySeverity, validateRoster, type RosterIssue } from '../domain/roster/validate';
import type { CellEdit, EditResult } from '../domain/sheet';
import type { Snapshot, Unit } from '../domain/types';
import { deepClone, nowIso, uid } from '../domain/util';
import type { Repo } from '../storage/db';
import type { AppState, Result } from './store';

interface Deps {
  get: () => AppState;
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
  repo: () => Repo;
  write: (fn: () => Promise<void>) => Promise<Result>;
  audit: (action: string, entity: string, detail: string, entityId?: string) => Promise<void>;
  snapshot: (reason: string, scope: 'all' | 'unit') => Promise<Snapshot>;
  allowed: (p: Permission) => boolean;
  unit: () => Unit | null;
  who: () => string;
  editCells: (edits: CellEdit[], reason?: string) => Promise<Result<EditResult>>;
}

const ok = <T,>(data?: T, message?: string): Result<T> => ({ ok: true, data, message });
const fail = <T = undefined,>(message: string): Result<T> => ({ ok: false, message });
const deny = <T = undefined,>(p: Permission): Result<T> => fail<T>(`Tài khoản không có quyền thực hiện thao tác này (${p}).`);

export function createRosterActions(dep: Deps) {
  const { get, set } = dep;
  const rid = () => sheetId(get().unitId ?? '', get().year, get().month);
  const config = () => get().shiftConfig;

  function current(): Roster | null {
    return get().rosters.find((r) => r.id === rid()) ?? null;
  }

  function contextFor(r: Roster): RosterContext | null {
    const u = dep.unit();
    const cfg = config();
    if (!u || !cfg) return null;
    const sheet = get().sheets.find((s) => s.id === r.id) ?? null;
    return buildContext({
      unit: u, config: cfg, roster: r, employees: get().employees, codes: get().codes, sheet,
      previousRosters: get().rosters.filter((x) => monthKey(x.year, x.month) < monthKey(r.year, r.month)),
    });
  }

  async function persist(next: Roster, versionReason?: string): Promise<Result> {
    const prev = get().rosters.find((r) => r.id === next.id);
    const r = dep.repo();
    const res = await dep.write(async () => {
      if (prev && versionReason) {
        const v: RosterVersion = { id: uid('rv'), rosterId: prev.id, unitId: prev.unitId, createdAt: nowIso(), user: dep.who(), reason: versionReason, data: deepClone(prev) };
        await r.addRosterVersion(v);
      }
      await r.putRoster(next);
    });
    if (res.ok) set((s) => ({ rosters: [...s.rosters.filter((x) => x.id !== next.id), next] }));
    return res;
  }

  function editable(): Result<Roster> {
    if (!dep.allowed('sheet.edit')) return deny('sheet.edit');
    const r = current();
    if (!r) return fail('Chưa tạo lịch phân ca cho tháng này.');
    if (r.status === 'da_chot') return fail('Lịch đã chốt. Mở lại lịch trước khi điều chỉnh.');
    return ok(r);
  }

  const name = (id: string) => get().employees.find((e) => e.id === id)?.fullName ?? id;

  return {
    current,
    contextFor,
    previous(): Roster | null {
      const p = shiftMonth(get().year, get().month, -1);
      return get().rosters.find((r) => r.id === sheetId(get().unitId ?? '', p.year, p.month)) ?? null;
    },

    // ---------- Cấu hình
    async saveConfig(next: ShiftConfig): Promise<Result> {
      if (!dep.allowed('unit.manage')) return deny('unit.manage');
      const errors = validateShiftConfig(next, new Set(get().codes.map((c) => c.id)));
      if (errors.length) return fail(errors.join(' '));
      const cfg = { ...next, profiles: config()?.profiles ?? next.profiles, updatedAt: nowIso() };
      const res = await dep.write(() => dep.repo().putShiftConfig(cfg));
      if (!res.ok) return res;
      set({ shiftConfig: cfg, shiftConfigSaved: true });
      await dep.audit('cau_hinh_phan_ca', 'shift_config', `Cập nhật cấu hình phân ca: ${cfg.positions.length} vị trí, ${cfg.shifts.length} ca, ${cfg.demands.length} dòng nhu cầu`);
      return ok();
    },

    async saveProfile(p: StaffProfile): Promise<Result> {
      if (!dep.allowed('employee.manage')) return deny('employee.manage');
      const cfg = config();
      if (!cfg) return fail('Chưa tải cấu hình.');
      const emp = get().employees.find((e) => e.id === p.employeeId);
      if (!emp) return fail('Không tìm thấy nhân sự.');
      if (p.primaryPositionId && !cfg.positions.some((x) => x.id === p.primaryPositionId)) return fail('Vị trí chính không tồn tại.');
      if (p.targetDays < 0 || p.maxDays < 0 || p.targetDays > 31 || p.maxDays > 31) return fail('Định mức/trần công phải trong khoảng 0–31.');
      const prof = { ...p, positionIds: p.primaryPositionId && !p.positionIds.includes(p.primaryPositionId) ? [...p.positionIds, p.primaryPositionId] : p.positionIds };
      const next: ShiftConfig = { ...cfg, profiles: [...cfg.profiles.filter((x) => x.employeeId !== p.employeeId), prof], updatedAt: nowIso() };
      const res = await dep.write(() => dep.repo().putShiftConfig(next));
      if (!res.ok) return res;
      set({ shiftConfig: next, shiftConfigSaved: true });
      await dep.audit('ho_so_phan_ca', 'shift_profile', `${emp.code} – ${emp.fullName}: ${prof.workType}, vị trí ${prof.positionIds.length}, nhóm "${prof.group}"`, emp.id);
      return ok();
    },

    profileFor(employeeId: string): StaffProfile | null {
      const cfg = config();
      const emp = get().employees.find((e) => e.id === employeeId);
      if (!cfg || !emp) return null;
      return cfg.profiles.find((p) => p.employeeId === employeeId) ?? defaultProfile(emp, cfg);
    },

    // ---------- Lịch tháng
    async create(): Promise<Result<Roster>> {
      if (!dep.allowed('sheet.edit')) return deny('sheet.edit');
      const u = dep.unit();
      const cfg = config();
      if (!u || !cfg) return fail('Chưa chọn đơn vị.');
      if (current()) return fail('Lịch phân ca tháng này đã tồn tại.');
      const { year, month } = get();
      const participants = eligibleEmployees(get().employees, year, month)
        .filter((e) => (cfg.profiles.find((p) => p.employeeId === e.id) ?? defaultProfile(e, cfg)).participates)
        .map((e) => e.id);
      const t = nowIso();
      const r: Roster = { id: rid(), unitId: u.id, year, month, status: 'nhap', participants, assignments: [], leaves: {}, dayNotes: {}, createdAt: t, updatedAt: t };
      const res = await persist(r);
      if (!res.ok) return fail(res.message!);
      await dep.audit('tao_lich_phan_ca', 'roster', `Tạo lịch phân ca ${formatMonth(year, month)} với ${participants.length} nhân sự`, r.id);
      return ok(r);
    },

    async setParticipants(ids: string[]): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const removed = r.participants.filter((x) => !ids.includes(x));
      const next = {
        ...r, participants: ids,
        assignments: r.assignments.filter((a) => ids.includes(a.employeeId)),
        updatedAt: nowIso(),
      };
      const res = await persist(next, removed.length ? 'Trước khi đổi danh sách nhân sự tham gia' : undefined);
      if (res.ok) await dep.audit('nhan_su_phan_ca', 'roster', `Danh sách tham gia: ${ids.length} người${removed.length ? `; bỏ ${removed.map(name).join(', ')}` : ''}`, r.id);
      return res;
    },

    async generate(opts: GenerateOptions = {}): Promise<Result<{ shortages: Shortage[]; issues: RosterIssue[] }>> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const cfg = config()!;
      if (!cfg.demands.length) return fail('Chưa khai báo nhu cầu nhân sự cho các vị trí/ca (Cấu hình).');
      const ctx = contextFor(r);
      if (!ctx) return fail('Chưa đủ dữ liệu để lập lịch.');
      const g = generateRoster(ctx, r.assignments, opts);
      const next: Roster = { ...r, assignments: g.assignments, updatedAt: nowIso() };
      const res = await persist(next, 'Trước khi tự động lập lịch');
      if (!res.ok) return fail(res.message!);
      const issues = validateRoster(ctx, g.assignments);
      const missing = g.shortages.reduce((n, s) => n + s.missing, 0);
      await dep.audit('tu_dong_lap_lich', 'roster', `Tự động lập lịch ${formatMonth(r.year, r.month)}: ${g.assignments.length} lượt xếp, thiếu ${missing} vị trí`, r.id);
      return ok({ shortages: g.shortages, issues }, missing ? `Không đủ nhân sự cho ${missing} vị trí – xem chi tiết lý do.` : undefined);
    },

    /** Xếp một người vào ca/vị trí trong ngày (thay ca cũ của người đó trong ngày). */
    async assign(day: number, employeeId: string, shiftId: string, positionId: string, note = ''): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      if (!r.participants.includes(employeeId)) return fail('Nhân sự không thuộc danh sách tham gia lịch tháng này.');
      if (r.leaves[employeeId]?.[String(day)]) return fail('Nhân sự đang có ngày nghỉ được đăng ký – không xếp ca. Bỏ ngày nghỉ trước nếu thực sự cần.');
      const cfg = config()!;
      if (!cfg.shifts.some((s) => s.id === shiftId) || !cfg.positions.some((p) => p.id === positionId)) return fail('Ca hoặc vị trí không hợp lệ.');
      const a: Assignment = { day, shiftId, positionId, employeeId, manual: true, note: note || undefined };
      const next = { ...r, assignments: [...r.assignments.filter((x) => !(x.day === day && x.employeeId === employeeId)), a], updatedAt: nowIso() };
      const res = await persist(next, `Trước khi sửa ngày ${day} của ${name(employeeId)}`);
      if (res.ok) {
        const sh = cfg.shifts.find((s) => s.id === shiftId)?.name;
        const pos = cfg.positions.find((p) => p.id === positionId)?.name;
        await dep.audit('sua_lich_phan_ca', 'roster', `Ngày ${day}: ${name(employeeId)} → ${sh} – ${pos}${note ? ` (${note})` : ''}`, r.id);
      }
      return res;
    },

    async clear(day: number, employeeId: string): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const next = { ...r, assignments: r.assignments.filter((x) => !(x.day === day && x.employeeId === employeeId)), updatedAt: nowIso() };
      const res = await persist(next, `Trước khi bỏ ca ngày ${day} của ${name(employeeId)}`);
      if (res.ok) await dep.audit('sua_lich_phan_ca', 'roster', `Ngày ${day}: bỏ ca của ${name(employeeId)}`, r.id);
      return res;
    },

    /** Đổi ca giữa hai người trong cùng ngày. */
    async swap(day: number, a: string, b: string): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      if (a === b) return fail('Chọn hai nhân sự khác nhau.');
      if (!r.participants.includes(b)) return fail('Nhân sự đổi ca không thuộc danh sách tham gia.');
      for (const x of [a, b]) {
        const mine = r.assignments.some((y) => y.day === day && y.employeeId === x);
        const otherHas = r.assignments.some((y) => y.day === day && y.employeeId === (x === a ? b : a));
        if (otherHas && r.leaves[x]?.[String(day)] && !mine) return fail(`${name(x)} đang có ngày nghỉ đăng ký ngày ${day}.`);
      }
      const next = {
        ...r,
        assignments: r.assignments.map((x) =>
          x.day !== day ? x : x.employeeId === a ? { ...x, employeeId: b, manual: true } : x.employeeId === b ? { ...x, employeeId: a, manual: true } : x,
        ),
        updatedAt: nowIso(),
      };
      const res = await persist(next, `Trước khi đổi ca ngày ${day}`);
      if (res.ok) await dep.audit('doi_ca', 'roster', `Ngày ${day}: đổi ca ${name(a)} ↔ ${name(b)}`, r.id);
      return res;
    },

    /** Đăng ký/bỏ ngày nghỉ trong lịch (mã lấy từ danh mục mã công hiện có). */
    async setLeave(employeeId: string, day: number, codeId: string | null): Promise<Result<{ removedShift: boolean }>> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const cfg = config()!;
      if (codeId) {
        const code = get().codes.find((c) => c.id === codeId);
        if (!code || !code.active) return fail('Mã nghỉ không có trong danh mục hoặc đã ngừng sử dụng.');
        if (cfg.shifts.some((s) => s.attendanceCodeId === codeId)) return fail(`Mã "${code.code}" là mã của ca trực, không dùng làm mã nghỉ.`);
      }
      const leaves = deepClone(r.leaves);
      const row = { ...(leaves[employeeId] ?? {}) };
      if (codeId) row[String(day)] = codeId;
      else delete row[String(day)];
      leaves[employeeId] = row;
      const had = r.assignments.some((x) => x.day === day && x.employeeId === employeeId);
      const next = {
        ...r, leaves,
        assignments: codeId ? r.assignments.filter((x) => !(x.day === day && x.employeeId === employeeId)) : r.assignments,
        updatedAt: nowIso(),
      };
      const res = await persist(next, `Trước khi đổi ngày nghỉ ngày ${day} của ${name(employeeId)}`);
      if (!res.ok) return fail(res.message!);
      const code = get().codes.find((c) => c.id === codeId)?.code;
      await dep.audit('nghi_phan_ca', 'roster', `Ngày ${day}: ${name(employeeId)} ${codeId ? `nghỉ (${code})` : 'bỏ ngày nghỉ'}${had && codeId ? '; đã bỏ ca trực ngày này' : ''}`, r.id);
      return ok({ removedShift: had && !!codeId });
    },

    async setDayNote(day: number, note: string): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const dayNotes = { ...r.dayNotes };
      if (note.trim()) dayNotes[String(day)] = note.trim();
      else delete dayNotes[String(day)];
      return persist({ ...r, dayNotes, updatedAt: nowIso() });
    },

    async copyFromPrevious(): Promise<Result<number>> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      const p = shiftMonth(r.year, r.month, -1);
      const prev = get().rosters.find((x) => x.id === sheetId(r.unitId, p.year, p.month));
      if (!prev) return fail(`Chưa có lịch phân ca tháng ${formatMonth(p.year, p.month)} để sao chép.`);
      const ctx = contextFor(r);
      const n = ctx?.nDays ?? 31;
      const copied = prev.assignments
        .filter((a) => a.day <= n && r.participants.includes(a.employeeId) && !r.leaves[a.employeeId]?.[String(a.day)])
        .map((a) => ({ ...a, manual: false, note: undefined }));
      const res = await persist({ ...r, assignments: copied, updatedAt: nowIso() }, 'Trước khi sao chép lịch tháng trước');
      if (!res.ok) return fail(res.message!);
      await dep.audit('sao_chep_lich', 'roster', `Sao chép ${copied.length} lượt xếp từ ${formatMonth(p.year, p.month)}`, r.id);
      return ok(copied.length, 'Đã sao chép theo ngày trong tháng. Hãy chạy "Kiểm tra" vì ngày trong tuần và trạng thái nghỉ đã khác tháng trước.');
    },

    async clearAuto(): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      return persist({ ...r, assignments: r.assignments.filter((a) => a.manual), updatedAt: nowIso() }, 'Trước khi xóa các ô xếp tự động');
    },

    validate(): { issues: RosterIssue[]; errors: number; warnings: number } | null {
      const r = current();
      if (!r) return null;
      const ctx = contextFor(r);
      if (!ctx) return null;
      const issues = validateRoster(ctx, r.assignments);
      return { issues, ...countBySeverity(issues) };
    },

    async approve(): Promise<Result> {
      if (!dep.allowed('sheet.lock')) return deny('sheet.lock');
      const r = current();
      if (!r) return fail('Chưa có lịch phân ca.');
      if (r.status === 'da_chot') return fail('Lịch đã chốt.');
      const ctx = contextFor(r);
      if (!ctx) return fail('Chưa đủ dữ liệu.');
      const issues = validateRoster(ctx, r.assignments);
      const { errors, warnings } = countBySeverity(issues);
      if (errors) return fail(`Còn ${errors} lỗi phải xử lý trước khi chốt lịch (xem mục Kiểm tra).`);
      const next: Roster = { ...r, status: 'da_chot', approvedAt: nowIso(), approvedBy: dep.who(), updatedAt: nowIso() };
      const res = await persist(next, 'Trước khi chốt lịch');
      if (res.ok) await dep.audit('chot_lich', 'roster', `Chốt lịch phân ca ${formatMonth(r.year, r.month)} (${warnings} cảnh báo)`, r.id);
      return res;
    },

    async reopen(reason: string): Promise<Result> {
      if (!dep.allowed('sheet.unlock')) return deny('sheet.unlock');
      const r = current();
      if (!r || r.status !== 'da_chot') return fail('Lịch chưa chốt.');
      if (!reason.trim()) return fail('Cần nhập lý do mở lại lịch.');
      const { approvedAt: _a, approvedBy: _b, ...rest } = r;
      const res = await persist({ ...rest, status: 'nhap', updatedAt: nowIso() }, `Trước khi mở lại lịch: ${reason}`);
      if (res.ok) await dep.audit('mo_lai_lich', 'roster', `Mở lại lịch ${formatMonth(r.year, r.month)}. Lý do: ${reason}`, r.id);
      return res;
    },

    async listVersions(): Promise<RosterVersion[]> {
      const r = current();
      return r ? dep.repo().listRosterVersions(r.id) : [];
    },

    async restoreVersion(v: RosterVersion): Promise<Result> {
      const e = editable();
      if (!e.ok) return fail(e.message!);
      const r = e.data!;
      if (v.rosterId !== r.id) return fail('Phiên bản không thuộc lịch tháng này.');
      const res = await persist({ ...deepClone(v.data), status: 'nhap', updatedAt: nowIso() }, 'Trước khi khôi phục phiên bản');
      if (res.ok) await dep.audit('khoi_phuc_lich', 'roster', `Khôi phục phiên bản lịch lúc ${new Date(v.createdAt).toLocaleString('vi-VN')} (${v.reason})`, r.id);
      return res;
    },

    // ---------- Đồng bộ chấm công
    syncPlan(): SyncPlan | null {
      const r = current();
      const cfg = config();
      if (!r || !cfg) return null;
      const sheet = get().sheets.find((s) => s.id === r.id) ?? null;
      return planSync(r, cfg, sheet, get().codes, get().employees);
    },

    async sync(): Promise<Result<EditResult>> {
      if (!dep.allowed('sheet.edit')) return deny('sheet.edit');
      const r = current();
      if (!r) return fail('Chưa có lịch phân ca.');
      const plan = this.syncPlan();
      if (!plan) return fail('Chưa đủ dữ liệu.');
      if (plan.blockers.length) return fail(plan.blockers.join(' '));
      if (!plan.edits.length) return ok<EditResult>(undefined, 'Bảng chấm công đã khớp với lịch phân ca, không có ô cần thay đổi.');
      await dep.snapshot(`Trước khi đồng bộ lịch phân ca ${formatMonth(r.year, r.month)} sang chấm công`, 'unit');
      const res = await dep.editCells(plan.edits, `Đồng bộ từ lịch phân ca ${formatMonth(r.year, r.month)}`);
      if (!res.ok) return res;
      await persist({ ...r, syncedAt: nowIso() });
      await dep.audit('dong_bo_cham_cong', 'roster', `Đồng bộ sang chấm công: ${plan.counts.them} ghi mới, ${plan.counts.cap_nhat} cập nhật, ${plan.counts.xoa} xóa; giữ ${plan.counts.giu_nguyen_nghi + plan.counts.xung_dot} ô nghỉ`, r.id);
      return res;
    },
  };
}

export type RosterActions = ReturnType<typeof createRosterActions>;
