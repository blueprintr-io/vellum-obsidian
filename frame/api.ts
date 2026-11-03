// The frame's side of the protocol: what the plugin can ask the editor to do.

import { useEditor, type EditorState } from '@/store/editor';
import { parseClipboardEnvelope, type WorkspacePayload } from '@/store/schema';
import { workspaceToYaml, yamlToWorkspace } from '@/store/persist';
import { anyTabDirty, workspaceFromState } from '@/store/workspace-session';
import { buildSvgExport, rasterizeCanvas, type ImageExportOptions } from '@/editor/files';
import type { Shape } from '@/store/types';
import type { DiagramSnapshot, ExportRequest, ExportResult, FrameApi, Hotspot, ViewMode } from '../shared/protocol';
import { boot, host } from './boot';
import { bindFileHandle, restoreFileHandle } from './files';
import { dropFile, insertLinkShape, setShapeLink, worldAt } from './edit';
import { revealShape } from './reveal';
import { shapeLabel } from './plugin';
import { useFrame } from './state';
import { buildTargets } from './targets';
import { blockIds, blockKey, findBlock, indexWorkspace, reconcileLinks, rewriteWorkspaceLinks } from './workspace';

type Receipt = { workspaceId: string; revision: number; workspace: WorkspacePayload };

const MAX_RECEIPTS = 32;
let boundWorkspaceId: string | null = null;
let fileName = boot.fileName;
let loading = false;
let nextToken = 1;
const receipts = new Map<number, Receipt>();
let cached: { key: unknown[]; snapshot: DiagramSnapshot } | null = null;

function snapshotKey(s: EditorState): unknown[] {
  return [s.workspaceId, s.diagram, s.diagramTabs, s.tabSnapshots, s.activeTabId, s.exportReturnTabId];
}

function markAllSaved() {
  const s = useEditor.getState();
  s.markSaved({ workspaceId: s.workspaceId, revision: s.workspaceRevision, workspace: workspaceFromState(s) });
}

function snapshotOf(workspace: WorkspacePayload, token: number): DiagramSnapshot {
  const index = indexWorkspace(workspace);
  return { yaml: workspaceToYaml(workspace), ...index, token };
}

const tick = () => new Promise<void>((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(0);
});

/** Wait until React has committed the store's current diagram. */
async function rendered() {
  for (let i = 0; i < 40; i++) {
    await tick();
    const shapes = useEditor.getState().diagram.shapes;
    const canvas = document.querySelector('svg[data-vellum-canvas]');
    if (canvas && (shapes.length === 0 || canvas.querySelector('[data-shape-id]'))) break;
  }
  await tick();
  await document.fonts?.ready;
}

function rotatedBox(shape: Shape) {
  const angle = ((shape.rotation ?? 0) * Math.PI) / 180;
  if (!angle) return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = shape.w * cos + shape.h * sin;
  const h = shape.w * sin + shape.h * cos;
  return { x: shape.x + shape.w / 2 - w / 2, y: shape.y + shape.h / 2 - h / 2, w, h };
}

/** Clickable areas of an export, as fractions of its world-unit viewBox. */
function hotspots(svgText: string): Hotspot[] {
  const match = /viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([\d.e]+)[ ,]+([\d.e]+)"/.exec(svgText.slice(0, 2000));
  if (!match) return [];
  const [vx, vy, vw, vh] = match.slice(1).map(Number);
  if (!vw || !vh) return [];
  const s = useEditor.getState();
  const index = buildTargets(s.diagram, useFrame.getState().strata, s.activeTabId);
  const byId = new Map(s.diagram.shapes.map((shape) => [shape.id, shape]));
  const out: Hotspot[] = [];
  for (const [id, target] of index.targets) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const member of index.members(id)) {
      const shape = byId.get(member);
      if (!shape) continue;
      const box = rotatedBox(shape);
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.w);
      bottom = Math.max(bottom, box.y + box.h);
    }
    if (!Number.isFinite(left)) continue;
    const x = Math.max(0, (left - vx) / vw);
    const y = Math.max(0, (top - vy) / vh);
    const r = Math.min(1, (right - vx) / vw);
    const b = Math.min(1, (bottom - vy) / vh);
    if (r > x && b > y) out.push({ shapeId: id, link: target.link, x, y, width: r - x, height: b - y });
  }
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

/** Shapes a crop to `shapeIds` should keep: those shapes and everything
 *  nested inside them. */
function withDescendants(ids: string[]): Set<string> {
  const shapes = useEditor.getState().diagram.shapes;
  const keep = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const shape of shapes) {
      if (shape.parent && keep.has(shape.parent) && !keep.has(shape.id)) {
        keep.add(shape.id);
        grew = true;
      }
    }
  }
  return keep;
}

async function exportImage(request: ExportRequest): Promise<ExportResult> {
  const store = useEditor.getState();
  if (request.shape) {
    const found = findBlock(workspaceFromState(store), request.shape);
    if (!found) throw new Error(`${request.shape.replace(/^\^/, '')} is not in this diagram.`);
    if (found.tabId !== store.activeTabId) store.switchDiagramTab(found.tabId);
    request = { ...request, shapeIds: [found.shapeId], tab: undefined };
  } else if (request.tab) {
    const wanted = request.tab.toLowerCase();
    const tab = store.diagramTabs.find((t, i) => {
      const diagram = t.id === store.activeTabId ? store.diagram : store.tabSnapshots[t.id]?.diagram;
      return t.id === request.tab || diagram?.meta.title?.toLowerCase() === wanted || `tab ${i + 1}` === wanted;
    });
    if (tab && tab.id !== store.activeTabId) store.switchDiagramTab(tab.id);
  }
  await rendered();
  const options: ImageExportOptions = {
    theme: request.theme,
    background: request.background === undefined ? 'paper' : request.background,
    scale: request.scale ?? 2,
    padding: request.padding ?? 16,
    embedFonts: request.embedFonts ?? true,
    embedSource: false,
    ...(request.shapeIds?.length ? { area: 'selection' as const, ids: withDescendants(request.shapeIds) } : { area: 'diagram' as const }),
  };
  if (request.format === 'svg') {
    const result = await buildSvgExport(options);
    if (!result) throw new Error('The diagram is empty.');
    return { format: 'svg', data: result.text, width: result.width, height: result.height, hotspots: hotspots(result.text) };
  }
  const raster = await rasterizeCanvas({ format: 'png', allTabs: false, ...options });
  if (!raster) throw new Error('The diagram is empty.');
  return {
    format: 'png',
    data: await blobToDataUrl(raster.blob),
    width: raster.width,
    height: raster.height,
    hotspots: hotspots(await raster.svgBlob.text()),
  };
}

/** Fit the diagram in view without enlarging a small one past 100%. */
function fitView() {
  const rect = document.querySelector('svg[data-vellum-canvas]')?.getBoundingClientRect();
  const width = rect?.width || window.innerWidth;
  const height = rect?.height || window.innerHeight;
  const store = useEditor.getState();
  store.fitToContent(width, height);
  const { zoom, pan } = useEditor.getState();
  if (zoom <= 1) return;
  // Keep the centre fitToContent chose, at 100%.
  const centre = { x: (width / 2 - pan.x) / zoom, y: (height / 2 - pan.y) / zoom };
  store.setZoom(1);
  store.setPan({ x: width / 2 - centre.x, y: height / 2 - centre.y });
}

function setMode(mode: ViewMode) {
  if (useFrame.getState().mode === mode) return;
  // Commit an open text editor before its component unmounts.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const store = useEditor.getState();
  store.setSelected([]);
  store.closeAllOverlays();
  store.setReadOnly(mode === 'read');
  useFrame.setState({ mode, activeShapeId: null });
}

export const frameApi: FrameApi = {
  load(yaml, options) {
    if (options.fileName) fileName = options.fileName;
    let workspace: WorkspacePayload;
    try {
      workspace = yamlToWorkspace(yaml);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    let reconciled = false;
    if (options.sections) ({ workspace, changed: reconciled } = reconcileLinks(workspace, options.sections));
    const store = useEditor.getState();
    loading = true;
    try {
      if (options.keepHistory && boundWorkspaceId && store.workspaceId === boundWorkspaceId) {
        store.applyWorkspace({ ...workspace, activeTabId: workspace.tabs.some((t) => t.id === store.activeTabId) ? store.activeTabId : workspace.activeTabId });
      } else {
        store.loadWorkspace(workspace, fileName);
        boundWorkspaceId = useEditor.getState().workspaceId;
      }
    } finally {
      loading = false;
    }
    bindFileHandle(fileName);
    if (reconciled || options.dirty) {
      useEditor.getState().setDirty(true);
      host.changed();
    } else {
      markAllSaved();
    }
    if (options.fit) fitView();
    return null;
  },

  snapshot() {
    const s = useEditor.getState();
    if (!boundWorkspaceId || s.workspaceId !== boundWorkspaceId) return null;
    const key = snapshotKey(s);
    if (cached && key.every((part, i) => part === cached!.key[i])) return cached.snapshot;
    const workspace = workspaceFromState(s);
    const token = nextToken++;
    receipts.set(token, { workspaceId: s.workspaceId, revision: s.workspaceRevision, workspace });
    if (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value!);
    cached = { key, snapshot: snapshotOf(workspace, token) };
    return cached.snapshot;
  },

  markSaved(token) {
    const receipt = receipts.get(token);
    if (receipt) useEditor.getState().markSaved(receipt);
  },

  isDirty: () => anyTabDirty(),
  setMode,
  setTheme: (theme) => {
    if (useEditor.getState().theme !== theme) useEditor.getState().setTheme(theme);
  },
  setStrata: (strata) => useFrame.setState({ strata: strata.map((s) => ({ ...s })) }),
  setPreferences(preferences) {
    const current = useEditor.getState() as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(preferences)) {
      if (key in current && JSON.stringify(current[key]) !== JSON.stringify(value)) patch[key] = value;
    }
    if (Object.keys(patch).length) useEditor.setState(patch as Partial<EditorState>);
  },
  setLibrary(library) {
    try {
      const entries = library.map((entry) => ({ ...(entry as object), ...parseClipboardEnvelope(entry) }));
      useEditor.setState({ personalLibrary: entries as EditorState['personalLibrary'] });
    } catch (error) {
      console.error('[vellum] ignored an invalid personal library', error);
    }
  },
  setShapeLink,

  rewriteLinks(renames) {
    const s = useEditor.getState();
    if (!boundWorkspaceId || s.workspaceId !== boundWorkspaceId) return false;
    const { workspace, changed } = rewriteWorkspaceLinks(workspaceFromState(s), renames);
    if (!changed) return false;
    s.applyWorkspace({ ...workspace, activeTabId: s.activeTabId });
    return true;
  },

  reconcile(sections) {
    const s = useEditor.getState();
    if (!boundWorkspaceId || s.workspaceId !== boundWorkspaceId) return false;
    const { workspace, changed } = reconcileLinks(workspaceFromState(s), sections);
    if (changed) s.applyWorkspace({ ...workspace, activeTabId: s.activeTabId });
    return changed;
  },

  reveal(target) {
    const s = useEditor.getState();
    const found = findBlock(workspaceFromState(s), target);
    if (found) return revealShape(found.shapeId, found.tabId);
    const wanted = target.replace(/^#/, '').toLowerCase();
    const tab = s.diagramTabs.find((t) => {
      const diagram = t.id === s.activeTabId ? s.diagram : s.tabSnapshots[t.id]?.diagram;
      return diagram?.meta.title?.toLowerCase() === wanted;
    });
    if (!tab) return false;
    s.switchDiagramTab(tab.id);
    return true;
  },

  blockId(shapeId, tabId) {
    return blockIds(workspaceFromState(useEditor.getState())).get(blockKey(tabId, shapeId)) ?? null;
  },

  togglePanel() {
    if (useFrame.getState().mode === 'read') useFrame.setState((s) => ({ readerPanelOpen: !s.readerPanelOpen }));
    else useEditor.getState().setRightDockOpen(!useEditor.getState().rightDockOpen);
  },

  pulse: () => useFrame.setState((s) => ({ pulseTick: s.pulseTick + 1 })),
  insertImage: (name, type, data, at, link) => dropFile(name, type, data, at, link),
  insertLinkShape,
  worldAt,
  selection: () => {
    const s = useEditor.getState();
    const labels = s.selectedIds.map((id) => shapeLabel(s.diagram.shapes.find((shape) => shape.id === id)));
    return { shapeIds: [...s.selectedIds], labels, tabId: s.activeTabId };
  },
  exportImage,

  transformYaml(yaml, renames) {
    try {
      const { workspace, changed } = rewriteWorkspaceLinks(yamlToWorkspace(yaml), renames);
      return changed ? { yaml: workspaceToYaml(workspace), snapshot: snapshotOf(workspace, 0) } : null;
    } catch {
      return null;
    }
  },

  indexYaml(yaml) {
    try {
      return snapshotOf(yamlToWorkspace(yaml), 0);
    } catch {
      return null;
    }
  },

  focus() {
    window.focus();
  },
};

// Report edits, and catch core replacing the workspace (New, Open, an
// import). The replacement never reaches the file: the plugin is told, and
// the diagram's own workspace is loaded back.
useEditor.subscribe((state, previous) => {
  if (loading || !boundWorkspaceId) return;
  if (state.workspaceId !== boundWorkspaceId) {
    if (state.workspaceId !== previous.workspaceId && previous.workspaceId === boundWorkspaceId) {
      host.replaced(workspaceToYaml(workspaceFromState(state)), state.filePath, workspaceToYaml(workspaceFromState(previous)));
    }
    return;
  }
  if (state.workspaceRevision !== previous.workspaceRevision) host.changed();
  if (state.filePath !== previous.filePath) restoreFileHandle();
});
