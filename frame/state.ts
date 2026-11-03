// State that belongs to the Obsidian frame rather than to the diagram:
// the view mode, the strata linked to this file, and transient highlights.

import { create } from 'zustand';
import type { StratumInfo, ViewMode } from '../shared/protocol';
import { boot } from './boot';

interface FrameState {
  mode: ViewMode;
  strata: StratumInfo[];
  /** Shape highlighted from outside the canvas, such as a strata list row. */
  activeShapeId: string | null;
  /** Read mode's strata list. Edit mode uses core's right dock instead. */
  readerPanelOpen: boolean;
  /** Incremented to replay the "show clickable shapes" pulse. */
  pulseTick: number;
  setActiveShapeId: (id: string | null) => void;
  setReaderPanelOpen: (open: boolean) => void;
}

export const useFrame = create<FrameState>()((set) => ({
  mode: boot.mode,
  strata: [],
  activeShapeId: null,
  readerPanelOpen: false,
  pulseTick: 0,
  setActiveShapeId: (activeShapeId) => set({ activeShapeId }),
  setReaderPanelOpen: (readerPanelOpen) => set({ readerPanelOpen }),
}));
