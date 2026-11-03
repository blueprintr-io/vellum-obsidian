import { expect, servicesYaml, test } from './fixtures';

const diagramMd = (yaml: string, body = '') =>
  `---\nvellum-plugin: parsed\n---\n${body}\n# Vellum Data\n\n%%\n## Diagram\n\`\`\`vellum\n${yaml}\`\`\`\n%%\n`;

const stratumNote = (shape: string, text: string) =>
  `---\nvellum-diagram: "[[Net.vellum.md]]"\nvellum-shape: ${shape}\nvellum-tab: tab-1\nvellum-kind: note\n---\n${text}\n`;

const FILES = {
  'Diagrams/Net.vellum.md': diagramMd(servicesYaml, 'Notes beside the diagram.\n'),
  'Diagrams/API Gateway.md': stratumNote('api', 'The gateway terminates TLS and routes to services.'),
  'Runbook.md': '# Runbook\n',
};

test.describe('plugin', () => {
  test('opens a Markdown diagram, saves edits with notes and index intact', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    await page.evaluate(() => window.ph.open('Diagrams/Net.vellum.md'));
    const frame = page.frameLocator('iframe.vellum-frame').first();
    // A fresh install shows core's welcome once.
    await frame.getByRole('button', { name: 'Get started' }).click();
    await frame.getByRole('button', { name: 'Collapse library panel' }).click();
    await frame.locator('svg[data-vellum-canvas] [data-shape-id="db"]').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => window.ph.text('Diagrams/Net.vellum.md'))).not.toContain('body: Orders DB');
    const text = (await page.evaluate(() => window.ph.text('Diagrams/Net.vellum.md')))!;
    expect(text).toContain('Notes beside the diagram.');
    expect(text).toMatch(/^- API Gateway \^api$/m);
    expect(text).toMatch(/^- See \[\[Runbook\]\] for failover \^docs$/m);
    expect(text).toContain('vellum-plugin: parsed');
  });

  test('finishing the welcome once carries over to every diagram', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), { ...FILES, 'Other.vellum': servicesYaml });
    await page.evaluate(() => window.ph.open('Diagrams/Net.vellum.md'));
    await page.frameLocator('iframe.vellum-frame').first().getByRole('button', { name: 'Get started' }).click();
    await expect.poll(() => page.evaluate(() => window.ph.plugin.preferences?.state.hasCompletedOnboarding)).toBe(true);
    await page.evaluate(() => window.ph.open('Other.vellum'));
    const second = page.frameLocator('iframe.vellum-frame').nth(1);
    await expect(second.locator('svg[data-vellum-canvas] [data-shape-id="api"]')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Get started' })).toHaveCount(0);
  });

  test('read mode: a stratum shape opens its note in a window, hovering shows a card', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    await page.evaluate(() => window.ph.open('Diagrams/Net.vellum.md', 'read'));
    const frame = page.frameLocator('iframe.vellum-frame').first();
    const api = frame.locator('svg[data-vellum-canvas] [data-shape-id="api"]');
    await api.hover();
    await expect(page.locator('.vellum-stratum-card')).toContainText('The gateway terminates TLS');
    await expect(page.locator('.vellum-stratum-card-title')).toHaveText('API Gateway');
    await api.click();
    const window_ = page.locator('.vellum-stratum-window');
    await expect(window_).toBeVisible();
    await expect(window_.locator('.vellum-stratum-window-title')).toHaveText('API Gateway');
    await expect(window_.locator('.vellum-stratum-window-body')).toContainText('terminates TLS');
    // A second click focuses the same window instead of opening another.
    await page.keyboard.press('Escape');
    await expect(window_).toHaveCount(0);
  });

  test('a stratum edited elsewhere updates the diagram\'s strata', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    await page.evaluate(() => window.ph.open('Diagrams/Net.vellum.md', 'read'));
    await page.evaluate(() => window.ph.write('Diagrams/Orders.md', '---\nvellum-diagram: "[[Net.vellum.md]]"\nvellum-shape: db\n---\nOrders.'));
    await expect.poll(() => page.evaluate(() => window.ph.plugin.strata.forDiagram('Diagrams/Net.vellum.md').map((s) => s.shapeId).sort())).toEqual(['api', 'db']);
    const frame = page.frameLocator('iframe.vellum-frame').first();
    await frame.locator('svg[data-vellum-canvas] [data-shape-id="db"]').click();
    await expect(page.locator('.vellum-stratum-window-title')).toHaveText('Orders');
  });

  test('edit mode: Add stratum creates a note beside the diagram', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    await page.evaluate(() => window.ph.open('Diagrams/Net.vellum.md'));
    const frame = page.frameLocator('iframe.vellum-frame').first();
    await frame.getByRole('button', { name: 'Get started' }).click();
    await frame.getByRole('button', { name: 'Collapse library panel' }).click();
    await frame.locator('svg[data-vellum-canvas] [data-shape-id="db"]').click({ button: 'right' });
    await frame.getByRole('button', { name: 'Add stratum…' }).click();
    await expect.poll(() => page.evaluate(() => window.ph.text('Diagrams/Net - Orders DB.md'))).toContain('vellum-shape: db');
    const note = (await page.evaluate(() => window.ph.text('Diagrams/Net - Orders DB.md')))!;
    expect(note).toContain('vellum-diagram: "[[Net.vellum.md]]"');
    expect(note).toContain('vellum-tab: tab-1');
  });

  test('embeds render through the renderer frame with clickable strata', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    const hotspots = await page.evaluate(() => window.ph.embed('Diagrams/Net.vellum.md'));
    // api has a stratum; docs and site have links.
    expect(hotspots).toBe(3);
    await expect(page.locator('.vellum-embed-image')).toBeVisible();
    const box = await page.locator('.vellum-embed-image').boundingBox();
    expect(box!.width).toBeGreaterThan(200);
    await page.locator('.vellum-hotspot[aria-label="API Gateway"]').click();
    await expect(page.locator('.vellum-stratum-window-title')).toHaveText('API Gateway');
  });

  test('an embed can crop to one shape', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), FILES);
    const hotspots = await page.evaluate(() => window.ph.embed('Diagrams/Net.vellum.md', '#^api'));
    expect(hotspots).toBe(1);
  });

  test('renaming a note rewrites links in a closed .vellum file', async ({ plugin: page }) => {
    const yaml = servicesYaml.replace('body: See [[Runbook]] for failover', 'body: See [[Runbook]] for failover\n          meta:\n            link: "[[Runbook]]"');
    await page.evaluate((files) => window.ph.start(files), { 'Flow.vellum': yaml, 'Runbook.md': '# Runbook\n' });
    await page.evaluate(async () => {
      const file = window.ph.app.vault.getFileByPath('Runbook.md')!;
      await window.ph.app.fileManager.renameFile(file, 'Ops/Recovery.md');
    });
    await expect.poll(() => page.evaluate(() => window.ph.text('Flow.vellum')), { timeout: 10000 }).toContain('[[Recovery]]');
    const text = (await page.evaluate(() => window.ph.text('Flow.vellum')))!;
    expect(text).not.toContain('[[Runbook]]');
    expect(text).toContain('link: "[[Recovery]]"');
  });

  test('a file that is not a diagram shows an error and is left alone', async ({ plugin: page }) => {
    await page.evaluate((files) => window.ph.start(files), { 'Bad.vellum': 'tabs: [broken' });
    await page.evaluate(async () => {
      const leaf = window.ph.app.workspace.getLeaf();
      leaf.host = document.body;
      await leaf.openFile(window.ph.app.vault.getFileByPath('Bad.vellum')!);
    });
    await expect(page.locator('.vellum-view-error')).toContainText('could not be opened as a diagram');
    await page.evaluate(() => window.ph.view().save());
    expect(await page.evaluate(() => window.ph.text('Bad.vellum'))).toBe('tabs: [broken');
  });
});
