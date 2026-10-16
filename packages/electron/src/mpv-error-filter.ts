/**
 * mpv forwards every error-level log line to the renderer's error card.
 * Some of those recover on their own within a second, or never mattered, and
 * should only reach the debug log: hardware decoder probing while mpv picks an
 * hwdec, the broken first pictures of a live stream joined between keyframes,
 * and file metadata ffmpeg skips while the video plays normally.
 *
 * Only the messages listed below are filtered; anything else, including every
 * audio error (except a broken frame right after a jump) and any decoder that
 * fails to open, keeps its card. Every error
 * line still reaches stderr from the addon regardless.
 */

// Specific messages, not whole subsystems: a broad "vd:" or "ffmpeg/video:"
// match would also hide a decoder that cannot open at all (black screen with
// sound), which the frame-starvation watchdog does not catch because no video
// size is ever reported. The one exception is the hardware interop probe
// modules below, matched by prefix: they only log while mpv tries them.
const TRANSIENT_PATTERNS = [
  // Joining a live stream between keyframes (seen in the field).
  /^ffmpeg\/video: \w+: (non-existing [PS]PS \d+ referenced|no frame!|co located POCs unavailable|mmco: unref short failure|number of reference frames .* exceeds max|decode_slice_header error|error while decoding MB|concealing \d+)/,
  // ffmpeg's H.264 parser (logged with no context name) when a live stream is
  // joined mid-picture: the next whole picture decodes normally.
  /^ffmpeg: NULL: missing picture in access unit with size \d+/,
  // A provider closing the connection mid-stream: ffmpeg reconnects (live,
  // stream-health.ts) or re-requests from the byte offset (movies). If that
  // fails, the stall watchdog reloads and finally shows its own message.
  /^ffmpeg: http: (Stream ends prematurely at \d+|Will reconnect at \d+)/,
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

// A jump inside a stream (seek, rewind, End, a new load) lands mid-way through
// an AAC frame: the decoder rejects that one frame and the next decodes. Only
// right after a jump, so an audio decoder that keeps failing still gets its card.
const AFTER_JUMP_PATTERNS = [
  /^ffmpeg\/audio: aac: (env_facs_q \d+ is invalid|Reserved bit set|Number of bands \(\d+\) exceeds limit|channel element \d+\.\d+ is not allocated|Input buffer exhausted before END element found|Prediction is not allowed in AAC-LC|invalid band type|Too large remapped id)/,
  /^ad: Error decoding audio\./,
];
const AFTER_JUMP_MS = 3000;

/** msSinceJump: time since the last seek or load (undefined: none known). */
export function isTransientDecodeError(message: string, msSinceJump?: number): boolean {
  const text = message.trimStart();
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return msSinceJump !== undefined && msSinceJump < AFTER_JUMP_MS && AFTER_JUMP_PATTERNS.some((pattern) => pattern.test(text));
}
