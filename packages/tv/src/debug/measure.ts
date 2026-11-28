import SbtlNative from '../../modules/sbtl-native';
// Samples memory every 250 ms and the longest gap between animation frames (= how long the JS thread was blocked).
export function startMeasure() {
  let peakPss = 0; let peakHeap = 0; let longest = 0; let last = performance.now(); let raf = 0; let live = true;
  const heap = () => { const h = (global as { HermesInternal?: { getInstrumentedStats?: () => { js_allocatedBytes: number } } }).HermesInternal?.getInstrumentedStats?.(); return h ? h.js_allocatedBytes : 0; };
  const timer = setInterval(() => { const m = SbtlNative.memoryInfo(); peakPss = Math.max(peakPss, m.pssKb / 1024); peakHeap = Math.max(peakHeap, heap() / 1048576); }, 250);
  const frame = () => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; if (live) raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  return () => { live = false; cancelAnimationFrame(raf); clearInterval(timer); return { peakPssMb: Math.round(peakPss), peakJsHeapMb: Math.round(peakHeap), longestFreezeMs: Math.round(longest) }; };
}
