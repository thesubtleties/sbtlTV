import { describe, it, expect } from 'vitest';
import { isBlockedUrl, isPrivateHost, checkProviderUrl } from './url-guard';

describe('url guard', () => {
  it('blocks loopback, private ranges, link-local and file urls', () => {
    for (const u of ['http://localhost/x', 'http://LOCALHOST./x', 'http://127.0.0.1:8080/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://[::1]/', 'http://0.0.0.0/', 'http://100.64.1.1/']) {
      expect(isBlockedUrl(u), u).toBe(true);
    }
  });
  it('is not fooled by userinfo, numeric or mapped forms of a private address', () => {
    for (const u of ['http://evil.example@192.168.1.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://017700000001/', 'http://127.1/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:c0a8:101]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[0:0:0:0:0:0:0:1]/']) {
      expect(isBlockedUrl(u), u).toBe(true);
    }
  });
  it('lets public hosts through and the private ones when LAN is allowed', () => {
    expect(isBlockedUrl('http://kytv.xyz/player_api.php')).toBe(false);
    expect(isBlockedUrl('http://172.32.0.1/')).toBe(false);
    expect(isBlockedUrl('http://8.8.8.8/')).toBe(false);
    expect(isBlockedUrl('http://[2606:4700::1111]/')).toBe(false);
    expect(isPrivateHost('example.com')).toBe(false);
    expect(() => checkProviderUrl('http://192.168.1.1/', false)).toThrow(/local network/);
    expect(() => checkProviderUrl('http://192.168.1.1/', true)).not.toThrow();
    expect(() => checkProviderUrl('ftp://example.com/x', true)).toThrow(/http/);
    expect(() => checkProviderUrl('not a url', true)).toThrow(/valid URL/);
  });
});
