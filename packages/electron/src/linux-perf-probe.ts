// Linux in-window player diagnostics, only while debug logging is on.
//
// Every 2s: CPU, memory, open fds and threads for each Electron process; the
// busiest processes on the whole machine (to catch the X server, compositor
// or anything else); total CPU, average CPU clock and Intel GPU clock; the
// main thread's worst event loop delay. Main-process GC pauses are logged as
// they happen. A Chromium trace runs in a ring buffer and is saved to the log
// folder a few seconds after the first transfer stall, so the GPU process,
// renderer and GC activity around a stall can be read in a trace viewer.
import { app, contentTracing } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { constants, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';

type Log = (message: string) => void;

const TICK_MS = 2000;
const CLOCK_TICKS_PER_SECOND = 100;
const TOP_PROCESS_COUNT = 5;
const GC_LOG_THRESHOLD_MS = 10;
// Stalls in the first minute are startup noise; the reported ones begin ~2m in.
const STALL_ARM_AFTER_MS = 60_000;
const STALL_SEND_MS = 120;
const TRACE_TAIL_MS = 8000;
const TRACE_FALLBACK_AFTER_MS = 5 * 60_000;
const TRACE_BUFFER_KB = 64 * 1024;
const TRACE_CATEGORIES = [
  'toplevel',
  'gpu',
  'viz',
  'cc',
  'v8',
  'electron',
  'disabled-by-default-v8.gc',
  'disabled-by-default-gpu.service',
  'disabled-by-default-gpu.decoder',
];

interface ProcStat {
  comm: string;
  ticks: number;
  threads: number;
}

function readProcStat(pid: number | string): ProcStat | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = raw.lastIndexOf(')');
    const comm = raw.slice(raw.indexOf('(') + 1, close);
    // Fields after "(comm)": state is [0], utime [11], stime [12], num_threads [17].
    const rest = raw.slice(close + 2).split(' ');
    return { comm, ticks: Number(rest[11]) + Number(rest[12]), threads: Number(rest[17]) };
  } catch {
    return null;
  }
}

function countFds(pid: number): number | null {
  try {
    return fs.readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    return null;
  }
}

function readTotalCpu(): { busy: number; total: number } | null {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n', 1)[0];
    const values = line.trim().split(/\s+/).slice(1).map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);
    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    return { busy: total - idle, total };
  } catch {
    return null;
  }
}

function readAverageCpuMhz(): number | null {
  try {
    const cpus = fs.readdirSync('/sys/devices/system/cpu').filter((name) => /^cpu\d+$/.test(name));
    let sum = 0;
    let count = 0;
    for (const cpu of cpus) {
      try {
        sum += Number(fs.readFileSync(`/sys/devices/system/cpu/${cpu}/cpufreq/scaling_cur_freq`, 'utf8'));
        count++;
      } catch { /* offline or no cpufreq */ }
    }
    return count > 0 ? Math.round(sum / count / 1000) : null;
  } catch {
    return null;
  }
}

function findGpuFreqPath(): string | null {
  try {
    for (const card of fs.readdirSync('/sys/class/drm').filter((name) => /^card\d+$/.test(name))) {
      const candidate = `/sys/class/drm/${card}/gt_act_freq_mhz`;
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* no DRM sysfs */ }
  return null;
}

function gcKindName(kind: number | undefined): string {
  switch (kind) {
    case constants.NODE_PERFORMANCE_GC_MAJOR: return 'major';
    case constants.NODE_PERFORMANCE_GC_MINOR: return 'minor';
    case constants.NODE_PERFORMANCE_GC_INCREMENTAL: return 'incremental';
    case constants.NODE_PERFORMANCE_GC_WEAKCB: return 'weakcb';
    default: return String(kind);
  }
}

export class LinuxPerfProbe {
  private timer: ReturnType<typeof setInterval> | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;
  private previousTicks = new Map<string, ProcStat>();
  private previousCpu: { busy: number; total: number } | null = null;
  private previousTickAt = 0;
  private gpuFreqPath: string | null = null;
  private playbackStartedAt = 0;
  private tracing = false;
  private traceSaved = false;
  private traceStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly log: Log) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.gpuFreqPath = findGpuFreqPath();
    this.previousTicks = this.sampleSystemProcesses();
    this.previousCpu = readTotalCpu();
    this.previousTickAt = Date.now();
    app.getAppMetrics(); // first call primes the per-process CPU counters

    this.loopDelay = monitorEventLoopDelay({ resolution: 10 });
    this.loopDelay.enable();

    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < GC_LOG_THRESHOLD_MS) continue;
        const kind = (entry as { detail?: { kind?: number } }).detail?.kind;
        this.log(`[perf] main gc ${gcKindName(kind)} ${entry.duration.toFixed(1)}ms`);
      }
    });
    this.gcObserver.observe({ entryTypes: ['gc'] });

    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.log(`[perf] probe started (gpu clock ${this.gpuFreqPath ?? 'unavailable'})`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.gcObserver?.disconnect();
    this.gcObserver = null;
    this.loopDelay?.disable();
    this.loopDelay = null;
    if (this.traceStopTimer) clearTimeout(this.traceStopTimer);
    this.traceStopTimer = null;
    if (this.tracing) void this.saveTrace('probe stopped');
  }

  /** First frame of a playback session: start the trace ring buffer once. */
  notePlaybackStarted(): void {
    if (!this.timer || this.playbackStartedAt > 0) return;
    this.playbackStartedAt = Date.now();
    this.log('[perf] playback session started');
    if (this.traceSaved || this.tracing) return;
    contentTracing.startRecording({
      included_categories: TRACE_CATEGORIES,
      recording_mode: 'record-continuously',
      trace_buffer_size_in_kb: TRACE_BUFFER_KB,
    }).then(() => {
      this.tracing = true;
      this.log(`[perf] trace recording (ring buffer ${TRACE_BUFFER_KB / 1024}MB)`);
    }).catch((error: unknown) => {
      this.log(`[perf] trace start failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** Bridge 2s window result; the first stall after the first minute saves the trace. */
  noteTransferWindow(maxSendMs: number): void {
    if (!this.tracing || this.traceStopTimer || this.playbackStartedAt === 0) return;
    const elapsed = Date.now() - this.playbackStartedAt;
    if (maxSendMs >= STALL_SEND_MS && elapsed >= STALL_ARM_AFTER_MS) {
      this.log(`[perf] stall detected (send max ${maxSendMs.toFixed(0)}ms at +${(elapsed / 1000).toFixed(0)}s); saving trace in ${TRACE_TAIL_MS / 1000}s`);
      this.traceStopTimer = setTimeout(() => void this.saveTrace('stall'), TRACE_TAIL_MS);
    } else if (elapsed >= TRACE_FALLBACK_AFTER_MS) {
      this.traceStopTimer = setTimeout(() => void this.saveTrace('no stall by 5 minutes'), 0);
    }
  }

  private async saveTrace(reason: string): Promise<void> {
    if (!this.tracing) return;
    this.tracing = false;
    this.traceSaved = true;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(app.getPath('logs'), `sbtltv-trace-${stamp}.json`);
    try {
      const written = await contentTracing.stopRecording(target);
      this.log(`[perf] trace saved (${reason}): ${written}`);
    } catch (error) {
      this.log(`[perf] trace save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sampleSystemProcesses(): Map<string, ProcStat> {
    const sample = new Map<string, ProcStat>();
    let entries: string[] = [];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return sample;
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const stat = readProcStat(entry);
      if (stat) sample.set(entry, stat);
    }
    return sample;
  }

  private tick(): void {
    const now = Date.now();
    const seconds = Math.max((now - this.previousTickAt) / 1000, 0.001);
    this.previousTickAt = now;
    const since = this.playbackStartedAt > 0 ? ` +${((now - this.playbackStartedAt) / 1000).toFixed(0)}s` : '';

    // Electron's own processes.
    const parts: string[] = [];
    for (const metric of app.getAppMetrics()) {
      const name = metric.type === 'Utility' && metric.serviceName ? `utility:${metric.serviceName.split('.').pop()}` : metric.type.toLowerCase();
      const stat = readProcStat(metric.pid);
      const fds = countFds(metric.pid);
      parts.push(`${name}[${metric.pid}] cpu:${metric.cpu.percentCPUUsage.toFixed(0)}% mem:${Math.round(metric.memory.workingSetSize / 1024)}MB fds:${fds ?? '?'} thr:${stat?.threads ?? '?'}`);
    }
    this.log(`[perf]${since} procs ${parts.join(' | ')}`);

    // Whole machine: busiest processes over the window, total CPU, clocks.
    const current = this.sampleSystemProcesses();
    const busiest: Array<{ pid: string; comm: string; percent: number }> = [];
    for (const [pid, stat] of current) {
      const previous = this.previousTicks.get(pid);
      if (!previous) continue;
      const percent = ((stat.ticks - previous.ticks) / CLOCK_TICKS_PER_SECOND / seconds) * 100;
      if (percent >= 1) busiest.push({ pid, comm: stat.comm, percent });
    }
    this.previousTicks = current;
    busiest.sort((left, right) => right.percent - left.percent);
    const top = busiest.slice(0, TOP_PROCESS_COUNT).map((proc) => `${proc.comm}[${proc.pid}]:${proc.percent.toFixed(0)}%`).join(' ');

    const cpu = readTotalCpu();
    let totalPercent = '?';
    if (cpu && this.previousCpu && cpu.total > this.previousCpu.total) {
      totalPercent = (((cpu.busy - this.previousCpu.busy) / (cpu.total - this.previousCpu.total)) * 100).toFixed(0);
    }
    this.previousCpu = cpu;
    let gpuMhz = '?';
    if (this.gpuFreqPath) {
      try { gpuMhz = fs.readFileSync(this.gpuFreqPath, 'utf8').trim(); } catch { /* ignore */ }
    }
    const loopMax = this.loopDelay ? (this.loopDelay.max / 1e6).toFixed(0) : '?';
    this.loopDelay?.reset();
    this.log(`[perf]${since} system cpu:${totalPercent}% cpuMHz:${readAverageCpuMhz() ?? '?'} gpuMHz:${gpuMhz} mainLoopMax:${loopMax}ms | top ${top}`);
  }
}
