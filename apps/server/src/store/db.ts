import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE } from '../config.ts';

export interface DeviceRow {
  id: number;
  name: string;
  type: number;
  mac: string;
  sort: number | null;
}

/**
 * 持久化层：设备列表、全局设置、单设备设置。
 */
export class Store {
  db: DatabaseSync;

  constructor(file: string = DB_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      create table if not exists device_list(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name varchar(32) NOT NULL,
        type int NOT NULL,
        mac varchar(12) NOT NULL,
        sort int
      );
      create table if not exists settings(key TEXT PRIMARY KEY, value TEXT);
      create table if not exists device_settings(mac TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(mac,key));
    `);
  }

  // ---- 设备列表 ----

  devices(): DeviceRow[] {
    return this.db.prepare('select id,name,type,mac,sort from device_list order by sort, id').all() as DeviceRow[];
  }

  insertDevice(name: string, type: number, mac: string, sort: number): void {
    this.db
      .prepare('insert into device_list(name,type,mac,sort) values(?,?,?,?)')
      .run(name, type, mac, sort);
  }

  deleteDevice(mac: string): void {
    this.db.prepare('delete from device_list where mac=?').run(mac);
    this.db.prepare('delete from device_settings where mac=?').run(mac);
  }

  updateName(mac: string, name: string): void {
    this.db.prepare('update device_list set name=? where mac=?').run(name, mac);
  }

  updateType(mac: string, type: number): void {
    this.db.prepare('update device_list set type=? where mac=?').run(type, mac);
  }

  /** 按给定顺序重写排序 */
  reorder(macs: string[]): void {
    const tx = this.db.prepare('update device_list set sort=? where mac=?');
    macs.forEach((mac, i) => tx.run(i, mac));
  }

  // ---- 全局设置 ----

  getSetting(key: string, def = ''): string {
    const row = this.db.prepare('select value from settings where key=?').get(key) as
      | { value: string | null }
      | undefined;
    return row?.value ?? def;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value')
      .run(key, value);
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare('select key,value from settings').all() as {
      key: string;
      value: string | null;
    }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value ?? '';
    return out;
  }

  // ---- 单设备设置 ----

  getDeviceSetting(mac: string, key: string, def = ''): string {
    const row = this.db
      .prepare('select value from device_settings where mac=? and key=?')
      .get(mac, key) as { value: string | null } | undefined;
    return row?.value ?? def;
  }

  setDeviceSetting(mac: string, key: string, value: string): void {
    this.db
      .prepare(
        'insert into device_settings(mac,key,value) values(?,?,?) on conflict(mac,key) do update set value=excluded.value',
      )
      .run(mac, key, value);
  }

  close(): void {
    this.db.close();
  }
}
