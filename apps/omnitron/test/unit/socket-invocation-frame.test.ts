/**
 * Socket-transport calls run inside the transport's `invocationWrapper`.
 *
 * The wrapper is how an AsyncLocalStorage frame gets around an RPC call —
 * the request context in this daemon, an RLS context in apps built on titan.
 * For a while only `transport/http/server.ts` read it, so a call arriving
 * over WebSocket, TCP or the Unix socket went straight to `stub.call()` with
 * no frame: `getRequestContext()` was null here, and an app relying on the
 * wrapper for RLS ran its queries with no context at all (kysera fails
 * closed, so the symptom was an empty page rather than a leak). It is now
 * applied in `remote-peer.ts`, which is the one dispatcher all three socket
 * transports share.
 *
 * This test replaces a guard that asserted the gap was still open, and the
 * way that guard failed is the point. It checked whether anything under
 * `transport/websocket/` read the option — the place the defect happened to
 * live. The fix landed one layer down in the shared dispatcher, so the
 * condition changed and the guard stayed green: it was watching a location,
 * not a property. What follows watches the property.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const remotePeer = path.join(repoRoot, 'packages/titan/src/netron/remote-peer.ts');
const netron = path.join(repoRoot, 'packages/titan/src/netron/netron.ts');

const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('the ALS frame around a socket call', () => {
  it('found the dispatcher to check', () => {
    // Without this, every assertion below passes on a missing file — which
    // is the failure mode this file exists to prevent, one level up.
    expect(fs.existsSync(remotePeer), 'remote-peer.ts').toBe(true);
    expect(read(remotePeer).length).toBeGreaterThan(10_000);
  });

  it('wraps the CALL branch, not merely the definition', () => {
    // A wrapper that exists and is never applied is the state this replaced.
    const src = read(remotePeer);
    const callBranch = src.slice(src.indexOf('case TYPE_CALL'), src.indexOf('case TYPE_TASK'));

    expect(callBranch, 'TYPE_CALL branch not found').not.toBe('');
    expect(callBranch).toContain('withInvocationFrame');
  });

  it('is given the wrapper by the server that accepts the peer', () => {
    expect(read(netron)).toContain('setInvocationWrapper');
  });

  it('passes the key a wrapper written against HTTP actually reads', () => {
    // `createRlsInvocationWrapper` — the documented pattern — reads exactly
    // one key. A frame with a different metadata shape would be established
    // and useless, which is harder to notice than no frame at all.
    const src = read(remotePeer);
    const frame = src.slice(src.indexOf('withInvocationFrame'), src.indexOf('constructor('));

    expect(frame).toContain("'authContext'");
    expect(frame).toContain("'serviceName'");
    expect(frame).toContain("'methodName'");
  });

  it('still calls through when no wrapper is configured', () => {
    // Inventing a frame where none was asked for would change behaviour for
    // every transport that never had one.
    const src = read(remotePeer);
    const frame = src.slice(src.indexOf('private async withInvocationFrame'));

    expect(frame.slice(0, 400)).toMatch(/if \(!this\.invocationWrapper\) return fn\(\)/);
  });

  it('is passed to the socket transports by both Omnitron call sites', () => {
    // The daemon's own, and the one every managed app gets.
    const daemon = read(path.join(here, '../../src/daemon/daemon.ts'));
    const bootstrap = read(path.join(here, '../../src/orchestrator/bootstrap-process.ts'));

    expect(daemon).toContain('invocationWrapper: authContextWrapper');
    expect(bootstrap).toContain("wsOptions['invocationWrapper'] = auth.invocationWrapper");
  });
});
