// The plugin's side of the frame protocol for one view.

import { Notice, View, type TFile } from 'obsidian';
import {
  FRAME_PROTOCOL,
  type DiagramSnapshot,
  type FrameApi,
  type FrameBoot,
  type HostApi,
  type InsertAction,
  type KeyInit,
  type LinkAction,
  type PointerInfo,
  type Rect,
  type StoredRecord,
  type StoredSlice,
  type StratumAction,
  type ViewMode,
} from '../shared/protocol';
import type VellumPlugin from './main';
import type { VellumView } from './view';

export class ViewHost implements HostApi {
  readonly protocol = FRAME_PROTOCOL;
  /** The vault file the last Open picker handed to core, to tell an Open
   *  apart from New or an import when core replaces the workspace. */
  private picked: { file: TFile; at: number } | null = null;

  constructor(private readonly view: VellumView, private readonly plugin: VellumPlugin) {}

  private get file(): TFile | null {
    return this.view.diagramFile;
  }

  boot(): FrameBoot {
    return {
      protocol: FRAME_PROTOCOL,
      mode: this.view.mode,
      theme: this.plugin.themeName(),
      preferences: this.plugin.preferencesFor(),
      library: this.plugin.library,
      fileName: this.file?.name ?? 'Untitled.vellum',
      renderer: false,
    };
  }

  ready(frame: FrameApi) {
    this.view.frameReady(frame);
  }

  changed() {
    this.view.requestSave();
  }

  async save() {
    await this.view.save();
  }

  replaced(yaml: string, suggestedName: string | null, previous: string) {
    const picked = this.picked && Date.now() - this.picked.at < 60_000 ? this.picked.file : null;
    this.picked = null;
    // Core is still inside the action that replaced the workspace; restore
    // once it has finished.
    window.setTimeout(() => {
      this.view.restore(previous);
      void this.plugin.diagramReplaced(this.view, yaml, suggestedName, picked);
    }, 0);
  }

  savePreferences(preferences: StoredSlice<Record<string, unknown>>) {
    this.plugin.savePreferences(preferences, this.view);
  }

  saveLibrary(library: StoredSlice<unknown[]>) {
    this.plugin.saveLibrary(library, this.view);
  }

  readRecord(key: StoredRecord) {
    return this.plugin.readRecord(key);
  }

  saveRecord(key: StoredRecord, value: unknown) {
    this.plugin.saveRecord(key, value);
  }

  focused() {
    const { workspace } = this.plugin.app;
    if (workspace.getActiveViewOfType(View) !== this.view) workspace.setActiveLeaf(this.view.leaf, { focus: false });
  }

  setMode(mode: ViewMode) {
    this.view.setMode(mode);
  }

  stratum(action: StratumAction) {
    const file = this.file;
    if (file) void this.plugin.strataActions.run(file, action, this.view);
  }

  link(action: LinkAction) {
    const file = this.file;
    if (!file) return;
    if (action.type === 'open') this.plugin.openLink(action.link, file.path, action.newLeaf);
    else if (action.type === 'edit') this.plugin.editShapeLink(this.view, file, action.shapeId, action.current);
    else void this.plugin.copyShapeLink(this.view, file, action.shapeId, action.tabId);
  }

  insert(action: InsertAction, at: { x: number; y: number } | null) {
    void this.plugin.insertFromVault(this.view, action, at);
  }

  private toParent(rect: Rect, pointer: PointerInfo) {
    const frame = this.view.frameElement?.getBoundingClientRect();
    const dx = frame?.left ?? 0;
    const dy = frame?.top ?? 0;
    return {
      rect: { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height },
      pointer: { ...pointer, x: pointer.x + dx, y: pointer.y + dy },
    };
  }

  hoverStratum(path: string, rect: Rect, pointer: PointerInfo) {
    const at = this.toParent(rect, pointer);
    this.plugin.hover.stratum(this.view, path, at.rect, at.pointer);
  }

  hoverLink(link: string, rect: Rect, pointer: PointerInfo) {
    const file = this.file;
    if (!file) return;
    const at = this.toParent(rect, pointer);
    this.plugin.hover.link(this.view, link, file.path, at.rect, at.pointer);
  }

  hoverEnd() {
    this.plugin.hover.end();
  }

  async pickFile(extensions: string[]) {
    const file = await this.plugin.pickVaultFile(extensions, 'Open a file from the vault');
    if (!file) return null;
    this.picked = { file, at: Date.now() };
    return { name: file.name, type: mimeFor(file.extension), data: await this.plugin.app.vault.readBinary(file) };
  }

  chooseSaveTarget(suggestedName: string) {
    return this.plugin.chooseSaveTarget(suggestedName, this.file);
  }

  async writeFile(path: string, data: ArrayBuffer) {
    await this.plugin.writeBinary(path, data);
    new Notice(`Saved ${path}`);
  }

  dragActive() {
    return this.plugin.draggedFiles() !== null;
  }

  drop(at: { x: number; y: number }) {
    void this.plugin.dropFiles(this.view, at);
  }

  key(init: KeyInit) {
    const target = this.view.containerEl;
    const KeyboardEventCtor = (target.win as unknown as typeof window).KeyboardEvent;
    target.dispatchEvent(new KeyboardEventCtor('keydown', { ...init, bubbles: true, cancelable: true }));
  }

  notice(message: string) {
    new Notice(message);
  }

  unloading(snapshot: DiagramSnapshot | null) {
    this.view.frameUnloading(snapshot);
  }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  vellum: 'application/x-yaml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  json: 'application/json',
  drawio: 'application/xml',
  xml: 'application/xml',
  excalidraw: 'application/json',
  md: 'text/markdown',
  mmd: 'text/plain',
};

export function mimeFor(extension: string): string {
  return MIME[extension.toLowerCase()] ?? 'application/octet-stream';
}
