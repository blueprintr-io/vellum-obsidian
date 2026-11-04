import { expect, test } from './fixtures';

const STRATA = [
  { path: 'Diagrams/API Gateway.md', title: 'API Gateway', kind: 'note', shapeId: 'api', tabId: 'tab-1' },
];

test.describe('editor frame', () => {
  test('boots with core and renders the file', async ({ harness, consoleErrors }) => {
    await harness.open();
    await expect(harness.frame.locator('svg[data-vellum-canvas] [data-shape-id="api"]')).toBeVisible();
    await expect(harness.frame.locator('[data-shape-id="db"]')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('edits reach the host and Ctrl+S writes them', async ({ harness, page }) => {
    await harness.open();
    await harness.frame.getByRole('button', { name: 'Collapse library panel' }).click();
    const api = await harness.point('svg[data-vellum-canvas] [data-shape-id="api"]');
    await page.mouse.click(api.x, api.y);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await harness.calls('changed')).length).toBeGreaterThan(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await harness.calls('save')).length).toBeGreaterThan(0);
    const saved = await page.evaluate(() => window.harness.host().saved.at(-1) ?? '');
    expect(saved).toContain('id: db');
    expect(saved).not.toContain('body: API Gateway');
    // Ctrl+S saves; it does not open core's export dialog.
    await expect(harness.frame.getByRole('dialog')).toHaveCount(0);
  });

  test('snapshot indexes text and links for Markdown diagrams', async ({ harness, page }) => {
    await harness.open();
    const snapshot = await page.evaluate(() => window.harness.frame().snapshot());
    expect(snapshot).not.toBeNull();
    expect(snapshot!.text.map((t) => t.text)).toEqual(expect.arrayContaining(['API Gateway', 'See [[Runbook]] for failover', 'Copied API']));
    expect(snapshot!.links).toEqual([expect.objectContaining({ shapeId: 'site', link: 'https://status.example.com' })]);
    expect(snapshot!.extra).toEqual(expect.arrayContaining(['reads', 'Services', 'Second']));
    // Shape ids repeat across tabs; block ids stay unique.
    const blocks = snapshot!.text.map((t) => t.block);
    expect(new Set(blocks).size).toBe(blocks.length);
  });

  test('edit mode: right-click offers Add stratum, then Edit stratum once linked', async ({ harness, page }) => {
    await harness.open();
    await harness.frame.getByRole('button', { name: 'Collapse library panel' }).click();
    const api = await harness.point('svg[data-vellum-canvas] [data-shape-id="api"]');
    await page.mouse.click(api.x, api.y, { button: 'right' });
    await harness.frame.getByRole('button', { name: 'Add stratum…' }).click();
    const [create] = await harness.calls('stratum');
    expect(create.args[0]).toMatchObject({ type: 'create', shapeId: 'api', tabId: 'tab-1', label: 'API Gateway' });

    await page.evaluate((strata) => window.harness.frame().setStrata(strata as never), STRATA);
    await page.mouse.click(api.x, api.y, { button: 'right' });
    await harness.frame.getByRole('button', { name: 'Edit stratum…' }).click();
    const calls = await harness.calls('stratum');
    expect(calls.at(-1)!.args[0]).toEqual({ type: 'edit', path: 'Diagrams/API Gateway.md' });
  });

  test('read mode: clicking a stratum shape opens it, plain shapes do nothing', async ({ harness, page }) => {
    await harness.open({ mode: 'read' });
    await page.evaluate((strata) => window.harness.frame().setStrata(strata as never), STRATA);
    const db = await harness.point('svg[data-vellum-canvas] [data-shape-id="db"]');
    await page.mouse.click(db.x, db.y);
    expect(await harness.calls('stratum')).toEqual([]);
    const api = await harness.point('svg[data-vellum-canvas] [data-shape-id="api"]');
    await page.mouse.click(api.x, api.y);
    await expect.poll(() => harness.calls('stratum')).toEqual([
      { name: 'stratum', args: [{ type: 'open', path: 'Diagrams/API Gateway.md', shapeId: 'api' }] },
    ]);
    // Read mode never selects.
    await expect(harness.frame.locator('[data-selection-box], [data-handle]')).toHaveCount(0);
  });

  test('read mode: links open, a label wikilink counts as the shape link', async ({ harness, page }) => {
    await harness.open({ mode: 'read' });
    const docs = await harness.point('svg[data-vellum-canvas] [data-shape-id="docs"]');
    await page.mouse.click(docs.x, docs.y);
    const site = await harness.point('svg[data-vellum-canvas] [data-shape-id="site"]');
    await page.keyboard.down('Control');
    await page.mouse.click(site.x, site.y);
    await page.keyboard.up('Control');
    await expect.poll(() => harness.calls('link')).toEqual([
      { name: 'link', args: [{ type: 'open', link: '[[Runbook]]', newLeaf: false }] },
      { name: 'link', args: [{ type: 'open', link: 'https://status.example.com', newLeaf: true }] },
    ]);
  });

  test('read mode: hovering a stratum shape reports it with its screen rect', async ({ harness, page }) => {
    await harness.open({ mode: 'read' });
    await page.evaluate((strata) => window.harness.frame().setStrata(strata as never), STRATA);
    const api = await harness.point('svg[data-vellum-canvas] [data-shape-id="api"]');
    await page.mouse.move(api.x - 200, api.y - 60);
    await page.mouse.move(api.x, api.y, { steps: 4 });
    await expect.poll(async () => (await harness.calls('hoverStratum')).length).toBeGreaterThan(0);
    const [hover] = await harness.calls('hoverStratum');
    expect(hover.args[0]).toBe('Diagrams/API Gateway.md');
    expect(hover.args[1]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    // Out of the frame altogether.
    await page.mouse.move(1250, 790, { steps: 4 });
    await expect.poll(async () => (await harness.calls('hoverEnd')).length).toBeGreaterThan(0);
  });

  test('read mode: a drag pans instead of selecting', async ({ harness, page }) => {
    await harness.open({ mode: 'read' });
    const before = await harness.point('svg[data-vellum-canvas] [data-shape-id="db"]');
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x - 120, before.y + 40, { steps: 6 });
    await page.mouse.up();
    const after = await harness.point('svg[data-vellum-canvas] [data-shape-id="db"]');
    expect(Math.round(after.x - before.x)).toBe(-120);
    expect(Math.round(after.y - before.y)).toBe(40);
    expect(await harness.calls('stratum')).toEqual([]);
  });

  test('switching modes swaps the editor chrome for the reader', async ({ harness }) => {
    await harness.open();
    await expect(harness.frame.getByTitle('Menu')).toBeVisible();
    await harness.frame.getByRole('button', { name: 'Read-only mode' }).click();
    await expect.poll(() => harness.calls('setMode')).toEqual([{ name: 'setMode', args: ['read'] }]);
    await expect(harness.frame.getByTitle('Menu')).toHaveCount(0);
    await harness.frame.getByRole('button', { name: 'Edit diagram' }).click();
    await expect(harness.frame.getByTitle('Menu')).toBeVisible();
  });

  test('core replacing the workspace never reaches the file', async ({ harness, page }) => {
    await harness.open();
    await harness.frame.locator('svg[data-vellum-canvas]').click({ position: { x: 900, y: 600 } });
    await page.keyboard.press('Control+Alt+n');
    await expect.poll(() => harness.calls('replaced')).toEqual([{ name: 'replaced', args: [true, null, true] }]);
    expect(await page.evaluate(() => window.harness.frame().snapshot())).toBeNull();
  });

  test('unhandled chords are passed to Obsidian, text editing keys are not', async ({ harness, page }) => {
    await harness.open();
    await harness.frame.locator('svg[data-vellum-canvas]').click({ position: { x: 900, y: 600 } });
    await page.keyboard.press('Control+p');
    await page.keyboard.press('Control+o');
    await expect.poll(async () => (await harness.calls('key')).map((c) => (c.args[0] as { key: string }).key).sort()).toEqual(['o', 'p']);
  });

  test('preferences and the library go to the host', async ({ harness }) => {
    await harness.open();
    await harness.frame.getByTitle('Toggle theme').click();
    await expect.poll(async () => {
      const calls = await harness.calls('savePreferences');
      return (calls.at(-1)?.args[0] as { state: { theme?: string } } | undefined)?.state.theme;
    }).toBe('dark');
  });

  test('exports an SVG with hotspots for linked shapes', async ({ harness, page }) => {
    await harness.open({ mode: 'read' });
    await page.evaluate((strata) => window.harness.frame().setStrata(strata as never), STRATA);
    const result = await page.evaluate(() => window.harness.frame().exportImage({ format: 'svg', theme: 'light' }));
    expect(result.data).toContain('<svg');
    expect(result.width).toBeGreaterThan(100);
    const ids = result.hotspots.map((h) => h.shapeId).sort();
    expect(ids).toEqual(['api', 'docs', 'site']);
    for (const spot of result.hotspots) {
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x + spot.width).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('frame storage', () => {
  test('installed libraries and added icon packs live in the plugin, not the frame', async ({ harness, page }) => {
    const installed = { id: 'homelab-kit', name: 'Homelab Kit', version: '1.0.0', license: 'MIT', authors: [], icons: [], source: { url: 'https://example.com/homelab-kit.vellumlib', gallery: false } };
    const libraries = { state: { installed: [installed] }, version: 1 };
    await harness.open({ records: { 'vellum.libraries': libraries } });
    // The calls core's recovery backend makes, inside the frame.
    const result = await page.evaluate(async () => {
      const frames = document.querySelectorAll<HTMLIFrameElement>('iframe.vellum-frame');
      const idb = (frames[frames.length - 1].contentWindow as Window & typeof globalThis).indexedDB;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = idb.open('vellum-recovery', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const run = (mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest) =>
        new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('workspaces', mode);
          const request = op(tx.objectStore('workspaces'));
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = () => reject(tx.error);
        });
      const read = await run('readonly', (s) => s.get('vellum.libraries'));
      await run('readwrite', (s) => s.put({ version: 1, packs: [{ id: 'fortinet' }] }, 'vellum.iconPacks'));
      const packs = await run('readonly', (s) => s.get('vellum.iconPacks'));
      await run('readwrite', (s) => s.delete('vellum.libraries'));
      await run('readwrite', (s) => s.put({ state: { diagram: {} }, version: 1 }, 'vellum.recovery-copy'));
      const dropped = await run('readonly', (s) => s.get('vellum.recovery-copy'));
      return { read, packs, dropped };
    });
    expect(result.read).toEqual(libraries);
    expect(result.packs).toEqual({ version: 1, packs: [{ id: 'fortinet' }] });
    expect(result.dropped).toBeUndefined();
    expect((await harness.calls('saveRecord')).map((c) => c.args)).toEqual([
      ['vellum.iconPacks', { version: 1, packs: [{ id: 'fortinet' }] }],
      ['vellum.libraries', null],
    ]);
  });
});
