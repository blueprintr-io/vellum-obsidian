// Creating, attaching and detaching stratum notes. A diagram's strata live
// as notes in the diagram's own folder.

import { normalizePath, TFile, type App } from 'obsidian';
import { KEY_DIAGRAM, KEY_KIND, KEY_SHAPE, KEY_TAB } from './index';
import type { StratumKind } from '../../shared/protocol';
import { diagramName } from '../files';

const ILLEGAL = /[\\/:*?"<>|#^[\]]+/g;

export function safeFileName(name: string): string {
  return name.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120).trim();
}

export function stratumNoteName(format: string, diagram: TFile, shapeLabel: string): string {
  const label = shapeLabel.trim() || 'Shape';
  const name = format
    .replace(/\{\{diagram\}\}/g, diagramName(diagram))
    .replace(/\{\{shape\}\}/g, label);
  return safeFileName(name) || safeFileName(`${diagramName(diagram)} - ${label}`) || 'Stratum';
}

/** A path in `folder` that no file uses yet: "Name.md", "Name 2.md", … */
export function availablePath(app: App, folder: string, name: string, extension: string): string {
  const prefix = folder && folder !== '/' ? `${folder}/` : '';
  for (let n = 1; ; n++) {
    const path = normalizePath(`${prefix}${name}${n > 1 ? ` ${n}` : ''}.${extension}`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

/** The wikilink a stratum's properties use to name its diagram. It always
 *  carries the extension, so `Net.vellum` and `Net.vellum.md` never mix. */
export function diagramLink(app: App, diagram: TFile, from: string): string {
  return `[[${app.metadataCache.fileToLinktext(diagram, from, false)}]]`;
}

export async function createStratum(
  app: App,
  diagram: TFile,
  binding: { shapeId: string; tabId: string; label: string; kind?: StratumKind },
  nameFormat: string,
): Promise<TFile> {
  const folder = diagram.parent?.path ?? '';
  const path = availablePath(app, folder, stratumNoteName(nameFormat, diagram, binding.label), 'md');
  const file = await app.vault.create(path, '');
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    fm[KEY_DIAGRAM] = diagramLink(app, diagram, path);
    fm[KEY_SHAPE] = binding.shapeId;
    fm[KEY_TAB] = binding.tabId;
    fm[KEY_KIND] = binding.kind ?? 'note';
  });
  return file;
}

export async function attachNote(app: App, note: TFile, diagram: TFile, binding: { shapeId: string; tabId: string }) {
  await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
    fm[KEY_DIAGRAM] = diagramLink(app, diagram, note.path);
    fm[KEY_SHAPE] = binding.shapeId;
    fm[KEY_TAB] = binding.tabId;
    if (!fm[KEY_KIND]) fm[KEY_KIND] = 'note';
  });
}

export async function detachNote(app: App, note: TFile) {
  await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
    delete fm[KEY_DIAGRAM];
    delete fm[KEY_SHAPE];
    delete fm[KEY_TAB];
    delete fm[KEY_KIND];
  });
}

/** Point a stratum at its diagram again after the diagram was renamed,
 *  when Obsidian has not already updated the link. */
export async function retargetStratum(app: App, note: TFile, diagram: TFile) {
  const link = app.metadataCache.getFileCache(note)?.frontmatterLinks?.find((l) => l.key === KEY_DIAGRAM)?.link;
  if (link && app.metadataCache.getFirstLinkpathDest(link, note.path)?.path === diagram.path) return;
  await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
    fm[KEY_DIAGRAM] = diagramLink(app, diagram, note.path);
  });
}
