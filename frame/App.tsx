import { Component, useEffect, useLayoutEffect, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { VellumEditor } from '@/index';
import { useEditor } from '@/store/editor';
import { TEXT_SCALE_VAR } from '@/editor/text-scale';
import { CanvasInteractions } from './CanvasInteractions';
import { obsidianPlugin } from './plugin';
import { Reader } from './Reader';
import { useFrame } from './state';

const PLUGINS = [obsidianPlugin];

function useHydrated() {
  return useSyncExternalStore(
    (listener) => useEditor.persist.onFinishHydration(listener),
    () => useEditor.persist.hasHydrated(),
    () => false,
  );
}

/** The editor shell mirrors theme and text size onto <html>; read mode
 *  renders without that shell, so the frame does it for both. */
function useDocumentTheme() {
  const theme = useEditor((s) => s.theme);
  const scale = useEditor((s) => s.uiTextScale);
  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(TEXT_SCALE_VAR, String(scale));
  }, [scale]);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[vellum] the editor stopped', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-fg">
        <p className="text-[14px] font-semibold">The editor stopped because of an error.</p>
        <p className="max-w-[420px] text-[12px] text-fg-muted">{this.state.error.message}</p>
        <p className="max-w-[420px] text-[12px] text-fg-muted">Your file was not changed after the last save.</p>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-[7px] text-[12px] hover:bg-bg-emphasis"
          onClick={() => window.location.reload()}
        >
          Reload the editor
        </button>
      </div>
    );
  }
}

export function App() {
  const mode = useFrame((s) => s.mode);
  const hydrated = useHydrated();
  useDocumentTheme();
  return (
    <ErrorBoundary>
      {mode === 'edit' ? <VellumEditor plugins={PLUGINS} /> : hydrated ? <Reader /> : null}
      {hydrated && <CanvasInteractions />}
    </ErrorBoundary>
  );
}
