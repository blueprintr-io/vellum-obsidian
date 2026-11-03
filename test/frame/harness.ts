// A stand-in for the plugin side of the frame protocol, loaded in a plain
// page by the frame tests. It boots real editor frames with the same
// resources the plugin embeds and records every call the frame makes.

import { FrameResources } from '../../src/frame-resources';
import {
  FRAME_PROTOCOL,
  type FrameApi,
  type FrameBoot,
  type HostApi,
  type KeyInit,
  type StoredSlice,
  type ViewMode,
} from '../../shared/protocol';

export interface OpenOptions {
  yaml: string;
  mode?: ViewMode;
  theme?: 'light' | 'dark';
  renderer?: boolean;
  preferences?: StoredSlice<Record<string, unknown>> | null;
  library?: StoredSlice<unknown[]> | null;
  pickFile?: { name: string; type: string; text: string } | null;
  saveTarget?: string | null;
  width?: number;
  height?: number;
}

type Call = { name: string; args: unknown[] };

class FakeHost implements HostApi {
  readonly protocol = FRAME_PROTOCOL;
  frame: FrameApi | null = null;
  calls: Call[] = [];
  saved: string[] = [];
  written: { path: string; text: string }[] = [];
  private resolveReady!: () => void;
  readonly whenReady = new Promise<void>((resolve) => { this.resolveReady = resolve; });

  constructor(private options: OpenOptions) {}

  private record(name: string, ...args: unknown[]) {
    this.calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
  }

  boot(): FrameBoot {
    return {
      protocol: FRAME_PROTOCOL,
      mode: this.options.mode ?? 'edit',
      theme: this.options.theme ?? 'light',
      preferences: this.options.preferences ?? { state: { hasCompletedOnboarding: true }, version: 1 },
      library: this.options.library ?? null,
      fileName: 'Test.vellum',
      renderer: !!this.options.renderer,
    };
  }
  ready(frame: FrameApi) {
    this.frame = frame;
    this.resolveReady();
  }
  changed() { this.record('changed'); }
  async save() {
    this.record('save');
    const snapshot = this.frame?.snapshot();
    if (!snapshot) return;
    this.saved.push(snapshot.yaml);
    this.frame!.markSaved(snapshot.token);
  }
  replaced(yaml: string, name: string | null, previous: string) { this.record('replaced', yaml.length > 0, name, previous.includes('API Gateway')); }
  savePreferences(p: StoredSlice<Record<string, unknown>>) { this.record('savePreferences', p); }
  saveLibrary(l: StoredSlice<unknown[]>) { this.record('saveLibrary', l); }
  focused() { this.record('focused'); }
  setMode(mode: ViewMode) {
    this.record('setMode', mode);
    this.frame?.setMode(mode);
  }
  stratum(action: unknown) { this.record('stratum', action); }
  link(action: unknown) { this.record('link', action); }
  insert(action: unknown, at: unknown) { this.record('insert', action, at); }
  hoverStratum(path: string, rect: unknown, pointer: unknown) { this.record('hoverStratum', path, rect, pointer); }
  hoverLink(link: string, rect: unknown, pointer: unknown) { this.record('hoverLink', link, rect, pointer); }
  hoverEnd() { this.record('hoverEnd'); }
  async pickFile(extensions: string[]) {
    this.record('pickFile', extensions);
    const file = this.options.pickFile;
    if (!file) return null;
    return { name: file.name, type: file.type, data: new TextEncoder().encode(file.text).buffer as ArrayBuffer };
  }
  async chooseSaveTarget(name: string) {
    this.record('chooseSaveTarget', name);
    return this.options.saveTarget ?? null;
  }
  async writeFile(path: string, data: ArrayBuffer) {
    this.record('writeFile', path);
    this.written.push({ path, text: new TextDecoder().decode(data) });
  }
  dragActive() { return false; }
  drop(at: unknown) { this.record('drop', at); }
  key(event: KeyInit) { this.record('key', event); }
  notice(message: string) { this.record('notice', message); }
  unloading(snapshot: unknown) { this.record('unloading', snapshot !== null); }
}

let resources: FrameResources | null = null;
async function frameResources() {
  if (resources) return resources;
  const [script, assets] = await Promise.all([
    fetch('/frame.js').then((r) => r.text()),
    fetch('/assets.json').then((r) => r.json()),
  ]);
  resources = new FrameResources({ script, style: assets.style, fonts: assets.fonts });
  return resources;
}

const hosts: FakeHost[] = [];

const harness = {
  async open(options: OpenOptions) {
    const host = new FakeHost(options);
    const frame = (await frameResources()).createFrame(document, host, 'Vellum test');
    frame.style.width = `${options.width ?? 1100}px`;
    frame.style.height = `${options.height ?? 720}px`;
    frame.style.border = '0';
    frame.style.display = 'block';
    document.body.appendChild(frame);
    await host.whenReady;
    const error = host.frame!.load(options.yaml, { fit: true });
    if (error) throw new Error(error);
    hosts.push(host);
    return hosts.length - 1;
  },
  host: (index = hosts.length - 1) => hosts[index],
  frame: (index = hosts.length - 1) => hosts[index].frame!,
  calls: (name?: string, index = hosts.length - 1) => hosts[index].calls.filter((c) => !name || c.name === name),
  /** Position of an element inside the frame, in page coordinates. */
  pagePoint(selector: string, index = hosts.length - 1) {
    const frames = document.querySelectorAll('iframe');
    const iframe = frames[index];
    const el = iframe.contentDocument!.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const f = iframe.getBoundingClientRect();
    return { x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 };
  },
};

declare global {
  interface Window {
    harness: typeof harness;
  }
}
window.harness = harness;
