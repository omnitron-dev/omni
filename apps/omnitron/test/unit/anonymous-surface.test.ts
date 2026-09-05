/**
 * `omnitron doctor` — what the daemon answers to a caller with no credentials.
 *
 * The check measures rather than reads. Two of the daemon's services are
 * fully anonymous by way of the packages that declare them — `Health@1.0.0`
 * from titan-health, `OmnitronMetrics` from titan-metrics — and neither
 * appears anywhere in apps/omnitron, so reading this repository's decorators
 * would never have found them. They were found by asking a running daemon,
 * which is also how this check works.
 *
 * `getSnapshot` is the one that matters: it returns every managed app by
 * name with its CPU, memory and status — the platform's inventory. Probes
 * and scrapes (`live`, `ready`, `getPrometheusText`) are anonymous on
 * purpose and are not probed here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { Findings, checkAnonymousSurface } from '../../src/commands/doctor.js';
import type { IDaemonConfig } from '../../src/config/types.js';

const config = (host: string): IDaemonConfig => ({ host, httpPort: 9800 }) as IDaemonConfig;

/** Answer `success` to every /netron/invoke, or fail to connect. */
function stubFetch(success: boolean | 'unreachable') {
  const spy = vi.fn(async () => {
    if (success === 'unreachable') throw new Error('ECONNREFUSED');
    return { json: async () => ({ success }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('anonymous surface', () => {
  it('says nothing when the daemon refuses anonymous calls', async () => {
    stubFetch(false);
    const findings = new Findings();

    await checkAnonymousSurface(findings, config('127.0.0.1'));

    expect(findings.all()).toEqual([]);
  });

  it('says nothing when the daemon cannot be reached', async () => {
    // Unreachable is not "open". Reporting an exposure the probe could not
    // observe would be the same defect the probe exists to catch.
    stubFetch('unreachable');
    const findings = new Findings();

    await checkAnonymousSurface(findings, config('0.0.0.0'));

    expect(findings.all()).toEqual([]);
  });

  it('reports it as a note when the daemon is on loopback', async () => {
    stubFetch(true);
    const findings = new Findings();

    await checkAnonymousSurface(findings, config('127.0.0.1'));

    const [finding] = findings.all();
    expect(finding?.id).toBe('auth.anonymous-surface');
    expect(finding?.severity).toBe('info');
    // No remedy: there is nothing for the operator to do about a local
    // process reading local metrics, and a remedy here would be noise.
    expect(finding?.remedy).toBeUndefined();
  });

  it('raises it to a warning once the daemon is bound to an interface', async () => {
    // The exposure is the same; what changed is who can reach it. Severity
    // follows reachability because reachability is what decides the cost.
    stubFetch(true);
    const findings = new Findings();

    await checkAnonymousSurface(findings, config('0.0.0.0'));

    const [finding] = findings.all();
    expect(finding?.severity).toBe('warning');
    expect(finding?.remedy).toBeTruthy();
    expect(finding?.evidence.join(' ')).toContain('daemon.host: 0.0.0.0');
  });

  it('names what each open method discloses, not just that it is open', async () => {
    // "2 methods are anonymous" is a status. "returns every managed app by
    // name" is what lets an operator decide whether they care.
    stubFetch(true);
    const findings = new Findings();

    await checkAnonymousSurface(findings, config('10.0.0.5'));

    const evidence = findings.all()[0]?.evidence.join('\n') ?? '';
    expect(evidence).toContain('OmnitronMetrics.getSnapshot()');
    expect(evidence).toContain('every managed app by name');
  });
});
