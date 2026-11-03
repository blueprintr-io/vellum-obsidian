import { useEditor } from '@/store/editor';
import { useFrame } from './state';

const HIGHLIGHT_MS = 1600;
let highlightTimer: number | undefined;

/** Bring a shape into view, switching tabs if needed, and glow it briefly.
 *  Edit mode also selects it. */
export function revealShape(shapeId: string, tabId?: string): boolean {
  const store = useEditor.getState();
  if (tabId && tabId !== store.activeTabId) {
    if (!store.diagramTabs.some((t) => t.id === tabId)) return false;
    store.switchDiagramTab(tabId);
  }
  const state = useEditor.getState();
  const shape = state.diagram.shapes.find((s) => s.id === shapeId);
  if (!shape) return false;

  const rect = document.querySelector('svg[data-vellum-canvas]')?.getBoundingClientRect();
  const width = rect?.width || window.innerWidth;
  const height = rect?.height || window.innerHeight;
  // Keep the zoom unless the shape would not fit in most of the view.
  const fit = Math.min((width * 0.8) / Math.max(shape.w, 1), (height * 0.8) / Math.max(shape.h, 1));
  const zoom = Math.max(0.1, Math.min(state.zoom, fit));
  state.setZoom(zoom);
  state.setPan({
    x: width / 2 - (shape.x + shape.w / 2) * zoom,
    y: height / 2 - (shape.y + shape.h / 2) * zoom,
  });
  if (useFrame.getState().mode === 'edit') state.setSelected(shapeId);

  window.clearTimeout(highlightTimer);
  useFrame.getState().setActiveShapeId(shapeId);
  highlightTimer = window.setTimeout(() => {
    if (useFrame.getState().activeShapeId === shapeId) useFrame.getState().setActiveShapeId(null);
  }, HIGHLIGHT_MS);
  return true;
}
