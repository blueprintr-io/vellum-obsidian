// Runs the real plugin against the Obsidian stand-in in a browser page, with
// real editor frames, for the plugin integration tests.

import { App, Notice } from '../obsidian/obsidian';
import { installDomHelpers } from '../obsidian/dom';
import VellumPlugin from '../../src/main';
import type { VellumView } from '../../src/view';
import { DiagramEmbed } from '../../src/embed/embed';

installDomHelpers(window);

const app = new App();
const plugin = new VellumPlugin(app as never, { id: 'vellum', version: '0.0.0-test', dir: '.obsidian/plugins/vellum' } as never);

const harness = {
  app,
  plugin,
  notices: Notice.messages,
  async start(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) await app.vault.create(path, text);
    await app.metadataCache.settled();
    plugin.load();
    await plugin.ready;
    await app.metadataCache.settled();
    plugin.strata.build();
  },
  /** Open a file in a leaf laid out in the page. Resolves once the editor
   *  frame has loaded it. */
  async open(path: string, mode: 'edit' | 'read' = 'edit') {
    const leaf = app.workspace.getLeaf();
    const host = document.body.createDiv('leaf-host');
    host.style.cssText = 'position:absolute;left:0;top:0;width:1100px;height:720px;';
    leaf.host = host;
    await leaf.openFile(app.vault.getFileByPath(path)!, { state: { mode } });
    const view = leaf.view as VellumView;
    const started = performance.now();
    while (!(view.frame && view.frame.snapshot())) {
      if (performance.now() - started > 20000) throw new Error('The editor frame did not load the file.');
      await new Promise((r) => setTimeout(r, 25));
    }
    return app.workspace.leaves.length - 1;
  },
  view: (index = app.workspace.leaves.length - 1) => app.workspace.leaves[index].view as VellumView,
  text: (path: string) => app.vault.text(path),
  async write(path: string, text: string) {
    const file = app.vault.getFileByPath(path);
    if (file) await app.vault.modify(file, text);
    else await app.vault.create(path, text);
    await app.metadataCache.settled();
  },
  async embed(path: string, subpath = '') {
    const container = document.body.createDiv('internal-embed');
    container.style.cssText = 'position:absolute;left:0;top:760px;width:800px;';
    const embed = new DiagramEmbed(plugin, { containerEl: container, sourcePath: 'Note.md' }, app.vault.getFileByPath(path)! as never, subpath);
    embed.load();
    await embed.loadFile();
    return container.querySelectorAll('.vellum-hotspot').length;
  },
  hoverLinks: () => app.workspace.hoverLinks.length,
  opened: () => app.workspace.opened,
};

declare global {
  interface Window {
    ph: typeof harness;
  }
}
window.ph = harness;
