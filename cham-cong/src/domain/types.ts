// Mô hình dữ liệu dùng chung cho toàn ứng dụng.
// Mọi bản ghi nghiệp vụ đều gắn unitId để tách dữ liệu theo Đài.

export type RoleId = 'admin' | 'lap' | 'kiem_tra' | 'xem';

/** Nhóm công do đơn vị tự cấu hình (vd: Làm việc, Nghỉ hưởng lương...). */
export interface CodeGroup {
  id: string;
  name: string;
}

/** Một phiên bản quy tắc tính của mã công, có hiệu lực từ tháng effectiveFrom (YYYY-MM). */
export interface CodeRuleVersion {
  effectiveFrom: string;
  /** Giá trị quy đổi (ngày công). null = chưa có quy định, không tự áp đặt. */
  value: number | null;
  /** Có cộng vào tổng công quy đổi hay không. */
  countsInTotal: boolean;
  /** Có tính là ngày làm việc thực tế hay không. */
  isActualWork: boolean;
}

export interface AttendanceCode {
  id: string;
  unitId: string;
  /** Mã viết tắt hiển thị trong ô (X, P, Ô, NL, CT, X/2, Đ1...). */
  code: string;
  name: string;
  groupId: string;
  color: string;
  /** Mô tả quy tắc áp dụng (văn bản tự do theo quy chế). */
  rule: string;
  active: boolean;
  order: number;
  versions: CodeRuleVersion[];
  createdAt: string;
  updatedAt: string;
}

export type HolidayKind = 'le' | 'nghi_don_vi';

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  kind: HolidayKind;
}

export type CalendarMode = 'hanh_chinh' | 'truc_ca';

export interface WorkCalendar {
  /** hanh_chinh: nghỉ cuối tuần/lễ; truc_ca: trực ca 24/7, cuối tuần chỉ tô màu. */
  mode: CalendarMode;
  /** 0 = Chủ nhật ... 6 = Thứ 7 */
  weekendDays: number[];
  holidays: Holiday[];
}

export interface Signer {
  title: string;
  name: string;
}

export interface CustomTemplate {
  fileName: string;
  dataBase64: string;
  uploadedAt: string;
}

export interface ExcelTemplateConfig {
  formCode: string;
  formNote: string;
  title: string;
  place: string;
  paperSize: 'auto' | 'A4' | 'A3';
  orientation: 'landscape' | 'portrait';
  fontName: string;
  fontSize: number;
  weekendColor: string;
  holidayColor: string;
  showLegend: boolean;
  showPosition: boolean;
  includeSummarySheet: boolean;
  signers: Signer[];
  /** Mẫu tên file, hỗ trợ {MaDonVi} {YYYY} {MM}. */
  fileNamePattern: string;
  customTemplate?: CustomTemplate;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  parentOrg: string;
  address: string;
  startYear: number;
  calendar: WorkCalendar;
  codeGroups: CodeGroup[];
  template: ExcelTemplateConfig;
  /** Đơn vị chứa dữ liệu mẫu – không dùng làm dữ liệu chính thức. */
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeStatus = 'active' | 'inactive';

export interface Employee {
  /** Khóa nội bộ bất biến – dữ liệu chấm công gắn với khóa này. */
  id: string;
  unitId: string;
  /** Mã nhân viên, duy nhất trong đơn vị. */
  code: string;
  fullName: string;
  position: string;
  department: string;
  status: EmployeeStatus;
  startDate?: string;
  endDate?: string;
  order: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Ô chấm công: cells[employeeId][day] = mã công. */
export type CellMap = Record<string, Record<string, string>>;

export interface SheetRowSnapshot {
  employeeId: string;
  code: string;
  fullName: string;
  position: string;
  department: string;
}

export interface LockSnapshot {
  codes: AttendanceCode[];
  rows: SheetRowSnapshot[];
  unitName: string;
  parentOrg: string;
  calendar: WorkCalendar;
}

export interface MonthSheet {
  /** `${unitId}:${YYYY}-${MM}` */
  id: string;
  unitId: string;
  year: number;
  month: number;
  employeeIds: string[];
  cells: CellMap;
  cellNotes: CellMap;
  rowNotes: Record<string, string>;
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
  lockSnapshot?: LockSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id?: number;
  ts: string;
  unitId: string | null;
  user: string;
  action: string;
  entity: string;
  entityId?: string;
  detail: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: RoleId;
  /** Rỗng = được truy cập mọi đơn vị. */
  unitIds: string[];
  passwordHash: string;
  salt: string;
  iterations: number;
  active: boolean;
  createdAt: string;
}

export interface BackupFile {
  format: 'cham-cong-backup';
  version: 1;
  createdAt: string;
  scope: 'all' | 'unit';
  units: Unit[];
  employees: Employee[];
  codes: AttendanceCode[];
  sheets: MonthSheet[];
  audit: AuditEntry[];
  users?: User[];
}

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  unitId: string | null;
  data: BackupFile;
}
