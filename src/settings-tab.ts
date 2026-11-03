import { PluginSettingTab, Setting, type App } from 'obsidian';
import { coreCommit, coreTag } from 'virtual:vellum-frame';
import type VellumPlugin from './main';
import { DEFAULT_SETTINGS, type VellumSettings } from './settings';

export class VellumSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VellumPlugin) {
    super(app, plugin);
  }

  private set<K extends keyof VellumSettings>(key: K, value: VellumSettings[K]) {
    this.plugin.settings = { ...this.plugin.settings, [key]: value };
    void this.plugin.saveSettings();
  }

  override display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName('New diagrams').setHeading();
    new Setting(containerEl)
      .setName('Format')
      .setDesc('Markdown diagrams (.vellum.md) take part in search, backlinks and the graph, and can hold notes beside the diagram. Plain .vellum files can also be opened outside Obsidian.')
      .addDropdown((d) => d
        .addOption('markdown', 'Markdown diagram (.vellum.md)')
        .addOption('vellum', 'Vellum file (.vellum)')
        .setValue(s.format)
        .onChange((v) => this.set('format', v as VellumSettings['format'])));
    new Setting(containerEl)
      .setName('Folder')
      .setDesc('Where new diagrams are created. Leave empty for the vault root.')
      .addText((t) => t.setPlaceholder('Diagrams').setValue(s.folder).onChange((v) => this.set('folder', v.trim())));
    new Setting(containerEl)
      .setName('Create beside the active note')
      .setDesc('Put new diagrams in the folder of the note you are working in, instead of the folder above.')
      .addToggle((t) => t.setValue(s.folderBesideActiveNote).onChange((v) => this.set('folderBesideActiveNote', v)));
    new Setting(containerEl)
      .setName('Name prefix')
      .addText((t) => t.setValue(s.filenamePrefix).onChange((v) => this.set('filenamePrefix', v)));
    new Setting(containerEl)
      .setName('Date format')
      .setDesc('Moment.js format for the date after the prefix. Leave empty for no date.')
      .addMomentFormat((m) => m.setDefaultFormat(DEFAULT_SETTINGS.filenameFormat).setValue(s.filenameFormat).onChange((v) => this.set('filenameFormat', v)));
    new Setting(containerEl)
      .setName('Template')
      .setDesc('A diagram new diagrams start as a copy of.')
      .addText((t) => t.setPlaceholder('Templates/Diagram.vellum.md').setValue(s.template).onChange((v) => this.set('template', v.trim())));

    new Setting(containerEl).setName('Editor').setHeading();
    new Setting(containerEl)
      .setName('Open diagrams in')
      .setDesc('A diagram can also choose for itself with the property vellum-mode: read or edit.')
      .addDropdown((d) => d
        .addOption('edit', 'Edit mode')
        .addOption('read', 'Read-only mode')
        .setValue(s.defaultMode)
        .onChange((v) => this.set('defaultMode', v as VellumSettings['defaultMode'])));
    new Setting(containerEl)
      .setName('Theme')
      .addDropdown((d) => d
        .addOption('obsidian', 'Follow Obsidian')
        .addOption('light', 'Light')
        .addOption('dark', 'Dark')
        .setValue(s.theme)
        .onChange((v) => this.set('theme', v as VellumSettings['theme'])));
    new Setting(containerEl)
      .setName('Compress the diagram source')
      .setDesc('Store the YAML in Markdown diagrams compressed. Keeps very large diagrams out of search results, at the cost of readable diffs.')
      .addToggle((t) => t.setValue(s.compressSource).onChange((v) => this.set('compressSource', v)));

    new Setting(containerEl).setName('Embeds').setHeading();
    new Setting(containerEl)
      .setName('Match Obsidian\'s theme')
      .setDesc('Draw embedded diagrams in the light or dark theme Obsidian is using.')
      .addToggle((t) => t.setValue(s.embedFollowsTheme).onChange((v) => this.set('embedFollowsTheme', v)));
    new Setting(containerEl)
      .setName('Default width')
      .setDesc('Width of embeds without a size, such as 600 or 100%. Leave empty for the diagram\'s own size.')
      .addText((t) => t.setPlaceholder('100%').setValue(s.embedWidth).onChange((v) => this.set('embedWidth', v.trim())));
    new Setting(containerEl)
      .setName('Clickable strata and links')
      .setDesc('Open a shape\'s stratum or link by clicking it in an embed.')
      .addToggle((t) => t.setValue(s.embedInteractive).onChange((v) => this.set('embedInteractive', v)));

    new Setting(containerEl).setName('Export').setHeading();
    new Setting(containerEl)
      .setName('Export images on save')
      .setDesc('Keep Name.vellum.svg or .png beside each diagram, updated as you edit. Useful for Obsidian Publish and other tools.')
      .addDropdown((d) => d
        .addOption('none', 'Off')
        .addOption('svg', 'SVG')
        .addOption('png', 'PNG')
        .addOption('both', 'SVG and PNG')
        .setValue(s.autoExport)
        .onChange((v) => this.set('autoExport', v as VellumSettings['autoExport'])));
    new Setting(containerEl)
      .setName('Export theme')
      .addDropdown((d) => d
        .addOption('light', 'Light')
        .addOption('dark', 'Dark')
        .addOption('obsidian', 'Follow Obsidian')
        .setValue(s.exportTheme)
        .onChange((v) => this.set('exportTheme', v as VellumSettings['exportTheme'])));
    new Setting(containerEl)
      .setName('Transparent background')
      .addToggle((t) => t.setValue(s.exportTransparent).onChange((v) => this.set('exportTransparent', v)));
    new Setting(containerEl)
      .setName('PNG scale')
      .addSlider((sl) => sl.setLimits(1, 4, 1).setValue(s.exportScale).setDynamicTooltip().onChange((v) => this.set('exportScale', v)));

    new Setting(containerEl).setName('Strata').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'A stratum is a note attached to a shape. In edit mode, right-click a shape to add a stratum or edit one. In read-only mode and in embeds, click the shape to open it. Strata are saved as notes beside their diagram.',
    });
    new Setting(containerEl)
      .setName('Note name')
      .setDesc('{{diagram}} and {{shape}} are replaced with the diagram\'s name and the shape\'s label.')
      .addText((t) => t.setValue(s.strataNameFormat).onChange((v) => this.set('strataNameFormat', v || DEFAULT_SETTINGS.strataNameFormat)));
    new Setting(containerEl)
      .setName('Clicking a shape opens its stratum in')
      .addDropdown((d) => d
        .addOption('window', 'A floating window')
        .addOption('split', 'A split to the right')
        .addOption('tab', 'A new tab')
        .addOption('current', 'The current tab')
        .setValue(s.strataOpen)
        .onChange((v) => this.set('strataOpen', v as VellumSettings['strataOpen'])));
    new Setting(containerEl)
      .setName('Edit stratum opens the note in')
      .addDropdown((d) => d
        .addOption('split', 'A split to the right')
        .addOption('tab', 'A new tab')
        .addOption('current', 'The current tab')
        .setValue(s.strataEdit)
        .onChange((v) => this.set('strataEdit', v as VellumSettings['strataEdit'])));
    new Setting(containerEl)
      .setName('Preview on hover')
      .setDesc('Show the start of a stratum when the pointer rests on its shape in read-only mode.')
      .addToggle((t) => t.setValue(s.strataHoverCard).onChange((v) => this.set('strataHoverCard', v)));
    new Setting(containerEl)
      .setName('Hover delay')
      .setDesc('Milliseconds before the preview appears.')
      .addSlider((sl) => sl.setLimits(0, 1500, 50).setValue(s.strataHoverDelay).setDynamicTooltip().onChange((v) => this.set('strataHoverDelay', v)));
    new Setting(containerEl)
      .setName('Move strata with their diagram')
      .setDesc('When a diagram moves to another folder, move the notes attached to it as well.')
      .addToggle((t) => t.setValue(s.strataFollowDiagram).onChange((v) => this.set('strataFollowDiagram', v)));

    new Setting(containerEl).setName('About').setHeading();
    new Setting(containerEl)
      .setName(`Vellum for Obsidian ${this.plugin.manifest.version}`)
      .setDesc(`Built on Vellum ${coreTag} (${coreCommit.slice(0, 7)}).`);
  }
}
