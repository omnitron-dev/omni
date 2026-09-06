/**
 * Every test that binds a port must get it from the shared allocator.
 *
 * Sixteen spec files partitioned ports by `process.env['JEST_WORKER_ID']`.
 * This runner does not set that variable — measured, not assumed: a probe
 * across four workers printed `JEST_WORKER_ID=undefined` in all of them while
 * `VITEST_POOL_ID` was 1, 2, 3, 4. `parseInt(undefined || '1', 10)` is 1, so
 * every worker computed the same offset and all eight drew from ONE window of
 * 180-450 ports.
 *
 * The comments those files carried are the reason this is a rule and not a
 * one-time edit. One said "CRITICAL FIX: Use JEST_WORKER_ID for worker-safe
 * port allocation". Four others explained, correctly, that two files had been
 * caught sharing a 500-port range and had since been given their own bases —
 * a fix to the visible half, while the partitioning underneath stayed inert.
 * Everything about those files looked like the problem was handled.
 *
 * What it cost, in one package run of 298 files:
 *
 *     Error: listen EADDRINUSE: address already in use 127.0.0.1:60843
 *     Error: Unexpected server response: 404
 *     TitanError: Service 'scoped@1.0.0' not found
 *
 * Three different-looking failures in three different suites, all of them one
 * client reaching another suite's server.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TEST_ROOT = new URL('..', import.meta.url).pathname;

/** Where the allocator itself lives; it names the mistake in its comments. */
const ALLOCATOR_DIR = join(TEST_ROOT, 'utils');

function specFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      specFiles(full, found);
    } else if (entry.endsWith('.spec.ts') || entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

const files = specFiles(TEST_ROOT).filter((f) => !f.startsWith(ALLOCATOR_DIR));

describe('test port allocation', () => {
  it('has files to inspect', () => {
    // The two rules below pass trivially on an empty list, which is exactly
    // how a probe that stops finding files reports "all clear".
    expect(files.length).toBeGreaterThan(100);
  });

  it('reads no worker id this runner does not set', () => {
    const offenders = files
      .filter((f) => readFileSync(f, 'utf-8').includes("process.env['JEST_WORKER_ID']"))
      .map((f) => relative(TEST_ROOT, f));

    expect(
      offenders,
      `JEST_WORKER_ID is undefined under vitest, so every worker reads 1:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('computes no port from a random number', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        // The BINDING has to be port-named, not merely the line: a client id
        // built as `${port}-${Math.random()}` mentions both and computes no
        // port. That false positive is why this is not a substring search.
        const bindsAPort = /\b\w*[Pp]ort\w*\s*[=:]\s*[^=]/.test(line);
        if (bindsAPort && /Math\.random\s*\(/.test(line)) {
          offenders.push(`${relative(TEST_ROOT, f)}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      `ports come from getFreePort/nextTestPort, not from a range nobody checks:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
