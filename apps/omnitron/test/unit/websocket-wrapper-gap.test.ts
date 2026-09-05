/**
 * `invocationWrapper` is an HTTP-only option, and two call sites pass it to
 * the WebSocket transport as though it were not.
 *
 * The wrapper is how an AsyncLocalStorage frame gets around an RPC call —
 * the request context in this daemon, and an RLS context in apps built on
 * titan. `transport/http/server.ts` reads it; nothing under
 * `transport/websocket/` does, and a call arriving over a socket transport
 * is dispatched by `remote-peer.ts` straight to `stub.call(method, args)`.
 * Authorisation still runs (`enforceMethodAccess` precedes it); the ALS
 * frame does not.
 *
 * Nothing failed. The daemon's WS calls simply have no request context, so
 * the address recorded against a session created over WS is blank. For an
 * app using the wrapper for RLS the consequence is larger and equally
 * quiet: kysera's plugin fails closed on a missing context, so queries
 * return nothing instead of returning too much.
 *
 * This test exists so the gap cannot be forgotten in either direction. It
 * fails if the daemon stops passing the option (someone "cleaning up" what
 * looks unused), and it fails once the WebSocket transport starts reading
 * it — at which point the comments at both call sites are wrong and must go.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const titanNetron = path.join(repoRoot, 'packages/titan/src/netron');

/** Every .ts under a directory, read. */
function sources(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push({ file: p, text: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/**
 * Reading the option, in any of the shapes a transport would use — a call
 * (`opts.invocationWrapper(meta, fn)`), an optional call, a truthiness test,
 * or destructuring. Deliberately broader than the shape the HTTP transport
 * happens to use today: the first version of this matched only
 * `options.invocationWrapper` and a call, and a probe written as
 * `o.invocationWrapper` slipped past it — the check stayed green while the
 * condition it guards had changed, which is exactly the failure it exists to
 * catch, one level up.
 *
 * Type declarations are excluded (`invocationWrapper?:` in an options
 * interface is a declaration, not a use), since the WS options type may well
 * inherit the field long before the server honours it.
 */
function readsOption(text: string): boolean {
  const withoutDeclarations = text.replace(/invocationWrapper\s*\?\s*:/g, '');
  return /(?:\.|\bconst\s*\{[^}]*\b)invocationWrapper\b/.test(withoutDeclarations);
}

describe('invocationWrapper support', () => {
  it('found the netron transports to check', () => {
    // Without this the two assertions below pass on an empty read, which is
    // the failure this whole file is about, one level up.
    expect(fs.existsSync(path.join(titanNetron, 'transport/http')), 'http transport').toBe(true);
    expect(fs.existsSync(path.join(titanNetron, 'transport/websocket')), 'ws transport').toBe(true);
    expect(sources(titanNetron).length).toBeGreaterThan(20);
  });

  it('is honoured by the HTTP transport', () => {
    const http = sources(path.join(titanNetron, 'transport/http'));
    expect(http.some((f) => readsOption(f.text)), 'no HTTP file reads the option').toBe(true);
  });

  it('is still NOT honoured by the WebSocket transport — update both call sites when it is', () => {
    const ws = sources(path.join(titanNetron, 'transport/websocket'));
    const readers = ws.filter((f) => readsOption(f.text)).map((f) => path.basename(f.file));

    expect(
      readers,
      'the WebSocket transport now reads invocationWrapper — remove the "NOT APPLIED" comments in ' +
        'daemon.ts and bootstrap-process.ts, and delete this test'
    ).toEqual([]);
  });

  it('is passed by both call sites anyway, so it starts working the day the gap closes', () => {
    const daemon = fs.readFileSync(path.join(here, '../../src/daemon/daemon.ts'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(here, '../../src/orchestrator/bootstrap-process.ts'), 'utf8');

    expect(daemon).toContain('invocationWrapper: authContextWrapper');
    expect(bootstrap).toContain("wsOptions['invocationWrapper'] = auth.invocationWrapper");
  });

  it('says so where a reader will see it', () => {
    // A gap known only to a test is a gap the next reader of daemon.ts
    // walks into.
    const daemon = fs.readFileSync(path.join(here, '../../src/daemon/daemon.ts'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(here, '../../src/orchestrator/bootstrap-process.ts'), 'utf8');

    expect(daemon).toContain('NOT APPLIED');
    expect(bootstrap).toContain('NOT APPLIED');
  });
});
