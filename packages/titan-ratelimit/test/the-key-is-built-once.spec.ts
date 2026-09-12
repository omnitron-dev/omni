/**
 * The prefix was applied twice, so nothing could find a rate-limit key.
 *
 * Observed on a running deployment configured with
 * `keyPrefix: 'main:ratelimit'`:
 *
 *   main:ratelimitmain:ratelimit:default:Auth@1.0.0.signin:anon
 *   main:ratelimitmain:ratelimit:default:ConfigService.getMaintenanceStatus:anon
 *
 * `RateLimitService.buildKey` puts the prefix at the front of every key it
 * hands to a storage, and the module then handed the same prefix to
 * `RedisRateLimitStorage`, which prepends its own — with no separator, since
 * its default `'ratelimit:'` carries a trailing colon that a configured prefix
 * does not.
 *
 * The limits still worked: the doubling is consistent, so a key written is a
 * key read. What broke is everything that looks for one. `SCAN
 * main:ratelimit:*` — how an operator inspects or clears a limit — matches
 * none of them. And the memory storage does not prefix at all, so the same
 * limit was keyed differently depending on which storage was configured.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Comments stripped: the prose explains the fix in the words searched for. */
const code = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p: string) => p)
    // Collapse the whitespace the stripped comments leave behind, so a window
    // measured in characters still covers the same code.
    .replace(/[ \t]*\n[ \t\n]*/g, '\n');

describe('a rate-limit key carries its prefix once', () => {
  it('the service is the layer that prefixes', () => {
    const service = code(read('../src/ratelimit.service.ts'));
    expect(service).toMatch(/const parts = \[this\.options\.keyPrefix\]/);
  });

  it('no module path hands that prefix to the storage as well', () => {
    // EVERY construction, not the first one. `forRoot` and `forRootAsync`
    // each build a Redis storage, and downstream takes the async one — so fixing
    // only the first left the live keys doubled, which is what the probe
    // found after the first fix looked complete.
    const module = code(read('../src/ratelimit.module.ts'));
    const sites = [...module.matchAll(/new RedisRateLimitStorage\(/g)].map((m) => m.index!);
    expect(sites.length, 'expected both the forRoot and forRootAsync paths').toBeGreaterThanOrEqual(2);

    for (const [i, at] of sites.entries()) {
      const construction = module.slice(at, at + 300);
      expect(construction, `construction ${i} re-applies the configured prefix`).not.toMatch(
        /keyPrefix:\s*(mergedOptions\.keyPrefix|opts\?\.keyPrefix)/,
      );
      // Explicitly empty, not omitted: the storage's own default is
      // `'ratelimit:'`, so omitting it double-prefixes just as surely.
      expect(construction, `construction ${i} must pass an empty prefix`).toMatch(/keyPrefix:\s*''/);
    }
  });

  it('the storage still prefixes for callers who use it directly', () => {
    // It is a usable component on its own; the fix is about who owns the key
    // when a service is in front of it, not about removing the option.
    const storage = code(read('../src/ratelimit.storage.ts'));
    expect(storage).toMatch(/this\.keyPrefix = options\.keyPrefix \?\? 'ratelimit:'/);
  });
});
