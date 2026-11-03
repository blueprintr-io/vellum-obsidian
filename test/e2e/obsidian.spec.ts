// The plugin in a real Obsidian: a fresh vault with the built plugin
// installed, driven through Obsidian's own UI.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type FrameLocator, type Page } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const services = readFileSync(join(root, 'test', 'fixtures', 'services.vellum'), 'utf8');

const diagram = (yaml: string, notes: string) =>
  `---\nvellum-plugin: parsed\n---\n${notes}\n# Vellum Data\n\n%%\n## Diagram\n\`\`\`vellum\n${yaml}\`\`\`\n%%\n`;

const FILES: Record<string, string> = {
  'Diagrams/Net.vellum.md': diagram(services, 'Notes beside the diagram.\n'),
  'Diagrams/API Gateway.md': '---\nvellum-diagram: "[[Net.vellum.md]]"\nvellum-shape: api\nvellum-tab: tab-1\nvellum-kind: note\n---\nThe gateway **terminates TLS** and routes requests.\n',
  'Embeds.md': 'An embedded diagram:\n\n![[Net.vellum]]\n\nA link to it: [[Net.vellum]]\n',
  'Runbook.md': '# Runbook\n',
  'Flow.vellum': services.replace('          body: Orders DB\n', '          body: Orders DB\n          meta:\n            link: "[[Runbook]]"\n'),
};

let app: ElectronApplication;
let win: Page;
let vault: string;
const errors: string[] = [];

function makeVault() {
  const base = mkdtempSync(join(tmpdir(), 'vellum-e2e-'));
  const dir = join(base, 'vault');
  const config = join(base, 'config');
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const plugin = join(dir, '.obsidian', 'plugins', 'vellum');
  mkdirSync(plugin, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(root, file), join(plugin, file));
  writeFileSync(join(dir, '.obsidian', 'community-plugins.json'), JSON.stringify(['vellum']));
  writeFileSync(join(dir, '.obsidian', 'app.json'), JSON.stringify({ alwaysUpdateLinks: true }));
  mkdirSync(join(config, 'obsidian'), { recursive: true });
  writeFileSync(join(config, 'obsidian', 'obsidian.json'), JSON.stringify({
    vaults: { '0123456789abcdef': { path: dir, ts: Date.now(), open: true } },
  }));
  return { dir, config };
}

const read = (path: string) => readFileSync(join(vault, path), 'utf8');
const activeFrame = (): FrameLocator => win.frameLocator('.workspace-leaf.mod-active iframe.vellum-frame');

async function open(path: string, state?: Record<string, unknown>) {
  await win.evaluate(async ({ path, state }) => {
    const obsidian = (window as unknown as { app: any }).app;
    await obsidian.workspace.getLeaf(true).openFile(obsidian.vault.getFileByPath(path), { active: true, state });
  }, { path, state });
}

/** Core's welcome on first use, and its library panel, cover the canvas. */
async function clearEditor(frame: FrameLocator) {
  const start = frame.getByRole('button', { name: 'Get started' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const collapse = frame.getByRole('button', { name: 'Collapse library panel' });
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const made = makeVault();
  vault = made.dir;
  app = await electron.launch({
    executablePath: process.env.OBSIDIAN_BIN!,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    env: { ...process.env, XDG_CONFIG_HOME: made.config },
    timeout: 90_000,
  });
  win = await app.firstWindow();
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  win.on('pageerror', (error) => errors.push(`${error.message}\n${error.stack ?? ''}`));
  await win.waitForFunction(() => (window as unknown as { app?: any }).app?.workspace?.layoutReady === true, null, { timeout: 90_000 });
  // Community plugins start off in a new vault; turn them on as a user
  // would, which loads the plugins listed in community-plugins.json.
  await win.evaluate(async () => {
    const obsidian = (window as unknown as { app: any }).app;
    localStorage.setItem(`enable-plugin-${obsidian.appId}`, 'true');
    await obsidian.plugins.setEnable(true);
  });
  await win.waitForFunction(() => !!(window as unknown as { app: any }).app.plugins.plugins.vellum, null, { timeout: 60_000 });
  await win.evaluate(() => (window as unknown as { app: any }).app.plugins.plugins.vellum.ready);
  await win.evaluate(() => document.querySelectorAll<HTMLElement>('.modal-container .modal-close-button').forEach((b) => b.click()));
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    await win.screenshot({ path: info.outputPath('obsidian.png') }).catch(() => {});
    writeFileSync(info.outputPath('console-errors.txt'), errors.join('\n\n'));
  }
});

test.afterAll(async () => {
  await app?.close();
});

test('opens a Markdown diagram in the Vellum view', async () => {
  await open('Diagrams/Net.vellum.md');
  const type = await win.evaluate(() => (window as unknown as { app: any }).app.workspace.getMostRecentLeaf().view.getViewType());
  expect(type).toBe('vellum');
  await expect(activeFrame().locator('svg[data-vellum-canvas] [data-shape-id="api"]')).toBeVisible({ timeout: 30_000 });
});

test('saves edits with the notes and index intact', async () => {
  const frame = activeFrame();
  await clearEditor(frame);
  await frame.locator('svg[data-vellum-canvas] [data-shape-id="db"]').click();
  await win.keyboard.press('Delete');
  await win.keyboard.press('Control+s');
  await expect.poll(() => read('Diagrams/Net.vellum.md'), { timeout: 15_000 }).not.toContain('body: Orders DB');
  const text = read('Diagrams/Net.vellum.md');
  expect(text).toContain('Notes beside the diagram.');
  expect(text).toMatch(/^- API Gateway \^api$/m);
  expect(text).toContain('vellum-plugin: parsed');
});

test('read-only mode previews a stratum on hover and opens it on click', async () => {
  await win.locator('.workspace-leaf.mod-active .view-actions [aria-label="Read-only mode"]').click();
  const frame = activeFrame();
  await expect(frame.getByRole('button', { name: 'Edit diagram' })).toBeVisible();
  const api = frame.locator('svg[data-vellum-canvas] [data-shape-id="api"]');
  await api.hover();
  await expect(win.locator('.vellum-stratum-card')).toContainText('terminates TLS');
  await api.click();
  await expect(win.locator('.vellum-stratum-window-title')).toHaveText('API Gateway');
  // Obsidian renders the note's Markdown in the window.
  await expect(win.locator('.vellum-stratum-window-body strong')).toHaveText('terminates TLS');
  await win.keyboard.press('Escape');
  await expect(win.locator('.vellum-stratum-window')).toHaveCount(0);
});

test('Obsidian hotkeys work while the editor has focus', async () => {
  await activeFrame().locator('svg[data-vellum-canvas]').click({ position: { x: 30, y: 400 } });
  await win.keyboard.press('Control+p');
  await expect(win.locator('.prompt')).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.locator('.prompt')).toHaveCount(0);
});

test('the editor follows Obsidian\'s theme', async () => {
  const themeClass = () => activeFrame().locator('html').getAttribute('class');
  await win.evaluate(() => (window as unknown as { app: any }).app.commands.executeCommandById('theme:use-dark'));
  await expect.poll(themeClass).not.toContain('theme-light');
  await win.evaluate(() => (window as unknown as { app: any }).app.commands.executeCommandById('theme:use-light'));
  await expect.poll(themeClass).toContain('theme-light');
});

test('embeds render in reading view, hover previews and live preview', async () => {
  await open('Embeds.md', { mode: 'preview' });
  const reading = win.locator('.workspace-leaf.mod-active .markdown-reading-view');
  await expect(reading.locator('.vellum-embed-image')).toBeVisible({ timeout: 30_000 });
  expect(await reading.locator('.vellum-hotspot').count()).toBeGreaterThan(0);

  await win.keyboard.down('Control');
  await reading.locator('a.internal-link[data-href="Net.vellum"]').hover();
  await expect(win.locator('.hover-popover .vellum-embed-image')).toBeVisible({ timeout: 20_000 });
  await win.keyboard.up('Control');
  await win.mouse.move(2, 2);

  await win.evaluate(async () => {
    const leaf = (window as unknown as { app: any }).app.workspace.getMostRecentLeaf();
    await leaf.setViewState({ type: 'markdown', state: { ...leaf.view.getState(), mode: 'source', source: false } });
  });
  await expect(win.locator('.workspace-leaf.mod-active .markdown-source-view .vellum-embed-image')).toBeVisible({ timeout: 30_000 });
});

test('Add stratum creates a note beside the diagram', async () => {
  await open('Diagrams/Net.vellum.md', { mode: 'edit' });
  const frame = activeFrame();
  await clearEditor(frame);
  await frame.locator('svg[data-vellum-canvas] [data-shape-id="site"]').click({ button: 'right' });
  await frame.getByRole('button', { name: 'Add stratum…' }).click();
  await expect.poll(() => existsSync(join(vault, 'Diagrams/Net - Status page.md')), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => read('Diagrams/Net - Status page.md')).toContain('vellum-shape: site');
});

test('renaming a note rewrites the links that point at it', async () => {
  await win.evaluate(async () => {
    const obsidian = (window as unknown as { app: any }).app;
    await obsidian.fileManager.renameFile(obsidian.vault.getFileByPath('Runbook.md'), 'Ops/Recovery.md');
  });
  await expect.poll(() => read('Flow.vellum'), { timeout: 30_000 }).toContain('link: "[[Recovery]]"');
  expect(read('Flow.vellum')).not.toContain('[[Runbook]]');
  await expect.poll(() => read('Diagrams/Net.vellum.md'), { timeout: 30_000 }).not.toContain('[[Runbook]]');
});

test('the plugin logged no errors', async () => {
  expect(errors.filter((e) => /vellum/i.test(e))).toEqual([]);
});
