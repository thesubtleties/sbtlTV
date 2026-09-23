/**
 * Job lanes: the data process owns the sync queues and hands one job at a time
 * to each worker. Two lanes so an on-demand request (episodes for a series the
 * user just opened, a detail write, an imported playlist) never waits behind a
 * multi-minute guide parse on the bulk lane. Each lane's worker holds its own
 * write connection; SQLite serialises the actual writes with its busy timeout.
 */
import { isSameJob, type SyncJob } from './router.js';

export type LaneName = 'sync' | 'quick';

export interface LaneHooks {
  send(lane: LaneName, job: SyncJob): void;
  failed(job: SyncJob): void;
}

const QUICK = new Set<SyncJob['kind']>(['episodes', 'vodDetails', 'importPlaylist']);

// deleteSource and clearAll stay on the bulk lane so they run after any sync of
// the same source that is already queued there.
export function laneFor(job: SyncJob): LaneName {
  return QUICK.has(job.kind) ? 'quick' : 'sync';
}

interface Lane { ready: boolean; dead: boolean; queue: SyncJob[]; inFlight: SyncJob | null }

export class JobLanes {
  private lanes: Record<LaneName, Lane> = {
    sync: { ready: false, dead: false, queue: [], inFlight: null },
    quick: { ready: false, dead: false, queue: [], inFlight: null },
  };

  constructor(private hooks: LaneHooks) {}

  // Returns false when an identical job is already queued or running on the lane.
  enqueue(job: SyncJob): boolean {
    let name = laneFor(job);
    if (this.lanes[name].dead) name = 'sync';
    const lane = this.lanes[name];
    if (lane.inFlight && isSameJob(lane.inFlight, job)) return false;
    if (lane.queue.some((q) => isSameJob(q, job))) return false;
    lane.queue.push(job);
    this.pump(name);
    return true;
  }

  setReady(name: LaneName): void {
    this.lanes[name].ready = true;
    this.pump(name);
  }

  finished(name: LaneName): void {
    this.lanes[name].inFlight = null;
    this.pump(name);
  }

  // The worker died: whatever it was running is reported as failed and goes
  // back to the front of the queue for the replacement worker.
  crashed(name: LaneName): void {
    const lane = this.lanes[name];
    lane.ready = false;
    if (lane.inFlight) {
      const job = lane.inFlight;
      lane.inFlight = null;
      this.hooks.failed(job);
      lane.queue.unshift(job);
    }
  }

  // The lane cannot be brought back (its worker failed to start); its jobs run
  // on the sync lane instead.
  dead(name: LaneName): void {
    const lane = this.lanes[name];
    lane.dead = true;
    lane.ready = false;
    const moved = [...(lane.inFlight ? [lane.inFlight] : []), ...lane.queue];
    lane.inFlight = null;
    lane.queue = [];
    for (const job of moved) this.enqueue(job);
  }

  pending(name: LaneName): SyncJob[] {
    const lane = this.lanes[name];
    return [...(lane.inFlight ? [lane.inFlight] : []), ...lane.queue];
  }

  private pump(name: LaneName): void {
    const lane = this.lanes[name];
    if (!lane.ready || lane.dead || lane.inFlight || lane.queue.length === 0) return;
    lane.inFlight = lane.queue.shift()!;
    this.hooks.send(name, lane.inFlight);
  }
}
