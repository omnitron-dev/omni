/**
 * Every role declaration on an RPC method is readable by the thing that
 * enforces it.
 *
 * `@Public({ auth: { roles: [...] } })` writes the roles into reflect
 * metadata, and the Netron transport reads them back before dispatching.
 * The two are joined by a string key and nothing else — no type, no import
 * between them — so a divergence would leave 150-odd role declarations
 * looking exactly as they look now and enforcing nothing.
 *
 * That is not hypothetical. `packages/titan/src/decorators/constants.ts`
 * declares the same key set with different values (`titan:method:auth`
 * against the live `method:auth`). Nothing imports it today; the file is
 * one natural-looking import away from silently disabling every check,
 * and the symptom would be no symptom at all.
 *
 * omni-3c found the same shape in the downstream project from the other direction: thirty
 * classes carrying `@RateLimit` without the field the decorator reads off
 * the instance, so every limit they declared had never once applied.
 */

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../src');

/**
 * RPC service modules — the files carrying `@Service` and `@Public`.
 *
 * Walked from `src`, not listed from `src/services`. The flat read missed two
 * of the twenty-one, and they were not minor ones: `cluster.rpc-service.ts`,
 * where `stepDown` — deposing the cluster leader — carried a bare `@Public()`
 * and so no auth at all, and `daemon.rpc-service.ts`, the most privileged
 * surface there is. A check that reads one directory answers only about that
 * directory, and every assertion below is of the form "this appears nowhere",
 * which an incomplete corpus passes.
 */
function rpcServiceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.rpc-service.ts')) out.push(full);
    }
  })(SRC);
  return out.sort();
}

describe('RPC authorization metadata', () => {
  const files = rpcServiceFiles();

  it('found the services it is supposed to check', () => {
    expect(files.length, 'rpc-service modules').toBeGreaterThan(10);
    // The two that a flat read of `src/services` cannot see. Named, so the
    // walk cannot quietly become a listing again.
    expect(files.some((f) => f.endsWith('cluster.rpc-service.ts')), 'cluster service in scope').toBe(true);
    expect(files.some((f) => f.endsWith('daemon.rpc-service.ts')), 'daemon service in scope').toBe(true);
  });

  it('reads the roles back through the key the transport uses', async () => {
    // The decisive assertion: load a real service class, ask reflect for the
    // metadata using the exported key, and require the roles to come back.
    // By name: the module exports more than its class (`readChannels`).
    const { EventBroadcasterRpcService: cls } = await import('../../src/services/event-broadcaster.rpc-service.js');
    const { VIEWER_ROLES } = await import('../../src/shared/roles.js');
    expect(cls, 'exported service class').toBeDefined();

    const roles = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, cls.prototype, 'subscribe');
    expect(roles, '@Public({auth}) must be readable at METADATA_KEYS.METHOD_AUTH').toEqual({
      roles: VIEWER_ROLES,
    });
  });

  it('has exactly one live definition of the auth metadata key', async () => {
    // Two registries with different values is the shape that turns a rename
    // into silence. Pin the value the transport actually reads, so a change
    // to it has to be deliberate.
    const { METADATA_KEYS: fromDecorators } = await import('@omnitron-dev/titan/decorators');
    expect(fromDecorators.METHOD_AUTH).toBe('method:auth');
  });

  it('declares an auth block on every exposed method', async () => {
    // A method reachable over RPC with no `auth` at all is open to anyone
    // the transport lets through. That may be intended — a health ping, a
    // login — but it should be a decision someone made, so the exceptions
    // are named here rather than implied by omission.
    const OPEN_BY_DESIGN = new Set(['login', 'ping', 'health', 'getVersion', 'whoami', 'refresh']);
    const undeclared: string[] = [];
    let examined = 0;

    for (const file of files) {
      // Comments carry `@Public(...)` too — `auth.rpc-service.ts` documents
      // three spellings in its header — and a probe that counted those would
      // be counting prose.
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

      // `@Public(...)` immediately followed by a method declaration.
      for (const m of source.matchAll(/@Public\(([^)]*)\)\s*\n\s*(?:async\s+)?(\w+)\s*\(/g)) {
        examined++;
        const [, options = '', method = ''] = m;
        if (options.includes('auth')) continue;
        if (OPEN_BY_DESIGN.has(method)) continue;
        undeclared.push(`${path.basename(file)}: ${method}`);
      }
    }

    // Without this the assertion below passes on an empty sweep, which is
    // the failure mode of every check of this shape.
    expect(examined, '@Public methods examined').toBeGreaterThan(100);
    expect(examined, 'every @Public decorator in the sources').toBe(
      files.reduce(
        (n, f) =>
          n +
          (fs
            .readFileSync(f, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '')
            .match(/@Public\(/g)?.length ?? 0),
        0
      )
    );

    expect(undeclared.sort(), 'exposed over RPC with no auth block').toEqual([]);
  });
});
