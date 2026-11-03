// Keeping links inside diagrams current when the notes they point at are
// renamed or moved.
//
// For Markdown diagrams Obsidian already rewrites the Text and Links
// sections; the YAML source, which lives in a code block, is updated here
// (and is also reconciled from those sections whenever a diagram loads, in
// case a rename happened without this plugin). `.vellum` files are
// invisible to Obsidian's link updater, so they rely on this entirely.
// Like Obsidian, nothing is rewritten when "Automatically update internal
// links" is off.

import { TFile, type App } from 'obsidian';
import { composeMarkdownDiagram, parseMarkdownDiagram } from './format';
import { EXTENSION, isDiagram, sourceOf } from './files';
import type VellumPlugin from './main';
import { VellumView } from './view';

// Obsidian updates Markdown links right after the rename event; touching
// the same files before it has finished would race it.
const SETTLE_MS = 1500;

function alwaysUpdateLinks(app: App): boolean {
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  return vault.getConfig?.('alwaysUpdateLinks') !== false;
}

/** Link texts that may have named a file before it moved: its name, its
 *  path, each with and without the `.md` extension. */
function oldLinkTexts(oldPath: string): string[] {
  const noMd = oldPath.replace(/\.md$/i, '');
  const name = oldPath.split('/').pop()!;
  return [...new Set([noMd, oldPath, name.replace(/\.md$/i, ''), name])];
}

export class LinkMaintainer {
  constructor(private readonly plugin: VellumPlugin) {}

  private get app(): App {
    return this.plugin.app;
  }

  renamed(file: TFile, oldPath: string) {
    if (!alwaysUpdateLinks(this.app)) return;
    window.setTimeout(() => void this.rewriteAll(file, oldPath), SETTLE_MS);
  }

  private async rewriteAll(file: TFile, oldPath: string) {
    const candidates = oldLinkTexts(oldPath);
    for (const diagram of this.app.vault.getFiles()) {
      if (diagram === file || !isDiagram(this.app, diagram)) continue;
      try {
        await this.rewrite(diagram, file, candidates);
      } catch (error) {
        console.error(`[vellum] could not update links in ${diagram.path}`, error);
      }
    }
  }

  private renamesFor(diagram: TFile, file: TFile, candidates: string[], text: string): Record<string, string> {
    const renames: Record<string, string> = {};
    const shortest = this.app.metadataCache.fileToLinktext(file, diagram.path, true);
    const lower = text.toLowerCase();
    for (const old of candidates) {
      if (!lower.includes(old.toLowerCase())) continue;
      // Leave a link alone if it still reaches a file (another one now).
      if (this.app.metadataCache.getFirstLinkpathDest(old, diagram.path)) continue;
      renames[old] = old.includes('/') ? file.path.replace(/\.md$/i, old.endsWith('.md') ? '.md' : '') : shortest;
    }
    return renames;
  }

  private async rewrite(diagram: TFile, file: TFile, candidates: string[]) {
    const text = await this.app.vault.cachedRead(diagram);
    const renames = this.renamesFor(diagram, file, candidates, text);
    if (!Object.keys(renames).length) return;

    const open = this.app.workspace.getLeavesOfType('vellum')
      .map((leaf) => leaf.view)
      .find((view): view is VellumView => view instanceof VellumView && view.file === diagram);
    if (open?.frame) {
      open.frame.rewriteLinks(renames);
      return;
    }

    const yaml = sourceOf(diagram, text);
    if (!yaml) return;
    const transformed = await this.plugin.renderer.transform(yaml, renames);
    if (!transformed) return;
    await this.app.vault.process(diagram, (current) => {
      if (diagram.extension === EXTENSION) return current === text ? transformed.yaml : current;
      const page = parseMarkdownDiagram(current);
      if (page.yaml !== yaml) return current;
      return composeMarkdownDiagram(page, transformed.snapshot, { compress: page.compressed });
    });
  }
}
