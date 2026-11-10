import type { Holiday, WorkCalendar } from './types';

export const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export interface DayInfo {
  day: number;
  date: string;
  weekday: number;
  weekdayLabel: string;
  weekdayShort: string;
  isWeekend: boolean;
  holiday?: Holiday;
  /** Ngày nghỉ chung của đơn vị (chỉ áp dụng với lịch hành chính). */
  isOff: boolean;
}

export function assertValidMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`Năm không hợp lệ: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Tháng không hợp lệ: ${month}`);
  }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  assertValidMonth(year, month);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function sheetId(unitId: string, year: number, month: number): string {
  return `${unitId}:${monthKey(year, month)}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
}

export function buildMonthDays(year: number, month: number, calendar: WorkCalendar): DayInfo[] {
  const n = daysInMonth(year, month);
  const holidayMap = new Map(calendar.holidays.map((h) => [h.date, h]));
  const days: DayInfo[] = [];
  for (let d = 1; d <= n; d++) {
    const wd = weekdayOf(year, month, d);
    const date = isoDate(year, month, d);
    const holiday = holidayMap.get(date);
    const isWeekend = calendar.weekendDays.includes(wd);
    days.push({
      day: d,
      date,
      weekday: wd,
      weekdayLabel: WEEKDAY_LABELS[wd],
      weekdayShort: WEEKDAY_SHORT[wd],
      isWeekend,
      holiday,
      // Lịch trực ca: cuối tuần/lễ không mặc định là ngày nghỉ của nhân sự.
      isOff: calendar.mode === 'hanh_chinh' && (isWeekend || !!holiday),
    });
  }
  return days;
}

/** Số ngày làm việc theo lịch hành chính (không tính cuối tuần, ngày lễ). */
export function standardWorkingDays(days: DayInfo[]): number {
  return days.filter((d) => !d.isWeekend && !d.holiday).length;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || y < MIN_YEAR || y > MAX_YEAR) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isValidMonthKey(s: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const [y, m] = s.split('-').map(Number);
  return y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12;
}

export function formatMonth(year: number, month: number): string {
  return `${pad2(month)}/${year}`;
}
