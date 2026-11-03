// What hovering a linked shape shows. A stratum gets a card with its title
// and the start of the note; a link gets Obsidian's page preview.
//
// The pointer is inside the editor's iframe, so Obsidian never sees it.
// Page preview positions itself on a target element and hides when that
// element reports the mouse leaving; a transparent proxy laid over the
// shape stands in for it, and the frame's hover-end becomes its mouseout.

import { TFile, type App, type HoverParent } from 'obsidian';
import type { PointerInfo, Rect, StratumKind } from '../shared/protocol';
import { linkText, parseLink } from '../shared/links';
import type { VellumSettings } from './settings';
import type { StrataIndex } from './strata/index';
import { stratumIcon } from './strata/icons';

export const HOVER_SOURCE = 'vellum';

const CARD_WIDTH = 320;
const CARD_MAX_HEIGHT = 220;
const CARD_OFFSET = 14;
const EDGE = 8;
const EXCERPT_CHARS = 240;

export function excerptOf(kind: StratumKind, markdown: string, title = ''): { text: string; mono?: boolean; image?: string } {
  let body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  // A first heading that repeats the title adds nothing under it.
  const heading = /^\s*#{1,6}\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(body);
  if (heading && title && heading[1].trim().toLowerCase() === title.trim().toLowerCase()) body = body.slice(heading[0].length);
  if (kind === 'diagram') return { text: 'Diagram. Open the stratum to view it.' };
  if (kind === 'image') {
    const image = /!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/i.exec(body);
    return { text: image ? '' : 'Image', image: image ? (image[1] ?? image[2]) : undefined };
  }
  if (kind === 'embed') {
    const url = /https?:\/\/[^\s)>\]]+/.exec(body);
    return { text: url ? `Embed: ${url[0]}` : 'Embed' };
  }
  if (kind === 'code') {
    const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1/m.exec(body);
    const lines = (fenced ? fenced[2] : body).split('\n').filter((l) => l.trim()).slice(0, 6);
    return { text: lines.join('\n') || 'Empty stratum.', mono: lines.length > 0 };
  }
  const plain = body
    .replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.split('#')[0].split('/').pop() ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`=]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return { text: 'Empty stratum.' };
  return { text: plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS).trimEnd()}…` : plain };
}

export class HoverController {
  private card: HTMLElement | null = null;
  private timer: number | undefined;
  private timerWin: Window = window;
  private request = 0;
  private pointer: PointerInfo | null = null;
  private proxy: HTMLElement | null = null;
  private linkActive = false;

  constructor(
    private readonly app: App,
    private readonly strata: StrataIndex,
    private readonly settings: () => VellumSettings,
  ) {}

  stratum(owner: { containerEl: HTMLElement }, path: string, rect: Rect, pointer: PointerInfo) {
    this.endLink();
    this.pointer = pointer;
    if (!this.settings().strataHoverCard) return;
    const doc = owner.containerEl.doc;
    if (this.card && this.card.dataset.path === path && this.card.isConnected) {
      this.position(this.card, rect);
      return;
    }
    this.hideCard();
    const request = ++this.request;
    this.timerWin.clearTimeout(this.timer);
    this.timerWin = doc.defaultView ?? window;
    this.timer = this.timerWin.setTimeout(() => void this.showCard(doc, path, rect, request), this.settings().strataHoverDelay);
  }

  private async showCard(doc: Document, path: string, rect: Rect, request: number) {
    const entry = this.strata.get(path);
    const file = this.app.vault.getFileByPath(path);
    if (!entry || !file || request !== this.request) return;
    const excerpt = excerptOf(entry.kind, await this.app.vault.cachedRead(file), entry.title);
    if (request !== this.request) return;

    const card = doc.body.createDiv({ cls: 'vellum-stratum-card', attr: { role: 'tooltip', 'data-path': path } });
    const header = card.createDiv('vellum-stratum-card-header');
    stratumIcon(header.createSpan('vellum-stratum-card-icon'), entry.kind);
    header.createSpan({ cls: 'vellum-stratum-card-title', text: entry.title });
    const body = card.createDiv({ cls: `vellum-stratum-card-body${excerpt.mono ? ' is-mono' : ''}` });
    if (excerpt.image) {
      const target = this.app.metadataCache.getFirstLinkpathDest(excerpt.image, path);
      const src = target instanceof TFile ? this.app.vault.getResourcePath(target) : /^https?:\/\//.test(excerpt.image) ? excerpt.image : '';
      if (src) body.createEl('img', { attr: { src, alt: '' } });
      else body.setText('Image');
    } else {
      body.setText(excerpt.text);
    }
    this.card = card;
    this.position(card, rect);
  }

  private position(card: HTMLElement, rect: Rect) {
    const win = card.doc.defaultView ?? window;
    const pointer = this.pointer ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    const height = Math.min(card.offsetHeight || CARD_MAX_HEIGHT, CARD_MAX_HEIGHT);
    let left = pointer.x + CARD_OFFSET;
    let top = pointer.y + CARD_OFFSET;
    if (left + CARD_WIDTH > win.innerWidth - EDGE) left = pointer.x - CARD_OFFSET - CARD_WIDTH;
    if (top + height > win.innerHeight - EDGE) top = pointer.y - CARD_OFFSET - height;
    card.style.left = `${Math.max(EDGE, left)}px`;
    card.style.top = `${Math.max(EDGE, top)}px`;
  }

  link(parent: HoverParent & { containerEl: HTMLElement }, link: string, sourcePath: string, rect: Rect, pointer: PointerInfo) {
    this.cancelCard();
    const parsed = parseLink(link);
    const linktext = parsed ? linkText(parsed) : null;
    if (!linktext) return;
    const doc = parent.containerEl.doc;
    if (!this.proxy || this.proxy.doc !== doc) {
      this.proxy?.remove();
      this.proxy = doc.body.createDiv('vellum-hover-target');
    }
    const proxy = this.proxy;
    proxy.style.left = `${rect.x}px`;
    proxy.style.top = `${rect.y}px`;
    proxy.style.width = `${rect.width}px`;
    proxy.style.height = `${rect.height}px`;
    const MouseEventCtor = (doc.defaultView ?? window).MouseEvent;
    this.linkActive = true;
    this.app.workspace.trigger('hover-link', {
      event: new MouseEventCtor('mouseover', { clientX: pointer.x, clientY: pointer.y, ctrlKey: pointer.ctrlKey, metaKey: pointer.metaKey, shiftKey: pointer.shiftKey, altKey: pointer.altKey }),
      source: HOVER_SOURCE,
      hoverParent: parent,
      targetEl: proxy,
      linktext,
      sourcePath,
    });
  }

  end() {
    this.cancelCard();
    this.endLink();
  }

  private endLink() {
    if (!this.linkActive || !this.proxy) return;
    this.linkActive = false;
    const MouseEventCtor = (this.proxy.doc.defaultView ?? window).MouseEvent;
    this.proxy.dispatchEvent(new MouseEventCtor('mouseout', { bubbles: true, relatedTarget: null }));
    this.proxy.dispatchEvent(new MouseEventCtor('mouseleave', { bubbles: false, relatedTarget: null }));
  }

  private cancelCard() {
    this.request++;
    this.timerWin.clearTimeout(this.timer);
    this.hideCard();
  }

  private hideCard() {
    this.card?.remove();
    this.card = null;
  }

  hide() {
    this.end();
  }

  unload() {
    this.end();
    this.proxy?.remove();
    this.proxy = null;
  }
}
