// The view for `.vellum` files and Markdown diagrams. It runs the editor in
// an iframe and keeps the file in step through TextFileView: Obsidian reads
// the file into setViewData, and saves whatever getViewData returns.

import { Menu, Notice, TextFileView, setIcon, type HoverParent, type HoverPopover, type TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { DiagramSnapshot, FrameApi, IndexSections, ViewMode } from '../shared/protocol';
import { composeMarkdownDiagram, parseMarkdownDiagram } from './format';
import { diagramName, emptyWorkspaceYaml, EXTENSION, VIEW_TYPE } from './files';
import { ViewHost } from './host';
import type VellumPlugin from './main';

interface LoadJob {
  yaml: string;
  sections?: IndexSections;
  fit: boolean;
  keepHistory: boolean;
  dirty?: boolean;
}

const MODE_KEY = 'vellum-mode';

export class VellumView extends TextFileView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  frame: FrameApi | null = null;
  mode: ViewMode;
  private frameEl: HTMLIFrameElement | null = null;
  private readonly host: ViewHost;
  private page: { frontmatter: string | null; body: string } = { frontmatter: null, body: '' };
  private pending: LoadJob | null = null;
  /** The file whose diagram the frame holds. Saving writes nothing until
   *  this matches the open file, so a failed load can never overwrite it. */
  private loadedPath: string | null = null;
  private loadedYaml: string | null = null;
  private lastToken = 0;
  private pendingSubpath: string | null = null;
  private rescued: DiagramSnapshot | null = null;
  private errorEl: HTMLElement | null = null;
  private modeButton: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, readonly plugin: VellumPlugin) {
    super(leaf);
    this.mode = plugin.settings.defaultMode;
    this.host = new ViewHost(this, plugin);
    // When the file changes on disk while there are unsaved edits,
    // TextFileView merges the two as lines of text, which can break YAML.
    // Without the merge the version on disk loads, and the frame keeps the
    // edits one undo step away (see `keepHistory`).
    (this as unknown as { isPlaintext: boolean }).isPlaintext = false;
  }

  override getViewType() {
    return VIEW_TYPE;
  }

  override getDisplayText() {
    return this.file ? diagramName(this.file) : 'Vellum';
  }

  override getIcon() {
    return 'vellum-diagram';
  }

  override canAcceptExtension(extension: string) {
    return extension === EXTENSION;
  }

  override async onOpen() {
    this.contentEl.addClass('vellum-view');
    this.modeButton = this.addAction('book-open', 'Read-only mode', () => this.setMode(this.mode === 'edit' ? 'read' : 'edit'));
    this.updateModeButton();
    await this.plugin.ready;
    this.createFrame();
    this.registerEvent(this.plugin.strata.on('changed', (path) => {
      if (!path || path === this.file?.path) this.pushStrata();
    }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.frame?.setTheme(this.plugin.themeName())));
  }

  override async onClose() {
    this.plugin.hover.hide();
    this.frameEl?.remove();
    this.frameEl = null;
    this.frame = null;
  }

  private createFrame() {
    this.frameEl?.remove();
    this.frame = null;
    const frame = this.plugin.resources().createFrame(this.contentEl.doc, this.host, this.file ? diagramName(this.file) : 'Vellum');
    frame.addClass('is-loading');
    this.contentEl.appendChild(frame);
    this.frameEl = frame;
  }

  /** Called by the host once the frame has booted (again). */
  frameReady(api: FrameApi) {
    this.frame = api;
    this.frameEl?.removeClass('is-loading');
    api.setMode(this.mode);
    api.setTheme(this.plugin.themeName());
    this.pushStrata();
    const rescued = this.rescued;
    this.rescued = null;
    if (rescued && this.loadedPath === this.file?.path) {
      // The iframe reloaded with edits not yet saved.
      this.loadedPath = null;
      this.runLoad({ yaml: rescued.yaml, fit: false, keepHistory: false, dirty: rescued.yaml !== this.loadedYaml });
      return;
    }
    if (this.pending) {
      const job = this.pending;
      this.pending = null;
      this.runLoad(job);
    } else if (this.loadedPath && this.data) {
      // Reloaded without a hand-over: start again from the file.
      this.loadedPath = null;
      this.setViewData(this.data, true);
    }
  }

  frameUnloading(snapshot: DiagramSnapshot | null) {
    this.frame = null;
    if (snapshot) this.rescued = snapshot;
  }

  get frameElement(): HTMLIFrameElement | null {
    return this.frameEl;
  }

  // ── File contents ────────────────────────────────────────────────────

  override setViewData(data: string, clear: boolean) {
    const file = this.file;
    if (!file) return;
    let yaml: string | null;
    let sections: IndexSections | undefined;
    if (file.extension === 'md') {
      const parsed = parseMarkdownDiagram(data);
      this.page = { frontmatter: parsed.frontmatter, body: parsed.body };
      yaml = parsed.yaml;
      sections = parsed.sections;
      if (clear) this.applyFileMode(parsed.frontmatter);
    } else {
      yaml = data;
    }
    if (yaml === null || !yaml.trim()) yaml = emptyWorkspaceYaml(diagramName(file));
    // An outside change to the notes or properties alone leaves the diagram
    // and its undo history as they are.
    if (!clear && this.loadedPath === file.path && yaml.trimEnd() === this.loadedYaml?.trimEnd()) {
      // Obsidian may have renamed links in the index sections.
      if (sections) this.frame?.reconcile(sections);
      return;
    }
    this.queueLoad({ yaml, sections, fit: clear, keepHistory: !clear && this.loadedPath === file.path });
  }

  override getViewData(): string {
    const file = this.file;
    if (!file || !this.frame || this.loadedPath !== file.path) return this.data;
    const snapshot = this.frame.snapshot();
    if (!snapshot) return this.data;
    this.lastToken = snapshot.token;
    this.loadedYaml = snapshot.yaml;
    if (file.extension === EXTENSION) return snapshot.yaml;
    return composeMarkdownDiagram(this.page, snapshot, { compress: this.plugin.settings.compressSource });
  }

  override clear() {
    this.loadedPath = null;
    this.loadedYaml = null;
    this.pending = null;
    this.page = { frontmatter: null, body: '' };
    this.showError(null);
  }

  override async save(clear?: boolean) {
    const file = this.file;
    await super.save(clear);
    if (file && this.loadedPath === file.path && this.lastToken) {
      this.frame?.markSaved(this.lastToken);
      void this.plugin.exporter.afterSave(this, file);
    }
  }

  /** Load the file's own workspace back after core replaced it. */
  restore(previousYaml: string) {
    this.loadedPath = null;
    this.runLoad({ yaml: previousYaml, fit: false, keepHistory: false, dirty: previousYaml.trimEnd() !== this.loadedYaml?.trimEnd() });
  }

  private queueLoad(job: LoadJob) {
    if (this.frame) this.runLoad(job);
    else this.pending = job;
  }

  private runLoad(job: LoadJob) {
    const file = this.file;
    if (!file || !this.frame) {
      this.pending = job;
      return;
    }
    const error = this.frame.load(job.yaml, {
      fileName: file.name,
      sections: job.sections,
      fit: job.fit,
      keepHistory: job.keepHistory,
      dirty: job.dirty,
    });
    if (error) {
      this.loadedPath = null;
      this.showError(error);
      return;
    }
    this.showError(null);
    this.loadedPath = file.path;
    this.loadedYaml = job.yaml;
    if (job.dirty) this.requestSave();
    if (this.pendingSubpath) {
      const subpath = this.pendingSubpath;
      this.pendingSubpath = null;
      this.reveal(subpath);
    }
  }

  private showError(message: string | null) {
    this.errorEl?.remove();
    this.errorEl = null;
    if (!message) return;
    const el = this.contentEl.createDiv('vellum-view-error');
    el.createEl('p', { text: 'This file could not be opened as a diagram.' });
    el.createEl('p', { cls: 'vellum-view-error-detail', text: message });
    el.createEl('p', { text: 'The file has not been changed. Fix it in a text editor, or restore an earlier version.' });
    if (this.file?.extension === 'md') {
      el.createEl('button', { text: 'Open as Markdown' }).addEventListener('click', () => void this.plugin.openAsMarkdown(this.leaf));
    }
    this.errorEl = el;
  }

  // ── Modes and state ──────────────────────────────────────────────────

  setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.frame?.setMode(mode);
    this.plugin.hover.hide();
    this.updateModeButton();
    this.app.workspace.requestSaveLayout();
  }

  private applyFileMode(frontmatter: string | null) {
    const m = frontmatter ? new RegExp(`^${MODE_KEY}\\s*:\\s*['"]?(read|edit)['"]?\\s*$`, 'm').exec(frontmatter) : null;
    if (m) this.setMode(m[1] as ViewMode);
  }

  private updateModeButton() {
    if (!this.modeButton) return;
    const reading = this.mode === 'read';
    setIcon(this.modeButton, reading ? 'pencil' : 'book-open');
    this.modeButton.setAttribute('aria-label', reading ? 'Edit diagram' : 'Read-only mode');
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), mode: this.mode };
  }

  override async setState(state: unknown, result: ViewStateResult) {
    const mode = (state as { mode?: unknown } | null)?.mode;
    if (mode === 'read' || mode === 'edit') {
      this.mode = mode;
      this.frame?.setMode(mode);
      this.updateModeButton();
    }
    await super.setState(state, result);
  }

  override setEphemeralState(state: unknown) {
    super.setEphemeralState(state);
    const { subpath, focus } = (state ?? {}) as { subpath?: string; focus?: boolean };
    if (subpath) this.reveal(subpath);
    if (focus) this.focusEditor();
  }

  reveal(subpath: string) {
    const target = subpath.replace(/^#/, '');
    if (!target) return;
    if (!this.frame || this.loadedPath !== this.file?.path) {
      this.pendingSubpath = target;
      return;
    }
    if (!this.frame.reveal(target)) new Notice(`${target.replace(/^\^/, '')} is not in this diagram.`);
  }

  focusEditor() {
    this.frameEl?.contentWindow?.focus();
  }

  pushStrata() {
    if (!this.frame || !this.file) return;
    this.frame.setStrata(this.plugin.strata.forDiagram(this.file.path).map(({ diagramPath: _, ...info }) => info));
  }

  // ── Menus ────────────────────────────────────────────────────────────

  override onPaneMenu(menu: Menu, source: string) {
    const file = this.file;
    if (file) {
      menu.addItem((item) => item
        .setSection('pane')
        .setTitle(this.mode === 'edit' ? 'Read-only mode' : 'Edit diagram')
        .setIcon(this.mode === 'edit' ? 'book-open' : 'pencil')
        .onClick(() => this.setMode(this.mode === 'edit' ? 'read' : 'edit')));
      menu.addItem((item) => item
        .setSection('pane')
        .setTitle('Show strata')
        .setIcon('layers')
        .onClick(() => this.frame?.togglePanel()));
      if (file.extension === 'md') {
        menu.addItem((item) => item
          .setSection('pane')
          .setTitle('Open as Markdown')
          .setIcon('file-text')
          .onClick(() => void this.plugin.openAsMarkdown(this.leaf)));
      }
      menu.addItem((item) => item
        .setSection('action')
        .setTitle('Export as SVG')
        .setIcon('image-file')
        .onClick(() => void this.plugin.exporter.exportFile(this, 'svg')));
      menu.addItem((item) => item
        .setSection('action')
        .setTitle('Export as PNG')
        .setIcon('image-file')
        .onClick(() => void this.plugin.exporter.exportFile(this, 'png')));
      menu.addItem((item) => item
        .setSection('action')
        .setTitle('Copy embed link')
        .setIcon('link')
        .onClick(() => void this.plugin.copyEmbedLink(file)));
    }
    super.onPaneMenu(menu, source);
  }

  /** The file this view edits, for the host. */
  get diagramFile(): TFile | null {
    return this.file;
  }
}
