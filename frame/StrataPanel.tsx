// The list of strata attached to this diagram. Edit mode shows it in core's
// right dock; read mode shows it as a side panel of its own.

import { useMemo, useState } from 'react';
import { useEditor } from '@/store/editor';
import type { Shape } from '@/store/types';
import type { StratumInfo } from '../shared/protocol';
import { host } from './boot';
import { FrameIcon, KindIcon } from './icons';
import { revealShape } from './reveal';
import { useFrame } from './state';
import { shapeLabel } from './plugin';

const FILTER_FROM = 6;

function shapeName(shape: Shape | undefined): string {
  return shapeLabel(shape) || (shape ? shape.kind : '');
}

interface Row {
  stratum: StratumInfo;
  shape: Shape | undefined;
  tabId: string | null;
}

export function StrataPanel({ onClose }: { onClose?: () => void }) {
  const mode = useFrame((s) => s.mode);
  const strata = useFrame((s) => s.strata);
  const setActiveShapeId = useFrame((s) => s.setActiveShapeId);
  const diagram = useEditor((s) => s.diagram);
  const activeTabId = useEditor((s) => s.activeTabId);
  const tabSnapshots = useEditor((s) => s.tabSnapshots);
  const diagramTabs = useEditor((s) => s.diagramTabs);
  const selectedIds = useEditor((s) => s.selectedIds);
  const [query, setQuery] = useState('');

  const { here, elsewhere, missing, tabTitles } = useMemo(() => {
    const tabOf = (tabId: string) => (tabId === activeTabId ? diagram : tabSnapshots[tabId]?.diagram);
    const tabTitles = new Map(diagramTabs.map((t, i) => [t.id, tabOf(t.id)?.meta.title || `Tab ${i + 1}`]));
    const rows: Row[] = strata.map((stratum) => {
      const tabIds = stratum.tabId ? [stratum.tabId] : diagramTabs.map((t) => t.id);
      for (const tabId of tabIds) {
        const shape = tabOf(tabId)?.shapes.find((s) => s.id === stratum.shapeId);
        if (shape) return { stratum, shape, tabId };
      }
      return { stratum, shape: undefined, tabId: null };
    });
    const q = query.trim().toLowerCase();
    const visible = q
      ? rows.filter((r) => r.stratum.title.toLowerCase().includes(q) || shapeName(r.shape).toLowerCase().includes(q))
      : rows;
    return {
      here: visible.filter((r) => r.tabId === activeTabId),
      elsewhere: visible.filter((r) => r.tabId && r.tabId !== activeTabId),
      missing: visible.filter((r) => !r.tabId),
      tabTitles,
    };
  }, [strata, diagram, tabSnapshots, diagramTabs, activeTabId, query]);

  const selectedShape = selectedIds.length === 1 ? diagram.shapes.find((s) => s.id === selectedIds[0]) : undefined;

  const open = (row: Row) => {
    if (mode === 'read') host.stratum({ type: 'open', path: row.stratum.path, shapeId: row.stratum.shapeId });
    else host.stratum({ type: 'edit', path: row.stratum.path });
  };

  const renderRow = (row: Row) => (
    <li key={row.stratum.path}>
      <div
        role="button"
        tabIndex={0}
        className="group flex items-center gap-2 px-3 py-[7px] cursor-pointer hover:bg-bg-emphasis focus-visible:bg-bg-emphasis outline-none"
        onPointerEnter={() => row.tabId === activeTabId && setActiveShapeId(row.stratum.shapeId)}
        onPointerLeave={() => setActiveShapeId(null)}
        onFocus={() => row.tabId === activeTabId && setActiveShapeId(row.stratum.shapeId)}
        onBlur={() => setActiveShapeId(null)}
        onClick={() => (row.tabId ? revealShape(row.stratum.shapeId, row.tabId) : open(row))}
        onDoubleClick={() => open(row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open(row);
        }}
        title={row.tabId ? 'Click to show the shape, double-click to open' : 'Open'}
      >
        <span className="text-fg-muted shrink-0"><KindIcon kind={row.stratum.kind} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-fg">{row.stratum.title}</span>
          <span className="block truncate text-[10px] text-fg-muted">
            {!row.shape ? 'Shape not in this diagram' : row.tabId === activeTabId ? shapeName(row.shape) : `${shapeName(row.shape)} · ${tabTitles.get(row.tabId!)}`}
          </span>
        </span>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-fg-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-fg hover:bg-bg-subtle"
          title={mode === 'read' ? 'Open stratum' : 'Edit stratum'}
          onClick={(e) => {
            e.stopPropagation();
            open(row);
          }}
        >
          {mode === 'read' ? <FrameIcon.open /> : <FrameIcon.edit />}
        </button>
        {mode === 'edit' && !row.tabId && selectedShape && (
          <button
            type="button"
            className="shrink-0 rounded px-2 py-[3px] text-[10px] text-fg-muted border border-border hover:text-fg hover:bg-bg-subtle"
            title="Attach this stratum to the selected shape"
            onClick={(e) => {
              e.stopPropagation();
              host.stratum({ type: 'relink', path: row.stratum.path, shapeId: selectedShape.id, tabId: activeTabId });
            }}
          >
            Attach
          </button>
        )}
      </div>
    </li>
  );

  const heading = (text: string) => (
    <h4 className="px-3 pt-3 pb-1 font-mono text-[9px] uppercase tracking-[0.08em] text-fg-muted">{text}</h4>
  );

  const total = strata.length;
  return (
    <section className="flex h-full flex-col bg-bg text-fg" aria-label="Strata">
      <header className="flex items-center gap-2 border-b border-border px-3 py-[9px]">
        <span className="text-fg-muted"><FrameIcon.strata /></span>
        <h3 className="flex-1 text-[12px] font-semibold">Strata{total ? <span className="ml-1 font-normal text-fg-muted">{total}</span> : null}</h3>
        {onClose && (
          <button type="button" className="rounded p-1 text-fg-muted hover:text-fg hover:bg-bg-emphasis" title="Close" onClick={onClose}>
            <FrameIcon.close />
          </button>
        )}
      </header>
      {total >= FILTER_FROM && (
        <div className="border-b border-border px-3 py-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter strata"
            className="w-full rounded border border-border bg-bg-subtle px-2 py-[5px] text-[12px] text-fg outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {total === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-muted">
            {mode === 'edit'
              ? 'Right-click a shape and choose Add stratum to attach a note to it. Strata are saved as notes beside this diagram.'
              : 'No shapes in this diagram have strata yet.'}
          </p>
        ) : (
          <>
            {here.length > 0 && <ul>{here.map(renderRow)}</ul>}
            {elsewhere.length > 0 && (
              <>
                {heading('Other tabs')}
                <ul>{elsewhere.map(renderRow)}</ul>
              </>
            )}
            {missing.length > 0 && (
              <>
                {heading('Not attached to a shape')}
                <ul>{missing.map(renderRow)}</ul>
              </>
            )}
          </>
        )}
      </div>
      {mode === 'edit' && (
        <footer className="border-t border-border p-2">
          <button
            type="button"
            disabled={!selectedShape}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-[7px] text-[12px] text-fg hover:bg-bg-emphasis disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => selectedShape && host.stratum({ type: 'create', shapeId: selectedShape.id, tabId: activeTabId, label: shapeName(selectedShape) })}
            title={selectedShape ? 'Create a note for the selected shape' : 'Select one shape first'}
          >
            <FrameIcon.plus />
            Add stratum to selection
          </button>
        </footer>
      )}
    </section>
  );
}
