import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type FrameLocator, type Page } from '@playwright/test';
import type { OpenOptions } from './harness';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ORIGIN = 'http://vellum.test';

// A few of Obsidian's theme variables, so the plugin's own UI renders as it
// would there.
const OBSIDIAN_VARIABLES = `body {
  font-family: system-ui, sans-serif; font-size: 15px; color: #222;
  --background-primary: #fff; --background-secondary: #f6f6f6; --background-modifier-border: #e3e3e3;
  --text-normal: #222; --text-muted: #6b6b6b; --interactive-accent: #7c5cff;
  --shadow-s: 0 1px 2px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.12); --shadow-l: 0 2px 8px rgba(0,0,0,.08), 0 18px 48px rgba(0,0,0,.2);
  --radius-s: 4px; --radius-m: 8px; --size-2-1: 2px; --size-4-1: 4px; --size-4-2: 8px; --size-4-3: 12px; --size-4-4: 16px; --size-4-8: 32px;
  --font-ui-small: 13px; --font-ui-smaller: 12px; --font-semibold: 600; --line-height-normal: 1.5; --font-monospace: ui-monospace, monospace; --layer-tooltip: 70;
}
.clickable-icon { border: 0; background: transparent; padding: 4px; border-radius: 4px; color: #6b6b6b; display: inline-flex; }
.clickable-icon::before { content: attr(data-icon); font-size: 10px; }`;

// Read on first use: the global setup builds these after test collection.
let files: Record<string, { body: string | Buffer; type: string }> | null = null;
function served() {
  files ??= {
    '/': { body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="/harness.js"></script></body></html>', type: 'text/html' },
    '/harness.js': { body: readFileSync(join(root, 'build', 'harness', 'harness.js')), type: 'text/javascript' },
    '/frame.js': { body: readFileSync(join(root, 'build', 'frame', 'frame.js')), type: 'text/javascript' },
    '/assets.json': { body: readFileSync(join(root, 'build', 'frame', 'assets.json')), type: 'application/json' },
    '/plugin': {
      body: `<!doctype html><html><head><meta charset="utf-8"><style>${OBSIDIAN_VARIABLES}</style><link rel="stylesheet" href="/styles.css"></head><body class="theme-light" style="margin:0"><script src="/plugin-harness.js"></script></body></html>`,
      type: 'text/html',
    },
    '/plugin-harness.js': { body: readFileSync(join(root, 'build', 'harness', 'plugin-harness.js')), type: 'text/javascript' },
    '/styles.css': { body: readFileSync(join(root, 'styles.css')), type: 'text/css' },
  };
  return files;
}

export const servicesYaml = readFileSync(join(root, 'test', 'fixtures', 'services.vellum'), 'utf8');

export interface Harness {
  page: Page;
  frame: FrameLocator;
  open(options?: Partial<OpenOptions>): Promise<void>;
  calls(name?: string): Promise<{ name: string; args: unknown[] }[]>;
  /** Centre of an element inside the editor frame, in page coordinates. */
  point(selector: string): Promise<{ x: number; y: number }>;
}

async function serve(page: Page) {
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = served()[path];
    return file ? route.fulfill({ body: file.body, contentType: file.type }) : route.fulfill({ status: 404, body: 'Not found' });
  });
}

export const test = base.extend<{ harness: Harness; plugin: Page; consoleErrors: string[] }>({
  plugin: async ({ page }, use) => {
    await serve(page);
    await page.goto(`${ORIGIN}/plugin`);
    await page.waitForFunction(() => 'ph' in window);
    await use(page);
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
  },
  harness: async ({ page }, use) => {
    await serve(page);
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => 'harness' in window);
    const harness: Harness = {
      page,
      frame: page.frameLocator('iframe.vellum-frame').last(),
      async open(options = {}) {
        await page.evaluate((o) => window.harness.open(o), { yaml: servicesYaml, ...options });
      },
      calls: (name) => page.evaluate((n) => window.harness.calls(n), name),
      async point(selector) {
        const point = await page.evaluate((s) => window.harness.pagePoint(s), selector);
        if (!point) throw new Error(`No element matches ${selector}`);
        return point;
      },
    };
    await use(harness);
  },
});

export { expect } from '@playwright/test';
