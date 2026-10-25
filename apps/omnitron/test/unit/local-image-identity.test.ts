import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const dockerAdapter = vi.hoisted(() => ({ listImages: vi.fn(), pullImage: vi.fn() }));
vi.mock('@xec-sh/core', () => ({ DockerAdapter: class { listImages = dockerAdapter.listImages; pullImage = dockerAdapter.pullImage; } }));
import { ensureImage } from '../../src/infrastructure/container-runtime.js';
let image: string;
beforeAll(() => {
  image = execFileSync('docker', ['build', '--quiet', '-'], {
    input: `FROM scratch\nLABEL omnitron.image-identity-test=${randomUUID()}\n`,
    encoding: 'utf8', timeout: 30_000,
  }).trim();
  expect(image).toMatch(/^sha256:[a-f0-9]{64}$/);
});
afterAll(() => {
  if (image) execFileSync('docker', ['image', 'rm', image], { stdio: 'ignore' });
});
it('accepts an exact real local image ID without asking any registry adapter', async () => {
  await expect(ensureImage(image)).resolves.toBeUndefined();
  expect(dockerAdapter.listImages).not.toHaveBeenCalled();
  expect(dockerAdapter.pullImage).not.toHaveBeenCalled();
});
it('rejects an absent real local image instead of falling through to registry pull', async () => {
  await expect(ensureImage('sha256:' + 'f'.repeat(64))).rejects.toThrow();
  expect(dockerAdapter.listImages).not.toHaveBeenCalled();
  expect(dockerAdapter.pullImage).not.toHaveBeenCalled();
});
it('refuses abbreviated or malformed local IDs before consulting Docker', async () => {
  for (const id of ['sha256:abc', 'sha256:' + 'A'.repeat(64), 'sha256:' + '0'.repeat(64) + ':latest'])
    await expect(ensureImage(id)).rejects.toThrow('Invalid local image ID');
  expect(dockerAdapter.pullImage).not.toHaveBeenCalled();
});
it('retains registry digest handling through the native adapter', async () => {
  const reference = 'example.invalid/fixture@sha256:' + '1'.repeat(64);
  dockerAdapter.listImages.mockResolvedValueOnce([reference]);
  await ensureImage(reference);
  expect(dockerAdapter.pullImage).not.toHaveBeenCalled();
  dockerAdapter.listImages.mockResolvedValueOnce([]);
  dockerAdapter.pullImage.mockResolvedValueOnce(undefined);
  await ensureImage(reference);
  expect(dockerAdapter.pullImage).toHaveBeenCalledExactlyOnceWith(reference);
});
