/**
 * An app configured at `error` still had every child logging at `info`.
 *
 * A child process builds its logger in `worker-runtime` from
 * `spawnOptions.logLevel`, defaulting to `info` — and NOTHING set that option:
 * the two reads were its only occurrences in titan-pm. So the level an
 * operator chose reached the application and stopped there.
 *
 * Measured on the stand, byte-accurately (record the log size, restart, parse
 * only the appended bytes): messaging at `logger.level: error` appended 14
 * lines on a boot. All info, all `module=netron`, all from CHILDREN —
 * `processName: acme/dev/messaging/http`, `…/automation-worker` — and zero
 * from the application itself, which honours the level correctly.
 *
 * That matters because netron is the request path, and it is the component
 * that was logging a rejected sign-in's password until 1ddde84. An operator
 * who turns the level down does not quiet it.
 *
 * This corrects a note that blamed "netron's child logger" and an ordering
 * problem in bootstrap. Neither was it: a pino child tracks its parent's level
 * (measured), and the app's own logger is fine. The lines come from a SECOND
 * logger, built by the PM worker runtime, which never saw the app's config.
 *
 * The orchestrator already parses the app's `config/default.json` — for its
 * `omnitron` section — so the level is in a file it has open. These assert the
 * wiring on the source, which is how this repo pins the things the type system
 * cannot: see `a-local-decorator-still-agrees-with-the-runtime.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ORCHESTRATOR = new URL('../../src/orchestrator/orchestrator.service.ts', import.meta.url);
const HANDLE = new URL('../../src/orchestrator/app-handle.ts', import.meta.url);
/** The one reader of `config/default.json` (5f5d0a42): the section and the level, from one parse. */
const DECLARED = new URL('../../src/project/declared-config.ts', import.meta.url);

/** Source with comments stripped — the prose names every symbol it discusses. */
function codeOf(url: URL): string {
  return fs
    .readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

describe('the app’s level reaches its children', () => {
  const orchestrator = codeOf(ORCHESTRATOR);
  const handle = codeOf(HANDLE);

  it('the handle carries it', () => {
    expect(handle).toMatch(/appLogLevel/);
  });

  it('it is read from the config file the orchestrator already opens', () => {
    // Not a second read of the same file, and not a new config key: the one
    // parse that takes `json.omnitron` takes this too. That parse is now
    // `readDeclaredConfig`, read on every start rather than written onto the
    // loader's cached definition once (a-template-read-once-for-the-daemons-life).
    const at = orchestrator.indexOf('handle.appLogLevel =');
    expect(at, 'nothing assigns it').toBeGreaterThan(0);
    const around = orchestrator.slice(Math.max(0, at - 900), at);
    expect(around, 'read somewhere other than the declared-config read').toContain('readDeclaredConfig(');
    expect(around).toContain('declared.loggerLevel');

    const declared = codeOf(DECLARED);
    const parse = declared.indexOf('JSON.parse(content)');
    expect(parse, 'the reader parses the file once').toBeGreaterThan(0);
    const after = declared.slice(parse, parse + 600);
    expect(after).toContain('json.omnitron');
    expect(after).toContain('json.logger?.level');
  });

  it('validates the level instead of handing an arbitrary string to a logger', () => {
    // `config/default.json` is hand-edited. A level pino does not know
    // ("verbose", a typo) would otherwise go straight into a child's logger
    // constructor.
    expect(orchestrator).toMatch(/PINO_LEVELS\s*=\s*new Set\(/);
    const at = orchestrator.indexOf('handle.appLogLevel =');
    expect(orchestrator.slice(Math.max(0, at - 300), at)).toContain('PINO_LEVELS.has(');
  });

  it('EVERY spawn site passes it — a missed one is a silent child', () => {
    // Three: the single-process app, each topology child, and the pool's
    // per-worker options. The pool's `spawnOptions` is the one a worker
    // actually reads; a level on the pool root would be a field nothing reads.
    const sites = [...orchestrator.matchAll(/spawnOptions\s*:/g)].length;
    const passes = [...orchestrator.matchAll(/appLogLevel && \{ logLevel: handle\.appLogLevel \}/g)].length;

    expect(sites, 'no spawn sites found — has this been restructured?').toBeGreaterThanOrEqual(3);
    expect(passes, `${sites} spawn sites, ${passes} pass the level`).toBe(3);
  });

  it('does not override a level a caller set deliberately', () => {
    // The spread is conditional on the handle's value, and every site puts it
    // where an explicit option would already be — so one noisy child can still
    // be turned up on its own through titan-pm's own option.
    expect(orchestrator).not.toMatch(/logLevel:\s*handle\.appLogLevel\s*,\s*\n\s*\.\.\./);
  });
});
