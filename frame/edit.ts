// Edits the plugin asks the frame to make: links on shapes and content
// brought in from the vault.

import { useEditor } from '@/store/editor';
import { insertBareShape } from '@/editor/insert';
import { screenToWorld } from '@/editor/canvas/projection';

function canvas(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('svg[data-vellum-canvas]');
}

/** World point under a frame client coordinate. */
export function worldAt(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas()?.getBoundingClientRect();
  const { pan, zoom } = useEditor.getState();
  return screenToWorld({ x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }, { pan, zoom });
}

/** Client coordinate of a world point, for synthetic drops. */
function clientAt(world: { x: number; y: number }): { x: number; y: number } {
  const rect = canvas()?.getBoundingClientRect();
  const { pan, zoom } = useEditor.getState();
  return { x: world.x * zoom + pan.x + (rect?.left ?? 0), y: world.y * zoom + pan.y + (rect?.top ?? 0) };
}

function viewCentre(): { x: number; y: number } {
  const rect = canvas()?.getBoundingClientRect();
  return worldAt((rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2, (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2);
}

export function setShapeLink(shapeId: string, link: string | null) {
  const store = useEditor.getState();
  const shape = store.diagram.shapes.find((s) => s.id === shapeId);
  if (!shape) return;
  const meta = { ...shape.meta };
  if (link?.trim()) meta.link = link.trim();
  else delete meta.link;
  store.updateShape(shapeId, { meta: Object.keys(meta).length ? meta : undefined });
}

/** A box that links to a note, showing its name. Basic shapes draw their
 *  `body` text (core never paints `label` on them). */
export function insertLinkShape(label: string, link: string, at: { x: number; y: number } | null) {
  const store = useEditor.getState();
  store.beginHistoryBatch();
  try {
    insertBareShape('rect', at ?? viewCentre());
    const id = useEditor.getState().selectedIds[0];
    const shape = id ? useEditor.getState().diagram.shapes.find((s) => s.id === id) : undefined;
    if (shape) {
      const w = Math.min(320, Math.max(120, label.length * 8 + 48));
      useEditor.getState().updateShape(shape.id, {
        body: label,
        x: shape.x + shape.w / 2 - w / 2,
        w,
        h: 56,
        meta: { ...shape.meta, link },
      });
    }
  } finally {
    useEditor.getState().endHistoryBatch();
  }
}

/** Hand a vault file to core exactly as if it had been dropped from the
 *  desktop, so images, editable PNG/SVG exports and diagram files get the
 *  same treatment as a drop. Optionally link the shape it creates. */
export async function dropFile(name: string, type: string, data: ArrayBuffer, at: { x: number; y: number } | null, link?: string) {
  const target = canvas();
  if (!target) throw new Error('The canvas is not ready.');
  const before = new Set(useEditor.getState().diagram.shapes.map((s) => s.id));
  const point = clientAt(at ?? viewCentre());
  const transfer = new DataTransfer();
  transfer.items.add(new File([data], name, { type }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: transfer }));
  if (!link) return;
  // Core reads the file asynchronously; link the shape once it lands.
  const added = await new Promise<string | null>((resolve) => {
    const started = performance.now();
    const check = () => {
      const fresh = useEditor.getState().diagram.shapes.find((s) => !before.has(s.id) && !s.parent);
      if (fresh) resolve(fresh.id);
      else if (performance.now() - started > 10_000) resolve(null);
      else window.setTimeout(check, 50);
    };
    check();
  });
  if (added) setShapeLink(added, link);
}
