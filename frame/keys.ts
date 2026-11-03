// Keyboard handling between the editor and Obsidian.
//
// Key presses inside an iframe never reach Obsidian's hotkey handler, so a
// chord the editor leaves unhandled is passed up to the plugin, which
// replays it in Obsidian's window. A few chords mean something different
// here than in Vellum's own window: Cmd/Ctrl+S saves the file instead of
// opening the export dialog, and Cmd/Ctrl+O opens Obsidian's quick
// switcher rather than a file picker.

import { useEditor } from '@/store/editor';
import type { KeyInit } from '../shared/protocol';
import { host } from './boot';
import { useFrame } from './state';
import { worldAt } from './edit';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Meta', 'Alt', 'AltGraph', 'CapsLock']);
const TEXT_EDIT_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'backspace', 'delete', 'home', 'end']);

function init(e: KeyboardEvent): KeyInit {
  return { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Whether Obsidian should see a key the editor left alone. */
export function shouldForward(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, editable: boolean): boolean {
  if (MODIFIER_KEYS.has(e.key)) return false;
  const chord = e.ctrlKey || e.metaKey || e.altKey;
  if (!chord) return /^F\d{1,2}$/.test(e.key);
  if (editable && (e.ctrlKey || e.metaKey) && TEXT_EDIT_KEYS.has(e.key.toLowerCase())) return false;
  return true;
}

function zoomStep(factor: number) {
  const rect = document.querySelector('svg[data-vellum-canvas]')?.getBoundingClientRect();
  useEditor.getState().zoomBy(factor, { x: (rect?.width ?? window.innerWidth) / 2, y: (rect?.height ?? window.innerHeight) / 2 });
}

/** Read mode has no editor keymap; give it the view keys. */
function readModeKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return false;
  const store = useEditor.getState();
  if (e.key === '=' || e.key === '+') zoomStep(1.2);
  else if (e.key === '-') zoomStep(1 / 1.2);
  else if (e.key === '0') {
    const rect = document.querySelector('svg[data-vellum-canvas]')?.getBoundingClientRect();
    store.fitToContent(rect?.width ?? window.innerWidth, rect?.height ?? window.innerHeight);
  } else if (e.key === '1') store.setZoom(1);
  else return false;
  return true;
}

export function installKeys() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && key === 's') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (useFrame.getState().mode === 'edit') void host.save();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && key === 'o') {
      e.preventDefault();
      e.stopImmediatePropagation();
      host.key(init(e));
      return;
    }
    if (useFrame.getState().mode === 'read' && readModeKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // Decide after the editor has had its turn.
    const editable = isEditable(e.target);
    window.setTimeout(() => {
      if (!e.defaultPrevented && shouldForward(e, editable)) host.key(init(e));
    }, 0);
  }, true);

  // Files and links dragged from Obsidian carry no files core can read, so
  // the plugin inserts them. Desktop files still go to core's own drop.
  const fromObsidian = (e: DragEvent) =>
    useFrame.getState().mode === 'edit' && !!e.dataTransfer && !e.dataTransfer.types.includes('Files') && host.dragActive();
  window.addEventListener('dragover', (e) => {
    if (!fromObsidian(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'copy';
  }, true);
  window.addEventListener('drop', (e) => {
    if (!fromObsidian(e)) return;
    e.preventDefault();
    e.stopPropagation();
    host.drop(worldAt(e.clientX, e.clientY));
  }, true);

  // A press inside the frame makes this view Obsidian's active one; the
  // event never reaches Obsidian's own window.
  window.addEventListener('pointerdown', () => host.focused(), true);
  window.addEventListener('focus', () => host.focused());
}
