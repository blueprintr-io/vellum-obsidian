import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installDomHelpers } from '../obsidian/dom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const g = globalThis as Record<string, unknown>;
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'MouseEvent', 'KeyboardEvent']) {
  g[key] = key === 'window' ? dom.window : key === 'document' ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[key];
}
installDomHelpers(dom.window as unknown as Window & typeof globalThis);

const { App, WorkspaceLeaf } = await import('../obsidian/obsidian');
const { yamlToWorkspace } = await import('@/store/persist');
const { StrataIndex } = await import('../../src/strata/index');
const { attachNote, createStratum, detachNote, retargetStratum, stratumNoteName } = await import('../../src/strata/notes');
const { convertDiagram, createDiagram, diagramName, emptyWorkspaceYaml, isMarkdownDiagram } = await import('../../src/files');
const { parseMarkdownDiagram } = await import('../../src/format');
const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../../src/settings');
const { excerptOf } = await import('../../src/hover');
const { VellumView } = await import('../../src/view');

type AppT = InstanceType<typeof App>;

async function setup() {
  const app = new App();
  await app.vault.create('Diagrams/Net.vellum.md', '---\nvellum-plugin: parsed\n---\n\n# Vellum Data\n');
  await app.metadataCache.settled();
  return app;
}

test('a new stratum is a note beside its diagram, bound by its properties', async () => {
  const app = await setup();
  const diagram = app.vault.getFileByPath('Diagrams/Net.vellum.md')!;
  const strata = new StrataIndex(app as never);
  strata.build();
  app.metadataCache.on('changed', (file: never) => strata.update(file));

  const note = await createStratum(app as never, diagram as never, { shapeId: 'shape-1', tabId: 'tab-1', label: 'API: Gateway' }, '{{diagram}} - {{shape}}');
  await app.metadataCache.settled();
  assert.equal(note.path, 'Diagrams/Net - API Gateway.md');
  const fm = app.metadataCache.getFileCache(note as never)!.frontmatter!;
  assert.equal(fm['vellum-diagram'], '[[Net.vellum.md]]');
  assert.equal(fm['vellum-shape'], 'shape-1');
  assert.deepEqual(strata.forDiagram(diagram.path).map((s) => [s.title, s.shapeId, s.tabId, s.kind]), [['Net - API Gateway', 'shape-1', 'tab-1', 'note']]);

  const second = await createStratum(app as never, diagram as never, { shapeId: 'shape-1', tabId: 'tab-1', label: 'API: Gateway' }, '{{diagram}} - {{shape}}');
  assert.equal(second.path, 'Diagrams/Net - API Gateway 2.md');
  await app.metadataCache.settled();
  assert.equal(strata.forShape(diagram.path, 'shape-1', 'tab-1').length, 2);
  assert.equal(strata.forShape(diagram.path, 'shape-1', 'tab-2').length, 0);

  await detachNote(app as never, second as never);
  await app.metadataCache.settled();
  assert.equal(strata.forShape(diagram.path, 'shape-1').length, 1);
  assert.equal(app.vault.text(second.path), '');
});

test('attaching an existing note keeps what it says', async () => {
  const app = await setup();
  const diagram = app.vault.getFileByPath('Diagrams/Net.vellum.md')!;
  const note = await app.vault.create('Diagrams/Runbook.md', '---\naliases: [RB]\n---\nRestart the gateway.\n');
  await attachNote(app as never, note as never, diagram as never, { shapeId: 'gw', tabId: 'tab-1' });
  const text = app.vault.text(note.path)!;
  assert.match(text, /aliases:/);
  assert.match(text, /vellum-shape: gw/);
  assert.match(text, /Restart the gateway\./);
});

test('a renamed diagram keeps its strata', async () => {
  const app = await setup();
  const diagram = app.vault.getFileByPath('Diagrams/Net.vellum.md')!;
  const strata = new StrataIndex(app as never);
  app.metadataCache.on('changed', (file: never) => strata.update(file));
  const note = await createStratum(app as never, diagram as never, { shapeId: 's', tabId: 't', label: 'S' }, '{{shape}}');
  await app.metadataCache.settled();
  strata.build();
  await app.fileManager.renameFile(diagram, 'Diagrams/Network.vellum.md');
  strata.rename(diagram as never, 'Diagrams/Net.vellum.md');
  // Without Obsidian's link updater the note still names the old file.
  assert.equal(strata.forDiagram('Diagrams/Network.vellum.md').length, 0);
  await retargetStratum(app as never, note as never, diagram as never);
  await app.metadataCache.settled();
  assert.equal(strata.forDiagram('Diagrams/Network.vellum.md').length, 1);
});

test('stratum names are safe file names', () => {
  const diagram = { basename: 'Net.vellum' } as never;
  assert.equal(stratumNoteName('{{diagram}} - {{shape}}', diagram, 'a/b: c?'), 'Net - a b c');
  assert.equal(stratumNoteName('{{shape}}', diagram, ''), 'Shape');
});

test('diagram files: detection, names, creation and conversion', async () => {
  const app = new App();
  const md = await app.vault.create('A.vellum.md', 'not indexed yet');
  assert.ok(isMarkdownDiagram(app as never, md as never));
  const plain = await app.vault.create('B.md', '---\nvellum-plugin: parsed\n---\n');
  await app.metadataCache.settled();
  assert.ok(isMarkdownDiagram(app as never, plain as never));
  assert.equal(diagramName({ basename: 'Net.vellum' } as never), 'Net');
  assert.equal(yamlToWorkspace(emptyWorkspaceYaml('Net')).tabs.length, 1);

  const settings = { ...DEFAULT_SETTINGS, folder: 'Diagrams' };
  const created = await createDiagram(app as never, settings, { name: 'Flow' });
  assert.equal(created.path, 'Diagrams/Flow.vellum.md');
  const parsed = parseMarkdownDiagram(app.vault.text(created.path)!);
  assert.equal(yamlToWorkspace(parsed.yaml!).tabs[0].diagram.meta.title, 'Flow');

  const template = await createDiagram(app as never, { ...settings, format: 'vellum' }, { name: 'Template', yaml: emptyWorkspaceYaml('From template') });
  const fromTemplate = await createDiagram(app as never, { ...settings, format: 'vellum', template: template.path }, { name: 'Copy' });
  assert.match(app.vault.text(fromTemplate.path)!, /From template/);

  await app.vault.modify(created as never, app.vault.text(created.path)!.replace('---\n\n', '---\nNotes about the flow.\n\n'));
  const { file, notes } = await convertDiagram(app as never, created as never, 'vellum', false);
  assert.equal(file.path, 'Diagrams/Flow.vellum');
  assert.equal(notes?.path, 'Diagrams/Flow notes.md');
  assert.equal(app.vault.text('Diagrams/Flow notes.md'), 'Notes about the flow.\n');
  assert.equal(yamlToWorkspace(app.vault.text(file.path)!).tabs.length, 1);
  const back = await convertDiagram(app as never, file as never, 'markdown', false);
  assert.equal(back.file.path, 'Diagrams/Flow.vellum.md');
  assert.notEqual(parseMarkdownDiagram(app.vault.text(back.file.path)!).yaml, null);
});

test('settings from disk are checked value by value', () => {
  const s = sanitizeSettings({ format: 'pdf', exportScale: 99, strataHoverDelay: -5, folder: 7, defaultMode: 'read', extra: true });
  assert.equal(s.format, 'markdown');
  assert.equal(s.exportScale, 4);
  assert.equal(s.strataHoverDelay, 0);
  assert.equal(s.folder, '');
  assert.equal(s.defaultMode, 'read');
  assert.ok(!('extra' in s));
});

test('hover excerpts by kind', () => {
  assert.equal(excerptOf('note', '---\na: 1\n---\n# Title\n\nSee [[Folder/Page|the page]] and **bold**.').text, 'Title See the page and bold.');
  assert.equal(excerptOf('note', '').text, 'Empty stratum.');
  assert.equal(excerptOf('note', '# API Gateway\n\nTerminates TLS.', 'API Gateway').text, 'Terminates TLS.');
  assert.equal(excerptOf('note', '# Overview\n\nTerminates TLS.', 'API Gateway').text, 'Overview Terminates TLS.');
  const code = excerptOf('code', 'Intro\n```sh\nline 1\n\nline 2\n```');
  assert.equal(code.text, 'line 1\nline 2');
  assert.ok(code.mono);
  assert.equal(excerptOf('image', '![[shot.png|200]]').image, 'shot.png');
  assert.equal(excerptOf('embed', 'https://example.com/x').text, 'Embed: https://example.com/x');
  assert.ok(excerptOf('note', 'x'.repeat(400)).text.endsWith('…'));
});

// ── The view against a fake frame ───────────────────────────────────────

function fakeFrame(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  let yaml = '';
  const frame = {
    calls,
    nextYaml: null as string | null,
    load(text: string, options: unknown) {
      calls.push({ name: 'load', args: [text, options] });
      yaml = text;
      return null;
    },
    snapshot() {
      return { yaml: frame.nextYaml ?? yaml, text: [{ block: 'a', shapeId: 'a', tabId: 't', text: 'Alpha' }], links: [], extra: [], token: 7 };
    },
    markSaved(token: number) { calls.push({ name: 'markSaved', args: [token] }); },
    reconcile(sections: unknown) { calls.push({ name: 'reconcile', args: [sections] }); return false; },
    setMode(mode: string) { calls.push({ name: 'setMode', args: [mode] }); },
    setTheme() {},
    setStrata() {},
    ...overrides,
  };
  return frame;
}

/** TextFileView's loader exists in the stand-in, not in Obsidian's typings. */
function openIn(view: unknown, file: unknown) {
  return (view as { loadFile(file: unknown): Promise<void> }).loadFile(file);
}

function makeView(app: AppT) {
  const plugin = {
    app,
    settings: DEFAULT_SETTINGS,
    ready: Promise.resolve(),
    strata: { forDiagram: () => [], on: () => ({}) },
    hover: { hide() {} },
    exporter: { afterSave: async () => {} },
    themeName: () => 'light',
  };
  const leaf = new WorkspaceLeaf() as unknown as { app: AppT };
  leaf.app = app;
  const view = new VellumView(leaf as never, plugin as never);
  view.load();
  return view;
}

const YAML_A = emptyWorkspaceYaml('A');

test('the view loads a Markdown diagram and saves notes, index and source together', async () => {
  const app = new App();
  const file = await app.vault.create('Net.vellum.md', `---\nvellum-plugin: parsed\nvellum-mode: read\n---\nNotes stay.\n\n# Vellum Data\n\n%%\n## Diagram\n\`\`\`vellum\n${YAML_A}\`\`\`\n%%\n`);
  const view = makeView(app);
  await openIn(view, file);
  const frame = fakeFrame();
  view.frameReady(frame as never);
  assert.equal(view.mode, 'read');
  const [load] = frame.calls.filter((c) => c.name === 'load');
  assert.equal((load.args[0] as string).trimEnd(), YAML_A.trimEnd());
  assert.equal((load.args[1] as { fileName: string }).fileName, 'Net.vellum.md');

  frame.nextYaml = YAML_A.replace('title: "A"', 'title: "Renamed"');
  await view.save();
  const text = app.vault.text('Net.vellum.md')!;
  assert.match(text, /Notes stay\./);
  assert.match(text, /- Alpha \^a/);
  assert.match(text, /title: "Renamed"/);
  assert.deepEqual(frame.calls.filter((c) => c.name === 'markSaved').map((c) => c.args[0]), [7]);
});

test('a file that fails to load is never overwritten', async () => {
  const app = new App();
  const original = 'version: workspace-1.0\ntabs: [broken';
  const file = await app.vault.create('Bad.vellum', original);
  const view = makeView(app);
  await openIn(view, file);
  const frame = fakeFrame({ load: () => 'YAML error' });
  view.frameReady(frame as never);
  frame.nextYaml = YAML_A;
  await view.save();
  assert.equal(app.vault.text('Bad.vellum'), original);
});

test('an outside edit to the notes alone does not reload the diagram', async () => {
  const app = new App();
  const file = await app.vault.create('Net.vellum.md', `---\nvellum-plugin: parsed\n---\n\n# Vellum Data\n\n%%\n## Diagram\n\`\`\`vellum\n${YAML_A}\`\`\`\n%%\n`);
  const view = makeView(app);
  await openIn(view, file);
  const frame = fakeFrame();
  view.frameReady(frame as never);
  await app.vault.modify(file, app.vault.text(file.path)!.replace('---\n\n#', '---\nA new note line.\n\n#'));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(frame.calls.filter((c) => c.name === 'load').length, 1);
  assert.equal(frame.calls.filter((c) => c.name === 'reconcile').length, 1);
  await view.save();
  assert.match(app.vault.text(file.path)!, /A new note line\./);
});

test('edits survive the frame reloading when its tab moves', async () => {
  const app = new App();
  const file = await app.vault.create('Net.vellum', YAML_A);
  const view = makeView(app);
  await openIn(view, file);
  view.frameReady(fakeFrame() as never);
  const edited = YAML_A.replace('title: "A"', 'title: "Unsaved"');
  view.frameUnloading({ yaml: edited, text: [], links: [], extra: [], token: 3 });
  const reborn = fakeFrame();
  view.frameReady(reborn as never);
  const [load] = reborn.calls.filter((c) => c.name === 'load');
  assert.equal(load.args[0], edited);
  assert.equal((load.args[1] as { dirty: boolean }).dirty, true);
});

test('an outside change while edits are unsaved loads the disk version, never a text merge', async () => {
  const app = new App();
  const file = await app.vault.create('Net.vellum', YAML_A);
  const view = makeView(app);
  await openIn(view, file);
  const frame = fakeFrame();
  view.frameReady(frame as never);
  frame.nextYaml = YAML_A.replace('title: "A"', 'title: "Mine"');
  view.requestSave();
  const theirs = YAML_A.replace('title: "A"', 'title: "Theirs"');
  await app.vault.modify(file as never, theirs);
  await new Promise((r) => setTimeout(r, 10));
  const loads = frame.calls.filter((c) => c.name === 'load');
  assert.equal(loads.length, 2);
  assert.equal(loads[1].args[0], theirs);
  assert.equal((loads[1].args[1] as { keepHistory: boolean }).keepHistory, true);
});
