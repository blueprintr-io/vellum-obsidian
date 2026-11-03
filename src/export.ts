// Image exports into the vault: on request from a view, and automatically
// after saves when the auto-export setting asks for sidecar images
// (`Network.vellum.svg` beside `Network.vellum.md`), for Obsidian Publish
// and other tools that cannot run the plugin.

import { Notice, TFile, type App } from 'obsidian';
import type { ExportResult } from '../shared/protocol';
import { diagramName } from './files';
import type VellumPlugin from './main';
import type { VellumView } from './view';

const AUTO_EXPORT_DELAY_MS = 2000;

export function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function resultBytes(result: ExportResult): ArrayBuffer {
  return result.format === 'svg' ? new TextEncoder().encode(result.data).buffer : dataUrlToBuffer(result.data);
}

/** Sidecar path for a diagram: `Folder/Network.vellum.svg`. */
export function sidecarPath(file: TFile, format: 'svg' | 'png'): string {
  const folder = file.parent && file.parent.path !== '/' ? `${file.parent.path}/` : '';
  return `${folder}${diagramName(file)}.vellum.${format}`;
}

export class Exporter {
  private timers = new Map<string, number>();

  constructor(private readonly plugin: VellumPlugin) {}

  private get app(): App {
    return this.plugin.app;
  }

  async exportFile(view: VellumView, format: 'svg' | 'png') {
    const file = view.file;
    if (!file || !view.frame) return;
    const target = await this.plugin.chooseSaveTarget(`${diagramName(file)}.${format}`, file);
    if (!target) return;
    try {
      const result = await view.frame.exportImage(this.request(format));
      await this.plugin.writeBinary(target, resultBytes(result));
      new Notice(`Exported ${target}`);
    } catch (error) {
      new Notice(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private request(format: 'svg' | 'png') {
    const { settings } = this.plugin;
    return {
      format,
      theme: settings.exportTheme === 'obsidian' ? this.plugin.obsidianTheme() : settings.exportTheme,
      background: settings.exportTransparent ? null : 'paper',
      scale: settings.exportScale,
      embedFonts: true,
    } as const;
  }

  /** Called after each save; writes sidecars once the editing settles. */
  afterSave(view: VellumView, file: TFile) {
    const mode = this.plugin.settings.autoExport;
    if (mode === 'none') return;
    window.clearTimeout(this.timers.get(file.path));
    this.timers.set(file.path, window.setTimeout(() => {
      this.timers.delete(file.path);
      void this.writeSidecars(view, file);
    }, AUTO_EXPORT_DELAY_MS));
  }

  private async writeSidecars(view: VellumView, file: TFile) {
    if (!view.frame || view.file !== file) return;
    const mode = this.plugin.settings.autoExport;
    const formats: ('svg' | 'png')[] = mode === 'both' ? ['svg', 'png'] : mode === 'none' ? [] : [mode];
    for (const format of formats) {
      try {
        const result = await view.frame.exportImage(this.request(format));
        await this.plugin.writeBinary(sidecarPath(file, format), resultBytes(result));
      } catch (error) {
        console.error('[vellum] auto-export failed', error);
      }
    }
  }

  /** Keep sidecars with their diagram when it is renamed or moved. */
  async renamed(file: TFile, oldPath: string) {
    for (const format of ['svg', 'png'] as const) {
      const oldFolder = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/') + 1) : '';
      const oldName = oldPath.slice(oldFolder.length).replace(/\.md$/i, '').replace(/\.vellum$/i, '');
      const old = this.app.vault.getFileByPath(`${oldFolder}${oldName}.vellum.${format}`);
      const next = sidecarPath(file, format);
      if (old && old.path !== next && !this.app.vault.getAbstractFileByPath(next)) await this.app.fileManager.renameFile(old, next);
    }
  }

  async deleted(path: string) {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const name = path.slice(folder.length).replace(/\.md$/i, '').replace(/\.vellum$/i, '');
    for (const format of ['svg', 'png']) {
      const sidecar = this.app.vault.getFileByPath(`${folder}${name}.vellum.${format}`);
      if (sidecar) await this.app.fileManager.trashFile(sidecar);
    }
  }
}
