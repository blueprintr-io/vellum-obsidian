import assert from 'node:assert/strict';
import test from 'node:test';
import { composeMarkdownDiagram, escapeEntry, hasDiagramFrontmatter, parseMarkdownDiagram } from '../../src/format';

const yaml = 'version: workspace-1.0\nactiveTabId: tab-1\ntabs:\n  - id: tab-1\n    diagram:\n      version: "1.0"\n';

const snapshot = {
  yaml,
  text: [
    { block: 'shape-1', shapeId: 'shape-1', tabId: 'tab-1', text: 'API Gateway' },
    { block: 'docs', shapeId: 'docs', tabId: 'tab-1', text: 'See [[Runbook]] for failover' },
  ],
  links: [{ block: 'docs', shapeId: 'docs', tabId: 'tab-1', link: '[[Runbook#Restore]]' }],
  extra: ['reads', 'reads'],
};

test('a composed file reads back to the same source, notes and index', () => {
  const text = composeMarkdownDiagram({ frontmatter: 'tags: [infra]', body: 'Written beside the diagram.\n' }, snapshot, { compress: false });
  const parsed = parseMarkdownDiagram(text);
  assert.equal(parsed.yaml, yaml.trimEnd());
  assert.equal(parsed.compressed, false);
  assert.equal(parsed.frontmatter, 'vellum-plugin: parsed\ntags: [infra]');
  assert.equal(parsed.body.trim(), 'Written beside the diagram.');
  assert.deepEqual(parsed.sections.text, { 'shape-1': 'API Gateway', docs: 'See [[Runbook]] for failover' });
  assert.deepEqual(parsed.sections.links, { docs: '[[Runbook#Restore]]' });
  assert.ok(hasDiagramFrontmatter(text));
});

test('composing is stable: a second pass over its own output changes nothing', () => {
  const first = composeMarkdownDiagram({ frontmatter: null, body: '' }, snapshot, { compress: false });
  const parsed = parseMarkdownDiagram(first);
  const second = composeMarkdownDiagram(parsed, snapshot, { compress: false });
  assert.equal(second, first);
});

test('compressed source round-trips', () => {
  const big = yaml + '      shapes:\n' + Array.from({ length: 200 }, (_, i) => `        - id: s${i}\n          kind: rect\n`).join('');
  const text = composeMarkdownDiagram({ frontmatter: null, body: '' }, { ...snapshot, yaml: big }, { compress: true });
  assert.ok(!text.includes('kind: rect'));
  const parsed = parseMarkdownDiagram(text);
  assert.equal(parsed.compressed, true);
  assert.equal(parsed.yaml, big);
});

test('the source fence outgrows backtick runs inside the YAML', () => {
  const tricky = 'label: "```not a fence```"\nbody: |\n  ````\n';
  const text = composeMarkdownDiagram({ frontmatter: null, body: '' }, { ...snapshot, yaml: tricky }, { compress: false });
  assert.match(text, /^`{5}vellum$/m);
  assert.equal(parseMarkdownDiagram(text).yaml, tricky.trimEnd());
});

test('a data heading inside the notes\' code block is not the data section', () => {
  const body = 'Example:\n\n```md\n# Vellum Data\n```\n';
  const text = composeMarkdownDiagram({ frontmatter: null, body }, snapshot, { compress: false });
  const parsed = parseMarkdownDiagram(text);
  assert.ok(parsed.body.includes('```md\n# Vellum Data\n```'));
  assert.equal(parsed.yaml, yaml.trimEnd());
});

test('a note without a diagram reads as notes only', () => {
  const parsed = parseMarkdownDiagram('---\nvellum-plugin: parsed\n---\nJust notes.\n');
  assert.equal(parsed.yaml, null);
  assert.equal(parsed.body, 'Just notes.\n');
});

test('index lines cannot become other Markdown blocks', () => {
  assert.equal(escapeEntry('# Heading'), '\\# Heading');
  assert.equal(escapeEntry('> quote'), '\\> quote');
  assert.equal(escapeEntry('- item'), '\\- item');
  assert.equal(escapeEntry('1. first'), '\\1. first');
  assert.equal(escapeEntry('[ ] task'), '\\[ ] task');
  assert.equal(escapeEntry('a %% b'), 'a %\\% b');
  assert.equal(escapeEntry('<b>bold</b>'), '\\<b>bold\\</b>');
  // Links and tags inside a line stay as they are.
  assert.equal(escapeEntry('see [[Note]] #tag'), 'see [[Note]] #tag');
  assert.equal(escapeEntry('two\nlines'), 'two lines');
});

test('frontmatter keeps user properties and gains the diagram key once', () => {
  const text = composeMarkdownDiagram({ frontmatter: 'vellum-plugin: parsed\naliases: [Net]', body: '' }, snapshot, { compress: false });
  assert.equal(text.match(/vellum-plugin:/g)!.length, 1);
  assert.match(text, /^---\nvellum-plugin: parsed\naliases: \[Net\]\n---\n/);
});

test('Windows line endings and a byte order mark are read', () => {
  const text = composeMarkdownDiagram({ frontmatter: null, body: 'Notes' }, snapshot, { compress: false });
  const parsed = parseMarkdownDiagram(`\uFEFF${text.replace(/\n/g, '\r\n')}`);
  assert.equal(parsed.yaml, yaml.trimEnd());
  assert.deepEqual(Object.keys(parsed.sections.text), ['shape-1', 'docs']);
});
