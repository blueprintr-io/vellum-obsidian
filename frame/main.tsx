// Entry point of the editor frame. `./boot` must stay the first import: it
// installs the storage the core store reads while its module evaluates.
import { boot, host } from './boot';
import './files';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import './frame.css';
import { setUnsavedChangesPrompt } from '@/index';
import { Canvas } from '@/editor/canvas/Canvas';
import { useEditor } from '@/store/editor';
import { App } from './App';
import { frameApi } from './api';
import { installKeys } from './keys';

// The plugin saves the file; leaving the frame never needs a prompt.
setUnsavedChangesPrompt(false);
useEditor.getState().setReadOnly(boot.renderer || boot.mode === 'read');

// The plugin decides the theme (it follows Obsidian's by default), so it
// wins over the one in the saved preferences.
const applyTheme = () => {
  if (useEditor.getState().theme !== boot.theme) useEditor.getState().setTheme(boot.theme);
};
if (useEditor.persist.hasHydrated()) applyTheme();
else useEditor.persist.onFinishHydration(applyTheme);

const root = createRoot(document.getElementById('root')!);
if (boot.renderer) {
  // Renders exports for embeds: just the canvas, sized by the host.
  root.render(<div className="relative h-screen w-screen overflow-hidden bg-bg"><Canvas /></div>);
} else {
  installKeys();
  root.render(<StrictMode><App /></StrictMode>);
}

// Obsidian reloads an iframe whenever its leaf moves (another split, a new
// window). Hand over the workspace so edits from the last few seconds,
// not yet saved, are not lost.
window.addEventListener('pagehide', () => {
  if (!boot.renderer) host.unloading(frameApi.snapshot());
});

const ready = () => host.ready(frameApi);
if (useEditor.persist.hasHydrated()) ready();
else {
  const stop = useEditor.persist.onFinishHydration(() => {
    stop();
    ready();
  });
}
