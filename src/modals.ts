// Pickers and prompts used by the editor's vault actions.

import { App, FuzzySuggestModal, Modal, normalizePath, Setting, SuggestModal, TFile, TFolder } from 'obsidian';

/** Pick one of a list of notes. */
export class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly files: TFile[], placeholder: string, private readonly onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems() {
    return this.files;
  }
  getItemText(file: TFile) {
    return file.path.replace(/\.md$/i, '');
  }
  onChooseItem(file: TFile) {
    this.onPick(file);
  }
}

/** Pick a vault file. Resolves null when dismissed. */
export function pickFile(app: App, files: TFile[], placeholder: string): Promise<TFile | null> {
  return new Promise((resolve) => {
    let chosen = false;
    const modal = new (class extends FuzzySuggestModal<TFile> {
      getItems() {
        return files;
      }
      getItemText(file: TFile) {
        return file.path;
      }
      onChooseItem(file: TFile) {
        chosen = true;
        resolve(file);
      }
      override onClose() {
        // Obsidian closes the modal before it reports the choice.
        window.setTimeout(() => {
          if (!chosen) resolve(null);
        }, 0);
      }
    })(app);
    modal.setPlaceholder(placeholder);
    modal.open();
  });
}

type LinkSuggestion = { kind: 'file'; file: TFile } | { kind: 'text'; value: string };

/** Choose what a shape links to: a vault file, or typed text (a URL, or a
 *  note that does not exist yet). Resolves null when dismissed. */
export function pickLink(app: App, sourcePath: string, current: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    let chosen = false;
    const modal = new (class extends SuggestModal<LinkSuggestion> {
      getSuggestions(query: string): LinkSuggestion[] {
        const q = query.trim().toLowerCase();
        const files = app.vault.getFiles()
          .filter((f) => !q || f.path.toLowerCase().includes(q))
          .sort((a, b) => b.stat.mtime - a.stat.mtime)
          .slice(0, 50)
          .map((file): LinkSuggestion => ({ kind: 'file', file }));
        return query.trim() ? [{ kind: 'text', value: query.trim() }, ...files] : files;
      }
      renderSuggestion(item: LinkSuggestion, el: HTMLElement) {
        if (item.kind === 'text') {
          const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(item.value);
          el.createDiv({ text: isUrl ? `Link to ${item.value}` : `Link to "${item.value}"` });
          el.createDiv({ cls: 'suggestion-note', text: isUrl ? 'Web address' : 'A note by this name, created when you follow the link' });
        } else {
          el.createDiv({ text: item.file.basename });
          el.createDiv({ cls: 'suggestion-note', text: item.file.path });
        }
      }
      onChooseSuggestion(item: LinkSuggestion) {
        chosen = true;
        if (item.kind === 'file') {
          resolve(`[[${app.metadataCache.fileToLinktext(item.file, sourcePath, true)}]]`);
        } else {
          resolve(/^[a-z][a-z0-9+.-]*:/i.test(item.value) || /^\[\[.*\]\]$/.test(item.value) ? item.value : `[[${item.value}]]`);
        }
      }
      override onClose() {
        window.setTimeout(() => {
          if (!chosen) resolve(null);
        }, 0);
      }
    })(app);
    modal.setPlaceholder(current ? `Linked to ${current}. Type a note, file or web address` : 'Type a note, file or web address');
    modal.open();
  });
}

/** Ask where in the vault to save a file. Resolves the path, or null. */
export class SaveTargetModal extends Modal {
  private folder: string;
  private name: string;
  private done = false;

  constructor(app: App, suggestedName: string, folder: string, private readonly resolve: (path: string | null) => void) {
    super(app);
    this.folder = folder;
    this.name = suggestedName;
  }

  override onOpen() {
    const { contentEl } = this;
    this.setTitle('Save to vault');
    new Setting(contentEl).setName('Folder').addSearch((search) => {
      search.setValue(this.folder).onChange((value) => { this.folder = value.trim(); });
      new FolderSuggest(this.app, search.inputEl, (value) => {
        this.folder = value;
        search.setValue(value);
      });
    });
    new Setting(contentEl).setName('File name').addText((text) => {
      text.setValue(this.name).onChange((value) => { this.name = value.trim(); });
      text.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        const dot = this.name.lastIndexOf('.');
        text.inputEl.setSelectionRange(0, dot > 0 ? dot : this.name.length);
      }, 0);
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Save').setCta().onClick(() => this.submit()));
  }

  private submit() {
    const name = this.name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
    if (!name) return;
    const path = normalizePath(this.folder ? `${this.folder}/${name}` : name);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    const accept = () => {
      this.done = true;
      this.close();
      this.resolve(path);
    };
    if (!existing) accept();
    else void confirm(this.app, `${path} already exists. Replace it?`, 'Replace').then((ok) => ok && accept());
  }

  override onClose() {
    this.contentEl.empty();
    if (!this.done) this.resolve(null);
  }
}

/** Folder completion under an input. */
class FolderSuggest {
  private readonly listEl: HTMLDataListElement;
  constructor(app: App, input: HTMLInputElement, private readonly onPick: (value: string) => void) {
    const id = `vellum-folders-${Math.random().toString(36).slice(2, 8)}`;
    this.listEl = input.parentElement!.createEl('datalist', { attr: { id } });
    for (const folder of app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder)) {
      this.listEl.createEl('option', { attr: { value: folder.path === '/' ? '' : folder.path } });
    }
    input.setAttribute('list', id);
    input.addEventListener('change', () => this.onPick(input.value.trim()));
  }
}


/** A yes/no question. Resolves true when confirmed. */
export function confirm(app: App, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.contentEl.createEl('p', { text: message });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => modal.close()))
      .addButton((b) => b.setButtonText(action).setWarning().onClick(() => {
        answered = true;
        modal.close();
        resolve(true);
      }));
    modal.onClose = () => {
      if (!answered) resolve(false);
    };
    modal.open();
  });
}
