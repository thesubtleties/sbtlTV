import { createContext } from 'react';
import type { StoredProgram } from '../db';

/** The guide's one hover card: a block (or a channel's on-now line) asks for it, the guide shows it after a beat. */
export interface GuideHoverApi {
  /** `x`: the pointer's x, where the card opens (kept inside the window) */
  show: (program: StoredProgram, el: Element, x: number) => void;
  hide: () => void;
  /** Gone at once (scroll, click, the grid moving): no grace, and the next card waits its beat again */
  drop: () => void;
}

export const GuideHover = createContext<GuideHoverApi | null>(null);
