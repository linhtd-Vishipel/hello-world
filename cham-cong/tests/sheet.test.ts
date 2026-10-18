import { describe, expect, it } from 'vitest';
import { overwrittenCells, sheetCodes } from '../src/domain/sheet';
import { computeSheetSummary, makeContext } from '../src/domain/summary';
import { freshStore, setupUnit } from './helpers';

async function summaryOf(a: Awaited<ReturnType<typeof freshStore>>['a']) {
  const u = a.unit()!;
  const sheet = a.currentSheet()!;
  const ctx = makeContext(sheet.year, sheet.month, sheetCodes(sheet, a.get().codes), u.codeGroups, u.calendar);
  return computeSheetSummary(sheet, a.get().employees, ctx);
}

describe('Nhập công và tổng hợp', () => {
  it('10–11. Sửa mã công một ngày và tổng hợp được tính lại đúng', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 1);
    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    const edits = Array.from({ length: 20 }, (_, i) => ({ employeeId: emp.id, day: i + 1, value: 'X' }));
    edits.push({ employeeId: emp.id, day: 21, value: 'p' }, { employeeId: emp.id, day: 22, value: 'ô' }, { employeeId: emp.id, day: 23, value: 'CT' });
    const r = await a.editCells(edits);
    expect(r.ok).toBe(true);
    expect(a.currentSheet()!.cells[emp.id]['21']).toBe('P'); // chuẩn hóa ký hiệu
    let s = (await summaryOf(a)).rows[emp.id];
    expect(s.counts).toEqual({ X: 20, P: 1, Ô: 1, CT: 1 });
    expect(s.markedDays).toBe(23);
    expect(s.actualWorkDays).toBe(21); // X + CT
    expect(s.convertedTotal).toBe(22); // X + CT + P (Ô không tính)

    // Sửa ngày 1 từ X → KL
    await a.editCells([{ employeeId: emp.id, day: 1, value: 'KL' }], 'Điều chỉnh theo đơn xin nghỉ');
    s = (await summaryOf(a)).rows[emp.id];
    expect(s.counts.X).toBe(19);
    expect(s.counts.KL).toBe(1);
    expect(s.actualWorkDays).toBe(20);
    expect(s.convertedTotal).toBe(21);
    expect(s.explanation.join('\n')).toContain('KL (Nghỉ không hưởng lương) × 1: không tính vào tổng công');

    // Hoàn tác
    await a.undoLast();
    expect(a.currentSheet()!.cells[emp.id]['1']).toBe('X');
    const logs = await a.listAudit();
    expect(logs.some((l) => l.detail.includes('Điều chỉnh theo đơn xin nghỉ'))).toBe(true);
  });

  it('Hệ số lẻ cộng chính xác, mã chưa quy định hệ số bị cảnh báo', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 1);
    await a.saveCode({ code: 'X/2', name: 'Nửa công', groupId: 'lam_viec', color: '#fff', rule: '', active: true, versions: [{ effectiveFrom: '2020-01', value: 0.5, countsInTotal: true, isActualWork: true }] });
    await a.saveCode({ code: 'TC', name: 'Tăng ca', groupId: 'khac', color: '#fff', rule: '', active: true, versions: [{ effectiveFrom: '2020-01', value: null, countsInTotal: true, isActualWork: false }] });
    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([1, 2, 3].map((d) => ({ employeeId: emp.id, day: d, value: 'X/2' })).concat([{ employeeId: emp.id, day: 4, value: 'TC' }]));
    const s = (await summaryOf(a)).rows[emp.id];
    expect(s.convertedTotal).toBe(1.5);
    expect(s.issues.some((i) => i.kind === 'undefined_value' && i.value === 'TC')).toBe(true);
    expect(s.abnormal).toBe(true);
  });

  it('Chọn nhiều ô: phát hiện ô sẽ bị ghi đè để yêu cầu xác nhận', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 1);
    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([{ employeeId: emp.id, day: 3, value: 'P' }]);
    const bulk = [1, 2, 3, 4].map((d) => ({ employeeId: emp.id, day: d, value: 'X' }));
    expect(overwrittenCells(a.currentSheet()!, bulk)).toEqual([{ employeeId: emp.id, day: 3, value: 'X' }]);
  });

  it('18. Tháng đã khóa: không sửa được, giữ kết quả khi đổi quy tắc, chỉ quản trị mở khóa', async () => {
    const { a, store } = await freshStore();
    await setupUnit(a, 'CMR', 1);
    a.setMonth(2026, 9);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([1, 2, 3].map((d) => ({ employeeId: emp.id, day: d, value: 'X' })));
    expect((await a.lockSheet()).ok).toBe(true);
    const edit = await a.editCells([{ employeeId: emp.id, day: 4, value: 'X' }]);
    expect(edit.ok).toBe(false);
    expect(edit.message).toContain('khóa');
    expect((await a.setRowNote(emp.id, 'abc')).ok).toBe(false);

    // Đổi hệ số X từ 09/2026 → bảng khóa giữ nguyên kết quả theo ảnh chụp
    const x = a.get().codes.find((c) => c.code === 'X')!;
    const ver = await a.addCodeVersion(x.id, { effectiveFrom: '2026-09', value: 2, countsInTotal: true, isActualWork: true });
    expect(ver.data!.lockedUnaffected).toEqual(['09/2026']);
    expect((await summaryOf(a)).rows[emp.id].convertedTotal).toBe(3);

    // Đổi tên nhân sự không làm thay đổi bảng đã khóa
    await a.saveEmployee({ ...emp, fullName: 'Tên Sau Khi Khóa' });
    expect(a.currentSheet()!.lockSnapshot!.rows[0].fullName).toBe(emp.fullName);

    // Người kiểm tra không được mở khóa
    store.setState({ session: { ...store.getState().session!, role: 'kiem_tra' } });
    expect((await a.unlockSheet('sửa sai')).ok).toBe(false);
    store.setState({ session: { ...store.getState().session!, role: 'admin' } });
    expect((await a.unlockSheet('')).ok).toBe(false);
    expect((await a.unlockSheet('Điều chỉnh theo yêu cầu kế toán')).ok).toBe(true);
    expect((await summaryOf(a)).rows[emp.id].convertedTotal).toBe(6);
  });

  it('19. Phát hiện ô thiếu dữ liệu, mã không hợp lệ và ngoài thời gian làm việc', async () => {
    const { a, store } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    a.setMonth(2026, 10);
    await a.createSheet();
    const [e1, e2] = a.get().employees;
    // Ghi một mã không hợp lệ trực tiếp (vd dữ liệu cũ/khôi phục) để kiểm tra phát hiện
    const sheet = a.currentSheet()!;
    store.setState({ sheets: [{ ...sheet, cells: { [e1.id]: { '1': 'ZZ', '2': 'X' } } }] });
    await a.saveEmployee({ ...e2, startDate: '2026-10-10' });
    await a.editCells([{ employeeId: e2.id, day: 10, value: 'X' }]);
    const sum = await summaryOf(a);
    expect(sum.rows[e1.id].issues.some((i) => i.kind === 'invalid_code' && i.value === 'ZZ')).toBe(true);
    // Lịch trực ca (mặc định): mọi ngày trống đều là thiếu
    expect(sum.rows[e1.id].missingDays).toHaveLength(29);
    // e2 bắt đầu 10/10 → các ngày trước không tính thiếu
    expect(sum.rows[e2.id].missingDays).toHaveLength(21);
    expect(sum.invalidCells).toBe(1);
    expect(sum.abnormalEmployees).toBe(1);

    // Nhập từ chối mã không có trong danh mục
    const bad = await a.editCells([{ employeeId: e1.id, day: 3, value: 'QQ' }]);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('không có trong danh mục');

    // Lịch hành chính: cuối tuần không bị coi là thiếu
    const u = a.unit()!;
    await a.saveUnit({ ...u, calendar: { ...u.calendar, mode: 'hanh_chinh' } });
    const sum2 = await summaryOf(a);
    expect(sum2.rows[e1.id].missingDays).toHaveLength(22 - 2); // 22 ngày làm việc, đã ghi ngày 1 (T5) và 2 (T6)
  });
});
