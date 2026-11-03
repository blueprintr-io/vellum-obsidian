// Obsidian adds helpers to DOM prototypes (createDiv, addClass, `doc`,
// `win`, …). Tests running outside Obsidian install the ones the plugin
// uses on a given window.

type ElOptions = string | { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null>; type?: string; title?: string; href?: string };

export function installDomHelpers(win: Window & typeof globalThis) {
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.createDiv) return;

  function apply(el: HTMLElement, options?: ElOptions) {
    if (!options) return;
    if (typeof options === 'string') {
      el.className = options;
      return;
    }
    if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.type) el.setAttribute('type', options.type);
    if (options.title) el.setAttribute('title', options.title);
    if (options.href) el.setAttribute('href', options.href);
    for (const [key, value] of Object.entries(options.attr ?? {})) {
      if (value === null || value === false) continue;
      el.setAttribute(key, String(value));
    }
  }

  function createEl(this: HTMLElement, tag: string, options?: ElOptions, callback?: (el: HTMLElement) => void) {
    const el = this.ownerDocument.createElement(tag);
    apply(el, options);
    this.appendChild(el);
    callback?.(el);
    return el;
  }

  Object.assign(proto, {
    createEl,
    createDiv(this: HTMLElement, options?: ElOptions, callback?: (el: HTMLElement) => void) {
      return createEl.call(this, 'div', options, callback);
    },
    createSpan(this: HTMLElement, options?: ElOptions, callback?: (el: HTMLElement) => void) {
      return createEl.call(this, 'span', options, callback);
    },
    empty(this: HTMLElement) {
      while (this.firstChild) this.removeChild(this.firstChild);
    },
    addClass(this: HTMLElement, ...classes: string[]) {
      this.classList.add(...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean));
    },
    removeClass(this: HTMLElement, ...classes: string[]) {
      this.classList.remove(...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean));
    },
    toggleClass(this: HTMLElement, cls: string, value: boolean) {
      this.classList.toggle(cls, value);
    },
    hasClass(this: HTMLElement, cls: string) {
      return this.classList.contains(cls);
    },
    setText(this: HTMLElement, text: string) {
      this.textContent = text;
    },
    setAttr(this: HTMLElement, key: string, value: string) {
      this.setAttribute(key, value);
    },
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
      Object.assign(this.style, styles);
    },
    isShown(this: HTMLElement) {
      return this.style.display !== 'none';
    },
  });
  (win as unknown as Record<string, unknown>).createFragment = (callback?: (fragment: DocumentFragment) => void) => {
    const fragment = win.document.createDocumentFragment();
    callback?.(fragment);
    return fragment;
  };
  const fragmentProto = win.DocumentFragment.prototype as unknown as Record<string, unknown>;
  fragmentProto.appendText = function (this: DocumentFragment, text: string) {
    this.appendChild(win.document.createTextNode(text));
  };
  fragmentProto.createEl = createEl;
  Object.defineProperty(win.Node.prototype, 'doc', {
    configurable: true,
    get(this: Node) {
      return this.ownerDocument ?? (this as unknown as Document);
    },
  });
  Object.defineProperty(win.Node.prototype, 'win', {
    configurable: true,
    get(this: Node) {
      return (this.ownerDocument ?? (this as unknown as Document)).defaultView;
    },
  });
}
