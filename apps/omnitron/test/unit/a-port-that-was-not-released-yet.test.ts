/**
 * Recreating three services at once left all three unstartable.
 *
 * `docker rm` returns before the kernel releases the port its docker-proxy
 * held, so a reconciler that removes a container and immediately recreates
 * it races that release:
 *
 *     docker: Error response from daemon: failed to set up container
 *     networking: driver failed programming external connectivity on
 *     endpoint daos-test-postgres: Bind for 127.0.0.1:5432 failed:
 *     port is already allocated
 *
 * Measured on a node, on postgres, redis and minio together. Each container
 * was left in `Created` and never started, and `docker start` by hand a
 * second later worked — which is what makes it a race rather than a
 * conflict, and what makes a retry the right answer rather than a louder
 * error.
 *
 * The failed run holds the name, so the retry has to remove the husk first
 * or it meets a name conflict instead of the port.
 */

import { describe, it, expect } from 'vitest';

import { isPortNotYetReleased, isStaleContainerState } from '../../src/infrastructure/container-runtime.js';

const PORT_HELD =
  'docker: Error response from daemon: failed to set up container networking: driver failed ' +
  'programming external connectivity on endpoint daos-test-postgres: Bind for 127.0.0.1:5432 ' +
  'failed: port is already allocated';

const transient = (message: string) => isPortNotYetReleased(message) || isStaleContainerState(message);

describe('what the retry treats as transient', () => {
  it('retries a port that has not been released', () => {
    expect(isPortNotYetReleased(PORT_HELD)).toBe(true);
  });

  it('retries the endpoint and name races of the same family', () => {
    expect(isStaleContainerState('endpoint with name daos-test-redis already exists in network x')).toBe(true);
    expect(isStaleContainerState('The container name "/daos-test-redis" is already in use by container abc')).toBe(true);
  });

  it('does NOT retry a failure that will never resolve', () => {
    // A missing image, a bad flag, a port genuinely held by something else:
    // retrying turns one clear error into several identical ones separated
    // by delays.
    expect(transient('docker: Error response from daemon: pull access denied for minio/minio')).toBe(false);
    expect(transient('docker: invalid reference format')).toBe(false);
    expect(transient('docker: Error response from daemon: no such image')).toBe(false);
  });

  it('keeps the two families apart', () => {
    // They need different remedies: stale state is scrubbed, a held port is
    // waited for. Treating them as one would scrub nothing and wait for
    // nothing, respectively.
    expect(isStaleContainerState(PORT_HELD)).toBe(false);
    expect(isPortNotYetReleased('endpoint with name x already exists in network y')).toBe(false);
  });
});

describe('when waiting does not help', () => {
  it('names the container holding the port, and the command that frees it', async () => {
    const { describeBindFailure } = await import('../../src/infrastructure/container-runtime.js');

    // `port is already allocated` is true and useless: it names the port and
    // withholds the only thing an operator can act on. Measured on a node
    // where three services would not start, and the holder was
    // `omnitron-postgres` — a container from an earlier naming of the same
    // stack that the reconciler had stopped recognising, and therefore
    // stopped managing.
    const said = await describeBindFailure(
      { name: 'daos-test-postgres', ports: [{ host: 5432, bindHost: '127.0.0.1' }] },
      'Bind for 127.0.0.1:5432 failed: port is already allocated',
      async () => 'omnitron-postgres',
    );

    expect(said).toContain('omnitron-postgres');
    expect(said).toContain('docker rm -f omnitron-postgres');
    // The volume is data. Saying it is kept is what makes the command
    // something an operator will actually run.
    expect(said).toContain('keeps its volume');
  });

  it('keeps the original message when nothing holds the port', async () => {
    const { describeBindFailure } = await import('../../src/infrastructure/container-runtime.js');

    const original = 'docker: some other failure entirely';
    // Nothing holding it is its own information: the bind failed for
    // another reason, and inventing a holder would send the operator to
    // remove a container that is not the problem.
    await expect(
      describeBindFailure({ name: 'x', ports: [{ host: 1234 }] }, original, async () => null),
    ).resolves.toBe(original);
  });
});
