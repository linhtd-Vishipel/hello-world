import { sheetId } from './calendar';
import type { AttendanceCode, BackupFile, Employee, MonthSheet, Unit } from './types';
import { deepClone, normKey, nowIso, uid } from './util';

export interface BackupPreview {
  ok: boolean;
  errors: string[];
  scope: 'all' | 'unit';
  createdAt: string;
  units: { id: string; code: string; name: string; employees: number; codes: number; sheets: number; isSample: boolean }[];
}

export function validateBackup(data: unknown): { backup?: BackupFile; preview: BackupPreview } {
  const errors: string[] = [];
  const b = data as Partial<BackupFile>;
  const empty: BackupPreview = { ok: false, errors, scope: 'all', createdAt: '', units: [] };
  if (!b || typeof b !== 'object' || b.format !== 'cham-cong-backup') {
    errors.push('File không phải bản sao lưu của ứng dụng chấm công.');
    return { preview: empty };
  }
  if (b.version !== 1) errors.push(`Phiên bản sao lưu không hỗ trợ: ${String(b.version)}`);
  for (const k of ['units', 'employees', 'codes', 'sheets'] as const) {
    if (!Array.isArray(b[k])) errors.push(`Thiếu dữ liệu "${k}".`);
  }
  if (errors.length) return { preview: empty };
  const unitIds = new Set(b.units!.map((u) => u.id));
  const orphan = [...b.employees!, ...b.codes!, ...b.sheets!].filter((r) => !unitIds.has(r.unitId));
  if (orphan.length) errors.push(`${orphan.length} bản ghi không thuộc đơn vị nào trong file.`);
  for (const s of b.sheets!) {
    if (s.id !== sheetId(s.unitId, s.year, s.month)) errors.push(`Bảng chấm công có khóa không hợp lệ: ${s.id}`);
  }
  if (b.scope === 'unit' && b.units!.length !== 1) errors.push('Bản sao lưu đơn vị phải chứa đúng 1 đơn vị.');
  const preview: BackupPreview = {
    ok: errors.length === 0,
    errors,
    scope: b.scope === 'unit' ? 'unit' : 'all',
    createdAt: b.createdAt ?? '',
    units: b.units!.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      isSample: !!u.isSample,
      employees: b.employees!.filter((e) => e.unitId === u.id).length,
      codes: b.codes!.filter((c) => c.unitId === u.id).length,
      sheets: b.sheets!.filter((s) => s.unitId === u.id).length,
    })),
  };
  return { backup: errors.length ? undefined : ({ audit: [], ...b } as BackupFile), preview };
}

// ---------- Cấu hình đơn vị (chuyển giao giữa các bản cài đặt)

export interface UnitConfigFile {
  format: 'cham-cong-unit-config';
  version: 1;
  createdAt: string;
  unit: Unit;
  codes: AttendanceCode[];
  employees?: Employee[];
  sheets?: MonthSheet[];
}

export function buildUnitConfig(
  unit: Unit,
  codes: AttendanceCode[],
  employees: Employee[],
  sheets: MonthSheet[],
  opts: { includeEmployees: boolean; includeAttendance: boolean },
): UnitConfigFile {
  const file: UnitConfigFile = {
    format: 'cham-cong-unit-config',
    version: 1,
    createdAt: nowIso(),
    unit: deepClone(unit),
    codes: deepClone(codes.filter((c) => c.unitId === unit.id)),
  };
  if (opts.includeEmployees || opts.includeAttendance) file.employees = deepClone(employees.filter((e) => e.unitId === unit.id));
  if (opts.includeAttendance) file.sheets = deepClone(sheets.filter((s) => s.unitId === unit.id));
  return file;
}

export interface ConfigImportPlan {
  errors: string[];
  warnings: string[];
  unit: Unit;
  codes: AttendanceCode[];
  employees: Employee[];
  sheets: MonthSheet[];
}

/**
 * Tạo đơn vị mới từ file cấu hình hoặc từ đơn vị mẫu. Luôn cấp khóa mới cho mọi bản ghi
 * để không đụng chạm dữ liệu của đơn vị nguồn trong cùng bản cài đặt.
 */
export function planUnitFromConfig(
  file: UnitConfigFile,
  existingUnits: Unit[],
  opts: { code: string; name: string; includeEmployees: boolean; includeAttendance: boolean },
): ConfigImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (file?.format !== 'cham-cong-unit-config' || file.version !== 1) {
    errors.push('File không phải cấu hình đơn vị hợp lệ.');
  }
  if (!opts.code.trim()) errors.push('Cần nhập mã đơn vị mới.');
  if (existingUnits.some((u) => normKey(u.code) === normKey(opts.code))) errors.push(`Mã đơn vị "${opts.code}" đã tồn tại.`);
  const t = nowIso();
  const newUnitId = uid('unit');
  const unit: Unit = {
    ...deepClone(file.unit),
    id: newUnitId,
    code: opts.code.trim(),
    name: opts.name.trim() || file.unit?.name || '',
    isSample: false,
    createdAt: t,
    updatedAt: t,
  };
  // Người ký là thông tin riêng của đơn vị nguồn: xóa tên, giữ chức danh.
  unit.template = { ...unit.template, signers: unit.template.signers.map((s) => ({ title: s.title, name: '' })) };

  const seenCodes = new Map<string, string>();
  const codes = (file.codes ?? []).map((c) => {
    const k = normKey(c.code);
    if (seenCodes.has(k)) errors.push(`Mã công trùng trong file: "${c.code}" và "${seenCodes.get(k)}".`);
    seenCodes.set(k, c.code);
    return { ...deepClone(c), id: uid('code'), unitId: newUnitId };
  });

  const idMap = new Map<string, string>();
  let employees: Employee[] = [];
  if (opts.includeEmployees || opts.includeAttendance) {
    const seenEmp = new Set<string>();
    employees = (file.employees ?? []).map((e) => {
      const k = normKey(e.code);
      if (seenEmp.has(k)) errors.push(`Mã nhân viên trùng trong file: "${e.code}".`);
      seenEmp.add(k);
      const id = uid('emp');
      idMap.set(e.id, id);
      return { ...deepClone(e), id, unitId: newUnitId };
    });
    if (!file.employees?.length) warnings.push('File không có danh sách nhân sự.');
  }
  let sheets: MonthSheet[] = [];
  if (opts.includeAttendance) {
    sheets = (file.sheets ?? []).map((s) => {
      const remap = <T,>(rec: Record<string, T>) =>
        Object.fromEntries(Object.entries(rec).filter(([k]) => idMap.has(k)).map(([k, v]) => [idMap.get(k)!, v]));
      const snap = s.lockSnapshot
        ? {
            ...deepClone(s.lockSnapshot),
            rows: s.lockSnapshot.rows.map((r) => ({ ...r, employeeId: idMap.get(r.employeeId) ?? r.employeeId })),
          }
        : undefined;
      return {
        ...deepClone(s),
        id: sheetId(newUnitId, s.year, s.month),
        unitId: newUnitId,
        employeeIds: s.employeeIds.filter((id) => idMap.has(id)).map((id) => idMap.get(id)!),
        cells: remap(s.cells),
        cellNotes: remap(s.cellNotes),
        rowNotes: remap(s.rowNotes),
        lockSnapshot: snap,
      };
    });
  }
  return { errors, warnings, unit, codes, employees, sheets };
}
