import { describe, expect, it } from 'vitest';
import { isEligibleForMonth, validateEmployee } from '../src/domain/employees';
import { freshStore, setupUnit } from './helpers';

describe('Quản lý nhân sự', () => {
  it('6. Thêm nhân viên: tự đưa vào bảng tháng chưa khóa phù hợp, cảnh báo trùng mã', async () => {
    const { a, store } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    a.setMonth(2026, 10);
    await a.createSheet();
    expect(a.currentSheet()!.employeeIds).toHaveLength(2);

    const dup = await a.saveEmployee({ code: 'cmr001', fullName: 'Người khác', position: '', department: '', status: 'active' });
    expect(dup.ok).toBe(false);
    expect(dup.message).toContain('đã được dùng');

    // Bắt đầu làm việc từ 15/11/2026 → không đưa vào bảng tháng 10
    const later = await a.saveEmployee({ code: 'CMR010', fullName: 'Lê Văn Mới', position: '', department: '', status: 'active', startDate: '2026-11-15' });
    expect(later.ok).toBe(true);
    expect(later.data!.affected).toEqual([]);
    expect(a.currentSheet()!.employeeIds).toHaveLength(2);

    const now = await a.saveEmployee({ code: 'CMR011', fullName: 'Phạm Thị Nay', position: '', department: '', status: 'active' });
    expect(now.data!.affected).toEqual(['10/2026']);
    expect(a.currentSheet()!.employeeIds).toContain(now.data!.employee.id);
    expect(store.getState().employees).toHaveLength(4);
  });

  it('Cảnh báo trùng họ tên (bỏ dấu) là dữ liệu đáng ngờ', () => {
    const others = [{ id: '1', unitId: 'u', code: 'A1', fullName: 'Nguyễn Văn An', position: '', department: '', status: 'active' as const, order: 1, createdAt: '', updatedAt: '' }];
    const v = validateEmployee({ code: 'A2', fullName: 'nguyen van an', position: '', department: '', status: 'active' }, others);
    expect(v.errors).toEqual([]);
    expect(v.warnings[0]).toContain('trùng họ tên');
  });

  it('7. Đổi tên nhân viên nhưng giữ nguyên mã và dữ liệu chấm công', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 1);
    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([{ employeeId: emp.id, day: 1, value: 'X' }, { employeeId: emp.id, day: 2, value: 'P' }]);
    const r = await a.saveEmployee({ ...emp, fullName: 'Tên Mới Hoàn Toàn' });
    expect(r.ok).toBe(true);
    const sheet = a.currentSheet()!;
    expect(sheet.cells[emp.id]).toEqual({ '1': 'X', '2': 'P' });
    expect(a.get().employees[0].code).toBe(emp.code);
    expect(a.get().employees[0].fullName).toBe('Tên Mới Hoàn Toàn');
  });

  it('8. Ngừng làm việc: giữ lịch sử, không vào tháng sau, không xóa vật lý khi có dữ liệu', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([{ employeeId: emp.id, day: 5, value: 'X' }]);

    const preview = a.previewEmployee({ ...emp, status: 'inactive', endDate: '2026-10-20' });
    expect(preview.removed).toEqual([]);
    const r = await a.saveEmployee({ ...emp, status: 'inactive', endDate: '2026-10-20' });
    expect(r.ok).toBe(true);
    expect(a.currentSheet()!.employeeIds).toContain(emp.id);
    expect(a.currentSheet()!.cells[emp.id]['5']).toBe('X');

    const del = await a.deleteEmployee(emp.id);
    expect(del.ok).toBe(false);
    expect(del.message).toContain('10/2026');

    a.setMonth(2026, 11);
    await a.createSheet();
    expect(a.currentSheet()!.employeeIds).not.toContain(emp.id);
    expect(isEligibleForMonth(a.get().employees.find((e) => e.id === emp.id)!, 2026, 11)).toBe(false);

    // Nhân sự chưa có dữ liệu thì được xóa
    const other = a.get().employees.find((e) => e.id !== emp.id)!;
    expect((await a.deleteEmployee(other.id)).ok).toBe(true);
    expect(a.get().sheets.every((s) => !s.employeeIds.includes(other.id))).toBe(true);
  });
});
