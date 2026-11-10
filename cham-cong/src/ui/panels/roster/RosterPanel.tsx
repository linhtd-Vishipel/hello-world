import { useMemo, useState } from 'react';
import { formatMonth, pad2 } from '../../../domain/calendar';
import { buildContext } from '../../../domain/roster/context';
import type { Roster } from '../../../domain/roster/types';
import { countBySeverity, personStats, validateRoster } from '../../../domain/roster/validate';
import { monthKey } from '../../../domain/calendar';
import type { TabId } from '../../App';
import { Badge, Button, Input, Select } from '../../components/ui';
import { useActions, useApp } from '../../context';
import { RosterConfigTab } from './RosterConfigTab';
import { RosterStaffTab } from './RosterStaffTab';
import { RosterScheduleTab } from './RosterScheduleTab';

export type RosterSub = 'lich' | 'nhan_su' | 'cau_hinh';

/** Dữ liệu tính sẵn cho lịch tháng đang chọn (dùng chung giữa các màn hình). */
export function useRosterData() {
  const unitId = useApp((s) => s.unitId);
  const units = useApp((s) => s.units);
  const year = useApp((s) => s.year);
  const month = useApp((s) => s.month);
  const rosters = useApp((s) => s.rosters);
  const config = useApp((s) => s.shiftConfig);
  const employees = useApp((s) => s.employees);
  const codes = useApp((s) => s.codes);
  const sheets = useApp((s) => s.sheets);
  const unit = units.find((u) => u.id === unitId) ?? null;
  const roster = rosters.find((r) => r.unitId === unitId && r.year === year && r.month === month) ?? null;
  const sheet = sheets.find((s) => s.unitId === unitId && s.year === year && s.month === month) ?? null;
  return useMemo(() => {
    if (!unit || !config) return null;
    const base: Roster = roster ?? {
      id: '', unitId: unit.id, year, month, status: 'nhap', participants: [], assignments: [], leaves: {}, dayNotes: {}, createdAt: '', updatedAt: '',
    };
    const ctx = buildContext({
      unit, config, roster: base, employees, codes, sheet,
      previousRosters: rosters.filter((x) => monthKey(x.year, x.month) < monthKey(year, month)),
    });
    const issues = roster ? validateRoster(ctx, roster.assignments) : [];
    const stats = personStats(ctx, roster?.assignments ?? []);
    return { unit, config, roster, sheet, ctx, issues, stats, ...countBySeverity(issues) };
  }, [unit, config, roster, sheet, employees, codes, rosters, year, month]);
}

export function RosterPanel({ onNavigate }: { onNavigate: (t: TabId) => void }) {
  const a = useActions();
  const year = useApp((s) => s.year);
  const month = useApp((s) => s.month);
  const savedCfg = useApp((s) => s.shiftConfigSaved);
  const [sub, setSub] = useState<RosterSub>('lich');
  const data = useRosterData();
  if (!data) return null;
  const { roster } = data;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <Button onClick={() => a.shiftMonth(-1)} title="Tháng trước">◀</Button>
        <Select className="w-32" value={month} onChange={(e) => a.setMonth(year, Number(e.target.value))} aria-label="Chọn tháng">
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {pad2(i + 1)}</option>)}
        </Select>
        <Input className="w-24" type="number" min={1900} max={2100} value={year} aria-label="Chọn năm"
          onChange={(e) => { const y = Number(e.target.value); if (y >= 1900 && y <= 2100) a.setMonth(y, month); }} />
        <Button onClick={() => a.shiftMonth(1)} title="Tháng sau">▶</Button>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <b className="text-slate-800">Phân ca trực {formatMonth(year, month)}</b>
        {roster ? (
          roster.status === 'da_chot' ? <Badge color="blue">Đã chốt{roster.approvedBy ? ` – ${roster.approvedBy}` : ''}</Badge> : <Badge color="amber">Bản nháp</Badge>
        ) : <Badge>Chưa lập lịch</Badge>}
        {roster?.syncedAt && <Badge color="green">Đã đồng bộ chấm công {new Date(roster.syncedAt).toLocaleDateString('vi-VN')}</Badge>}
        <nav className="ml-auto flex gap-1">
          {([['lich', 'Lập lịch & xem lịch'], ['nhan_su', 'Nhân sự phân ca'], ['cau_hinh', 'Cấu hình ca & quy tắc']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setSub(id)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${sub === id ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </nav>
      </div>
      {!savedCfg && sub !== 'cau_hinh' && (
        <div className="no-print rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Đơn vị đang dùng <b>cấu hình ca mặc định</b> (chưa lưu). Vào "Cấu hình ca & quy tắc" để khai báo vị trí, ca, nhu cầu nhân sự và
          gán <b>mã chấm công</b> cho từng ca theo danh mục mã công hiện có, rồi bấm Lưu.
        </div>
      )}
      {sub === 'lich' && <RosterScheduleTab data={data} onNavigate={onNavigate} goConfig={() => setSub('cau_hinh')} goStaff={() => setSub('nhan_su')} />}
      {sub === 'nhan_su' && <RosterStaffTab data={data} onNavigate={onNavigate} />}
      {sub === 'cau_hinh' && <RosterConfigTab />}
    </div>
  );
}

export type RosterData = NonNullable<ReturnType<typeof useRosterData>>;
