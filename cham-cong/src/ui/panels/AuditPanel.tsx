import { useEffect, useMemo, useState } from 'react';
import type { AuditEntry } from '../../domain/types';
import { Card, EmptyState, Input } from '../components/ui';
import { useActions, useApp } from '../context';

export function AuditPanel() {
  const a = useActions();
  const tick = useApp((s) => s.auditTick);
  const unitId = useApp((s) => s.unitId);
  const [list, setList] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (a.can('audit.view')) a.listAudit(1000).then(setList).catch(() => setList([]));
  }, [a, tick, unitId]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? list.filter((e) => [e.user, e.action, e.detail].some((x) => x.toLowerCase().includes(s))) : list;
  }, [list, q]);
  if (!a.can('audit.view')) return <Card title="Nhật ký chỉnh sửa">Tài khoản không có quyền xem nhật ký.</Card>;
  return (
    <Card title="Nhật ký chỉnh sửa (đơn vị hiện tại)" actions={<Input className="w-64" placeholder="Lọc theo nội dung, người dùng…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      {!filtered.length ? <EmptyState>Chưa có bản ghi.</EmptyState> : (
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-left"><tr><th className="p-2">Thời gian</th><th className="p-2">Tài khoản</th><th className="p-2">Thao tác</th><th className="p-2">Nội dung</th></tr></thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b align-top">
                  <td className="whitespace-nowrap p-2 text-xs">{new Date(e.ts).toLocaleString('vi-VN')}</td>
                  <td className="p-2">{e.user}</td>
                  <td className="p-2 font-mono text-xs">{e.action}</td>
                  <td className="p-2 text-xs">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
