/**
 * `omnitron doctor` — whether the console actually serves.
 *
 * The check asks the console for its root page instead of reading the
 * container's state, and the difference is not theoretical. On this host the
 * console served 404 to everything for 1709 consecutive health-check
 * failures: nginx was up, the container was up, and `webapp/dist` had been
 * deleted and rebuilt, so the bind mount pointed at an inode that no longer
 * existed. Inside the container the directory was simply absent.
 *
 * Every layer reported truthfully about itself. Only the question "can an
 * operator open the console" had a useful answer, and nothing was asking it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { Findings, checkConsoleServing } from '../../src/commands/doctor.js';
import type { IDaemonConfig } from '../../src/config/types.js';

const config = { httpPort: 9800 } as IDaemonConfig;

/** Answer every fetch with `status`, or fail to connect. */
function stubFetch(status: number | 'refused') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (status === 'refused') throw new Error('ECONNREFUSED');
      return { status } as Response;
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('console serving', () => {
  it('says nothing when the console answers', async () => {
    stubFetch(200);
    const findings = new Findings();

    await checkConsoleServing(findings, config);

    expect(findings.all()).toEqual([]);
  });

  it('says nothing when nothing is listening', async () => {
    // `omnitron webapp` is opt-in. A daemon running without a console is a
    // configuration, not a fault, and reporting it would train an operator
    // to skip this section.
    stubFetch('refused');
    const findings = new Findings();

    await checkConsoleServing(findings, config);

    expect(findings.all()).toEqual([]);
  });

  it('reports a 404 as the mount problem it usually is', async () => {
    stubFetch(404);
    const findings = new Findings();

    await checkConsoleServing(findings, config);

    const [finding] = findings.all();
    expect(finding?.id).toBe('webapp.not-serving');
    expect(finding?.severity).toBe('error');
    expect(finding?.evidence.join('\n')).toMatch(/bind mount/i);
    // The remedy has to say recreate, not restart — a restart leaves the
    // stale mount in place and looks like the fix failed.
    expect(finding?.remedy).toMatch(/webapp stop && omnitron webapp start/);
    expect(finding?.remedy).toMatch(/restart is not enough/i);
  });

  it('reports any other failing status too', async () => {
    // 502 and 500 are different causes with the same consequence: the
    // operator cannot open the console.
    for (const status of [500, 502, 503]) {
      stubFetch(status);
      const findings = new Findings();

      await checkConsoleServing(findings, config);

      expect(findings.all()[0]?.title, String(status)).toContain(String(status));
    }
  });

  it('accepts a redirect as serving', async () => {
    // A deployment that redirects the root to /dashboard is serving.
    stubFetch(302);
    const findings = new Findings();

    await checkConsoleServing(findings, config);

    expect(findings.all()).toEqual([]);
  });
});
