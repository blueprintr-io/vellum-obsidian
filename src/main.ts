import {
  addIcon,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  type PaneType,
  type ViewState,
} from 'obsidian';
import { coreTag, fonts, script, style } from 'virtual:vellum-frame';
import type { InsertAction, StoredRecord, StoredSlice, ThemeName } from '../shared/protocol';
import { linkLabel, linkText, parseLink } from '../shared/links';
import { FrameResources } from './frame-resources';
import { createDiagram, diagramName, EXTENSION, isDiagram, isMarkdownDiagram, sourceOf, VIEW_TYPE } from './files';
import { registerEmbeds } from './embed/register';
import { EmbedRenderer } from './embed/renderer';
import { Exporter } from './export';
import { HOVER_SOURCE, HoverController } from './hover';
import { LinkMaintainer } from './links';
import { mimeFor } from './host';
import { NotePicker, pickFile, pickLink, SaveTargetModal } from './modals';
import { registerCommands } from './commands';
import { DEFAULT_SETTINGS, sanitizeSettings, type VellumSettings } from './settings';
import { VellumSettingTab } from './settings-tab';
import { StrataActions } from './strata/actions';
import { StrataIndex } from './strata/index';
import { retargetStratum } from './strata/notes';
import { VellumView } from './view';
import { createApi, type VellumApi } from './api';
import { RecordStore } from './records';

const ICON = '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="14" width="38" height="30" rx="5"/><rect x="52" y="56" width="38" height="30" rx="5"/><path d="M29 44v27h23"/></g>';
const LIBRARY_FILE = 'library.json';
const SAVE_DELAY_MS = 1000;

interface StoredData {
  settings?: unknown;
  /** The plugin version that last ran, to say when it was updated. */
  version?: string;
  preferences?: StoredSlice<Record<string, unknown>> | null;
  /** Leaves (by id) where a Markdown diagram was opened as Markdown. */
  markdownLeaves?: Record<string, string>;
}

export default class VellumPlugin extends Plugin {
  override settings: VellumSettings = DEFAULT_SETTINGS;
  preferences: StoredSlice<Record<string, unknown>> | null = null;
  library: StoredSlice<unknown[]> | null = null;
  strata!: StrataIndex;
  strataActions!: StrataActions;
  hover!: HoverController;
  renderer!: EmbedRenderer;
  exporter!: Exporter;
  links!: LinkMaintainer;
  api!: VellumApi;
  ready!: Promise<void>;

  private frameResources: FrameResources | null = null;
  private markdownLeaves: Record<string, string> = {};
  private undo: (() => void)[] = [];
  private saveTimer: number | undefined;
  private libraryTimer: number | undefined;
  /** Installed libraries and added icon packs, as core last wrote them. */
  private records!: RecordStore;

  override async onload() {
    this.strata = new StrataIndex(this.app);
    this.hover = new HoverController(this.app, this.strata, () => this.settings);
    this.strataActions = new StrataActions(this.app, this.strata, () => this.settings);
    this.renderer = new EmbedRenderer(this);
    this.exporter = new Exporter(this);
    this.links = new LinkMaintainer(this);
    this.api = createApi(this);
    // Ready before state loads: the embed renderer may boot first, and reads
    // nothing until load() fills it.
    this.records = new RecordStore(this.app.vault.adapter, this.manifest.dir ?? '', SAVE_DELAY_MS, (key, error) => {
      console.error(`[vellum] could not save ${key}`, error);
      new Notice(`Vellum could not save ${key === 'vellum.libraries' ? 'your installed libraries' : 'your added icon packs'}.`);
    });

    addIcon('vellum-diagram', ICON);
    this.registerView(VIEW_TYPE, (leaf) => new VellumView(leaf, this));
    this.registerExtensions([EXTENSION], VIEW_TYPE);
    this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Vellum', defaultMod: true });
    this.ready = this.loadState();

    this.undo.push(this.patchLeaves());
    this.undo.push(registerEmbeds(this));
    registerCommands(this);
    this.addRibbonIcon('vellum-diagram', 'New diagram', (e) => void this.newDiagram(e.ctrlKey || e.metaKey ? 'split' : 'tab'));
    this.addSettingTab(new VellumSettingTab(this.app, this));
    this.registerEvents();

    this.app.workspace.onLayoutReady(async () => {
      await this.ready;
      this.strata.build();
      this.openDiagramLeaves();
      // Files whose properties the cache had not read yet at startup.
      const ref = this.app.metadataCache.on('resolved', () => {
        this.app.metadataCache.offref(ref);
        this.openDiagramLeaves();
      });
      this.registerEvent(ref);
    });
  }

  override onunload() {
    void this.records.flush();
    for (const fn of this.undo) fn();
    this.hover.unload();
    this.strataActions.windows.closeAll();
    this.renderer.dispose();
    // Markdown diagrams go back to Obsidian's editor so their tabs survive.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view as VellumView;
      if (view.file?.extension === 'md') void leaf.setViewState({ type: 'markdown', state: { file: view.file.path } });
    }
    this.frameResources?.dispose();
  }

  // ── Stored state ─────────────────────────────────────────────────────

  private async loadState() {
    const data = ((await this.loadData()) ?? {}) as StoredData;
    this.settings = sanitizeSettings(data.settings);
    const prefs = data.preferences;
    this.preferences = prefs && typeof prefs === 'object' && prefs.state && typeof prefs.state === 'object' ? prefs : null;
    this.markdownLeaves = data.markdownLeaves && typeof data.markdownLeaves === 'object' ? { ...data.markdownLeaves } : {};
    this.library = await this.loadLibrary();
    await this.records.load();
    if (data.version !== this.manifest.version) {
      if (data.version) this.announceUpdate();
      await this.persist();
    }
  }

  private announceUpdate() {
    const { version } = this.manifest;
    new Notice(createFragment((f) => {
      f.appendText(`Vellum was updated to ${version}, with Vellum ${coreTag}. `);
      f.createEl('a', { text: 'What changed', href: `https://github.com/blueprintr-io/vellum-obsidian/releases/tag/${version}` });
    }), 10000);
  }

  private libraryPath() {
    return normalizePath(`${this.manifest.dir}/${LIBRARY_FILE}`);
  }

  private async loadLibrary(): Promise<StoredSlice<unknown[]> | null> {
    try {
      const path = this.libraryPath();
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as StoredSlice<unknown[]>;
      return Array.isArray(parsed?.state) ? parsed : null;
    } catch (error) {
      console.error('[vellum] could not read the personal library', error);
      return null;
    }
  }

  readRecord(key: StoredRecord): unknown {
    return this.records.read(key);
  }

  saveRecord(key: StoredRecord, value: unknown) {
    this.records.save(key, value);
  }

  async saveSettings() {
    await this.persist();
    for (const view of this.views()) view.frame?.setTheme(this.themeName());
  }

  private persist() {
    window.clearTimeout(this.saveTimer);
    const data: StoredData = { settings: this.settings, version: this.manifest.version, preferences: this.preferences, markdownLeaves: this.markdownLeaves };
    return this.saveData(data);
  }

  private persistSoon() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(), SAVE_DELAY_MS);
  }

  /** Editor preferences for a new frame. */
  preferencesFor(): StoredSlice<Record<string, unknown>> | null {
    return this.preferences;
  }

  savePreferences(slice: StoredSlice<Record<string, unknown>>, from: VellumView | null) {
    const state = { ...slice.state };
    // The plugin decides the theme while it follows Obsidian's.
    if (this.settings.theme === 'obsidian') delete state.theme;
    const next = { state, version: slice.version };
    if (JSON.stringify(next) === JSON.stringify(this.preferences)) return;
    this.preferences = next;
    this.persistSoon();
    for (const view of this.views()) if (view !== from) view.frame?.setPreferences(state);
  }

  saveLibrary(slice: StoredSlice<unknown[]>, from: VellumView | null) {
    if (JSON.stringify(slice) === JSON.stringify(this.library)) return;
    this.library = { state: slice.state, version: slice.version };
    window.clearTimeout(this.libraryTimer);
    this.libraryTimer = window.setTimeout(() => {
      void this.app.vault.adapter.write(this.libraryPath(), JSON.stringify(this.library)).catch((error: unknown) => {
        console.error('[vellum] could not save the personal library', error);
        new Notice('Vellum could not save your personal library.');
      });
    }, SAVE_DELAY_MS);
    for (const view of this.views()) if (view !== from) view.frame?.setLibrary(slice.state);
  }

  resources(): FrameResources {
    this.frameResources ??= new FrameResources({ script, style, fonts });
    return this.frameResources;
  }

  obsidianTheme(): ThemeName {
    return document.body.hasClass('theme-dark') ? 'dark' : 'light';
  }

  themeName(): ThemeName {
    return this.settings.theme === 'obsidian' ? this.obsidianTheme() : this.settings.theme;
  }

  views(): VellumView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((leaf) => leaf.view).filter((v): v is VellumView => v instanceof VellumView);
  }

  // ── Markdown diagrams open as diagrams ───────────────────────────────

  /** Obsidian opens `.md` files in its Markdown view. Diagrams are swapped
   *  to this plugin's view on the way in, unless the user chose to read
   *  this one as Markdown in this tab. */
  private patchLeaves(): () => void {
    const asDiagram = (leaf: WorkspaceLeaf, state: ViewState): ViewState => {
      const path = state?.type === 'markdown' ? (state.state as { file?: unknown } | undefined)?.file : undefined;
      if (typeof path !== 'string' || this.markdownLeaves[leafId(leaf)] === path) return state;
      const file = this.app.vault.getFileByPath(path);
      return file && isMarkdownDiagram(this.app, file) ? { ...state, type: VIEW_TYPE } : state;
    };
    return around(WorkspaceLeaf.prototype, 'setViewState', (next) => function (this: WorkspaceLeaf, state: ViewState, eState?: unknown) {
      return next.call(this, asDiagram(this, state), eState);
    });
  }

  private openDiagramLeaves() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred || !(leaf.view instanceof MarkdownView)) return;
      const file = leaf.view.file;
      if (file && isMarkdownDiagram(this.app, file) && this.markdownLeaves[leafId(leaf)] !== file.path) {
        void leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: false });
      }
    });
  }

  async openAsMarkdown(leaf: WorkspaceLeaf) {
    const file = (leaf.view as VellumView).file;
    if (!file || file.extension !== 'md') return;
    await (leaf.view as VellumView).save();
    this.markdownLeaves[leafId(leaf)] = file.path;
    this.persistSoon();
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true });
  }

  async openAsDiagram(leaf: WorkspaceLeaf) {
    const file = (leaf.view as MarkdownView).file;
    if (!file) return;
    delete this.markdownLeaves[leafId(leaf)];
    this.persistSoon();
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
  }

  // ── Creating and opening ─────────────────────────────────────────────

  async newDiagram(where: PaneType | 'current', options: { folder?: TFolder | null; embedIn?: MarkdownView } = {}) {
    try {
      const folder = options.folder?.path ?? (options.embedIn?.file?.parent && this.settings.folderBesideActiveNote ? options.embedIn.file.parent.path : undefined);
      const file = await createDiagram(this.app, this.settings, { folder });
      if (options.embedIn) {
        const link = this.app.fileManager.generateMarkdownLink(file, options.embedIn.file?.path ?? '');
        options.embedIn.editor.replaceSelection(`!${link.startsWith('!') ? link.slice(1) : link}`);
      }
      const leaf = where === 'current' ? this.app.workspace.getLeaf(false) : this.app.workspace.getLeaf(where === 'window' && Platform.isMobile ? 'tab' : where);
      await leaf.openFile(file, { active: true, state: { mode: 'edit' } });
      return file;
    } catch (error) {
      new Notice(`Could not create the diagram: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** Core replaced the open workspace (New, Open, an import). The file is
   *  never overwritten: an opened vault diagram opens in a tab of its own,
   *  anything else becomes a new diagram file. */
  async diagramReplaced(view: VellumView, yaml: string, suggestedName: string | null, picked: TFile | null) {
    try {
      let file: TFile | null = picked && isDiagram(this.app, picked) ? picked : null;
      if (!file) {
        const name = suggestedName?.replace(/\.(vellum|ya?ml|drawio|xml|excalidraw|png|svg)$/i, '').replace(/\.vellum$/i, '');
        file = await createDiagram(this.app, this.settings, { folder: view.file?.parent?.path, name: name || undefined, yaml });
      }
      await this.app.workspace.getLeaf('tab').openFile(file, { active: true });
    } catch (error) {
      new Notice(`Could not open that as a new diagram: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Links ────────────────────────────────────────────────────────────

  openLink(link: string, sourcePath: string, newLeaf: boolean) {
    const parsed = parseLink(link);
    if (!parsed) return;
    if (parsed.type === 'url') {
      window.open(parsed.url, '_blank');
      return;
    }
    void this.app.workspace.openLinkText(linkText(parsed)!, sourcePath, newLeaf);
  }

  editShapeLink(view: VellumView, file: TFile, shapeId: string, current: string | null) {
    void pickLink(this.app, file.path, current).then((link) => {
      if (link !== null) view.frame?.setShapeLink(shapeId, link);
    });
  }

  async copyShapeLink(view: VellumView, file: TFile, shapeId: string, tabId: string) {
    const block = view.frame?.blockId(shapeId, tabId);
    if (!block) return;
    const linktext = this.app.metadataCache.fileToLinktext(file, '', true);
    await navigator.clipboard.writeText(`[[${linktext}#^${block}]]`);
    new Notice('Copied a link to the shape.');
  }

  async copyEmbedLink(file: TFile) {
    const linktext = this.app.metadataCache.fileToLinktext(file, '', true);
    await navigator.clipboard.writeText(`![[${linktext}]]`);
    new Notice('Copied the embed link.');
  }

  // ── Vault content into diagrams ──────────────────────────────────────

  async insertFromVault(view: VellumView, action: InsertAction, at: { x: number; y: number } | null) {
    const file = view.file;
    if (!file || !view.frame) return;
    const frame = view.frame;
    try {
      if (action === 'image') {
        const images = this.app.vault.getFiles().filter((f) => /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension));
        const image = await pickFile(this.app, images, 'Insert an image');
        if (image) await frame.insertImage(image.name, mimeFor(image.extension), await this.app.vault.readBinary(image), at);
      } else if (action === 'note-link') {
        const notes = this.app.vault.getMarkdownFiles().filter((f) => !isDiagram(this.app, f));
        new NotePicker(this.app, notes, 'Insert a link to a note', (note) => {
          const link = `[[${this.app.metadataCache.fileToLinktext(note, file.path, true)}]]`;
          frame.insertLinkShape(linkLabel(parseLink(link)!), link, at);
        }).open();
      } else {
        const diagrams = this.app.vault.getFiles().filter((f) => f !== file && isDiagram(this.app, f));
        const diagram = await pickFile(this.app, diagrams, 'Insert a diagram');
        if (!diagram) return;
        const rendered = await this.renderer.render(diagram, { format: 'svg', theme: this.themeName() });
        const link = `[[${this.app.metadataCache.fileToLinktext(diagram, file.path, true)}]]`;
        await frame.insertImage(`${diagramName(diagram)}.svg`, 'image/svg+xml', new TextEncoder().encode(rendered.data).buffer, at, link);
      }
    } catch (error) {
      new Notice(`Could not insert that: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Files being dragged from Obsidian's file explorer, search or a link,
   *  read from Obsidian's drag manager (not part of the published API). */
  draggedFiles(): TFile[] | null {
    const draggable = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: unknown; files?: unknown[] } | null } }).dragManager?.draggable;
    if (!draggable) return null;
    const files = draggable.type === 'files' ? draggable.files ?? [] : [draggable.file];
    const found = files.filter((f): f is TFile => f instanceof TFile);
    return found.length ? found : null;
  }

  /** Images become image shapes, diagrams become linked pictures of
   *  themselves, anything else a box linking to the file. */
  async dropFiles(view: VellumView, at: { x: number; y: number }) {
    const files = this.draggedFiles();
    const source = view.file;
    if (!files || !source || !view.frame) return;
    const frame = view.frame;
    let offset = 0;
    for (const file of files) {
      const point = { x: at.x + offset, y: at.y + offset };
      offset += 24;
      const link = `[[${this.app.metadataCache.fileToLinktext(file, source.path, true)}]]`;
      try {
        if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.extension)) {
          await frame.insertImage(file.name, mimeFor(file.extension), await this.app.vault.readBinary(file), point);
        } else if (isDiagram(this.app, file) && file !== source) {
          const rendered = await this.renderer.render(file, { format: 'svg', theme: this.themeName() });
          await frame.insertImage(`${diagramName(file)}.svg`, 'image/svg+xml', new TextEncoder().encode(rendered.data).buffer, point, link);
        } else {
          frame.insertLinkShape(file.extension === 'md' ? file.basename : file.name, link, point);
        }
      } catch (error) {
        new Notice(`Could not add ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  pickVaultFile(extensions: string[], placeholder: string): Promise<TFile | null> {
    const wanted = new Set(extensions.map((e) => e.replace(/^\./, '').toLowerCase()));
    const files = this.app.vault.getFiles().filter((f) => {
      if (!wanted.size) return true;
      if (wanted.has(f.extension.toLowerCase())) return true;
      return wanted.has(EXTENSION) && isMarkdownDiagram(this.app, f);
    });
    return pickFile(this.app, files, placeholder);
  }

  chooseSaveTarget(suggestedName: string, near: TFile | null): Promise<string | null> {
    return new Promise((resolve) => new SaveTargetModal(this.app, suggestedName, near?.parent?.path ?? '', resolve).open());
  }

  async writeBinary(path: string, data: ArrayBuffer) {
    const normalized = normalizePath(path);
    const folder = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const existing = this.app.vault.getFileByPath(normalized);
    if (existing) await this.app.vault.modifyBinary(existing, data);
    else await this.app.vault.createBinary(normalized, data);
  }

  /** Diagram YAML for a file, open or not. */
  async readSource(file: TFile): Promise<string | null> {
    const open = this.views().find((v) => v.file === file);
    const snapshot = open?.frame?.snapshot();
    if (snapshot) return snapshot.yaml;
    return sourceOf(file, await this.app.vault.read(file));
  }

  // ── Vault events ─────────────────────────────────────────────────────

  private registerEvents() {
    this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => this.strata.update(file, cache)));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.strata.remove(file.path);
      this.renderer.invalidate(file.path);
      if (file instanceof TFile && this.settings.autoExport !== 'none' && (file.extension === EXTENSION || file.path.endsWith('.vellum.md'))) {
        void this.exporter.deleted(file.path);
      }
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => this.renderer.invalidate(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.renderer.invalidate(oldPath);
      if (!(file instanceof TFile)) return;
      const strata = this.strata.pointingAt(oldPath);
      this.strata.rename(file, oldPath);
      this.links.renamed(file, oldPath);
      for (const id of Object.keys(this.markdownLeaves)) if (this.markdownLeaves[id] === oldPath) this.markdownLeaves[id] = file.path;
      if (isDiagram(this.app, file)) void this.diagramMoved(file, oldPath, strata.map((s) => s.path));
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => item.setSection('action-primary').setTitle('New diagram').setIcon('vellum-diagram')
          .onClick(() => void this.newDiagram('tab', { folder: file })));
        return;
      }
      if (!(file instanceof TFile)) return;
      if (leaf?.view instanceof MarkdownView && leaf.view.file === file && isMarkdownDiagram(this.app, file)) {
        menu.addItem((item) => item.setSection('pane').setTitle('Open as diagram').setIcon('vellum-diagram')
          .onClick(() => void this.openAsDiagram(leaf)));
      }
      if (isDiagram(this.app, file)) {
        menu.addItem((item) => item.setSection('action').setTitle('Copy embed link').setIcon('link')
          .onClick(() => void this.copyEmbedLink(file)));
      }
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, _editor, info) => {
      if (!(info instanceof MarkdownView) || isDiagram(this.app, info.file)) return;
      menu.addItem((item) => item.setSection('insert').setTitle('Insert new diagram').setIcon('vellum-diagram')
        .onClick(() => void this.newDiagram('split', { embedIn: info })));
    }));
    this.registerEvent(this.app.workspace.on('quit', (tasks) => {
      tasks.add(async () => {
        await Promise.all([...this.views().map((view) => view.save().catch(() => {})), this.records.flush()]);
      });
    }));
  }

  /** A diagram was renamed or moved: keep its strata pointing at it, and
   *  beside it when it moved to another folder. */
  private async diagramMoved(file: TFile, oldPath: string, strataPaths: string[]) {
    void this.exporter.renamed(file, oldPath);
    const oldFolder = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
    const newFolder = file.parent?.path === '/' ? '' : (file.parent?.path ?? '');
    // Let Obsidian finish its own link updates first.
    await sleep(1500);
    for (const path of strataPaths) {
      let note = this.app.vault.getFileByPath(path);
      if (!note) continue;
      try {
        if (this.settings.strataFollowDiagram && oldFolder !== newFolder && (note.parent?.path ?? '') === (oldFolder || '/')) {
          const target = normalizePath(newFolder ? `${newFolder}/${note.name}` : note.name);
          if (!this.app.vault.getAbstractFileByPath(target)) {
            await this.app.fileManager.renameFile(note, target);
            note = this.app.vault.getFileByPath(target) ?? note;
          }
        }
        await retargetStratum(this.app, note, file);
      } catch (error) {
        console.error(`[vellum] could not update the stratum ${path}`, error);
      }
    }
  }
}

/** Replace a method, returning a function that puts it back (unless
 *  something else replaced it in the meantime). */
function around<T extends object, K extends keyof T>(target: T, key: K, wrap: (next: T[K]) => T[K]): () => void {
  const original = target[key];
  const patched = wrap(original);
  target[key] = patched;
  return () => {
    if (target[key] === patched) target[key] = original;
  };
}

function leafId(leaf: WorkspaceLeaf): string {
  return (leaf as unknown as { id?: string }).id ?? '';
}
