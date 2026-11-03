// Read-only mode: the canvas with pan and zoom, no editing chrome. Shapes
// with strata or links open them when clicked (see CanvasInteractions).

import { useRef, type CSSProperties } from 'react';
import { Canvas } from '@/editor/canvas/Canvas';
import { ZoomDock } from '@/editor/chrome/ZoomDock';
import { ReturnToContent } from '@/editor/chrome/ReturnToContent';
import { NoticeToast } from '@/editor/chrome/NoticeToast';
import { useChromeFit } from '@/editor/useChromeFit';
import { useEditor } from '@/store/editor';
import { host } from './boot';
import { FrameIcon } from './icons';
import { StrataPanel } from './StrataPanel';
import { useFrame } from './state';
import { useTargets } from './CanvasInteractions';
import { ToolbarButton } from './ui';

const PANEL_WIDTH = 300;
const TABS_HEIGHT = 34;

function TabSwitcher() {
  const tabs = useEditor((s) => s.diagramTabs);
  const activeTabId = useEditor((s) => s.activeTabId);
  const diagram = useEditor((s) => s.diagram);
  const snapshots = useEditor((s) => s.tabSnapshots);
  const switchTab = useEditor((s) => s.switchDiagramTab);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Diagram tabs" className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-1 overflow-x-auto border-t border-border bg-bg/[0.92] px-2 backdrop-blur-chrome" style={{ height: TABS_HEIGHT }}>
      {tabs.map((tab, i) => {
        const title = (tab.id === activeTabId ? diagram : snapshots[tab.id]?.diagram)?.meta.title || `Tab ${i + 1}`;
        const active = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => switchTab(tab.id)}
            className={`shrink-0 rounded px-3 py-1 text-[12px] ${active ? 'bg-bg-emphasis text-fg' : 'text-fg-muted hover:text-fg hover:bg-bg-subtle'}`}
          >
            {title}
          </button>
        );
      })}
    </nav>
  );
}

export function Reader() {
  const panelOpen = useFrame((s) => s.readerPanelOpen);
  const setPanelOpen = useFrame((s) => s.setReaderPanelOpen);
  const strataCount = useFrame((s) => s.strata.length);
  const tabCount = useEditor((s) => s.diagramTabs.length);
  const uiTextScale = useEditor((s) => s.uiTextScale);
  const { targets } = useTargets();
  const paneRef = useRef<HTMLDivElement | null>(null);
  useChromeFit(paneRef, panelOpen);

  const tabsHeight = tabCount > 1 ? TABS_HEIGHT : 0;
  const dockClear = Math.round(60 * uiTextScale);
  // The same layout variables the editor shell sets for its docks.
  const style = {
    '--vellum-dock-bottom-tight': `${tabsHeight + 14}px`,
    '--vellum-dock-bottom-edge': `${tabsHeight + 6}px`,
    '--vellum-dock-bottom-cta': `${tabsHeight + dockClear}px`,
    '--vellum-side-bottom': `${tabsHeight + dockClear + 10}px`,
    '--vellum-tabs-h': `${tabsHeight}px`,
  } as CSSProperties;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-[14px]" style={style}>
      <div ref={paneRef} className="absolute inset-y-0 left-0 overflow-hidden" style={{ right: panelOpen ? PANEL_WIDTH : 0 }}>
        <div className="absolute inset-0 overflow-hidden">
          <Canvas />
        </div>
        <div className="absolute right-[14px] top-[14px] z-20 flex gap-2">
          {targets.size > 0 && (
            <ToolbarButton title="Show clickable shapes" onClick={() => useFrame.setState((s) => ({ pulseTick: s.pulseTick + 1 }))}>
              <FrameIcon.reveal />
            </ToolbarButton>
          )}
          <ToolbarButton title={strataCount ? `Strata (${strataCount})` : 'Strata'} active={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
            <FrameIcon.strata />
          </ToolbarButton>
          <ToolbarButton title="Edit diagram" onClick={() => host.setMode('edit')}>
            <FrameIcon.edit />
          </ToolbarButton>
        </div>
        <ZoomDock />
        <ReturnToContent />
        <NoticeToast />
        <TabSwitcher />
      </div>
      {panelOpen && (
        <div className="absolute inset-y-0 right-0 z-[15] border-l border-border" style={{ width: PANEL_WIDTH }}>
          <StrataPanel onClose={() => setPanelOpen(false)} />
        </div>
      )}
    </div>
  );
}
