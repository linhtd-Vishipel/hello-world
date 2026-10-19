import { useMemo, useState } from 'react';
import { formatMonth } from '../../domain/calendar';
import { IMPORT_MODE_LABELS, parseAttendanceWorkbook, planAttendanceImport, type ImportMode, type ParsedAttendance } from '../../excel/import';
import { Badge, Button, Modal, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';
import { pickFile, readFileBytes } from '../download';

export function ImportAttendanceDialog({ onClose }: { onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const employees = useApp((s) => s.employees);
  const codes = useApp((s) => s.codes);
  const sheets = useApp((s) => s.sheets);
  const year = useApp((s) => s.year);
  const month = useApp((s) => s.month);
  const sheet = sheets.find((s) => s.year === year && s.month === month)!;
  const [file, setFile] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedAttendance | null>(null);
  const [mode, setMode] = useState<ImportMode>('add');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => (parsed ? planAttendanceImport(parsed, sheet, employees, codes, mode) : null), [parsed, sheet, employees, codes, mode]);

  const choose = async () => {
    const f = await pickFile('.xlsx');
    if (!f) return;
    try {
      setBusy(true);
      setParsed(await parseAttendanceWorkbook(await readFileBytes(f)));
      setFile(f.name);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!plan) return;
    if (plan.monthMismatch) {
      const okk = await dialog.confirm({ title: 'Tháng không khớp', message: plan.monthMismatch + ' Vẫn nhập vào bảng hiện tại?', danger: true });
      if (!okk) return;
    }
    if (plan.overwrites > 0) {
      const okk = await dialog.confirm({
        title: 'Xác nhận ghi đè',
        message: `${plan.overwrites} ô đang có dữ liệu sẽ bị thay đổi. Ứng dụng sẽ tạo điểm khôi phục trước khi ghi.`,
        danger: true,
        confirmText: 'Ghi đè và nhập',
      });
      if (!okk) return;
    }
    setBusy(true);
    const r = await a.applyAttendanceImport(plan);
    setBusy(false);
    if (!r.ok) return toast(r.message ?? 'Nhập thất bại.', 'error');
    toast(`Đã nhập ${r.data?.applied.length ?? 0} ô từ ${file}.`, 'success');
    onClose();
  };

  return (
    <Modal
      wide
      title={`Nhập chấm công từ Excel vào bảng ${formatMonth(year, month)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" disabled={!plan || !plan.edits.length || busy} onClick={confirm}>
            Xác nhận nhập {plan ? `(${plan.edits.length} ô)` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3">
          <Button onClick={choose} disabled={busy}>Chọn file .xlsx…</Button>
          <span className="text-slate-600">{file || 'Chưa chọn file'}</span>
        </div>
        <p className="text-xs text-slate-500">
          File cần có dòng tiêu đề chứa "Mã NV" và "Họ và tên", cùng dãy cột ngày 1, 2, 3… Dữ liệu chỉ được ghi sau khi bấm "Xác nhận nhập". File xuất từ ứng dụng này có thể nhập lại trực tiếp.
        </p>
        {parsed && plan && (
          <>
            <div className="rounded bg-slate-50 p-3">
              <div>Trang tính: <b>{parsed.sheetName}</b> · Dòng tiêu đề: {parsed.headerRow} · {parsed.rows.length} dòng nhân sự · {Object.keys(parsed.dayCols).length} cột ngày</div>
              {parsed.detectedYear && <div>Tháng ghi trong file: {formatMonth(parsed.detectedYear, parsed.detectedMonth ?? 1)}</div>}
            </div>
            <fieldset className="space-y-1">
              <legend className="mb-1 font-medium">Phương án nhập</legend>
              {(Object.keys(IMPORT_MODE_LABELS) as ImportMode[]).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {IMPORT_MODE_LABELS[m]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Badge color="green">Khớp: {plan.matched.length} nhân sự</Badge>
              <Badge color="blue">Ô sẽ ghi: {plan.edits.length}</Badge>
              <Badge color={plan.overwrites ? 'red' : 'slate'}>Ô bị ghi đè: {plan.overwrites}</Badge>
              <Badge color={plan.unknownEmployees.length ? 'amber' : 'slate'}>Mã NV không tồn tại: {plan.unknownEmployees.length}</Badge>
              <Badge color={plan.invalidCells.length ? 'amber' : 'slate'}>Ô mã không hợp lệ: {plan.invalidCells.length}</Badge>
            </div>
            {plan.monthMismatch && <p className="font-medium text-red-700">⚠ {plan.monthMismatch}</p>}
            {plan.extraDays.length > 0 && <p className="text-amber-700">Bỏ qua cột ngày không có trong tháng: {plan.extraDays.join(', ')}.</p>}
            {[...plan.warnings].map((w, i) => <p key={i} className="text-amber-700">⚠ {w}</p>)}
            <Section title="Mã nhân viên không tồn tại trong đơn vị (bỏ qua)" items={plan.unknownEmployees.map((u) => `Dòng ${u.rowNumber}: ${u.code} – ${u.name}`)} />
            <Section title="Nhân sự không thuộc bảng tháng này (bỏ qua)" items={plan.notInSheet.map((u) => `Dòng ${u.rowNumber}: ${u.code} – ${u.name}`)} />
            <Section title="Dòng trùng mã nhân viên (bỏ qua)" items={plan.duplicateRows.map((u) => `Dòng ${u.rowNumber}: ${u.code}`)} />
            <Section title="Ô có mã công không hợp lệ (bỏ qua, không tự thay thế)" items={plan.invalidCells.map((c) => `Dòng ${c.rowNumber} (${c.code}) ngày ${c.day}: "${c.value}" – ${c.reason}`)} />
            <Section title="Họ tên trong file khác dữ liệu hiện có (vẫn khớp theo mã NV)" items={plan.matched.filter((m) => m.nameMismatch).map((m) => `${m.code}: file "${m.fileName}" ≠ "${m.currentName}"`)} />
          </>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="rounded border border-amber-200 bg-amber-50 p-2" open={items.length <= 10}>
      <summary className="cursor-pointer font-medium">{title} ({items.length})</summary>
      <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </details>
  );
}
