/**
 * mpv forwards every error-level log line to the renderer as a red banner.
 * Some of those recover on their own within a second, or never mattered, and
 * should only reach the debug log: hardware decoder probing while mpv picks an
 * hwdec, the broken first pictures of a live stream joined between keyframes,
 * and file metadata ffmpeg skips while the video plays normally.
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
  // ffmpeg's H.264 parser (logged with no context name) when a live stream is
  // joined mid-picture: the next whole picture decodes normally.
  /^ffmpeg: NULL: missing picture in access unit with size \d+/,
  // Hardware decode of a broken first picture; mpv recovers or falls back.
  /^ffmpeg\/video: \w+: Failed to end picture decode issue/,
  /^vd: Error while decoding frame/,
  /^libmpv_render: Mapping hardware decoded surface failed/,
  // Hardware interop probing (vaapi, cuda, drmprime-overlay, vulkan): each
  // module that does not apply logs at error level while mpv picks one.
  /^libmpv_render\/[\w-]+: /,
  /^(vaapi|cuda): /,
  /^ffmpeg: CUDA: Could not dynamically load/,
  // An MP4/MOV that lists a chapter track it does not contain: ffmpeg skips
  // the chapters and the video plays (seen in the field on macOS).
  /^ffmpeg\/demuxer: [\w,]+: Referenced QT chapter track not found/,
];

export function isTransientDecodeError(message: string): boolean {
  const text = message.trimStart();
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}
