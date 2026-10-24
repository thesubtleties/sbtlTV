import { describe, it, expect } from 'vitest';
import { issueUrl } from './issueUrl';

describe('issueUrl', () => {
  it('opens a new issue with the version and OS filled in, title left blank', () => {
    const url = new URL(issueUrl('0.13.1', 'darwin'));
    expect(url.origin + url.pathname).toBe('https://github.com/thesubtleties/sbtlTV/issues/new');
    expect(url.searchParams.has('title')).toBe(false);
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('**sbtlTV** 0.13.1 on macOS');
    expect(body).toContain('↓ Drag the sbtltv-report zip here');
  });

  it('names each OS plainly', () => {
    expect(new URL(issueUrl('1', 'linux')).searchParams.get('body')).toContain('on Linux');
    expect(new URL(issueUrl('1', 'win32')).searchParams.get('body')).toContain('on Windows');
  });

  it('keeps a version with URL-special characters intact and the body exact', () => {
    const body = new URL(issueUrl('0.14.0-beta.1+sha#1&x=y', 'linux')).searchParams.get('body');
    expect(body).toBe('**sbtlTV** 0.14.0-beta.1+sha#1&x=y on Linux\n\n<!-- What happened, and what did you expect? -->\n\n↓ Drag the sbtltv-report zip here\n');
  });

  it('names an unknown platform as it is', () => {
    expect(new URL(issueUrl('1', 'freebsd')).searchParams.get('body')).toContain('on freebsd');
  });
});

describe('issueUrl before the version is known', () => {
  it('leaves the version out instead of a double space', () => {
    expect(new URL(issueUrl('', 'linux')).searchParams.get('body')).toContain('**sbtlTV** on Linux');
  });
});
