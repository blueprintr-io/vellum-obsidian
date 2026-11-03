// Icons for the frame's own chrome, drawn to match core's set (16px box,
// 1.25 stroke). Core's `I` covers the editor's tools; these cover strata,
// links and the view modes.

import type { ReactNode } from 'react';
import type { StratumKind } from '../shared/protocol';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const FrameIcon = {
  strata: () => (
    <Icon>
      <path d="M8 2.5 14 5.5 8 8.5 2 5.5Z" fill="currentColor" fillOpacity="0.12" />
      <path d="M2 8.25 8 11.25 14 8.25" />
      <path d="M2 11 8 14 14 11" />
    </Icon>
  ),
  reveal: () => (
    <Icon>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  ),
  edit: () => (
    <Icon>
      <path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5V10.5Z" />
      <path d="M9 4 12 7" />
    </Icon>
  ),
  read: () => (
    <Icon>
      <path d="M2.5 3.5H6.5A1.5 1.5 0 0 1 8 5V13A1.2 1.2 0 0 0 6.8 11.8H2.5Z" />
      <path d="M13.5 3.5H9.5A1.5 1.5 0 0 0 8 5V13A1.2 1.2 0 0 1 9.2 11.8H13.5Z" />
    </Icon>
  ),
  link: () => (
    <Icon>
      <path d="M7 9A2.5 2.5 0 0 0 10.5 9L12.5 7A2.5 2.5 0 0 0 9 3.5L8.25 4.25" />
      <path d="M9 7A2.5 2.5 0 0 0 5.5 7L3.5 9A2.5 2.5 0 0 0 7 12.5L7.75 11.75" />
    </Icon>
  ),
  open: () => (
    <Icon>
      <path d="M9 2.5H13.5V7" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M12 9.5V13A1 1 0 0 1 11 14H3.5A1 1 0 0 1 2.5 13V5.5A1 1 0 0 1 3.5 4.5H7" />
    </Icon>
  ),
  locate: () => (
    <Icon>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1.5V3.5M8 12.5V14.5M1.5 8H3.5M12.5 8H14.5" />
    </Icon>
  ),
  close: () => (
    <Icon>
      <path d="M4 4 12 12M12 4 4 12" />
    </Icon>
  ),
  plus: () => (
    <Icon>
      <path d="M8 3V13M3 8H13" />
    </Icon>
  ),
};

const KIND_ICONS: Record<StratumKind, () => ReactNode> = {
  note: () => (
    <Icon>
      <path d="M4 1.5H9.5L12.5 4.5V14.5H4Z" />
      <path d="M9.5 1.5V4.5H12.5M6 8H10.5M6 10.5H10.5" />
    </Icon>
  ),
  code: () => (
    <Icon>
      <path d="M5.5 4.5 2 8 5.5 11.5M10.5 4.5 14 8 10.5 11.5" />
    </Icon>
  ),
  diagram: () => (
    <Icon>
      <rect x="2" y="2.5" width="5" height="4" rx="0.75" />
      <rect x="9" y="9.5" width="5" height="4" rx="0.75" />
      <path d="M4.5 6.5V11.5H9" />
    </Icon>
  ),
  image: () => (
    <Icon>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M2.5 12 6 8.5 8.5 11 10.5 9 13.5 12" />
    </Icon>
  ),
  embed: () => (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8H14" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6" />
    </Icon>
  ),
};

export function KindIcon({ kind }: { kind: StratumKind }) {
  return <>{(KIND_ICONS[kind] ?? KIND_ICONS.note)()}</>;
}
