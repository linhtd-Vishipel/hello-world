import { useState } from 'react';
import { WEEKDAY_LABELS } from '../../../domain/calendar';
import { WORK_TYPE_LABELS } from '../../../domain/roster/config';
import type { StaffProfile, WorkType } from '../../../domain/roster/types';
import type { EmployeeDraft } from '../../../domain/employees';
import type { Employee } from '../../../domain/types';
import type { TabId } from '../../App';
import { Badge, Button, Card, Field, Input, Modal, Select, useDialog, useToast } from '../../components/ui';
import { useActions, useApp } from '../../context';
import { EmployeeForm } from '../EmployeesPanel';
import type { RosterData } from './RosterPanel';

export function RosterStaffTab({ data, onNavigate }: { data: RosterData; onNavigate: (t: TabId) => void }) {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const employees = useApp((s) => s.employees);
  const [edit, setEdit] = useState<StaffProfile | null>(null);
  const [empForm, setEmpForm] = useState<EmployeeDraft | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const { config, roster, ctx } = data;
  const list = employees.filter((e) => showInactive || e.status === 'active');
  const posName = (id: string) => config.positions.find((p) => p.id === id)?.short ?? '?';

  const toggleStatus = async (e: Employee) => {
    const to = e.status === 'active' ? 'inactive' : 'active';
    const preview = a.previewEmployee({ ...e, status: to });
    const okk = await dialog.confirm({
      title: to === 'inactive' ? 'Tạm ngừng nhân sự' : 'Cho làm việc trở lại',
      message: (
        <div className="space-y-1">
          <p>{e.fullName} sẽ {to === 'inactive' ? 'chuyển trạng thái "Đã nghỉ" (giữ nguyên lịch sử chấm công)' : 'trở lại trạng thái đang làm việc'}.</p>
          {preview.added.length > 0 && <p>Thêm vào bảng chấm công: {preview.added.join(', ')}</p>}
          {preview.removed.length > 0 && <p>Bỏ khỏi bảng chấm công (chưa có dữ liệu): {preview.removed.join(', ')}</p>}
          {preview.keptWithData.length > 0 && <p className="text-amber-700">Giữ lại do đã có dữ liệu: {preview.keptWithData.join(', ')}</p>}
          <p className="text-slate-500">Lịch phân ca không tự xóa người này; tháng đang lập sẽ báo lỗi nếu còn ca được xếp ngoài thời gian làm việc.</p>
        </div>
      ),
    });
    if (!okk) return;
    const r = await a.saveEmployee({ ...e, status: to });
    toast(r.ok ? 'Đã cập nhật trạng thái.' : r.message!, r.ok ? 'success' : 'error');
  };

  const del = async (e: Employee) => {
    if (!(await dialog.confirm({ title: 'Xóa nhân sự', message: `Xóa ${e.code} – ${e.fullName}? Chỉ xóa được khi chưa có dữ liệu chấm công.`, danger: true, confirmText: 'Xóa' }))) return;
    const r = await a.deleteEmployee(e.id);
    toast(r.ok ? 'Đã xóa.' : r.message!, r.ok ? 'success' : 'error');
  };

  return (
    <Card
      title="Nhân sự tham gia phân ca"
      actions={
        <>
          {a.can('employee.manage') && <Button variant="primary" onClick={() => setEmpForm({ code: '', fullName: '', position: '', department: '', status: 'active' })}>+ Thêm nhân sự</Button>}
          <Button onClick={() => onNavigate('nhan_su')}>Mở module Nhân sự</Button>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Hiện người đã nghỉ</label>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Danh sách lấy trực tiếp từ module Nhân sự (không tạo bản sao). Mỗi người có thêm <b>hồ sơ phân ca</b>: loại công việc, nhóm trực, vị trí được đảm nhận,
        điều kiện riêng. Thêm/sửa/tạm ngừng ở đây được đồng bộ ngay với Nhân sự và Chấm công.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Mã NV</th><th className="p-2">Họ và tên</th><th className="p-2">Chức vụ</th><th className="p-2">Loại</th><th className="p-2">Nhóm</th>
              <th className="p-2">Vị trí được đảm nhận</th><th className="p-2">Điều kiện riêng</th><th className="p-2">Tháng này</th><th />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const p = config.profiles.find((x) => x.employeeId === e.id) ?? a.roster.profileFor(e.id)!;
              const saved = config.profiles.some((x) => x.employeeId === e.id);
              const st = data.stats.get(e.id);
              const inRoster = roster?.participants.includes(e.id);
              const leaves = ctx.leaves.get(e.id)?.size ?? 0;
              const cond = [
                p.primaryPositionId && `chính: ${posName(p.primaryPositionId)}`,
                p.noNight && 'không trực đêm',
                p.weekendRotation && 'luân phiên HC cuối tuần',
                p.unavailableWeekdays.length > 0 && `không làm ${p.unavailableWeekdays.map((w) => WEEKDAY_LABELS[w]).join(', ')}`,
                p.targetDays > 0 && `định mức ${p.targetDays}`,
                p.maxDays > 0 && `trần ${p.maxDays}`,
              ].filter(Boolean).join('; ');
              return (
                <tr key={e.id} className={`border-b ${e.status === 'inactive' ? 'text-slate-400' : ''}`}>
                  <td className="p-2 font-mono">{e.code}</td>
                  <td className="p-2">{e.fullName} {e.status === 'inactive' && <Badge>Đã nghỉ</Badge>}</td>
                  <td className="p-2">{e.position}</td>
                  <td className="p-2">{p.participates ? WORK_TYPE_LABELS[p.workType] : <Badge>Không phân ca</Badge>} {!saved && <span className="text-xs text-amber-700" title="Đang dùng thiết lập mặc định">(mặc định)</span>}</td>
                  <td className="p-2">{p.group}</td>
                  <td className="p-2">{p.positionIds.map(posName).join(', ') || '–'}</td>
                  <td className="p-2 text-xs">{cond || '–'}</td>
                  <td className="p-2 text-xs">
                    {!roster ? '–' : inRoster ? <>{st?.days ?? 0} ngày, {st?.nights ?? 0} đêm{leaves ? `, nghỉ ${leaves}` : ''}</> : <span className="text-slate-400">không tham gia</span>}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right">
                    {a.can('employee.manage') && (
                      <>
                        <Button small onClick={() => setEdit({ ...p })}>Thiết lập ca</Button>{' '}
                        <Button small variant="ghost" onClick={() => setEmpForm({ ...e })}>Sửa</Button>
                        <Button small variant="ghost" onClick={() => toggleStatus(e)}>{e.status === 'active' ? 'Tạm ngừng' : 'Kích hoạt'}</Button>
                        <Button small variant="ghost" className="text-red-700" onClick={() => del(e)}>Xóa</Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && <ProfileForm profile={edit} onClose={() => setEdit(null)} />}
      {empForm && <EmployeeForm draft={empForm} onClose={() => setEmpForm(null)} />}
    </Card>
  );
}

function ProfileForm({ profile, onClose }: { profile: StaffProfile; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const cfg = useApp((s) => s.shiftConfig)!;
  const emp = useApp((s) => s.employees.find((e) => e.id === profile.employeeId));
  const [p, setP] = useState(profile);
  const save = async () => {
    const r = await a.roster.saveProfile(p);
    toast(r.ok ? 'Đã lưu thiết lập phân ca.' : r.message!, r.ok ? 'success' : 'error');
    if (r.ok) onClose();
  };
  return (
    <Modal title={`Thiết lập phân ca – ${emp?.fullName ?? ''}`} onClose={onClose} footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" onClick={save}>Lưu</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={p.participates} onChange={(e) => setP({ ...p, participates: e.target.checked })} /> Tham gia phân ca</label>
        <Field label="Loại công việc">
          <Select value={p.workType} onChange={(e) => setP({ ...p, workType: e.target.value as WorkType })}>
            {(Object.keys(WORK_TYPE_LABELS) as WorkType[]).map((w) => <option key={w} value={w}>{WORK_TYPE_LABELS[w]}</option>)}
          </Select>
        </Field>
        <Field label="Nhóm trực" hint="Dùng để so sánh công bằng trong nhóm"><Input value={p.group} onChange={(e) => setP({ ...p, group: e.target.value })} /></Field>
        <Field label="Vị trí chính (khối hành chính cố định)" className="col-span-2">
          <Select value={p.primaryPositionId} onChange={(e) => setP({ ...p, primaryPositionId: e.target.value })}>
            <option value="">— Không có —</option>
            {cfg.positions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <div className="col-span-2">
          <div className="mb-1 font-medium">Vị trí được phép đảm nhận</div>
          <div className="flex flex-wrap gap-3">
            {cfg.positions.map((x) => (
              <label key={x.id} className="flex items-center gap-1">
                <input type="checkbox" checked={p.positionIds.includes(x.id)} onChange={(e) => setP({ ...p, positionIds: e.target.checked ? [...p.positionIds, x.id] : p.positionIds.filter((y) => y !== x.id) })} />
                {x.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.noNight} onChange={(e) => setP({ ...p, noNight: e.target.checked })} /> Không xếp ca đêm</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.weekendRotation} onChange={(e) => setP({ ...p, weekendRotation: e.target.checked })} /> Luân phiên hành chính cuối tuần khi thiếu người</label>
        <div className="col-span-2">
          <div className="mb-1 font-medium">Không xếp vào các ngày</div>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => (
              <label key={w} className="flex items-center gap-1">
                <input type="checkbox" checked={p.unavailableWeekdays.includes(w)} onChange={(e) => setP({ ...p, unavailableWeekdays: e.target.checked ? [...p.unavailableWeekdays, w] : p.unavailableWeekdays.filter((x) => x !== w) })} />
                {WEEKDAY_LABELS[w]}
              </label>
            ))}
          </div>
        </div>
        <Field label="Định mức công riêng" hint="0 = theo định mức chung"><Input type="number" min={0} max={31} value={p.targetDays} onChange={(e) => setP({ ...p, targetDays: Number(e.target.value) })} /></Field>
        <Field label="Trần công riêng" hint="0 = theo trần chung"><Input type="number" min={0} max={31} value={p.maxDays} onChange={(e) => setP({ ...p, maxDays: Number(e.target.value) })} /></Field>
        <Field label="Ghi chú" className="col-span-2"><Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
