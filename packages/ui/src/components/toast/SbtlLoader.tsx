import { SbtlMark } from '../SbtlMark';
import './SbtlLoader.css';

/**
 * Branded loading indicator: the "sbtl" letterforms doing a sequential pop.
 * `SbtlMark` intrinsic size is 410×185 (viewBox "310 248 410 185"); `size` is the width in px.
 * `slow`: the calmer pace of the loading screen. The animation lives in SbtlLoader.css.
 */
export function SbtlLoader({ size = 30, slow = false }: { size?: number; slow?: boolean }) {
  return (
    <SbtlMark
      className={slow ? 'sbtl-loader sbtl-loader--slow' : 'sbtl-loader'}
      width={size}
      height={Math.round((size * 185) / 410)}
    />
  );
}
