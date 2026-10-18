import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AttendanceCode, AuditEntry, BackupFile, Employee, MonthSheet, Snapshot, Unit, User } from '../domain/types';

interface ChamCongDB extends DBSchema {
  units: { key: string; value: Unit };
  employees: { key: string; value: Employee; indexes: { byUnit: string } };
  codes: { key: string; value: AttendanceCode; indexes: { byUnit: string } };
  sheets: { key: string; value: MonthSheet; indexes: { byUnit: string } };
  audit: { key: number; value: AuditEntry; indexes: { byUnit: string } };
  snapshots: { key: string; value: Snapshot };
  users: { key: string; value: User };
  meta: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'cham-cong-dai-ttdh';
const VERSION = 1;

const DATA_STORES = ['units', 'employees', 'codes', 'sheets', 'audit'] as const;

/**
 * Lớp truy cập dữ liệu. Mọi truy vấn nghiệp vụ đều theo unitId để
 * không lẫn dữ liệu giữa các Đài.
 */
export class Repo {
  constructor(private db: IDBPDatabase<ChamCongDB>) {}

  static async open(name = DB_NAME): Promise<Repo> {
    const db = await openDB<ChamCongDB>(name, VERSION, {
      upgrade(db) {
        db.createObjectStore('units', { keyPath: 'id' });
        db.createObjectStore('employees', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('codes', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('sheets', { keyPath: 'id' }).createIndex('byUnit', 'unitId');
        db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true }).createIndex('byUnit', 'unitId');
        db.createObjectStore('snapshots', { keyPath: 'id' });
        db.createObjectStore('users', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    return new Repo(db);
  }

  close() {
    this.db.close();
  }

  // ----- Đơn vị
  listUnits() {
    return this.db.getAll('units');
  }
  getUnit(id: string) {
    return this.db.get('units', id);
  }
  async putUnit(u: Unit) {
    await this.db.put('units', u);
  }

  // ----- Nhân sự
  listEmployees(unitId: string) {
    return this.db.getAllFromIndex('employees', 'byUnit', unitId);
  }
  async putEmployees(list: Employee[]) {
    const tx = this.db.transaction('employees', 'readwrite');
    await Promise.all([...list.map((e) => tx.store.put(e)), tx.done]);
  }
  async deleteEmployee(id: string) {
    await this.db.delete('employees', id);
  }

  // ----- Mã công
  listCodes(unitId: string) {
    return this.db.getAllFromIndex('codes', 'byUnit', unitId);
  }
  async putCodes(list: AttendanceCode[]) {
    const tx = this.db.transaction('codes', 'readwrite');
    await Promise.all([...list.map((c) => tx.store.put(c)), tx.done]);
  }
  async deleteCode(id: string) {
    await this.db.delete('codes', id);
  }

  // ----- Bảng chấm công
  getSheet(id: string) {
    return this.db.get('sheets', id);
  }
  listSheets(unitId: string) {
    return this.db.getAllFromIndex('sheets', 'byUnit', unitId);
  }
  async putSheets(list: MonthSheet[]) {
    const tx = this.db.transaction('sheets', 'readwrite');
    await Promise.all([...list.map((s) => tx.store.put(s)), tx.done]);
  }

  // ----- Nhật ký
  async addAudit(entries: AuditEntry[]) {
    const tx = this.db.transaction('audit', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.add({ ...e })), tx.done]);
  }
  async listAudit(unitId: string | null, limit = 500) {
    const all = unitId
      ? await this.db.getAllFromIndex('audit', 'byUnit', unitId)
      : await this.db.getAll('audit');
    return all.sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, limit);
  }

  // ----- Điểm khôi phục nội bộ
  async putSnapshot(s: Snapshot) {
    await this.db.put('snapshots', s);
  }
  async listSnapshots() {
    const all = await this.db.getAll('snapshots');
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  getSnapshot(id: string) {
    return this.db.get('snapshots', id);
  }
  async deleteSnapshot(id: string) {
    await this.db.delete('snapshots', id);
  }

  // ----- Người dùng
  listUsers() {
    return this.db.getAll('users');
  }
  async putUser(u: User) {
    await this.db.put('users', u);
  }
  async deleteUser(id: string) {
    await this.db.delete('users', id);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key))?.value as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.put('meta', { key, value });
  }

  // ----- Sao lưu / phục hồi
  async dump(scope: 'all' | 'unit', unitId?: string): Promise<BackupFile> {
    const createdAt = new Date().toISOString();
    if (scope === 'unit') {
      if (!unitId) throw new Error('Thiếu đơn vị cần sao lưu.');
      const unit = await this.getUnit(unitId);
      if (!unit) throw new Error('Không tìm thấy đơn vị.');
      return {
        format: 'cham-cong-backup',
        version: 1,
        createdAt,
        scope,
        units: [unit],
        employees: await this.listEmployees(unitId),
        codes: await this.listCodes(unitId),
        sheets: await this.listSheets(unitId),
        audit: await this.db.getAllFromIndex('audit', 'byUnit', unitId),
      };
    }
    return {
      format: 'cham-cong-backup',
      version: 1,
      createdAt,
      scope,
      units: await this.db.getAll('units'),
      employees: await this.db.getAll('employees'),
      codes: await this.db.getAll('codes'),
      sheets: await this.db.getAll('sheets'),
      audit: await this.db.getAll('audit'),
      users: await this.db.getAll('users'),
    };
  }

  /** Thay toàn bộ dữ liệu bằng bản sao lưu (trong một giao dịch). */
  async restoreAll(b: BackupFile) {
    const tx = this.db.transaction([...DATA_STORES, 'users'], 'readwrite');
    const ops: Promise<unknown>[] = [];
    for (const s of DATA_STORES) ops.push(tx.objectStore(s).clear());
    // Bản sao lưu không kèm tài khoản → giữ nguyên tài khoản hiện có.
    if (b.users) ops.push(tx.objectStore('users').clear());
    for (const u of b.units) ops.push(tx.objectStore('units').put(u));
    for (const e of b.employees) ops.push(tx.objectStore('employees').put(e));
    for (const c of b.codes) ops.push(tx.objectStore('codes').put(c));
    for (const s of b.sheets) ops.push(tx.objectStore('sheets').put(s));
    for (const a of b.audit) ops.push(tx.objectStore('audit').put(a));
    if (b.users) for (const u of b.users) ops.push(tx.objectStore('users').put(u));
    await Promise.all([...ops, tx.done]);
  }

  /** Thay dữ liệu của một đơn vị (chỉ các bản ghi thuộc đơn vị đó). */
  async replaceUnit(b: BackupFile) {
    if (b.units.length !== 1) throw new Error('Bản sao lưu đơn vị phải chứa đúng 1 đơn vị.');
    const unitId = b.units[0].id;
    const foreign = [...b.employees, ...b.codes, ...b.sheets].some((r) => r.unitId !== unitId);
    if (foreign) throw new Error('Bản sao lưu chứa dữ liệu không thuộc đơn vị.');
    const tx = this.db.transaction(DATA_STORES, 'readwrite');
    const ops: Promise<unknown>[] = [];
    for (const store of ['employees', 'codes', 'sheets', 'audit'] as const) {
      const idx = tx.objectStore(store).index('byUnit');
      let cur = await idx.openCursor(unitId);
      while (cur) {
        ops.push(cur.delete());
        cur = await cur.continue();
      }
    }
    ops.push(tx.objectStore('units').put(b.units[0]));
    for (const e of b.employees) ops.push(tx.objectStore('employees').put(e));
    for (const c of b.codes) ops.push(tx.objectStore('codes').put(c));
    for (const s of b.sheets) ops.push(tx.objectStore('sheets').put(s));
    for (const a of b.audit) {
      const { id: _id, ...rest } = a;
      ops.push(tx.objectStore('audit').add(rest as AuditEntry));
    }
    await Promise.all([...ops, tx.done]);
  }
}
