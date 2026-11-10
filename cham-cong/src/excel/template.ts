import ExcelJS from 'exceljs';

/** Tạo file mẫu Excel có placeholder để đơn vị chỉnh theo biểu mẫu đã phê duyệt. */
export async function buildSampleTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mau bang cham cong');
  const f = { name: 'Times New Roman', size: 11 };
  const put = (addr: string, v: string, extra: Partial<ExcelJS.Font> = {}, merge?: string) => {
    if (merge) ws.mergeCells(merge);
    const c = ws.getCell(addr);
    c.value = v;
    c.font = { ...f, ...extra };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  };
  put('A1', '{{CO_QUAN_CHU_QUAN}}', {}, 'A1:J1');
  put('A2', '{{TEN_DON_VI}}', { bold: true }, 'A2:J2');
  put('AA1', 'Mẫu số 01a-LĐTL', { bold: true }, 'AA1:AJ1');
  put('A4', '{{TIEU_DE}}', { bold: true, size: 16 }, 'A4:AR4');
  put('A5', 'Tháng {{THANG}} năm {{NAM}}', { italic: true }, 'A5:AR5');
  ws.getCell('A7').value = '{{BANG_CHAM_CONG}}';
  put('A9', '{{CHUC_DANH_KY_1}}', { bold: true }, 'A9:M9');
  put('N9', '{{CHUC_DANH_KY_2}}', { bold: true }, 'N9:AB9');
  put('AC9', '{{CHUC_DANH_KY_3}}', { bold: true }, 'AC9:AR9');
  put('A10', '(Ký, ghi rõ họ tên)', { italic: true }, 'A10:M10');
  put('N10', '(Ký, ghi rõ họ tên)', { italic: true }, 'N10:AB10');
  put('AC10', '(Ký, ghi rõ họ tên)', { italic: true }, 'AC10:AR10');
  put('A14', '{{TEN_KY_1}}', { bold: true }, 'A14:M14');
  put('N14', '{{TEN_KY_2}}', { bold: true }, 'N14:AB14');
  put('AC14', '{{TEN_KY_3}}', { bold: true }, 'AC14:AR14');
  const guide = wb.addWorksheet('Huong dan');
  [
    'HƯỚNG DẪN SỬ DỤNG MẪU',
    'Trang tính đầu tiên là biểu mẫu. Ô chứa {{BANG_CHAM_CONG}} là vị trí góc trên-trái của bảng chấm công (3 dòng tiêu đề + dữ liệu).',
    'Nội dung phía dưới ô neo (khối ký) sẽ tự dời xuống ngay sau bảng.',
    'Placeholder hỗ trợ: {{CO_QUAN_CHU_QUAN}} {{TEN_DON_VI}} {{MA_DON_VI}} {{TIEU_DE}} {{THANG}} {{NAM}} {{SO_NHAN_SU}}',
    '{{CHUC_DANH_KY_1..3}} {{TEN_KY_1..3}} lấy từ cấu hình người ký của đơn vị.',
    'Trang "Huong dan" này có thể xóa trước khi tải mẫu lên.',
  ].forEach((t, i) => (guide.getCell(i + 1, 1).value = t));
  guide.getColumn(1).width = 120;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
