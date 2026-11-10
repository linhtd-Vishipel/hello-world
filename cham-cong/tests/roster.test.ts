import 'fake-indexeddb/auto';
import ExcelJS from 'exceljs';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { daysInMonth } from '../src/domain/calendar';
import { generateRoster, hungarian } from '../src/domain/roster/generate';
import type { Roster } from '../src/domain/roster/types';
import { validateRoster } from '../src/domain/roster/validate';
import { exportRosterXlsx } from '../src/excel/roster-export';
import { Repo } from '../src/storage/db';
import { createAppStore } from '../src/state/store';
import { fixture } from './rosterFixture';

const HARD = (issues: ReturnType<typeof validateRoster>) => issues.filter((i) => i.severity === 'error');

describe('Thuật toán phân ca', () => {
  it('Hungarian chọn phân công chi phí nhỏ nhất', () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
  });

  it('2. Lập lịch tháng mới: đủ người mọi vị trí, không vi phạm quy tắc cứng, công bằng', () => {
    const f = fixture({ truc: 6 });
    const ctx = f.ctx();
    const g = generateRoster(ctx, []);
    expect(g.shortages).toEqual([]);
    const issues = validateRoster(ctx, g.assignments);
    expect(HARD(issues)).toEqual([]);
    // Mỗi ngày đủ 5 vị trí (3 ca trực canh + 2 hành chính), mỗi người tối đa 1 ca/ngày
    for (let d = 1; d <= 30; d++) {
      const day = g.assignments.filter((a) => a.day === d);
      expect(day).toHaveLength(5);
      expect(new Set(day.map((a) => a.employeeId)).size).toBe(5);
    }
    // Không ai trực ca đêm quá 2 đêm liên tiếp, không ai > 6 ngày liên tiếp, không vượt 26 công
    const days = new Map<string, number>();
    for (const a of g.assignments) days.set(a.employeeId, (days.get(a.employeeId) ?? 0) + 1);
    expect(Math.max(...days.values())).toBeLessThanOrEqual(26);
    // Chênh lệch số ngày trực trong nhóm trực canh ≤ 2
    const truc = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => days.get(id) ?? 0);
    expect(Math.max(...truc) - Math.min(...truc)).toBeLessThanOrEqual(2);
  });

  it('3. Thiếu nhân sự: để trống, báo nguyên nhân cụ thể, không tạo lịch sai', () => {
    const f = fixture({ truc: 3 });
    const ctx = f.ctx();
    const g = generateRoster(ctx, []);
    expect(g.shortages.length).toBeGreaterThan(0);
    const s = g.shortages[0];
    expect(s.reasons.length).toBeGreaterThan(0);
    expect(s.reasons.some((r) => /liên tiếp|ca đêm|đã có ca|nghỉ|trần|giờ/.test(r.reason))).toBe(true);
    const errors = HARD(validateRoster(ctx, g.assignments));
    // Lỗi duy nhất là thiếu người — không có vi phạm nghỉ ngơi, trùng ca, vượt trần
    expect(errors.every((e) => e.kind === 'thieu_nguoi')).toBe(true);
    expect(errors.length).toBe(g.shortages.reduce((n, x) => n + x.missing, 0));
  });

  it('4. Nhân sự nghỉ phép (đăng ký trong lịch hoặc đã có ở bảng chấm công) không bị xếp ca', () => {
    const f = fixture({ truc: 6 });
    const p = f.byCode('P');
    const roster: Roster = { ...f.roster, leaves: { e1: Object.fromEntries([5, 6, 7, 8].map((d) => [String(d), p])) } };
    const sheet = {
      id: f.roster.id, unitId: f.unit.id, year: 2026, month: 11, employeeIds: f.employees.map((e) => e.id),
      cells: { e2: { '12': 'Ô', '13': 'CT' } }, cellNotes: {}, rowNotes: {}, locked: false, createdAt: '', updatedAt: '',
    };
    const ctx = f.ctx(roster, [], sheet as never);
    const g = generateRoster(ctx, []);
    expect(g.assignments.filter((a) => a.employeeId === 'e1' && a.day >= 5 && a.day <= 8)).toEqual([]);
    expect(g.assignments.filter((a) => a.employeeId === 'e2' && (a.day === 12 || a.day === 13))).toEqual([]);
    expect(HARD(validateRoster(ctx, g.assignments))).toEqual([]);
    // Kiểm tra độc lập phát hiện nếu cố tình xếp vào ngày nghỉ
    const bad = [...g.assignments.filter((a) => !(a.day === 6 && a.shiftId === 'sh_ca1')), { day: 6, shiftId: 'sh_ca1', positionId: 'pos_kt', employeeId: 'e1', manual: true }];
    expect(HARD(validateRoster(ctx, bad)).some((i) => i.kind === 'nghi_phep' && i.day === 6)).toBe(true);
  });

  it('6. Cuối tuần: khối hành chính nghỉ khi đủ người; nhóm luân phiên chỉ dùng khi thiếu, chia đều', () => {
    const enough = fixture({ truc: 6 });
    const g1 = generateRoster(enough.ctx(), []);
    const ctx1 = enough.ctx();
    const weekend = (d: number) => ctx1.dayTypes[d - 1] !== 'weekday';
    expect(g1.assignments.filter((a) => (a.employeeId === 'e20' || a.employeeId === 'e21') && weekend(a.day))).toEqual([]);
    // Ngày thường: người hành chính đúng vị trí chính
    const weekdayLong = g1.assignments.filter((a) => a.employeeId === 'e20');
    expect(weekdayLong.every((a) => a.positionId === 'pos_ks')).toBe(true);
    expect(weekdayLong).toHaveLength(ctx1.dayTypes.filter((t) => t === 'weekday').length);

    const short = fixture({ truc: 5 });
    const ctx2 = short.ctx();
    const g2 = generateRoster(ctx2, []);
    expect(g2.shortages).toEqual([]);
    const wl = g2.assignments.filter((a) => a.employeeId === 'e20' && ctx2.dayTypes[a.day - 1] !== 'weekday').length;
    const wd = g2.assignments.filter((a) => a.employeeId === 'e21' && ctx2.dayTypes[a.day - 1] !== 'weekday').length;
    expect(Math.abs(wl - wd)).toBeLessThanOrEqual(2);
    // Tắt luân phiên của Duy Linh → không bao giờ xếp cuối tuần
    short.config.profiles.find((p) => p.employeeId === 'e21')!.weekendRotation = false;
    const ctx3 = short.ctx();
    const g3 = generateRoster(ctx3, []);
    expect(g3.assignments.filter((a) => a.employeeId === 'e21' && ctx3.dayTypes[a.day - 1] !== 'weekday')).toEqual([]);
    expect(HARD(validateRoster(ctx3, g3.assignments)).filter((i) => i.kind !== 'thieu_nguoi')).toEqual([]);
  });

  it('Đối chiếu tháng trước: nối trạng thái ca đêm/ngày liên tiếp sang tháng mới', () => {
    const f = fixture({ truc: 6, month: 11 });
    const oct: Roster = { ...f.roster, id: 'x:2026-10', month: 10, assignments: [
      { day: 30, shiftId: 'sh_ca3', positionId: 'pos_kt', employeeId: 'e1', manual: false },
      { day: 31, shiftId: 'sh_ca3', positionId: 'pos_kt', employeeId: 'e1', manual: false },
      ...[26, 27, 28, 29, 30, 31].map((d) => ({ day: d, shiftId: 'sh_ca1', positionId: 'pos_kt', employeeId: 'e2', manual: false })),
    ] };
    const ctx = f.ctx(f.roster, [oct]);
    expect(ctx.carry.get('e1')).toMatchObject({ consecNights: 2, lastWasNight: true });
    const g = generateRoster(ctx, []);
    const d1 = g.assignments.filter((a) => a.day === 1);
    // e1 vừa 2 đêm liên tiếp → không trực đêm ngày 1, không trực canh ban ngày ngày 1
    expect(d1.find((a) => a.employeeId === 'e1' && a.positionId === 'pos_kt')).toBeUndefined();
    // e2 đã làm 6 ngày liên tiếp → ngày 1 phải nghỉ
    expect(d1.find((a) => a.employeeId === 'e2')).toBeUndefined();
    expect(HARD(validateRoster(ctx, g.assignments))).toEqual([]);
  });

  it('Giới hạn số ngày liên tiếp tại vị trí khai thác (cấu hình được)', () => {
    const f = fixture({ truc: 6 });
    f.config.positions.find((p) => p.id === 'pos_kt')!.maxConsecutiveDays = 2;
    const ctx = f.ctx();
    const g = generateRoster(ctx, []);
    const issues = validateRoster(ctx, g.assignments);
    expect(issues.filter((i) => i.kind === 'vi_tri_lien_tiep')).toEqual([]);
    expect(HARD(issues).filter((i) => i.kind !== 'thieu_nguoi')).toEqual([]);
  });
});

async function storeWithUnit() {
  const repo = await Repo.open(`roster-${Math.random()}`);
  const store = createAppStore(new Date(2026, 10, 10));
  await store.actions.init(repo);
  const a = store.actions;
  await a.createUnit({ code: 'CMR', name: 'Đài TTDH Cà Mau' });
  await a.addSuggestedCodes(true, '2020-01');
  for (const [code, nm] of [['K1', 'Trực canh ca 1'], ['K2', 'Trực canh ca 2'], ['CĐ', 'Ca đêm'], ['K', 'Hành chính']]) {
    await a.saveCode({ code, name: nm, groupId: 'lam_viec', color: '#fff', rule: '', active: true, versions: [{ effectiveFrom: '2020-01', value: 1, countsInTotal: true, isActualWork: true }] });
  }
  const names = ['An', 'Bình', 'Cường', 'Dung', 'Em', 'Giang', 'Long', 'Duy Linh'];
  for (let i = 0; i < names.length; i++) {
    await a.saveEmployee({ code: `NV${i + 1}`, fullName: names[i], position: '', department: '', status: 'active' });
  }
  const codeId = (c: string) => store.getState().codes.find((x) => x.code === c)!.id;
  const cfg = structuredClone(store.getState().shiftConfig!);
  cfg.shifts.find((s) => s.id === 'sh_ca1')!.attendanceCodeId = codeId('K1');
  cfg.shifts.find((s) => s.id === 'sh_ca2')!.attendanceCodeId = codeId('K2');
  cfg.shifts.find((s) => s.id === 'sh_ca3')!.attendanceCodeId = codeId('CĐ');
  cfg.shifts.find((s) => s.id === 'sh_hc')!.attendanceCodeId = codeId('K');
  expect((await a.roster.saveConfig(cfg)).ok).toBe(true);
  const emps = store.getState().employees;
  for (const e of emps) {
    const p = a.roster.profileFor(e.id)!;
    if (e.fullName === 'Long') Object.assign(p, { workType: 'hanh_chinh', primaryPositionId: 'pos_ks', positionIds: ['pos_ks'], weekendRotation: true });
    else if (e.fullName === 'Duy Linh') Object.assign(p, { workType: 'hanh_chinh', primaryPositionId: 'pos_nd', positionIds: ['pos_nd'], weekendRotation: true });
    else Object.assign(p, { positionIds: ['pos_kt', 'pos_ks', 'pos_nd'], group: 'Trực canh' });
    expect((await a.roster.saveProfile(p)).ok).toBe(true);
  }
  a.setMonth(2026, 11);
  return { store, a, repo, codeId, emps };
}

describe('Module phân ca tích hợp với Dashboard', () => {
  it('5, 9. Điều chỉnh tay, đổi ca, giữ ô xếp tay khi lập lại, lưu và khôi phục phiên bản', async () => {
    const { a, store, emps } = await storeWithUnit();
    expect((await a.roster.create()).ok).toBe(true);
    const g = await a.roster.generate();
    expect(g.ok).toBe(true);
    expect(g.data!.shortages).toEqual([]);
    const r1 = a.roster.current()!;
    const an = emps.find((e) => e.fullName === 'An')!.id;
    const binh = emps.find((e) => e.fullName === 'Bình')!.id;
    // Đổi ca ngày 3 giữa An và người trực Ca 1 ngày 3
    const ca1d3 = r1.assignments.find((x) => x.day === 3 && x.shiftId === 'sh_ca1')!;
    const other = ca1d3.employeeId === an ? binh : an;
    expect((await a.roster.swap(3, ca1d3.employeeId, other)).ok).toBe(true);
    expect(a.roster.current()!.assignments.find((x) => x.day === 3 && x.shiftId === 'sh_ca1')!.employeeId).toBe(other);
    // Xếp tay ngày 15: An trực Ca 2
    await a.roster.clear(15, an);
    expect((await a.roster.assign(15, an, 'sh_ca2', 'pos_kt', 'Theo đề nghị')).ok).toBe(true);
    // Lập lại tự động: ô xếp tay được giữ
    await a.roster.generate();
    const keep = a.roster.current()!.assignments.find((x) => x.day === 15 && x.employeeId === an)!;
    expect(keep).toMatchObject({ shiftId: 'sh_ca2', manual: true, note: 'Theo đề nghị' });
    // Phiên bản lưu trước mỗi thay đổi; khôi phục bản trước khi lập lại
    const versions = await a.roster.listVersions();
    expect(versions.length).toBeGreaterThanOrEqual(4);
    const beforeSwap = versions.find((v) => v.reason.includes('đổi ca'))!;
    expect((await a.roster.restoreVersion(beforeSwap)).ok).toBe(true);
    expect(a.roster.current()!.assignments.find((x) => x.day === 3 && x.shiftId === 'sh_ca1')!.employeeId).toBe(ca1d3.employeeId);
    // Nhật ký
    const logs = await a.listAudit();
    expect(logs.some((l) => l.action === 'doi_ca')).toBe(true);
    expect(logs.some((l) => l.action === 'khoi_phuc_lich')).toBe(true);
    expect(store.getState().rosters).toHaveLength(1);
  });

  it('7. Đồng bộ sang chấm công: đúng mã, không ghi đè mã nghỉ, chỉ cập nhật ô bị ảnh hưởng', async () => {
    const { a, store, emps, codeId } = await storeWithUnit();
    await a.createSheet();
    const an = emps.find((e) => e.fullName === 'An')!.id;
    const dung = emps.find((e) => e.fullName === 'Dung')!.id;
    // Nghỉ phép đã nhập ở bảng chấm công trước
    await a.editCells([{ employeeId: dung, day: 9, value: 'P' }, { employeeId: dung, day: 10, value: 'Ô' }]);
    await a.roster.create();
    await a.roster.setLeave(an, 20, codeId('P'));
    await a.roster.generate();
    // Chưa chốt → không đồng bộ
    expect(a.roster.syncPlan()!.blockers[0]).toContain('chưa được chốt');
    const v = a.roster.validate()!;
    expect(v.errors).toBe(0);
    expect((await a.roster.approve()).ok).toBe(true);
    const plan = a.roster.syncPlan()!;
    expect(plan.blockers).toEqual([]);
    expect(plan.counts.xung_dot).toBe(0);
    const res = await a.roster.sync();
    expect(res.ok).toBe(true);
    const sheet = a.currentSheet()!;
    const r = a.roster.current()!;
    const code = { sh_ca1: 'K1', sh_ca2: 'K2', sh_ca3: 'CĐ', sh_hc: 'K' } as Record<string, string>;
    for (const x of r.assignments) expect(sheet.cells[x.employeeId][String(x.day)]).toBe(code[x.shiftId]);
    expect(sheet.cells[dung]['9']).toBe('P');
    expect(sheet.cells[dung]['10']).toBe('Ô');
    expect(sheet.cells[an]['20']).toBe('P');
    // Ngày không phân công → trống
    const assigned = new Set(r.assignments.filter((x) => x.employeeId === an).map((x) => x.day));
    for (let d = 1; d <= daysInMonth(2026, 11); d++) if (!assigned.has(d) && d !== 20) expect(sheet.cells[an]?.[String(d)]).toBeUndefined();
    // Tính công: tổng công khớp số ngày làm + phép
    expect((await a.roster.sync()).message).toContain('đã khớp');

    // Mở lại, đổi 1 ca → đồng bộ chỉ chạm đúng 2 ô
    expect((await a.roster.reopen('Điều chỉnh theo yêu cầu')).ok).toBe(true);
    const target = r.assignments.find((x) => x.day === 4 && x.shiftId === 'sh_ca1')!;
    const adminIds = emps.filter((e) => e.fullName === 'Long' || e.fullName === 'Duy Linh').map((e) => e.id);
    const candidates = r.participants.filter((id) => !r.assignments.some((x) => x.day === 4 && x.employeeId === id) && !adminIds.includes(id));
    let free = '';
    for (const c of candidates) {
      await a.roster.swap(4, target.employeeId, c);
      if (a.roster.validate()!.errors === 0) {
        free = c;
        break;
      }
      await a.roster.swap(4, c, target.employeeId);
    }
    expect(free).not.toBe('');
    await a.roster.approve();
    const p2 = a.roster.syncPlan()!;
    expect(p2.edits).toHaveLength(2);
    expect(p2.changes.map((c) => c.action).sort()).toEqual(['them', 'xoa']);
    await a.roster.sync();
    expect(a.currentSheet()!.cells[free]['4']).toBe('K1');
    expect(a.currentSheet()!.cells[target.employeeId]?.['4']).toBeUndefined();
    // Không ghi đè: ca trực trùng ngày nghỉ đã nhập ở chấm công → xung đột, giữ nguyên
    const plan3 = a.roster.syncPlan()!;
    expect(plan3.edits.every((e) => !(e.employeeId === dung && (e.day === 9 || e.day === 10)))).toBe(true);
    expect(store.getState().sheets).toHaveLength(1);
  });

  it('Chốt lịch bị chặn khi còn lỗi; người xem không được sửa lịch', async () => {
    const { a, store, emps } = await storeWithUnit();
    await a.roster.create();
    const res = await a.roster.approve();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('lỗi');
    store.setState({ session: { ...store.getState().session!, role: 'xem' } });
    expect((await a.roster.generate()).ok).toBe(false);
    expect((await a.roster.assign(1, emps[0].id, 'sh_ca1', 'pos_kt')).ok).toBe(false);
  });

  it('8. Xuất Excel lịch phân ca: đủ trang, công thức, định dạng in', async () => {
    const { a, store } = await storeWithUnit();
    await a.roster.create();
    await a.roster.generate();
    const r = a.roster.current()!;
    const ctx = a.roster.contextFor(r)!;
    const bytes = await exportRosterXlsx({ ctx, roster: r, issues: validateRoster(ctx, r.assignments) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Lich phan ca', 'Theo nhan su', 'Tong hop cong', 'Vi pham']);
    const pc = wb.getWorksheet('Lich phan ca')!;
    expect(pc.getCell('A4').value).toBe('LỊCH PHÂN CA TRỰC');
    expect(pc.getCell('A9').value).toBe(1);
    expect(pc.pageSetup.printTitlesRow).toBe('7:8');
    expect(pc.getCell('C9').border.top?.style).toBe('thin');
    const ns = wb.getWorksheet('Theo nhan su')!;
    const f = ns.getCell(9, 4 + 30).value as ExcelJS.CellFormulaValue;
    expect(f.formula).toMatch(/^COUNTIF\(D9:AG9,"C1"\)$/);
    const first = store.getState().employees.find((e) => e.id === ctx.participants[0])!;
    expect(ns.getCell(9, 2).value).toBe(first.fullName);
    const th = wb.getWorksheet('Tong hop cong')!;
    expect(th.getRow(7).getCell(6).value).toBe('Số ngày trực');
    expect((th.getCell(8, 14).value as ExcelJS.CellFormulaValue).formula).toBe('F8+L8-M8');
  });

  it('Sao lưu/phục hồi kèm dữ liệu phân ca; nâng cấp CSDL v1 → v2 không mất dữ liệu', async () => {
    const { a } = await storeWithUnit();
    await a.roster.create();
    await a.roster.generate();
    const backup = JSON.parse(JSON.stringify((await a.exportBackup('unit')).data));
    expect(backup.rosters).toHaveLength(1);
    expect(backup.shiftConfigs).toHaveLength(1);
    await a.roster.clearAuto();
    expect(a.roster.current()!.assignments).toHaveLength(0);
    expect((await a.restore(backup, 'unit')).ok).toBe(true);
    a.setMonth(2026, 11);
    expect(a.roster.current()!.assignments.length).toBeGreaterThan(100);

    // CSDL phiên bản 1 có sẵn dữ liệu → mở bằng phiên bản 2
    const name = `upgrade-${Math.random()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('units', { keyPath: 'id' });
        db.createObjectStore('employees', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('codes', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('sheets', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true }).createIndex('byUnit', 'unitId');
        db.createObjectStore('snapshots', { keyPath: 'id' });
        db.createObjectStore('users', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    await v1.put('units', { id: 'u1', code: 'OLD', name: 'Đài cũ', parentOrg: '', address: '', startYear: 2024, calendar: { mode: 'truc_ca', weekendDays: [0, 6], holidays: [] }, codeGroups: [], template: {}, isSample: false, createdAt: '', updatedAt: '' });
    await v1.put('employees', { id: 'x1', unitId: 'u1', code: 'A', fullName: 'Người cũ', position: '', department: '', status: 'active', order: 1, createdAt: '', updatedAt: '' });
    v1.close();
    const repo = await Repo.open(name);
    expect((await repo.listUnits()).map((u) => u.code)).toEqual(['OLD']);
    expect(await repo.listEmployees('u1')).toHaveLength(1);
    expect(await repo.listRosters('u1')).toEqual([]);
    const s = createAppStore(new Date(2026, 10, 10));
    await s.actions.init(repo);
    expect((await repo.listSnapshots()).some((x) => x.reason.includes('Phân ca trực'))).toBe(true);
    expect(s.getState().shiftConfig).not.toBeNull();
  });
});
