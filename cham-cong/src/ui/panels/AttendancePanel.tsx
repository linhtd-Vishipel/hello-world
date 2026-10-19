import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMonthDays, daysInMonth, formatMonth, pad2, standardWorkingDays, type DayInfo } from '../../domain/calendar';
import { findCode } from '../../domain/codes';
import { overwrittenCells, sheetCalendar, sheetCodes, sheetRows, type CellEdit } from '../../domain/sheet';
import { computeSheetSummary, makeContext, summaryCodes, type EmployeeSummary } from '../../domain/summary';
import type { AttendanceCode, SheetRowSnapshot } from '../../domain/types';
import { formatNumber } from '../../domain/util';
import { exportAttendanceXlsx, exportFileName } from '../../excel/export';
import type { TabId } from '../App';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';
import { downloadBytes, downloadJson, isArtifactHost, stamp, XLSX_MIME } from '../download';
import { ImportAttendanceDialog } from './ImportAttendanceDialog';

interface Pos { r: number; c: number }

export function AttendancePanel({ onNavigate }: { onNavigate: (t: TabId) => void }) {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const year = useApp((s) => s.year);
  const month = useApp((s) => s.month);
  const unitId = useApp((s) => s.unitId);
  const units = useApp((s) => s.units);
  const employees = useApp((s) => s.employees);
  const allCodes = useApp((s) => s.codes);
  const sheets = useApp((s) => s.sheets);
  const undoCount = useApp((s) => s.undo.length);
  const unit = units.find((u) => u.id === unitId)!;
  const sheet = sheets.find((s) => s.unitId === unitId && s.year === year && s.month === month) ?? null;
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<{ row: SheetRowSnapshot; sum: EmployeeSummary } | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  const codes = sheet ? sheetCodes(sheet, allCodes) : allCodes;
  const calendar = sheet ? sheetCalendar(sheet, unit) : unit.calendar;
  const days = useMemo(() => buildMonthDays(year, month, calendar), [year, month, calendar]);
  const ctx = useMemo(() => makeContext(year, month, codes, unit.codeGroups, calendar), [year, month, codes, unit.codeGroups, calendar]);
  const summary = useMemo(() => (sheet ? computeSheetSummary(sheet, employees, ctx) : null), [sheet, employees, ctx]);
  const rowsAll = useMemo(() => (sheet ? sheetRows(sheet, employees) : []), [sheet, employees]);
  const departments = useMemo(() => Array.from(new Set(rowsAll.map((r) => r.department).filter(Boolean))), [rowsAll]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsAll.filter(
      (r) => (!q || r.code.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)) && (!dept || r.department === dept),
    );
  }, [rowsAll, search, dept]);
  const sumCodes = useMemo(() => summaryCodes(codes, sheet), [codes, sheet]);
  const activeCount = employees.filter((e) => e.status === 'active').length;

  const exportExcel = async () => {
    if (!sheet) return;
    try {
      const bytes = await exportAttendanceXlsx({ unit, sheet, employees, codes: allCodes });
      if (!(await downloadBytes(exportFileName(unit, year, month), bytes, XLSX_MIME))) return;
      toast(`Đã xuất ${exportFileName(unit, year, month)}`, 'success');
    } catch (e) {
      toast(`Lỗi xuất Excel: ${(e as Error).message}`, 'error');
    }
  };

  const backup = async () => {
    const r = await a.exportBackup('unit');
    if (!r.ok) return toast(r.message!, 'error');
    try {
      if (!(await downloadJson(`SaoLuu_${unit.code}_${stamp()}.json`, r.data))) return;
    } catch (e) {
      return toast((e as Error).message, 'error');
    }
    await a.markBackedUp('unit');
    toast('Đã tải file sao lưu đơn vị về máy. Hãy cất giữ file ở nơi an toàn.', 'success');
  };

  const lockToggle = async () => {
    if (!sheet) return;
    if (sheet.locked) {
      const reason = await dialog.prompt({ title: 'Mở khóa bảng chấm công', message: 'Chỉ quản trị viên được mở khóa. Thao tác được ghi nhật ký.', label: 'Lý do mở khóa', required: true, confirmText: 'Mở khóa' });
      if (reason === null) return;
      const r = await a.unlockSheet(reason);
      toast(r.ok ? 'Đã mở khóa.' : r.message!, r.ok ? 'success' : 'error');
    } else {
      const issues = summary?.issues.length ?? 0;
      const okk = await dialog.confirm({
        title: `Khóa bảng chấm công ${formatMonth(year, month)}`,
        message: (
          <div className="space-y-2">
            <p>Sau khi khóa, bảng không thể chỉnh sửa. Danh mục mã, hệ số và tên nhân sự tại thời điểm này được lưu cố định để in/trình ký.</p>
            {issues > 0 && <p className="font-medium text-red-700">Bảng còn {issues} cảnh báo và {summary?.missingCells} ô trống cần kiểm tra.</p>}
          </div>
        ),
        confirmText: 'Khóa bảng',
      });
      if (!okk) return;
      const r = await a.lockSheet();
      toast(r.ok ? 'Đã khóa bảng chấm công.' : r.message!, r.ok ? 'success' : 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* A. Thanh điều khiển */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <Button onClick={() => a.shiftMonth(-1)} title="Tháng trước">◀</Button>
        <Select className="w-32" value={month} onChange={(e) => a.setMonth(year, Number(e.target.value))} aria-label="Chọn tháng">
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>Tháng {pad2(i + 1)}</option>
          ))}
        </Select>
        <YearInput year={year} onChange={(y) => a.setMonth(y, month)} />
        <Button onClick={() => a.shiftMonth(1)} title="Tháng sau">▶</Button>
        <Button variant="ghost" onClick={() => { const d = new Date(); a.setMonth(d.getFullYear(), d.getMonth() + 1); }}>Tháng hiện tại</Button>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <Button variant="primary" disabled={!!sheet || !a.can('sheet.edit')} onClick={async () => {
          const r = await a.createSheet();
          toast(r.ok ? `Đã tạo bảng ${formatMonth(year, month)} với ${r.data!.employeeIds.length} nhân sự.` : r.message!, r.ok ? 'success' : 'error');
        }}>
          Tạo bảng chấm công
        </Button>
        <Button onClick={async () => { const r = await a.saveNow(); toast(r.ok ? 'Tất cả thay đổi đã được lưu trên thiết bị này.' : r.message!, r.ok ? 'success' : 'error'); }}>Lưu</Button>
        <Button disabled={!sheet || sheet.locked || !a.can('data.import')} onClick={() => setImportOpen(true)}>Nhập Excel</Button>
        <Button disabled={!sheet || !a.can('export')} onClick={exportExcel}>Xuất Excel</Button>
        {!isArtifactHost() && <Button disabled={!sheet} onClick={() => window.print()}>In</Button>}
        <Button disabled={!a.can('data.backup')} onClick={backup}>Sao lưu</Button>
        <Button onClick={() => onNavigate('du_lieu')}>Phục hồi</Button>
        {sheet && (a.can(sheet.locked ? 'sheet.unlock' : 'sheet.lock')) && (
          <Button variant={sheet.locked ? 'secondary' : 'success'} onClick={lockToggle}>{sheet.locked ? 'Mở khóa tháng' : 'Khóa tháng'}</Button>
        )}
        <Button variant="ghost" disabled={!undoCount} onClick={async () => { const r = await a.undoLast(); toast(r.message ?? '', r.ok ? 'success' : 'error'); }}>
          ↶ Hoàn tác
        </Button>
      </div>

      {/* B. Thẻ thống kê */}
      <div className="no-print grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Nhân sự đang hoạt động" value={activeCount} sub={sheet ? `${sheet.employeeIds.length} người trong bảng` : 'Chưa tạo bảng'} />
        <Stat label="Số ngày trong tháng" value={daysInMonth(year, month)} sub={`${standardWorkingDays(days)} ngày làm việc hành chính`} />
        <Stat label="Tổng công quy đổi" value={summary ? formatNumber(summary.totalConverted) : '–'} sub={summary ? `${summary.totalActualWork} ngày làm việc thực tế` : ''} />
        <Stat label="Ô thiếu / cần kiểm tra" value={summary ? summary.missingCells + summary.invalidCells : '–'} sub={summary ? `${summary.missingCells} trống, ${summary.invalidCells} mã sai` : ''} tone={summary && summary.missingCells + summary.invalidCells > 0 ? 'amber' : undefined} />
        <Stat label="Nhân sự có dữ liệu bất thường" value={summary ? summary.abnormalEmployees : '–'} tone={summary && summary.abnormalEmployees > 0 ? 'red' : undefined} sub={summary?.abnormalEmployees ? 'Bấm "Xem cảnh báo"' : ''} />
      </div>

      {/* C. Bảng chấm công */}
      <Card
        printHeader={false}
        title={
          <span className="flex items-center gap-2">
            Bảng chấm công tháng {formatMonth(year, month)}
            {sheet?.locked && <Badge color="blue">Đã khóa {sheet.lockedBy ? `bởi ${sheet.lockedBy}` : ''}</Badge>}
            {unit.isSample && <Badge color="purple">DỮ LIỆU MẪU</Badge>}
            <span className="text-xs font-normal text-slate-500">Lịch: {calendar.mode === 'truc_ca' ? 'trực ca 24/7' : 'hành chính'}</span>
          </span>
        }
        actions={
          sheet && (
            <div className="no-print flex flex-wrap gap-2">
              <Input className="w-48" placeholder="Tìm mã NV, họ tên…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {departments.length > 1 && (
                <Select className="w-40" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">Tất cả bộ phận</option>
                  {departments.map((d) => <option key={d}>{d}</option>)}
                </Select>
              )}
              {summary && summary.issues.length + summary.missingCells > 0 && (
                <Button small onClick={() => setShowIssues((v) => !v)}>{showIssues ? 'Ẩn' : 'Xem'} cảnh báo ({summary.issues.length})</Button>
              )}
            </div>
          )
        }
      >
        {!sheet ? (
          <EmptyState>
            Chưa có bảng chấm công tháng {formatMonth(year, month)}.{' '}
            {a.can('sheet.edit') ? 'Bấm "Tạo bảng chấm công" để tạo bảng từ danh sách nhân sự hiện có (không ảnh hưởng các tháng khác).' : ''}
            {!allCodes.length && <div className="mt-2 text-amber-700">Đơn vị chưa có mã công – khai báo ở thẻ "Mã công" trước.</div>}
          </EmptyState>
        ) : (
          <>
            <PrintHeader title={unit.template.title} unitName={sheet.lockSnapshot?.unitName ?? unit.name} parentOrg={sheet.lockSnapshot?.parentOrg ?? unit.parentOrg} year={year} month={month} />
            {showIssues && summary && <IssueList summary={summary} rows={rowsAll} />}
            <AttendanceGrid
              key={sheet.id}
              rows={rows}
              days={days}
              codes={codes}
              sumCodes={sumCodes}
              summaryRows={summary!.rows}
              cells={sheet.cells}
              cellNotes={sheet.cellNotes}
              rowNotes={sheet.rowNotes}
              readOnly={sheet.locked || !a.can('sheet.edit')}
              showPosition={unit.template.showPosition}
              onDetail={(row) => setDetail({ row, sum: summary!.rows[row.employeeId] })}
            />
            <Legend codes={codes} days={days} weekendColor={unit.template.weekendColor} holidayColor={unit.template.holidayColor} />
            <PrintSigners signers={unit.template.signers} place={unit.template.place} year={year} />
          </>
        )}
      </Card>

      {importOpen && sheet && <ImportAttendanceDialog onClose={() => setImportOpen(false)} />}
      {detail && (
        <Modal title={`Chi tiết cách tính – ${detail.row.code} ${detail.row.fullName}`} onClose={() => setDetail(null)}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {detail.sum.explanation.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {Object.keys(detail.sum.groupCounts).length > 0 && (
            <div className="mt-3 text-sm">
              <div className="font-medium">Theo nhóm công:</div>
              {unit.codeGroups.map((g) => detail.sum.groupCounts[g.id] ? <div key={g.id}>{g.name}: {detail.sum.groupCounts[g.id]} ngày</div> : null)}
            </div>
          )}
          {detail.sum.missingDays.length > 0 && <p className="mt-3 text-sm text-amber-700">Ngày chưa ghi mã: {detail.sum.missingDays.join(', ')}</p>}
          {detail.sum.issues.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-red-700">{detail.sum.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function YearInput({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const [text, setText] = useState(String(year));
  useEffect(() => setText(String(year)), [year]);
  return (
    <Input
      className="w-24"
      type="number"
      min={1900}
      max={2100}
      value={text}
      aria-label="Chọn năm"
      onChange={(e) => {
        setText(e.target.value);
        const y = Number(e.target.value);
        if (Number.isInteger(y) && y >= 1900 && y <= 2100) onChange(y);
      }}
      onBlur={() => setText(String(year))}
    />
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

function IssueList({ summary, rows }: { summary: NonNullable<ReturnType<typeof computeSheetSummary>>; rows: SheetRowSnapshot[] }) {
  const byId = new Map(rows.map((r) => [r.employeeId, r]));
  const list = rows
    .map((r) => ({ r, s: summary.rows[r.employeeId] }))
    .filter(({ s }) => s && (s.issues.length || s.missingDays.length));
  return (
    <div className="no-print mb-3 max-h-56 overflow-y-auto rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      {list.length === 0 && <div>Không có cảnh báo.</div>}
      {list.map(({ r, s }) => (
        <div key={r.employeeId} className="mb-1">
          <b>{byId.get(r.employeeId)?.code} – {r.fullName}:</b>{' '}
          {s.missingDays.length > 0 && <span className="text-amber-800">trống {s.missingDays.length} ngày ({s.missingDays.join(', ')}). </span>}
          {s.issues.map((i, k) => <span key={k} className="text-red-700">{i.message} </span>)}
        </div>
      ))}
    </div>
  );
}

function Legend({ codes, days, weekendColor, holidayColor }: { codes: AttendanceCode[]; days: DayInfo[]; weekendColor: string; holidayColor: string }) {
  const holidays = days.filter((d) => d.holiday);
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="font-medium">Ký hiệu:</span>
      {codes.filter((c) => c.active).map((c) => (
        <span key={c.id}><span className="rounded px-1 font-semibold" style={{ background: c.color }}>{c.code}</span> {c.name}</span>
      ))}
      <span><span className="inline-block h-3 w-3 align-middle" style={{ background: weekendColor }} /> Cuối tuần</span>
      <span><span className="inline-block h-3 w-3 align-middle" style={{ background: holidayColor }} /> Ngày lễ/nghỉ đơn vị</span>
      {holidays.map((d) => <span key={d.day}>Ngày {d.day}: {d.holiday!.name}</span>)}
    </div>
  );
}

function PrintHeader({ title, unitName, parentOrg, year, month }: { title: string; unitName: string; parentOrg: string; year: number; month: number }) {
  return (
    <div className="print-only mb-2 text-center">
      <div className="text-left text-xs">{parentOrg}<br /><b>Đơn vị: {unitName}</b></div>
      <div className="text-lg font-bold">{title}</div>
      <div className="italic">Tháng {pad2(month)} năm {year}</div>
    </div>
  );
}

function PrintSigners({ signers, place, year }: { signers: { title: string; name: string }[]; place: string; year: number }) {
  return (
    <div className="print-only mt-4 text-sm">
      <div className="text-right italic">{place ? `${place}, ` : ''}ngày ..... tháng ..... năm {year}</div>
      <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${signers.length}, 1fr)` }}>
        {signers.map((s, i) => (
          <div key={i} className="text-center">
            <div className="font-bold">{s.title}</div>
            <div className="text-xs italic">(Ký, ghi rõ họ tên)</div>
            <div className="mt-16 font-bold">{s.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= LƯỚI CHẤM CÔNG =======================

interface GridProps {
  rows: SheetRowSnapshot[];
  days: DayInfo[];
  codes: AttendanceCode[];
  sumCodes: AttendanceCode[];
  summaryRows: Record<string, EmployeeSummary>;
  cells: Record<string, Record<string, string>>;
  cellNotes: Record<string, Record<string, string>>;
  rowNotes: Record<string, string>;
  readOnly: boolean;
  showPosition: boolean;
  onDetail: (row: SheetRowSnapshot) => void;
}

function AttendanceGrid(props: GridProps) {
  const { rows, days, codes, readOnly } = props;
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null);
  const dragging = useRef(false);
  const clip = useRef<string[][] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const activeCodes = useMemo(() => codes.filter((c) => c.active), [codes]);
  const colorOf = useMemo(() => new Map(codes.map((c) => [c.code, c.color])), [codes]);

  const sel = anchor && focus
    ? { r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c) }
    : null;

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const valueAt = (r: number, c: number) => props.cells[rows[r]?.employeeId]?.[String(c + 1)] ?? '';

  const selectionEdits = (value: string): CellEdit[] => {
    if (!sel) return [];
    const out: CellEdit[] = [];
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) out.push({ employeeId: rows[r].employeeId, day: c + 1, value });
    return out;
  };

  /** Ghi ô, xác nhận trước nếu ghi đè dữ liệu đã có trên nhiều ô. */
  const apply = async (edits: CellEdit[], opts: { confirmOverwrite?: boolean; reason?: string } = {}) => {
    if (readOnly || !edits.length) return;
    const sheet = a.currentSheet();
    if (!sheet) return;
    const over = overwrittenCells(sheet, edits);
    if (opts.confirmOverwrite !== false && edits.length > 1 && over.length > 0) {
      const okk = await dialog.confirm({
        title: 'Xác nhận ghi đè',
        message: `${over.length} ô đang có mã công sẽ bị thay đổi (trong tổng ${edits.length} ô được chọn). Tiếp tục?`,
        confirmText: 'Ghi đè',
        danger: true,
      });
      if (!okk) return;
    }
    const r = await a.editCells(edits, opts.reason);
    if (!r.ok) toast(r.message ?? 'Không ghi được.', 'error');
    else if (r.message) toast(r.message, 'warning');
  };

  const move = (dr: number, dc: number, extend: boolean) => {
    const base = focus ?? { r: 0, c: 0 };
    const next = { r: Math.max(0, Math.min(rows.length - 1, base.r + dr)), c: Math.max(0, Math.min(days.length - 1, base.c + dc)) };
    setFocus(next);
    if (!extend) setAnchor(next);
    document.getElementById(`cell-${next.r}-${next.c}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const editingRef = useRef(editing);
  editingRef.current = editing;
  const commitEdit = async (value: string, then?: () => void) => {
    const cur = editingRef.current;
    if (!cur) return;
    editingRef.current = null; // chặn ghi hai lần (Enter rồi blur)
    setEditing(null);
    const raw = value.trim();
    if (raw && !findCode(activeCodes, raw)) {
      toast(`Mã "${raw}" không có trong danh mục hoặc đã ngừng sử dụng.`, 'error');
      wrap.current?.focus();
      return;
    }
    await apply([{ employeeId: rows[cur.pos.r].employeeId, day: cur.pos.c + 1, value: raw }]);
    wrap.current?.focus();
    then?.();
  };

  const clearSelection = async () => {
    const edits = selectionEdits('').filter((e) => valueAt(rows.findIndex((r) => r.employeeId === e.employeeId), e.day - 1));
    if (!edits.length) return;
    if (edits.length > 1) {
      const okk = await dialog.confirm({ title: 'Xóa mã công', message: `Xóa ${edits.length} ô đang có dữ liệu?`, danger: true, confirmText: 'Xóa' });
      if (!okk) return;
    }
    await apply(edits, { confirmOverwrite: false });
  };

  const copy = () => {
    if (!sel) return '';
    const grid: string[][] = [];
    for (let r = sel.r1; r <= sel.r2; r++) {
      const line: string[] = [];
      for (let c = sel.c1; c <= sel.c2; c++) line.push(valueAt(r, c));
      grid.push(line);
    }
    clip.current = grid;
    return grid.map((l) => l.join('\t')).join('\n');
  };

  const paste = async (grid: string[][]) => {
    if (!focus || readOnly) return;
    const start = sel ? { r: sel.r1, c: sel.c1 } : focus;
    const edits: CellEdit[] = [];
    grid.forEach((line, i) =>
      line.forEach((v, j) => {
        const r = start.r + i;
        const c = start.c + j;
        if (r < rows.length && c < days.length) edits.push({ employeeId: rows[r].employeeId, day: c + 1, value: v.trim() });
      }),
    );
    await apply(edits, { reason: 'Dán dữ liệu' });
  };

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (editing) return;
    const k = e.key;
    if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0, e.shiftKey); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(1, 0, e.shiftKey); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1, e.shiftKey); }
    else if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); move(0, 1, e.shiftKey && k !== 'Tab'); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); const r = await a.undoLast(); if (r.message) toast(r.message, r.ok ? 'success' : 'error'); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setFocus({ r: rows.length - 1, c: days.length - 1 }); }
    else if (readOnly || !focus) return;
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); await clearSelection(); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); setEditing({ pos: focus, value: valueAt(focus.r, focus.c) }); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setAnchor(focus); setEditing({ pos: focus, value: k }); }
  };

  const handlers = useRef({
    down: (_r: number, _c: number, _shift: boolean) => {},
    enter: (_r: number, _c: number) => {},
    dbl: (_r: number, _c: number) => {},
  });
  handlers.current.down = (r, c, shift) => {
    wrap.current?.focus();
    if (shift && anchor) setFocus({ r, c });
    else { setAnchor({ r, c }); setFocus({ r, c }); }
    dragging.current = true;
  };
  handlers.current.enter = (r, c) => dragging.current && setFocus({ r, c });
  handlers.current.dbl = (r, c) => !readOnly && setEditing({ pos: { r, c }, value: valueAt(r, c) });
  const stable = useMemo(() => ({
    down: (r: number, c: number, s: boolean) => handlers.current.down(r, c, s),
    enter: (r: number, c: number) => handlers.current.enter(r, c),
    dbl: (r: number, c: number) => handlers.current.dbl(r, c),
  }), []);

  const focusRow = focus ? rows[focus.r] : null;
  const focusNote = focusRow && focus ? props.cellNotes[focusRow.employeeId]?.[String(focus.c + 1)] : undefined;

  const editNote = async () => {
    if (!focus || !focusRow) return;
    const v = await dialog.prompt({
      title: `Ghi chú ô – ${focusRow.code} ngày ${focus.c + 1}`,
      label: 'Ghi chú / lý do điều chỉnh',
      initial: focusNote ?? '',
      multiline: true,
      confirmText: 'Lưu ghi chú',
    });
    if (v === null) return;
    const r = await a.setCellNote(focusRow.employeeId, focus.c + 1, v);
    toast(r.ok ? 'Đã lưu ghi chú.' : r.message!, r.ok ? 'success' : 'error');
  };

  const editRowNote = useCallback(async (row: SheetRowSnapshot) => {
    if (readOnly) return;
    const v = await dialog.prompt({ title: `Ghi chú – ${row.code} ${row.fullName}`, label: 'Ghi chú', initial: props.rowNotes[row.employeeId] ?? '', multiline: true });
    if (v === null) return;
    const r = await a.setRowNote(row.employeeId, v);
    if (!r.ok) toast(r.message!, 'error');
  }, [readOnly, props.rowNotes, a, dialog, toast]);

  const selCount = sel ? (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) : 0;

  return (
    <div>
      {!readOnly && (
        <div className="no-print mb-2 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-slate-600">{selCount ? `Đã chọn ${selCount} ô.` : 'Chọn ô (kéo chuột / Shift+mũi tên) rồi bấm mã hoặc gõ trực tiếp:'}</span>
          {activeCodes.map((c) => (
            <button
              key={c.id}
              disabled={!selCount}
              title={c.name}
              onClick={() => apply(selectionEdits(c.code))}
              className="rounded border border-slate-300 px-2 py-0.5 font-semibold hover:ring-2 hover:ring-blue-400 disabled:opacity-40"
              style={{ background: c.color }}
            >
              {c.code}
            </button>
          ))}
          <Button small variant="ghost" disabled={!selCount} onClick={clearSelection}>Xóa ô</Button>
          <Button small variant="ghost" disabled={!focus} onClick={editNote}>Ghi chú ô{focusNote ? ' ✎' : ''}</Button>
          <Button small variant="ghost" disabled={!selCount} onClick={() => { copy(); toast('Đã sao chép vùng chọn.', 'info'); }}>Sao chép</Button>
          <Button small variant="ghost" disabled={!focus || !clip.current} onClick={() => clip.current && paste(clip.current)}>Dán</Button>
        </div>
      )}
      {readOnly && <div className="no-print mb-2 text-sm text-slate-500">Chế độ chỉ xem (bảng đã khóa hoặc tài khoản không có quyền sửa).</div>}
      {focusNote && <div className="no-print mb-2 rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-900">Ghi chú ô: {focusNote}</div>}
      <div
        ref={wrap}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={(e) => { const t = copy(); if (t) { e.clipboardData.setData('text/plain', t); e.preventDefault(); } }}
        onPaste={(e) => {
          if (editing) return;
          const t = e.clipboardData.getData('text/plain');
          if (!t) return;
          e.preventDefault();
          paste(t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t')));
        }}
        className="print-area relative max-h-[65vh] select-none overflow-auto rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-slate-100">
            <tr>
              <th className="sticky left-0 z-30 border border-slate-300 bg-slate-100 px-1" rowSpan={2}>STT</th>
              <th className="sticky left-8 z-30 border border-slate-300 bg-slate-100 px-1" rowSpan={2}>Mã NV</th>
              <th className="sticky left-[5.5rem] z-30 min-w-[11rem] border border-slate-300 bg-slate-100 px-1 text-left" rowSpan={2}>Họ và tên</th>
              {props.showPosition && <th className="border border-slate-300 px-1" rowSpan={2}>Chức vụ</th>}
              {days.map((d) => (
                <th key={d.day} className="grid-cell border border-slate-300 font-semibold" style={dayStyle(d)} title={`${d.weekdayLabel} ${d.date}${d.holiday ? ' – ' + d.holiday.name : ''}`}>
                  {d.day}
                </th>
              ))}
              {props.sumCodes.map((c) => <th key={c.id} className="border border-slate-300 bg-blue-50 px-1" rowSpan={2} title={c.name}>{c.code}</th>)}
              <th className="border border-slate-300 bg-blue-50 px-1" rowSpan={2} title="Ngày làm việc thực tế">LVTT</th>
              <th className="border border-slate-300 bg-blue-100 px-1" rowSpan={2} title="Tổng công quy đổi">Tổng công</th>
              <th className="min-w-[8rem] border border-slate-300 px-1" rowSpan={2}>Ghi chú</th>
            </tr>
            <tr>
              {days.map((d) => (
                <th key={d.day} className={`border border-slate-300 font-normal ${d.weekday === 0 ? 'text-red-700' : ''}`} style={dayStyle(d)}>{d.weekdayShort}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <GridRow
                key={row.employeeId}
                r={r}
                row={row}
                days={days}
                cellsRow={props.cells[row.employeeId]}
                notesRow={props.cellNotes[row.employeeId]}
                rowNote={props.rowNotes[row.employeeId]}
                sum={props.summaryRows[row.employeeId]}
                sumCodes={props.sumCodes}
                colorOf={colorOf}
                showPosition={props.showPosition}
                selC1={sel && r >= sel.r1 && r <= sel.r2 ? sel.c1 : -1}
                selC2={sel && r >= sel.r1 && r <= sel.r2 ? sel.c2 : -1}
                focusC={focus && focus.r === r ? focus.c : -1}
                editC={editing && editing.pos.r === r ? editing.pos.c : -1}
                editValue={editing && editing.pos.r === r ? editing.value : ''}
                h={stable}
                onEditChange={(v) => setEditing((e) => (e ? { ...e, value: v } : e))}
                onCommit={(v, next) => commitEdit(v, next ? () => move(0, 1, false) : undefined)}
                onCancel={() => { setEditing(null); wrap.current?.focus(); }}
                onDetail={props.onDetail}
                onRowNote={editRowNote}
              />
            ))}
            {!rows.length && (
              <tr><td colSpan={days.length + 8} className="p-4 text-center text-slate-500">Không có nhân sự phù hợp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
        <datalist id="code-list">{activeCodes.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}</datalist>
      </div>
      <p className="no-print mt-1 text-xs text-slate-500">
        Mẹo: gõ mã để nhập; Enter/F2 sửa ô; Delete xóa; Ctrl+C / Ctrl+V sao chép – dán; Ctrl+Z hoàn tác; nhấp đúp ô "Tổng công" để xem cách tính; nhấp ô "Ghi chú" để ghi chú dòng.
      </p>
    </div>
  );
}

function dayStyle(d: DayInfo): React.CSSProperties | undefined {
  if (d.holiday) return { background: '#fecaca' };
  if (d.isWeekend) return { background: '#e5e7eb' };
  return undefined;
}

interface RowProps {
  r: number;
  row: SheetRowSnapshot;
  days: DayInfo[];
  cellsRow?: Record<string, string>;
  notesRow?: Record<string, string>;
  rowNote?: string;
  sum?: EmployeeSummary;
  sumCodes: AttendanceCode[];
  colorOf: Map<string, string>;
  showPosition: boolean;
  selC1: number;
  selC2: number;
  focusC: number;
  editC: number;
  editValue: string;
  h: { down: (r: number, c: number, s: boolean) => void; enter: (r: number, c: number) => void; dbl: (r: number, c: number) => void };
  onEditChange: (v: string) => void;
  onCommit: (v: string, next: boolean) => void;
  onCancel: () => void;
  onDetail: (row: SheetRowSnapshot) => void;
  onRowNote: (row: SheetRowSnapshot) => void;
}

const GridRow = memo(function GridRow(p: RowProps) {
  const { r, row, days, sum } = p;
  const abnormal = sum?.abnormal;
  return (
    <tr className="hover:bg-slate-50">
      <td className="sticky left-0 z-10 border border-slate-300 bg-white px-1 text-center">{r + 1}</td>
      <td className="sticky left-8 z-10 border border-slate-300 bg-white px-1">{row.code}</td>
      <td className={`sticky left-[5.5rem] z-10 whitespace-nowrap border border-slate-300 bg-white px-1 ${abnormal ? 'text-red-700' : ''}`} title={abnormal ? sum?.issues.map((i) => i.message).join('\n') : undefined}>
        {row.fullName}{abnormal ? ' ⚠' : ''}
      </td>
      {p.showPosition && <td className="whitespace-nowrap border border-slate-300 px-1">{row.position}</td>}
      {days.map((d, c) => {
        const v = p.cellsRow?.[String(d.day)] ?? '';
        const selected = c >= p.selC1 && c <= p.selC2 && p.selC1 >= 0;
        const note = p.notesRow?.[String(d.day)];
        const bg = v ? p.colorOf.get(v) ?? '#fecaca' : d.holiday ? '#fee2e2' : d.isWeekend ? '#f1f5f9' : undefined;
        if (c === p.editC) {
          return (
            <td key={d.day} className="grid-cell border border-blue-500 p-0">
              <input
                autoFocus
                list="code-list"
                className="h-full w-full px-0.5 text-center text-xs outline-none"
                value={p.editValue}
                onChange={(e) => p.onEditChange(e.target.value)}
                onBlur={(e) => p.onCommit(e.target.value, false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); p.onCommit((e.target as HTMLInputElement).value, true); }
                  if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
                }}
              />
            </td>
          );
        }
        return (
          <td
            key={d.day}
            id={`cell-${r}-${c}`}
            className={`grid-cell relative cursor-cell border border-slate-300 text-center font-semibold ${selected ? 'sel' : ''} ${c === p.focusC ? 'focus-cell' : ''}`}
            style={{ background: bg }}
            onMouseDown={(e) => { e.preventDefault(); p.h.down(r, c, e.shiftKey); }}
            onMouseEnter={() => p.h.enter(r, c)}
            onDoubleClick={() => p.h.dbl(r, c)}
            title={note ? `Ghi chú: ${note}` : `${row.fullName} – ${d.weekdayLabel} ${d.day}`}
          >
            {v}
            {note && <span className="absolute right-0 top-0 h-0 w-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-amber-500" />}
          </td>
        );
      })}
      {p.sumCodes.map((c) => <td key={c.id} className="border border-slate-300 bg-blue-50/50 px-1 text-center">{sum?.counts[c.code] || ''}</td>)}
      <td className="border border-slate-300 bg-blue-50/50 px-1 text-center">{sum?.actualWorkDays ?? ''}</td>
      <td className="cursor-pointer border border-slate-300 bg-blue-100/60 px-1 text-center font-bold hover:underline" onClick={() => p.onDetail(row)} title="Xem cách tính">
        {sum ? formatNumber(sum.convertedTotal) : ''}
      </td>
      <td className="max-w-[12rem] cursor-pointer truncate border border-slate-300 px-1" onClick={() => p.onRowNote(row)} title={p.rowNote}>{p.rowNote}</td>
    </tr>
  );
});
