// Builds the iframes the editor runs in. Kept free of Obsidian imports so
// the frame tests can load it in a plain browser page.
//
// The frame's script and fonts become blob URLs once, shared by every
// frame. Its stylesheet goes inline: Obsidian's own Content-Security-Policy
// (which a srcdoc frame inherits) allows inline styles but not stylesheets
// from blob URLs. The frame adds a stricter policy of its own on top.

import type { HostApi } from '../shared/protocol';

export interface FrameAssets {
  script: string;
  style: string;
  fonts: Record<string, string>;
}

const POLICY = [
  "default-src 'none'",
  'script-src blob:',
  "style-src 'unsafe-inline'",
  'font-src blob: data:',
  'img-src blob: data:',
  'media-src blob: data:',
  'connect-src blob: data:',
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class FrameResources {
  private urls: string[] = [];
  private scriptUrl: string | null = null;
  private style: string | null = null;

  constructor(private readonly assets: FrameAssets) {}

  private prepare() {
    if (this.scriptUrl) return;
    const fontUrls = new Map<string, string>();
    for (const [id, data] of Object.entries(this.assets.fonts)) {
      const url = URL.createObjectURL(new Blob([base64ToBytes(data) as BlobPart], { type: 'font/woff2' }));
      fontUrls.set(id, url);
      this.urls.push(url);
    }
    this.style = this.assets.style.replace(/url\(vellum-font:([^)]+)\)/g, (_, id: string) => `url(${fontUrls.get(id) ?? ''})`);
    this.scriptUrl = URL.createObjectURL(new Blob([this.assets.script], { type: 'text/javascript' }));
    this.urls.push(this.scriptUrl);
  }

  document(title: string): string {
    this.prepare();
    return [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
      `<title>${escapeHtml(title)}</title><style>${this.style}</style></head>`,
      `<body><div id="root"></div><script src="${this.scriptUrl}"></script></body></html>`,
    ].join('');
  }

  /** Create an editor frame. It boots as soon as it is attached. */
  createFrame(doc: Document, host: HostApi, title: string): HTMLIFrameElement {
    const frame = doc.createElement('iframe');
    frame.vellumHost = host;
    frame.className = 'vellum-frame';
    frame.setAttribute('title', title);
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.srcdoc = this.document(title);
    return frame;
  }

  dispose() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    this.scriptUrl = null;
    this.style = null;
  }
}
