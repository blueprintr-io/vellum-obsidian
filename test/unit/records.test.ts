import assert from 'node:assert/strict';
import test from 'node:test';

// RecordStore schedules writes with window timers.
(globalThis as Record<string, unknown>).window ??= globalThis;

const { RecordStore } = await import('../../src/records');

function adapter(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  const writes: string[] = [];
  return {
    disk,
    writes,
    exists: async (p: string) => disk.has(p),
    read: async (p: string) => {
      if (!disk.has(p)) throw new Error(`ENOENT ${p}`);
      return disk.get(p)!;
    },
    write: async (p: string, d: string) => {
      writes.push(p);
      disk.set(p, d);
    },
    remove: async (p: string) => {
      disk.delete(p);
    },
  };
}

const LIBRARIES = '.obsidian/plugins/vellum/libraries.json';
const PACKS = '.obsidian/plugins/vellum/icon-packs.json';

test('records load from their own files and save back to them', async () => {
  const disk = adapter({ [LIBRARIES]: JSON.stringify({ state: { installed: [{ id: 'homelab-kit' }] }, version: 1 }) });
  const store = new RecordStore(disk as never, '.obsidian/plugins/vellum', 60_000, () => assert.fail('no errors expected'));
  await store.load();
  assert.deepEqual(store.read('vellum.libraries'), { state: { installed: [{ id: 'homelab-kit' }] }, version: 1 });
  assert.equal(store.read('vellum.iconPacks'), undefined);

  store.save('vellum.iconPacks', { version: 1, packs: [{ id: 'fortinet' }] });
  assert.deepEqual(disk.writes, [], 'writes wait for the delay');
  await store.flush();
  assert.deepEqual(JSON.parse(disk.disk.get(PACKS)!), { version: 1, packs: [{ id: 'fortinet' }] });
});

test('saving what is already held writes nothing; undefined deletes the file', async () => {
  const disk = adapter({ [PACKS]: JSON.stringify({ version: 1, packs: [] }) });
  const store = new RecordStore(disk as never, '.obsidian/plugins/vellum', 0, () => assert.fail('no errors expected'));
  await store.load();
  store.save('vellum.iconPacks', { version: 1, packs: [] });
  await store.flush();
  assert.deepEqual(disk.writes, []);

  store.save('vellum.iconPacks', undefined);
  await store.flush();
  assert.equal(disk.disk.has(PACKS), false);
  assert.equal(store.read('vellum.iconPacks'), undefined);
});

test('the store keeps its own copy and reports failed writes', async () => {
  const disk = adapter();
  const failures: string[] = [];
  const store = new RecordStore(
    { ...disk, write: async () => Promise.reject(new Error('disk full')) } as never,
    'p',
    0,
    (key) => failures.push(key),
  );
  const value = { state: { installed: [] as string[] }, version: 1 };
  store.save('vellum.libraries', value);
  value.state.installed.push('changed after saving');
  assert.deepEqual(store.read('vellum.libraries'), { state: { installed: [] }, version: 1 });
  await store.flush();
  assert.deepEqual(failures, ['vellum.libraries']);
});
