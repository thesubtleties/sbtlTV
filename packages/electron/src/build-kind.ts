export type BuildKind = 'release' | 'test' | 'local';

/** CI writes the git ref into build-info.json: a release is built from a version tag, a test build from a branch. */
export function buildKind(info: { ref?: string } | 'local'): BuildKind {
  if (info === 'local') return 'local';
  return /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(info.ref ?? '') ? 'release' : 'test';
}
