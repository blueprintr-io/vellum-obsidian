import type { ReactNode } from 'react';

/** Matches the look of core's top-right chrome buttons. */
export function ToolbarButton({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center justify-center w-[34px] p-[7px] rounded-lg border ${
        active ? 'border-accent/40 bg-bg-emphasis' : 'border-border bg-bg/[0.92]'
      } backdrop-blur-chrome text-fg shadow-[0_2px_8px_rgb(0_0_0_/_0.12)] hover:bg-bg-emphasis transition-colors duration-100`}
    >
      {children}
    </button>
  );
}
