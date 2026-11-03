// A floating window showing a stratum note, opened by clicking its shape in
// read mode. Windows can be dragged by their title, resized from the
// corner and maximised; several can be open at once. When a shape has more
// than one stratum the window pages through them.

import { Component, Keymap, MarkdownRenderer, setIcon, TFile, type App, type HoverPopover } from 'obsidian';
import type { StratumEntry } from './index';
import { stratumIcon } from './icons';
import { HOVER_SOURCE } from '../hover';

const MARGIN = 16;
const KEEP_VISIBLE = 48;
const CASCADE = 32;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

let zCounter = 0;

export interface WindowActions {
  edit(path: string): void;
  openInTab(path: string): void;
}

export class StratumWindow extends Component {
  hoverPopover: HoverPopover | null = null;
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly pagerEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private renderId = 0;

  constructor(
    private readonly app: App,
    private strata: StratumEntry[],
    private index: number,
    private readonly actions: WindowActions,
    private readonly onClosed: (window: StratumWindow) => void,
    doc: Document,
  ) {
    super();
    this.el = doc.body.createDiv({ cls: 'vellum-stratum-window', attr: { role: 'dialog', 'aria-modal': 'false', tabindex: '-1' } });
    const header = this.el.createDiv('vellum-stratum-window-header');
    this.iconEl = header.createSpan('vellum-stratum-window-icon');
    this.titleEl = header.createSpan('vellum-stratum-window-title');
    this.pagerEl = header.createDiv('vellum-stratum-window-pager');
    const buttons = header.createDiv('vellum-stratum-window-buttons');
    this.button(buttons, 'pencil', 'Edit note', () => this.actions.edit(this.current.path));
    this.button(buttons, 'external-link', 'Open in a new tab', () => this.actions.openInTab(this.current.path));
    this.button(buttons, 'maximize-2', 'Maximise', () => this.el.toggleClass('is-maximized', !this.el.hasClass('is-maximized')));
    this.button(buttons, 'x', 'Close', () => this.close());
    this.bodyEl = this.el.createDiv('vellum-stratum-window-body markdown-rendered');
    this.dragFrom(header);
  }

  private button(parent: HTMLElement, icon: string, label: string, onClick: () => void) {
    const el = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label, type: 'button' } });
    setIcon(el, icon);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return el;
  }

  get current(): StratumEntry {
    return this.strata[this.index];
  }

  get shapeKey(): string {
    return `${this.current.diagramPath}\n${this.current.shapeId}`;
  }

  override onload() {
    const win = this.el.win;
    this.registerDomEvent(this.el, 'pointerdown', () => this.raise());
    this.registerDomEvent(this.el, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.registerDomEvent(this.bodyEl, 'click', (e: MouseEvent) => this.onBodyClick(e));
    this.registerDomEvent(this.bodyEl, 'mouseover', (e: MouseEvent) => this.onBodyHover(e));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (file.path === this.current.path) void this.render();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file.path !== this.current.path) return;
      this.strata = this.strata.filter((s) => s.path !== file.path);
      if (!this.strata.length) this.close();
      else this.show(Math.min(this.index, this.strata.length - 1));
    }));
    this.registerDomEvent(win, 'resize', () => this.clamp());
    this.raise();
    void this.render();
  }

  /** Show another stratum of the same shape (or the same one again). */
  show(index: number, strata = this.strata) {
    this.strata = strata;
    this.index = Math.max(0, Math.min(index, strata.length - 1));
    this.raise();
    void this.render();
  }

  private async render() {
    const stratum = this.current;
    const id = ++this.renderId;
    this.titleEl.setText(stratum.title);
    this.el.setAttribute('aria-label', stratum.title);
    this.iconEl.empty();
    stratumIcon(this.iconEl, stratum.kind);
    this.renderPager();
    const file = this.app.vault.getFileByPath(stratum.path);
    if (!(file instanceof TFile)) return;
    const text = await this.app.vault.cachedRead(file);
    if (id !== this.renderId) return;
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
    this.bodyEl.empty();
    if (!body.trim()) {
      this.bodyEl.createEl('p', { cls: 'vellum-stratum-window-empty', text: 'This stratum is empty. Use the pencil button to write it.' });
      return;
    }
    await MarkdownRenderer.render(this.app, body, this.bodyEl, file.path, this);
  }

  private renderPager() {
    this.pagerEl.empty();
    if (this.strata.length < 2) return;
    this.button(this.pagerEl, 'chevron-left', 'Previous stratum', () => this.show((this.index - 1 + this.strata.length) % this.strata.length));
    this.pagerEl.createSpan({ cls: 'vellum-stratum-window-count', text: `${this.index + 1} / ${this.strata.length}` });
    this.button(this.pagerEl, 'chevron-right', 'Next stratum', () => this.show((this.index + 1) % this.strata.length));
  }

  private onBodyClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    if (link.hasClass('internal-link')) {
      e.preventDefault();
      const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
      void this.app.workspace.openLinkText(href, this.current.path, Keymap.isModEvent(e));
    } else if (link.hasClass('external-link')) {
      e.preventDefault();
      window.open(link.getAttribute('href') ?? '', '_blank');
    }
  }

  private onBodyHover(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest('a.internal-link');
    if (!(link instanceof HTMLElement)) return;
    this.app.workspace.trigger('hover-link', {
      event: e,
      source: HOVER_SOURCE,
      hoverParent: this,
      targetEl: link,
      linktext: link.getAttribute('data-href') ?? link.getAttribute('href') ?? '',
      sourcePath: this.current.path,
    });
  }

  /** Centre over `around`, offset from any window already there. */
  place(around: DOMRect, cascadeFrom: StratumWindow | null) {
    const win = this.el.win;
    const width = Math.max(MIN_WIDTH, Math.min(880, around.width * 0.85, win.innerWidth - 2 * MARGIN));
    const height = Math.max(MIN_HEIGHT, Math.min(600, around.height * 0.85, win.innerHeight - 2 * MARGIN));
    let left = around.left + (around.width - width) / 2;
    let top = around.top + (around.height - height) / 2;
    if (cascadeFrom) {
      const r = cascadeFrom.el.getBoundingClientRect();
      left = r.left + CASCADE;
      top = r.top + CASCADE;
      if (left + width > win.innerWidth - MARGIN || top + height > win.innerHeight - MARGIN) {
        left = around.left + (around.width - width) / 2;
        top = around.top + (around.height - height) / 2;
      }
    }
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.clamp();
  }

  private clamp() {
    const win = this.el.win;
    const r = this.el.getBoundingClientRect();
    const left = Math.min(Math.max(r.left, KEEP_VISIBLE - r.width), win.innerWidth - KEEP_VISIBLE);
    const top = Math.min(Math.max(r.top, 0), win.innerHeight - KEEP_VISIBLE);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  raise() {
    this.el.style.zIndex = String(40 + ++zCounter);
  }

  focus() {
    this.raise();
    this.el.focus({ preventScroll: true });
  }

  private dragFrom(handle: HTMLElement) {
    handle.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.el.toggleClass('is-maximized', !this.el.hasClass('is-maximized'));
    });
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      if (this.el.hasClass('is-maximized')) {
        // Dragging a maximised window restores it under the pointer.
        const r = this.el.getBoundingClientRect();
        this.el.removeClass('is-maximized');
        const width = this.el.offsetWidth;
        this.el.style.left = `${e.clientX - width * ((e.clientX - r.left) / r.width)}px`;
        this.el.style.top = `${e.clientY - 16}px`;
      }
      const start = { x: e.clientX, y: e.clientY, left: this.el.offsetLeft, top: this.el.offsetTop };
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        this.el.style.left = `${start.left + ev.clientX - start.x}px`;
        this.el.style.top = `${start.top + ev.clientY - start.y}px`;
      };
      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.clamp();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  close() {
    this.unload();
  }

  override onunload() {
    this.el.remove();
    this.onClosed(this);
  }
}

/** Open windows, so a second click on a shape focuses its window. */
export class StratumWindows {
  private open = new Set<StratumWindow>();

  constructor(private readonly app: App, private readonly actions: WindowActions) {}

  show(strata: StratumEntry[], index: number, around: HTMLElement) {
    if (!strata.length) return;
    const key = `${strata[0].diagramPath}\n${strata[0].shapeId}`;
    const existing = [...this.open].find((w) => w.shapeKey === key && w.el.doc === around.doc);
    if (existing) {
      existing.show(index, strata);
      existing.focus();
      return;
    }
    const topmost = [...this.open].filter((w) => w.el.doc === around.doc).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0] ?? null;
    const window = new StratumWindow(this.app, strata, index, this.actions, (w) => this.open.delete(w), around.doc);
    this.open.add(window);
    window.load();
    window.place(around.getBoundingClientRect(), topmost);
    window.focus();
  }

  closeAll() {
    for (const window of [...this.open]) window.close();
  }
}
