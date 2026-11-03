// Teaching Obsidian to embed diagrams. Obsidian builds every embed, hover
// preview and canvas card through its embed registry, keyed by extension.
// `.vellum` files get an entry of their own. Markdown diagrams are `.md`
// files, so the Markdown entry is wrapped: diagrams render as diagrams,
// every other note goes to Obsidian's own embed.
//
// The registry is not part of Obsidian's published API. If it is missing
// or changes shape, reading view still renders diagrams through a
// Markdown post-processor.

import { MarkdownRenderChild, TFile, type App, type Component, type MarkdownPostProcessorContext } from 'obsidian';
import { EXTENSION, isDiagram, isMarkdownDiagram } from '../files';
import type VellumPlugin from '../main';
import { DiagramEmbed, type EmbedContext } from './embed';

type EmbedCreator = (ctx: EmbedContext, file: TFile, subpath: string) => Component & { loadFile?: () => unknown };

interface EmbedRegistry {
  embedByExtension: Record<string, EmbedCreator | undefined>;
  registerExtension(extension: string, creator: EmbedCreator): void;
  unregisterExtension(extension: string): void;
}

const GENERATED_HEADINGS = new Set(['vellum data', 'text', 'links', 'diagram']);

/** Whether an embed asks for part of the notes written beside a Markdown
 *  diagram (an existing heading) rather than for the diagram. */
function wantsNotes(app: App, file: TFile, subpath: string): boolean {
  const heading = subpath.replace(/^#/, '').trim().toLowerCase();
  if (!heading || heading.startsWith('^') || GENERATED_HEADINGS.has(heading)) return false;
  return !!app.metadataCache.getFileCache(file)?.headings?.some((h) => h.heading.trim().toLowerCase() === heading);
}

export function registerEmbeds(plugin: VellumPlugin): () => void {
  const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  const original = registry?.embedByExtension?.md;
  if (!registry || typeof registry.registerExtension !== 'function' || typeof original !== 'function') {
    registerFallback(plugin);
    return () => {};
  }
  const create: EmbedCreator = (ctx, file, subpath) => new DiagramEmbed(plugin, ctx, file, subpath);
  registry.registerExtension(EXTENSION, create);
  const wrapped: EmbedCreator = (ctx, file, subpath) =>
    isMarkdownDiagram(plugin.app, file) && !wantsNotes(plugin.app, file, subpath) ? create(ctx, file, subpath) : original(ctx, file, subpath);
  registry.embedByExtension.md = wrapped;
  return () => {
    registry.unregisterExtension(EXTENSION);
    if (registry.embedByExtension.md === wrapped) registry.embedByExtension.md = original;
  };
}

function registerFallback(plugin: VellumPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      const src = span.getAttribute('src');
      if (!src || span.hasClass('vellum-embed-container')) continue;
      const [linkpath, ...rest] = src.split('#');
      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
      if (!(file instanceof TFile) || !isDiagram(plugin.app, file)) continue;
      const subpath = rest.length ? `#${rest.join('#')}` : '';
      if (file.extension === 'md' && wantsNotes(plugin.app, file, subpath)) continue;
      span.empty();
      const embed = new DiagramEmbed(plugin, { containerEl: span, sourcePath: ctx.sourcePath, linktext: src }, file, subpath);
      const child = new MarkdownRenderChild(span);
      child.addChild(embed);
      ctx.addChild(child);
      void embed.loadFile();
    }
  });
}
