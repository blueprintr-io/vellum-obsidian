// Renders diagram files to images for embeds and hover previews. One
// hidden editor frame does the work for the whole app: each job loads a
// file's YAML, picks the tab or shape asked for, and exports through core's
// own pipeline, so an embed looks exactly like an export.

import { TFile } from 'obsidian';
import {
  FRAME_PROTOCOL,
  type ExportRequest,
  type ExportResult,
  type FrameApi,
  type HostApi,
} from '../../shared/protocol';
import { sourceOf } from '../files';
import type VellumPlugin from '../main';

const CACHE_SIZE = 64;
const BOOT_TIMEOUT_MS = 30_000;

export type RenderRequest = Pick<ExportRequest, 'format' | 'theme' | 'background' | 'scale' | 'padding'> & {
  /** `#Tab title` or `#^block-id` from the embed link. */
  subpath?: string;
};

export class EmbedRenderer {
  private frameEl: HTMLIFrameElement | null = null;
  private api: FrameApi | null = null;
  private booting: Promise<FrameApi> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Promise<ExportResult>>();

  constructor(private readonly plugin: VellumPlugin) {}

  private boot(): Promise<FrameApi> {
    if (this.api && this.frameEl?.isConnected) return Promise.resolve(this.api);
    if (this.booting) return this.booting;
    this.frameEl?.remove();
    const plugin = this.plugin;
    this.booting = new Promise<FrameApi>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The diagram renderer did not start.')), BOOT_TIMEOUT_MS);
      const host: HostApi = {
        protocol: FRAME_PROTOCOL,
        boot: () => ({
          protocol: FRAME_PROTOCOL,
          mode: 'read',
          theme: plugin.themeName(),
          preferences: plugin.preferencesFor(),
          library: null,
          fileName: 'render.vellum',
          renderer: true,
        }),
        ready: (api) => {
          window.clearTimeout(timer);
          this.api = api;
          resolve(api);
        },
        changed() {},
        save: async () => {},
        replaced() {},
        savePreferences() {},
        saveLibrary() {},
        readRecord: (key) => plugin.readRecord(key),
        saveRecord() {},
        focused() {},
        setMode() {},
        stratum() {},
        link() {},
        insert() {},
        hoverStratum() {},
        hoverLink() {},
        hoverEnd() {},
        pickFile: async () => null,
        chooseSaveTarget: async () => null,
        writeFile: async () => {},
        dragActive: () => false,
        drop() {},
        key() {},
        notice() {},
        unloading: () => {
          this.api = null;
        },
      };
      const frame = plugin.resources().createFrame(document, host, 'Vellum renderer');
      frame.addClass('vellum-renderer-frame');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      document.body.appendChild(frame);
      this.frameEl = frame;
    }).finally(() => {
      this.booting = null;
    });
    return this.booting;
  }

  private key(file: TFile, request: RenderRequest): string {
    const strata = this.plugin.strata.forDiagram(file.path).map((s) => `${s.shapeId}:${s.tabId ?? ''}`).join(',');
    return `${file.path}\n${file.stat.mtime}\n${file.stat.size}\n${JSON.stringify(request)}\n${strata}`;
  }

  render(file: TFile, request: RenderRequest): Promise<ExportResult> {
    const key = this.key(file, request);
    const hit = this.cache.get(key);
    if (hit) {
      // Keep recently used entries at the end of the eviction order.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const job = this.queue.then(() => this.run(file, request));
    this.queue = job.catch(() => {});
    this.cache.set(key, job);
    job.catch(() => this.cache.delete(key));
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return job;
  }

  private async run(file: TFile, request: RenderRequest): Promise<ExportResult> {
    const api = await this.boot();
    const yaml = sourceOf(file, await this.plugin.app.vault.cachedRead(file));
    if (!yaml) throw new Error('This note has no diagram yet.');
    const error = api.load(yaml, { fileName: file.name });
    if (error) throw new Error(error);
    api.setStrata(this.plugin.strata.forDiagram(file.path).map(({ diagramPath: _, ...info }) => info));
    const { subpath, ...rest } = request;
    const target = subpath?.replace(/^#/, '') ?? '';
    const exportRequest: ExportRequest = { ...rest };
    if (target.startsWith('^')) exportRequest.shape = target;
    else if (target) exportRequest.tab = target;
    return api.exportImage(exportRequest);
  }

  /** Rewrite links in YAML that is not open in any view. */
  transform(yaml: string, renames: Record<string, string>) {
    const job = this.queue.then(async () => (await this.boot()).transformYaml(yaml, renames));
    this.queue = job.catch(() => {});
    return job;
  }

  /** Forget renders of a file, after it changed or moved. */
  invalidate(path: string) {
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${path}\n`)) this.cache.delete(key);
  }

  dispose() {
    this.frameEl?.remove();
    this.frameEl = null;
    this.api = null;
    this.cache.clear();
  }
}
