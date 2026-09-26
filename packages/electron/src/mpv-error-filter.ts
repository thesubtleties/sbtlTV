/**
 * mpv forwards every error-level log line to the renderer as a red banner.
 * Some of those recover on their own within a second and should only reach
 * the debug log: hardware decoder probing while mpv picks an hwdec, and the
 * broken first pictures of a live stream joined between keyframes.
 */

const TRANSIENT_PREFIXES = [
  'ffmpeg/video:',       // decoder errors: "Failed to end picture", "co located POCs unavailable"
  'ffmpeg/audio:',
  'vd:',                 // "Error while decoding frame (hardware decoding)!"
  'ad:',
  'libmpv_render:',      // "Mapping hardware decoded surface failed."
  'libmpv_render/',      // vaapi / cuda / vulkan interop probing
  'vaapi:',
  'cuda:',
];

const TRANSIENT_PATTERNS = [
  /^ffmpeg: CUDA:/,      // "CUDA: Could not dynamically load CUDA" while probing nvdec
];

export function isTransientDecodeError(message: string): boolean {
  const text = message.trimStart();
  return TRANSIENT_PREFIXES.some((prefix) => text.startsWith(prefix))
    || TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}
