import { useEffect, useState } from 'react';
import { WEEKDAY_LABELS } from '../../domain/calendar';
import { planUnitFromConfig, type ConfigImportPlan, type UnitConfigFile } from '../../domain/backup';
import type { HolidayKind, Unit } from '../../domain/types';
import { DEFAULT_TEMPLATE } from '../../domain/unit';
import { deepClone, foldVietnamese } from '../../domain/util';
import { bytesToBase64 } from '../../excel/base64';
import { PLACEHOLDERS } from '../../excel/export';
import { buildSampleTemplate } from '../../excel/template';
import { Badge, Button, Card, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';
import { downloadBytes, downloadJson, pickFile, readFileBytes, readFileJson, stamp, XLSX_MIME } from '../download';

export function UnitSettingsPanel() {
  const a = useActions();
  const toast = useToast();
  const units = useApp((s) => s.units);
  const unitId = useApp((s) => s.unitId);
  const unit = units.find((u) => u.id === unitId)!;
  const [d, setD] = useState<Unit>(() => deepClone(unit));
  const [dirty, setDirty] = useState(false);
  const canManage = a.can('unit.manage');
  useEffect(() => {
    setD(deepClone(unit));
    setDirty(false);
  }, [unit]);
  const upd = (fn: (u: Unit) => void) => {
    setD((x) => {
      const n = deepClone(x);
      fn(n);
      return n;
    });
    setDirty(true);
  };
  const save = async () => {
    const r = await a.saveUnit(d);
    toast(r.ok ? 'Đã lưu cấu hình đơn vị.' : r.message!, r.ok ? 'success' : 'error');
  };
  const t = d.template;

  return (
    <div className="space-y-4">
      <div className="no-print sticky top-[6.5rem] z-20 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <b>Thiết lập đơn vị {unit.code}</b>
        {dirty && <Badge color="amber">Có thay đổi chưa lưu</Badge>}
        <div className="ml-auto flex gap-2">
          <Button disabled={!dirty} onClick={() => { setD(deepClone(unit)); setDirty(false); }}>Hủy thay đổi</Button>
          <Button variant="primary" disabled={!dirty || !canManage} onClick={save}>Lưu cấu hình</Button>
        </div>
      </div>
      {!canManage && <p className="text-sm text-amber-700">Chỉ quản trị viên được sửa cấu hình đơn vị.</p>}
      <fieldset disabled={!canManage} className="grid gap-4 lg:grid-cols-2">
        <Card title="Thông tin đơn vị">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã đơn vị" hint="Dùng trong tên file xuất"><Input value={d.code} onChange={(e) => upd((u) => { u.code = e.target.value.toUpperCase(); })} /></Field>
            <Field label="Năm bắt đầu sử dụng"><Input type="number" value={d.startYear} onChange={(e) => upd((u) => { u.startYear = Number(e.target.value); })} /></Field>
            <Field label="Tên Đài" className="col-span-2"><Input value={d.name} onChange={(e) => upd((u) => { u.name = e.target.value; })} /></Field>
            <Field label="Cơ quan chủ quản" className="col-span-2"><Input value={d.parentOrg} onChange={(e) => upd((u) => { u.parentOrg = e.target.value; })} /></Field>
            <Field label="Địa chỉ" className="col-span-2"><Input value={d.address} onChange={(e) => upd((u) => { u.address = e.target.value; })} /></Field>
          </div>
        </Card>

        <Card title="Lịch làm việc và ngày lễ">
          <div className="space-y-3 text-sm">
            <Field label="Chế độ làm việc">
              <Select value={d.calendar.mode} onChange={(e) => upd((u) => { u.calendar.mode = e.target.value as Unit['calendar']['mode']; })}>
                <option value="truc_ca">Trực ca 24/7 – cuối tuần/lễ chỉ tô màu, mọi ngày đều cần ghi mã</option>
                <option value="hanh_chinh">Hành chính – nghỉ cuối tuần và ngày lễ</option>
              </Select>
            </Field>
            <div>
              <div className="mb-1 font-medium">Ngày cuối tuần</div>
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                  <label key={wd} className="flex items-center gap-1">
                    <input type="checkbox" checked={d.calendar.weekendDays.includes(wd)} onChange={(e) => upd((u) => {
                      u.calendar.weekendDays = e.target.checked ? [...u.calendar.weekendDays, wd] : u.calendar.weekendDays.filter((x) => x !== wd);
                    })} />
                    {WEEKDAY_LABELS[wd]}
                  </label>
                ))}
              </div>
            </div>
            <HolidayEditor unit={d} onChange={(hs) => upd((u) => { u.calendar.holidays = hs; })} />
          </div>
        </Card>

        <Card title="Nhóm công">
          <p className="mb-2 text-xs text-slate-500">Nhóm dùng để tổng hợp ngày nghỉ/làm việc theo loại. Không xóa được nhóm đang có mã công.</p>
          {d.codeGroups.map((g, i) => (
            <div key={g.id} className="mb-2 flex gap-2">
              <Input value={g.name} onChange={(e) => upd((u) => { u.codeGroups[i].name = e.target.value; })} />
              <span className="self-center font-mono text-xs text-slate-400">{g.id}</span>
              <Button small variant="ghost" onClick={() => upd((u) => { u.codeGroups.splice(i, 1); })}>Xóa</Button>
            </div>
          ))}
          <Button small onClick={() => upd((u) => {
            const name = 'Nhóm mới';
            let id = foldVietnamese(name).replace(/\s+/g, '_');
            let k = 1;
            while (u.codeGroups.some((g) => g.id === id)) id = `nhom_${++k}`;
            u.codeGroups.push({ id, name });
          })}>+ Thêm nhóm</Button>
        </Card>

        <Card title="Mẫu Excel, in ấn và người ký">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Tên bảng"><Input value={t.title} onChange={(e) => upd((u) => { u.template.title = e.target.value; })} /></Field>
            <Field label="Số hiệu mẫu"><Input value={t.formCode} onChange={(e) => upd((u) => { u.template.formCode = e.target.value; })} /></Field>
            <Field label="Ghi chú mẫu" className="col-span-2"><Input value={t.formNote} onChange={(e) => upd((u) => { u.template.formNote = e.target.value; })} /></Field>
            <Field label="Địa danh (dòng ngày ký)"><Input value={t.place} onChange={(e) => upd((u) => { u.template.place = e.target.value; })} /></Field>
            <Field label="Mẫu tên file" hint="{MaDonVi} {YYYY} {MM}"><Input value={t.fileNamePattern} onChange={(e) => upd((u) => { u.template.fileNamePattern = e.target.value; })} /></Field>
            <Field label="Khổ giấy">
              <Select value={t.paperSize} onChange={(e) => upd((u) => { u.template.paperSize = e.target.value as typeof t.paperSize; })}>
                <option value="auto">Tự động theo số cột</option><option value="A4">A4</option><option value="A3">A3</option>
              </Select>
            </Field>
            <Field label="Hướng giấy">
              <Select value={t.orientation} onChange={(e) => upd((u) => { u.template.orientation = e.target.value as typeof t.orientation; })}>
                <option value="landscape">Ngang</option><option value="portrait">Dọc</option>
              </Select>
            </Field>
            <Field label="Phông chữ"><Input value={t.fontName} onChange={(e) => upd((u) => { u.template.fontName = e.target.value; })} /></Field>
            <Field label="Cỡ chữ"><Input type="number" min={6} max={16} value={t.fontSize} onChange={(e) => upd((u) => { u.template.fontSize = Number(e.target.value); })} /></Field>
            <Field label="Màu cuối tuần"><Input type="color" className="h-9" value={t.weekendColor} onChange={(e) => upd((u) => { u.template.weekendColor = e.target.value; })} /></Field>
            <Field label="Màu ngày lễ"><Input type="color" className="h-9" value={t.holidayColor} onChange={(e) => upd((u) => { u.template.holidayColor = e.target.value; })} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={t.showPosition} onChange={(e) => upd((u) => { u.template.showPosition = e.target.checked; })} /> Hiện cột Chức vụ</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={t.showLegend} onChange={(e) => upd((u) => { u.template.showLegend = e.target.checked; })} /> In dòng ký hiệu</label>
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={t.includeSummarySheet} onChange={(e) => upd((u) => { u.template.includeSummarySheet = e.target.checked; })} /> Kèm trang "Tổng hợp" (chi tiết theo mã, nhóm, cảnh báo)</label>
          </div>
          <div className="mt-4">
            <div className="mb-1 text-sm font-medium">Người ký (theo thứ tự trái → phải)</div>
            {t.signers.map((s, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <Input placeholder="Chức danh" value={s.title} onChange={(e) => upd((u) => { u.template.signers[i].title = e.target.value; })} />
                <Input placeholder="Họ tên" value={s.name} onChange={(e) => upd((u) => { u.template.signers[i].name = e.target.value; })} />
                <Button small variant="ghost" onClick={() => upd((u) => { u.template.signers.splice(i, 1); })}>Xóa</Button>
              </div>
            ))}
            {t.signers.length < 5 && <Button small onClick={() => upd((u) => { u.template.signers.push({ title: '', name: '' }); })}>+ Thêm người ký</Button>}
          </div>
          <div className="mt-4 rounded bg-slate-50 p-3 text-sm">
            <div className="font-medium">Mẫu Excel chính thức của đơn vị (tùy chọn)</div>
            {t.customTemplate ? (
              <div className="mt-1 flex items-center gap-2">
                <Badge color="blue">Đang dùng: {t.customTemplate.fileName}</Badge>
                <Button small variant="ghost" onClick={() => upd((u) => { delete u.template.customTemplate; })}>Bỏ mẫu (dùng mẫu mặc định)</Button>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-600">Đang dùng mẫu mặc định của ứng dụng.</div>
            )}
            <p className="mt-2 text-xs text-slate-600">Tải lên file .xlsx đã được phê duyệt, có ô <code>{'{{BANG_CHAM_CONG}}'}</code> đánh dấu vị trí bảng. Placeholder: {PLACEHOLDERS.join(' ')}</p>
            <div className="mt-2 flex gap-2">
              <Button small onClick={async () => downloadBytes('Mau_bang_cham_cong_placeholder.xlsx', await buildSampleTemplate(), XLSX_MIME)}>Tải file mẫu có placeholder</Button>
              <Button small onClick={async () => {
                const f = await pickFile('.xlsx');
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) return toast('File mẫu quá lớn (> 5MB).', 'error');
                const bytes = await readFileBytes(f);
                upd((u) => { u.template.customTemplate = { fileName: f.name, dataBase64: bytesToBase64(bytes), uploadedAt: new Date().toISOString() }; });
                toast('Đã nạp mẫu. Bấm "Lưu cấu hình", sau đó thử "Xuất Excel" để kiểm tra.', 'info');
              }}>Tải lên mẫu của đơn vị…</Button>
              <Button small variant="ghost" onClick={() => upd((u) => { u.template = { ...deepClone(DEFAULT_TEMPLATE), signers: u.template.signers, place: u.template.place }; })}>Khôi phục thiết lập mặc định</Button>
            </div>
          </div>
        </Card>
      </fieldset>
      <MultiUnitCard />
    </div>
  );
}

function HolidayEditor({ unit, onChange }: { unit: Unit; onChange: (h: Unit['calendar']['holidays']) => void }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<HolidayKind>('le');
  const list = [...unit.calendar.holidays].sort((a, b) => a.date.localeCompare(b.date));
  const years = Array.from(new Set(list.map((h) => h.date.slice(0, 4))));
  return (
    <div>
      <div className="mb-1 font-medium">Ngày lễ / ngày nghỉ riêng của đơn vị</div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input className="w-48" placeholder="Tên ngày lễ" value={name} onChange={(e) => setName(e.target.value)} />
        <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value as HolidayKind)}>
          <option value="le">Ngày lễ</option><option value="nghi_don_vi">Nghỉ riêng đơn vị</option>
        </Select>
        <Button small disabled={!date || !name} onClick={() => { onChange([...unit.calendar.holidays.filter((h) => h.date !== date), { date, name, kind }]); setDate(''); setName(''); }}>Thêm</Button>
      </div>
      {years.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 text-xs">
          Sao chép sang năm sau (giữ ngày/tháng, cần kiểm tra lại lễ âm lịch):
          {years.map((y) => (
            <button key={y} className="text-blue-700 underline" onClick={() => {
              const ny = String(Number(y) + 1);
              const add = list.filter((h) => h.date.startsWith(y)).map((h) => ({ ...h, date: ny + h.date.slice(4) }))
                .filter((h) => !unit.calendar.holidays.some((x) => x.date === h.date) && !h.date.endsWith('-02-29'));
              onChange([...unit.calendar.holidays, ...add]);
            }}>{y} → {Number(y) + 1}</button>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto">
        {list.map((h) => (
          <div key={h.date} className="flex items-center justify-between border-b py-1 text-xs">
            <span>{h.date} – {h.name} {h.kind === 'nghi_don_vi' && <Badge>đơn vị</Badge>}</span>
            <button className="text-red-700" onClick={() => onChange(unit.calendar.holidays.filter((x) => x.date !== h.date))}>Xóa</button>
          </div>
        ))}
        {!list.length && <div className="text-xs text-slate-500">Chưa khai báo ngày lễ.</div>}
      </div>
    </div>
  );
}

function MultiUnitCard() {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const units = useApp((s) => s.units);
  const [plan, setPlan] = useState<{ plan: ConfigImportPlan; title: string } | null>(null);
  const [inclEmp, setInclEmp] = useState(false);
  const [inclAtt, setInclAtt] = useState(false);
  if (!a.can('unit.manage')) return null;

  const askCodeName = async () => {
    const code = await dialog.prompt({ title: 'Mã đơn vị mới', label: 'Mã đơn vị (chữ không dấu, VD: HPR)', required: true });
    if (!code) return null;
    const name = await dialog.prompt({ title: 'Tên đơn vị mới', label: 'Tên Đài', required: true });
    if (!name) return null;
    return { code: code.trim().toUpperCase(), name };
  };

  return (
    <Card title="Triển khai đa Đài">
      <div className="grid gap-4 md:grid-cols-3 text-sm">
        <div className="space-y-2">
          <div className="font-medium">Tạo đơn vị mới (trống)</div>
          <Button onClick={async () => {
            const cn = await askCodeName();
            if (!cn) return;
            const r = await a.createUnit(cn);
            toast(r.ok ? `Đã tạo ${cn.code}.` : r.message!, r.ok ? 'success' : 'error');
          }}>+ Tạo đơn vị</Button>
          <div className="text-xs text-slate-500">Hiện có {units.length} đơn vị trong bản cài đặt này.</div>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Nhân bản cấu hình đơn vị hiện tại</div>
          <p className="text-xs text-slate-500">Sao chép mã công, nhóm công, lịch, ngày lễ, mẫu Excel. Không sao chép dữ liệu chấm công; tên người ký được xóa.</p>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={inclEmp} onChange={(e) => setInclEmp(e.target.checked)} /> Kèm danh sách nhân sự</label>
          <Button onClick={async () => {
            const cn = await askCodeName();
            if (!cn) return;
            const p = await a.planCloneCurrentUnit(cn.code, cn.name, inclEmp);
            if (p) setPlan({ plan: p, title: `Xem trước nhân bản thành ${cn.code}` });
          }}>Nhân bản…</Button>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Chuyển cấu hình giữa các bản cài đặt</div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={inclEmp} onChange={(e) => setInclEmp(e.target.checked)} /> Kèm nhân sự</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={inclAtt} onChange={(e) => setInclAtt(e.target.checked)} /> Kèm dữ liệu chấm công (dữ liệu cá nhân)</label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => {
              const f = a.exportUnitConfig({ includeEmployees: inclEmp, includeAttendance: inclAtt });
              if (f) downloadJson(`CauHinh_${f.unit.code}_${stamp()}.json`, f);
            }}>Xuất cấu hình</Button>
            <Button onClick={async () => {
              const file = await pickFile('.json');
              if (!file) return;
              try {
                const cfg = (await readFileJson(file)) as UnitConfigFile;
                if (cfg?.format !== 'cham-cong-unit-config') return toast('File không phải cấu hình đơn vị.', 'error');
                const cn = await askCodeName();
                if (!cn) return;
                const p = planUnitFromConfig(cfg, units, { ...cn, includeEmployees: inclEmp, includeAttendance: inclAtt });
                setPlan({ plan: p, title: `Xem trước nhập cấu hình "${cfg.unit?.name}" thành ${cn.code}` });
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}>Nhập cấu hình…</Button>
          </div>
        </div>
      </div>
      {plan && (
        <Modal title={plan.title} onClose={() => setPlan(null)} footer={
          <>
            <Button onClick={() => setPlan(null)}>Hủy</Button>
            <Button variant="primary" disabled={plan.plan.errors.length > 0} onClick={async () => {
              const r = await a.applyUnitPlan(plan.plan);
              toast(r.ok ? `Đã tạo đơn vị ${plan.plan.unit.code}.` : r.message!, r.ok ? 'success' : 'error');
              if (r.ok) setPlan(null);
            }}>Áp dụng</Button>
          </>
        }>
          <div className="space-y-2 text-sm">
            <div>Đơn vị mới: <b>{plan.plan.unit.code} – {plan.plan.unit.name}</b></div>
            <div>Mã công: {plan.plan.codes.map((c) => c.code).join(', ') || '(không có)'}</div>
            <div>Nhóm công: {plan.plan.unit.codeGroups.map((g) => g.name).join(', ')}</div>
            <div>Ngày lễ: {plan.plan.unit.calendar.holidays.length} · Lịch: {plan.plan.unit.calendar.mode === 'truc_ca' ? 'trực ca' : 'hành chính'}</div>
            <div>Nhân sự: {plan.plan.employees.length} · Bảng chấm công: {plan.plan.sheets.length}</div>
            {plan.plan.errors.map((e, i) => <div key={i} className="text-red-700">✖ {e}</div>)}
            {plan.plan.warnings.map((e, i) => <div key={i} className="text-amber-700">⚠ {e}</div>)}
            <p className="text-xs text-slate-500">Dữ liệu được tạo với mã nội bộ mới, không ảnh hưởng đơn vị nguồn.</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}
