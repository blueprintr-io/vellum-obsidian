// Which shapes open something when clicked in read mode, and which shape a
// press on a child resolves to:
//   - a shape with its own stratum or link is its own target;
//   - rack ports and modules without one resolve to the nearest linked
//     module or unit, even when sibling ports are linked;
//   - members of a linked group resolve to the group, and all of them glow;
//   - children of a linked container resolve to it only while no other
//     shape inside it is linked. The innermost linked ancestor decides.

import type { DiagramState, Shape } from '@/store/types';
import type { StratumInfo } from '../shared/protocol';
import { findLinks } from '../shared/links';
import { shapeLink } from './workspace';

export interface Target {
  shapeId: string;
  strata: StratumInfo[];
  link: string | null;
}

export interface TargetIndex {
  targets: Map<string, Target>;
  resolve(shapeId: string): Target | null;
  /** Shapes that glow for a target. */
  members(shapeId: string): string[];
}

const MAX_DEPTH = 8;
const TEXT_KEYS = ['label', 'sublabel', 'body'] as const;

/** A shape's link: its link property, else the first link in its text. */
export function linkOf(shape: Shape): string | null {
  const explicit = shapeLink(shape);
  if (explicit) return explicit;
  for (const key of TEXT_KEYS) {
    const [first] = findLinks(shape[key] ?? '');
    if (first) return first.raw;
  }
  return null;
}

const isRackPart = (shape: Shape) => !!(shape.rackPort || shape.rackModule);
const isRackOwner = (shape: Shape) => !!(shape.rack || shape.rackUnit || shape.rackModule);

export function buildTargets(diagram: DiagramState, strata: readonly StratumInfo[], tabId: string): TargetIndex {
  const byId = new Map(diagram.shapes.map((s) => [s.id, s]));
  const children = new Map<string, string[]>();
  for (const shape of diagram.shapes) {
    if (!shape.parent) continue;
    const list = children.get(shape.parent) ?? [];
    list.push(shape.id);
    children.set(shape.parent, list);
  }

  const targets = new Map<string, Target>();
  for (const stratum of strata) {
    if (stratum.tabId && stratum.tabId !== tabId) continue;
    if (!byId.has(stratum.shapeId)) continue;
    const target = targets.get(stratum.shapeId) ?? { shapeId: stratum.shapeId, strata: [], link: null };
    target.strata.push(stratum);
    targets.set(stratum.shapeId, target);
  }
  for (const shape of diagram.shapes) {
    const link = linkOf(shape);
    if (!link) continue;
    const target = targets.get(shape.id) ?? { shapeId: shape.id, strata: [], link: null };
    target.link = link;
    targets.set(shape.id, target);
  }

  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      out.push(next);
      stack.push(...(children.get(next) ?? []));
    }
    return out;
  };
  const hasLinkedDescendant = (id: string) => descendants(id).some((d) => targets.has(d));

  const resolve = (shapeId: string): Target | null => {
    const direct = targets.get(shapeId);
    if (direct) return direct;
    const start = byId.get(shapeId);
    if (!start) return null;
    let current = start;
    for (let depth = 0; depth < MAX_DEPTH && current.parent; depth++) {
      const ancestor = byId.get(current.parent);
      if (!ancestor) return null;
      const target = targets.get(ancestor.id);
      if (target) {
        if (isRackPart(start) && isRackOwner(ancestor)) return target;
        if (ancestor.kind === 'group') return target;
        return hasLinkedDescendant(ancestor.id) ? null : target;
      }
      current = ancestor;
    }
    return null;
  };

  const members = (shapeId: string): string[] => {
    const shape = byId.get(shapeId);
    if (shape?.kind !== 'group') return [shapeId];
    const inside = descendants(shapeId).filter((id) => byId.get(id)?.kind !== 'group');
    return inside.length ? inside : [shapeId];
  };

  return { targets, resolve, members };
}
