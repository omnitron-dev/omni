import { describe, expect, it } from 'vitest';
import { publicLaunchFailure } from '../../src/project/launch-failure.js';

describe('reader-safe launch evidence from current and legacy owners', () => {
  it('preserves an actionable missing module from the legacy definition loader without host paths', () => {
    const failure = publicLaunchFailure(new Error("Could not load sample/dev/api's definition from /private/project/src/bootstrap.ts: Cannot find module '/private/project/packages/sdk/src/like-pattern.js' imported from /private/project/packages/sdk/src/index.ts"));
    expect(failure).toBe('module "like-pattern.js" is unavailable; verify dependency installation and the active runtime compiler');
    expect(failure).not.toMatch(/private|bootstrap|index\.ts/);
  });
  it('recognizes a missing package in a serialized error cause', () => {
    expect(publicLaunchFailure({ message: 'Definition load refused', cause: { message: "Cannot find package '@example/sdk' imported from /private/source.ts" } }))
      .toBe('package "@example/sdk" is unavailable; install the declared dependencies');
  });
  it('distinguishes a simple source filename from an explicitly missing package', () => {
    expect(publicLaunchFailure(new Error("Cannot find module 'worker.js'"))).toContain('module "worker.js" is unavailable');
    expect(publicLaunchFailure(new Error("Cannot find package 'worker.js'"))).toContain('package "worker.js" is unavailable');
  });
  it.each(['/private/app/build/main.cjs', 'C:\\private\\app\\build\\main.cjs', 'file:///private/app/build/main.cjs'])(
    'withholds the directory of %s', target => {
      expect(publicLaunchFailure(new Error(`Cannot find module '${target}'`))).toContain('module "main.cjs" is unavailable');
    });
  it.each([
    '/private/key.js?token=private-value', 'https://user:private-value@host/key.js',
    '/private/opaque\x1b[31m.js', '/private/token=private-value.js',
  ])('never copies unsafe identifiers or URL data', target => {
    const result = publicLaunchFailure(new Error(`Cannot find module '${target}'`));
    expect(result).toBe('a required module is unavailable; verify dependency installation and the active runtime compiler');
    expect(result).not.toMatch(/private|token|\x1b/);
  });
  it.each(['exited during startup with code 1', 'exited during startup with code -1',
    'exited during startup : killed by SIGTERM', 'did not confirm readiness within 30000ms'])(
    'preserves bounded process evidence: %s', evidence => {
      expect(publicLaunchFailure(new Error(`secret=private-value ${evidence}; /private/path`))).toBe(evidence);
    });
  it('withholds arbitrary errors and bounds cyclic or excessive cause chains', () => {
    const error: { message: string; cause?: unknown } = { message: 'opaque-test-credential in /private/installation' };
    error.cause = error;
    expect(publicLaunchFailure(error)).toBe('launch failed (see daemon log)');
    expect(publicLaunchFailure('opaque-test-credential')).toBe('launch failed (see daemon log)');
    expect(publicLaunchFailure(new Error('x'.repeat(20_000) + "Cannot find package 'secret'"))).toBe('launch failed (see daemon log)');
  });
});
