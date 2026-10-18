import { DEFAULT_GROUPS } from './codes';
import type { ExcelTemplateConfig, Unit } from './types';
import { deepClone, normKey, nowIso, uid } from './util';

export const DEFAULT_TEMPLATE: ExcelTemplateConfig = {
  formCode: 'Mẫu số 01a-LĐTL',
  formNote: '(Ban hành theo quy định hiện hành)',
  title: 'BẢNG CHẤM CÔNG',
  place: '',
  paperSize: 'auto',
  orientation: 'landscape',
  fontName: 'Times New Roman',
  fontSize: 10,
  weekendColor: '#E5E7EB',
  holidayColor: '#FECACA',
  showLegend: true,
  showPosition: true,
  includeSummarySheet: true,
  fileNamePattern: 'Bang_cham_cong_{MaDonVi}{YYYY}{MM}',
  signers: [
    { title: 'Người lập biểu', name: '' },
    { title: 'Phụ trách bộ phận', name: '' },
    { title: 'Giám đốc', name: '' },
  ],
};

export function newUnit(input: { code: string; name: string; parentOrg?: string; startYear?: number; isSample?: boolean }): Unit {
  const t = nowIso();
  return {
    id: uid('unit'),
    code: input.code.trim(),
    name: input.name.trim(),
    parentOrg: input.parentOrg?.trim() ?? '',
    address: '',
    startYear: input.startYear ?? new Date().getFullYear(),
    calendar: { mode: 'truc_ca', weekendDays: [0, 6], holidays: [] },
    codeGroups: deepClone(DEFAULT_GROUPS),
    template: deepClone(DEFAULT_TEMPLATE),
    isSample: !!input.isSample,
    createdAt: t,
    updatedAt: t,
  };
}

export function validateUnit(u: Pick<Unit, 'id' | 'code' | 'name' | 'startYear'>, others: Unit[]): string[] {
  const errors: string[] = [];
  if (!u.code.trim()) errors.push('Mã đơn vị không được để trống.');
  else if (!/^[A-Za-z0-9_-]{1,20}$/.test(u.code.trim())) errors.push('Mã đơn vị chỉ gồm chữ không dấu, số, - và _ (dùng trong tên file).');
  if (!u.name.trim()) errors.push('Tên Đài không được để trống.');
  if (!Number.isInteger(u.startYear) || u.startYear < 1900 || u.startYear > 2100) errors.push('Năm bắt đầu sử dụng không hợp lệ.');
  if (others.some((o) => o.id !== u.id && normKey(o.code) === normKey(u.code))) errors.push(`Mã đơn vị "${u.code}" đã tồn tại.`);
  return errors;
}
