import { describe, expect, it } from 'vitest';
import { buildMonthDays, daysInMonth, isLeapYear, shiftMonth, standardWorkingDays, WEEKDAY_LABELS } from '../src/domain/calendar';
import type { WorkCalendar } from '../src/domain/types';

const cal: WorkCalendar = { mode: 'hanh_chinh', weekendDays: [0, 6], holidays: [] };

describe('Lịch tháng', () => {
  it('1. Tháng 2 năm thường có 28 ngày', () => {
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(buildMonthDays(2026, 2, cal)).toHaveLength(28);
  });

  it('2. Tháng 2 năm nhuận có 29 ngày (kể cả năm chia hết cho 400)', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    const days = buildMonthDays(2024, 2, cal);
    expect(days[28].date).toBe('2024-02-29');
    expect(days[28].weekdayLabel).toBe('Thứ 5');
  });

  it('3. Tháng có 30 ngày', () => {
    for (const m of [4, 6, 9, 11]) expect(daysInMonth(2026, m)).toBe(30);
  });

  it('4. Tháng có 31 ngày và thứ trong tuần bằng tiếng Việt', () => {
    for (const m of [1, 3, 5, 7, 8, 10, 12]) expect(daysInMonth(2026, m)).toBe(31);
    const days = buildMonthDays(2026, 10, cal);
    expect(days).toHaveLength(31);
    // 01/10/2026 là Thứ 5; 18/10/2026 là Chủ nhật
    expect(days[0].weekdayLabel).toBe('Thứ 5');
    expect(days[17].weekdayLabel).toBe('Chủ nhật');
    expect(days[17].isWeekend).toBe(true);
    expect(WEEKDAY_LABELS).toEqual(['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']);
    expect(standardWorkingDays(days)).toBe(22);
  });

  it('5. Tháng 12 chuyển sang tháng 1 năm sau và ngược lại', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
    expect(shiftMonth(2026, 10, 15)).toEqual({ year: 2028, month: 1 });
  });

  it('Ngày lễ và lịch trực ca: cuối tuần không mặc định là ngày nghỉ', () => {
    const withHoliday: WorkCalendar = { ...cal, holidays: [{ date: '2026-09-02', name: 'Quốc khánh', kind: 'le' }] };
    const d = buildMonthDays(2026, 9, withHoliday);
    expect(d[1].holiday?.name).toBe('Quốc khánh');
    expect(d[1].isOff).toBe(true);
    const shift = buildMonthDays(2026, 9, { ...withHoliday, mode: 'truc_ca' });
    expect(shift[1].isOff).toBe(false);
    expect(shift.filter((x) => x.isWeekend).every((x) => !x.isOff)).toBe(true);
  });

  it('Từ chối tháng/năm không hợp lệ', () => {
    expect(() => daysInMonth(2026, 13)).toThrow();
    expect(() => daysInMonth(1800, 1)).toThrow();
  });
});
