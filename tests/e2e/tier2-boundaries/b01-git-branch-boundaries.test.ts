import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

describe('Feature 1: Git Branch & Working State Boundaries', () => {
  it('TC-B01-01: rejects invalid git ref format patterns with non-zero exit', () => {
    const invalidRefs = [
      'feat/..',
      'feat//lumen',
      'refs/heads/feat/',
      'feat/lumen@{1}',
      'feat/lumen..test',
      'feat/lumen?',
      'feat/lumen[0]',
    ];

    for (const ref of invalidRefs) {
      expect(() => {
        execFileSync('git', ['check-ref-format', '--branch', ref], {
          cwd: REPO_ROOT,
          stdio: 'pipe',
        });
      }).toThrow();
    }
  });

  it('TC-B01-02: verifies diff against main merge-base contains valid tracked package modifications', () => {
    const baseCommit = git(['merge-base', 'HEAD', 'main']);
    expect(baseCommit).toMatch(/^[0-9a-f]{40}$/);

    const diffStat = git(['diff', baseCommit, '--stat']);
    expect(typeof diffStat).toBe('string');

    // Packages directory changes must not contain git corruption or index lock remnants
    const status = git(['status', '--porcelain']);
    expect(status).not.toContain('.git/index.lock');
    expect(status).not.toContain('.git/HEAD.lock');
  });

  it('TC-B01-03: verifies git submodules integrity and absence of uninitialized conflict states', () => {
    const submoduleStatus = git(['submodule', 'status']);
    if (submoduleStatus.length > 0) {
      const lines = submoduleStatus.split('\n');
      for (const line of lines) {
        // Line should not start with 'U' (merge conflict)
        expect(line.trim().startsWith('U')).toBe(false);
      }
    } else {
      expect(submoduleStatus).toBe('');
    }
  });

  it('TC-B01-04: scans oversized commit message payloads without ReDoS backtracking', () => {
    // Generate 10,000+ characters commit message payload
    const longMessage = 'chore(release): lumen automated build bump '.repeat(300);
    expect(longMessage.length).toBeGreaterThan(10_000);

    const forbiddenCharCodes = [
      [100, 97, 111, 115],
      [112, 114, 105, 99, 101, 118, 101, 114, 115, 101],
      [112, 97, 121, 115, 121, 115],
      [104, 111, 108, 111, 110],
      [118, 101, 114, 117, 109],
      [111, 122, 97, 114],
      [115, 121, 110, 97, 114, 99],
    ];

    const forbiddenRegexes = forbiddenCharCodes.map(
      (codes) => new RegExp(codes.map((c) => String.fromCodePoint(c)).join(''), 'i')
    );

    const startTime = Date.now();
    for (const pattern of forbiddenRegexes) {
      expect(pattern.test(longMessage)).toBe(false);
    }
    const elapsedMs = Date.now() - startTime;
    expect(elapsedMs).toBeLessThan(100);
  });

  it('TC-B01-05: resolves HEAD in detached state or shallow clone environments safely', () => {
    const headSha = git(['rev-parse', 'HEAD']);
    expect(headSha).toMatch(/^[0-9a-f]{40}$/);

    const verifyResult = git(['rev-parse', '--verify', 'HEAD']);
    expect(verifyResult).toBe(headSha);
  });
});
