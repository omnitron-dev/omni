/**
 * A scan path that cannot be read must say so.
 *
 * `discover()` stat'ed each scan path with `.catch(() => null)` and then treated
 * `null` exactly like "exists but is neither a file nor a directory": `continue`,
 * silently. A path we could not read — a permission problem on a parent, a
 * broken mount, a dangling symlink — meant the application booted with those
 * modules missing and nothing said anywhere. The branch immediately below it
 * already logged when a path could not be scanned, so the quieter failure was
 * the one that mattered more.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModuleDiscovery } from '../../src/application/_internal/module-discovery.js';

const root = mkdtempSync(join(tmpdir(), 'titan-discovery-'));
const locked = join(root, 'locked');
const target = join(locked, 'modules');

afterAll(() => {
  try {
    chmodSync(locked, 0o755);
  } catch {
    // never created
  }
  rmSync(root, { recursive: true, force: true });
});

// Running as root defeats the permission bits entirely.
const describeOrSkip = typeof process.getuid === 'function' && process.getuid() === 0 ? describe.skip : describe;

describeOrSkip('ModuleDiscovery - unreadable scan path', () => {
  it('reports a path it could not stat instead of skipping in silence', async () => {
    mkdirSync(target, { recursive: true });
    // stat() needs execute permission on the PARENT, so locking the parent is
    // what makes stat(target) fail rather than return something.
    chmodSync(locked, 0o000);

    const messages: string[] = [];
    const discovery = new ModuleDiscovery({
      has: () => false,
      cacheDiscovered: () => {},
      getLogger: () =>
        ({
          debug: (msg: string) => messages.push(String(msg)),
          info: () => {},
          warn: (msg: string) => messages.push(String(msg)),
          error: (msg: string) => messages.push(String(msg)),
          trace: () => {},
          fatal: () => {},
          child: () => undefined,
        }) as any,
    });

    const modules = await discovery.discover([target]);

    expect(modules).toEqual([]);
    expect(messages.join('\n')).toContain(target);
  });
});
