import { setIcon } from 'obsidian';
import type { StratumKind } from '../../shared/protocol';

const ICONS: Record<StratumKind, string> = {
  note: 'file-text',
  code: 'code',
  diagram: 'shapes',
  image: 'image',
  embed: 'globe',
};

export function stratumIcon(el: HTMLElement, kind: StratumKind) {
  setIcon(el, ICONS[kind] ?? ICONS.note);
}
