import 'react';

// CSS custom properties in inline styles (style={{ '--aired': '12px' }}), checked instead of cast
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
