// The plugin in a real Obsidian: a fresh vault with the built plugin
// installed, driven through Obsidian's own UI.

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type FrameLocator, type Page } from '@playwright/test';

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

const VAULT_WINDOW = 'app://obsidian.md/index.html';

let obsidian: ChildProcess;
let browser: Browser;
let win: Page;
let vault: string;
let output = '';
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

/**
 * Starts Obsidian with the test config and returns its vault window.
 * Obsidian's build turns off Electron's --inspect switch, which Playwright's
 * Electron launcher depends on, so this connects to Chromium's debugging
 * port instead.
 */
async function launch(config: string): Promise<Page> {
  obsidian = spawn(process.env.OBSIDIAN_BIN!, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0'], {
    env: { ...process.env, XDG_CONFIG_HOME: config },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Obsidian opened no debugging port.\n${output}`)), 90_000);
    const listen = (chunk: Buffer) => {
      if (output.length < 200_000) output += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    obsidian.stdout!.on('data', listen);
    obsidian.stderr!.on('data', listen);
    obsidian.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Obsidian exited (${signal ?? code}).\n${output}`));
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  // A new window reports about:blank until it navigates, so poll its URL
  // rather than waiting for the page event.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const page = context.pages().find((p) => p.url().startsWith(VAULT_WINDOW));
    if (page) return page;
    if (Date.now() > deadline) {
      throw new Error(`Obsidian opened no vault window. Pages: ${context.pages().map((p) => p.url()).join(', ') || 'none'}\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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
  // A cold Electron start on a CI runner can take a while.
  test.setTimeout(300_000);
  const made = makeVault();
  vault = made.dir;
  win = await launch(made.config);
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  win.on('pageerror', (error) => errors.push(`${error.message}\n${error.stack ?? ''}`));
  await win.waitForFunction(() => (window as unknown as { app?: any }).app?.workspace?.layoutReady === true, null, { timeout: 90_000 });
  // A vault opened for the first time with plugins in it asks whether to
  // trust its author. Answering yes turns community plugins on, loads the
  // ones in community-plugins.json, then opens their settings.
  await win.locator('.modal.mod-trust-folder').getByRole('button', { name: 'Trust author and enable plugins' }).click({ timeout: 60_000 });
  await expect(win.locator('.modal.mod-settings')).toBeVisible({ timeout: 60_000 });
  await win.evaluate(() => (window as unknown as { app: any }).app.plugins.plugins.vellum.ready);
  await win.evaluate(() => (window as unknown as { app: any }).app.setting.close());
  await expect(win.locator('.modal-container')).toHaveCount(0);
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    await win?.screenshot({ path: info.outputPath('obsidian.png') }).catch(() => {});
    writeFileSync(info.outputPath('console-errors.txt'), errors.join('\n\n'));
    writeFileSync(info.outputPath('obsidian-output.txt'), output);
  }
});

test.afterAll(async () => {
  await browser?.close();
  if (obsidian?.exitCode === null && obsidian.signalCode === null) {
    const exited = new Promise((resolve) => obsidian.once('exit', resolve));
    obsidian.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    obsidian.kill('SIGKILL');
  }
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
  // Obsidian's base themes: "obsidian" is dark, "moonstone" is light.
  await win.evaluate(() => (window as unknown as { app: any }).app.changeTheme('obsidian'));
  await expect.poll(themeClass).not.toContain('theme-light');
  await win.evaluate(() => (window as unknown as { app: any }).app.changeTheme('moonstone'));
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
    // Moving a file doesn't create the folder it moves into.
    await obsidian.vault.createFolder('Ops');
    await obsidian.fileManager.renameFile(obsidian.vault.getFileByPath('Runbook.md'), 'Ops/Recovery.md');
  });
  await expect.poll(() => read('Flow.vellum'), { timeout: 30_000 }).toContain('link: "[[Recovery]]"');
  expect(read('Flow.vellum')).not.toContain('[[Runbook]]');
  await expect.poll(() => read('Diagrams/Net.vellum.md'), { timeout: 30_000 }).not.toContain('[[Runbook]]');
});

test('the plugin logged no errors', async () => {
  expect(errors.filter((e) => /vellum/i.test(e))).toEqual([]);
});
