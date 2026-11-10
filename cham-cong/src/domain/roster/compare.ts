import { formatMonth } from '../calendar';
import type { Employee } from '../types';
import type { Roster, ShiftConfig } from './types';

export interface CompareRow {
  employeeId: string;
  name: string;
  a: { days: number; nights: number; hours: number };
  b: { days: number; nights: number; hours: number };
}

function summarize(r: Roster | null, config: ShiftConfig) {
  const m = new Map<string, { days: Set<number>; nights: number; hours: number }>();
  for (const a of r?.assignments ?? []) {
    const s = config.shifts.find((x) => x.id === a.shiftId);
    const v = m.get(a.employeeId) ?? { days: new Set<number>(), nights: 0, hours: 0 };
    v.days.add(a.day);
    if (s?.isNight) v.nights++;
    v.hours += s?.hours ?? 0;
    m.set(a.employeeId, v);
  }
  return m;
}

/** So sánh số ngày trực, ca đêm và giờ trực của từng người giữa hai tháng. */
export function compareRosters(a: Roster | null, b: Roster | null, config: ShiftConfig, employees: Employee[]) {
  const sa = summarize(a, config);
  const sb = summarize(b, config);
  const ids = new Set([...sa.keys(), ...sb.keys()]);
  const rows: CompareRow[] = [...ids].map((id) => {
    const x = sa.get(id);
    const y = sb.get(id);
    return {
      employeeId: id,
      name: employees.find((e) => e.id === id)?.fullName ?? id,
      a: { days: x?.days.size ?? 0, nights: x?.nights ?? 0, hours: x?.hours ?? 0 },
      b: { days: y?.days.size ?? 0, nights: y?.nights ?? 0, hours: y?.hours ?? 0 },
    };
  });
  rows.sort((p, q) => p.name.localeCompare(q.name, 'vi'));
  return {
    labelA: a ? formatMonth(a.year, a.month) : '(trống)',
    labelB: b ? formatMonth(b.year, b.month) : '(trống)',
    rows,
  };
}
