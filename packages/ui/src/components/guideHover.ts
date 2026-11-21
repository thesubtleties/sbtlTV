import { createContext } from 'react';
import type { StoredProgram } from '../db';

/** The guide's one hover card: a block (or a channel's on-now line) asks for it, the guide shows it after a beat. */
export interface GuideHoverApi {
  show: (program: StoredProgram, el: Element) => void;
  hide: () => void;
}

export const GuideHover = createContext<GuideHoverApi | null>(null);
