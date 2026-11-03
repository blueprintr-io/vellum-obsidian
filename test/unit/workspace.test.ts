import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspacePayload } from '@/store/schema';
import type { DiagramState, Shape } from '@/store/types';
import { blockIds, blockKey, findBlock, indexWorkspace, reconcileLinks, rewriteWorkspaceLinks } from '../../frame/workspace';
import { buildTargets } from '../../frame/targets';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({ id, kind: 'rect', x: 0, y: 0, w: 100, h: 50, layer: 'blueprint', ...extra });
const diagram = (shapes: Shape[], extra: Partial<DiagramState> = {}): DiagramState => ({ version: '1.0', meta: {}, shapes, connectors: [], annotations: [], ...extra });

const workspace: WorkspacePayload = {
  activeTabId: 'a',
  tabs: [
    {
      id: 'a',
      diagram: diagram([
        shape('shape-1', { label: '**API** Gateway' }),
        shape('cell table', { kind: 'table', cells: [[{ text: 'Owner' }, { text: 'See [[Team page]]' }]] }),
        shape('linked', { label: 'Docs: [[Runbook|runbook]] and [[Old]]', meta: { link: '[[Old]]' } }),
      ], { meta: { title: 'First' }, connectors: [{ id: 'c', from: { shape: 'shape-1', anchor: 'right' }, to: { shape: 'linked', anchor: 'left' }, routing: 'straight', label: 'calls' }] }),
    },
    { id: 'b', diagram: diagram([shape('shape-1', { label: 'Copy' })], { meta: { title: 'Second' } }) },
  ],
};

test('block ids are valid and unique across tabs', () => {
  const ids = blockIds(workspace);
  assert.equal(ids.get(blockKey('a', 'shape-1')), 'shape-1');
  assert.equal(ids.get(blockKey('a', 'cell table')), 'cell-table');
  assert.equal(ids.get(blockKey('b', 'shape-1')), 'shape-1-2');
  for (const id of ids.values()) assert.match(id, /^[A-Za-z0-9-]+$/);
});

test('the index holds plain text per shape, explicit links, and the rest', () => {
  const index = indexWorkspace(workspace);
  assert.deepEqual(index.text.map((t) => [t.block, t.text]), [
    ['shape-1', 'API Gateway'],
    ['cell-table', 'Owner · See [[Team page]]'],
    ['linked', 'Docs: [[Runbook|runbook]] and [[Old]]'],
    ['shape-1-2', 'Copy'],
  ]);
  assert.deepEqual(index.links.map((l) => [l.block, l.link]), [['linked', '[[Old]]']]);
  assert.deepEqual(index.extra, ['First', 'calls', 'Second']);
});

test('reconciliation takes renamed links from the index sections', () => {
  const sections = {
    text: { linked: 'Docs: [[Runbook|runbook]] and [[New name]]', 'cell-table': 'Owner · See [[Team wiki]]' },
    links: { linked: '[[New name]]' },
  };
  const { workspace: next, changed } = reconcileLinks(workspace, sections);
  assert.ok(changed);
  const linked = next.tabs[0].diagram.shapes.find((s) => s.id === 'linked')!;
  assert.equal(linked.label, 'Docs: [[Runbook|runbook]] and [[New name]]');
  assert.equal(linked.meta?.link, '[[New name]]');
  const table = next.tabs[0].diagram.shapes.find((s) => s.id === 'cell table')!;
  assert.equal(table.cells?.[0][1]?.text, 'See [[Team wiki]]');
  // Untouched tabs keep their identity.
  assert.equal(next.tabs[1], workspace.tabs[1]);
});

test('reconciliation ignores entries whose links no longer line up', () => {
  const sections = { text: { linked: 'Docs: [[Only one]]' }, links: {} };
  const { changed } = reconcileLinks(workspace, sections);
  assert.equal(changed, false);
});

test('renames rewrite text, link properties and connector labels', () => {
  const { workspace: next, changed } = rewriteWorkspaceLinks(workspace, { old: 'Archive/Old' });
  assert.ok(changed);
  const linked = next.tabs[0].diagram.shapes.find((s) => s.id === 'linked')!;
  assert.equal(linked.label, 'Docs: [[Runbook|runbook]] and [[Archive/Old]]');
  assert.equal(linked.meta?.link, '[[Archive/Old]]');
  assert.equal(rewriteWorkspaceLinks(workspace, { missing: 'x' }).changed, false);
});

test('finds shapes by block id or shape id', () => {
  assert.deepEqual(findBlock(workspace, '^shape-1-2'), { tabId: 'b', shapeId: 'shape-1' });
  assert.deepEqual(findBlock(workspace, 'cell table'), { tabId: 'a', shapeId: 'cell table' });
  assert.equal(findBlock(workspace, 'nope'), null);
});

test('click targets resolve children to linked groups, containers and rack owners', () => {
  const d = diagram([
    shape('group', { kind: 'group' }),
    shape('member-a', { parent: 'group' }),
    shape('member-b', { parent: 'group' }),
    shape('box', { kind: 'container' }),
    shape('inside', { parent: 'box' }),
    shape('busy', { kind: 'container' }),
    shape('child-linked', { parent: 'busy', meta: { link: '[[X]]' } }),
    shape('child-plain', { parent: 'busy' }),
    shape('unit', { rackUnit: { u: 1 } as never }),
    shape('port', { parent: 'unit', rackPort: { group: 'eth', n: 1 } as never }),
  ]);
  const strata = [
    { path: 'g.md', title: 'G', kind: 'note' as const, shapeId: 'group' },
    { path: 'b.md', title: 'B', kind: 'note' as const, shapeId: 'box' },
    { path: 'u.md', title: 'U', kind: 'note' as const, shapeId: 'unit' },
    { path: 'busy.md', title: 'Busy', kind: 'note' as const, shapeId: 'busy' },
  ];
  const index = buildTargets(d, strata, 'a');
  assert.equal(index.resolve('member-a')?.shapeId, 'group');
  assert.deepEqual(index.members('group').sort(), ['member-a', 'member-b']);
  assert.equal(index.resolve('inside')?.shapeId, 'box');
  // A container with a linked child of its own keeps its other children inert.
  assert.equal(index.resolve('child-plain'), null);
  assert.equal(index.resolve('child-linked')?.shapeId, 'child-linked');
  assert.equal(index.resolve('port')?.shapeId, 'unit');
  // Strata on another tab do not apply.
  assert.equal(buildTargets(d, [{ ...strata[0], tabId: 'other' }], 'a').targets.has('group'), false);
});
