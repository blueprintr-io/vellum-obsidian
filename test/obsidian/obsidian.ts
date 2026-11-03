// A working stand-in for the parts of Obsidian's API the plugin uses, for
// tests that cannot run Obsidian itself. The vault lives in memory, the
// metadata cache reads frontmatter and frontmatter links, and TextFileView
// follows Obsidian's own save and reload logic. It is deliberately small:
// anything the plugin does not call is missing.

import YAML from 'yaml';

type Callback = (...args: any[]) => unknown;
export interface EventRef { name: string; callback: Callback; owner: Events }

export class Events {
  private handlers = new Map<string, Set<Callback>>();
  on(name: string, callback: Callback): EventRef {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(callback);
    return { name, callback, owner: this };
  }
  off(name: string, callback: Callback) {
    this.handlers.get(name)?.delete(callback);
  }
  offref(ref: EventRef) {
    ref.owner.off(ref.name, ref.callback);
  }
  trigger(name: string, ...args: unknown[]) {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(...args);
  }
}

export class Component {
  _loaded = false;
  private children: Component[] = [];
  private cleanups: (() => void)[] = [];
  load() {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const child of this.children) child.load();
  }
  onload() {}
  unload() {
    if (!this._loaded) return;
    this._loaded = false;
    for (const child of this.children.splice(0)) child.unload();
    for (const fn of this.cleanups.splice(0)) fn();
    this.onunload();
  }
  onunload() {}
  addChild<T extends Component>(child: T): T {
    this.children.push(child);
    if (this._loaded) child.load();
    return child;
  }
  register(fn: () => void) {
    this.cleanups.push(fn);
  }
  registerEvent(ref: EventRef) {
    this.register(() => ref.owner.offref(ref));
  }
  registerDomEvent(el: EventTarget, type: string, callback: (e: any) => unknown, options?: boolean | AddEventListenerOptions) {
    el.addEventListener(type, callback as EventListener, options);
    this.register(() => el.removeEventListener(type, callback as EventListener, options));
  }
  registerInterval(id: number) {
    this.register(() => clearInterval(id));
    return id;
  }
}

export function normalizePath(path: string): string {
  const out = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return out === '' ? '/' : out;
}

export function getLinkpath(linktext: string): string {
  const at = linktext.search(/[#^]/);
  return at < 0 ? linktext : linktext.slice(0, at);
}

export abstract class TAbstractFile {
  vault!: Vault;
  path = '';
  name = '';
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  stat = { ctime: 0, mtime: 0, size: 0 };
  basename = '';
  extension = '';
  deleted = false;
  saving = false;
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === '/';
  }
}

function splitName(path: string) {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return { name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '' };
}

let clock = 1_000;

export class Vault extends Events {
  private files = new Map<string, TAbstractFile>();
  private contents = new Map<string, string | ArrayBuffer>();
  readonly root: TFolder;
  private config: Record<string, unknown> = { alwaysUpdateLinks: true };
  adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, d: string): Promise<void> };

  constructor() {
    super();
    this.root = new TFolder();
    this.root.path = '/';
    this.root.vault = this;
    this.files.set('/', this.root);
    const raw = new Map<string, string>();
    this.adapter = {
      exists: async (p) => raw.has(p),
      read: async (p) => {
        if (!raw.has(p)) throw new Error(`ENOENT ${p}`);
        return raw.get(p)!;
      },
      write: async (p, d) => {
        raw.set(p, d);
      },
    };
  }

  getConfig(key: string) {
    return this.config[key];
  }
  setConfig(key: string, value: unknown) {
    this.config[key] = value;
  }

  private folderFor(path: string): TFolder {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
    const existing = this.files.get(parentPath);
    if (existing instanceof TFolder) return existing;
    const folder = new TFolder();
    folder.vault = this;
    folder.path = parentPath;
    folder.name = parentPath.split('/').pop()!;
    folder.parent = this.folderFor(parentPath);
    folder.parent.children.push(folder);
    this.files.set(parentPath, folder);
    return folder;
  }

  private add(path: string, data: string | ArrayBuffer): TFile {
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) throw new Error(`File already exists: ${normalized}`);
    const file = new TFile();
    file.vault = this;
    file.path = normalized;
    Object.assign(file, splitName(normalized));
    file.parent = this.folderFor(normalized);
    file.parent.children.push(file);
    file.stat = { ctime: clock, mtime: clock++, size: typeof data === 'string' ? data.length : data.byteLength };
    this.files.set(normalized, file);
    this.contents.set(normalized, data);
    return file;
  }

  async create(path: string, data: string) {
    const file = this.add(path, data);
    this.trigger('create', file);
    return file;
  }
  async createBinary(path: string, data: ArrayBuffer) {
    const file = this.add(path, data);
    this.trigger('create', file);
    return file;
  }
  async createFolder(path: string) {
    const folder = this.folderFor(`${normalizePath(path)}/x`);
    return folder;
  }
  async read(file: TFile) {
    const data = this.contents.get(file.path);
    if (typeof data !== 'string') throw new Error(`Not a text file: ${file.path}`);
    return data;
  }
  cachedRead(file: TFile) {
    return this.read(file);
  }
  async readBinary(file: TFile) {
    const data = this.contents.get(file.path);
    return typeof data === 'string' ? (new TextEncoder().encode(data).buffer as ArrayBuffer) : data!;
  }
  async modify(file: TFile, data: string) {
    this.contents.set(file.path, data);
    file.stat = { ...file.stat, mtime: clock++, size: data.length };
    this.trigger('modify', file);
  }
  async modifyBinary(file: TFile, data: ArrayBuffer) {
    this.contents.set(file.path, data);
    file.stat = { ...file.stat, mtime: clock++, size: data.byteLength };
    this.trigger('modify', file);
  }
  async process(file: TFile, fn: (data: string) => string) {
    const next = fn(await this.read(file));
    await this.modify(file, next);
    return next;
  }
  async rename(file: TAbstractFile, newPath: string) {
    const normalized = normalizePath(newPath);
    const oldPath = file.path;
    const data = this.contents.get(oldPath);
    this.files.delete(oldPath);
    this.contents.delete(oldPath);
    if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
    file.path = normalized;
    if (file instanceof TFile) Object.assign(file, splitName(normalized));
    else file.name = normalized.split('/').pop()!;
    file.parent = this.folderFor(normalized);
    file.parent.children.push(file);
    this.files.set(normalized, file);
    if (data !== undefined) this.contents.set(normalized, data);
    this.trigger('rename', file, oldPath);
  }
  async delete(file: TAbstractFile) {
    this.files.delete(file.path);
    this.contents.delete(file.path);
    if (file instanceof TFile) file.deleted = true;
    this.trigger('delete', file);
  }
  getAbstractFileByPath(path: string) {
    return this.files.get(normalizePath(path)) ?? null;
  }
  getFileByPath(path: string) {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }
  getFiles() {
    return [...this.files.values()].filter((f): f is TFile => f instanceof TFile);
  }
  getMarkdownFiles() {
    return this.getFiles().filter((f) => f.extension === 'md');
  }
  getAllLoadedFiles() {
    return [...this.files.values()];
  }
  getResourcePath(file: TFile) {
    return `app://local/${file.path}`;
  }
  /** Test helper: the text of a file. */
  text(path: string) {
    const data = this.contents.get(normalizePath(path));
    return typeof data === 'string' ? data : null;
  }
}

export interface FrontmatterLinkCache { key: string; link: string; original: string; displayText?: string }
export interface CachedMetadata {
  frontmatter?: Record<string, unknown>;
  frontmatterLinks?: FrontmatterLinkCache[];
  headings?: { heading: string; level: number }[];
}

export class MetadataCache extends Events {
  private cache = new Map<string, CachedMetadata>();
  private pending = new Set<Promise<void>>();
  constructor(private readonly vault: Vault) {
    super();
    const refresh = (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const job = this.index(file).catch(() => {}).finally(() => this.pending.delete(job));
      this.pending.add(job);
    };
    vault.on('create', refresh);
    vault.on('modify', refresh);
    vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      this.cache.delete(oldPath);
      refresh(file);
    });
    vault.on('delete', (file: TAbstractFile) => this.cache.delete(file.path));
  }

  /** Read a note's metadata now (Obsidian does this in a worker). */
  async index(file: TFile) {
    if (file.extension !== 'md') return;
    const text = await this.vault.read(file);
    const meta: CachedMetadata = {};
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm) {
      try {
        const data = YAML.parse(fm[1]) ?? {};
        meta.frontmatter = data;
        meta.frontmatterLinks = Object.entries(data).flatMap(([key, value]) => {
          const m = typeof value === 'string' ? /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(value) : null;
          return m ? [{ key, link: m[1], original: value as string, displayText: m[2] ?? m[1] }] : [];
        });
      } catch {
        meta.frontmatter = undefined;
      }
    }
    meta.headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ heading: m[2].trim(), level: m[1].length }));
    this.cache.set(file.path, meta);
    this.trigger('changed', file, text, meta);
  }

  getFileCache(file: TFile) {
    return this.cache.get(file.path) ?? null;
  }

  /** Test helper: wait for queued indexing to finish. */
  async settled() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  getFirstLinkpathDest(linkpath: string, _source: string): TFile | null {
    const target = linkpath.trim();
    if (!target) return null;
    const files = this.vault.getFiles();
    const lower = target.toLowerCase();
    return files.find((f) => f.path.toLowerCase() === lower)
      ?? files.find((f) => f.path.toLowerCase() === `${lower}.md`)
      ?? files.find((f) => f.name.toLowerCase() === lower)
      ?? files.find((f) => f.extension === 'md' && f.basename.toLowerCase() === lower)
      ?? null;
  }

  fileToLinktext(file: TFile, _source: string, omitMdExtension = true) {
    const name = omitMdExtension && file.extension === 'md' ? file.basename : file.name;
    const clash = this.vault.getFiles().filter((f) => (omitMdExtension && f.extension === 'md' ? f.basename : f.name) === name);
    const full = omitMdExtension && file.extension === 'md' ? file.path.replace(/\.md$/, '') : file.path;
    return clash.length > 1 ? full : name;
  }
}

export class FileManager {
  constructor(private readonly app: App) {}
  async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void) {
    const text = await this.app.vault.read(file);
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const data = (m ? YAML.parse(m[1]) : null) ?? {};
    fn(data);
    const yaml = Object.keys(data).length ? `---\n${YAML.stringify(data)}---\n` : '';
    await this.app.vault.modify(file, yaml + (m ? text.slice(m[0].length) : text));
    await this.app.metadataCache.index(file);
  }
  async renameFile(file: TAbstractFile, newPath: string) {
    await this.app.vault.rename(file, newPath);
  }
  async trashFile(file: TAbstractFile) {
    await this.app.vault.delete(file);
  }
  generateMarkdownLink(file: TFile, source: string) {
    return `[[${this.app.metadataCache.fileToLinktext(file, source, true)}]]`;
  }
  getNewFileParent() {
    return this.app.vault.root;
  }
}

type ViewCreator = (leaf: WorkspaceLeaf) => any;
const viewCreators = new Map<string, ViewCreator>();
const viewsByExtension = new Map<string, string>();

export class WorkspaceLeaf {
  view: any = null;
  id = `leaf-${Math.random().toString(36).slice(2, 8)}`;
  isDeferred = false;
  app!: App;
  /** Test hook: where views of this leaf are attached. */
  host: HTMLElement | null = null;
  async setViewState(state: { type: string; state?: Record<string, unknown> }, eState?: unknown) {
    const create = viewCreators.get(state.type);
    if (!create) return;
    if (this.view && this.view.getViewType?.() !== state.type) {
      await this.view.onUnloadFile?.(this.view.file);
      await this.view.onClose?.();
      this.view.unload();
      this.view.containerEl.remove?.();
      this.view = null;
    }
    if (!this.view) {
      this.view = create(this);
      this.host?.appendChild(this.view.containerEl);
      this.view.load();
      await this.view.onOpen?.();
    }
    if (state.state) await this.view.setState(state.state, {});
    const path = state.state?.file;
    if (typeof path === 'string') {
      const file = this.app.vault.getFileByPath(path);
      if (file && this.view.loadFile) {
        if (this.view.file && this.view.file !== file) await this.view.onUnloadFile?.(this.view.file);
        await this.view.loadFile(file);
      }
    }
    if (eState) this.view.setEphemeralState?.(eState);
  }
  async openFile(file: TFile, options?: { state?: Record<string, unknown>; eState?: unknown }) {
    const type = viewsByExtension.get(file.extension) ?? 'markdown';
    await this.setViewState({ type, state: { ...options?.state, file: file.path } }, options?.eState);
  }
  getViewState() {
    return { type: this.view?.getViewType?.() ?? 'empty', state: { file: this.view?.file?.path } };
  }
}

export class Workspace extends Events {
  leaves: WorkspaceLeaf[] = [];
  layoutReady = true;
  onLayoutReady(fn: () => void) {
    fn();
  }
  getLeavesOfType(type: string) {
    return this.leaves.filter((l) => l.view?.getViewType?.() === type);
  }
  iterateAllLeaves(fn: (leaf: WorkspaceLeaf) => void) {
    this.leaves.forEach(fn);
  }
  app!: App;
  /** Test hook: hover-link requests made through `trigger`. */
  hoverLinks: unknown[] = [];
  opened: unknown[][] = [];
  getLeaf(_where?: unknown, _direction?: unknown) {
    const leaf = new WorkspaceLeaf();
    leaf.app = this.app;
    this.leaves.push(leaf);
    return leaf;
  }
  override trigger(name: string, ...args: unknown[]) {
    if (name === 'hover-link') this.hoverLinks.push(args[0]);
    super.trigger(name, ...args);
  }
  getActiveFile() {
    return null;
  }
  getActiveViewOfType(type?: new (...args: any[]) => unknown) {
    return this.leaves.map((l) => l.view).find((v) => type && v instanceof type) ?? null;
  }
  setActiveLeaf() {}
  requestSaveLayout() {}
  openLinkText = async (...args: unknown[]) => {
    this.opened.push(args);
  };
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache(this.vault);
  fileManager = new FileManager(this);
  workspace = new Workspace();
  constructor() {
    this.workspace.app = this;
  }
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string | DocumentFragment) {
    Notice.messages.push(typeof message === 'string' ? message : message.textContent ?? '');
  }
  hide() {}
}

export class View extends Component {
  app: App;
  containerEl: HTMLElement;
  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = (leaf as unknown as { app: App }).app;
    this.containerEl = (globalThis.document?.createElement('div') ?? ({} as HTMLElement));
    if (this.containerEl.style) {
      this.containerEl.style.position = 'relative';
      this.containerEl.style.width = '100%';
      this.containerEl.style.height = '100%';
    }
  }
  getState(): Record<string, unknown> {
    return {};
  }
  async setState(_state: unknown, _result: unknown) {}
  setEphemeralState(_state: unknown) {}
  onPaneMenu() {}
}

export class ItemView extends View {
  contentEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl = this.containerEl;
  }
  addAction(_icon: string, _title: string, _cb: () => void) {
    return globalThis.document?.createElement('button') ?? ({} as HTMLElement);
  }
}

/** Obsidian's TextFileView save and reload logic, transcribed. */
export abstract class TextFileView extends ItemView {
  file: TFile | null = null;
  data: string | null = null;
  lastSavedData: string | null = null;
  savePromise: Promise<void> | null = null;
  dirty = false;
  isPlaintext = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  requestSave = () => {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 2000);
  };
  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void;
  abstract clear(): void;
  override onload() {
    this.registerEvent(this.app.vault.on('modify', (file: TFile) => this.onModify(file)));
  }
  get saving() {
    return this.savePromise !== null;
  }
  async loadFile(file: TFile) {
    this.file = file;
    await this.loadFileInternal(file, true);
  }
  async onUnloadFile(_file: TFile) {
    await this.save(true);
  }
  async save(clear?: boolean) {
    this.dirty = false;
    while (this.savePromise !== null) await this.savePromise.catch(() => {});
    const file = this.file;
    if (!file || file.deleted) return;
    const data = this.getViewData();
    if (this.lastSavedData !== data && this.lastSavedData !== null) {
      this.data = data;
      this.lastSavedData = data;
      this.savePromise = this.app.vault.modify(file, data);
      try {
        await this.savePromise;
      } finally {
        this.savePromise = null;
      }
    }
    if (clear) {
      this.data = null;
      this.lastSavedData = null;
      this.clear();
    }
  }
  onModify(file: TFile) {
    if (!this.saving && file === this.file) void this.loadFileInternal(file, false);
  }
  async loadFileInternal(file: TFile, clear: boolean) {
    const text = await this.app.vault.read(file);
    const previous = this.lastSavedData;
    this.lastSavedData = text;
    if (!clear && previous) {
      if (previous === text) return;
      if (this.dirty) {
        const mine = this.getViewData();
        if (mine === text) return;
        // Obsidian merges line by line here when isPlaintext is set.
        if (mine !== previous && this.isPlaintext) throw new Error('A plain-text merge would run on this file.');
      }
    }
    if (this.data === text && !clear) return;
    this.data = text;
    this.setViewData(text, clear);
  }
}

export class MarkdownView extends TextFileView {
  getViewData() {
    return this.data ?? '';
  }
  setViewData() {}
  clear() {}
  getViewType() {
    return 'markdown';
  }
}

export class Modal extends Component {
  contentEl = globalThis.document?.createElement('div') ?? ({} as HTMLElement);
  constructor(public app: App) {
    super();
  }
  open() {}
  close() {}
  setTitle() {
    return this;
  }
  onOpen() {}
  onClose() {}
}
export class SuggestModal<T> extends Modal {
  setPlaceholder() {}
  getSuggestions(_q: string): T[] {
    return [];
  }
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {}
export class Setting {
  constructor(_el: HTMLElement) {}
}
export class PluginSettingTab {
  constructor(public app: App, _plugin: unknown) {}
}
export class Plugin extends Component {
  commands: { id: string; name: string }[] = [];
  private data: unknown = null;
  constructor(public app: App, public manifest: { id: string; version: string; dir?: string }) {
    super();
  }
  registerView(type: string, creator: ViewCreator) {
    viewCreators.set(type, creator);
  }
  registerExtensions(extensions: string[], type: string) {
    for (const ext of extensions) viewsByExtension.set(ext, type);
  }
  registerHoverLinkSource() {}
  registerMarkdownPostProcessor() {}
  addCommand(command: { id: string; name: string }) {
    this.commands.push(command);
    return command;
  }
  addRibbonIcon() {
    return globalThis.document?.createElement('div');
  }
  addSettingTab() {}
  async loadData() {
    return this.data;
  }
  async saveData(data: unknown) {
    this.data = JSON.parse(JSON.stringify(data));
  }
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}
export const MarkdownRenderer = {
  async render(_app: App, markdown: string, el: HTMLElement) {
    el.textContent = markdown;
  },
};
export const Platform = { isMobile: false, isDesktop: true };
export const Keymap = {
  isModEvent: (e?: { ctrlKey?: boolean; metaKey?: boolean } | null) => !!(e?.ctrlKey || e?.metaKey),
};
export function setIcon(el: HTMLElement, icon: string) {
  el.setAttribute?.('data-icon', icon);
}
export function addIcon() {}
export function moment() {
  const now = new Date(2026, 10, 3, 13, 45, 7);
  return {
    format: (pattern: string) => pattern
      .replace('YYYY', String(now.getFullYear()))
      .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(now.getDate()).padStart(2, '0'))
      .replace('HH', String(now.getHours()).padStart(2, '0'))
      .replace('mm', String(now.getMinutes()).padStart(2, '0'))
      .replace('ss', String(now.getSeconds()).padStart(2, '0')),
  };
}
