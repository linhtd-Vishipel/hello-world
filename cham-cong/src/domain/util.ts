export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  const id = c && 'randomUUID' in c ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${id}` : id;
}

export const nowIso = () => new Date().toISOString();

/** So khớp không phân biệt hoa thường và khoảng trắng thừa. */
export function normKey(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi');
}

/** Bỏ dấu tiếng Việt để phát hiện trùng họ tên đáng ngờ. */
export function foldVietnamese(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Cộng số thập phân an toàn (làm tròn 2 chữ số). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}
