// Mô hình dữ liệu module PHÂN CA TRỰC. Dùng chung nhân sự (Employee.id),
// mã chấm công (AttendanceCode.id) và lịch đơn vị (Unit.calendar) đã có.

export type PositionKind = 'truc_ca' | 'hanh_chinh';

/** Vị trí công việc cần bố trí (vd: Trực canh khai thác, Kiểm tra kiểm soát, Vận hành nguồn điện). */
export interface Position {
  id: string;
  name: string;
  short: string;
  kind: PositionKind;
  /** Giới hạn số ngày liên tiếp một người ở vị trí này (0 = không giới hạn riêng). */
  maxConsecutiveDays: number;
  note: string;
}

/** Ca trực do quản trị viên tự khai báo. */
export interface ShiftDef {
  id: string;
  name: string;
  short: string;
  /** HH:MM */
  start: string;
  /** HH:MM; nhỏ hơn hoặc bằng start = kết thúc sang ngày hôm sau */
  end: string;
  hours: number;
  isNight: boolean;
  color: string;
  /** Mã chấm công tương ứng (chọn từ danh mục mã công đã có). Rỗng = chưa ánh xạ, không đồng bộ được. */
  attendanceCodeId: string;
  active: boolean;
}

export type DayType = 'weekday' | 'weekend' | 'holiday';

/** Nhu cầu nhân sự: cần tối thiểu N người cho ca X tại vị trí Y vào loại ngày Z. */
export interface Demand {
  id: string;
  shiftId: string;
  positionId: string;
  minStaff: number;
  dayTypes: DayType[];
}

export type WorkType = 'truc_ca' | 'hanh_chinh' | 'kiem_nhiem';

/** Thiết lập phân ca riêng cho từng nhân sự (khóa theo Employee.id, không nhân bản dữ liệu nhân sự). */
export interface StaffProfile {
  employeeId: string;
  participates: boolean;
  workType: WorkType;
  group: string;
  /** Vị trí được phép đảm nhận. */
  positionIds: string[];
  /** Vị trí chính (khối hành chính cố định). */
  primaryPositionId: string;
  /** Không xếp ca đêm. */
  noNight: boolean;
  /** Ngày trong tuần không xếp (0 = CN). */
  unavailableWeekdays: number[];
  /** Thuộc nhóm luân phiên hành chính cuối tuần khi thiếu người. */
  weekendRotation: boolean;
  /** Định mức công tháng riêng (0 = dùng định mức chung). */
  targetDays: number;
  /** Trần công riêng (0 = dùng trần chung). */
  maxDays: number;
  note: string;
}

export interface RosterRules {
  /** Trần công/tháng. */
  monthlyCap: number;
  /** Định mức công/tháng để đối chiếu thiếu/thừa công (0 = theo số ngày làm việc hành chính của tháng). */
  monthlyTarget: number;
  maxConsecutiveWorkDays: number;
  maxConsecutiveNights: number;
  /** Giờ nghỉ tối thiểu giữa hai ca bất kỳ. */
  minRestHours: number;
  /** Giờ nghỉ tối thiểu sau ca đêm trước khi nhận ca tại vị trí trực ca. */
  restAfterNightHours: number;
  /** Quy định nghỉ sau ca đêm chỉ áp dụng cho vị trí trực ca (không chặn hành chính hôm sau). */
  restAfterNightOnlyTruc: boolean;
  /** Khối hành chính được nghỉ T7/CN/lễ (không tự xếp vào các ngày này). */
  adminRestOnWeekend: boolean;
  /** Cho phép xếp nhóm luân phiên hành chính cuối tuần khi thiếu người. */
  allowWeekendRotation: boolean;
  /** Chênh lệch tối đa số ca giữa các nhân sự cùng nhóm trước khi cảnh báo. */
  fairnessTolerance: number;
  /** Số tháng trước dùng để cân đối công bằng. */
  historyMonths: number;
  /** Ngày làm việc đặc biệt (làm bù) YYYY-MM-DD: coi như ngày thường. */
  specialWorkdays: string[];
}

export interface ShiftConfig {
  /** = unitId */
  id: string;
  unitId: string;
  positions: Position[];
  shifts: ShiftDef[];
  demands: Demand[];
  profiles: StaffProfile[];
  rules: RosterRules;
  updatedAt: string;
}

export interface Assignment {
  day: number;
  shiftId: string;
  positionId: string;
  employeeId: string;
  /** Do người dùng xếp/sửa tay: giữ nguyên khi tự động lập lại. */
  manual: boolean;
  note?: string;
}

export type RosterStatus = 'nhap' | 'da_chot';

export interface Roster {
  /** `${unitId}:YYYY-MM` */
  id: string;
  unitId: string;
  year: number;
  month: number;
  status: RosterStatus;
  participants: string[];
  assignments: Assignment[];
  /** Nghỉ đăng ký trong lịch: leaves[employeeId][day] = AttendanceCode.id */
  leaves: Record<string, Record<string, string>>;
  dayNotes: Record<string, string>;
  approvedAt?: string;
  approvedBy?: string;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RosterVersion {
  id: string;
  rosterId: string;
  unitId: string;
  createdAt: string;
  user: string;
  reason: string;
  data: Roster;
}
