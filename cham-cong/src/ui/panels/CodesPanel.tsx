import { useState } from 'react';
import { monthKey } from '../../domain/calendar';
import { codeUsage, ruleAt, SUGGESTED_CODES, type CodeDraft } from '../../domain/codes';
import type { AttendanceCode, CodeRuleVersion } from '../../domain/types';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';

export function CodesPanel() {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const codes = useApp((s) => s.codes);
  const sheets = useApp((s) => s.sheets);
  const units = useApp((s) => s.units);
  const unitId = useApp((s) => s.unitId);
  const year = useApp((s) => s.year);
  const month = useApp((s) => s.month);
  const unit = units.find((u) => u.id === unitId)!;
  const [editing, setEditing] = useState<CodeDraft | null>(null);
  const [versionFor, setVersionFor] = useState<AttendanceCode | null>(null);
  const [suggest, setSuggest] = useState(false);
  const canManage = a.can('code.manage');
  const groupName = (id: string) => unit.codeGroups.find((g) => g.id === id)?.name ?? id;

  const newDraft = (): CodeDraft => ({
    code: '', name: '', groupId: unit.codeGroups[0]?.id ?? '', color: '#e0f2fe', rule: '', active: true,
    versions: [{ effectiveFrom: `${unit.startYear}-01`, value: null, countsInTotal: true, isActualWork: false }],
  });

  return (
    <Card
      title="Danh mục mã chấm công"
      actions={canManage && (
        <>
          <Button variant="primary" onClick={() => setEditing(newDraft())}>+ Thêm mã công</Button>
          <Button onClick={() => setSuggest(true)}>Thêm bộ mã gợi ý…</Button>
        </>
      )}
    >
      <p className="mb-3 text-sm text-slate-600">
        Danh mục và hệ số do đơn vị tự cấu hình theo quy chế. Ứng dụng không tự áp đặt hệ số. Thay đổi quy tắc được áp dụng theo <b>tháng hiệu lực</b>; các tháng đã khóa giữ nguyên kết quả.
        Quy tắc dưới đây hiển thị cho tháng đang chọn {String(month).padStart(2, '0')}/{year}.
      </p>
      {!codes.length ? (
        <EmptyState>Chưa có mã công. Thêm mã mới hoặc dùng "Thêm bộ mã gợi ý" rồi điều chỉnh theo quy chế đơn vị.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-2">Mã</th><th className="p-2">Tên đầy đủ</th><th className="p-2">Nhóm</th><th className="p-2">Hệ số</th>
                <th className="p-2">Tính tổng công</th><th className="p-2">Làm việc thực tế</th><th className="p-2">Quy tắc</th><th className="p-2">Trạng thái</th><th className="p-2">Sử dụng</th><th />
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const rule = ruleAt(c, year, month);
                const usage = codeUsage(c, sheets);
                return (
                  <tr key={c.id} className="border-b align-top hover:bg-slate-50">
                    <td className="p-2"><span className="rounded px-2 py-0.5 font-bold" style={{ background: c.color }}>{c.code}</span></td>
                    <td className="p-2">{c.name}</td>
                    <td className="p-2">{groupName(c.groupId)}</td>
                    <td className="p-2">{rule.value === null ? <Badge color="amber">Chưa quy định</Badge> : rule.value}</td>
                    <td className="p-2">{rule.countsInTotal ? 'Có' : 'Không'}</td>
                    <td className="p-2">{rule.isActualWork ? 'Có' : 'Không'}</td>
                    <td className="p-2 text-xs">
                      {c.rule && <div>{c.rule}</div>}
                      <div className="text-slate-500">{c.versions.map((v) => `từ ${v.effectiveFrom}: ${v.value ?? '?'}${v.countsInTotal ? '' : ' (không tính)'}`).join(' · ')}</div>
                    </td>
                    <td className="p-2">{c.active ? <Badge color="green">Đang dùng</Badge> : <Badge>Ngừng dùng</Badge>}</td>
                    <td className="p-2 text-xs">{usage.cells ? `${usage.cells} ô` : '–'}</td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {canManage && (
                        <>
                          <Button small variant="ghost" onClick={() => a.moveCode(c.id, -1)}>↑</Button>
                          <Button small variant="ghost" onClick={() => a.moveCode(c.id, 1)}>↓</Button>
                          <Button small onClick={() => setEditing({ ...c })}>Sửa</Button>{' '}
                          <Button small onClick={() => setVersionFor(c)}>Quy tắc mới</Button>{' '}
                          <Button small variant="ghost" onClick={async () => {
                            const r = await a.setCodeActive(c.id, !c.active);
                            toast(r.ok ? (c.active ? 'Đã ngừng sử dụng mã (dữ liệu lịch sử được giữ).' : 'Đã sử dụng lại mã.') : r.message!, r.ok ? 'success' : 'error');
                          }}>{c.active ? 'Ngừng' : 'Dùng lại'}</Button>
                          {!usage.cells && (
                            <Button small variant="ghost" className="text-red-700" onClick={async () => {
                              if (!(await dialog.confirm({ title: 'Xóa mã công', message: `Xóa mã ${c.code} (chưa được sử dụng)?`, danger: true }))) return;
                              const r = await a.deleteCode(c.id);
                              toast(r.ok ? 'Đã xóa.' : r.message!, r.ok ? 'success' : 'error');
                            }}>Xóa</Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CodeForm draft={editing} onClose={() => setEditing(null)} />}
      {versionFor && <VersionForm code={versionFor} defaultFrom={monthKey(year, month)} onClose={() => setVersionFor(null)} />}
      {suggest && <SuggestDialog onClose={() => setSuggest(false)} defaultFrom={`${unit.startYear}-01`} />}
    </Card>
  );
}

function CodeForm({ draft, onClose }: { draft: CodeDraft; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const units = useApp((s) => s.units);
  const unitId = useApp((s) => s.unitId);
  const unit = units.find((u) => u.id === unitId)!;
  const [d, setD] = useState<CodeDraft>(draft);
  const isNew = !draft.id;
  const v0 = d.versions[0];
  const setV0 = (p: Partial<CodeRuleVersion>) => setD((x) => ({ ...x, versions: [{ ...x.versions[0], ...p }, ...x.versions.slice(1)] }));
  const save = async () => {
    const r = await a.saveCode(d);
    if (!r.ok) return toast(r.message!, 'error');
    toast('Đã lưu mã công.' + (r.data?.lockedUnaffected.length ? ` Các tháng đã khóa giữ nguyên kết quả: ${r.data.lockedUnaffected.join(', ')}` : ''), 'success');
    onClose();
  };
  return (
    <Modal title={isNew ? 'Thêm mã công' : `Sửa mã ${draft.code}`} onClose={onClose} footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" onClick={save}>Lưu</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mã viết tắt *" hint="Chữ, số, ký hiệu tiếng Việt, / + - . _ (tối đa 10)"><Input value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} /></Field>
        <Field label="Tên đầy đủ *"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Nhóm công">
          <Select value={d.groupId} onChange={(e) => setD({ ...d, groupId: e.target.value })}>
            {unit.codeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label="Màu hiển thị"><Input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} className="h-9" /></Field>
        <Field label="Quy tắc áp dụng (mô tả)" className="col-span-2"><Input value={d.rule} onChange={(e) => setD({ ...d, rule: e.target.value })} placeholder="VD: theo Điều … Quy chế lương" /></Field>
        {isNew ? (
          <>
            <Field label="Hiệu lực từ tháng"><Input type="month" value={v0.effectiveFrom} onChange={(e) => setV0({ effectiveFrom: e.target.value })} /></Field>
            <Field label="Hệ số quy đổi" hint="Để trống = chưa quy định">
              <Input type="number" step="0.01" min={0} value={v0.value ?? ''} onChange={(e) => setV0({ value: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v0.countsInTotal} onChange={(e) => setV0({ countsInTotal: e.target.checked })} /> Tính vào tổng công</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v0.isActualWork} onChange={(e) => setV0({ isActualWork: e.target.checked })} /> Là ngày làm việc thực tế</label>
          </>
        ) : (
          <p className="col-span-2 text-xs text-slate-500">Để thay đổi hệ số/cách tính, dùng nút "Quy tắc mới" và chọn tháng hiệu lực – tránh làm sai kết quả các tháng trước.</p>
        )}
      </div>
    </Modal>
  );
}

function VersionForm({ code, defaultFrom, onClose }: { code: AttendanceCode; defaultFrom: string; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const sheets = useApp((s) => s.sheets);
  const [y, m] = defaultFrom.split('-').map(Number);
  const cur = ruleAt(code, y, m);
  const [v, setV] = useState<CodeRuleVersion>({ ...cur, effectiveFrom: defaultFrom });
  const locked = sheets.filter((s) => s.locked && monthKey(s.year, s.month) >= v.effectiveFrom).length;
  const save = async () => {
    const r = await a.addCodeVersion(code.id, v);
    if (!r.ok) return toast(r.message!, 'error');
    toast(`Đã áp dụng quy tắc mới từ ${v.effectiveFrom}.` + (r.data?.lockedUnaffected.length ? ` Tháng đã khóa giữ nguyên: ${r.data.lockedUnaffected.join(', ')}` : ''), 'success');
    onClose();
  };
  return (
    <Modal title={`Quy tắc tính mới cho mã ${code.code}`} onClose={onClose} footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" onClick={save}>Áp dụng</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Hiệu lực từ tháng"><Input type="month" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></Field>
        <Field label="Hệ số quy đổi" hint="Để trống = chưa quy định">
          <Input type="number" step="0.01" min={0} value={v.value ?? ''} onChange={(e) => setV({ ...v, value: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={v.countsInTotal} onChange={(e) => setV({ ...v, countsInTotal: e.target.checked })} /> Tính vào tổng công</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={v.isActualWork} onChange={(e) => setV({ ...v, isActualWork: e.target.checked })} /> Là ngày làm việc thực tế</label>
      </div>
      <p className="mt-3 text-xs text-slate-600">Các tháng trước {v.effectiveFrom} giữ quy tắc cũ. {locked > 0 && <b>{locked} bảng đã khóa từ tháng này trở đi vẫn giữ kết quả lúc khóa.</b>}</p>
    </Modal>
  );
}

function SuggestDialog({ onClose, defaultFrom }: { onClose: () => void; defaultFrom: string }) {
  const a = useActions();
  const toast = useToast();
  const [confirmValues, setConfirmValues] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  return (
    <Modal
      title="Thêm bộ mã công gợi ý"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" onClick={async () => {
        const r = await a.addSuggestedCodes(confirmValues, from);
        toast(r.ok ? (r.data ? `Đã thêm ${r.data} mã.` : r.message!) : r.message!, r.ok ? 'success' : 'error');
        onClose();
      }}>Thêm</Button></>}
    >
      <p className="mb-2 text-sm">Bộ mã ví dụ dưới đây <b>không</b> mặc định đúng cho mọi đơn vị. Mã đã tồn tại sẽ được bỏ qua.</p>
      <table className="mb-3 w-full text-sm">
        <thead><tr className="bg-slate-100 text-left"><th className="p-1">Mã</th><th className="p-1">Tên</th><th className="p-1">Hệ số gợi ý</th><th className="p-1">Tính tổng</th></tr></thead>
        <tbody>{SUGGESTED_CODES.map((s) => <tr key={s.code} className="border-b"><td className="p-1 font-bold">{s.code}</td><td className="p-1">{s.name}</td><td className="p-1">{s.value}</td><td className="p-1">{s.countsInTotal ? 'Có' : 'Không'}</td></tr>)}</tbody>
      </table>
      <Field label="Hiệu lực từ tháng"><Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmValues} onChange={(e) => setConfirmValues(e.target.checked)} />
        <span>Tôi đã đối chiếu quy chế đơn vị và xác nhận áp dụng <b>hệ số gợi ý</b>. Nếu không chọn, các mã được thêm với hệ số "Chưa quy định" để đơn vị tự khai báo.</span>
      </label>
    </Modal>
  );
}
