// Runs before any Vellum core module is evaluated (main.tsx imports it
// first). Core persists preferences, the personal library and a recovery
// copy of the open workspace through localStorage and IndexedDB. Every
// frame shares Obsidian's origin, so left alone each editor would read and
// overwrite the others' recovery data. Instead the frame gets private
// storage: preferences, the personal library, installed libraries and added
// icon packs go to the plugin, which keeps one copy for all frames, and
// recovery copies are dropped because the file in the vault is the document.

import { z } from 'zod';
import { FRAME_PROTOCOL, isStoredRecord, type FrameBoot, type HostApi, type StoredSlice } from '../shared/protocol';

// Zod probes whether it may compile parsers with `new Function`. The frame's
// policy forbids it, so the probe would only log a violation; parsing is
// the same either way. This must run before core builds its schemas.
z.config({ jitless: true });

const element = window.frameElement as HTMLIFrameElement | null;
const candidate = element?.vellumHost;
if (!candidate || candidate.protocol !== FRAME_PROTOCOL) {
  throw new Error('The Vellum editor frame was started without a compatible host.');
}

export const host: HostApi = candidate;
export const boot: FrameBoot = host.boot();

/** Core's recovery storage name and the key it keeps preferences under. */
const STORE_NAME = 'vellum.editor';
const PREFERENCES_KEY = `${STORE_NAME}.preferences`;

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  constructor(private onSet?: (key: string, value: string) => void) {}
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) {
    const text = String(value);
    if (this.items.get(key) === text) return;
    this.items.set(key, text);
    this.onSet?.(key, text);
  }
  seed(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const local = new MemoryStorage((key, value) => {
  if (key !== PREFERENCES_KEY) return;
  try {
    host.savePreferences(JSON.parse(value) as StoredSlice<Record<string, unknown>>);
  } catch (error) {
    console.error('[vellum] could not hand preferences to the plugin', error);
  }
});
if (boot.preferences) local.seed(PREFERENCES_KEY, JSON.stringify(boot.preferences));

/** The part of IndexedDB core's recovery backend uses: one database with one
 *  object store, get/put/delete in single-request transactions. Documents
 *  written to it are discarded; the personal library is forwarded, and the
 *  stored records are read from and written to the plugin's copy. Values
 *  cross the frame boundary as structured clones, as IndexedDB would give. */
function recoveryDatabase(library: StoredSlice<unknown[]> | null) {
  let lastLibrary: unknown = library?.state;
  const readRecord = (key: string) => {
    if (isStoredRecord(key)) {
      const value = host.readRecord(key);
      return value === undefined ? undefined : structuredClone(value);
    }
    if (key !== STORE_NAME || !library) return undefined;
    return { state: { personalLibrary: library.state }, version: library.version };
  };
  const writeRecord = (key: string, value: unknown) => {
    if (isStoredRecord(key)) {
      host.saveRecord(key, value);
      return;
    }
    if (key !== STORE_NAME || !value || typeof value !== 'object') return;
    const record = value as { state?: { personalLibrary?: unknown }; version?: number };
    const entries = record.state?.personalLibrary;
    if (!Array.isArray(entries) || entries === lastLibrary) return;
    lastLibrary = entries;
    library = { state: entries, version: record.version ?? 1 };
    host.saveLibrary(library);
  };

  type Request = { result?: unknown; error: DOMException | null; onsuccess?: (() => void) | null; onerror?: (() => void) | null; onupgradeneeded?: (() => void) | null; onblocked?: (() => void) | null };
  const later = (fn: () => void) => window.setTimeout(fn, 0);

  const store = {
    get(key: string) { const request: Request = { error: null, result: readRecord(key) }; return request; },
    put(value: unknown, key: string) { writeRecord(key, value); const request: Request = { error: null, result: key }; return request; },
    delete(key: string) { if (isStoredRecord(key)) host.saveRecord(key, undefined); const request: Request = { error: null, result: undefined }; return request; },
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction() {
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => store,
      };
      later(() => tx.oncomplete?.());
      return tx;
    },
    close() {},
  };
  return {
    open() {
      const request: Request = { error: null, result: database };
      later(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase() {
      const request: Request = { error: null };
      later(() => request.onsuccess?.());
      return request;
    },
  };
}

const define = (name: string, value: unknown) =>
  Object.defineProperty(window, name, { value, configurable: true, writable: true });

define('localStorage', local);
define('sessionStorage', new MemoryStorage());
define('indexedDB', recoveryDatabase(boot.library));

// The icon manifest is served by Vellum's web host. The plugin bundles no
// icon packs, so answer locally instead of asking Obsidian's app:// server.
const nativeFetch = window.fetch.bind(window);
define('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/icons/')) return Promise.resolve(new Response('Not found', { status: 404 }));
  return nativeFetch(input, init);
});
