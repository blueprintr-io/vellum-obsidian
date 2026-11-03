import { MarkdownView, Notice, Platform, type Command } from 'obsidian';
import { convertDiagram, diagramName, emptyWorkspaceYaml, isDiagram, isMarkdownDiagram } from './files';
import { composeMarkdownDiagram, parseMarkdownDiagram } from './format';
import { pickFile } from './modals';
import type VellumPlugin from './main';
import { VellumView } from './view';

export function registerCommands(plugin: VellumPlugin) {
  const { app } = plugin;
  const add = (command: Command) => plugin.addCommand(command);

  /** A command that needs an open diagram view. */
  const withView = (id: string, name: string, run: (view: VellumView) => unknown, when: (view: VellumView) => boolean = () => true) =>
    add({
      id,
      name,
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(VellumView);
        if (!view?.file || !when(view)) return false;
        if (!checking) void run(view);
        return true;
      },
    });

  add({ id: 'new-diagram', name: 'Create new diagram in a new tab', callback: () => void plugin.newDiagram('tab') });
  add({ id: 'new-diagram-here', name: 'Create new diagram in the current tab', callback: () => void plugin.newDiagram('current') });
  add({ id: 'new-diagram-split', name: 'Create new diagram to the right', callback: () => void plugin.newDiagram('split') });
  if (!Platform.isMobile) {
    add({ id: 'new-diagram-window', name: 'Create new diagram in a new window', callback: () => void plugin.newDiagram('window') });
  }
  add({
    id: 'new-diagram-embed',
    name: 'Create new diagram and embed it here',
    editorCheckCallback: (checking, _editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || isDiagram(app, ctx.file)) return false;
      if (!checking) void plugin.newDiagram('split', { embedIn: ctx });
      return true;
    },
  });
  add({
    id: 'embed-diagram',
    name: 'Embed a diagram here',
    editorCheckCallback: (checking, editor, ctx) => {
      if (!ctx.file || isDiagram(app, ctx.file)) return false;
      if (checking) return true;
      const source = ctx.file;
      const diagrams = app.vault.getFiles().filter((f) => isDiagram(app, f));
      void pickFile(app, diagrams, 'Embed a diagram').then((file) => {
        if (!file) return;
        const link = app.fileManager.generateMarkdownLink(file, source.path);
        editor.replaceSelection(link.startsWith('!') ? link : `!${link}`);
      });
      return true;
    },
  });
  add({
    id: 'open-diagram',
    name: 'Open a diagram',
    callback: () => {
      const diagrams = app.vault.getFiles().filter((f) => isDiagram(app, f));
      void pickFile(app, diagrams, 'Open a diagram').then((file) => file && app.workspace.getLeaf(false).openFile(file));
    },
  });

  withView('toggle-read-only', 'Toggle read-only mode', (view) => view.setMode(view.mode === 'edit' ? 'read' : 'edit'));
  withView('show-strata', 'Show strata', (view) => view.frame?.togglePanel());
  withView('show-clickable', 'Show clickable shapes', (view) => view.frame?.pulse());
  withView('add-stratum', 'Add stratum to the selected shape', (view) => {
    const selection = view.frame?.selection();
    if (!selection || selection.shapeIds.length !== 1) {
      new Notice('Select one shape first.');
      return;
    }
    void plugin.strataActions.run(view.file!, { type: 'create', shapeId: selection.shapeIds[0], tabId: selection.tabId, label: selection.labels[0] ?? '' }, view);
  }, (view) => view.mode === 'edit');
  withView('copy-shape-link', 'Copy link to the selected shape', (view) => {
    const selection = view.frame?.selection();
    if (!selection || selection.shapeIds.length !== 1) {
      new Notice('Select one shape first.');
      return;
    }
    void plugin.copyShapeLink(view, view.file!, selection.shapeIds[0], selection.tabId);
  });
  withView('insert-image', 'Insert image from vault', (view) => plugin.insertFromVault(view, 'image', null), (view) => view.mode === 'edit');
  withView('insert-note-link', 'Insert link to a note', (view) => plugin.insertFromVault(view, 'note-link', null), (view) => view.mode === 'edit');
  withView('insert-diagram', 'Insert diagram from vault', (view) => plugin.insertFromVault(view, 'diagram', null), (view) => view.mode === 'edit');
  withView('export-svg', 'Export as SVG', (view) => plugin.exporter.exportFile(view, 'svg'));
  withView('export-png', 'Export as PNG', (view) => plugin.exporter.exportFile(view, 'png'));
  withView('copy-embed-link', 'Copy embed link', (view) => plugin.copyEmbedLink(view.file!));
  withView('open-as-markdown', 'Open as Markdown', (view) => plugin.openAsMarkdown(view.leaf), (view) => view.file?.extension === 'md');

  add({
    id: 'open-as-diagram',
    name: 'Open as diagram',
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file || !isMarkdownDiagram(app, view.file)) return false;
      if (!checking) void plugin.openAsDiagram(view.leaf);
      return true;
    },
  });

  const convert = (id: string, name: string, to: 'markdown' | 'vellum') => add({
    id,
    name,
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file || !isDiagram(app, file) || (to === 'markdown') !== (file.extension === 'vellum')) return false;
      if (!checking) {
        void (async () => {
          const view = app.workspace.getActiveViewOfType(VellumView);
          if (view?.file === file) await view.save();
          try {
            const { notes } = await convertDiagram(app, file, to, plugin.settings.compressSource);
            new Notice(notes ? `Converted. The notes beside the diagram moved to ${notes.path}.` : 'Converted.');
          } catch (error) {
            new Notice(`Could not convert: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }
      return true;
    },
  });
  convert('convert-to-markdown', 'Convert to a Markdown diagram (.vellum.md)', 'markdown');
  convert('convert-to-vellum', 'Convert to a Vellum file (.vellum)', 'vellum');

  add({
    id: 'convert-note',
    name: 'Turn this note into a diagram',
    checkCallback: (checking) => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!view || !file || isDiagram(app, file)) return false;
      if (!checking) {
        void app.vault.process(file, (text) => {
          const page = parseMarkdownDiagram(text);
          return composeMarkdownDiagram(page, { yaml: emptyWorkspaceYaml(diagramName(file)), text: [], links: [], extra: [] }, { compress: plugin.settings.compressSource });
        }).then(() => plugin.openAsDiagram(view.leaf));
      }
      return true;
    },
  });
}
