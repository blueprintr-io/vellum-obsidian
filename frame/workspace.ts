// Reading and writing workspaces, and the searchable index the plugin writes
// into Markdown diagrams. Pure functions over core's data types, no store.

import { mdToPlain } from '@/lib/inline-marks';
import type { WorkspacePayload } from '@/store/schema';
import type { DiagramState, Shape } from '@/store/types';
import type { IndexSections, LinkEntry, TextEntry } from '../shared/protocol';
import { findLinks, parseLink, rewriteLinks } from '../shared/links';

/** Block ids for every shape, unique within the file. Obsidian accepts
 *  letters, digits and dashes; core's own ids (`shape-1a2b3c4d`) already
 *  qualify, imported ids are folded into that alphabet. */
export function blockIds(workspace: WorkspacePayload): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const tab of workspace.tabs) {
    for (const shape of tab.diagram.shapes) {
      const base = shape.id.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'shape';
      let id = base;
      for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${base}-${n}`;
      taken.add(id.toLowerCase());
      ids.set(blockKey(tab.id, shape.id), id);
    }
  }
  return ids;
}

export function blockKey(tabId: string, shapeId: string) {
  return JSON.stringify([tabId, shapeId]);
}

type TextField =
  | { kind: 'shape'; key: 'label' | 'sublabel' | 'body' }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'notation'; key: 'stereotype' | 'attributes' | 'operations' | 'participantTop' | 'participantBottom' };

const SHAPE_KEYS = ['label', 'sublabel', 'body'] as const;
const NOTATION_KEYS = ['stereotype', 'attributes', 'operations', 'participantTop', 'participantBottom'] as const;

/** A shape's text fields in a fixed order: the order its index line is
 *  written in, which reconciliation relies on. */
function textFields(shape: Shape): { field: TextField; value: string }[] {
  const out: { field: TextField; value: string }[] = [];
  for (const key of SHAPE_KEYS) {
    const value = shape[key];
    if (typeof value === 'string' && value.trim()) out.push({ field: { kind: 'shape', key }, value });
  }
  shape.cells?.forEach((row, r) => row?.forEach((cell, c) => {
    if (cell?.text?.trim()) out.push({ field: { kind: 'cell', row: r, col: c }, value: cell.text });
  }));
  if (shape.notation) {
    for (const key of NOTATION_KEYS) {
      const value = shape.notation[key];
      if (typeof value === 'string' && value.trim()) out.push({ field: { kind: 'notation', key }, value });
    }
  }
  return out;
}

function withField(shape: Shape, field: TextField, value: string): Shape {
  if (field.kind === 'shape') return { ...shape, [field.key]: value };
  if (field.kind === 'notation') return { ...shape, notation: { ...shape.notation!, [field.key]: value } };
  const cells = shape.cells!.map((row, r) => r !== field.row ? row : row.map((cell, c) => (
    c !== field.col || !cell ? cell : { ...cell, text: value }
  )));
  return { ...shape, cells };
}

const oneLine = (text: string) => mdToPlain(text).replace(/\s+/g, ' ').trim();

export function shapeLink(shape: Shape): string | null {
  const value = shape.meta?.link;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Text and explicit links of every shape, for a Markdown diagram's index
 *  sections. Connector labels and tab titles are part of the shape-free
 *  remainder: they are searchable but have no block of their own. */
export function indexWorkspace(workspace: WorkspacePayload): { text: TextEntry[]; links: LinkEntry[]; extra: string[] } {
  const ids = blockIds(workspace);
  const text: TextEntry[] = [];
  const links: LinkEntry[] = [];
  const extra: string[] = [];
  for (const tab of workspace.tabs) {
    if (tab.diagram.meta.title?.trim() && workspace.tabs.length > 1) extra.push(oneLine(tab.diagram.meta.title));
    for (const shape of tab.diagram.shapes) {
      const block = ids.get(blockKey(tab.id, shape.id))!;
      const parts = textFields(shape).map(({ value }) => oneLine(value)).filter(Boolean);
      if (parts.length) text.push({ block, shapeId: shape.id, tabId: tab.id, text: parts.join(' · ') });
      const link = shapeLink(shape);
      if (link) links.push({ block, shapeId: shape.id, tabId: tab.id, link });
    }
    for (const connector of tab.diagram.connectors) {
      const parts = [connector.fromLabel, connector.label, connector.toLabel].map((t) => oneLine(t ?? '')).filter(Boolean);
      if (parts.length) extra.push(parts.join(' · '));
    }
    for (const note of tab.diagram.annotations) {
      if (note.text?.trim()) extra.push(oneLine(note.text));
    }
  }
  return { text, links, extra };
}

function sameLinkpath(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Bring links in from a Markdown diagram's index sections. Obsidian
 *  updates links there when notes are renamed, including on devices where
 *  this plugin is not installed, while the YAML source keeps the old name.
 *  A section entry wins when it differs; an entry whose links no longer
 *  line up with the shape (edited by hand) is ignored. */
export function reconcileLinks(workspace: WorkspacePayload, sections: IndexSections): { workspace: WorkspacePayload; changed: boolean } {
  const ids = blockIds(workspace);
  let changed = false;
  const tabs = workspace.tabs.map((tab) => {
    let tabChanged = false;
    const shapes = tab.diagram.shapes.map((original) => {
      const block = ids.get(blockKey(tab.id, original.id))!;
      let shape = original;
      const explicit = sections.links[block];
      const current = shapeLink(shape);
      if (explicit !== undefined && current !== null && explicit.trim() !== current) {
        shape = { ...shape, meta: { ...shape.meta, link: explicit.trim() } };
      }
      const entry = sections.text[block];
      if (entry !== undefined) {
        const wanted = findLinks(entry).filter((l) => l.type === 'wiki');
        const fields = textFields(shape);
        const have = fields.flatMap(({ field, value }) => findLinks(value)
          .filter((l) => l.type === 'wiki')
          .map((link) => ({ field, link })));
        if (wanted.length === have.length) {
          // Rewrite field by field, replacing each differing link in order.
          const byField = new Map<TextField, { from: string; to: string }[]>();
          have.forEach(({ field, link }, i) => {
            const next = wanted[i];
            if (link.type !== 'wiki' || next.type !== 'wiki') return;
            if (sameLinkpath(link.linkpath, next.linkpath) && link.raw === next.raw) return;
            const list = byField.get(field) ?? [];
            list.push({ from: link.raw, to: next.raw });
            byField.set(field, list);
          });
          for (const { field, value } of fields) {
            const swaps = byField.get(field);
            if (!swaps) continue;
            let out = '';
            let rest = value;
            for (const { from, to } of swaps) {
              const at = rest.indexOf(from);
              if (at < 0) continue;
              out += rest.slice(0, at) + to;
              rest = rest.slice(at + from.length);
            }
            shape = withField(shape, field, out + rest);
          }
        }
      }
      if (shape !== original) tabChanged = true;
      return shape;
    });
    if (!tabChanged) return tab;
    changed = true;
    return { ...tab, diagram: { ...tab.diagram, shapes } };
  });
  return { workspace: changed ? { ...workspace, tabs } : workspace, changed };
}

function rewriteDiagram(diagram: DiagramState, renames: ReadonlyMap<string, string>): DiagramState {
  let changed = false;
  const swap = (text: string | undefined) => {
    if (!text) return text;
    const next = rewriteLinks(text, renames);
    if (next !== text) changed = true;
    return next;
  };
  const shapes = diagram.shapes.map((shape) => {
    let next = shape;
    for (const { field, value } of textFields(shape)) {
      const rewritten = swap(value)!;
      if (rewritten !== value) next = withField(next, field, rewritten);
    }
    const link = shapeLink(shape);
    if (link) {
      const parsed = parseLink(link);
      const rewritten = parsed && parsed.type !== 'url' ? swap(parsed.raw) : link;
      if (rewritten && rewritten !== parsed?.raw) next = { ...next, meta: { ...next.meta, link: rewritten } };
    }
    return next;
  });
  const connectors = diagram.connectors.map((c) => {
    const label = swap(c.label);
    return label === c.label ? c : { ...c, label };
  });
  const annotations = diagram.annotations.map((a) => {
    const text = swap(a.text)!;
    return text === a.text ? a : { ...a, text };
  });
  return changed ? { ...diagram, shapes, connectors, annotations } : diagram;
}

/** Replace link targets across every tab. `renames` maps old linkpaths to
 *  new ones; keys are compared case-insensitively. */
export function rewriteWorkspaceLinks(workspace: WorkspacePayload, renames: Record<string, string>) {
  const map = new Map(Object.entries(renames).map(([from, to]) => [from.trim().toLowerCase(), to]));
  let changed = false;
  const tabs = workspace.tabs.map((tab) => {
    const diagram = rewriteDiagram(tab.diagram, map);
    if (diagram === tab.diagram) return tab;
    changed = true;
    return { ...tab, diagram };
  });
  return { workspace: changed ? { ...workspace, tabs } : workspace, changed };
}

/** The shape a block id or shape id names, searching every tab. */
export function findBlock(workspace: WorkspacePayload, target: string): { tabId: string; shapeId: string } | null {
  const wanted = target.replace(/^\^/, '');
  const ids = blockIds(workspace);
  for (const tab of workspace.tabs) {
    for (const shape of tab.diagram.shapes) {
      if (shape.id === wanted || ids.get(blockKey(tab.id, shape.id))?.toLowerCase() === wanted.toLowerCase()) {
        return { tabId: tab.id, shapeId: shape.id };
      }
    }
  }
  return null;
}
