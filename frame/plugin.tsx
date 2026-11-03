// What the frame contributes to core's editor through its plugin slots:
// stratum and link entries on the shape context menu, vault inserts on the
// canvas menu, toolbar buttons, menu items and the strata dock.

import { useEditor } from '@/store/editor';
import { DiagramTabsBar } from '@/editor/chrome/DiagramTabsBar';
import type { PluginContextMenuEntry, VellumPlugin } from '@/plugins/types';
import type { ContextMenuTarget } from '@/editor/chrome/ContextMenu';
import type { Shape } from '@/store/types';
import { host } from './boot';
import { FrameIcon } from './icons';
import { StrataPanel } from './StrataPanel';
import { useFrame } from './state';
import { ToolbarButton } from './ui';
import { linkOf } from './targets';
import { shapeLink } from './workspace';
import { setShapeLink, worldAt } from './edit';

const ID = 'vellum-obsidian';

/** The text a reader sees on a shape. Basic shapes show `body`. */
export function shapeLabel(shape: Shape | undefined): string {
  return (shape?.label || shape?.body || shape?.sublabel || '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
}

function shapeMenu(target: ContextMenuTarget): PluginContextMenuEntry[] {
  if (target.kind !== 'shape') return [];
  const state = useEditor.getState();
  const shape = state.diagram.shapes.find((s) => s.id === target.id);
  if (!shape) return [];
  const tabId = state.activeTabId;
  const label = shapeLabel(shape);
  const strata = useFrame.getState().strata.filter((s) => s.shapeId === shape.id && (!s.tabId || s.tabId === tabId));
  const create = () => host.stratum({ type: 'create', shapeId: shape.id, tabId, label });
  const entries: PluginContextMenuEntry[] = [];

  if (strata.length === 0) {
    entries.push({ id: `${ID}:add-stratum`, label: 'Add stratum…', onClick: create });
  } else if (strata.length === 1) {
    entries.push({ id: `${ID}:edit-stratum`, label: 'Edit stratum…', onClick: () => host.stratum({ type: 'edit', path: strata[0].path }) });
  } else {
    strata.forEach((stratum, i) => entries.push({
      id: `${ID}:edit-stratum-${i}`,
      label: `Edit stratum: ${stratum.title}`,
      onClick: () => host.stratum({ type: 'edit', path: stratum.path }),
    }));
  }
  if (strata.length) entries.push({ id: `${ID}:add-another`, label: 'Add another stratum…', onClick: create });
  entries.push({
    id: `${ID}:attach-note`,
    label: 'Attach existing note…',
    onClick: () => host.stratum({ type: 'link-existing', shapeId: shape.id, tabId, label }),
  });
  if (strata.length === 1) {
    entries.push({ id: `${ID}:detach-stratum`, label: 'Detach stratum', onClick: () => host.stratum({ type: 'unlink', path: strata[0].path }) });
  }

  entries.push({ type: 'separator', id: `${ID}:links` });
  const explicit = shapeLink(shape);
  const link = linkOf(shape);
  entries.push({
    id: `${ID}:edit-link`,
    label: explicit ? 'Edit link…' : 'Add link…',
    onClick: () => host.link({ type: 'edit', shapeId: shape.id, current: explicit }),
  });
  if (link) entries.push({ id: `${ID}:open-link`, label: 'Open link', onClick: () => host.link({ type: 'open', link, newLeaf: false }) });
  if (explicit) entries.push({ id: `${ID}:remove-link`, label: 'Remove link', onClick: () => setShapeLink(shape.id, null) });
  entries.push({ id: `${ID}:copy-shape-link`, label: 'Copy link to shape', onClick: () => host.link({ type: 'copy-shape-link', shapeId: shape.id, tabId }) });
  return entries;
}

let lastCanvasMenuPoint: { x: number; y: number } | null = null;
window.addEventListener('contextmenu', (e) => {
  lastCanvasMenuPoint = { x: e.clientX, y: e.clientY };
}, true);

function canvasMenu(): PluginContextMenuEntry[] {
  const at = lastCanvasMenuPoint ? worldAt(lastCanvasMenuPoint.x, lastCanvasMenuPoint.y) : null;
  return [
    { id: `${ID}:insert-image`, label: 'Insert image from vault…', onClick: () => host.insert('image', at) },
    { id: `${ID}:insert-note-link`, label: 'Insert link to a note…', onClick: () => host.insert('note-link', at) },
    { id: `${ID}:insert-diagram`, label: 'Insert diagram from vault…', onClick: () => host.insert('diagram', at) },
  ];
}

function EditToolbar() {
  const rightDockOpen = useEditor((s) => s.rightDockOpen);
  const setRightDockOpen = useEditor((s) => s.setRightDockOpen);
  const count = useFrame((s) => s.strata.length);
  return (
    <>
      <ToolbarButton title="Read-only mode" onClick={() => host.setMode('read')}>
        <FrameIcon.read />
      </ToolbarButton>
      <ToolbarButton title={count ? `Strata (${count})` : 'Strata'} active={rightDockOpen} onClick={() => setRightDockOpen(!rightDockOpen)}>
        <FrameIcon.strata />
      </ToolbarButton>
    </>
  );
}

export const obsidianPlugin: VellumPlugin = {
  id: ID,
  contextMenuItems: { shape: shapeMenu, canvas: canvasMenu },
  toolbarButtons: () => <EditToolbar />,
  menuItems: [
    { id: `${ID}:read-mode`, label: 'Read-only mode', onClick: () => host.setMode('read') },
    { id: `${ID}:pulse`, label: 'Show clickable shapes', onClick: () => useFrame.setState((s) => ({ pulseTick: s.pulseTick + 1 })) },
    { type: 'separator', id: `${ID}:insert` },
    { id: `${ID}:menu-insert-image`, label: 'Insert image from vault…', onClick: () => host.insert('image', null) },
    { id: `${ID}:menu-insert-note-link`, label: 'Insert link to a note…', onClick: () => host.insert('note-link', null) },
    { id: `${ID}:menu-insert-diagram`, label: 'Insert diagram from vault…', onClick: () => host.insert('diagram', null) },
  ],
  rightDock: () => <StrataPanel onClose={() => useEditor.getState().setRightDockOpen(false)} />,
  diagramTabs: <DiagramTabsBar />,
};
