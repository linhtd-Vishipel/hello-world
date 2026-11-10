import { useEffect, useState } from 'react';
import { formatMonth } from '../../domain/calendar';
import { validateBackup, type BackupPreview } from '../../domain/backup';
import { rowHasData } from '../../domain/employees';
import type { Snapshot } from '../../domain/types';
import { Badge, Button, Card, EmptyState, Modal, useDialog, useToast } from '../components/ui';
import { useActions, useApp } from '../context';
import { downloadJson, pickFile, readFileJson, stamp } from '../download';

export function DataPanel() {
  const a = useActions();
  const toast = useToast();
  const dialog = useDialog();
  const sheets = useApp((s) => s.sheets);
  const unitId = useApp((s) => s.unitId);
  const units = useApp((s) => s.units);
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const auditTick = useApp((s) => s.auditTick);
  const session = useApp((s) => s.session);
  const unit = units.find((u) => u.id === unitId);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [restore, setRestore] = useState<{ data: unknown; preview: BackupPreview; name: string } | null>(null);
  const [usage, setUsage] = useState<string>('');

  useEffect(() => {
    a.listSnapshots().then(setSnaps).catch(() => setSnaps([]));
  }, [a, auditTick]);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB đã dùng`)).catch(() => {});
  }, [auditTick]);

  const download = async (scope: 'all' | 'unit') => {
    const r = await a.exportBackup(scope);
    if (!r.ok) return toast(r.message!, 'error');
    try {
      if (!(await downloadJson(`SaoLuu_${scope === 'all' ? 'ToanBo' : unit?.code}_${stamp()}.json`, r.data))) return;
    } catch (e) {
      return toast((e as Error).message, 'error');
    }
    await a.markBackedUp(scope);
    toast('Đã tải file sao lưu về máy. Lưu file ở ổ đĩa/thiết bị khác để phòng mất dữ liệu.', 'success');
  };

  const chooseRestore = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const data = await readFileJson(f);
      setRestore({ data, preview: validateBackup(data).preview, name: f.name });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const doRestore = async (mode: 'all' | 'unit') => {
    if (!restore) return;
    const okk = await dialog.confirm({
      title: mode === 'all' ? 'Phục hồi TOÀN BỘ dữ liệu' : 'Phục hồi dữ liệu đơn vị',
      message: mode === 'all'
        ? 'Toàn bộ dữ liệu hiện tại trên máy này sẽ được thay bằng nội dung file. Ứng dụng tự tạo điểm khôi phục trước khi thực hiện.'
        : `Dữ liệu của đơn vị ${restore.preview.units[0]?.code} trên máy này sẽ được thay bằng nội dung file. Các đơn vị khác không bị ảnh hưởng.`,
      danger: true,
      confirmText: 'Phục hồi',
    });
    if (!okk) return;
    const r = await a.restore(restore.data, mode);
    toast(r.ok ? 'Đã phục hồi dữ liệu.' : r.message!, r.ok ? 'success' : 'error');
    if (r.ok) setRestore(null);
  };

  const sorted = [...sheets].sort((x, y) => y.id.localeCompare(x.id));
  const daysSince = lastBackupAt ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86400000) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <b>Lưu ý lưu trữ:</b> dữ liệu được lưu trong trình duyệt (IndexedDB) của <b>máy tính hiện tại</b> {usage && `(${usage})`}. Dữ liệu có thể mất nếu xóa dữ liệu duyệt web, đổi trình duyệt/hồ sơ hoặc hỏng máy.
        Điểm khôi phục bên dưới cũng nằm trên máy này – <b>chỉ file sao lưu tải về mới là bản sao độc lập</b>.
        <div className="mt-1">
          Lần tải file sao lưu gần nhất: {lastBackupAt ? <b>{new Date(lastBackupAt).toLocaleString('vi-VN')}{daysSince! > 7 && ` (${daysSince} ngày trước – nên sao lưu lại)`}</b> : <b className="text-red-700">chưa từng sao lưu ra file</b>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sao lưu">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!unit || !a.can('data.backup')} onClick={() => download('unit')}>Tải sao lưu đơn vị {unit?.code}</Button>
              {session?.role === 'admin' && <Button onClick={() => download('all')}>Tải sao lưu toàn bộ (mọi đơn vị + tài khoản)</Button>}
            </div>
            <p className="text-xs text-slate-500">File .json chứa cấu hình, nhân sự, mã công, bảng chấm công và nhật ký. Dùng để phục hồi hoặc chuyển sang máy khác.</p>
            <Button small disabled={!a.can('data.backup')} onClick={async () => {
              const reason = await dialog.prompt({ title: 'Tạo điểm khôi phục', label: 'Mô tả', initial: 'Thủ công', required: true });
              if (!reason) return;
              const r = await a.createSnapshot(reason);
              toast(r.ok ? 'Đã tạo điểm khôi phục trên máy này.' : r.message!, r.ok ? 'success' : 'error');
            }}>Tạo điểm khôi phục trên máy</Button>
          </div>
        </Card>
        <Card title="Phục hồi">
          <div className="space-y-2 text-sm">
            <Button disabled={!a.can('data.restore')} onClick={chooseRestore}>Chọn file sao lưu (.json)…</Button>
            {!a.can('data.restore') && <p className="text-xs text-slate-500">Chỉ quản trị viên được phục hồi dữ liệu.</p>}
          </div>
        </Card>
      </div>

      <Card title={`Bảng chấm công đã tạo – ${unit?.name ?? ''}`}>
        {!sorted.length ? <EmptyState>Chưa có bảng chấm công nào.</EmptyState> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr><th className="p-2">Tháng</th><th className="p-2">Số nhân sự</th><th className="p-2">Có dữ liệu</th><th className="p-2">Trạng thái</th><th className="p-2">Cập nhật</th><th /></tr></thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="p-2 font-medium">{formatMonth(s.year, s.month)}</td>
                  <td className="p-2">{s.employeeIds.length}</td>
                  <td className="p-2">{s.employeeIds.filter((id) => rowHasData(s, id)).length}</td>
                  <td className="p-2">{s.locked ? <Badge color="blue">Đã khóa ({s.lockedBy})</Badge> : <Badge color="green">Đang mở</Badge>}</td>
                  <td className="p-2 text-xs">{new Date(s.updatedAt).toLocaleString('vi-VN')}</td>
                  <td className="p-2 text-right"><Button small onClick={() => { a.setMonth(s.year, s.month); toast(`Đã chọn tháng ${formatMonth(s.year, s.month)} – mở thẻ "Bảng chấm công".`, 'info'); }}>Chọn tháng</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Điểm khôi phục trên máy (tự tạo trước thao tác ghi đè)">
        {!snaps.length ? <EmptyState>Chưa có điểm khôi phục.</EmptyState> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left"><tr><th className="p-2">Thời gian</th><th className="p-2">Lý do</th><th className="p-2">Phạm vi</th><th /></tr></thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="p-2">{new Date(s.createdAt).toLocaleString('vi-VN')}</td>
                  <td className="p-2">{s.reason}</td>
                  <td className="p-2">{s.data.scope === 'all' ? 'Toàn bộ' : s.data.units[0]?.code}</td>
                  <td className="whitespace-nowrap p-2 text-right">
                    <Button small onClick={() => downloadJson(`DiemKhoiPhuc_${stamp()}.json`, s.data)}>Tải về</Button>{' '}
                    {a.can('data.restore') && (
                      <Button small variant="danger" onClick={async () => {
                        if (!(await dialog.confirm({ title: 'Khôi phục', message: `Khôi phục dữ liệu về thời điểm ${new Date(s.createdAt).toLocaleString('vi-VN')}? Trạng thái hiện tại sẽ được lưu thành điểm khôi phục mới.`, danger: true }))) return;
                        const r = await a.restoreSnapshot(s.id);
                        toast(r.ok ? 'Đã khôi phục.' : r.message!, r.ok ? 'success' : 'error');
                      }}>Khôi phục</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {restore && (
        <Modal title={`Xem trước file sao lưu: ${restore.name}`} onClose={() => setRestore(null)} footer={
          <>
            <Button onClick={() => setRestore(null)}>Hủy</Button>
            {restore.preview.ok && restore.preview.units.length === 1 && <Button variant="primary" onClick={() => doRestore('unit')}>Phục hồi đơn vị {restore.preview.units[0].code}</Button>}
            {restore.preview.ok && restore.preview.scope === 'all' && session?.role === 'admin' && <Button variant="danger" onClick={() => doRestore('all')}>Phục hồi toàn bộ</Button>}
          </>
        }>
          {!restore.preview.ok ? (
            <ul className="list-disc pl-5 text-sm text-red-700">{restore.preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          ) : (
            <div className="space-y-2 text-sm">
              <div>Tạo lúc: {new Date(restore.preview.createdAt).toLocaleString('vi-VN')} · Phạm vi: {restore.preview.scope === 'all' ? 'toàn bộ' : 'một đơn vị'}</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100"><tr><th className="p-1 text-left">Đơn vị</th><th className="p-1">Nhân sự</th><th className="p-1">Mã công</th><th className="p-1">Bảng</th></tr></thead>
                <tbody>{restore.preview.units.map((u) => (
                  <tr key={u.id} className="border-b"><td className="p-1">{u.code} – {u.name} {u.isSample && <Badge color="purple">mẫu</Badge>}</td><td className="p-1 text-center">{u.employees}</td><td className="p-1 text-center">{u.codes}</td><td className="p-1 text-center">{u.sheets}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
