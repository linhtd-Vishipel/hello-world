import { useEffect, useState } from 'react';
import { DAY_TYPE_LABELS, DEFAULT_RULES, newPosition, newShift, shiftDuration } from '../../../domain/roster/config';
import type { DayType, RosterRules, ShiftConfig } from '../../../domain/roster/types';
import { deepClone, uid } from '../../../domain/util';
import { Badge, Button, Card, Field, Input, Select, useDialog, useToast } from '../../components/ui';
import { useActions, useApp } from '../../context';

export function RosterConfigTab() {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const cfg = useApp((s) => s.shiftConfig)!;
  const codes = useApp((s) => s.codes);
  const rosters = useApp((s) => s.rosters);
  const [d, setD] = useState<ShiftConfig>(() => deepClone(cfg));
  const [dirty, setDirty] = useState(false);
  const [newDate, setNewDate] = useState('');
  const canManage = a.can('unit.manage');
  useEffect(() => {
    setD(deepClone(cfg));
    setDirty(false);
  }, [cfg]);
  const upd = (fn: (c: ShiftConfig) => void) => {
    setD((x) => {
      const n = deepClone(x);
      fn(n);
      return n;
    });
    setDirty(true);
  };
  const setRule = <K extends keyof RosterRules>(k: K, v: RosterRules[K]) => upd((c) => { c.rules[k] = v; });
  const usedPos = (id: string) => rosters.some((r) => r.assignments.some((x) => x.positionId === id));
  const usedShift = (id: string) => rosters.some((r) => r.assignments.some((x) => x.shiftId === id));
  const unmapped = d.shifts.filter((s) => s.active && !s.attendanceCodeId);

  const save = async () => {
    const r = await a.roster.saveConfig(d);
    toast(r.ok ? 'Đã lưu cấu hình phân ca.' : r.message!, r.ok ? 'success' : 'error');
  };

  return (
    <div className="space-y-4">
      <div className="no-print sticky top-[6.5rem] z-20 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <b>Cấu hình phân ca của đơn vị</b>
        {dirty && <Badge color="amber">Có thay đổi chưa lưu</Badge>}
        {unmapped.length > 0 && <Badge color="red">{unmapped.length} ca chưa gán mã chấm công</Badge>}
        <div className="ml-auto flex gap-2">
          <Button disabled={!dirty} onClick={() => { setD(deepClone(cfg)); setDirty(false); }}>Hủy thay đổi</Button>
          <Button variant="primary" disabled={!dirty || !canManage} onClick={save}>Lưu cấu hình</Button>
        </div>
      </div>
      {!canManage && <p className="text-sm text-amber-700">Chỉ quản trị viên được sửa cấu hình phân ca.</p>}
      <fieldset disabled={!canManage} className="space-y-4">
        <Card title="Vị trí công việc" actions={<Button small onClick={() => upd((c) => { c.positions.push({ ...newPosition(), name: 'Vị trí mới', short: 'VT' }); })}>+ Thêm vị trí</Button>}>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr><th className="p-2">Tên vị trí</th><th className="p-2">Ký hiệu</th><th className="p-2">Loại</th><th className="p-2" title="0 = không giới hạn riêng">Tối đa ngày liên tiếp tại vị trí</th><th className="p-2">Ghi chú</th><th /></tr></thead>
            <tbody>
              {d.positions.map((p, i) => (
                <tr key={p.id} className="border-b">
                  <td className="p-1"><Input value={p.name} onChange={(e) => upd((c) => { c.positions[i].name = e.target.value; })} /></td>
                  <td className="p-1"><Input className="w-20" value={p.short} onChange={(e) => upd((c) => { c.positions[i].short = e.target.value; })} /></td>
                  <td className="p-1">
                    <Select value={p.kind} onChange={(e) => upd((c) => { c.positions[i].kind = e.target.value as typeof p.kind; })}>
                      <option value="truc_ca">Trực ca (theo dõi liên tục)</option>
                      <option value="hanh_chinh">Hành chính</option>
                    </Select>
                  </td>
                  <td className="p-1"><Input className="w-24" type="number" min={0} max={31} value={p.maxConsecutiveDays} onChange={(e) => upd((c) => { c.positions[i].maxConsecutiveDays = Number(e.target.value); })} /></td>
                  <td className="p-1"><Input value={p.note} onChange={(e) => upd((c) => { c.positions[i].note = e.target.value; })} /></td>
                  <td className="p-1 text-right">
                    <Button small variant="ghost" className="text-red-700" disabled={usedPos(p.id)} title={usedPos(p.id) ? 'Đã dùng trong lịch – không xóa' : ''}
                      onClick={() => upd((c) => { c.positions.splice(i, 1); c.demands = c.demands.filter((x) => x.positionId !== p.id); })}>Xóa</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">"Tối đa ngày liên tiếp tại vị trí": ví dụ nhập 2 cho vị trí khai thác để không ai làm 3 ca liên tiếp (3 ngày liền) tại vị trí đó.</p>
        </Card>

        <Card title="Danh mục ca trực" actions={<Button small onClick={() => upd((c) => { c.shifts.push({ ...newShift(), name: 'Ca mới', short: 'CM' }); })}>+ Thêm ca</Button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left"><tr><th className="p-2">Tên ca</th><th className="p-2">Ký hiệu</th><th className="p-2">Bắt đầu</th><th className="p-2">Kết thúc</th><th className="p-2">Số giờ</th><th className="p-2">Ca đêm</th><th className="p-2">Màu</th><th className="p-2">Mã chấm công tương ứng</th><th className="p-2">Dùng</th><th /></tr></thead>
              <tbody>
                {d.shifts.map((s, i) => (
                  <tr key={s.id} className="border-b">
                    <td className="p-1"><Input value={s.name} onChange={(e) => upd((c) => { c.shifts[i].name = e.target.value; })} /></td>
                    <td className="p-1"><Input className="w-16" value={s.short} onChange={(e) => upd((c) => { c.shifts[i].short = e.target.value; })} /></td>
                    <td className="p-1"><Input className="w-24" type="time" value={s.start} onChange={(e) => upd((c) => { c.shifts[i].start = e.target.value; c.shifts[i].hours = Math.round(shiftDuration(c.shifts[i]) / 6) / 10; })} /></td>
                    <td className="p-1"><Input className="w-24" type="time" value={s.end} onChange={(e) => upd((c) => { c.shifts[i].end = e.target.value; c.shifts[i].hours = Math.round(shiftDuration(c.shifts[i]) / 6) / 10; })} /></td>
                    <td className="p-1"><Input className="w-20" type="number" step="0.5" min={0.5} max={24} value={s.hours} onChange={(e) => upd((c) => { c.shifts[i].hours = Number(e.target.value); })} /></td>
                    <td className="p-1 text-center"><input type="checkbox" checked={s.isNight} onChange={(e) => upd((c) => { c.shifts[i].isNight = e.target.checked; })} /></td>
                    <td className="p-1"><Input className="h-9 w-14" type="color" value={s.color} onChange={(e) => upd((c) => { c.shifts[i].color = e.target.value; })} /></td>
                    <td className="p-1">
                      <Select className={s.attendanceCodeId ? '' : 'border-red-400'} value={s.attendanceCodeId} onChange={(e) => upd((c) => { c.shifts[i].attendanceCodeId = e.target.value; })}>
                        <option value="">— Chưa gán (không đồng bộ được) —</option>
                        {codes.filter((c) => c.active || c.id === s.attendanceCodeId).map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                      </Select>
                    </td>
                    <td className="p-1 text-center"><input type="checkbox" checked={s.active} onChange={(e) => upd((c) => { c.shifts[i].active = e.target.checked; })} /></td>
                    <td className="p-1 text-right">
                      <Button small variant="ghost" className="text-red-700" disabled={usedShift(s.id)} title={usedShift(s.id) ? 'Đã dùng trong lịch – chỉ bỏ chọn "Dùng"' : ''}
                        onClick={() => upd((c) => { c.shifts.splice(i, 1); c.demands = c.demands.filter((x) => x.shiftId !== s.id); })}>Xóa</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Ca có giờ kết thúc nhỏ hơn giờ bắt đầu được tính là kết thúc vào ngày hôm sau. Mã chấm công chọn từ danh mục "Mã công" của đơn vị – ứng dụng
            không tự suy diễn mã. Thiếu mã phù hợp thì thêm ở thẻ "Mã công" trước.
          </p>
        </Card>

        <Card title="Nhu cầu nhân sự theo ca và vị trí" actions={
          <Button small disabled={!d.shifts.length || !d.positions.length} onClick={() => upd((c) => {
            c.demands.push({ id: uid('dm'), shiftId: c.shifts[0].id, positionId: c.positions[0].id, minStaff: 1, dayTypes: ['weekday', 'weekend', 'holiday'] });
          })}>+ Thêm nhu cầu</Button>
        }>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr><th className="p-2">Ca</th><th className="p-2">Vị trí</th><th className="p-2">Số người tối thiểu</th><th className="p-2">Áp dụng cho</th><th /></tr></thead>
            <tbody>
              {d.demands.map((dm, i) => (
                <tr key={dm.id} className="border-b">
                  <td className="p-1"><Select value={dm.shiftId} onChange={(e) => upd((c) => { c.demands[i].shiftId = e.target.value; })}>{d.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}</Select></td>
                  <td className="p-1"><Select value={dm.positionId} onChange={(e) => upd((c) => { c.demands[i].positionId = e.target.value; })}>{d.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></td>
                  <td className="p-1"><Input className="w-20" type="number" min={1} max={50} value={dm.minStaff} onChange={(e) => upd((c) => { c.demands[i].minStaff = Number(e.target.value); })} /></td>
                  <td className="p-1">
                    <div className="flex gap-3">
                      {(Object.keys(DAY_TYPE_LABELS) as DayType[]).map((t) => (
                        <label key={t} className="flex items-center gap-1">
                          <input type="checkbox" checked={dm.dayTypes.includes(t)} onChange={(e) => upd((c) => {
                            c.demands[i].dayTypes = e.target.checked ? [...c.demands[i].dayTypes, t] : c.demands[i].dayTypes.filter((x) => x !== t);
                          })} />
                          {DAY_TYPE_LABELS[t]}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="p-1 text-right"><Button small variant="ghost" className="text-red-700" onClick={() => upd((c) => { c.demands.splice(i, 1); })}>Xóa</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Ngày lễ lấy từ "Thiết lập đơn vị → Ngày lễ". Ngày làm việc đặc biệt (làm bù) ở mục Quy tắc được tính như ngày thường.</p>
        </Card>

        <Card title="Quy tắc phân ca" actions={<Button small onClick={async () => {
          if (await dialog.confirm({ title: 'Khôi phục quy tắc mặc định', message: 'Đặt lại các quy tắc về giá trị mặc định (chưa lưu cho đến khi bấm Lưu cấu hình)?' })) {
            upd((c) => { c.rules = { ...DEFAULT_RULES, specialWorkdays: c.rules.specialWorkdays }; });
          }
        }}>Mặc định</Button>}>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <Field label="Trần công/tháng"><Input type="number" min={1} max={31} value={d.rules.monthlyCap} onChange={(e) => setRule('monthlyCap', Number(e.target.value))} /></Field>
            <Field label="Định mức công/tháng" hint="0 = số ngày làm việc hành chính của tháng"><Input type="number" min={0} max={31} value={d.rules.monthlyTarget} onChange={(e) => setRule('monthlyTarget', Number(e.target.value))} /></Field>
            <Field label="Ngưỡng chênh lệch cho phép (ca/công)"><Input type="number" min={0} max={10} value={d.rules.fairnessTolerance} onChange={(e) => setRule('fairnessTolerance', Number(e.target.value))} /></Field>
            <Field label="Tối đa ngày làm liên tiếp"><Input type="number" min={1} max={31} value={d.rules.maxConsecutiveWorkDays} onChange={(e) => setRule('maxConsecutiveWorkDays', Number(e.target.value))} /></Field>
            <Field label="Tối đa ca đêm liên tiếp"><Input type="number" min={0} max={31} value={d.rules.maxConsecutiveNights} onChange={(e) => setRule('maxConsecutiveNights', Number(e.target.value))} /></Field>
            <Field label="Số tháng trước để cân đối công bằng"><Input type="number" min={0} max={12} value={d.rules.historyMonths} onChange={(e) => setRule('historyMonths', Number(e.target.value))} /></Field>
            <Field label="Giờ nghỉ tối thiểu giữa hai ca" hint="Bộ luật Lao động: nghỉ ít nhất 12 giờ trước khi chuyển ca"><Input type="number" min={0} max={48} value={d.rules.minRestHours} onChange={(e) => setRule('minRestHours', Number(e.target.value))} /></Field>
            <Field label="Giờ nghỉ tối thiểu sau ca đêm"><Input type="number" min={0} max={72} value={d.rules.restAfterNightHours} onChange={(e) => setRule('restAfterNightHours', Number(e.target.value))} /></Field>
            <div className="space-y-2 pt-1">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.rules.restAfterNightOnlyTruc} onChange={(e) => setRule('restAfterNightOnlyTruc', e.target.checked)} /> Quy định nghỉ sau ca đêm chỉ chặn vị trí trực ca (vẫn được làm hành chính hôm sau)</label>
            </div>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.rules.adminRestOnWeekend} onChange={(e) => setRule('adminRestOnWeekend', e.target.checked)} /> Khối hành chính nghỉ Thứ 7, Chủ nhật và ngày lễ</label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.rules.allowWeekendRotation} onChange={(e) => setRule('allowWeekendRotation', e.target.checked)} /> Khi thiếu người, được xếp xen kẽ nhân sự thuộc nhóm "luân phiên hành chính cuối tuần" (thiết lập ở Nhân sự phân ca)</label>
          </div>
          <div className="mt-4 text-sm">
            <div className="mb-1 font-medium">Ngày làm việc đặc biệt (làm bù – tính như ngày thường)</div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" className="w-44" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <Button small disabled={!newDate || d.rules.specialWorkdays.includes(newDate)} onClick={() => { setRule('specialWorkdays', [...d.rules.specialWorkdays, newDate].sort()); setNewDate(''); }}>Thêm</Button>
              {d.rules.specialWorkdays.map((x) => (
                <span key={x} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                  {x}
                  <button className="text-red-700" onClick={() => setRule('specialWorkdays', d.rules.specialWorkdays.filter((y) => y !== x))} aria-label={`Bỏ ${x}`}>×</button>
                </span>
              ))}
            </div>
          </div>
        </Card>
      </fieldset>
    </div>
  );
}
