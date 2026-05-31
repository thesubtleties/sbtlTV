import type { StoredWatchProgress } from '../../db';

export type ProgressRecord = StoredWatchProgress;

export interface ResumeTarget {
  seasonNum: number;
  episodeNum: number;
  position: number;    // seconds; 0 for a fresh "up next"
  progressPct: number; // 0-100
}
