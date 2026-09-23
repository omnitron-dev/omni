/**
 * A refusal that ended in a stack frame.
 *
 * The bundle-build child printed its error's stack, and the daemon reported
 * the last four lines of it as the reason. Measured 2026-09-23, the first
 * time the stale-build refusal fired: «… a node would run 64b41676 under
 * 34aba411's name. Rebuild it. |     at buildOwnBundle (/Users/…)». And a
 * stack four frames deep would have left no words at all — only frames.
 */

import { describe, it, expect } from 'vitest';

import { failureOutput, failureReason } from '../../src/services/bundle-worker-protocol.js';

function deep(n: number): never {
  if (n === 0) throw new Error('omnitron/dist was compiled from 64b41676 and the tree is at 34aba411. Rebuild it.');
  return deep(n - 1);
}

const thrown = (): unknown => {
  try {
    deep(12);
  } catch (err) {
    return err;
  }
  return null;
};

describe('the reason a bundle build failed is its sentence, not its frames', () => {
  it('reads the sentence back, however deep the stack', () => {
    const output = `rebuilding @omnitron-dev/titan — src newer than dist\n${failureOutput(thrown())}`;

    expect(failureReason(output)).toBe('omnitron/dist was compiled from 64b41676 and the tree is at 34aba411. Rebuild it.');
    // What the old reading reported: four lines of it, the sentence gone.
    const oldTail = output.trim().split('\n').slice(-5, -1).join(' | ');
    expect(oldTail).not.toContain('Rebuild it');
  });

  it('keeps the stack for the log', () => {
    expect(failureOutput(thrown())).toMatch(/at deep/);
  });

  it('says it has no reason when the child died without giving one', () => {
    expect(failureReason('Segmentation fault\n')).toBeNull();
    expect(failureReason('')).toBeNull();
    expect(failureReason(JSON.stringify({ failed: '' }))).toBeNull();
  });
});
