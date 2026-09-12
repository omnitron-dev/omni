/**
 * Three of omnitron's worker entry points declare `@Public`, `@HealthCheck`
 * and `@OnShutdown` themselves instead of importing them from
 * `@omnitron-dev/titan-pm`. That is deliberate — an entry point pulls its
 * imports into every child process — and it works because
 * `Symbol.for('process:method:metadata')` is realm-wide, so the metadata these
 * copies write is the metadata titan-pm's `worker-runtime` scans for.
 *
 * Nothing in the type system holds that agreement together. It has already
 * broken once, in the direction nobody would guess: titan-pm's EXPORTED
 * `@OnShutdown` wrote a prototype-level `'on-shutdown'` key that the runtime
 * never reads, so a handler decorated with the library's own decorator was
 * never called — while these local copies wrote the per-method field the
 * runtime actually scans and were correct all along.
 *
 * So this asserts the shape against the scan itself, on the source, for each
 * of the three files.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ENTRY_POINTS = [
  '../../src/orchestrator/bootstrap-process.ts',
  '../../src/orchestrator/module-worker-process.ts',
  '../../src/workers/health-monitor-process.ts',
];

/** Source with comments removed — the prose here names every field it discusses. */
function codeOf(rel: string): string {
  return fs
    .readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

/** What `worker-runtime.ts` reads out of each method's metadata entry. */
const FIELDS_THE_RUNTIME_READS = ['public', 'healthCheck', 'onShutdown'] as const;

describe.each(ENTRY_POINTS)('%s', (entry) => {
  const code = codeOf(entry);

  it('keys its metadata on the realm-wide symbol the runtime uses', () => {
    expect(code).toContain("Symbol.for('process:method:metadata')");
  });

  it('writes every field the runtime scans for', () => {
    const declared = FIELDS_THE_RUNTIME_READS.filter((f) => new RegExp(`\\bm\\.${f}\\s*=`).test(code));
    // A file need not declare all three — only what it uses — but whatever it
    // declares must be one of these names, and at least `public` is needed for
    // any method to be callable at all.
    expect(declared).toContain('public');
    for (const field of declared) {
      expect(FIELDS_THE_RUNTIME_READS).toContain(field);
    }
  });

  it('records shutdown per method, not once per prototype', () => {
    if (!/OnShutdown/.test(code)) return;
    // The library's mistake: `defineMetadata('on-shutdown', key, target)`.
    // Per prototype it is single-valued and the runtime never looks there.
    expect(code).toMatch(/m\.onShutdown\s*=\s*true/);
    expect(
      /defineMetadata\(\s*['"]on-shutdown['"]/.test(code),
      'this is the prototype-level key the runtime does not read',
    ).toBe(false);
  });

  it('defines its metadata against the method, not the class', () => {
    // `Reflect.defineMetadata(KEY, m, target, propertyKey)` — four arguments.
    // Drop the last one and the entry lands on the prototype, where the
    // runtime's per-method lookup will never find it.
    const writes = [...code.matchAll(/Reflect\.defineMetadata\(\s*PROCESS_METHOD_METADATA_KEY\s*,([\s\S]{0,120}?)\)/g)];
    expect(writes.length, 'no metadata write found — has this file been restructured?').toBeGreaterThan(0);
    for (const [, args] of writes) {
      expect(args.split(',').length, `metadata written without a propertyKey: ${args.trim()}`).toBeGreaterThanOrEqual(3);
    }
  });
});
