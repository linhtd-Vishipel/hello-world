import { useState } from 'react';
import { ROLE_LABELS } from '../../domain/permissions';
import type { RoleId, User } from '../../domain/types';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, useToast } from '../components/ui';
import { useActions, useApp } from '../context';

type Draft = { id?: string; username: string; displayName: string; role: RoleId; unitIds: string[]; active: boolean; password: string };

export function UsersPanel() {
  const a = useActions();
  const users = useApp((s) => s.users);
  const units = useApp((s) => s.units);
  const session = useApp((s) => s.session);
  const [d, setD] = useState<Draft | null>(null);
  if (!a.can('user.manage')) return <Card title="Người dùng">Chỉ quản trị viên được quản lý tài khoản.</Card>;
  const unitLabel = (u: User) => (u.unitIds.length ? u.unitIds.map((id) => units.find((x) => x.id === id)?.code ?? '?').join(', ') : 'Tất cả');
  return (
    <Card
      title="Tài khoản và phân quyền"
      actions={<Button variant="primary" onClick={() => setD({ username: '', displayName: '', role: users.length ? 'lap' : 'admin', unitIds: [], active: true, password: '' })}>+ Thêm tài khoản</Button>}
    >
      <div className="mb-3 space-y-1 text-sm text-slate-600">
        <p>Vai trò: <b>Quản trị viên</b> (cấu hình, người dùng, mở khóa) · <b>Người lập</b> (nhập/sửa công, nhân sự) · <b>Người kiểm tra</b> (xem, đối chiếu, khóa tháng) · <b>Người xem</b> (chỉ đọc, xuất báo cáo).</p>
        {session?.open && <p className="text-amber-700">Đang ở chế độ không đăng nhập. Sau khi tạo tài khoản quản trị đầu tiên, ứng dụng yêu cầu đăng nhập ở lần mở sau.</p>}
        <p className="text-xs">Mật khẩu được băm PBKDF2-SHA256, không lưu dạng văn bản. Lưu ý: ở chế độ local, phân quyền chỉ áp dụng trên giao diện của máy này – không thay thế cơ chế bảo mật máy chủ khi dùng chung qua mạng.</p>
      </div>
      {!users.length ? <EmptyState>Chưa có tài khoản.</EmptyState> : (
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="p-2">Tên đăng nhập</th><th className="p-2">Họ tên</th><th className="p-2">Vai trò</th><th className="p-2">Đơn vị</th><th className="p-2">Trạng thái</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="p-2 font-mono">{u.username}</td>
                <td className="p-2">{u.displayName}</td>
                <td className="p-2">{ROLE_LABELS[u.role]}</td>
                <td className="p-2">{unitLabel(u)}</td>
                <td className="p-2">{u.active ? <Badge color="green">Hoạt động</Badge> : <Badge>Khóa</Badge>}</td>
                <td className="p-2 text-right"><Button small onClick={() => setD({ ...u, password: '' })}>Sửa</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && <UserForm draft={d} onClose={() => setD(null)} />}
    </Card>
  );
}

function UserForm({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const a = useActions();
  const toast = useToast();
  const units = useApp((s) => s.units);
  const [d, setD] = useState(draft);
  const save = async () => {
    const r = await a.saveUser({ ...d, password: d.password || undefined });
    toast(r.ok ? 'Đã lưu tài khoản.' : r.message!, r.ok ? 'success' : 'error');
    if (r.ok) onClose();
  };
  return (
    <Modal title={d.id ? `Sửa tài khoản ${draft.username}` : 'Thêm tài khoản'} onClose={onClose} footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" onClick={save}>Lưu</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Tên đăng nhập"><Input value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} /></Field>
        <Field label="Họ tên hiển thị"><Input value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} /></Field>
        <Field label="Vai trò">
          <Select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as RoleId })}>
            {(Object.keys(ROLE_LABELS) as RoleId[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Field label={d.id ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu (≥ 8 ký tự)'}><Input type="password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} /></Field>
        <div className="col-span-2">
          <div className="mb-1 font-medium">Đơn vị được truy cập (không chọn = tất cả)</div>
          <div className="flex flex-wrap gap-3">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-1">
                <input type="checkbox" checked={d.unitIds.includes(u.id)} onChange={(e) => setD({ ...d, unitIds: e.target.checked ? [...d.unitIds, u.id] : d.unitIds.filter((x) => x !== u.id) })} />
                {u.code}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Hoạt động</label>
      </div>
    </Modal>
  );
}
