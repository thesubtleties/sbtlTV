import { SbtlMark } from '../SbtlMark';

/**
 * Branded loading indicator: the "sbtl" letterforms doing a sequential pop.
 * `SbtlMark` intrinsic size is 410×185 (viewBox "310 248 410 185"); `size` is the width in px.
 * The animation lives in Toast.css (`.sbtl-loader path:nth-of-type(1..4)`).
 */
export function SbtlLoader({ size = 30 }: { size?: number }) {
  return <SbtlMark className="sbtl-loader" width={size} height={Math.round((size * 185) / 410)} />;
}
