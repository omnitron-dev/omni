import { describe, expect, it } from 'vitest';
import { parseMigrationCliArgs } from '../../src/migration/cli.js';

describe('migration command safety', () => {
  it.each([['--down', '-1'], ['--down', '1.5'], ['--down', '9007199254740992'],
    ['--status', '--down'], ['--unknown'], ['up', '--status'], ['--verify', 'extra']])(
    'rejects unsupported arguments before connecting: %j', (...args) => {
      expect(() => parseMigrationCliArgs(args)).toThrow();
    },
  );
  it('preserves explicit read-only and zero-rollback commands', () => {
    expect(parseMigrationCliArgs(['--verify']).kind).toBe('verify');
    expect(parseMigrationCliArgs(['--down', '0'])).toMatchObject({ kind: 'down', steps: 0 });
    expect(parseMigrationCliArgs(['--no-checksums', '--status'])).toMatchObject({ kind: 'status', enforceChecksums: false });
  });
});
