// Diagram files: telling them apart from notes, naming, creating and
// converting them.

import { moment, normalizePath, TFile, TFolder, type App } from 'obsidian';
import { composeMarkdownDiagram, FRONTMATTER_KEY, MARKDOWN_SUFFIX, parseMarkdownDiagram } from './format';
import type { DiagramFormat, VellumSettings } from './settings';

export const VIEW_TYPE = 'vellum';
export const EXTENSION = 'vellum';

/** A `.vellum` file, or a note marked as a Markdown diagram. Notes the
 *  metadata cache has not read yet are recognised by their suffix. */
export function isDiagram(app: App, file: TFile | null | undefined): boolean {
  if (!file) return false;
  if (file.extension === EXTENSION) return true;
  return file.extension === 'md' && isMarkdownDiagram(app, file);
}

export function isMarkdownDiagram(app: App, file: TFile): boolean {
  if (file.extension !== 'md') return false;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (frontmatter) return FRONTMATTER_KEY in frontmatter;
  return file.path.toLowerCase().endsWith(MARKDOWN_SUFFIX);
}

/** "Network" for both `Network.vellum` and `Network.vellum.md`. */
export function diagramName(file: TFile): string {
  return file.basename.replace(/\.vellum$/i, '');
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A workspace with one empty tab, in the YAML core writes. */
export function emptyWorkspaceYaml(title: string): string {
  const tab = randomId('tab');
  return [
    'version: workspace-1.0',
    `activeTabId: ${tab}`,
    'tabs:',
    `  - id: ${tab}`,
    '    diagram:',
    '      version: "1.0"',
    '      meta:',
    `        title: ${JSON.stringify(title)}`,
    '      shapes: []',
    '      connectors: []',
    '      annotations: []',
    '',
  ].join('\n');
}

export function fileContent(format: DiagramFormat, yaml: string, compress: boolean): string {
  if (format === 'vellum') return yaml;
  return composeMarkdownDiagram({ frontmatter: null, body: '' }, { yaml, text: [], links: [], extra: [] }, { compress });
}

/** The YAML source held by a diagram file's text. Null when a Markdown
 *  file has no diagram block (yet). */
export function sourceOf(file: TFile, text: string): string | null {
  return file.extension === EXTENSION ? text : parseMarkdownDiagram(text).yaml;
}

export async function ensureFolder(app: App, path: string) {
  const folder = normalizePath(path);
  if (!folder || folder === '/' || app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
  await app.vault.createFolder(folder).catch(() => {
    // Created concurrently; fine as long as it exists now.
    if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new Error(`Could not create the folder ${folder}.`);
  });
}

export function availableFilePath(app: App, folder: string, name: string, suffix: string): string {
  const prefix = folder && folder !== '/' ? `${normalizePath(folder)}/` : '';
  for (let n = 1; ; n++) {
    const path = normalizePath(`${prefix}${name}${n > 1 ? ` ${n}` : ''}${suffix}`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

export function suffixFor(format: DiagramFormat): string {
  return format === 'markdown' ? MARKDOWN_SUFFIX : `.${EXTENSION}`;
}

export function newDiagramName(settings: VellumSettings): string {
  const date = settings.filenameFormat.trim() ? moment().format(settings.filenameFormat) : '';
  const name = `${settings.filenamePrefix}${date}`.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim();
  return name || 'Diagram';
}

/** Where a new diagram goes, given the folder the user asked for. */
export function newDiagramFolder(app: App, settings: VellumSettings, requested?: TFolder | null): string {
  if (requested) return requested.path;
  if (settings.folderBesideActiveNote) {
    const active = app.workspace.getActiveFile();
    if (active?.parent) return active.parent.path;
  }
  return settings.folder.trim();
}

/** Create a diagram file from the template, or empty. */
export async function createDiagram(
  app: App,
  settings: VellumSettings,
  options: { folder?: string; name?: string; yaml?: string } = {},
): Promise<TFile> {
  const folder = options.folder ?? newDiagramFolder(app, settings);
  await ensureFolder(app, folder);
  const name = options.name?.trim() || newDiagramName(settings);
  const path = availableFilePath(app, folder, name, suffixFor(settings.format));
  let yaml = options.yaml;
  if (!yaml && settings.template.trim()) {
    const template = app.vault.getFileByPath(normalizePath(settings.template.trim()));
    if (template && isDiagram(app, template)) yaml = sourceOf(template, await app.vault.read(template)) ?? undefined;
  }
  return app.vault.create(path, fileContent(settings.format, yaml ?? emptyWorkspaceYaml(name), settings.compressSource));
}

/** Convert between `.vellum` and `.vellum.md`, keeping the file's identity
 *  for links. Notes written beside a Markdown diagram move to a note of
 *  their own, since a `.vellum` file cannot hold them. */
export async function convertDiagram(app: App, file: TFile, to: DiagramFormat, compress: boolean): Promise<{ file: TFile; notes: TFile | null }> {
  const text = await app.vault.read(file);
  const folder = file.parent?.path ?? '';
  if (to === 'markdown') {
    if (file.extension !== EXTENSION) return { file, notes: null };
    const target = availableFilePath(app, folder, diagramName(file), MARKDOWN_SUFFIX);
    await app.fileManager.renameFile(file, target);
    await app.vault.modify(file, fileContent('markdown', text, compress));
    return { file, notes: null };
  }
  if (file.extension !== 'md') return { file, notes: null };
  const parsed = parseMarkdownDiagram(text);
  if (parsed.yaml === null) throw new Error('This note has no diagram to convert.');
  let notes: TFile | null = null;
  if (parsed.body.trim()) {
    notes = await app.vault.create(availableFilePath(app, folder, `${diagramName(file)} notes`, '.md'), `${parsed.body.trim()}\n`);
  }
  const target = availableFilePath(app, folder, diagramName(file), `.${EXTENSION}`);
  await app.fileManager.renameFile(file, target);
  await app.vault.modify(file, parsed.yaml.endsWith('\n') ? parsed.yaml : `${parsed.yaml}\n`);
  return { file, notes };
}
