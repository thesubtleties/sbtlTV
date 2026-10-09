/**
 * mpv forwards every error-level log line to the renderer as a red banner.
 * Some of those recover on their own within a second and should only reach
 * the debug log: hardware decoder probing while mpv picks an hwdec, and the
 * broken first pictures of a live stream joined between keyframes.
 *
 * Only the messages listed below are filtered; anything else, including every
 * audio error and any decoder that fails to open, keeps its banner. Every mpv
 * log line still reaches stderr from the addon regardless.
 */

// Specific messages only, never whole subsystems: a broad "vd:" or
// "ffmpeg/video:" match would also hide a decoder that cannot open at all
// (black screen with sound), which the frame-starvation watchdog does not
// catch because no video size is ever reported.
const TRANSIENT_PATTERNS = [
  // Joining a live stream between keyframes (seen in the field).
  /^ffmpeg\/video: \w+: (non-existing [PS]PS \d+ referenced|no frame!|co located POCs unavailable|mmco: unref short failure|number of reference frames .* exceeds max|decode_slice_header error|error while decoding MB|concealing \d+)/,
  // Hardware decode of a broken first picture; mpv recovers or falls back.
  /^ffmpeg\/video: \w+: Failed to end picture decode issue/,
  /^vd: Error while decoding frame/,
  /^libmpv_render: Mapping hardware decoded surface failed/,
  // Hardware interop probing (vaapi, cuda, drmprime-overlay, vulkan): each
  // module that does not apply logs at error level while mpv picks one.
  /^libmpv_render\/[\w-]+: /,
  /^(vaapi|cuda): /,
  /^ffmpeg: CUDA: Could not dynamically load/,
];

export function isTransientDecodeError(message: string): boolean {
  const text = message.trimStart();
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}
