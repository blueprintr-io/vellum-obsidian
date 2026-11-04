// Installed libraries and added icon packs. Core keeps them in IndexedDB,
// which every editor frame shares through Obsidian's origin, so the plugin
// holds the one copy instead: each record in its own file in the plugin
// folder, read by frames on demand and written shortly after a change.

import { normalizePath, type DataAdapter } from 'obsidian';
import { STORED_RECORDS, type StoredRecord } from '../shared/protocol';

type Adapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'>;

export class RecordStore {
  private values = new Map<StoredRecord, unknown>();
  private pending = new Map<StoredRecord, number>();

  constructor(
    private adapter: Adapter,
    private dir: string,
    private delay: number,
    private onError: (key: StoredRecord, error: unknown) => void,
  ) {}

  path(key: StoredRecord) {
    return normalizePath(`${this.dir}/${STORED_RECORDS[key]}`);
  }

  async load() {
    for (const key of Object.keys(STORED_RECORDS) as StoredRecord[]) {
      try {
        const path = this.path(key);
        if (await this.adapter.exists(path)) this.values.set(key, JSON.parse(await this.adapter.read(path)));
      } catch (error) {
        console.error(`[vellum] could not read ${STORED_RECORDS[key]}`, error);
      }
    }
  }

  read(key: StoredRecord): unknown {
    return this.values.get(key);
  }

  /** Keep a record and write it to its file shortly after. Saving the value
   *  it already holds, which core does after every load, is free. */
  save(key: StoredRecord, value: unknown) {
    const text = value === undefined ? undefined : JSON.stringify(value);
    const current = this.values.get(key);
    if (text === (current === undefined ? undefined : JSON.stringify(current))) return;
    // A copy of its own, not one tied to the frame that sent it.
    if (text === undefined) this.values.delete(key);
    else this.values.set(key, JSON.parse(text));
    window.clearTimeout(this.pending.get(key));
    this.pending.set(key, window.setTimeout(() => void this.write(key), this.delay));
  }

  /** Write every record still waiting on its timer. */
  flush() {
    const keys = [...this.pending.keys()];
    for (const key of keys) window.clearTimeout(this.pending.get(key));
    return Promise.all(keys.map((key) => this.write(key)));
  }

  private async write(key: StoredRecord) {
    this.pending.delete(key);
    const path = this.path(key);
    const value = this.values.get(key);
    try {
      if (value !== undefined) await this.adapter.write(path, JSON.stringify(value));
      else if (await this.adapter.exists(path)) await this.adapter.remove(path);
    } catch (error) {
      this.onError(key, error);
    }
  }
}
