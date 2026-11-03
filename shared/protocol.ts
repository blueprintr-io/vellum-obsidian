// The contract between the plugin (running in Obsidian) and the editor frame
// (an iframe running Vellum core). Both sides share one origin, so calls are
// direct function calls on objects the other side hands over. Keep every
// argument plain data: arrays, objects and primitives created in one realm
// are read safely in the other, while `instanceof` checks are not.
//
// Bump FRAME_PROTOCOL when a change needs both sides rebuilt together. The
// frame refuses to start against a host that speaks another version.

export const FRAME_PROTOCOL = 1;

export type ViewMode = 'edit' | 'read';
export type ThemeName = 'light' | 'dark';

/** What a stratum note holds, as recorded in its `vellum-kind` property. */
export type StratumKind = 'note' | 'code' | 'diagram' | 'image' | 'embed';

export interface StratumInfo {
  /** Vault path of the note. */
  path: string;
  title: string;
  kind: StratumKind;
  shapeId: string;
  /** Diagram tab the shape lives in. Absent: any tab with that shape id. */
  tabId?: string;
}

/** A rectangle in the coordinates of the window that reports it. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointerInfo {
  x: number;
  y: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** One line of the searchable text index written into Markdown diagrams. */
export interface TextEntry {
  /** Block id, unique within the file, derived from the shape id. */
  block: string;
  shapeId: string;
  tabId: string;
  text: string;
}

/** An explicit link set on a shape (not one typed into its label). */
export interface LinkEntry {
  block: string;
  shapeId: string;
  tabId: string;
  link: string;
}

export interface DiagramSnapshot {
  yaml: string;
  text: TextEntry[];
  links: LinkEntry[];
  /** Searchable text that belongs to no shape: connector labels, comments
   *  and tab titles. */
  extra: string[];
  /** Pass back to `markSaved` once this snapshot is on disk. */
  token: number;
}

/** A persisted store slice exactly as core's recovery storage wrote it, so
 *  core's own version handling applies when it is read back. */
export interface StoredSlice<T> {
  state: T;
  version: number;
}

/** Index sections read back from a Markdown diagram, keyed by block id. */
export interface IndexSections {
  text: Record<string, string>;
  links: Record<string, string>;
}

export interface ExportRequest {
  format: 'svg' | 'png';
  theme?: ThemeName;
  /** `paper`, `white` or a CSS colour; `null` exports a transparent image. */
  background?: string | null;
  scale?: number;
  padding?: number;
  /** Diagram tab to export, by id or title. Default: the active tab. */
  tab?: string;
  /** Crop to these shapes and what they contain. */
  shapeIds?: string[];
  /** Crop to one shape, by block id or shape id, on whichever tab has it. */
  shape?: string;
  embedFonts?: boolean;
}

export interface Hotspot {
  shapeId: string;
  /** The shape's link, when it has one. */
  link: string | null;
  /** Position as a fraction of the exported image, so it scales with it. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportResult {
  format: 'svg' | 'png';
  /** SVG markup, or a PNG data URL. */
  data: string;
  width: number;
  height: number;
  hotspots: Hotspot[];
}

export interface FrameBoot {
  protocol: number;
  mode: ViewMode;
  theme: ThemeName;
  /** Editor preferences shared by every frame. */
  preferences: StoredSlice<Record<string, unknown>> | null;
  /** The personal library, shared by every frame. */
  library: StoredSlice<unknown[]> | null;
  /** File name shown by the editor and offered by "Save a copy". */
  fileName: string;
  /** A frame that only renders exports for embeds: no chrome, no saving. */
  renderer: boolean;
}

export type StratumAction =
  | { type: 'open'; path: string; shapeId: string }
  | { type: 'edit'; path: string }
  | { type: 'create'; shapeId: string; tabId: string; label: string }
  | { type: 'link-existing'; shapeId: string; tabId: string; label: string }
  | { type: 'unlink'; path: string }
  | { type: 'relink'; path: string; shapeId: string; tabId: string };

export type LinkAction =
  | { type: 'open'; link: string; newLeaf: boolean }
  | { type: 'edit'; shapeId: string; current: string | null }
  | { type: 'copy-shape-link'; shapeId: string; tabId: string };

export type InsertAction = 'image' | 'note-link' | 'diagram';

/** Implemented by the plugin, called by the frame. */
export interface HostApi {
  readonly protocol: number;
  boot(): FrameBoot;
  ready(frame: FrameApi): void;
  /** The workspace changed. The host marks its file view dirty. */
  changed(): void;
  /** Write the current workspace to the file now. Resolves once written. */
  save(): Promise<void>;
  /** Core replaced the whole workspace (New, Open, an import). The file is
   *  left alone; the host decides where the replacement goes, and loads
   *  `previous` (the file's workspace as it stood) back. */
  replaced(yaml: string, suggestedName: string | null, previous: string): void;
  savePreferences(preferences: StoredSlice<Record<string, unknown>>): void;
  saveLibrary(library: StoredSlice<unknown[]>): void;
  focused(): void;
  setMode(mode: ViewMode): void;
  stratum(action: StratumAction): void;
  link(action: LinkAction): void;
  insert(action: InsertAction, at: { x: number; y: number } | null): void;
  hoverStratum(path: string, rect: Rect, pointer: PointerInfo): void;
  hoverLink(link: string, rect: Rect, pointer: PointerInfo): void;
  hoverEnd(): void;
  /** Pick a vault file for core's Open and import dialogs. */
  pickFile(extensions: string[]): Promise<{ name: string; type: string; data: ArrayBuffer } | null>;
  /** Ask where in the vault to save a file core exports. Null: cancelled. */
  chooseSaveTarget(suggestedName: string): Promise<string | null>;
  writeFile(path: string, data: ArrayBuffer): Promise<void>;
  /** Whether a drag from Obsidian (files or links from the file explorer,
   *  search or a note) is under way. */
  dragActive(): boolean;
  /** Drop what is being dragged from Obsidian at a world point. */
  drop(at: { x: number; y: number }): void;
  /** A key the editor did not handle, for Obsidian's hotkeys. */
  key(event: KeyInit): void;
  notice(message: string): void;
  /** The frame is going away (its iframe was moved or removed). Carries the
   *  workspace as it stands so unsaved edits survive a reload. */
  unloading(snapshot: DiagramSnapshot | null): void;
}

export interface KeyInit {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

/** Implemented by the frame, called by the plugin. */
export interface FrameApi {
  /** Load file contents. Returns an error message instead of throwing.
   *  `dirty` marks the loaded state unsaved (a rescued workspace). */
  load(yaml: string, options: { fileName?: string; sections?: IndexSections; fit?: boolean; keepHistory?: boolean; dirty?: boolean }): string | null;
  /** Block id of a shape, for links to it. */
  blockId(shapeId: string, tabId: string): string | null;
  togglePanel(): void;
  /** The workspace as it stands, or null while nothing is loaded or the
   *  editor holds a workspace that does not belong to the file. */
  snapshot(): DiagramSnapshot | null;
  markSaved(token: number): void;
  isDirty(): boolean;
  setMode(mode: ViewMode): void;
  setTheme(theme: ThemeName): void;
  setStrata(strata: StratumInfo[]): void;
  setPreferences(preferences: Record<string, unknown>): void;
  setLibrary(library: unknown[]): void;
  setShapeLink(shapeId: string, link: string | null): void;
  /** Replace link targets (old linkpath -> new linkpath). Returns whether
   *  anything changed. */
  rewriteLinks(renames: Record<string, string>): boolean;
  /** Take renamed links from a Markdown diagram's index sections. */
  reconcile(sections: IndexSections): boolean;
  /** Pan to a shape (by id or block id) and select it in edit mode. */
  reveal(target: string): boolean;
  /** Briefly highlight every clickable shape. */
  pulse(): void;
  insertImage(name: string, type: string, data: ArrayBuffer, at: { x: number; y: number } | null, link?: string): Promise<void>;
  insertLinkShape(label: string, link: string, at: { x: number; y: number } | null): void;
  /** World point under a frame client coordinate. */
  worldAt(clientX: number, clientY: number): { x: number; y: number };
  selection(): { shapeIds: string[]; labels: string[]; tabId: string };
  exportImage(request: ExportRequest): Promise<ExportResult>;
  /** Parse, rewrite links in and serialize YAML without touching the loaded
   *  workspace. Used for files that are not open. */
  transformYaml(yaml: string, renames: Record<string, string>): { yaml: string; snapshot: DiagramSnapshot } | null;
  /** Index data for YAML that is not loaded, for Markdown diagram sections. */
  indexYaml(yaml: string): DiagramSnapshot | null;
  focus(): void;
}

declare global {
  interface HTMLIFrameElement {
    vellumHost?: HostApi;
  }
}
