// Strata are notes attached to a shape. Each one says what it belongs to in
// its own properties:
//
//   vellum-diagram: "[[Network.vellum.md]]"   the diagram (a link, so
//                                            Obsidian keeps it current)
//   vellum-shape: shape-1a2b3c4d              the shape's id
//   vellum-tab: tab-9f8e7d6c                  optional: the diagram tab
//   vellum-kind: note                         optional: note, code,
//                                            diagram, image or embed
//
// The index reads those properties from Obsidian's metadata cache and keeps
// a map from diagrams to their strata.

import { Events, getLinkpath, TFile, type App, type CachedMetadata } from 'obsidian';
import type { StratumInfo, StratumKind } from '../../shared/protocol';

export const KEY_DIAGRAM = 'vellum-diagram';
export const KEY_SHAPE = 'vellum-shape';
export const KEY_TAB = 'vellum-tab';
export const KEY_KIND = 'vellum-kind';

const KINDS: readonly StratumKind[] = ['note', 'code', 'diagram', 'image', 'embed'];

export interface StratumEntry extends StratumInfo {
  diagramPath: string | null;
}

export function stratumKind(value: unknown): StratumKind {
  return KINDS.includes(value as StratumKind) ? (value as StratumKind) : 'note';
}

/** The text inside `[[...]]`, accepting a bare path as well. */
function linkTarget(value: string): string {
  const m = /^\s*!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(value);
  return getLinkpath((m ? m[1] : value).trim());
}

export class StrataIndex extends Events {
  private notes = new Map<string, StratumEntry>();

  constructor(private readonly app: App) {
    super();
  }

  /** Read every note once the vault is indexed. */
  build() {
    this.notes.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.read(file, this.app.metadataCache.getFileCache(file));
    this.trigger('changed', null);
  }

  /** Re-read one note. Announces the diagrams whose strata changed. */
  update(file: TFile, cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file)) {
    const before = this.notes.get(file.path);
    const after = this.read(file, cache);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    for (const diagram of new Set([before?.diagramPath, after?.diagramPath])) {
      if (diagram) this.trigger('changed', diagram);
    }
  }

  remove(path: string) {
    const entry = this.notes.get(path);
    if (!entry) return;
    this.notes.delete(path);
    if (entry.diagramPath) this.trigger('changed', entry.diagramPath);
  }

  rename(file: TFile, oldPath: string) {
    this.remove(oldPath);
    if (file.extension === 'md') this.update(file);
    // Strata that pointed at a diagram under its old path resolve again.
    for (const entry of [...this.notes.values()]) {
      if (entry.diagramPath === oldPath || entry.diagramPath === null) {
        const note = this.app.vault.getFileByPath(entry.path);
        if (note) this.update(note);
      }
    }
  }

  private read(file: TFile, cache: CachedMetadata | null): StratumEntry | null {
    const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
    const shape = frontmatter?.[KEY_SHAPE];
    const diagram = frontmatter?.[KEY_DIAGRAM];
    if ((typeof shape !== 'string' && typeof shape !== 'number') || typeof diagram !== 'string' || !String(shape).trim()) {
      this.notes.delete(file.path);
      return null;
    }
    const link = cache?.frontmatterLinks?.find((l) => l.key === KEY_DIAGRAM)?.link ?? linkTarget(diagram);
    const target = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(link), file.path);
    const tab = frontmatter?.[KEY_TAB];
    const entry: StratumEntry = {
      path: file.path,
      title: file.basename,
      kind: stratumKind(frontmatter?.[KEY_KIND]),
      shapeId: String(shape).trim(),
      ...(typeof tab === 'string' && tab.trim() ? { tabId: tab.trim() } : {}),
      diagramPath: target?.path ?? null,
    };
    this.notes.set(file.path, entry);
    return entry;
  }

  forDiagram(path: string): StratumEntry[] {
    return [...this.notes.values()]
      .filter((entry) => entry.diagramPath === path)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  forShape(diagramPath: string, shapeId: string, tabId?: string): StratumEntry[] {
    return this.forDiagram(diagramPath).filter((s) => s.shapeId === shapeId && (!s.tabId || !tabId || s.tabId === tabId));
  }

  get(path: string): StratumEntry | undefined {
    return this.notes.get(path);
  }

  /** Strata that point at a diagram path, including ones whose link no
   *  longer resolves because the diagram moved. */
  pointingAt(path: string): StratumEntry[] {
    return [...this.notes.values()].filter((entry) => entry.diagramPath === path);
  }

  override on(name: 'changed', callback: (diagramPath: string | null) => void) {
    return super.on(name, callback as (...data: unknown[]) => unknown);
  }
}
