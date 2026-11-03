// A small API for other plugins and scripts (Templater, QuickAdd, Dataview):
//
//   const vellum = app.plugins.getPlugin('vellum')?.api;
//   const file = await vellum.createDiagram({ folder: 'Diagrams', name: 'Network' });
//   const svg = await vellum.exportImage(file, { format: 'svg' });

import type { TFile } from 'obsidian';
import { coreTag } from 'virtual:vellum-frame';
import type { ExportResult, StratumInfo, ViewMode } from '../shared/protocol';
import { createDiagram, isDiagram } from './files';
import type VellumPlugin from './main';
import type { RenderRequest } from './embed/renderer';

export interface VellumApi {
  /** Plugin and core versions. */
  readonly version: string;
  readonly coreVersion: string;
  isDiagram(file: TFile): boolean;
  /** Create a diagram file. `yaml` is a Vellum workspace or diagram. */
  createDiagram(options?: { folder?: string; name?: string; yaml?: string }): Promise<TFile>;
  openDiagram(file: TFile, options?: { mode?: ViewMode; newLeaf?: boolean }): Promise<void>;
  /** The diagram's YAML, including unsaved edits in an open view. */
  getSource(file: TFile): Promise<string | null>;
  exportImage(file: TFile, request?: Partial<RenderRequest>): Promise<ExportResult>;
  getStrata(file: TFile): StratumInfo[];
}

export function createApi(plugin: VellumPlugin): VellumApi {
  return {
    version: plugin.manifest.version,
    coreVersion: coreTag,
    isDiagram: (file) => isDiagram(plugin.app, file),
    createDiagram: (options = {}) => createDiagram(plugin.app, plugin.settings, options),
    async openDiagram(file, options = {}) {
      const leaf = plugin.app.workspace.getLeaf(options.newLeaf ? 'tab' : false);
      await leaf.openFile(file, { active: true, state: options.mode ? { mode: options.mode } : undefined });
    },
    getSource: (file) => plugin.readSource(file),
    exportImage: (file, request = {}) => plugin.renderer.render(file, { format: 'svg', ...request }),
    getStrata: (file) => plugin.strata.forDiagram(file.path).map(({ diagramPath: _, ...info }) => info),
  };
}
