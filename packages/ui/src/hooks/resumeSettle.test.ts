import { describe, it, expect } from 'vitest';
import { resumeSettled } from './resumeSettle';

describe('resumeSettled', () => {
  it('a play without a resume point saves right away', () => {
    expect(resumeSettled(0, null)).toBe(true);
  });
  it('not before the resume seek has landed (the first statuses say 0)', () => {
    expect(resumeSettled(0, 299)).toBe(false);
    expect(resumeSettled(0.1, 299)).toBe(false);
  });
  it('once playback is at the resume point', () => {
    expect(resumeSettled(299, 299)).toBe(true);
    expect(resumeSettled(296, 299)).toBe(true);
  });
  it('if the seek never happened, playback from the start counts after 20s', () => {
    expect(resumeSettled(19, 299)).toBe(false);
    expect(resumeSettled(21, 299)).toBe(true);
  });
});
