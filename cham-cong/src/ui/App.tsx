import { useEffect, useMemo, useState } from 'react';
import { ROLE_LABELS } from '../domain/permissions';
import { Repo } from '../storage/db';
import { createAppStore, type AppStore } from '../state/store';
import { Badge, Button, Card, Field, Input, Select, UiProvider, useToast } from './components/ui';
import { StoreContext, useActions, useApp } from './context';
import { AttendancePanel } from './panels/AttendancePanel';
import { AuditPanel } from './panels/AuditPanel';
import { CodesPanel } from './panels/CodesPanel';
import { DataPanel } from './panels/DataPanel';
import { EmployeesPanel } from './panels/EmployeesPanel';
import { HelpPanel } from './panels/HelpPanel';
import { UnitSettingsPanel } from './panels/UnitSettingsPanel';
import { UsersPanel } from './panels/UsersPanel';
import { pickFile, readFileJson } from './download';

export type TabId = 'cham_cong' | 'nhan_su' | 'ma_cong' | 'don_vi' | 'du_lieu' | 'nhat_ky' | 'nguoi_dung' | 'huong_dan';

const TABS: { id: TabId; label: string }[] = [
  { id: 'cham_cong', label: 'Bảng chấm công' },
  { id: 'nhan_su', label: 'Nhân sự' },
  { id: 'ma_cong', label: 'Mã công' },
  { id: 'don_vi', label: 'Thiết lập đơn vị' },
  { id: 'du_lieu', label: 'Dữ liệu & Sao lưu' },
  { id: 'nhat_ky', label: 'Nhật ký' },
  { id: 'nguoi_dung', label: 'Người dùng' },
  { id: 'huong_dan', label: 'Hướng dẫn' },
];

export function App() {
  const store = useMemo<AppStore>(() => createAppStore(), []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!('indexedDB' in window)) {
      setError('Trình duyệt không hỗ trợ IndexedDB – không thể lưu dữ liệu.');
      return;
    }
    Repo.open()
      .then((r) => store.actions.init(r))
      .then(() => navigator.storage?.persist?.())
      .catch((e) => setError(`Không mở được kho dữ liệu: ${(e as Error).message}`));
  }, [store]);
  if (error) return <div className="m-8 rounded bg-red-100 p-4 text-red-800">{error}</div>;
  return (
    <StoreContext.Provider value={store}>
      <UiProvider>
        <Shell />
      </UiProvider>
    </StoreContext.Provider>
  );
}

function SaveIndicator() {
  const status = useApp((s) => s.saveStatus);
  const err = useApp((s) => s.saveError);
  if (status === 'saving') return <Badge color="amber">● Đang lưu…</Badge>;
  if (status === 'error') return <span title={err}><Badge color="red">● Lỗi lưu</Badge></span>;
  return <Badge color="green">● Đã lưu</Badge>;
}

function Shell() {
  const ready = useApp((s) => s.ready);
  const session = useApp((s) => s.session);
  const units = useApp((s) => s.units);
  const unitId = useApp((s) => s.unitId);
  const pending = useApp((s) => s.pendingWrites);
  const status = useApp((s) => s.saveStatus);
  const a = useActions();
  const [tab, setTab] = useState<TabId>('cham_cong');

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending > 0 || status === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pending, status]);

  if (!ready) return <div className="p-8 text-slate-600">Đang mở dữ liệu…</div>;
  if (!session) return <LoginScreen />;
  const visible = a.accessibleUnits();
  const unit = units.find((u) => u.id === unitId);

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
          <div className="mr-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Dashboard chấm công</div>
            <div className="font-bold text-blue-900">Đài Thông tin Duyên hải</div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Đài:</span>
            <Select
              className="w-64"
              value={unitId ?? ''}
              onChange={(e) => e.target.value && a.selectUnit(e.target.value)}
              aria-label="Chọn Đài"
            >
              {!visible.length && <option value="">(chưa có đơn vị)</option>}
              {visible.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} – {u.name}{u.isSample ? ' [MẪU]' : ''}
                </option>
              ))}
            </Select>
          </label>
          {unit?.isSample && <Badge color="purple">DỮ LIỆU MẪU – không dùng chính thức</Badge>}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <SaveIndicator />
            <span className="text-slate-600">
              {session.displayName} <span className="text-slate-400">({ROLE_LABELS[session.role]})</span>
            </span>
            {!session.open && <Button small onClick={() => a.logout()}>Đăng xuất</Button>}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3">
          {TABS.filter((t) => t.id !== 'nguoi_dung' || a.can('user.manage')).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.id ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {session.open && (
        <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          Chế độ cục bộ không đăng nhập (quyền quản trị). Dữ liệu lưu trong trình duyệt của máy này. Khi dùng chung máy hoặc nhiều người, hãy tạo tài khoản ở thẻ "Người dùng".
        </div>
      )}
      <main className="p-4">
        {!unit && tab !== 'huong_dan' && tab !== 'nguoi_dung' && tab !== 'du_lieu' ? (
          <Welcome />
        ) : (
          <>
            {tab === 'cham_cong' && <AttendancePanel onNavigate={setTab} />}
            {tab === 'nhan_su' && <EmployeesPanel />}
            {tab === 'ma_cong' && <CodesPanel />}
            {tab === 'don_vi' && <UnitSettingsPanel />}
            {tab === 'du_lieu' && <DataPanel />}
            {tab === 'nhat_ky' && <AuditPanel />}
            {tab === 'nguoi_dung' && <UsersPanel />}
            {tab === 'huong_dan' && <HelpPanel />}
          </>
        )}
      </main>
    </div>
  );
}

function LoginScreen() {
  const a = useActions();
  const toast = useToast();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await a.login(u, p);
    setBusy(false);
    if (!r.ok) toast(r.message!, 'error');
  };
  return (
    <div className="mx-auto mt-24 max-w-sm">
      <Card title="Đăng nhập – Dashboard chấm công">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label="Tên đăng nhập"><Input value={u} onChange={(e) => setU(e.target.value)} autoFocus /></Field>
          <Field label="Mật khẩu"><Input type="password" value={p} onChange={(e) => setP(e.target.value)} /></Field>
          <Button variant="primary" className="w-full" disabled={busy || !u || !p} onClick={submit}>Đăng nhập</Button>
        </form>
      </Card>
    </div>
  );
}

function Welcome() {
  const a = useActions();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  if (!a.can('unit.manage')) {
    return <Card title="Chưa có đơn vị">Tài khoản chưa được gán đơn vị nào. Liên hệ quản trị viên.</Card>;
  }
  const create = async () => {
    const r = await a.createUnit({ code, name, parentOrg: parent });
    toast(r.ok ? 'Đã tạo đơn vị. Tiếp theo: khai báo mã công và nhân sự.' : r.message!, r.ok ? 'success' : 'error');
  };
  const restore = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const r = await a.restore(await readFileJson(f), 'all');
      toast(r.ok ? 'Đã phục hồi dữ liệu.' : r.message!, r.ok ? 'success' : 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
      <Card title="Tạo đơn vị (Đài) đầu tiên">
        <div className="space-y-3">
          <Field label="Mã đơn vị" hint="Chữ không dấu, dùng trong tên file Excel. VD: CMR, HPR"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <Field label="Tên Đài"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Đài Thông tin Duyên hải ..." /></Field>
          <Field label="Cơ quan chủ quản (nếu có)"><Input value={parent} onChange={(e) => setParent(e.target.value)} /></Field>
          <Button variant="primary" onClick={create} disabled={!code || !name}>Tạo đơn vị</Button>
        </div>
      </Card>
      <Card title="Lựa chọn khác">
        <div className="space-y-3 text-sm text-slate-700">
          <p>Đã có bản sao lưu từ máy khác? Phục hồi toàn bộ dữ liệu:</p>
          <Button onClick={restore}>Phục hồi từ file sao lưu (.json)</Button>
          <p className="pt-2">Muốn thử ứng dụng? Tạo đơn vị chứa <b>dữ liệu mẫu</b> (đánh dấu rõ, tách biệt với dữ liệu thật):</p>
          <Button onClick={async () => { const r = await a.createSampleUnit(); toast(r.ok ? 'Đã tạo đơn vị mẫu.' : r.message!, r.ok ? 'success' : 'error'); }}>
            Tạo dữ liệu mẫu
          </Button>
        </div>
      </Card>
    </div>
  );
}
