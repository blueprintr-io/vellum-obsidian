// Pointer behaviour the frame adds to core's canvas.
//
// Read mode owns the pointer: a drag pans, a pinch zooms, and a click on a
// shape with a stratum or link opens it. Core sees none of these presses,
// so it never selects, marquees or opens its context menu while the diagram
// is read-only. Wheel and middle-button panning stay with core.
//
// Both modes glow the shape a strata list row points at, and play the
// "show clickable shapes" pulse.

import { useEffect, useMemo, useRef } from 'react';
import { useEditor } from '@/store/editor';
import type { PointerInfo, Rect } from '../shared/protocol';
import { host } from './boot';
import { refreshGlows, setClickable, setGlow } from './halo';
import { useFrame } from './state';
import { buildTargets, type Target, type TargetIndex } from './targets';

const CLICK_SLOP = 5;
const HOVER_THROTTLE_MS = 50;
const PULSE_MS = 2400;

function canvasElement(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('svg[data-vellum-canvas]');
}

function shapeIdAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y);
  const canvas = canvasElement();
  if (!hit || !canvas?.contains(hit)) return null;
  return hit.closest('[data-shape-id]')?.getAttribute('data-shape-id') ?? null;
}

function unionRect(shapeIds: string[]): Rect | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const id of shapeIds) {
    for (const el of document.querySelectorAll(`svg[data-vellum-canvas] [data-shape-id="${CSS.escape(id)}"]`)) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
  }
  return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

function pointerInfo(e: PointerEvent | MouseEvent): PointerInfo {
  return { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey };
}

export function useTargets(): TargetIndex {
  const diagram = useEditor((s) => s.diagram);
  const tabId = useEditor((s) => s.activeTabId);
  const strata = useFrame((s) => s.strata);
  return useMemo(() => buildTargets(diagram, strata, tabId), [diagram, strata, tabId]);
}

export function openTarget(target: Target, e: { ctrlKey: boolean; metaKey: boolean }) {
  const [first] = target.strata;
  if (first) host.stratum({ type: 'open', path: first.path, shapeId: target.shapeId });
  else if (target.link) host.link({ type: 'open', link: target.link, newLeaf: e.ctrlKey || e.metaKey });
}

export function CanvasInteractions() {
  const mode = useFrame((s) => s.mode);
  const activeShapeId = useFrame((s) => s.activeShapeId);
  const pulseTick = useFrame((s) => s.pulseTick);
  const index = useTargets();
  const indexRef = useRef(index);
  indexRef.current = index;
  const diagram = useEditor((s) => s.diagram);

  // Shapes the pointer can open, including children that resolve upward.
  useEffect(() => {
    if (mode !== 'read') {
      setClickable([]);
      return;
    }
    const ids = new Set<string>();
    for (const shape of diagram.shapes) {
      const target = index.resolve(shape.id);
      if (target) ids.add(shape.id);
    }
    setClickable(ids);
  }, [mode, index, diagram.shapes]);

  useEffect(() => {
    setGlow('active', activeShapeId ? index.members(activeShapeId) : []);
  }, [activeShapeId, index]);

  // Geometry changes (a reload, an undo) move shapes under their filters.
  useEffect(() => { refreshGlows(); }, [diagram]);

  // Replays only when asked; a diagram edit mid-pulse keeps the old set.
  useEffect(() => {
    if (!pulseTick) return;
    const current = indexRef.current;
    setGlow('pulse', [...current.targets.keys()].flatMap((id) => current.members(id)));
    const timer = window.setTimeout(() => setGlow('pulse', []), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseTick]);

  useEffect(() => {
    if (mode !== 'read') return;
    return installReadGestures(() => indexRef.current);
  }, [mode]);

  return null;
}

/** Read mode's pointer handling. Returns a cleanup function. */
function installReadGestures(currentIndex: () => TargetIndex): () => void {
  let hovered: Target | null = null;
  let lastHoverAt = 0;
  let pendingHover: number | undefined;

  const setHovered = (target: Target | null, e: PointerEvent | null) => {
    if (target?.shapeId === hovered?.shapeId) {
      if (target && e) reportHover(target, e);
      return;
    }
    const previous = hovered;
    hovered = target;
    setGlow('hover', target ? currentIndex().members(target.shapeId) : []);
    if (previous) host.hoverEnd();
    if (target && e) reportHover(target, e);
  };

  const reportHover = (target: Target, e: PointerEvent) => {
    const rect = unionRect(currentIndex().members(target.shapeId));
    if (!rect) return;
    const [first] = target.strata;
    if (first) host.hoverStratum(first.path, rect, pointerInfo(e));
    else if (target.link) host.hoverLink(target.link, rect, pointerInfo(e));
  };

  const updateHover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || gesture) return;
    const now = performance.now();
    window.clearTimeout(pendingHover);
    if (now - lastHoverAt < HOVER_THROTTLE_MS) {
      pendingHover = window.setTimeout(() => updateHover(e), HOVER_THROTTLE_MS);
      return;
    }
    lastHoverAt = now;
    const id = shapeIdAt(e.clientX, e.clientY);
    setHovered(id ? currentIndex().resolve(id) : null, e);
  };

  type Gesture = {
    pointerId: number;
    startX: number;
    startY: number;
    panStart: { x: number; y: number };
    moved: boolean;
    target: Target | null;
  };
  let gesture: Gesture | null = null;
  // Touch points for pinch zoom: pointerId -> last client position.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; mid: { x: number; y: number } } | null = null;

  const inCanvas = (e: Event) => {
    const canvas = canvasElement();
    return !!canvas && e.target instanceof Node && canvas.contains(e.target);
  };

  const localPoint = (x: number, y: number) => {
    const rect = canvasElement()?.getBoundingClientRect();
    return { x: x - (rect?.left ?? 0), y: y - (rect?.top ?? 0) };
  };

  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!inCanvas(e) || e.button === 1) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        gesture = null;
        pinch = pinchState();
        return;
      }
    }
    if (e.button !== 0 && e.button !== 2) return;
    canvasElement()?.setPointerCapture?.(e.pointerId);
    const id = shapeIdAt(e.clientX, e.clientY);
    gesture = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panStart: useEditor.getState().pan,
      moved: false,
      // A right-button press only pans.
      target: e.button === 0 && id ? currentIndex().resolve(id) : null,
    };
    setHovered(null, null);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) {
        e.stopPropagation();
        const next = pinchState();
        const store = useEditor.getState();
        store.panBy(next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y);
        if (pinch.distance > 0) store.zoomBy(next.distance / pinch.distance, localPoint(next.mid.x, next.mid.y));
        pinch = next;
        return;
      }
    }
    // Core's hover affordances (anchor dots, resize cursors) are for editing.
    if (inCanvas(e)) e.stopPropagation();
    if (gesture && e.pointerId === gesture.pointerId) {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      gesture.moved = true;
      useEditor.getState().setPan({ x: gesture.panStart.x + dx, y: gesture.panStart.y + dy });
      return;
    }
    updateHover(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    }
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    e.stopPropagation();
    const { moved, target } = gesture;
    gesture = null;
    canvasElement()?.releasePointerCapture?.(e.pointerId);
    if (!moved && target && e.type === 'pointerup') openTarget(target, e);
  };

  const onContextMenu = (e: MouseEvent) => {
    if (!inCanvas(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onLeave = () => setHovered(null, null);

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    window.clearTimeout(pendingHover);
    setHovered(null, null);
  };
}
