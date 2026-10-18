import 'fake-indexeddb/auto';
import { Repo } from '../src/storage/db';
import { createAppStore } from '../src/state/store';

let n = 0;
export async function freshStore(dbName = `test-db-${Date.now()}-${n++}`) {
  const repo = await Repo.open(dbName);
  const store = createAppStore(new Date(2026, 9, 18));
  await store.actions.init(repo);
  return { store, repo, dbName, a: store.actions };
}

/** Đơn vị có bộ mã gợi ý (đã xác nhận hệ số) và vài nhân sự. */
export async function setupUnit(a: Awaited<ReturnType<typeof freshStore>>['a'], code = 'CMR', employees = 3) {
  const u = await a.createUnit({ code, name: `Đài TTDH ${code}`, parentOrg: 'Công ty TNHH MTV TTĐT Hàng hải Việt Nam', startYear: 2024 });
  if (!u.ok) throw new Error(u.message);
  await a.addSuggestedCodes(true, '2020-01');
  for (let i = 1; i <= employees; i++) {
    const r = await a.saveEmployee({ code: `${code}${String(i).padStart(3, '0')}`, fullName: `Nhân viên ${code} ${i}`, position: 'Khai thác viên', department: 'Tổ KT', status: 'active' });
    if (!r.ok) throw new Error(r.message);
  }
  return u.data!;
}
