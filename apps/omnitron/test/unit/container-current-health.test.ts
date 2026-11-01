import { describe, expect, it, vi } from 'vitest';

const adapter = vi.hoisted(() => ({ containerExists: vi.fn(async () => true), inspectContainer: vi.fn(), listContainers: vi.fn() }));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class {
    containerExists = adapter.containerExists;
    inspectContainer = adapter.inspectContainer;
    listContainers = adapter.listContainers;
  },
}));
import { getContainerState } from '../../src/infrastructure/container-runtime.js';

describe('current container health', () => {
  it('proves strict absence using a successful native listing', async () => {
    adapter.listContainers.mockResolvedValue(['another-container']);
    expect(await getContainerState('sample-db', { orThrow: true })).toBeNull();
    expect(adapter.listContainers).toHaveBeenCalledWith(true);
  });
  it('does not report an inaccessible daemon or inspect race as an absent container', async () => {
    adapter.listContainers.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(getContainerState('sample-db', { orThrow: true })).rejects.toThrow('Docker unavailable');
    adapter.listContainers.mockResolvedValue(['sample-db']);
    adapter.inspectContainer.mockRejectedValueOnce(new Error('Container disappeared during inspect'));
    await expect(getContainerState('sample-db', { orThrow: true })).rejects.toThrow('Container disappeared');
  });
  it.each(['exited', 'paused', 'created', 'restarting', 'dead'])(
    'does not reuse a saved probe while %s',
    async (status) => {
      for (const health of ['healthy', 'unhealthy']) {
        adapter.inspectContainer.mockResolvedValue({
          Name: '/sample-db',
          State: { Status: status, Health: { Status: health }, ExitCode: 0 },
        });
        expect(await getContainerState('sample-db')).toMatchObject({ status, health: 'none' });
      }
    }
  );
  it.each(['healthy', 'unhealthy', 'starting'])('retains the %s probe for a running container', async (health) => {
    adapter.inspectContainer.mockResolvedValue({
      Name: '/sample-db',
      State: { Status: 'running', Health: { Status: health } },
    });
    expect(await getContainerState('sample-db')).toMatchObject({ status: 'running', health });
  });
  it('keeps a real exit failure and its reason even when the last probe was healthy', async () => {
    adapter.inspectContainer.mockResolvedValue({
      Name: '/sample-db',
      State: { Status: 'exited', Health: { Status: 'healthy' }, ExitCode: 137, OOMKilled: true },
    });
    expect(await getContainerState('sample-db')).toMatchObject({
      status: 'exited',
      health: 'none',
      error: expect.stringMatching(/OOM/i),
    });
  });
});
