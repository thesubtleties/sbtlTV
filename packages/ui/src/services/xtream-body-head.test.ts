import { describe, it, expect } from 'vitest';
import { bodyHead } from '@sbtltv/local-adapter';

describe('Xtream error body head', () => {
  it('keeps the start of a broken reply but not the login values it echoes', () => {
    const reply = '{"user_info":{"username":"bob","password":"s3cret","status":"Active"';
    expect(bodyHead(reply)).toBe(JSON.stringify('{"user_info":{"username":"…","password":"…","status":"Active"'));
  });
  it('a value cut off by the 120-character limit is still blanked', () => {
    const reply = `${'x'.repeat(100)}"password":"s3cret-long-password"`;
    expect(bodyHead(reply)).not.toContain('s3cret');
  });
  it('an HTML error page is shown as it is', () => {
    expect(bodyHead('<html><body>502 Bad Gateway</body></html>')).toBe(JSON.stringify('<html><body>502 Bad Gateway</body></html>'));
  });
});
