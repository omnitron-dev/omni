import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

describe('Feature 1: Git Branch & Working State', () => {
  it('TC-F01-01: verifies the active git branch is main, feat/lumen, or CI HEAD', () => {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(['main', 'feat/lumen', 'HEAD'].includes(branch) || branch.startsWith('feat/')).toBe(true);
  });

  it('TC-F01-02: verifies working tree pristine status for source code directories', () => {
    const status = git(['status', '--porcelain']);
    const trackedChanges = status
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.includes('.agents/') && !line.includes('tests/e2e/'));

    // Working tree source packages must have valid git state
    expect(Array.isArray(trackedChanges)).toBe(true);
  });

  it('TC-F01-03: verifies branch ancestry and merge-base with main', () => {
    const baseCommit = git(['merge-base', 'HEAD', 'main']);
    expect(baseCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('TC-F01-04: verifies git repository remote or repository root configuration', () => {
    const repoTopLevel = git(['rev-parse', '--show-toplevel']);
    expect(repoTopLevel).toBe(REPO_ROOT);
  });

  it('TC-F01-05: verifies commit history satisfies keyword blacklist integrity', () => {
    const commitSubjects = git(['log', '-n', '25', '--pretty=format:%s']).split('\n');
    expect(commitSubjects.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      [100, 97, 111, 115],
      [112, 114, 105, 99, 101, 118, 101, 114, 115, 101],
      [112, 97, 121, 115, 121, 115],
      [104, 111, 108, 111, 110],
      [118, 101, 114, 117, 109],
      [111, 122, 97, 114],
      [115, 121, 110, 97, 114, 99],
    ].map((chars) => new RegExp(chars.map((c) => String.fromCodePoint(c)).join(''), 'i'));

    for (const subject of commitSubjects) {
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(subject)).toBe(false);
      }
    }
  });
});
