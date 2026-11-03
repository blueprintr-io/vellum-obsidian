import type { ViewMode } from '../shared/protocol';

export type DiagramFormat = 'markdown' | 'vellum';
export type ThemeSetting = 'obsidian' | 'light' | 'dark';
export type OpenTarget = 'window' | 'split' | 'tab' | 'current';
export type AutoExport = 'none' | 'svg' | 'png' | 'both';

export interface VellumSettings {
  /** Folder for new diagrams. Empty: the vault root. */
  folder: string;
  /** New diagrams go next to the active note instead of into `folder`. */
  folderBesideActiveNote: boolean;
  /** Moment.js pattern; the date part of a new diagram's name. */
  filenameFormat: string;
  filenamePrefix: string;
  format: DiagramFormat;
  /** A diagram file new diagrams start from. */
  template: string;
  defaultMode: ViewMode;
  theme: ThemeSetting;
  compressSource: boolean;

  /** Embedded diagrams follow Obsidian's theme instead of their own. */
  embedFollowsTheme: boolean;
  embedWidth: string;
  /** Strata and links in embedded diagrams can be clicked. */
  embedInteractive: boolean;

  autoExport: AutoExport;
  exportTheme: ThemeSetting;
  exportTransparent: boolean;
  exportScale: number;

  strataNameFormat: string;
  /** Where a stratum opens from read mode and embeds. */
  strataOpen: OpenTarget;
  /** Where Edit stratum opens the note. */
  strataEdit: Exclude<OpenTarget, 'window'>;
  strataHoverCard: boolean;
  strataHoverDelay: number;
  /** Move strata notes when their diagram moves to another folder. */
  strataFollowDiagram: boolean;
}

export const DEFAULT_SETTINGS: VellumSettings = {
  folder: '',
  folderBesideActiveNote: false,
  filenameFormat: 'YYYY-MM-DD HH.mm.ss',
  filenamePrefix: 'Diagram ',
  format: 'markdown',
  template: '',
  defaultMode: 'edit',
  theme: 'obsidian',
  compressSource: false,

  embedFollowsTheme: true,
  embedWidth: '',
  embedInteractive: true,

  autoExport: 'none',
  exportTheme: 'light',
  exportTransparent: false,
  exportScale: 2,

  strataNameFormat: '{{diagram}} - {{shape}}',
  strataOpen: 'window',
  strataEdit: 'split',
  strataHoverCard: true,
  strataHoverDelay: 500,
  strataFollowDiagram: true,
};

const ENUMS: Partial<Record<keyof VellumSettings, readonly string[]>> = {
  format: ['markdown', 'vellum'],
  defaultMode: ['edit', 'read'],
  theme: ['obsidian', 'light', 'dark'],
  autoExport: ['none', 'svg', 'png', 'both'],
  exportTheme: ['obsidian', 'light', 'dark'],
  strataOpen: ['window', 'split', 'tab', 'current'],
  strataEdit: ['split', 'tab', 'current'],
};

/** Settings read from disk, with unknown keys dropped and every value
 *  checked against the default's type, so a hand-edited or older
 *  data.json cannot break the plugin. */
export function sanitizeSettings(raw: unknown): VellumSettings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const value = input[key];
    if (typeof value !== typeof fallback) continue;
    const allowed = ENUMS[key as keyof VellumSettings];
    if (allowed && !allowed.includes(value as string)) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  out.exportScale = Math.min(4, Math.max(1, out.exportScale as number));
  out.strataHoverDelay = Math.min(3000, Math.max(0, out.strataHoverDelay as number));
  return out as unknown as VellumSettings;
}
