import { useEffect, useMemo, useState } from 'react';
import { formatMonth, pad2, shiftMonth, WEEKDAY_LABELS, WEEKDAY_SHORT } from '../../../domain/calendar';
import { computeSheetSummary, makeContext } from '../../../domain/summary';
import { compareRosters } from '../../../domain/roster/compare';
import { demandsForDay } from '../../../domain/roster/context';
import type { Shortage } from '../../../domain/roster/generate';
import { SYNC_ACTION_LABELS, type SyncPlan } from '../../../domain/roster/sync';
import type { Assignment, RosterVersion } from '../../../domain/roster/types';
import { ISSUE_LABELS, type RosterIssue } from '../../../domain/roster/validate';
import { formatNumber } from '../../../domain/util';
import { exportRosterXlsx, rosterFileName } from '../../../excel/roster-export';
import type { TabId } from '../../App';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, useDialog, useToast } from '../../components/ui';
import { useActions, useApp } from '../../context';
import { downloadBytes, isArtifactHost, XLSX_MIME } from '../../download';
import type { RosterData } from './RosterPanel';

type View = 'thang' | 'tuan' | 'nhan_su' | 'vi_tri' | 'tong_hop';

export function RosterScheduleTab({ data, onNavigate, goConfig, goStaff }: { data: RosterData; onNavigate: (t: TabId) => void; goConfig: () => void; goStaff: () => void }) {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const { roster, ctx, issues, errors, warnings, config } = data;
  const [view, setView] = useState<View>('thang');
  const [cell, setCell] = useState<{ day: number; employeeId: string } | null>(null);
  const [shortages, setShortages] = useState<Shortage[] | null>(null);
  const [showIssues, setShowIssues] = useState(true);
  const [dialogOpen, setDialogOpen] = useState<'participants' | 'sync' | 'versions' | 'compare' | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = a.can('sheet.edit') && roster?.status !== 'da_chot';
  const sheet = data.sheet;
  const required = useRequired(data);

  const steps = [
    { n: 1, label: 'Chọn tháng', done: true },
    { n: 2, label: 'Nhân sự & nghỉ', done: !!roster && roster.participants.length > 0 },
    { n: 3, label: 'Nhu cầu vị trí/ca', done: config.demands.length > 0 },
    { n: 4, label: 'Tự động lập lịch', done: !!roster && roster.assignments.length > 0 },
    { n: 5, label: 'Kiểm tra lỗi', done: !!roster && roster.assignments.length > 0 && errors === 0 },
    { n: 6, label: 'Điều chỉnh tay', done: !!roster && roster.assignments.some((x) => x.manual) },
    { n: 7, label: 'Kiểm tra lại', done: !!roster && roster.assignments.length > 0 && errors === 0 },
    { n: 8, label: 'Chốt lịch', done: roster?.status === 'da_chot' },
    { n: 9, label: 'Đồng bộ chấm công', done: !!roster?.syncedAt },
    { n: 10, label: 'Xuất Excel / in', done: false },
  ];

  const generate = async () => {
    if (!roster) return;
    const hasAuto = roster.assignments.some((x) => !x.manual);
    if (hasAuto && !(await dialog.confirm({
      title: 'Tự động lập lại lịch',
      message: 'Các ô xếp tự động hiện có sẽ được lập lại. Ô xếp tay và ngày nghỉ đã đăng ký được giữ nguyên. Phiên bản hiện tại được lưu để khôi phục khi cần.',
      confirmText: 'Lập lịch',
    }))) return;
    setBusy(true);
    const r = await a.roster.generate();
    setBusy(false);
    if (!r.ok && !r.data) return toast(r.message!, 'error');
    setShortages(r.data!.shortages);
    const e = r.data!.issues.filter((i) => i.severity === 'error').length;
    toast(r.data!.shortages.length ? r.message! : `Đã lập lịch. ${e ? `${e} lỗi cần xem` : 'Không có lỗi'}, ${r.data!.issues.length - e} cảnh báo.`, r.data!.shortages.length ? 'warning' : 'success');
  };

  const approve = async () => {
    if (!roster) return;
    if (roster.status === 'da_chot') {
      const reason = await dialog.prompt({ title: 'Mở lại lịch đã chốt', label: 'Lý do mở lại', required: true, confirmText: 'Mở lại' });
      if (reason === null) return;
      const r = await a.roster.reopen(reason);
      return toast(r.ok ? 'Đã mở lại lịch.' : r.message!, r.ok ? 'success' : 'error');
    }
    if (!(await dialog.confirm({
      title: `Chốt lịch phân ca ${formatMonth(roster.year, roster.month)}`,
      message: warnings ? `Lịch còn ${warnings} cảnh báo (không chặn chốt). Sau khi chốt, lịch không sửa được cho đến khi mở lại.` : 'Sau khi chốt, lịch không sửa được cho đến khi mở lại.',
      confirmText: 'Chốt lịch',
    }))) return;
    const r = await a.roster.approve();
    toast(r.ok ? 'Đã chốt lịch. Bước tiếp theo: đồng bộ sang chấm công.' : r.message!, r.ok ? 'success' : 'error');
  };

  const exportExcel = async () => {
    if (!roster) return;
    try {
      const attendance = sheet ? computeSheetSummary(sheet, a.get().employees, makeContext(sheet.year, sheet.month, a.get().codes, ctx.unit.codeGroups, ctx.unit.calendar)) : null;
      const bytes = await exportRosterXlsx({ ctx, roster, issues, attendance });
      if (!(await downloadBytes(rosterFileName(ctx), bytes, XLSX_MIME))) return;
      toast(`Đã xuất ${rosterFileName(ctx)}`, 'success');
    } catch (e) {
      toast(`Lỗi xuất Excel: ${(e as Error).message}`, 'error');
    }
  };

  if (!roster) {
    return (
      <Card title={`Lịch phân ca tháng ${formatMonth(ctx.year, ctx.month)}`}>
        <Stepper steps={steps} />
        <EmptyState>
          <p>Chưa có lịch phân ca tháng này. Lịch được tạo từ danh sách nhân sự đang làm việc có tham gia phân ca ({config.profiles.length ? 'theo thiết lập' : 'mặc định: tất cả'}).</p>
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="primary" disabled={!a.can('sheet.edit')} onClick={async () => {
              const r = await a.roster.create();
              toast(r.ok ? `Đã tạo lịch với ${r.data!.participants.length} nhân sự. Kiểm tra danh sách và ngày nghỉ, rồi bấm "Tự động lập lịch".` : r.message!, r.ok ? 'success' : 'error');
            }}>Tạo lịch phân ca tháng {formatMonth(ctx.year, ctx.month)}</Button>
            <Button onClick={goStaff}>Thiết lập nhân sự phân ca</Button>
            <Button onClick={goConfig}>Cấu hình ca & quy tắc</Button>
          </div>
        </EmptyState>
      </Card>
    );
  }

  const filled = required.filled;

  return (
    <div className="space-y-4">
      <div className="no-print"><Stepper steps={steps} /></div>
      <div className="no-print flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <Button disabled={!canEdit} onClick={() => setDialogOpen('participants')}>Nhân sự tham gia ({roster.participants.length})</Button>
        <Button variant="primary" disabled={!canEdit || busy} onClick={generate}>{busy ? 'Đang lập lịch…' : 'Tự động lập lịch'}</Button>
        <Button disabled={!canEdit} onClick={async () => {
          if (roster.assignments.length && !(await dialog.confirm({ title: 'Sao chép lịch tháng trước', message: 'Lịch hiện tại sẽ được thay bằng bản sao tháng trước (lưu phiên bản để khôi phục).', confirmText: 'Sao chép' }))) return;
          const r = await a.roster.copyFromPrevious();
          toast(r.ok ? `Đã sao chép ${r.data} lượt xếp. ${r.message}` : r.message!, r.ok ? 'success' : 'error');
        }}>Sao chép tháng trước</Button>
        <Button onClick={() => { setShowIssues(true); toast(`Kiểm tra lại toàn bộ lịch: ${errors} lỗi, ${warnings} cảnh báo.`, errors ? 'warning' : 'success'); }}>Kiểm tra lại</Button>
        {a.can(roster.status === 'da_chot' ? 'sheet.unlock' : 'sheet.lock') && (
          <Button variant={roster.status === 'da_chot' ? 'secondary' : 'success'} onClick={approve}>{roster.status === 'da_chot' ? 'Mở lại lịch' : 'Chốt lịch'}</Button>
        )}
        <Button disabled={roster.status !== 'da_chot'} title={roster.status !== 'da_chot' ? 'Chốt lịch trước khi đồng bộ' : ''} onClick={() => setDialogOpen('sync')}>Đồng bộ sang chấm công</Button>
        <Button onClick={exportExcel}>Xuất Excel</Button>
        {!isArtifactHost() && <Button onClick={() => { setView('thang'); setTimeout(() => window.print(), 50); }}>In trình ký</Button>}
        <Button variant="ghost" onClick={() => setDialogOpen('versions')}>Phiên bản</Button>
        <Button variant="ghost" onClick={() => setDialogOpen('compare')}>So sánh tháng</Button>
        {canEdit && roster.assignments.some((x) => !x.manual) && (
          <Button variant="ghost" className="text-red-700" onClick={async () => {
            if (!(await dialog.confirm({ title: 'Xóa các ô xếp tự động', message: 'Giữ ô xếp tay và ngày nghỉ, xóa toàn bộ ô xếp tự động?', danger: true }))) return;
            const r = await a.roster.clearAuto();
            toast(r.ok ? 'Đã xóa ô xếp tự động.' : r.message!, r.ok ? 'success' : 'error');
          }}>Xóa ô tự động</Button>
        )}
      </div>

      <div className="no-print grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Nhân sự tham gia" value={roster.participants.length} sub={`${[...data.ctx.leaves.values()].reduce((n, m) => n + m.size, 0)} ngày nghỉ có mã`} />
        <Stat label="Vị trí đã phủ" value={`${filled}/${required.total}`} sub={required.total ? `${Math.round((filled / required.total) * 100)}% nhu cầu` : 'Chưa có nhu cầu'} tone={filled < required.total ? 'amber' : undefined} />
        <Stat label="Lỗi phải xử lý" value={errors} tone={errors ? 'red' : undefined} sub={errors ? 'Chặn chốt lịch' : 'Có thể chốt'} />
        <Stat label="Cảnh báo" value={warnings} tone={warnings ? 'amber' : undefined} sub="Cần người lập xem xét" />
        <Stat label="Trạng thái" value={roster.status === 'da_chot' ? 'Đã chốt' : 'Bản nháp'} sub={roster.syncedAt ? 'Đã đồng bộ chấm công' : 'Chưa đồng bộ'} />
      </div>

      {showIssues && issues.length > 0 && <IssuePanel issues={issues} ctxName={(id) => ctx.employees.get(id)?.fullName ?? id} onHide={() => setShowIssues(false)} onPick={(d, e) => e && d && setCell({ day: d, employeeId: e })} />}

      <Card
        printHeader={false}
        title={<span>Lịch phân ca tháng {formatMonth(ctx.year, ctx.month)} {roster.status === 'da_chot' && <Badge color="blue">Đã chốt</Badge>}</span>}
        actions={
          <div className="no-print flex gap-1">
            {([['thang', 'Tháng'], ['tuan', 'Tuần'], ['nhan_su', 'Theo nhân sự'], ['vi_tri', 'Theo vị trí'], ['tong_hop', 'Tổng hợp']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setView(id)} className={`rounded px-2.5 py-1 text-sm ${view === id ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{label}</button>
            ))}
          </div>
        }
      >
        <div className="print-only mb-2 text-center">
          <div className="text-left text-xs">{ctx.unit.parentOrg}<br /><b>Đơn vị: {ctx.unit.name}</b></div>
          <div className="text-lg font-bold">LỊCH PHÂN CA TRỰC</div>
          <div className="italic">Tháng {pad2(ctx.month)} năm {ctx.year}</div>
        </div>
        {view === 'thang' && <MonthView data={data} canEdit={canEdit} onCell={(day, employeeId) => setCell({ day, employeeId })} />}
        {view === 'tuan' && <WeekView data={data} />}
        {view === 'nhan_su' && <PersonView data={data} onCell={(day, employeeId) => setCell({ day, employeeId })} />}
        {view === 'vi_tri' && <PositionView data={data} />}
        {view === 'tong_hop' && <SummaryView data={data} />}
        <Legend data={data} />
        <div className="print-only mt-4 text-sm">
          <div className="text-right italic">{ctx.unit.template.place ? `${ctx.unit.template.place}, ` : ''}ngày ..... tháng ..... năm {ctx.year}</div>
          <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${ctx.unit.template.signers.length || 1}, 1fr)` }}>
            {ctx.unit.template.signers.map((s, i) => (
              <div key={i} className="text-center"><div className="font-bold">{s.title}</div><div className="text-xs italic">(Ký, ghi rõ họ tên)</div><div className="mt-14 font-bold">{s.name}</div></div>
            ))}
          </div>
        </div>
      </Card>

      {cell && <CellDialog data={data} day={cell.day} employeeId={cell.employeeId} canEdit={!!canEdit} onClose={() => setCell(null)} />}
      {shortages && shortages.length > 0 && <ShortageDialog data={data} shortages={shortages} onClose={() => setShortages(null)} />}
      {dialogOpen === 'participants' && <ParticipantsDialog data={data} onClose={() => setDialogOpen(null)} />}
      {dialogOpen === 'sync' && <SyncDialog data={data} onClose={() => setDialogOpen(null)} onNavigate={onNavigate} />}
      {dialogOpen === 'versions' && <VersionsDialog onClose={() => setDialogOpen(null)} />}
      {dialogOpen === 'compare' && <CompareDialog data={data} onClose={() => setDialogOpen(null)} />}
    </div>
  );
}


function useRequired(data: RosterData) {
  return useMemo(() => {
    let total = 0;
    let filled = 0;
    if (!data.roster) return { total, filled };
    for (let d = 1; d <= data.ctx.nDays; d++) {
      for (const dm of demandsForDay(data.ctx, d)) {
        total += dm.minStaff;
        const have = data.roster!.assignments.filter((x) => x.day === d && x.shiftId === dm.shiftId && x.positionId === dm.positionId).length;
        filled += Math.min(have, dm.minStaff);
      }
    }
    return { total, filled };
  }, [data]);
}

function Stepper({ steps }: { steps: { n: number; label: string; done: boolean }[] }) {
  const current = steps.find((s) => !s.done)?.n ?? 10;
  return (
    <ol className="flex flex-wrap gap-1.5 text-xs">
      {steps.map((s) => (
        <li key={s.n} className={`flex items-center gap-1 rounded-full border px-2 py-1 ${s.done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : s.n === current ? 'border-blue-400 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-500'}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${s.done ? 'bg-emerald-600 text-white' : s.n === current ? 'bg-blue-700 text-white' : 'bg-slate-200'}`}>{s.done ? '✓' : s.n}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'amber' | 'red' }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-blue-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function IssuePanel({ issues, onHide, onPick }: { issues: RosterIssue[]; ctxName: (id: string) => string; onHide: () => void; onPick: (day?: number, emp?: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const list = issues.filter((i) => filter === 'all' || i.severity === filter);
  return (
    <div className="no-print rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b>Kết quả kiểm tra lịch</b>
        {(['all', 'error', 'warning'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 text-xs ${filter === f ? 'bg-slate-800 text-white' : 'bg-white'}`}>
            {f === 'all' ? `Tất cả (${issues.length})` : f === 'error' ? `Lỗi (${issues.filter((i) => i.severity === 'error').length})` : `Cảnh báo (${issues.filter((i) => i.severity === 'warning').length})`}
          </button>
        ))}
        <button className="ml-auto text-xs text-slate-600 underline" onClick={onHide}>Ẩn</button>
      </div>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {list.map((i, k) => (
          <li key={k} className="flex gap-2">
            <Badge color={i.severity === 'error' ? 'red' : 'amber'}>{ISSUE_LABELS[i.kind]}</Badge>
            {i.day && i.employeeId ? (
              <button className="text-left hover:underline" onClick={() => onPick(i.day, i.employeeId)}>{i.message}</button>
            ) : <span>{i.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ data }: { data: RosterData }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {data.config.shifts.filter((s) => s.active).map((s) => (
        <span key={s.id}><span className="rounded px-1 font-semibold" style={{ background: s.color }}>{s.short}</span> {s.name} {s.start}–{s.end}</span>
      ))}
      <span><span className="rounded bg-yellow-200 px-1 font-semibold">P</span> Ngày nghỉ có mã (phép, chế độ...)</span>
      <span><span className="inline-block h-3 w-3 bg-slate-200 align-middle" /> Cuối tuần</span>
      <span><span className="inline-block h-3 w-3 bg-red-100 align-middle" /> Ngày lễ</span>
      <span><span className="font-bold text-blue-700">•</span> Xếp tay</span>
      <span><span className="inline-block h-3 w-3 border-2 border-red-600 align-middle" /> Ô có lỗi</span>
    </div>
  );
}

const offBg = (t: string) => (t === 'holiday' ? '#fee2e2' : t === 'weekend' ? '#f1f5f9' : undefined);

function MonthView({ data, canEdit, onCell }: { data: RosterData; canEdit: boolean; onCell: (day: number, emp: string) => void }) {
  const { ctx, roster, issues } = data;
  const byKey = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const x of roster!.assignments) m.set(`${x.employeeId}:${x.day}`, x);
    return m;
  }, [roster]);
  const errorCells = useMemo(() => new Set(issues.filter((i) => i.severity === 'error' && i.day && i.employeeId).map((i) => `${i.employeeId}:${i.day}`)), [issues]);
  const shortDays = useMemo(() => new Set(issues.filter((i) => i.kind === 'thieu_nguoi').map((i) => i.day)), [issues]);
  const days = Array.from({ length: ctx.nDays }, (_, i) => i + 1);
  return (
    <div className="print-area max-h-[65vh] overflow-auto rounded border border-slate-300">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-20 bg-slate-100">
          <tr>
            <th className="sticky left-0 z-30 min-w-[10rem] border border-slate-300 bg-slate-100 px-1 text-left" rowSpan={2}>Họ và tên</th>
            {days.map((d) => <th key={d} className="min-w-[2.6rem] border border-slate-300" style={{ background: offBg(ctx.dayTypes[d - 1]) }} title={ctx.unit.calendar.holidays.find((h) => h.date.endsWith(`-${pad2(ctx.month)}-${pad2(d)}`))?.name}>{d}</th>)}
            <th className="border border-slate-300 bg-blue-50 px-1" rowSpan={2}>Ngày</th>
            <th className="border border-slate-300 bg-blue-50 px-1" rowSpan={2}>Đêm</th>
            <th className="border border-slate-300 bg-blue-50 px-1" rowSpan={2}>Giờ</th>
          </tr>
          <tr>{days.map((d) => <th key={d} className={`border border-slate-300 font-normal ${ctx.weekdays[d - 1] === 0 ? 'text-red-700' : ''}`} style={{ background: offBg(ctx.dayTypes[d - 1]) }}>{WEEKDAY_SHORT[ctx.weekdays[d - 1]]}</th>)}</tr>
        </thead>
        <tbody>
          {ctx.participants.map((id) => {
            const st = data.stats.get(id);
            const prof = ctx.profiles.get(id);
            return (
              <tr key={id}>
                <td className="sticky left-0 z-10 whitespace-nowrap border border-slate-300 bg-white px-1">
                  {ctx.employees.get(id)?.fullName}
                  <span className="ml-1 text-[10px] text-slate-400">{prof?.workType === 'hanh_chinh' ? 'HC' : prof?.workType === 'kiem_nhiem' ? 'KN' : ''}</span>
                </td>
                {days.map((d) => {
                  const x = byKey.get(`${id}:${d}`);
                  const leave = ctx.leaves.get(id)?.get(d);
                  const sh = x ? ctx.shifts.get(x.shiftId) : undefined;
                  const pos = x ? ctx.positions.get(x.positionId) : undefined;
                  const err = errorCells.has(`${id}:${d}`);
                  return (
                    <td key={d}
                      className={`relative h-8 cursor-pointer border text-center leading-tight ${err ? 'border-2 border-red-600' : 'border-slate-300'} hover:ring-2 hover:ring-blue-400`}
                      style={{ background: sh?.color ?? (leave ? '#fef08a' : offBg(ctx.dayTypes[d - 1])) }}
                      onClick={() => onCell(d, id)}
                      title={x ? `${sh?.name} – ${pos?.name}${x.note ? `\nGhi chú: ${x.note}` : ''}` : leave ? `Nghỉ: ${leave.code} (${leave.source === 'cham_cong' ? 'từ bảng chấm công' : 'đăng ký trong lịch'})` : canEdit ? 'Bấm để xếp ca' : ''}
                    >
                      {x ? (
                        <>
                          <div className="font-semibold">{sh?.short ?? '?'}</div>
                          {pos && (pos.kind === 'hanh_chinh' || (prof?.positionIds.length ?? 0) > 1) && <div className="text-[9px] text-slate-600">{pos.short}</div>}
                          {x.manual && <span className="absolute left-0.5 top-0 text-[10px] font-bold text-blue-700">•</span>}
                        </>
                      ) : leave ? <span className="font-semibold">{leave.code}</span> : null}
                    </td>
                  );
                })}
                <td className="border border-slate-300 bg-blue-50/50 px-1 text-center font-semibold">{st?.days ?? 0}</td>
                <td className="border border-slate-300 bg-blue-50/50 px-1 text-center">{st?.nights ?? 0}</td>
                <td className="border border-slate-300 bg-blue-50/50 px-1 text-center">{formatNumber(st?.hours ?? 0)}</td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td className="sticky left-0 z-10 border border-slate-300 bg-slate-50 px-1">Đủ người?</td>
            {days.map((d) => (
              <td key={d} className={`border border-slate-300 text-center ${shortDays.has(d) ? 'bg-red-200 text-red-800' : 'bg-emerald-50 text-emerald-700'}`}>{shortDays.has(d) ? 'Thiếu' : '✓'}</td>
            ))}
            <td colSpan={3} className="border border-slate-300" />
          </tr>
        </tbody>
      </table>
      {!ctx.participants.length && <p className="p-4 text-center text-sm text-slate-500">Chưa có nhân sự tham gia.</p>}
    </div>
  );
}

function slotPairs(data: RosterData) {
  const pairs: { positionId: string; shiftId: string }[] = [];
  for (const p of data.config.positions) {
    for (const s of data.config.shifts) {
      if (data.config.demands.some((d) => d.positionId === p.id && d.shiftId === s.id) || data.roster!.assignments.some((x) => x.positionId === p.id && x.shiftId === s.id)) {
        pairs.push({ positionId: p.id, shiftId: s.id });
      }
    }
  }
  return pairs;
}

function namesAt(data: RosterData, d: number, positionId: string, shiftId: string) {
  return data.roster!.assignments.filter((x) => x.day === d && x.positionId === positionId && x.shiftId === shiftId).map((x) => data.ctx.employees.get(x.employeeId)?.fullName ?? '?');
}

function needAt(data: RosterData, d: number, positionId: string, shiftId: string) {
  return demandsForDay(data.ctx, d).filter((x) => x.positionId === positionId && x.shiftId === shiftId).reduce((n, x) => Math.max(n, x.minStaff), 0);
}

function WeekView({ data }: { data: RosterData }) {
  const { ctx } = data;
  // Tuần bắt đầu Thứ 2
  const weeks: number[][] = [];
  let cur: number[] = [];
  for (let d = 1; d <= ctx.nDays; d++) {
    if (ctx.weekdays[d - 1] === 1 && cur.length) {
      weeks.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) weeks.push(cur);
  const [w, setW] = useState(0);
  const days = weeks[Math.min(w, weeks.length - 1)];
  const pairs = slotPairs(data);
  return (
    <div className="space-y-2">
      <div className="no-print flex gap-1">
        {weeks.map((wk, i) => <button key={i} onClick={() => setW(i)} className={`rounded px-2 py-1 text-sm ${i === w ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>Tuần {i + 1} ({wk[0]}–{wk[wk.length - 1]})</button>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100"><tr><th className="border border-slate-300 p-1 text-left">Vị trí / Ca</th>{days.map((d) => <th key={d} className="border border-slate-300 p-1" style={{ background: offBg(ctx.dayTypes[d - 1]) }}>{WEEKDAY_LABELS[ctx.weekdays[d - 1]]}<br />{pad2(d)}/{pad2(ctx.month)}</th>)}</tr></thead>
          <tbody>
            {pairs.map((p) => {
              const sh = ctx.shifts.get(p.shiftId)!;
              return (
                <tr key={p.positionId + p.shiftId}>
                  <td className="border border-slate-300 p-1"><b>{ctx.positions.get(p.positionId)?.name}</b><br /><span className="rounded px-1 text-xs" style={{ background: sh.color }}>{sh.name} {sh.start}–{sh.end}</span></td>
                  {days.map((d) => {
                    const names = namesAt(data, d, p.positionId, p.shiftId);
                    const need = needAt(data, d, p.positionId, p.shiftId);
                    return <td key={d} className={`border border-slate-300 p-1 align-top ${names.length < need ? 'bg-red-100' : ''}`}>{names.join(', ')}{names.length < need && <div className="text-xs font-semibold text-red-700">Thiếu {need - names.length}</div>}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonView({ data, onCell }: { data: RosterData; onCell: (day: number, emp: string) => void }) {
  const { ctx, roster } = data;
  const [emp, setEmp] = useState(ctx.participants[0] ?? '');
  const st = data.stats.get(emp);
  const mine = roster!.assignments.filter((x) => x.employeeId === emp);
  return (
    <div className="space-y-3">
      <Select className="w-72" value={emp} onChange={(e) => setEmp(e.target.value)}>
        {ctx.participants.map((id) => <option key={id} value={id}>{ctx.employees.get(id)?.fullName}</option>)}
      </Select>
      {st && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge color="blue">{st.days} ngày làm</Badge><Badge>{st.shifts} ca</Badge><Badge color="purple">{st.nights} ca đêm</Badge>
          <Badge>{st.weekendDays} ngày cuối tuần/lễ</Badge><Badge>{formatNumber(st.hours)} giờ</Badge><Badge color="amber">{st.leaveDays} ngày nghỉ có mã</Badge>
          <Badge color={st.diff === 0 ? 'green' : 'amber'}>Định mức {st.target} ({st.diff >= 0 ? '+' : ''}{st.diff})</Badge>
        </div>
      )}
      <div className="grid grid-cols-7 gap-1 text-xs">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className="text-center font-semibold text-slate-600">{WEEKDAY_LABELS[w]}</div>)}
        {Array.from({ length: (ctx.weekdays[0] + 6) % 7 }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: ctx.nDays }, (_, i) => i + 1).map((d) => {
          const x = mine.find((y) => y.day === d);
          const leave = ctx.leaves.get(emp)?.get(d);
          const sh = x ? ctx.shifts.get(x.shiftId) : undefined;
          return (
            <button key={d} onClick={() => onCell(d, emp)} className="min-h-[3.5rem] rounded border border-slate-200 p-1 text-left hover:ring-2 hover:ring-blue-400" style={{ background: sh?.color ?? (leave ? '#fef08a' : offBg(ctx.dayTypes[d - 1]) ?? '#fff') }}>
              <div className="font-semibold">{d}</div>
              {x && <div>{sh?.name}<br /><span className="text-slate-600">{ctx.positions.get(x.positionId)?.short}</span></div>}
              {leave && <div>Nghỉ {leave.code}</div>}
              {!x && !leave && <div className="text-slate-400">Nghỉ</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PositionView({ data }: { data: RosterData }) {
  const { ctx } = data;
  const [pos, setPos] = useState(data.config.positions[0]?.id ?? '');
  const shifts = data.config.shifts.filter((s) => slotPairs(data).some((p) => p.positionId === pos && p.shiftId === s.id));
  const days = Array.from({ length: ctx.nDays }, (_, i) => i + 1);
  return (
    <div className="space-y-3">
      <Select className="w-72" value={pos} onChange={(e) => setPos(e.target.value)}>
        {data.config.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead className="bg-slate-100"><tr><th className="border border-slate-300 p-1">Ngày</th>{shifts.map((s) => <th key={s.id} className="min-w-[8rem] border border-slate-300 p-1" style={{ background: s.color }}>{s.name}<br />{s.start}–{s.end}</th>)}</tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d} style={{ background: offBg(ctx.dayTypes[d - 1]) }}>
                <td className="whitespace-nowrap border border-slate-300 p-1">{WEEKDAY_SHORT[ctx.weekdays[d - 1]]} {pad2(d)}</td>
                {shifts.map((s) => {
                  const names = namesAt(data, d, pos, s.id);
                  const need = needAt(data, d, pos, s.id);
                  return <td key={s.id} className={`border border-slate-300 p-1 ${names.length < need ? 'bg-red-100 font-semibold text-red-700' : ''}`}>{names.join(', ') || (need ? `Thiếu ${need}` : '')}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryView({ data }: { data: RosterData }) {
  const { ctx, config } = data;
  const groups = new Map<string, string[]>();
  for (const id of ctx.participants) {
    const g = ctx.profiles.get(id)?.group || '(chung)';
    groups.set(g, [...(groups.get(g) ?? []), id]);
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="p-2">Nhóm</th><th className="p-2">Họ và tên</th>
            {config.shifts.map((s) => <th key={s.id} className="p-2 text-center" style={{ background: s.color }}>{s.short}</th>)}
            <th className="p-2 text-center">Ngày làm</th><th className="p-2 text-center">Ca đêm</th><th className="p-2 text-center">Cuối tuần/lễ</th>
            <th className="p-2 text-center">Giờ</th><th className="p-2 text-center">Nghỉ có mã</th><th className="p-2 text-center">Định mức</th><th className="p-2 text-center">Thiếu/thừa</th><th className="p-2 text-center">Trần</th>
          </tr>
        </thead>
        <tbody>
          {[...groups].map(([g, ids]) => ids.map((id, k) => {
            const s = data.stats.get(id)!;
            return (
              <tr key={id} className="border-b">
                <td className="p-2 text-slate-500">{k === 0 ? g : ''}</td>
                <td className="p-2">{ctx.employees.get(id)?.fullName}</td>
                {config.shifts.map((sh) => <td key={sh.id} className="p-2 text-center">{s.byShift[sh.id] || ''}</td>)}
                <td className={`p-2 text-center font-semibold ${s.days > s.cap ? 'text-red-700' : ''}`}>{s.days}</td>
                <td className="p-2 text-center">{s.nights}</td>
                <td className="p-2 text-center">{s.weekendDays}</td>
                <td className="p-2 text-center">{formatNumber(s.hours)}</td>
                <td className="p-2 text-center">{s.leaveDays}</td>
                <td className="p-2 text-center">{s.target}</td>
                <td className={`p-2 text-center ${s.diff < 0 ? 'text-amber-700' : s.diff > 0 ? 'text-blue-700' : ''}`}>{s.diff > 0 ? '+' : ''}{s.diff}</td>
                <td className="p-2 text-center">{s.cap}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Thiếu/thừa = ngày làm + ngày nghỉ có mã − định mức. Công quy đổi chính thức (dùng cho bảng lương) lấy từ bảng chấm công sau khi đồng bộ, xuất kèm trong file Excel "Tổng hợp công".</p>
    </div>
  );
}

function CellDialog({ data, day, employeeId, canEdit, onClose }: { data: RosterData; day: number; employeeId: string; canEdit: boolean; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const codes = useApp((s) => s.codes);
  const { ctx, roster, config } = data;
  const cur = roster!.assignments.find((x) => x.day === day && x.employeeId === employeeId);
  const leave = ctx.leaves.get(employeeId)?.get(day);
  const prof = ctx.profiles.get(employeeId);
  const options = config.shifts.filter((s) => s.active).flatMap((s) => config.positions.map((p) => ({ s, p })))
    .filter(({ s, p }) => config.demands.some((d) => d.shiftId === s.id && d.positionId === p.id) || (prof?.positionIds.includes(p.id) ?? false));
  const [pick, setPick] = useState(cur ? `${cur.shiftId}|${cur.positionId}` : options[0] ? `${options[0].s.id}|${options[0].p.id}` : '');
  const [note, setNote] = useState(cur?.note ?? '');
  const [swapWith, setSwapWith] = useState('');
  const shiftCodeIds = new Set(config.shifts.map((s) => s.attendanceCodeId));
  const leaveCodes = codes.filter((c) => c.active && !shiftCodeIds.has(c.id));
  const [leaveCode, setLeaveCode] = useState(leave?.codeId ?? leaveCodes.find((c) => c.code === 'P')?.id ?? leaveCodes[0]?.id ?? '');
  const name = ctx.employees.get(employeeId)?.fullName;
  const run = async (p: Promise<{ ok: boolean; message?: string }>, msg: string) => {
    const r = await p;
    toast(r.ok ? msg : r.message!, r.ok ? 'success' : 'error');
    if (r.ok) onClose();
  };
  const sameDay = roster!.assignments.filter((x) => x.day === day && x.employeeId !== employeeId);
  const ok = (pick && canEdit) as boolean;
  return (
    <Modal title={`${name} – ${WEEKDAY_LABELS[ctx.weekdays[day - 1]]} ${pad2(day)}/${pad2(ctx.month)}/${ctx.year}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded bg-slate-50 p-2">
          Hiện tại: {cur ? <b>{ctx.shifts.get(cur.shiftId)?.name} – {ctx.positions.get(cur.positionId)?.name}{cur.manual ? ' (xếp tay)' : ''}</b> : leave ? <b>Nghỉ {leave.code}{leave.source === 'cham_cong' ? ' (đã nhập ở bảng chấm công)' : ''}</b> : 'Không có ca (nghỉ)'}
          {cur?.note && <div className="text-xs text-slate-600">Ghi chú: {cur.note}</div>}
        </div>
        {!canEdit && <p className="text-amber-700">Lịch đã chốt hoặc tài khoản không có quyền sửa. Mở lại lịch để điều chỉnh.</p>}
        {canEdit && leave?.source === 'cham_cong' && (
          <p className="text-amber-700">Ngày nghỉ này đã được nhập ở bảng chấm công ({leave.code}) – không xếp ca và không ghi đè. Sửa ở bảng chấm công nếu thực sự cần.</p>
        )}
        {canEdit && leave?.source !== 'cham_cong' && (
          <>
            <fieldset className="space-y-2">
              <legend className="font-medium">Xếp / đổi ca</legend>
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                {options.map(({ s, p }) => <option key={s.id + p.id} value={`${s.id}|${p.id}`}>{s.name} ({s.start}–{s.end}) – {p.name}</option>)}
              </Select>
              <Input placeholder="Ghi chú / lý do điều chỉnh" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!ok} onClick={() => { const [s, p] = pick.split('|'); run(a.roster.assign(day, employeeId, s, p, note), 'Đã xếp ca.'); }}>Xếp ca này</Button>
                {cur && <Button onClick={() => run(a.roster.clear(day, employeeId), 'Đã bỏ ca.')}>Bỏ ca (cho nghỉ)</Button>}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">Đổi ca với người khác trong ngày</legend>
              <div className="flex gap-2">
                <Select value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
                  <option value="">— Chọn nhân sự —</option>
                  {roster!.participants.filter((id) => id !== employeeId).map((id) => {
                    const x = sameDay.find((y) => y.employeeId === id);
                    return <option key={id} value={id}>{ctx.employees.get(id)?.fullName} – {x ? `${ctx.shifts.get(x.shiftId)?.short} ${ctx.positions.get(x.positionId)?.short}` : 'đang nghỉ'}</option>;
                  })}
                </Select>
                <Button disabled={!swapWith} onClick={() => run(a.roster.swap(day, employeeId, swapWith), 'Đã đổi ca.')}>Đổi ca</Button>
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">Ngày nghỉ (phép, chế độ, đột xuất)</legend>
              <div className="flex gap-2">
                <Select value={leaveCode} onChange={(e) => setLeaveCode(e.target.value)}>
                  {leaveCodes.map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                </Select>
                <Button disabled={!leaveCode} onClick={() => run(a.roster.setLeave(employeeId, day, leaveCode), 'Đã ghi ngày nghỉ.')}>Ghi nghỉ</Button>
                {leave && <Button onClick={() => run(a.roster.setLeave(employeeId, day, null), 'Đã bỏ ngày nghỉ.')}>Bỏ nghỉ</Button>}
              </div>
              <p className="text-xs text-slate-500">Mã nghỉ lấy từ danh mục mã công hiện có. Khi đồng bộ, mã nghỉ được ghi vào bảng chấm công nếu ô đang trống; ô đã có mã khác được giữ nguyên.</p>
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}

function ShortageDialog({ data, shortages, onClose }: { data: RosterData; shortages: Shortage[]; onClose: () => void }) {
  const { ctx } = data;
  const total = shortages.reduce((n, s) => n + s.missing, 0);
  return (
    <Modal wide title={`Không đủ nhân sự cho ${total} vị trí`} onClose={onClose} footer={<Button onClick={onClose}>Đóng</Button>}>
      <p className="mb-3 text-sm">Hệ thống <b>không xếp vi phạm quy tắc</b> để lấp chỗ trống. Các vị trí dưới đây để trống, kèm lý do từng người không xếp được. Xử lý bằng cách: bổ sung nhân sự tham gia, điều chỉnh quy tắc trong Cấu hình, cho phép luân phiên hành chính cuối tuần, hoặc xếp tay.</p>
      <ul className="space-y-2 text-sm">
        {shortages.map((s, i) => {
          const grouped = new Map<string, string[]>();
          for (const r of s.reasons) grouped.set(r.reason, [...(grouped.get(r.reason) ?? []), ctx.employees.get(r.employeeId)?.fullName ?? r.employeeId]);
          return (
            <li key={i} className="rounded border border-red-200 bg-red-50 p-2">
              <b>Ngày {s.day} ({WEEKDAY_SHORT[ctx.weekdays[s.day - 1]]}): {ctx.shifts.get(s.shiftId)?.name} – {ctx.positions.get(s.positionId)?.name}, thiếu {s.missing}</b>
              <ul className="mt-1 list-disc pl-5 text-xs">{[...grouped].map(([reason, names]) => <li key={reason}><i>{reason}</i>: {names.join(', ')}</li>)}</ul>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function ParticipantsDialog({ data, onClose }: { data: RosterData; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const employees = useApp((s) => s.employees);
  const [ids, setIds] = useState<string[]>(data.roster!.participants);
  const list = employees.filter((e) => e.status === 'active' || ids.includes(e.id));
  return (
    <Modal title="Nhân sự tham gia lịch tháng này" onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Hủy</Button>
        <Button variant="primary" onClick={async () => {
          const r = await a.roster.setParticipants(ids);
          toast(r.ok ? 'Đã cập nhật danh sách.' : r.message!, r.ok ? 'success' : 'error');
          if (r.ok) onClose();
        }}>Lưu</Button>
      </>
    }>
      <p className="mb-2 text-sm text-slate-600">Bỏ chọn một người sẽ xóa các ca của người đó trong tháng (lưu phiên bản để khôi phục). Ngày nghỉ đã đăng ký vẫn được giữ.</p>
      <div className="max-h-96 space-y-1 overflow-y-auto text-sm">
        {list.map((e) => {
          const leaves = data.ctx.leaves.get(e.id)?.size ?? 0;
          return (
            <label key={e.id} className="flex items-center gap-2">
              <input type="checkbox" checked={ids.includes(e.id)} onChange={(ev) => setIds(ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))} />
              {e.code} – {e.fullName} {e.status === 'inactive' && <Badge>Đã nghỉ</Badge>} {leaves > 0 && <Badge color="amber">{leaves} ngày nghỉ</Badge>}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function SyncDialog({ data, onClose, onNavigate }: { data: RosterData; onClose: () => void; onNavigate: (t: TabId) => void }) {
  const a = useActions();
  const toast = useToast();
  const [plan, setPlan] = useState<SyncPlan | null>(() => a.roster.syncPlan());
  const [busy, setBusy] = useState(false);
  if (!plan) return null;
  const name = (id: string) => data.ctx.employees.get(id)?.fullName ?? id;
  const noSheet = plan.blockers.some((b) => b.includes('Chưa có bảng chấm công'));
  return (
    <Modal wide title={`Xem trước đồng bộ sang bảng chấm công ${formatMonth(data.ctx.year, data.ctx.month)}`} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Đóng</Button>
        {noSheet && a.can('sheet.edit') && <Button onClick={async () => { const r = await a.createSheet(); toast(r.ok ? 'Đã tạo bảng chấm công.' : r.message!, r.ok ? 'success' : 'error'); setPlan(a.roster.syncPlan()); }}>Tạo bảng chấm công</Button>}
        <Button variant="primary" disabled={!!plan.blockers.length || !plan.edits.length || busy} onClick={async () => {
          setBusy(true);
          const r = await a.roster.sync();
          setBusy(false);
          toast(r.ok ? (r.message ?? `Đã đồng bộ ${r.data?.applied.length ?? 0} ô sang chấm công.`) : r.message!, r.ok ? 'success' : 'error');
          if (r.ok) { onClose(); onNavigate('cham_cong'); }
        }}>Đồng bộ {plan.edits.length} ô</Button>
      </>
    }>
      <div className="space-y-3 text-sm">
        {plan.blockers.map((b, i) => <p key={i} className="rounded bg-red-50 p-2 text-red-800">✖ {b}</p>)}
        {!plan.blockers.length && (
          <>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(plan.counts) as (keyof typeof plan.counts)[]).map((k) => (
                <Badge key={k} color={k === 'xung_dot' && plan.counts[k] ? 'red' : k === 'giu_nguyen_nghi' ? 'amber' : 'slate'}>{SYNC_ACTION_LABELS[k]}: {plan.counts[k]}</Badge>
              ))}
            </div>
            <p className="text-xs text-slate-600">Ứng dụng tạo điểm khôi phục trước khi ghi. Ô đang có mã nghỉ phép/chế độ/công tác không bao giờ bị ghi đè. Chỉ những ô khác với lịch mới bị thay đổi.</p>
            {plan.missingRows.length > 0 && <p className="text-amber-700">Không có dòng ở bảng chấm công (bỏ qua): {plan.missingRows.join(', ')}</p>}
            {plan.changes.length === 0 ? <p className="text-emerald-700">Bảng chấm công đã khớp với lịch phân ca.</p> : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left"><tr><th className="p-1">Nhân sự</th><th className="p-1">Ngày</th><th className="p-1">Hiện tại</th><th className="p-1">Sau đồng bộ</th><th className="p-1">Thao tác</th></tr></thead>
                  <tbody>
                    {plan.changes.slice(0, 500).map((c, i) => (
                      <tr key={i} className={`border-b ${c.action === 'xung_dot' ? 'bg-red-50' : c.action === 'giu_nguyen_nghi' ? 'bg-amber-50' : ''}`}>
                        <td className="p-1">{name(c.employeeId)}</td><td className="p-1">{c.day}</td><td className="p-1">{c.from || '(trống)'}</td><td className="p-1 font-semibold">{c.to || '(trống)'}</td>
                        <td className="p-1">{SYNC_ACTION_LABELS[c.action]}{c.note ? ` – ${c.note}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.changes.length > 500 && <p className="p-1 text-xs text-slate-500">… và {plan.changes.length - 500} dòng khác.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function VersionsDialog({ onClose }: { onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const [list, setList] = useState<RosterVersion[] | null>(null);
  useEffect(() => {
    a.roster.listVersions().then(setList).catch(() => setList([]));
  }, [a]);
  return (
    <Modal wide title="Các phiên bản lịch đã lưu" onClose={onClose} footer={<Button onClick={onClose}>Đóng</Button>}>
      {!list ? <p className="text-sm">Đang tải…</p> : !list.length ? <EmptyState>Chưa có phiên bản nào. Phiên bản được lưu tự động trước mỗi lần lập lịch, điều chỉnh, chốt hoặc khôi phục.</EmptyState> : (
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Thời gian</th><th className="p-2">Người thực hiện</th><th className="p-2">Lý do lưu</th><th className="p-2">Số lượt xếp</th><th /></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className="border-b">
                <td className="p-2">{new Date(v.createdAt).toLocaleString('vi-VN')}</td><td className="p-2">{v.user}</td><td className="p-2">{v.reason}</td><td className="p-2">{v.data.assignments.length}</td>
                <td className="p-2 text-right"><Button small onClick={async () => {
                  if (!(await dialog.confirm({ title: 'Khôi phục phiên bản', message: 'Lịch hiện tại được lưu thành phiên bản mới rồi thay bằng phiên bản này (trạng thái bản nháp).', confirmText: 'Khôi phục' }))) return;
                  const r = await a.roster.restoreVersion(v);
                  toast(r.ok ? 'Đã khôi phục phiên bản.' : r.message!, r.ok ? 'success' : 'error');
                  if (r.ok) onClose();
                }}>Khôi phục</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function CompareDialog({ data, onClose }: { data: RosterData; onClose: () => void }) {
  const rosters = useApp((s) => s.rosters);
  const employees = useApp((s) => s.employees);
  const prev = shiftMonth(data.ctx.year, data.ctx.month, -1);
  const others = rosters.filter((r) => r.id !== data.roster!.id).sort((a, b) => b.id.localeCompare(a.id));
  const [otherId, setOtherId] = useState(others.find((r) => r.year === prev.year && r.month === prev.month)?.id ?? others[0]?.id ?? '');
  const other = rosters.find((r) => r.id === otherId) ?? null;
  const cmp = compareRosters(other, data.roster, data.config, employees);
  return (
    <Modal wide title="So sánh lịch giữa hai tháng" onClose={onClose} footer={<Button onClick={onClose}>Đóng</Button>}>
      {!others.length ? <EmptyState>Chưa có lịch tháng khác để so sánh.</EmptyState> : (
        <div className="space-y-3 text-sm">
          <Field label="So với tháng">
            <Select className="w-48" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
              {others.map((r) => <option key={r.id} value={r.id}>{formatMonth(r.year, r.month)}</option>)}
            </Select>
          </Field>
          <table className="w-full">
            <thead className="bg-slate-100"><tr><th className="p-1 text-left">Nhân sự</th><th className="p-1" colSpan={3}>{cmp.labelA}</th><th className="p-1" colSpan={3}>{cmp.labelB}</th><th className="p-1">Chênh ngày</th></tr>
              <tr className="text-xs"><th /><th>Ngày</th><th>Đêm</th><th>Giờ</th><th>Ngày</th><th>Đêm</th><th>Giờ</th><th /></tr></thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.employeeId} className="border-b text-center">
                  <td className="p-1 text-left">{r.name}</td>
                  <td>{r.a.days}</td><td>{r.a.nights}</td><td>{formatNumber(r.a.hours)}</td>
                  <td>{r.b.days}</td><td>{r.b.nights}</td><td>{formatNumber(r.b.hours)}</td>
                  <td className={r.b.days - r.a.days ? 'font-semibold text-blue-700' : ''}>{r.b.days - r.a.days > 0 ? '+' : ''}{r.b.days - r.a.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
