import { describe, expect, it } from 'vitest';
import { validateBackup } from '../src/domain/backup';
import { Repo } from '../src/storage/db';
import { createAppStore } from '../src/state/store';
import { computeSheetSummary, makeContext } from '../src/domain/summary';
import { freshStore, setupUnit } from './helpers';

describe('Lưu trữ, sao lưu, đa đơn vị', () => {
  it('15. Đóng ứng dụng và mở lại: dữ liệu từng tháng được phục hồi đúng', async () => {
    const { a, repo, dbName } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    const [e1] = a.get().employees;
    a.setMonth(2026, 9);
    await a.createSheet();
    await a.editCells([{ employeeId: e1.id, day: 30, value: 'X' }]);
    a.setMonth(2026, 10);
    await a.createSheet();
    await a.editCells([{ employeeId: e1.id, day: 31, value: 'P' }]);
    await a.setRowNote(e1.id, 'Ghi chú tháng 10');
    // Chuyển tháng không xóa dữ liệu tháng khác
    expect(a.get().sheets).toHaveLength(2);
    repo.close();

    const repo2 = await Repo.open(dbName);
    const s2 = createAppStore(new Date(2026, 9, 18));
    await s2.actions.init(repo2);
    expect(s2.actions.unit()!.code).toBe('CMR');
    s2.actions.setMonth(2026, 9);
    expect(s2.actions.currentSheet()!.cells[e1.id]).toEqual({ '30': 'X' });
    s2.actions.setMonth(2026, 10);
    expect(s2.actions.currentSheet()!.cells[e1.id]).toEqual({ '31': 'P' });
    expect(s2.actions.currentSheet()!.rowNotes[e1.id]).toBe('Ghi chú tháng 10');
    // Không tạo lại đè bảng đã có
    expect((await s2.actions.createSheet()).ok).toBe(false);
    s2.actions.setMonth(2026, 11);
    expect(s2.actions.currentSheet()).toBeNull();
  });

  it('16. Sao lưu và phục hồi (toàn bộ và một đơn vị), tự tạo điểm khôi phục trước khi ghi đè', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    a.setMonth(2026, 10);
    await a.createSheet();
    const [e1] = a.get().employees;
    await a.editCells([{ employeeId: e1.id, day: 1, value: 'X' }]);
    const backup = (await a.exportBackup('all')).data!;
    const json = JSON.parse(JSON.stringify(backup));
    expect(validateBackup(json).preview.ok).toBe(true);
    expect(validateBackup({ format: 'khac' }).preview.ok).toBe(false);

    // Thay đổi sau sao lưu
    await a.editCells([{ employeeId: e1.id, day: 1, value: 'P' }, { employeeId: e1.id, day: 2, value: 'X' }]);
    await a.saveEmployee({ code: 'CMR099', fullName: 'Sau sao lưu', position: '', department: '', status: 'active' });
    expect(a.get().employees).toHaveLength(3);

    const r = await a.restore(json, 'all');
    expect(r.ok).toBe(true);
    a.setMonth(2026, 10);
    expect(a.currentSheet()!.cells[e1.id]).toEqual({ '1': 'X' });
    expect(a.get().employees).toHaveLength(2);
    const snaps = await a.listSnapshots();
    expect(snaps.some((s) => s.reason.includes('trước khi phục hồi'))).toBe(true);

    // Điểm khôi phục chứa trạng thái trước khi phục hồi → phục hồi ngược lại được
    const before = snaps.find((s) => s.reason.includes('trước khi phục hồi'))!;
    expect((await a.restoreSnapshot(before.id)).ok).toBe(true);
    expect(a.get().employees).toHaveLength(3);

    // Phục hồi một đơn vị không động đến đơn vị khác
    const unitBackup = JSON.parse(JSON.stringify((await a.exportBackup('unit')).data!));
    await setupUnit(a, 'HPR', 1);
    const hprId = a.get().unitId!;
    const cmr = a.get().units.find((u) => u.code === 'CMR')!;
    await a.selectUnit(cmr.id);
    await a.saveEmployee({ code: 'CMR100', fullName: 'Thêm nữa', position: '', department: '', status: 'active' });
    expect((await a.restore(unitBackup, 'unit')).ok).toBe(true);
    expect(a.get().employees).toHaveLength(3);
    await a.selectUnit(hprId);
    expect(a.get().employees).toHaveLength(1);
  });

  it('17. Chuyển đơn vị không lẫn dữ liệu; nhân bản cấu hình không mang dữ liệu cá nhân', async () => {
    const { a, store, repo } = await freshStore();
    const cmr = await setupUnit(a, 'CMR', 3);
    a.setMonth(2026, 10);
    await a.createSheet();
    await a.editCells([{ employeeId: a.get().employees[0].id, day: 1, value: 'X' }]);
    const hpr = await setupUnit(a, 'HPR', 2);
    expect(a.get().employees.every((e) => e.unitId === hpr.id)).toBe(true);
    expect(a.get().sheets).toHaveLength(0);
    expect(await repo.listEmployees(cmr.id)).toHaveLength(3);
    expect(await repo.listEmployees(hpr.id)).toHaveLength(2);

    // Mã NV có thể trùng giữa các đơn vị khác nhau, nhưng không trùng trong một đơn vị
    expect((await a.saveEmployee({ code: 'CMR001', fullName: 'Khác đơn vị', position: '', department: '', status: 'active' })).ok).toBe(true);

    // Sao lưu đơn vị chỉ chứa dữ liệu đơn vị đó
    const b = (await a.exportBackup('unit')).data!;
    expect(b.units.map((u) => u.code)).toEqual(['HPR']);
    expect(b.employees.every((e) => e.unitId === hpr.id)).toBe(true);

    // Nhân bản cấu hình CMR → DNR: có mã công, không có nhân sự/chấm công
    await a.selectUnit(cmr.id);
    const plan = (await a.planCloneCurrentUnit('DNR', 'Đài Đà Nẵng', false))!;
    expect(plan.errors).toEqual([]);
    expect(plan.employees).toHaveLength(0);
    expect(plan.sheets).toHaveLength(0);
    expect(plan.codes.length).toBe(a.get().codes.length);
    expect(plan.codes.every((c) => c.unitId === plan.unit.id)).toBe(true);
    expect((await a.planCloneCurrentUnit('HPR', 'x', false))!.errors[0]).toContain('đã tồn tại');
    expect((await a.applyUnitPlan(plan)).ok).toBe(true);
    expect(a.unit()!.code).toBe('DNR');
    expect(a.get().employees).toHaveLength(0);
    expect(await repo.listEmployees(cmr.id)).toHaveLength(3);

    // Người dùng chỉ được gán đơn vị HPR không thấy CMR
    await a.saveUser({ username: 'admin', displayName: 'QTV', role: 'admin', unitIds: [], active: true, password: 'matkhau-123' });
    await a.saveUser({ username: 'hpr', displayName: 'Lập HPR', role: 'lap', unitIds: [hpr.id], active: true, password: 'matkhau-456' });
    a.logout();
    expect((await a.login('hpr', 'sai-mat-khau')).ok).toBe(false);
    expect((await a.login('hpr', 'matkhau-456')).ok).toBe(true);
    expect(a.accessibleUnits().map((u) => u.code)).toEqual(['HPR']);
    expect(a.get().unitId).toBe(hpr.id);
    expect((await a.selectUnit(cmr.id)).ok).toBe(false);
    expect((await a.exportBackup('all')).ok).toBe(false);
    expect((await a.createUnit({ code: 'X1', name: 'x' })).ok).toBe(false);
    // Mật khẩu không lưu dạng văn bản thuần
    const users = await repo.listUsers();
    expect(JSON.stringify(users)).not.toContain('matkhau-456');
    expect(store.getState().session!.role).toBe('lap');
  });

  it('20. Danh sách nhân sự dài (500 người × 31 ngày) tính tổng hợp nhanh', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 0);
    const list = Array.from({ length: 500 }, (_, i) => ({ code: `NV${i}`, fullName: `Người ${i}`, position: '', department: '', status: 'active' as const }));
    const plan = { toCreate: list, toUpdate: [], unchanged: 0, errors: [], warnings: [] };
    expect((await a.importEmployees(plan)).ok).toBe(true);
    a.setMonth(2026, 10);
    await a.createSheet();
    const edits = a.get().employees.flatMap((e) => Array.from({ length: 31 }, (_, d) => ({ employeeId: e.id, day: d + 1, value: d % 7 ? 'X' : 'P' })));
    const t0 = performance.now();
    const r = await a.editCells(edits);
    expect(r.data!.applied).toHaveLength(15500);
    const u = a.unit()!;
    const sheet = a.currentSheet()!;
    const t1 = performance.now();
    const sum = computeSheetSummary(sheet, a.get().employees, makeContext(2026, 10, a.get().codes, u.codeGroups, u.calendar));
    const t2 = performance.now();
    expect(Object.keys(sum.rows)).toHaveLength(500);
    expect(sum.totalConverted).toBe(500 * 31);
    expect(t2 - t1).toBeLessThan(1500);
    expect(t1 - t0).toBeLessThan(5000);
  });
});
