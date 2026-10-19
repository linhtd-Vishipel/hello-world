import type { RoleId } from './types';

export type Permission =
  | 'sheet.edit'
  | 'sheet.lock'
  | 'sheet.unlock'
  | 'employee.manage'
  | 'code.manage'
  | 'unit.manage'
  | 'user.manage'
  | 'data.import'
  | 'data.backup'
  | 'data.restore'
  | 'export'
  | 'audit.view';

export const ROLE_LABELS: Record<RoleId, string> = {
  admin: 'Quản trị viên',
  lap: 'Người lập chấm công',
  kiem_tra: 'Người kiểm tra',
  xem: 'Người xem',
};

const ROLE_PERMS: Record<RoleId, Permission[]> = {
  admin: [
    'sheet.edit', 'sheet.lock', 'sheet.unlock', 'employee.manage', 'code.manage', 'unit.manage',
    'user.manage', 'data.import', 'data.backup', 'data.restore', 'export', 'audit.view',
  ],
  lap: ['sheet.edit', 'employee.manage', 'data.import', 'data.backup', 'export', 'audit.view'],
  kiem_tra: ['sheet.lock', 'data.backup', 'export', 'audit.view'],
  xem: ['export'],
};

export function can(role: RoleId | undefined, perm: Permission): boolean {
  return !!role && ROLE_PERMS[role].includes(perm);
}
