import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import { ensureImage } from '../../src/infrastructure/container-runtime.js';
import { expandServiceDeclarations } from '../../src/infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';

const docker = vi.hoisted(() => ({ list: vi.fn(), pull: vi.fn(), execute: vi.fn() }));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class { listImages = docker.list; pullImage = docker.pull; },
  ExecutionEngine: class { execute = docker.execute; async dispose() {} },
}));

const registry = createDefaultRegistry();
const image = registry.get('minio')!.defaultImage;
const label = 'org.omnitron.minio-recipe';
const recipe = await readFile(new URL('../../data/images/minio/Dockerfile', import.meta.url));
const digest = createHash('sha256').update(recipe).digest('hex');
const cached = { stdout: `sha256:${'0'.repeat(64)} ${digest}\n` };
beforeEach(() => vi.resetAllMocks());

it('builds the shipped recipe once on concurrent cache misses, then verifies the cache independently', async () => {
  expect(image).toBe(`omnitron-local/minio:recipe-${digest}`);
  docker.list.mockResolvedValueOnce([]).mockResolvedValueOnce([image]);
  docker.execute.mockResolvedValueOnce({ stdout: '' }).mockResolvedValue(cached);
  await Promise.all([ensureImage(image), ensureImage(image)]);
  expect(docker.list).toHaveBeenCalledExactlyOnceWith(image);
  expect(docker.execute.mock.calls[0]![0]).toMatchObject({
    command: 'docker', shell: false, args: ['build', '--label', `${label}=${digest}`, '--tag', image, '-'], stdin: recipe,
  });
  await ensureImage(image);
  expect(docker.execute).toHaveBeenCalledTimes(3);
  for (const [command] of docker.execute.mock.calls.slice(1))
    expect(command.args).toEqual(['image', 'inspect', '--format', `{{.Id}} {{index .Config.Labels "${label}"}}`, '--', image]);
  expect(docker.pull).not.toHaveBeenCalled();
});

it('rejects a conflicting cached image and propagates a failed clean build, allowing a retry', async () => {
  docker.list.mockResolvedValueOnce([image]).mockResolvedValue([]);
  docker.execute.mockResolvedValueOnce({ stdout: `sha256:${'0'.repeat(64)} <no value>` })
    .mockRejectedValueOnce(Error('package unavailable')).mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce(cached);
  await expect(ensureImage(image)).rejects.toThrow('does not identify its pinned MinIO recipe');
  await expect(ensureImage(image)).rejects.toThrow('package unavailable');
  await expect(ensureImage(image)).resolves.toBeUndefined();
  expect(docker.pull).not.toHaveBeenCalled();
});

it('preserves explicit legacy, preset and Docker overrides on the regular registry path', async () => {
  const original = 'fixture.example/storage:original';
  const selected = 'fixture.example/storage:selected';
  const legacy = expandServiceDeclarations({ minio: { image: original } }, registry);
  const preset = expandServiceDeclarations({ services: { minio: { preset: 'minio', image: original } } }, registry);
  const override = expandServiceDeclarations({
    minio: { image: original }, services: { minio: { preset: 'minio', image: original, docker: { image: selected } } },
  }, registry);
  expect([legacy['minio'], preset['minio'], override['minio']].map(s => s?.docker?.image)).toEqual([original, original, selected]);
  docker.list.mockResolvedValue([]);
  await ensureImage(override['minio']!.docker!.image!);
  expect(docker.pull).toHaveBeenCalledExactlyOnceWith(selected);
  expect(docker.execute).not.toHaveBeenCalled();
});

it('keeps the Postgres and Redis defaults pinned', () => {
  for (const name of ['postgres', 'redis']) {
    const reference = registry.get(name)!.defaultImage;
    expect(reference).toMatch(/:/);
    expect(reference).not.toMatch(/:latest$/);
  }
});
