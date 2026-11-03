// Stratum actions from the editor's context menu, the strata list and read
// mode clicks.

import { Notice, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { StratumAction } from '../../shared/protocol';
import type { OpenTarget, VellumSettings } from '../settings';
import { isDiagram } from '../files';
import { NotePicker } from '../modals';
import type { StrataIndex } from './index';
import { attachNote, createStratum, detachNote } from './notes';
import { StratumWindows } from './window';

export class StrataActions {
  readonly windows: StratumWindows;
  private editLeaf: WorkspaceLeaf | null = null;

  constructor(
    private readonly app: App,
    private readonly index: StrataIndex,
    private readonly settings: () => VellumSettings,
  ) {
    this.windows = new StratumWindows(app, {
      edit: (path) => void this.edit(path),
      openInTab: (path) => void this.openNote(path, 'tab'),
    });
  }

  async run(diagram: TFile, action: StratumAction, owner: { containerEl: HTMLElement }) {
    try {
      switch (action.type) {
        case 'open':
          return this.open(diagram, action.path, action.shapeId, owner.containerEl);
        case 'edit':
          return await this.edit(action.path);
        case 'create': {
          const note = await createStratum(this.app, diagram, action, this.settings().strataNameFormat);
          return await this.edit(note.path);
        }
        case 'link-existing':
          return this.attachExisting(diagram, action.shapeId, action.tabId);
        case 'unlink':
          return await this.detach(action.path);
        case 'relink': {
          const note = this.app.vault.getFileByPath(action.path);
          if (note) await attachNote(this.app, note, diagram, action);
          return;
        }
      }
    } catch (error) {
      console.error('[vellum] stratum action failed', error);
      new Notice(`Could not complete that: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Read mode: show the stratum, with the shape's other strata a page away. */
  open(diagram: TFile, path: string, shapeId: string, around: HTMLElement) {
    const entry = this.index.get(path);
    const strata = this.index.forShape(diagram.path, shapeId, entry?.tabId);
    const target = this.settings().strataOpen;
    if (target === 'window' && strata.length) {
      this.windows.show(strata, Math.max(0, strata.findIndex((s) => s.path === path)), around);
      return;
    }
    void this.openNote(path, target === 'window' ? 'split' : target);
  }

  async edit(path: string) {
    await this.openNote(path, this.settings().strataEdit, true);
  }

  private async openNote(path: string, target: Exclude<OpenTarget, 'window'>, reuse = false) {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice(`${path} no longer exists.`);
      return;
    }
    let leaf: WorkspaceLeaf;
    if (target === 'split') {
      // Editing one stratum after another reuses the same split.
      const kept = reuse && this.editLeaf && this.isOpen(this.editLeaf) ? this.editLeaf : null;
      leaf = kept ?? this.app.workspace.getLeaf('split', 'vertical');
      if (reuse) this.editLeaf = leaf;
    } else {
      leaf = this.app.workspace.getLeaf(target === 'tab' ? 'tab' : false);
    }
    await leaf.openFile(file, { active: true, state: { mode: 'source' } });
  }

  private isOpen(leaf: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((l) => {
      if (l === leaf) found = true;
    });
    return found;
  }

  private attachExisting(diagram: TFile, shapeId: string, tabId: string) {
    const folder = diagram.parent?.path ?? '';
    const candidates = this.app.vault.getMarkdownFiles().filter((file) =>
      (file.parent?.path ?? '') === folder && !isDiagram(this.app, file) && !this.index.get(file.path));
    if (!candidates.length) {
      new Notice('No unattached notes in this diagram\'s folder. Strata are notes kept beside their diagram.');
      return;
    }
    new NotePicker(this.app, candidates, 'Attach a note from this folder', (note) => {
      void attachNote(this.app, note, diagram, { shapeId, tabId }).then(() => new Notice(`Attached ${note.basename}`));
    }).open();
  }

  private async detach(path: string) {
    const note = this.app.vault.getFileByPath(path);
    if (!note) return;
    await detachNote(this.app, note);
    new Notice(`Detached ${note.basename}. The note is kept.`);
  }
}
