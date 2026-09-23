/**
 * A runtime that could not be asked, answered as a runtime with nothing in it.
 *
 * `OmnitronInfra.listContainers` asked `listManagedContainers()` without
 * `orThrow`, so a Docker that did not answer came back as `[]`. The console's
 * containers page then said «No containers found» with 0 running, and the
 * topology read no container's health — while every container ran. The
 * method's own comment names this failure: an empty state indistinguishable
 * from a broken query.
 */

import { describe, it, expect, vi } from 'vitest';

const DOCKER_DOWN = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock';

vi.mock('../../src/infrastructure/container-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/infrastructure/container-runtime.js')>()),
  // As the reader behaves when Docker does not answer: an empty list unless
  // it is asked to say so.
  listManagedContainers: vi.fn(async (options: { orThrow?: boolean } = {}) => {
    if (options.orThrow) throw new Error(DOCKER_DOWN);
    return [];
  }),
}));

const { InfrastructureRpcService } = await import('../../src/services/infrastructure.rpc-service.js');

describe('a runtime that could not be asked', () => {
  it('is a failure with its reason, not an empty list', async () => {
    const service = new InfrastructureRpcService(() => null);

    await expect(service.listContainers()).rejects.toThrow(DOCKER_DOWN);
  });
});
