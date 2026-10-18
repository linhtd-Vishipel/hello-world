import { formatMonth, isValidMonthKey, monthKey } from './calendar';
import type { AttendanceCode, CodeGroup, CodeRuleVersion, MonthSheet } from './types';
import { normKey, nowIso, uid } from './util';

export const DEFAULT_GROUPS: CodeGroup[] = [
  { id: 'lam_viec', name: 'Làm việc' },
  { id: 'nghi_huong_luong', name: 'Nghỉ hưởng lương' },
  { id: 'nghi_khong_luong', name: 'Nghỉ không hưởng lương' },
  { id: 'khac', name: 'Khác' },
];

/** Ký tự cho phép trong mã công: chữ (kể cả tiếng Việt), số và / + - . _ */
const CODE_PATTERN = /^[\p{L}\p{N}/+\-._]{1,10}$/u;

export function findCode(codes: AttendanceCode[], input: string): AttendanceCode | undefined {
  const raw = input.normalize('NFC').trim();
  if (!raw) return undefined;
  return codes.find((c) => c.code === raw) ?? codes.find((c) => normKey(c.code) === normKey(raw));
}

export type CodeDraft = Pick<AttendanceCode, 'code' | 'name' | 'groupId' | 'color' | 'rule' | 'active' | 'versions'> &
  Partial<Pick<AttendanceCode, 'id'>>;

export function validateCodeDraft(draft: CodeDraft, others: AttendanceCode[], groups: CodeGroup[]): string[] {
  const errors: string[] = [];
  const code = draft.code.normalize('NFC').trim();
  if (!code) errors.push('Mã viết tắt không được để trống.');
  else if (!CODE_PATTERN.test(code)) {
    errors.push('Mã chỉ gồm chữ, số hoặc ký hiệu / + - . _ (tối đa 10 ký tự, không khoảng trắng).');
  }
  if (!draft.name.trim()) errors.push('Tên đầy đủ không được để trống.');
  if (!groups.some((g) => g.id === draft.groupId)) errors.push('Nhóm công không hợp lệ.');
  const dup = others.find((c) => c.id !== draft.id && normKey(c.code) === normKey(code));
  if (code && dup) errors.push(`Mã "${code}" trùng với mã đã có "${dup.code}" (${dup.name}).`);
  if (!draft.versions.length) errors.push('Cần ít nhất một quy tắc tính.');
  const seen = new Set<string>();
  for (const v of draft.versions) {
    if (!isValidMonthKey(v.effectiveFrom)) errors.push(`Tháng hiệu lực không hợp lệ: ${v.effectiveFrom}`);
    if (seen.has(v.effectiveFrom)) errors.push(`Trùng tháng hiệu lực ${v.effectiveFrom}.`);
    seen.add(v.effectiveFrom);
    if (v.value !== null && (!Number.isFinite(v.value) || v.value < 0 || v.value > 10)) {
      errors.push(`Giá trị quy đổi không hợp lệ (${v.value}).`);
    }
  }
  return errors;
}

export function sortVersions(versions: CodeRuleVersion[]): CodeRuleVersion[] {
  return [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Quy tắc có hiệu lực cho tháng: phiên bản mới nhất có effectiveFrom ≤ tháng. */
export function ruleAt(code: AttendanceCode, year: number, month: number): CodeRuleVersion {
  const key = monthKey(year, month);
  const sorted = sortVersions(code.versions);
  let found = sorted[0];
  for (const v of sorted) if (v.effectiveFrom <= key) found = v;
  return found;
}

/** Thêm/cập nhật phiên bản quy tắc theo tháng hiệu lực (không sửa các phiên bản cũ). */
export function upsertVersion(code: AttendanceCode, version: CodeRuleVersion): AttendanceCode {
  const versions = code.versions.filter((v) => v.effectiveFrom !== version.effectiveFrom);
  versions.push(version);
  return { ...code, versions: sortVersions(versions), updatedAt: nowIso() };
}

export function codeUsage(code: AttendanceCode, sheets: MonthSheet[]): { months: string[]; lockedMonths: string[]; cells: number } {
  let cells = 0;
  const months: string[] = [];
  const lockedMonths: string[] = [];
  for (const s of sheets) {
    let n = 0;
    for (const row of Object.values(s.cells)) {
      for (const v of Object.values(row)) if (v && normKey(v) === normKey(code.code)) n++;
    }
    if (n) {
      cells += n;
      months.push(formatMonth(s.year, s.month));
      if (s.locked) lockedMonths.push(formatMonth(s.year, s.month));
    }
  }
  return { months, lockedMonths, cells };
}

/** Bảng đã khóa có tháng ≥ thời điểm hiệu lực: kết quả được giữ theo ảnh chụp lúc khóa. */
export function lockedSheetsFrom(effectiveFrom: string, sheets: MonthSheet[]): string[] {
  return sheets
    .filter((s) => s.locked && monthKey(s.year, s.month) >= effectiveFrom)
    .map((s) => formatMonth(s.year, s.month));
}

export interface SuggestedCode {
  code: string;
  name: string;
  groupId: string;
  color: string;
  value: number;
  countsInTotal: boolean;
  isActualWork: boolean;
}

/** Bộ mã gợi ý – chỉ là ví dụ, người dùng phải xác nhận trước khi áp dụng hệ số. */
export const SUGGESTED_CODES: SuggestedCode[] = [
  { code: 'X', name: 'Công làm việc bình thường', groupId: 'lam_viec', color: '#dcfce7', value: 1, countsInTotal: true, isActualWork: true },
  { code: 'CT', name: 'Công tác', groupId: 'lam_viec', color: '#dbeafe', value: 1, countsInTotal: true, isActualWork: true },
  { code: 'P', name: 'Nghỉ phép', groupId: 'nghi_huong_luong', color: '#fef9c3', value: 1, countsInTotal: true, isActualWork: false },
  { code: 'NL', name: 'Nghỉ lễ', groupId: 'nghi_huong_luong', color: '#fee2e2', value: 1, countsInTotal: true, isActualWork: false },
  { code: 'Ô', name: 'Nghỉ ốm', groupId: 'nghi_khong_luong', color: '#ffedd5', value: 0, countsInTotal: false, isActualWork: false },
  { code: 'KL', name: 'Nghỉ không hưởng lương', groupId: 'nghi_khong_luong', color: '#e5e7eb', value: 0, countsInTotal: false, isActualWork: false },
];

export function makeCode(
  unitId: string,
  s: SuggestedCode,
  order: number,
  effectiveFrom: string,
  applyValues: boolean,
): AttendanceCode {
  const t = nowIso();
  return {
    id: uid('code'),
    unitId,
    code: s.code,
    name: s.name,
    groupId: s.groupId,
    color: s.color,
    rule: '',
    active: true,
    order,
    versions: [
      {
        effectiveFrom,
        value: applyValues ? s.value : null,
        countsInTotal: s.countsInTotal,
        isActualWork: s.isActualWork,
      },
    ],
    createdAt: t,
    updatedAt: t,
  };
}

/** Mã COUNTIF an toàn: thoát ký tự đại diện * ? ~ của Excel. */
export function excelCriteria(code: string): string {
  return code.replace(/[~*?]/g, (m) => `~${m}`).replace(/"/g, '""');
}
