// A diagram embedded in a note (`![[Network.vellum]]`), in a hover preview
// or on a canvas. It shows the rendered diagram as an image, and in read
// mode its strata and links stay clickable through hotspots laid over the
// shapes.
//
// Size options follow Obsidian's image syntax: `|400`, `|400x300`.
// `#Tab title` embeds one tab, `#^shape-id` crops to one shape.

import { Component, Keymap, setIcon, type HoverPopover, type TFile } from 'obsidian';
import type { ExportResult, Hotspot } from '../../shared/protocol';
import { diagramName } from '../files';
import type VellumPlugin from '../main';

export interface EmbedContext {
  containerEl: HTMLElement;
  sourcePath?: string;
  linktext?: string;
}

export class DiagramEmbed extends Component {
  hoverPopover: HoverPopover | null = null;
  private readonly el: HTMLElement;
  private url: string | null = null;
  private renderId = 0;

  constructor(
    private readonly plugin: VellumPlugin,
    private readonly ctx: EmbedContext,
    private readonly file: TFile,
    private readonly subpath: string,
  ) {
    super();
    ctx.containerEl.addClass('vellum-embed-container');
    this.el = ctx.containerEl.createDiv('vellum-embed');
  }

  override onload() {
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (file === this.file) void this.render();
    }));
    this.registerEvent(this.plugin.app.workspace.on('css-change', () => void this.render()));
    this.registerEvent(this.plugin.strata.on('changed', (path) => {
      if (!path || path === this.file.path) void this.render();
    }));
    this.registerDomEvent(this.el, 'dblclick', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.vellum-hotspot')) return;
      e.preventDefault();
      this.openDiagram(e);
    });
  }

  /** Called by Obsidian's embed loader once the component is loaded. */
  async loadFile() {
    await this.render();
  }

  private size(): { width: string | null; height: string | null } {
    const el = this.ctx.containerEl;
    const width = el.getAttribute('width');
    const height = el.getAttribute('height');
    const fallback = this.plugin.settings.embedWidth.trim();
    return { width: width || (fallback || null), height };
  }

  private async render() {
    const id = ++this.renderId;
    const { settings } = this.plugin;
    let result: ExportResult;
    try {
      result = await this.plugin.renderer.render(this.file, {
        format: 'svg',
        theme: settings.embedFollowsTheme ? this.plugin.obsidianTheme() : undefined,
        subpath: this.subpath,
      });
    } catch (error) {
      if (id !== this.renderId) return;
      this.el.empty();
      this.el.addClass('is-error');
      this.el.createDiv({ cls: 'vellum-embed-error', text: `${diagramName(this.file)}: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (id !== this.renderId) return;
    this.el.removeClass('is-error');
    this.show(result);
  }

  private show(result: ExportResult) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(new Blob([result.data], { type: 'image/svg+xml' }));
    this.el.empty();
    const frame = this.el.createDiv('vellum-embed-frame');
    const { width, height } = this.size();
    frame.setCssStyles({
      width: width ? (/^\d+$/.test(width) ? `${width}px` : width) : `${Math.round(result.width)}px`,
      maxHeight: height && /^\d+$/.test(height) ? `${height}px` : '',
      aspectRatio: `${result.width} / ${result.height}`,
    });
    frame.createEl('img', {
      cls: 'vellum-embed-image',
      attr: { src: this.url, alt: this.ctx.containerEl.getAttribute('alt') || diagramName(this.file), draggable: 'false' },
    });
    if (this.plugin.settings.embedInteractive) for (const spot of result.hotspots) this.hotspot(frame, spot);

    const open = frame.createEl('button', { cls: 'vellum-embed-open clickable-icon', attr: { 'aria-label': `Open ${diagramName(this.file)}`, type: 'button' } });
    setIcon(open, 'maximize-2');
    open.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openDiagram(e);
    });
  }

  private hotspot(frame: HTMLElement, spot: Hotspot) {
    const strata = this.plugin.strata.forDiagram(this.file.path).filter((s) => s.shapeId === spot.shapeId);
    const el = frame.createDiv({
      cls: 'vellum-hotspot',
      attr: { role: 'button', tabindex: '0', 'aria-label': strata[0]?.title ?? 'Open link' },
    });
    el.setCssStyles({ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.width * 100}%`, height: `${spot.height * 100}%` });
    const activate = (e: MouseEvent | KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.hover.end();
      if (strata.length) {
        const around = this.ctx.containerEl.closest<HTMLElement>('.workspace-leaf-content') ?? this.ctx.containerEl;
        this.plugin.strataActions.open(this.file, strata[0].path, spot.shapeId, around);
      } else if (spot.link) {
        this.plugin.openLink(spot.link, this.file.path, e instanceof MouseEvent && Keymap.isModEvent(e) !== false);
      }
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate(e);
    });
    el.addEventListener('mouseenter', (e) => {
      const r = el.getBoundingClientRect();
      const rect = { x: r.left, y: r.top, width: r.width, height: r.height };
      const pointer = { x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey };
      if (strata.length) this.plugin.hover.stratum(this.ctx, strata[0].path, rect, pointer);
      else if (spot.link) this.plugin.hover.link(this, spot.link, this.file.path, rect, pointer);
    });
    el.addEventListener('mouseleave', () => this.plugin.hover.end());
  }

  private openDiagram(e: MouseEvent) {
    const leaf = this.plugin.app.workspace.getLeaf(Keymap.isModEvent(e));
    void leaf.openFile(this.file, { active: true, eState: this.subpath ? { subpath: this.subpath } : undefined });
  }

  get containerEl(): HTMLElement {
    return this.ctx.containerEl;
  }

  override onunload() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.el.remove();
  }
}
