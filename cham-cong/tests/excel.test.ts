import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../src/excel/base64';
import { buildSampleTemplate } from '../src/excel/template';
import { exportAttendanceXlsx, exportEmployeesXlsx, exportFileName, ROW_HEADER_START } from '../src/excel/export';
import { parseAttendanceWorkbook, parseEmployeeWorkbook, planAttendanceImport, planEmployeeImport } from '../src/excel/import';
import { freshStore, setupUnit } from './helpers';

async function load(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

async function prepared() {
  const ctx = await freshStore();
  const { a } = ctx;
  const u = await setupUnit(a, 'CMR', 3);
  await a.saveUnit({
    ...u,
    template: {
      ...u.template,
      place: 'Cà Mau',
      signers: [
        { title: 'Người lập biểu', name: 'Trần Văn Lập' },
        { title: 'Phụ trách bộ phận', name: 'Lê Thị Kiểm' },
        { title: 'Giám đốc', name: 'Nguyễn Văn Duyệt' },
      ],
    },
    calendar: { ...u.calendar, holidays: [{ date: '2026-10-20', name: 'Ngày lễ đơn vị', kind: 'nghi_don_vi' }] },
  });
  a.setMonth(2026, 10);
  await a.createSheet();
  const [e1, e2] = a.get().employees;
  await a.editCells([
    ...Array.from({ length: 20 }, (_, i) => ({ employeeId: e1.id, day: i + 1, value: 'X' })),
    { employeeId: e1.id, day: 21, value: 'P' },
    { employeeId: e1.id, day: 22, value: 'Ô' },
    { employeeId: e2.id, day: 1, value: 'CT' },
  ]);
  await a.setRowNote(e1.id, 'Đủ công');
  await a.setCellNote(e1.id, 21, 'Phép năm');
  const input = { unit: a.unit()!, sheet: a.currentSheet()!, employees: a.get().employees, codes: a.get().codes };
  return { ...ctx, input, e1, e2 };
}

describe('Xuất Excel', () => {
  it('14. Xuất Excel đúng dữ liệu, định dạng và thiết lập in trình ký', async () => {
    const { input, e1 } = await prepared();
    expect(exportFileName(input.unit, 2026, 10)).toBe('Bang_cham_cong_CMR202610.xlsx');
    const bytes = await exportAttendanceXlsx(input);
    const wb = await load(bytes);
    const ws = wb.getWorksheet('Bang cham cong')!;
    expect(ws).toBeDefined();
    expect(ws.getCell('A2').value).toBe('Đơn vị: Đài TTDH CMR');
    expect(ws.getCell('A4').value).toBe('BẢNG CHẤM CÔNG');
    expect(ws.getCell('A5').value).toBe('Tháng 10 năm 2026');
    const h = ROW_HEADER_START;
    expect(ws.getCell(h, 1).value).toBe('STT');
    expect(ws.getCell(h, 3).value).toBe('Họ và tên');
    // Cột ngày: E..AI (có cột Chức vụ)
    expect(ws.getCell(h + 1, 5).value).toBe(1);
    expect(ws.getCell(h + 1, 35).value).toBe(31);
    expect(ws.getCell(h + 2, 5).value).toBe('T5');
    expect(ws.getCell(h + 2, 5 + 17).value).toBe('CN');
    expect(ws.getCell(h + 2, 5 + 17).fill).toMatchObject({ fgColor: { argb: 'FFE5E7EB' } });
    expect(ws.getCell(h + 1, 5 + 19).fill).toMatchObject({ fgColor: { argb: 'FFFECACA' } }); // ngày 20 – ngày nghỉ đơn vị
    const r = h + 3;
    expect(ws.getCell(r, 2).value).toBe(e1.code);
    expect(ws.getCell(r, 5).value).toBe('X');
    expect(ws.getCell(r, 5 + 20).value).toBe('P');
    expect(ws.getCell(r, 5 + 20).note).toBeDefined();
    expect(ws.getCell(r, 5).border.top?.style).toBe('thin');
    // Cột tổng hợp: X, CT, P, NL, Ô, KL
    expect(ws.getCell(h + 1, 36).value).toBe('X');
    const xCell = ws.getCell(r, 36).value as ExcelJS.CellFormulaValue;
    expect(xCell.formula).toBe('COUNTIF(E10:AI10,"X")');
    expect(xCell.result).toBe(20);
    const work = ws.getCell(r, 42).value as ExcelJS.CellFormulaValue;
    expect(work.result).toBe(20);
    const total = ws.getCell(r, 43).value as ExcelJS.CellFormulaValue;
    expect(total.formula).toContain('COUNTIF(E10:AI10,"P")*1');
    expect(total.result).toBe(21);
    expect(ws.getCell(r, 44).value).toBe('Đủ công');
    // Gộp ô tiêu đề
    const merges = (ws.model as unknown as { merges: string[] }).merges;
    expect(merges).toContain('A7:A9');
    expect(merges).toContain('E7:AI7');
    // Thiết lập in
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.printTitlesRow).toBe('7:9');
    expect(ws.pageSetup.printArea).toMatch(/^A1:AR\d+$/);
    // Khối ký
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && texts.push(c.value)));
    expect(texts).toContain('Người lập biểu');
    expect(texts).toContain('Nguyễn Văn Duyệt');
    expect(texts.some((t) => t.startsWith('Cà Mau, ngày'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Ký hiệu chấm công'))).toBe(true);
    expect(ws.getCell(r, 1).font.name).toBe('Times New Roman');
    // Trang tổng hợp
    const sum = wb.getWorksheet('Tong hop')!;
    expect(sum.getCell(4, 3).value).toBe(e1.fullName);
  });

  it('Xuất theo mẫu Excel riêng của Đài (placeholder + ô neo, khối ký được dời xuống)', async () => {
    const { a, input } = await prepared();
    const tpl = new ExcelJS.Workbook();
    const ws = tpl.addWorksheet('Mau');
    ws.getCell('A1').value = '{{CO_QUAN_CHU_QUAN}}';
    ws.getCell('A2').value = 'ĐƠN VỊ: {{TEN_DON_VI}}';
    ws.getCell('A3').value = 'BẢNG CHẤM CÔNG THÁNG {{THANG}}/{{NAM}}';
    ws.getCell('A5').value = '{{BANG_CHAM_CONG}}';
    ws.getCell('B7').value = '{{CHUC_DANH_KY_3}}';
    ws.mergeCells('B7:E7');
    ws.getCell('B10').value = '{{TEN_KY_3}}';
    const tplBytes = new Uint8Array((await tpl.xlsx.writeBuffer()) as ArrayBuffer);
    const unit = { ...input.unit, template: { ...input.unit.template, customTemplate: { fileName: 'mau.xlsx', dataBase64: bytesToBase64(tplBytes), uploadedAt: '' } } };
    expect((await a.saveUnit(unit)).ok).toBe(true);
    const out = await load(await exportAttendanceXlsx({ ...input, unit }));
    const s = out.worksheets[0];
    expect(s.getCell('A2').value).toBe('ĐƠN VỊ: Đài TTDH CMR');
    expect(s.getCell('A3').value).toBe('BẢNG CHẤM CÔNG THÁNG 10/2026');
    expect(s.getCell('A5').value).toBe('STT');
    // lưới: 3 dòng tiêu đề (5–7) + 3 nhân sự (8–10) → dời 5 dòng
    expect(s.getCell('B12').value).toBe('Giám đốc');
    expect(s.getCell('B15').value).toBe('Nguyễn Văn Duyệt');
    expect((s.model as unknown as { merges: string[] }).merges).toContain('B12:E12');
    expect(s.pageSetup.printTitlesRow).toBe('5:7');
  });

  it('File mẫu placeholder tải từ ứng dụng dùng được ngay làm mẫu xuất', async () => {
    const { input } = await prepared();
    const tpl = await buildSampleTemplate();
    const unit = { ...input.unit, template: { ...input.unit.template, customTemplate: { fileName: 'm.xlsx', dataBase64: bytesToBase64(tpl), uploadedAt: '' } } };
    const out = await load(await exportAttendanceXlsx({ ...input, unit }));
    expect(out.worksheets.map((w) => w.name)).toEqual(['Mau bang cham cong', 'Tong hop']);
    const s = out.worksheets[0];
    expect(s.getCell('A2').value).toBe('Đài TTDH CMR');
    expect(s.getCell('A7').value).toBe('STT');
    // khối ký dời xuống: dòng 9 cũ → 9 + (3 tiêu đề + 3 nhân sự − 1)
    expect(s.getCell('AC14').value).toBe('Giám đốc');
    expect(s.getCell('AC19').value).toBe('Nguyễn Văn Duyệt');
  });

  it('Xuất bảng đã khóa dùng tên tại thời điểm khóa; đơn vị mẫu được ghi rõ', async () => {
    const { a, e1 } = await prepared();
    await a.lockSheet();
    await a.saveEmployee({ ...e1, fullName: 'Đổi Tên Sau' });
    const out = await load(await exportAttendanceXlsx({ unit: a.unit()!, sheet: a.currentSheet()!, employees: a.get().employees, codes: a.get().codes }));
    expect(out.worksheets[0].getCell(ROW_HEADER_START + 3, 3).value).toBe(e1.fullName);
    await a.createSampleUnit();
    a.setMonth(2026, 10);
    const sample = await load(await exportAttendanceXlsx({ unit: a.unit()!, sheet: a.currentSheet()!, employees: a.get().employees, codes: a.get().codes }));
    expect(String(sample.worksheets[0].getCell('A4').value)).toContain('DỮ LIỆU MẪU');
  });
});

describe('Nhập Excel', () => {
  it('12. Nhập file hợp lệ: xem trước, chọn chế độ, chỉ ghi khi xác nhận, có điểm khôi phục', async () => {
    const { a, input, e1, e2 } = await prepared();
    // Xuất tháng 10 rồi nhập vào tháng 11 (khứ hồi)
    const bytes = await exportAttendanceXlsx(input);
    const parsed = await parseAttendanceWorkbook(bytes);
    expect(parsed.detectedMonth).toBe(10);
    expect(parsed.detectedYear).toBe(2026);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0].cells[1]).toBe('X');

    a.setMonth(2026, 11);
    await a.createSheet();
    await a.editCells([{ employeeId: e1.id, day: 1, value: 'KL' }]);
    const sheet = a.currentSheet()!;
    const addPlan = planAttendanceImport(parsed, sheet, a.get().employees, a.get().codes, 'add');
    expect(addPlan.monthMismatch).toContain('10/2026');
    expect(addPlan.overwrites).toBe(0);
    expect(addPlan.edits.some((e) => e.employeeId === e1.id && e.day === 1)).toBe(false);
    // Tháng 11 có 30 ngày → ngày 31 trong file bị bỏ qua
    expect(addPlan.extraDays).toEqual([31]);
    // Chưa xác nhận → chưa ghi
    expect(a.currentSheet()!.cells[e1.id]).toEqual({ '1': 'KL' });

    const upd = planAttendanceImport(parsed, sheet, a.get().employees, a.get().codes, 'update');
    expect(upd.overwrites).toBe(1);
    const res = await a.applyAttendanceImport(upd);
    expect(res.ok).toBe(true);
    expect(a.currentSheet()!.cells[e1.id]['1']).toBe('X');
    expect(a.currentSheet()!.cells[e1.id]['22']).toBe('Ô');
    expect(a.currentSheet()!.cells[e2.id]).toEqual({ '1': 'CT' });
    expect((await a.listSnapshots()).some((s) => s.reason.includes('Trước khi nhập Excel'))).toBe(true);

    // Chế độ thay thế xóa ô không có trong file
    await a.editCells([{ employeeId: e2.id, day: 5, value: 'P' }]);
    const rep = planAttendanceImport(parsed, a.currentSheet()!, a.get().employees, a.get().codes, 'replace');
    await a.applyAttendanceImport(rep);
    expect(a.currentSheet()!.cells[e2.id]).toEqual({ '1': 'CT' });
  });

  it('13. File có mã nhân viên không tồn tại và mã công không hợp lệ', async () => {
    const { a, e1 } = await freshStore().then(async (c) => {
      await setupUnit(c.a, 'CMR', 2);
      c.a.setMonth(2026, 2);
      await c.a.createSheet();
      return { ...c, e1: c.a.get().employees[0] };
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'BẢNG CHẤM CÔNG THÁNG 02/2026';
    ws.getRow(3).values = ['STT', 'Mã nhân viên', 'Họ và tên', ...Array.from({ length: 28 }, (_, i) => i + 1)];
    ws.getRow(4).values = [1, e1.code, e1.fullName, 'X', 'x', 'ZZ', 'P'];
    ws.getRow(5).values = [2, 'KHONGCO', 'Người lạ', 'X'];
    ws.getRow(6).values = [3, e1.code, 'Lặp lại', 'X'];
    ws.getRow(7).values = [4, '', 'Thiếu mã', 'X'];
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const parsed = await parseAttendanceWorkbook(bytes);
    const plan = planAttendanceImport(parsed, a.currentSheet()!, a.get().employees, a.get().codes, 'update');
    expect(plan.unknownEmployees).toEqual([{ rowNumber: 5, code: 'KHONGCO', name: 'Người lạ' }]);
    expect(plan.duplicateRows).toEqual([{ rowNumber: 6, code: e1.code }]);
    expect(plan.invalidCells).toEqual([{ rowNumber: 4, code: e1.code, day: 3, value: 'ZZ', reason: 'Mã không có trong danh mục' }]);
    expect(parsed.warnings.some((w) => w.includes('thiếu mã nhân viên'))).toBe(true);
    expect(plan.edits).toHaveLength(3);
    expect(plan.monthMismatch).toBeUndefined();
    await a.applyAttendanceImport(plan);
    expect(a.currentSheet()!.cells[e1.id]).toEqual({ '1': 'X', '2': 'X', '4': 'P' });

    // File không phải bảng chấm công
    const bad = new ExcelJS.Workbook();
    bad.addWorksheet('x').getCell('A1').value = 'abc';
    await expect(parseAttendanceWorkbook(new Uint8Array((await bad.xlsx.writeBuffer()) as ArrayBuffer))).rejects.toThrow('Không nhận diện');
    await expect(parseAttendanceWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('Nhập/xuất danh sách nhân sự từ Excel', async () => {
    const { a } = await freshStore();
    await setupUnit(a, 'CMR', 2);
    const bytes = await exportEmployeesXlsx(a.unit()!, a.get().employees);
    const back = await parseEmployeeWorkbook(bytes);
    expect(back.rows).toHaveLength(2);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('NS');
    ws.getRow(1).values = ['Mã NV', 'Họ và tên', 'Chức vụ', 'Bộ phận', 'Ngày bắt đầu', 'Trạng thái'];
    ws.getRow(2).values = ['CMR001', 'Tên Cập Nhật', 'Trưởng ca', 'Tổ KT', '01/03/2025', 'Đang làm việc'];
    ws.getRow(3).values = ['CMR050', 'Người Mới', 'KTV', 'Tổ KT', '2026-10-01', ''];
    ws.getRow(4).values = ['CMR050', 'Lặp', '', '', '', ''];
    ws.getRow(5).values = ['CMR051', 'Ngày sai', '', '', '31/02/2026', ''];
    const parsed = await parseEmployeeWorkbook(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));
    const plan = planEmployeeImport(parsed.rows, a.get().employees, 'upsert');
    expect(plan.toCreate.map((d) => d.code)).toEqual(['CMR050', 'CMR051']);
    expect(plan.toUpdate[0].changes.join(' ')).toContain('Tên Cập Nhật');
    expect(plan.toUpdate[0].draft.startDate).toBe('2025-03-01');
    expect(plan.errors.map((e) => e.rowNumber)).toEqual([4, 5]);
    const addOnly = planEmployeeImport(parsed.rows, a.get().employees, 'add');
    expect(addOnly.toUpdate).toHaveLength(0);
    const r = await a.importEmployees(plan);
    expect(r.data).toMatchObject({ created: 2, updated: 1 });
    expect(a.get().employees.find((e) => e.code === 'CMR001')!.fullName).toBe('Tên Cập Nhật');
  });
});
