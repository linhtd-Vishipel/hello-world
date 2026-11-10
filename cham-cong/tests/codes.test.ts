import { describe, expect, it } from 'vitest';
import { findCode, ruleAt } from '../src/domain/codes';
import { freshStore, setupUnit } from './helpers';

describe('Danh mục mã công', () => {
  it('9. Thêm mã mới, ngừng sử dụng mã cũ nhưng vẫn giữ dữ liệu lịch sử', async () => {
    const { a } = await freshStore();
    const u = await setupUnit(a, 'CMR', 1);
    const add = await a.saveCode({
      code: 'Đ1', name: 'Trực ca đêm', groupId: 'lam_viec', color: '#c7d2fe', rule: 'Ca 22h-6h', active: true,
      versions: [{ effectiveFrom: '2026-01', value: 1.5, countsInTotal: true, isActualWork: true }],
    });
    expect(add.ok).toBe(true);
    expect(findCode(a.get().codes, 'đ1')?.code).toBe('Đ1');

    const dupe = await a.saveCode({ code: 'x', name: 'Trùng', groupId: 'lam_viec', color: '#fff', rule: '', active: true, versions: [{ effectiveFrom: '2026-01', value: 1, countsInTotal: true, isActualWork: true }] });
    expect(dupe.ok).toBe(false);
    const bad = await a.saveCode({ code: 'A B', name: 'Sai', groupId: 'khong_co', color: '#fff', rule: '', active: true, versions: [] });
    expect(bad.ok).toBe(false);

    a.setMonth(2026, 10);
    await a.createSheet();
    const emp = a.get().employees[0];
    await a.editCells([{ employeeId: emp.id, day: 1, value: 'Đ1' }]);
    const d1 = a.get().codes.find((c) => c.code === 'Đ1')!;

    expect((await a.deleteCode(d1.id)).ok).toBe(false);
    expect((await a.setCodeActive(d1.id, false)).ok).toBe(true);
    expect(a.currentSheet()!.cells[emp.id]['1']).toBe('Đ1');
    const reject = await a.editCells([{ employeeId: emp.id, day: 2, value: 'Đ1' }]);
    expect(reject.data!.rejected[0].reason).toContain('ngừng sử dụng');

    // Không đổi ký hiệu của mã đã dùng
    const rename = await a.saveCode({ ...d1, active: false, code: 'D9' });
    expect(rename.ok).toBe(false);
    expect(u.codeGroups.length).toBeGreaterThan(0);
  });

  it('Quy tắc theo thời điểm hiệu lực và không áp đặt hệ số khi chưa xác nhận', async () => {
    const { a } = await freshStore();
    await a.createUnit({ code: 'HPR', name: 'Đài Hải Phòng' });
    await a.addSuggestedCodes(false, '2020-01');
    const x = a.get().codes.find((c) => c.code === 'X')!;
    expect(x.versions[0].value).toBeNull();
    await a.addCodeVersion(x.id, { effectiveFrom: '2026-07', value: 1, countsInTotal: true, isActualWork: true });
    const x2 = a.get().codes.find((c) => c.code === 'X')!;
    expect(ruleAt(x2, 2026, 6).value).toBeNull();
    expect(ruleAt(x2, 2026, 7).value).toBe(1);
    expect(ruleAt(x2, 2027, 1).value).toBe(1);
  });
});
