/**
 * The advice a stopped container gets.
 *
 * `omnitron up` is right for a container that simply stopped. It is wrong
 * when Docker has already said why it could not start and the reason is a
 * condition `up` runs straight back into.
 *
 * Seen on this machine: `omnitron-pg` exited with `mkdir
 * /var/lib/docker/overlay2/...: no space left on device`. The finding printed
 * that in its evidence and then advised `omnitron up`, which fails
 * identically and immediately with the same message. Advice that cannot work
 * is worse than none — it costs a run to disprove, and it reads as though the
 * problem has been diagnosed.
 */

import { describe, it, expect } from 'vitest';

import { containerRemedy } from '../../src/commands/doctor.js';

describe('containerRemedy', () => {
  it('does not send an operator back into a full disk', () => {
    const remedy = containerRemedy(
      'omnitron-pg',
      'mkdir /var/lib/docker/overlay2/2e3844c1/merged: no space left on device — exit code 1',
      false
    );

    // Not "must not mention `omnitron up`" — naming it in order to say it
    // will fail is the useful half. What must not survive is instructing it.
    expect(remedy).toMatch(/`omnitron up` will fail/);
    expect(remedy).toMatch(/out of disk/i);
    // The distinction that mattered when this was diagnosed by hand: 188 GB
    // of volumes was 27 GB reclaimable, and acting on the first number would
    // have meant deleting the wrong thing.
    expect(remedy).toMatch(/reclaimable/i);
  });

  it('does not send an operator back into a bound port', () => {
    const remedy = containerRemedy('omnitron-redis', 'Bind for 0.0.0.0:6379 failed: port is already allocated', false);

    expect(remedy).toMatch(/lsof/);
    expect(remedy).toMatch(/will not move the conflict/);
  });

  it('says recreate, not restart, for a stale network endpoint', () => {
    const remedy = containerRemedy(
      'daos-dev-monero-daemon',
      'failed to set up container networking: endpoint with name daos-dev-monero-daemon already exists in network daos-dev_default',
      false
    );

    expect(remedy).toMatch(/docker rm -f daos-dev-monero-daemon/);
  });

  it('keeps the plain answer for a container that simply stopped', () => {
    // The default must survive: most stopped containers are exactly that, and
    // a remedy that never says `omnitron up` would be its own defect.
    expect(containerRemedy('omnitron-pg', 'exit code 0', false)).toBe(
      'Run `omnitron up` to reconcile infrastructure.'
    );
    expect(containerRemedy('omnitron-pg', undefined, false)).toBe(
      'Run `omnitron up` to reconcile infrastructure.'
    );
  });

  it('tells a never-started container to be removed first', () => {
    const remedy = containerRemedy('omnitron-pg', 'some reason', true);

    expect(remedy).toMatch(/docker rm -f omnitron-pg/);
    expect(remedy).toMatch(/keeps its name/);
  });
});
