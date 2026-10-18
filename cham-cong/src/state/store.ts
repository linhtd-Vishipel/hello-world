import { createStore } from 'zustand/vanilla';
import { verifyPassword, hashPassword, validatePassword } from '../domain/auth';
import { planUnitFromConfig, buildUnitConfig, validateBackup, type ConfigImportPlan, type UnitConfigFile } from '../domain/backup';
import { formatMonth, monthKey, sheetId, shiftMonth } from '../domain/calendar';
import {
  codeUsage, lockedSheetsFrom, makeCode, SUGGESTED_CODES, upsertVersion, validateCodeDraft, type CodeDraft,
} from '../domain/codes';
import {
  applyMembership, canDeleteEmployee, planMembership, previewEmployeeImpact, sortEmployees, validateEmployee,
  type EmployeeDraft,
} from '../domain/employees';
import { can, type Permission } from '../domain/permissions';
import {
  applyCellEdits, createSheet, lockSheet, revertEdits, setCellNote, setRowNote, unlockSheet,
  type AppliedEdit, type CellEdit, type EditResult,
} from '../domain/sheet';
import type {
  AttendanceCode, AuditEntry, BackupFile, CodeRuleVersion, Employee, MonthSheet, RoleId, Snapshot, Unit, User,
} from '../domain/types';
import { newUnit, validateUnit } from '../domain/unit';
import { normKey, nowIso, uid } from '../domain/util';
import type { AttendanceImportPlan, EmployeeImportPlan } from '../excel/import';
import type { Repo } from '../storage/db';

export interface Session {
  userId: string | null;
  username: string;
  displayName: string;
  role: RoleId;
  unitIds: string[];
  /** Chế độ cục bộ không đăng nhập (chưa tạo tài khoản). */
  open: boolean;
}

export type SaveStatus = 'saved' | 'saving' | 'error';

export interface Result<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
}

interface UndoItem {
  sheetId: string;
  applied: AppliedEdit[];
  label: string;
}

export interface AppState {
  repo: Repo | null;
  ready: boolean;
  session: Session | null;
  users: User[];
  units: Unit[];
  unitId: string | null;
  employees: Employee[];
  codes: AttendanceCode[];
  sheets: MonthSheet[];
  year: number;
  month: number;
  saveStatus: SaveStatus;
  saveError?: string;
  pendingWrites: number;
  undo: UndoItem[];
  auditTick: number;
  lastBackupAt?: string;
}

const MAX_UNDO = 50;
const MAX_SNAPSHOTS = 20;
const ok = <T,>(data?: T, message?: string): Result<T> => ({ ok: true, data, message });
const fail = <T = undefined,>(message: string): Result<T> => ({ ok: false, message });

export function createAppStore(today = new Date()) {
  const store = createStore<AppState>(() => ({
    repo: null,
    ready: false,
    session: null,
    users: [],
    units: [],
    unitId: null,
    employees: [],
    codes: [],
    sheets: [],
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    saveStatus: 'saved',
    pendingWrites: 0,
    undo: [],
    auditTick: 0,
  }));
  const get = store.getState;
  const set = store.setState;

  const repo = () => {
    const r = get().repo;
    if (!r) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    return r;
  };
  const unit = () => get().units.find((u) => u.id === get().unitId) ?? null;
  const currentSheet = () => get().sheets.find((s) => s.id === sheetId(get().unitId ?? '', get().year, get().month)) ?? null;
  const who = () => get().session?.displayName || get().session?.username || 'Không xác định';
  const allowed = (perm: Permission) => can(get().session?.role, perm);
  const deny = <T = undefined,>(perm: Permission): Result<T> => fail<T>(`Tài khoản không có quyền thực hiện thao tác này (${perm}).`);

  /** Ghi dữ liệu an toàn: theo dõi trạng thái Đang lưu / Đã lưu / Lỗi lưu. */
  async function write(fn: () => Promise<void>): Promise<Result> {
    set((s) => ({ pendingWrites: s.pendingWrites + 1, saveStatus: 'saving' }));
    try {
      await fn();
      set((s) => {
        const pending = s.pendingWrites - 1;
        return { pendingWrites: pending, saveStatus: pending > 0 ? 'saving' : s.saveStatus === 'error' ? 'error' : 'saved' };
      });
      return ok();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      set((s) => ({ pendingWrites: s.pendingWrites - 1, saveStatus: 'error', saveError: msg }));
      return fail(`Lỗi lưu dữ liệu: ${msg}`);
    }
  }

  async function audit(action: string, entity: string, detail: string, entityId?: string, unitId = get().unitId) {
    const entry: AuditEntry = { ts: nowIso(), unitId, user: who(), action, entity, entityId, detail };
    try {
      await repo().addAudit([entry]);
      set((s) => ({ auditTick: s.auditTick + 1 }));
    } catch {
      /* Nhật ký lỗi không chặn nghiệp vụ */
    }
  }

  function replaceSheetInState(sheet: MonthSheet) {
    set((s) => ({ sheets: [...s.sheets.filter((x) => x.id !== sheet.id), sheet] }));
  }

  async function snapshot(reason: string, scope: 'all' | 'unit'): Promise<Snapshot> {
    const r = repo();
    const data = await r.dump(scope, scope === 'unit' ? get().unitId ?? undefined : undefined);
    const snap: Snapshot = { id: uid('snap'), createdAt: nowIso(), reason, unitId: scope === 'unit' ? get().unitId : null, data };
    await r.putSnapshot(snap);
    const all = await r.listSnapshots();
    for (const old of all.slice(MAX_SNAPSHOTS)) await r.deleteSnapshot(old.id);
    return snap;
  }

  async function loadUnitData(unitId: string) {
    const r = repo();
    const [employees, codes, sheets] = await Promise.all([r.listEmployees(unitId), r.listCodes(unitId), r.listSheets(unitId)]);
    set({ unitId, employees: sortEmployees(employees), codes: codes.sort((a, b) => a.order - b.order), sheets, undo: [] });
  }

  function accessibleUnits(units: Unit[], session: Session | null): Unit[] {
    if (!session) return [];
    if (session.open || session.role === 'admin' || !session.unitIds.length) return units;
    return units.filter((u) => session.unitIds.includes(u.id));
  }

  async function applyMembershipToSheets(employees: Employee[]): Promise<string[]> {
    const plan = planMembership(employees, get().sheets);
    const changed: MonthSheet[] = [];
    for (const c of plan) {
      if (!c.toAdd.length && !c.toRemove.length) continue;
      const s = get().sheets.find((x) => x.id === c.sheetId)!;
      changed.push({ ...applyMembership(s, c, employees), updatedAt: nowIso() });
    }
    if (changed.length) {
      await repo().putSheets(changed);
      set((s) => ({ sheets: s.sheets.map((x) => changed.find((c) => c.id === x.id) ?? x) }));
    }
    return changed.map((s) => formatMonth(s.year, s.month));
  }

  const actions = {
    get,
    unit,
    currentSheet,
    can: allowed,
    accessibleUnits: () => accessibleUnits(get().units, get().session),

    async init(r: Repo): Promise<void> {
      const [units, users, lastUnitId, lastBackupAt] = await Promise.all([
        r.listUnits(),
        r.listUsers(),
        r.getMeta<string>('lastUnitId'),
        r.getMeta<string>('lastBackupAt'),
      ]);
      const activeUsers = users.filter((u) => u.active);
      const session: Session | null = activeUsers.length
        ? null
        : { userId: null, username: 'local', displayName: 'Quản trị cục bộ', role: 'admin', unitIds: [], open: true };
      set({ repo: r, units, users, session, lastBackupAt, ready: true });
      const visible = accessibleUnits(units, session);
      const target = visible.find((u) => u.id === lastUnitId) ?? visible[0];
      if (target) await loadUnitData(target.id);
    },

    async login(username: string, password: string): Promise<Result> {
      const user = get().users.find((u) => u.active && normKey(u.username) === normKey(username));
      if (!user || !(await verifyPassword(password, user))) return fail('Sai tên đăng nhập hoặc mật khẩu.');
      const session: Session = {
        userId: user.id, username: user.username, displayName: user.displayName, role: user.role, unitIds: user.unitIds, open: false,
      };
      set({ session });
      await audit('dang_nhap', 'user', `Đăng nhập: ${user.username}`, user.id, null);
      const visible = accessibleUnits(get().units, session);
      if (!visible.some((u) => u.id === get().unitId)) {
        if (visible[0]) await loadUnitData(visible[0].id);
        else set({ unitId: null, employees: [], codes: [], sheets: [] });
      }
      return ok();
    },

    logout() {
      if (get().session?.open) return;
      set({ session: null, unitId: null, employees: [], codes: [], sheets: [], undo: [] });
    },

    async selectUnit(id: string): Promise<Result> {
      if (!accessibleUnits(get().units, get().session).some((u) => u.id === id)) return fail('Không có quyền truy cập đơn vị này.');
      await loadUnitData(id);
      await repo().setMeta('lastUnitId', id);
      return ok();
    },

    setMonth(year: number, month: number) {
      if (year < 1900 || year > 2100 || month < 1 || month > 12) return;
      set({ year, month });
    },
    shiftMonth(delta: number) {
      const n = shiftMonth(get().year, get().month, delta);
      set(n);
    },

    // ---------- Bảng chấm công
    async createSheet(): Promise<Result<MonthSheet>> {
      if (!allowed('sheet.edit')) return deny('sheet.edit');
      const u = unit();
      if (!u) return fail('Chưa chọn đơn vị.');
      if (currentSheet()) return fail('Bảng chấm công tháng này đã tồn tại – không tạo lại để tránh ghi đè.');
      const sheet = createSheet(u, get().year, get().month, get().employees);
      const res = await write(() => repo().putSheets([sheet]));
      if (!res.ok) return fail(res.message!);
      replaceSheetInState(sheet);
      await audit('tao_bang', 'sheet', `Tạo bảng chấm công ${formatMonth(sheet.year, sheet.month)} với ${sheet.employeeIds.length} nhân sự`, sheet.id);
      return ok(sheet);
    },

    async editCells(edits: CellEdit[], reason = ''): Promise<Result<EditResult>> {
      if (!allowed('sheet.edit')) return deny('sheet.edit');
      const sheet = currentSheet();
      if (!sheet) return fail('Chưa tạo bảng chấm công cho tháng này.');
      const result = applyCellEdits(sheet, edits, get().codes);
      if (!result.applied.length) {
        return { ok: result.rejected.length === 0, message: result.rejected[0]?.reason, data: result };
      }
      const saved = await write(() => repo().putSheets([result.sheet]));
      if (!saved.ok) return { ok: false, message: saved.message, data: result };
      replaceSheetInState(result.sheet);
      set((s) => ({ undo: [...s.undo, { sheetId: sheet.id, applied: result.applied, label: `${result.applied.length} ô` }].slice(-MAX_UNDO) }));
      const names = new Map(get().employees.map((e) => [e.id, e.code]));
      const detail =
        result.applied.length <= 10
          ? result.applied.map((a) => `${names.get(a.employeeId)} ngày ${a.day}: "${a.previous}" → "${a.value}"`).join('; ')
          : `Cập nhật ${result.applied.length} ô`;
      await audit('sua_cong', 'sheet', detail + (reason ? ` | Lý do: ${reason}` : ''), sheet.id);
      return { ok: true, data: result, message: result.rejected.length ? `${result.rejected.length} ô bị từ chối: ${result.rejected[0].reason}` : undefined };
    },

    async undoLast(): Promise<Result> {
      const stack = get().undo;
      const item = stack[stack.length - 1];
      if (!item) return fail('Không có thao tác để hoàn tác.');
      const sheet = get().sheets.find((s) => s.id === item.sheetId);
      if (!sheet) return fail('Không tìm thấy bảng chấm công.');
      if (sheet.locked) return fail('Bảng đã khóa – không thể hoàn tác.');
      const next = revertEdits(sheet, item.applied);
      const saved = await write(() => repo().putSheets([next]));
      if (!saved.ok) return saved;
      replaceSheetInState(next);
      set((s) => ({ undo: s.undo.slice(0, -1) }));
      await audit('hoan_tac', 'sheet', `Hoàn tác ${item.label}`, sheet.id);
      return ok(undefined, `Đã hoàn tác ${item.label}.`);
    },

    async setCellNote(employeeId: string, day: number, note: string): Promise<Result> {
      if (!allowed('sheet.edit')) return deny('sheet.edit');
      const sheet = currentSheet();
      if (!sheet) return fail('Chưa tạo bảng.');
      if (sheet.locked) return fail('Bảng chấm công đã khóa.');
      const next = setCellNote(sheet, employeeId, day, note);
      const saved = await write(() => repo().putSheets([next]));
      if (!saved.ok) return saved;
      replaceSheetInState(next);
      const code = get().employees.find((e) => e.id === employeeId)?.code;
      await audit('ghi_chu_o', 'sheet', `${code} ngày ${day}: ${note || '(xóa ghi chú)'}`, sheet.id);
      return ok();
    },

    async setRowNote(employeeId: string, note: string): Promise<Result> {
      if (!allowed('sheet.edit')) return deny('sheet.edit');
      const sheet = currentSheet();
      if (!sheet) return fail('Chưa tạo bảng.');
      if (sheet.locked) return fail('Bảng chấm công đã khóa.');
      const next = setRowNote(sheet, employeeId, note);
      const saved = await write(() => repo().putSheets([next]));
      if (!saved.ok) return saved;
      replaceSheetInState(next);
      return ok();
    },

    async lockSheet(): Promise<Result> {
      if (!allowed('sheet.lock')) return deny('sheet.lock');
      const sheet = currentSheet();
      const u = unit();
      if (!sheet || !u) return fail('Chưa có bảng chấm công.');
      if (sheet.locked) return fail('Bảng đã khóa.');
      const next = lockSheet(sheet, u, get().employees, get().codes, who());
      const saved = await write(() => repo().putSheets([next]));
      if (!saved.ok) return saved;
      replaceSheetInState(next);
      set((s) => ({ undo: s.undo.filter((x) => x.sheetId !== sheet.id) }));
      await audit('khoa_thang', 'sheet', `Khóa bảng ${formatMonth(sheet.year, sheet.month)}`, sheet.id);
      return ok();
    },

    async unlockSheet(reason: string): Promise<Result> {
      if (!allowed('sheet.unlock')) return deny('sheet.unlock');
      const sheet = currentSheet();
      if (!sheet?.locked) return fail('Bảng chưa khóa.');
      if (!reason.trim()) return fail('Cần nhập lý do mở khóa.');
      const next = unlockSheet(sheet);
      const saved = await write(() => repo().putSheets([next]));
      if (!saved.ok) return saved;
      replaceSheetInState(next);
      await audit('mo_khoa_thang', 'sheet', `Mở khóa bảng ${formatMonth(sheet.year, sheet.month)}. Lý do: ${reason}`, sheet.id);
      return ok();
    },

    /** Lưu lại thủ công bảng hiện tại (dùng khi lần lưu trước bị lỗi). */
    async saveNow(): Promise<Result> {
      const sheet = currentSheet();
      const u = unit();
      const r = repo();
      const res = await write(async () => {
        if (u) await r.putUnit(u);
        if (sheet) await r.putSheets([sheet]);
        await r.putEmployees(get().employees);
        await r.putCodes(get().codes);
      });
      if (res.ok) set({ saveStatus: 'saved', saveError: undefined });
      return res;
    },

    // ---------- Nhân sự
    previewEmployee(draft: EmployeeDraft) {
      const emp = draftToEmployee(draft, get().unitId ?? '', get().employees);
      return previewEmployeeImpact(emp, get().employees, get().sheets);
    },

    async saveEmployee(draft: EmployeeDraft): Promise<Result<{ employee: Employee; affected: string[]; warnings: string[] }>> {
      if (!allowed('employee.manage')) return deny('employee.manage');
      const unitId = get().unitId;
      if (!unitId) return fail('Chưa chọn đơn vị.');
      const v = validateEmployee(draft, get().employees);
      if (v.errors.length) return fail(v.errors.join(' '));
      const prev = get().employees.find((e) => e.id === draft.id);
      const emp = draftToEmployee(draft, unitId, get().employees);
      const list = prev ? get().employees.map((e) => (e.id === emp.id ? emp : e)) : [...get().employees, emp];
      const saved = await write(() => repo().putEmployees([emp]));
      if (!saved.ok) return fail(saved.message!);
      set({ employees: sortEmployees(list) });
      const affected = await applyMembershipToSheets(list);
      const detail = prev ? describeEmployeeChange(prev, emp) : `Thêm ${emp.code} – ${emp.fullName}`;
      await audit(prev ? 'sua_nhan_su' : 'them_nhan_su', 'employee', detail, emp.id);
      return ok({ employee: emp, affected, warnings: v.warnings });
    },

    async deleteEmployee(id: string): Promise<Result> {
      if (!allowed('employee.manage')) return deny('employee.manage');
      const emp = get().employees.find((e) => e.id === id);
      if (!emp) return fail('Không tìm thấy nhân sự.');
      const chk = canDeleteEmployee(id, get().sheets);
      if (!chk.ok) {
        return fail(`Không xóa được: ${emp.fullName} đã có dữ liệu chấm công các tháng ${chk.months.join(', ')}. Hãy chuyển trạng thái "Đã nghỉ".`);
      }
      const list = get().employees.filter((e) => e.id !== id);
      const saved = await write(() => repo().deleteEmployee(id));
      if (!saved.ok) return saved;
      set({ employees: list });
      await applyMembershipToSheets(list);
      await audit('xoa_nhan_su', 'employee', `Xóa ${emp.code} – ${emp.fullName} (chưa có dữ liệu chấm công)`, id);
      return ok();
    },

    async moveEmployee(id: string, delta: number): Promise<Result> {
      if (!allowed('employee.manage')) return deny('employee.manage');
      const list = sortEmployees(get().employees);
      const i = list.findIndex((e) => e.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return ok();
      [list[i], list[j]] = [list[j], list[i]];
      const re = list.map((e, idx) => ({ ...e, order: idx + 1 }));
      const saved = await write(() => repo().putEmployees(re));
      if (!saved.ok) return saved;
      set({ employees: re });
      // Cập nhật thứ tự dòng của các bảng chưa khóa
      const order = new Map(re.map((e, idx) => [e.id, idx]));
      const changed = get().sheets
        .filter((s) => !s.locked)
        .map((s) => ({ ...s, employeeIds: [...s.employeeIds].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)) }));
      if (changed.length) {
        await write(() => repo().putSheets(changed));
        set((s) => ({ sheets: s.sheets.map((x) => changed.find((c) => c.id === x.id) ?? x) }));
      }
      return ok();
    },

    async importEmployees(plan: EmployeeImportPlan): Promise<Result<{ created: number; updated: number; affected: string[] }>> {
      if (!allowed('employee.manage') || !allowed('data.import')) return deny('data.import');
      const unitId = get().unitId;
      if (!unitId) return fail('Chưa chọn đơn vị.');
      if (plan.toUpdate.length) await snapshot('Trước khi nhập danh sách nhân sự từ Excel', 'unit');
      let list = [...get().employees];
      const toPut: Employee[] = [];
      for (const d of plan.toCreate) {
        const e = draftToEmployee({ ...d, id: undefined }, unitId, list);
        list.push(e);
        toPut.push(e);
      }
      for (const u of plan.toUpdate) {
        const e = draftToEmployee({ ...u.draft, id: u.employee.id }, unitId, list);
        list = list.map((x) => (x.id === e.id ? e : x));
        toPut.push(e);
      }
      const saved = await write(() => repo().putEmployees(toPut));
      if (!saved.ok) return fail(saved.message!);
      set({ employees: sortEmployees(list) });
      const affected = await applyMembershipToSheets(list);
      await audit('nhap_nhan_su', 'employee', `Nhập Excel: thêm ${plan.toCreate.length}, cập nhật ${plan.toUpdate.length}`);
      return ok({ created: plan.toCreate.length, updated: plan.toUpdate.length, affected });
    },

    // ---------- Mã công
    async saveCode(draft: CodeDraft): Promise<Result<{ lockedUnaffected: string[] }>> {
      if (!allowed('code.manage')) return deny('code.manage');
      const u = unit();
      if (!u) return fail('Chưa chọn đơn vị.');
      const errors = validateCodeDraft(draft, get().codes, u.codeGroups);
      if (errors.length) return fail(errors.join(' '));
      const prev = get().codes.find((c) => c.id === draft.id);
      if (prev && normKey(prev.code) !== normKey(draft.code)) {
        const usage = codeUsage(prev, get().sheets);
        if (usage.cells) {
          return fail(`Mã "${prev.code}" đã dùng trong ${usage.cells} ô (${usage.months.join(', ')}). Không đổi ký hiệu; hãy ngừng sử dụng và tạo mã mới.`);
        }
      }
      const t = nowIso();
      const code: AttendanceCode = prev
        ? { ...prev, ...draft, code: draft.code.normalize('NFC').trim(), id: prev.id, updatedAt: t }
        : {
            ...draft,
            code: draft.code.normalize('NFC').trim(),
            id: uid('code'),
            unitId: u.id,
            order: Math.max(0, ...get().codes.map((c) => c.order)) + 1,
            createdAt: t,
            updatedAt: t,
          };
      const saved = await write(() => repo().putCodes([code]));
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ codes: [...s.codes.filter((c) => c.id !== code.id), code].sort((a, b) => a.order - b.order) }));
      const lockedUnaffected = prev ? lockedSheetsFrom(code.versions[0]?.effectiveFrom ?? '0000-00', get().sheets) : [];
      await audit(prev ? 'sua_ma_cong' : 'them_ma_cong', 'code', `${code.code} – ${code.name}; quy tắc: ${JSON.stringify(code.versions)}`, code.id);
      return ok({ lockedUnaffected });
    },

    async addCodeVersion(codeId: string, version: CodeRuleVersion): Promise<Result<{ lockedUnaffected: string[] }>> {
      if (!allowed('code.manage')) return deny('code.manage');
      const prev = get().codes.find((c) => c.id === codeId);
      if (!prev) return fail('Không tìm thấy mã công.');
      const next = upsertVersion(prev, version);
      const errors = validateCodeDraft(next, get().codes, unit()?.codeGroups ?? []);
      if (errors.length) return fail(errors.join(' '));
      const saved = await write(() => repo().putCodes([next]));
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ codes: s.codes.map((c) => (c.id === codeId ? next : c)) }));
      await audit('quy_tac_ma_cong', 'code', `${prev.code}: áp dụng từ ${version.effectiveFrom} hệ số ${version.value ?? 'chưa quy định'}, tính tổng: ${version.countsInTotal ? 'có' : 'không'}`, codeId);
      return ok({ lockedUnaffected: lockedSheetsFrom(version.effectiveFrom, get().sheets) });
    },

    async setCodeActive(codeId: string, active: boolean): Promise<Result> {
      if (!allowed('code.manage')) return deny('code.manage');
      const prev = get().codes.find((c) => c.id === codeId);
      if (!prev) return fail('Không tìm thấy mã công.');
      const next = { ...prev, active, updatedAt: nowIso() };
      const saved = await write(() => repo().putCodes([next]));
      if (!saved.ok) return saved;
      set((s) => ({ codes: s.codes.map((c) => (c.id === codeId ? next : c)) }));
      await audit(active ? 'dung_lai_ma_cong' : 'ngung_ma_cong', 'code', `${prev.code} – ${active ? 'sử dụng lại' : 'ngừng sử dụng (giữ dữ liệu lịch sử)'}`, codeId);
      return ok();
    },

    async deleteCode(codeId: string): Promise<Result> {
      if (!allowed('code.manage')) return deny('code.manage');
      const prev = get().codes.find((c) => c.id === codeId);
      if (!prev) return fail('Không tìm thấy mã công.');
      const usage = codeUsage(prev, get().sheets);
      if (usage.cells) return fail(`Mã "${prev.code}" đã được dùng (${usage.months.join(', ')}). Chỉ có thể ngừng sử dụng.`);
      const saved = await write(() => repo().deleteCode(codeId));
      if (!saved.ok) return saved;
      set((s) => ({ codes: s.codes.filter((c) => c.id !== codeId) }));
      await audit('xoa_ma_cong', 'code', `Xóa mã chưa dùng ${prev.code}`, codeId);
      return ok();
    },

    async moveCode(codeId: string, delta: number): Promise<Result> {
      if (!allowed('code.manage')) return deny('code.manage');
      const list = [...get().codes].sort((a, b) => a.order - b.order);
      const i = list.findIndex((c) => c.id === codeId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return ok();
      [list[i], list[j]] = [list[j], list[i]];
      const re = list.map((c, idx) => ({ ...c, order: idx + 1 }));
      const saved = await write(() => repo().putCodes(re));
      if (!saved.ok) return saved;
      set({ codes: re });
      return ok();
    },

    async addSuggestedCodes(applyValues: boolean, effectiveFrom: string): Promise<Result<number>> {
      if (!allowed('code.manage')) return deny('code.manage');
      const u = unit();
      if (!u) return fail('Chưa chọn đơn vị.');
      const existing = new Set(get().codes.map((c) => normKey(c.code)));
      let order = Math.max(0, ...get().codes.map((c) => c.order));
      const groups = new Set(u.codeGroups.map((g) => g.id));
      const added = SUGGESTED_CODES.filter((s) => !existing.has(normKey(s.code))).map((s) =>
        makeCode(u.id, { ...s, groupId: groups.has(s.groupId) ? s.groupId : u.codeGroups[0]?.id ?? 'khac' }, ++order, effectiveFrom, applyValues),
      );
      if (!added.length) return ok(0, 'Các mã gợi ý đã có sẵn.');
      const saved = await write(() => repo().putCodes(added));
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ codes: [...s.codes, ...added] }));
      await audit('them_ma_goi_y', 'code', `Thêm ${added.length} mã gợi ý (${applyValues ? 'áp dụng hệ số gợi ý đã xác nhận' : 'chưa quy định hệ số'})`);
      return ok(added.length);
    },

    // ---------- Đơn vị
    async createUnit(input: { code: string; name: string; parentOrg?: string; startYear?: number }): Promise<Result<Unit>> {
      if (!allowed('unit.manage')) return deny('unit.manage');
      const u = newUnit(input);
      const errors = validateUnit(u, get().units);
      if (errors.length) return fail(errors.join(' '));
      const saved = await write(() => repo().putUnit(u));
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ units: [...s.units, u] }));
      await audit('tao_don_vi', 'unit', `Tạo đơn vị ${u.code} – ${u.name}`, u.id, u.id);
      await actions.selectUnit(u.id);
      return ok(u);
    },

    async saveUnit(next: Unit): Promise<Result> {
      if (!allowed('unit.manage')) return deny('unit.manage');
      const errors = validateUnit(next, get().units);
      for (const h of next.calendar.holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) errors.push(`Ngày lễ không hợp lệ: ${h.date}`);
      if (new Set(next.codeGroups.map((g) => g.id)).size !== next.codeGroups.length) errors.push('Trùng mã nhóm công.');
      const usedGroups = new Set(get().codes.filter((c) => c.unitId === next.id).map((c) => c.groupId));
      for (const g of usedGroups) if (!next.codeGroups.some((x) => x.id === g)) errors.push(`Không thể xóa nhóm "${g}" đang được mã công sử dụng.`);
      if (errors.length) return fail(errors.join(' '));
      const u = { ...next, updatedAt: nowIso() };
      const saved = await write(() => repo().putUnit(u));
      if (!saved.ok) return saved;
      set((s) => ({ units: s.units.map((x) => (x.id === u.id ? u : x)) }));
      await audit('sua_don_vi', 'unit', `Cập nhật cấu hình đơn vị ${u.code}`, u.id, u.id);
      return ok();
    },

    exportUnitConfig(opts: { includeEmployees: boolean; includeAttendance: boolean }): UnitConfigFile | null {
      const u = unit();
      if (!u) return null;
      return buildUnitConfig(u, get().codes, get().employees, get().sheets, opts);
    },

    async planCloneCurrentUnit(code: string, name: string, includeEmployees: boolean): Promise<ConfigImportPlan | null> {
      const file = actions.exportUnitConfig({ includeEmployees, includeAttendance: false });
      if (!file) return null;
      return planUnitFromConfig(file, get().units, { code, name, includeEmployees, includeAttendance: false });
    },

    async applyUnitPlan(plan: ConfigImportPlan): Promise<Result<Unit>> {
      if (!allowed('unit.manage')) return deny('unit.manage');
      if (plan.errors.length) return fail(plan.errors.join(' '));
      const errors = validateUnit(plan.unit, get().units);
      if (errors.length) return fail(errors.join(' '));
      const r = repo();
      const saved = await write(async () => {
        await r.putUnit(plan.unit);
        await r.putCodes(plan.codes);
        await r.putEmployees(plan.employees);
        await r.putSheets(plan.sheets);
      });
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ units: [...s.units, plan.unit] }));
      await audit('tao_don_vi_tu_cau_hinh', 'unit', `Tạo ${plan.unit.code} từ cấu hình: ${plan.codes.length} mã công, ${plan.employees.length} nhân sự, ${plan.sheets.length} bảng`, plan.unit.id, plan.unit.id);
      await actions.selectUnit(plan.unit.id);
      return ok(plan.unit);
    },

    // ---------- Nhập chấm công từ Excel
    async applyAttendanceImport(plan: AttendanceImportPlan): Promise<Result<EditResult>> {
      if (!allowed('data.import') || !allowed('sheet.edit')) return deny('data.import');
      const sheet = currentSheet();
      if (!sheet) return fail('Chưa tạo bảng chấm công.');
      if (sheet.locked) return fail('Bảng chấm công đã khóa.');
      if (plan.overwrites > 0 || plan.mode === 'replace') {
        await snapshot(`Trước khi nhập Excel (${plan.mode}) vào ${formatMonth(sheet.year, sheet.month)}`, 'unit');
      }
      const res = await actions.editCells(plan.edits, `Nhập Excel – chế độ ${plan.mode}`);
      if (res.ok) await audit('nhap_excel', 'sheet', `Nhập Excel ${plan.mode}: ${res.data?.applied.length ?? 0} ô, ghi đè ${plan.overwrites}`, sheet.id);
      return res;
    },

    // ---------- Sao lưu / phục hồi
    async exportBackup(scope: 'all' | 'unit'): Promise<Result<BackupFile>> {
      if (!allowed('data.backup')) return deny('data.backup');
      if (scope === 'all' && get().session?.role !== 'admin') return fail('Chỉ quản trị viên được sao lưu toàn bộ.');
      const data = await repo().dump(scope, get().unitId ?? undefined);
      return ok(data);
    },

    /** Gọi sau khi file sao lưu đã được tải xuống máy. */
    async markBackedUp(scope: 'all' | 'unit') {
      const t = nowIso();
      await repo().setMeta('lastBackupAt', t);
      set({ lastBackupAt: t });
      await audit('sao_luu', 'data', `Xuất file sao lưu (${scope === 'all' ? 'toàn bộ' : 'đơn vị hiện tại'})`);
    },

    async createSnapshot(reason: string): Promise<Result<Snapshot>> {
      if (!allowed('data.backup')) return deny('data.backup');
      const s = await snapshot(reason, get().session?.role === 'admin' ? 'all' : 'unit');
      await audit('diem_khoi_phuc', 'data', `Tạo điểm khôi phục: ${reason}`);
      return ok(s);
    },

    async restore(data: unknown, mode: 'all' | 'unit'): Promise<Result> {
      if (!allowed('data.restore')) return deny('data.restore');
      const { backup, preview } = validateBackup(data);
      if (!backup) return fail(preview.errors.join(' ') || 'File sao lưu không hợp lệ.');
      const r = repo();
      await snapshot('Tự động trước khi phục hồi', 'all');
      if (mode === 'all') {
        if (backup.scope !== 'all') return fail('File là bản sao lưu một đơn vị – hãy chọn "Phục hồi đơn vị".');
        const saved = await write(() => r.restoreAll(backup));
        if (!saved.ok) return saved;
      } else {
        if (backup.units.length !== 1) return fail('Phục hồi đơn vị cần file sao lưu của đúng một đơn vị.');
        const target = backup.units[0];
        const clash = get().units.find((u) => u.id !== target.id && normKey(u.code) === normKey(target.code));
        if (clash) return fail(`Mã đơn vị "${target.code}" đang dùng cho đơn vị khác trong bản cài đặt này.`);
        const unitBackup: BackupFile = {
          ...backup,
          employees: backup.employees.filter((e) => e.unitId === target.id),
          codes: backup.codes.filter((c) => c.unitId === target.id),
          sheets: backup.sheets.filter((s) => s.unitId === target.id),
          audit: backup.audit.filter((a) => a.unitId === target.id),
        };
        const saved = await write(() => r.replaceUnit(unitBackup));
        if (!saved.ok) return saved;
      }
      const [units, users] = await Promise.all([r.listUnits(), r.listUsers()]);
      set({ units, users });
      await audit('phuc_hoi', 'data', `Phục hồi ${mode === 'all' ? 'toàn bộ' : 'đơn vị ' + backup.units[0].code} từ bản sao lưu ${backup.createdAt}`, undefined, null);
      const visible = accessibleUnits(units, get().session);
      const target = visible.find((u) => u.id === get().unitId) ?? visible[0];
      if (target) await loadUnitData(target.id);
      else set({ unitId: null, employees: [], codes: [], sheets: [] });
      return ok();
    },

    async restoreSnapshot(id: string): Promise<Result> {
      const snap = await repo().getSnapshot(id);
      if (!snap) return fail('Không tìm thấy điểm khôi phục.');
      return actions.restore(snap.data, snap.data.scope === 'all' ? 'all' : 'unit');
    },

    // ---------- Người dùng
    async saveUser(input: { id?: string; username: string; displayName: string; role: RoleId; unitIds: string[]; active: boolean; password?: string }): Promise<Result> {
      if (!allowed('user.manage')) return deny('user.manage');
      if (!input.username.trim()) return fail('Cần nhập tên đăng nhập.');
      const users = get().users;
      if (users.some((u) => u.id !== input.id && normKey(u.username) === normKey(input.username))) return fail('Tên đăng nhập đã tồn tại.');
      const prev = users.find((u) => u.id === input.id);
      if (!prev && !input.password) return fail('Cần đặt mật khẩu cho tài khoản mới.');
      if (input.password) {
        const err = validatePassword(input.password);
        if (err) return fail(err);
      }
      const remainingAdmins = users.filter((u) => u.id !== input.id && u.active && u.role === 'admin').length;
      if (prev?.role === 'admin' && (input.role !== 'admin' || !input.active) && remainingAdmins === 0) {
        return fail('Phải còn ít nhất một quản trị viên đang hoạt động.');
      }
      if (!prev && users.filter((u) => u.active).length === 0 && input.role !== 'admin') {
        return fail('Tài khoản đầu tiên phải là quản trị viên.');
      }
      const hash = input.password ? await hashPassword(input.password) : null;
      const user: User = {
        id: prev?.id ?? uid('user'),
        username: input.username.trim(),
        displayName: input.displayName.trim() || input.username.trim(),
        role: input.role,
        unitIds: input.unitIds,
        active: input.active,
        passwordHash: hash?.passwordHash ?? prev!.passwordHash,
        salt: hash?.salt ?? prev!.salt,
        iterations: hash?.iterations ?? prev!.iterations,
        createdAt: prev?.createdAt ?? nowIso(),
      };
      const saved = await write(() => repo().putUser(user));
      if (!saved.ok) return saved;
      set({ users: [...users.filter((u) => u.id !== user.id), user] });
      await audit(prev ? 'sua_tai_khoan' : 'tao_tai_khoan', 'user', `${user.username} (${user.role})`, user.id, null);
      // Tạo tài khoản đầu tiên khi đang ở chế độ cục bộ → chuyển sang phiên của tài khoản đó.
      if (get().session?.open) {
        set({
          session: { userId: user.id, username: user.username, displayName: user.displayName, role: user.role, unitIds: user.unitIds, open: false },
        });
      }
      return ok();
    },

    async listAudit(limit = 500): Promise<AuditEntry[]> {
      return repo().listAudit(get().unitId, limit);
    },

    async listSnapshots(): Promise<Snapshot[]> {
      const all = await repo().listSnapshots();
      if (get().session?.role === 'admin') return all;
      return all.filter((s) => s.unitId === get().unitId);
    },

    // ---------- Dữ liệu mẫu (tách biệt, đánh dấu rõ)
    async createSampleUnit(): Promise<Result<Unit>> {
      if (!allowed('unit.manage')) return deny('unit.manage');
      let code = 'MAU';
      let i = 1;
      while (get().units.some((u) => normKey(u.code) === code)) code = `MAU${++i}`;
      const u = newUnit({ code, name: 'Đài mẫu – dữ liệu thử nghiệm', parentOrg: 'Đơn vị chủ quản (mẫu)', isSample: true });
      const { year, month } = get();
      const codes = SUGGESTED_CODES.map((s, idx) => makeCode(u.id, s, idx + 1, `${u.startYear - 5}-01`, true));
      const names = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Văn Cường', 'Phạm Thị Dung', 'Hoàng Văn Em', 'Võ Thị Giang', 'Đặng Văn Hùng', 'Bùi Thị Lan'];
      const t = nowIso();
      const employees: Employee[] = names.map((n, idx) => ({
        id: uid('emp'), unitId: u.id, code: `NV${String(idx + 1).padStart(3, '0')}`, fullName: n,
        position: idx === 0 ? 'Giám đốc' : idx < 3 ? 'Trưởng ca' : 'Khai thác viên', department: idx === 0 ? 'Ban Giám đốc' : 'Tổ Khai thác',
        status: 'active', order: idx + 1, createdAt: t, updatedAt: t,
      }));
      let sheet = createSheet(u, year, month, employees);
      const edits: CellEdit[] = [];
      employees.forEach((e, idx) => {
        for (let d = 1; d <= 20; d++) edits.push({ employeeId: e.id, day: d, value: (d + idx) % 7 === 0 ? 'P' : 'X' });
      });
      sheet = applyCellEdits(sheet, edits, codes).sheet;
      const r = repo();
      const saved = await write(async () => {
        await r.putUnit(u);
        await r.putCodes(codes);
        await r.putEmployees(employees);
        await r.putSheets([sheet]);
      });
      if (!saved.ok) return fail(saved.message!);
      set((s) => ({ units: [...s.units, u] }));
      await audit('tao_du_lieu_mau', 'unit', 'Tạo đơn vị dữ liệu mẫu', u.id, u.id);
      await actions.selectUnit(u.id);
      return ok(u);
    },

    monthKey: () => monthKey(get().year, get().month),
  };

  return Object.assign(store, { actions });
}

function draftToEmployee(draft: EmployeeDraft, unitId: string, existing: Employee[]): Employee {
  const prev = existing.find((e) => e.id === draft.id);
  const t = nowIso();
  return {
    id: prev?.id ?? draft.id ?? uid('emp'),
    unitId: prev?.unitId ?? unitId,
    code: draft.code.trim(),
    fullName: draft.fullName.trim().replace(/\s+/g, ' '),
    position: draft.position?.trim() ?? '',
    department: draft.department?.trim() ?? '',
    status: draft.status,
    startDate: draft.startDate || undefined,
    endDate: draft.endDate || undefined,
    note: draft.note?.trim() || undefined,
    order: prev?.order ?? Math.max(0, ...existing.map((e) => e.order)) + 1,
    createdAt: prev?.createdAt ?? t,
    updatedAt: t,
  };
}

function describeEmployeeChange(a: Employee, b: Employee): string {
  const parts: string[] = [];
  const f: [keyof Employee, string][] = [
    ['code', 'Mã'], ['fullName', 'Họ tên'], ['position', 'Chức vụ'], ['department', 'Bộ phận'],
    ['status', 'Trạng thái'], ['startDate', 'Bắt đầu'], ['endDate', 'Kết thúc'],
  ];
  for (const [k, label] of f) if ((a[k] ?? '') !== (b[k] ?? '')) parts.push(`${label}: "${a[k] ?? ''}" → "${b[k] ?? ''}"`);
  return `${b.code}: ${parts.join('; ') || 'không đổi'}`;
}

export type AppStore = ReturnType<typeof createAppStore>;
