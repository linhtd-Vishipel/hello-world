import { useMemo, useState } from 'react';
import { canDeleteEmployee, validateEmployee, type EmployeeDraft } from '../../domain/employees';
import type { Employee } from '../../domain/types';
import { exportEmployeesXlsx } from '../../excel/export';
import { parseEmployeeWorkbook, planEmployeeImport, type EmployeeImportPlan } from '../../excel/import';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';
import { downloadBytes, pickFile, readFileBytes, XLSX_MIME } from '../download';

type SortKey = 'order' | 'code' | 'fullName' | 'department';

export function EmployeesPanel() {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const employees = useApp((s) => s.employees);
  const sheets = useApp((s) => s.sheets);
  const units = useApp((s) => s.units);
  const unitId = useApp((s) => s.unitId);
  const unit = units.find((u) => u.id === unitId)!;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [sort, setSort] = useState<SortKey>('order');
  const [editing, setEditing] = useState<EmployeeDraft | null>(null);
  const [importPlan, setImportPlan] = useState<{ plan: EmployeeImportPlan; rows: Parameters<typeof planEmployeeImport>[0]; mode: 'add' | 'upsert' } | null>(null);
  const canManage = a.can('employee.manage');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees
      .filter((e) => status === 'all' || e.status === status)
      .filter((e) => !s || [e.code, e.fullName, e.position, e.department].some((x) => x.toLowerCase().includes(s)))
      .sort((x, y) => (sort === 'order' ? x.order - y.order : String(x[sort]).localeCompare(String(y[sort]), 'vi')));
  }, [employees, q, status, sort]);

  const del = async (e: Employee) => {
    const chk = canDeleteEmployee(e.id, sheets);
    if (!chk.ok) {
      toast(`Không xóa được: đã có dữ liệu chấm công tháng ${chk.months.join(', ')}. Hãy chuyển sang "Đã nghỉ".`, 'error');
      return;
    }
    if (!(await dialog.confirm({ title: 'Xóa nhân sự', message: `Xóa vĩnh viễn ${e.code} – ${e.fullName}? (Nhân sự chưa có dữ liệu chấm công.)`, danger: true, confirmText: 'Xóa' }))) return;
    const r = await a.deleteEmployee(e.id);
    toast(r.ok ? 'Đã xóa.' : r.message!, r.ok ? 'success' : 'error');
  };

  const importFile = async () => {
    const f = await pickFile('.xlsx');
    if (!f) return;
    try {
      const { rows, warnings } = await parseEmployeeWorkbook(await readFileBytes(f));
      warnings.forEach((w) => toast(w, 'warning'));
      setImportPlan({ rows, mode: 'upsert', plan: planEmployeeImport(rows, employees, 'upsert') });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Card
      title={`Danh sách nhân sự – ${unit.name}`}
      actions={
        <>
          {canManage && <Button variant="primary" onClick={() => setEditing({ code: '', fullName: '', position: '', department: '', status: 'active' })}>+ Thêm nhân sự</Button>}
          {canManage && a.can('data.import') && <Button onClick={importFile}>Nhập từ Excel</Button>}
          <Button onClick={async () => downloadBytes(`Danh_sach_nhan_su_${unit.code}.xlsx`, await exportEmployeesXlsx(unit, list), XLSX_MIME)}>Xuất Excel</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="w-64" placeholder="Tìm mã, họ tên, chức vụ, bộ phận…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">Đang làm việc</option>
          <option value="inactive">Đã nghỉ</option>
          <option value="all">Tất cả</option>
        </Select>
        <Select className="w-48" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="order">Sắp xếp: thứ tự hiển thị</option>
          <option value="code">Sắp xếp: mã NV</option>
          <option value="fullName">Sắp xếp: họ tên</option>
          <option value="department">Sắp xếp: bộ phận</option>
        </Select>
        <span className="self-center text-sm text-slate-500">{list.length} / {employees.length} nhân sự</span>
      </div>
      {!employees.length ? (
        <EmptyState>Chưa có nhân sự. Thêm từng người hoặc nhập danh sách từ Excel (cột: Mã NV, Họ và tên, Chức vụ, Bộ phận, Ngày bắt đầu, Ngày kết thúc, Trạng thái).</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-2">#</th><th className="p-2">Mã NV</th><th className="p-2">Họ và tên</th><th className="p-2">Chức vụ</th>
                <th className="p-2">Bộ phận</th><th className="p-2">Thời gian làm việc</th><th className="p-2">Trạng thái</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b hover:bg-slate-50">
                  <td className="p-2 text-slate-500">{e.order}</td>
                  <td className="p-2 font-mono">{e.code}</td>
                  <td className="p-2">{e.fullName}</td>
                  <td className="p-2">{e.position}</td>
                  <td className="p-2">{e.department}</td>
                  <td className="p-2 text-xs">{e.startDate ? `từ ${e.startDate}` : ''} {e.endDate ? `đến ${e.endDate}` : ''}</td>
                  <td className="p-2">{e.status === 'active' ? <Badge color="green">Đang làm việc</Badge> : <Badge>Đã nghỉ</Badge>}</td>
                  <td className="whitespace-nowrap p-2 text-right">
                    {canManage && (
                      <>
                        {sort === 'order' && status !== 'inactive' && (
                          <>
                            <Button small variant="ghost" title="Lên" onClick={() => a.moveEmployee(e.id, -1)}>↑</Button>
                            <Button small variant="ghost" title="Xuống" onClick={() => a.moveEmployee(e.id, 1)}>↓</Button>
                          </>
                        )}
                        <Button small onClick={() => setEditing({ ...e })}>Sửa</Button>{' '}
                        <Button small variant="ghost" className="text-red-700" onClick={() => del(e)}>Xóa</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EmployeeForm draft={editing} onClose={() => setEditing(null)} />}
      {importPlan && (
        <Modal
          wide
          title="Xem trước nhập danh sách nhân sự"
          onClose={() => setImportPlan(null)}
          footer={
            <>
              <Button onClick={() => setImportPlan(null)}>Hủy</Button>
              <Button
                variant="primary"
                disabled={!importPlan.plan.toCreate.length && !importPlan.plan.toUpdate.length}
                onClick={async () => {
                  const r = await a.importEmployees(importPlan.plan);
                  if (!r.ok) return toast(r.message!, 'error');
                  toast(`Đã thêm ${r.data!.created}, cập nhật ${r.data!.updated} nhân sự.${r.data!.affected.length ? ' Bảng bị ảnh hưởng: ' + r.data!.affected.join(', ') : ''}`, 'success');
                  setImportPlan(null);
                }}
              >
                Xác nhận nhập
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="flex gap-4">
              {(['upsert', 'add'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" checked={importPlan.mode === m} onChange={() => setImportPlan({ ...importPlan, mode: m, plan: planEmployeeImport(importPlan.rows, employees, m) })} />
                  {m === 'upsert' ? 'Thêm mới và cập nhật nhân sự đã có (theo mã NV)' : 'Chỉ thêm nhân sự mới'}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color="green">Thêm mới: {importPlan.plan.toCreate.length}</Badge>
              <Badge color="blue">Cập nhật: {importPlan.plan.toUpdate.length}</Badge>
              <Badge>Không đổi: {importPlan.plan.unchanged}</Badge>
              <Badge color={importPlan.plan.errors.length ? 'red' : 'slate'}>Lỗi (bỏ qua): {importPlan.plan.errors.length}</Badge>
            </div>
            {importPlan.plan.errors.length > 0 && (
              <ul className="list-disc rounded bg-red-50 p-2 pl-6 text-xs text-red-800">{importPlan.plan.errors.map((e, i) => <li key={i}>Dòng {e.rowNumber}: {e.message}</li>)}</ul>
            )}
            {importPlan.plan.warnings.length > 0 && (
              <ul className="list-disc rounded bg-amber-50 p-2 pl-6 text-xs text-amber-800">{importPlan.plan.warnings.map((e, i) => <li key={i}>Dòng {e.rowNumber}: {e.message}</li>)}</ul>
            )}
            {importPlan.plan.toCreate.length > 0 && (
              <div><b>Thêm mới:</b> {importPlan.plan.toCreate.map((d) => `${d.code} – ${d.fullName}`).join('; ')}</div>
            )}
            {importPlan.plan.toUpdate.map((u) => (
              <div key={u.employee.id} className="text-xs"><b>{u.employee.code}</b>: {u.changes.join('; ')}</div>
            ))}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function EmployeeForm({ draft, onClose }: { draft: EmployeeDraft; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const employees = useApp((s) => s.employees);
  const [d, setD] = useState<EmployeeDraft>(draft);
  const v = validateEmployee(d, employees);
  const impact = useMemo(() => (d.code && d.fullName ? a.previewEmployee(d) : null), [a, d]);
  const isNew = !draft.id;
  const set = (patch: Partial<EmployeeDraft>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    const r = await a.saveEmployee(d);
    if (!r.ok) return toast(r.message!, 'error');
    toast(`${isNew ? 'Đã thêm' : 'Đã cập nhật'} ${d.fullName}.${r.data!.affected.length ? ' Bảng được cập nhật: ' + r.data!.affected.join(', ') : ''}`, 'success');
    onClose();
  };
  return (
    <Modal
      title={isNew ? 'Thêm nhân sự' : `Sửa nhân sự ${draft.code}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" disabled={v.errors.length > 0} onClick={save}>Lưu</Button></>}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mã nhân viên *" hint={!isNew ? 'Dữ liệu chấm công gắn với nhân sự, đổi mã không làm mất dữ liệu.' : undefined}><Input value={d.code} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label="Họ và tên *"><Input value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
        <Field label="Chức vụ"><Input value={d.position} onChange={(e) => set({ position: e.target.value })} /></Field>
        <Field label="Bộ phận"><Input value={d.department} onChange={(e) => set({ department: e.target.value })} /></Field>
        <Field label="Ngày bắt đầu làm việc"><Input type="date" value={d.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || undefined })} /></Field>
        <Field label="Ngày kết thúc"><Input type="date" value={d.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} /></Field>
        <Field label="Trạng thái">
          <Select value={d.status} onChange={(e) => set({ status: e.target.value as EmployeeDraft['status'] })}>
            <option value="active">Đang làm việc</option>
            <option value="inactive">Đã nghỉ</option>
          </Select>
        </Field>
        <Field label="Ghi chú"><Input value={d.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
      {v.errors.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-red-700">{v.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {v.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">{v.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {impact && v.errors.length === 0 && (
        <div className="mt-3 rounded bg-slate-50 p-2 text-sm">
          <div className="font-medium">Ảnh hưởng đến các bảng chấm công đã tạo:</div>
          {impact.added.length > 0 && <div>• Thêm vào bảng: {impact.added.join(', ')}</div>}
          {impact.removed.length > 0 && <div>• Bỏ khỏi bảng (chưa có dữ liệu): {impact.removed.join(', ')}</div>}
          {impact.keptWithData.length > 0 && <div className="text-amber-700">• Giữ lại do đã có dữ liệu (cần kiểm tra): {impact.keptWithData.join(', ')}</div>}
          {impact.lockedUntouched.length > 0 && <div className="text-slate-600">• Bảng đã khóa không thay đổi: {impact.lockedUntouched.join(', ')}</div>}
          {!impact.added.length && !impact.removed.length && !impact.keptWithData.length && <div className="text-slate-600">• Không thay đổi danh sách dòng của bảng nào.</div>}
        </div>
      )}
    </Modal>
  );
}
